import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import { test } from "node:test";

const PROJECT_ROOT = new URL("../", import.meta.url);
const CLI_PATH = new URL("cli/expo-ios.mjs", PROJECT_ROOT);

function runCli(args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI_PATH.pathname, ...args], {
      cwd: options.cwd ?? PROJECT_ROOT.pathname,
      env: options.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

function parseJson(result) {
  assert.equal(result.code, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

async function writeExecutable(file, source) {
  await fs.writeFile(file, source);
  await fs.chmod(file, 0o755);
}

test("expo-ios doctor returns a stable success envelope without auth requirements", async () => {
  const payload = parseJson(await runCli(["--json", "doctor"]));

  assert.equal(payload.ok, true);
  assert.equal(payload.data.cli.name, "expo-ios");
  assert.equal(payload.data.auth.required, false);
  assert.equal(payload.data.auth.source, "not-required");
  assert.equal(typeof payload.data.capabilities.iosSimulator, "boolean");
});

test("expo-ios doctor checks tool paths without executing local tooling", async () => {
  const project = await fs.mkdtemp(path.join(os.tmpdir(), "expo-ios-doctor-"));
  const fakeBin = path.join(project, "bin");
  const sentinel = path.join(project, "tool-executed");
  await fs.mkdir(fakeBin, { recursive: true });
  for (const command of ["npx", "xcrun", "open", "plutil", "idb", "axe", "adb"]) {
    const script = `#!/bin/sh\necho ${command} >> ${JSON.stringify(sentinel)}\nexit 99\n`;
    await fs.writeFile(path.join(fakeBin, command), script);
    await fs.chmod(path.join(fakeBin, command), 0o755);
  }

  const payload = parseJson(await runCli(["--json", "doctor", "--cwd", project], {
    cwd: project,
    env: { ...process.env, PATH: `${fakeBin}${path.delimiter}${process.env.PATH}` },
  }));

  assert.equal(payload.ok, true);
  assert.equal(payload.data.cwd, project);
  assert.equal(payload.data.auth.required, false);
  await assert.rejects(fs.access(sentinel));
});

test("expo-ios exposes Clawpatch-style global contract flags", async () => {
  const version = await runCli(["--version"]);
  assert.equal(version.code, 0);
  assert.equal(version.stdout.trim(), "0.1.0");

  const plain = await runCli(["--plain", "doctor"]);
  assert.equal(plain.code, 0, plain.stderr);
  assert.match(plain.stdout, /^ok: true$/m);
  assert.match(plain.stdout, /^command: doctor$/m);
  assert.match(plain.stdout, /^cli: expo-ios 0\.1\.0$/m);
  assert.doesNotMatch(plain.stdout, /^\{/m);
  assert.ok(plain.stdout.length < 2000);
});

test("expo-ios doctor global usage errors use the machine-readable envelope", async () => {
  const result = await runCli(["--json", "--plain", "doctor"]);
  assert.equal(result.code, 2);
  assert.equal(result.stdout, "");

  const payload = JSON.parse(result.stderr);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, "invalid_usage");
  assert.equal(payload.error.exitCode, 2);
  assert.match(payload.error.message, /--json and --plain are mutually exclusive/);
});

test("expo-ios optionally persists redacted run records", async () => {
  const project = await fs.mkdtemp(path.join(os.tmpdir(), "expo-ios-record-"));
  const stateDir = path.join(project, ".scratch", "expo-ios", "runs");
  const result = await runCli([
    "--json",
    "--state-dir",
    stateDir,
    "review-next",
    "--issue",
    "myapp://customers?token=session-secret",
    "--surface",
    "generic",
  ], { cwd: project });

  assert.equal(result.code, 0, result.stderr);
  const files = await fs.readdir(stateDir);
  assert.equal(files.length, 1);
  const record = JSON.parse(await fs.readFile(path.join(stateDir, files[0]), "utf8"));
  assert.equal(record.schemaVersion, 1);
  assert.equal(record.command, "review-next");
  assert.equal(record.status, "completed");
  assert.equal(record.exitCode, 0);
  assert.match(record.args.issue, /token=\[redacted\]/);
  assert.doesNotMatch(JSON.stringify(record), /session-secret/);
});

test("expo-ios redacts sensitive native stdout before JSON output and run records", async () => {
  const project = await fs.mkdtemp(path.join(os.tmpdir(), "expo-ios-redact-"));
  const fakeBin = path.join(project, "bin");
  const stateDir = path.join(project, ".scratch", "expo-ios", "runs");
  await fs.mkdir(fakeBin, { recursive: true });
  await writeExecutable(path.join(fakeBin, "xcrun"), `#!/bin/sh
if [ "$1 $2 $3 $4 $5" = "simctl list devices available --json" ]; then
  cat <<'JSON'
{"devices":{"com.apple.CoreSimulator.SimRuntime.iOS-18-0":[{"name":"iPhone 15","udid":"SIM-1","state":"Booted","isAvailable":true}]}}
JSON
  exit 0
fi
if [ "$1 $2" = "simctl openurl" ]; then
  echo "opened $3 $4"
  exit 0
fi
echo "unexpected xcrun $*" >&2
exit 64
`);

  const result = await runCli([
    "--json",
    "--state-dir",
    stateDir,
    "open-url",
    "fixture://customers?token=session-secret",
  ], {
    cwd: project,
    env: { ...process.env, PATH: `${fakeBin}${path.delimiter}${process.env.PATH}` },
  });

  assert.equal(result.code, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /session-secret/);
  const payload = JSON.parse(result.stdout);
  assert.match(payload.data.stdout, /token=\[redacted\]/);

  const files = await fs.readdir(stateDir);
  assert.equal(files.length, 1);
  const record = JSON.parse(await fs.readFile(path.join(stateDir, files[0]), "utf8"));
  assert.doesNotMatch(JSON.stringify(record), /session-secret/);
  assert.match(record.args.url, /token=\[redacted\]/);
});

test("expo-ios session new review creates an artifact namespace and run record", async () => {
  const project = await fs.mkdtemp(path.join(os.tmpdir(), "expo-ios-session-"));
  const stateDir = path.join(project, ".scratch", "expo-ios", "runs");

  const payload = parseJson(await runCli([
    "--json",
    "--state-dir",
    stateDir,
    "session",
    "new",
    "review",
  ], { cwd: project }));

  assert.equal(payload.ok, true);
  assert.equal(payload.data.schemaVersion, 1);
  assert.equal(payload.data.name, "review");
  assert.match(payload.data.sessionId, /^review-\d{8}-\d{6}-[a-z0-9]+$/);
  assert.equal(payload.data.activeTargetId, null);
  assert.equal(payload.data.lastSnapshotId, null);
  assert.deepEqual(payload.data.sidecars, []);
  assert.equal(payload.data.artifactDir, path.join(project, ".scratch", "expo-ios", "sessions", payload.data.sessionId, "artifacts"));

  const sessionFile = path.join(project, ".scratch", "expo-ios", "sessions", payload.data.sessionId, "session.json");
  const persisted = JSON.parse(await fs.readFile(sessionFile, "utf8"));
  assert.deepEqual(persisted, payload.data);
  assert.equal((await fs.stat(payload.data.artifactDir)).isDirectory(), true);

  const runRecords = await fs.readdir(stateDir);
  assert.equal(runRecords.length, 1);
  const runRecord = JSON.parse(await fs.readFile(path.join(stateDir, runRecords[0]), "utf8"));
  assert.equal(runRecord.command, "session");
  assert.equal(runRecord.status, "completed");
  assert.equal(runRecord.exitCode, 0);
  assert.ok(runRecord.summary.keys.includes("sessionId"));
});

test("expo-ios target list select and current use stable session state", async () => {
  const project = await fs.mkdtemp(path.join(os.tmpdir(), "expo-ios-target-"));
  const fakeBin = path.join(project, "bin");
  const stateDir = path.join(project, ".scratch", "expo-ios", "runs");
  await fs.mkdir(fakeBin, { recursive: true });
  await writeExecutable(path.join(fakeBin, "xcrun"), `#!/bin/sh
if [ "$1 $2 $3 $4 $5" = "simctl list devices available --json" ]; then
  cat <<'JSON'
{"devices":{"com.apple.CoreSimulator.SimRuntime.iOS-18-0":[{"name":"iPhone 15","udid":"SIM-1","state":"Booted","isAvailable":true},{"name":"iPhone 16","udid":"SIM-2","state":"Shutdown","isAvailable":true}]}}
JSON
  exit 0
fi
echo "unexpected xcrun $*" >&2
exit 64
`);
  const metro = await startFakeTargetMetro([
    {
      id: "metro-1",
      title: "Fixture App",
      appId: "com.example.fixture",
      deviceName: "iPhone 15",
      description: "Hermes target",
      webSocketDebuggerUrl: "ws://127.0.0.1:65530/inspector",
    },
  ]);

  try {
    const session = parseJson(await runCli([
      "--json",
      "--state-dir",
      stateDir,
      "session",
      "new",
      "review",
    ], { cwd: project }));
    const listed = parseJson(await runCli([
      "--json",
      "--state-dir",
      stateDir,
      "target",
      "list",
      "--metro-port",
      String(metro.port),
    ], {
      cwd: project,
      env: { ...process.env, PATH: `${fakeBin}${path.delimiter}${process.env.PATH}` },
    }));

    assert.equal(listed.ok, true);
    assert.equal(listed.data.available, true);
    assert.equal(listed.data.targets.length, 2);
    const liveTarget = listed.data.targets.find((target) => target.metro.status === "available");
    assert.equal(liveTarget.platform, "ios");
    assert.equal(liveTarget.device.id, "SIM-1");
    assert.equal(liveTarget.device.state, "booted");
    assert.equal(liveTarget.app.bundleId, "com.example.fixture");
    assert.equal(liveTarget.metro.port, metro.port);
    assert.equal(liveTarget.selected, false);
    assert.equal(liveTarget.stale, false);

    const selected = parseJson(await runCli([
      "--json",
      "--state-dir",
      stateDir,
      "target",
      "select",
      liveTarget.targetId,
      "--metro-port",
      String(metro.port),
    ], {
      cwd: project,
      env: { ...process.env, PATH: `${fakeBin}${path.delimiter}${process.env.PATH}` },
    }));
    assert.equal(selected.data.selected, true);
    assert.equal(selected.data.targetId, liveTarget.targetId);

    const sessionFile = path.join(project, ".scratch", "expo-ios", "sessions", session.data.sessionId, "session.json");
    const persisted = JSON.parse(await fs.readFile(sessionFile, "utf8"));
    assert.equal(persisted.activeTargetId, liveTarget.targetId);

    const current = parseJson(await runCli([
      "--json",
      "--state-dir",
      stateDir,
      "target",
      "current",
      "--metro-port",
      String(metro.port),
    ], {
      cwd: project,
      env: { ...process.env, PATH: `${fakeBin}${path.delimiter}${process.env.PATH}` },
    }));
    assert.equal(current.data.available, true);
    assert.equal(current.data.target.targetId, liveTarget.targetId);
    assert.equal(current.data.target.selected, true);
    assert.equal(current.data.target.stale, false);

    await metro.close();
    const stale = parseJson(await runCli([
      "--json",
      "--state-dir",
      stateDir,
      "target",
      "current",
      "--metro-port",
      String(metro.port),
    ], {
      cwd: project,
      env: { ...process.env, PATH: `${fakeBin}${path.delimiter}${process.env.PATH}` },
    }));
    assert.equal(stale.data.available, false);
    assert.equal(stale.data.reason, "Selected target is stale.");
    assert.equal(stale.data.target.targetId, liveTarget.targetId);
    assert.equal(stale.data.target.stale, true);
  } finally {
    await metro.close().catch(() => {});
  }
});

test("expo-ios target current reports missing session selection", async () => {
  const project = await fs.mkdtemp(path.join(os.tmpdir(), "expo-ios-target-missing-"));
  const stateDir = path.join(project, ".scratch", "expo-ios", "runs");

  const payload = parseJson(await runCli([
    "--json",
    "--state-dir",
    stateDir,
    "target",
    "current",
  ], { cwd: project }));

  assert.equal(payload.ok, true);
  assert.deepEqual(payload.data, {
    available: false,
    reason: "No session exists. Run `expo-ios --json session new review` first.",
  });
});

test("expo-ios snapshot refs and get read cached semantic refs", async () => {
  const project = await fs.mkdtemp(path.join(os.tmpdir(), "expo-ios-snapshot-"));
  const fakeBin = path.join(project, "bin");
  const stateDir = path.join(project, ".scratch", "expo-ios", "runs");
  await fs.mkdir(fakeBin, { recursive: true });
  await writeExecutable(path.join(fakeBin, "xcrun"), `#!/bin/sh
if [ "$1 $2 $3 $4 $5" = "simctl list devices available --json" ]; then
  cat <<'JSON'
{"devices":{"com.apple.CoreSimulator.SimRuntime.iOS-18-0":[{"name":"iPhone 15","udid":"SIM-1","state":"Booted","isAvailable":true}]}}
JSON
  exit 0
fi
if [ "$1 $2" = "simctl io" ] && [ "$4" = "screenshot" ]; then
  printf 'fakepng' > "$5"
  echo "screenshot $5"
  exit 0
fi
echo "unexpected xcrun $*" >&2
exit 64
`);
  await writeExecutable(path.join(fakeBin, "axe"), `#!/bin/sh
if [ "$1" = "describe-ui" ]; then
  cat <<'JSON'
[{"role":"AXApplication","children":[{"role":"AXButton","AXLabel":"Add customer","testID":"add-customer","frame":{"x":20,"y":44,"width":160,"height":48},"source":{"file":"app/customers/index.tsx","line":42,"column":7}},{"role":"AXStaticText","AXLabel":"Customers","AXValue":"Customers","frame":{"x":20,"y":108,"width":220,"height":32}}]}]
JSON
  exit 0
fi
echo "unexpected axe $*" >&2
exit 64
`);
  const metro = await startFakeTargetMetro([
    {
      id: "metro-1",
      title: "Fixture App",
      appId: "com.example.fixture",
      deviceName: "iPhone 15",
      description: "Hermes target",
      webSocketDebuggerUrl: "ws://127.0.0.1:65530/inspector",
    },
  ]);

  try {
    await runCli(["--json", "--state-dir", stateDir, "session", "new", "review"], { cwd: project });
    const listed = parseJson(await runCli([
      "--json",
      "--state-dir",
      stateDir,
      "target",
      "list",
      "--metro-port",
      String(metro.port),
    ], {
      cwd: project,
      env: { ...process.env, PATH: `${fakeBin}${path.delimiter}${process.env.PATH}` },
    }));
    const targetId = listed.data.targets[0].targetId;
    await runCli([
      "--json",
      "--state-dir",
      stateDir,
      "target",
      "select",
      targetId,
      "--metro-port",
      String(metro.port),
    ], {
      cwd: project,
      env: { ...process.env, PATH: `${fakeBin}${path.delimiter}${process.env.PATH}` },
    });

    const snapshot = parseJson(await runCli([
      "--json",
      "--state-dir",
      stateDir,
      "snapshot",
      "--interactive",
      "--source",
      "--bounds",
    ], {
      cwd: project,
      env: { ...process.env, PATH: `${fakeBin}${path.delimiter}${process.env.PATH}` },
    }));

    assert.equal(snapshot.ok, true);
    assert.equal(snapshot.data.targetId, targetId);
    assert.deepEqual(snapshot.data.source, ["native-accessibility"]);
    assert.equal(snapshot.data.filters.interactiveOnly, true);
    assert.equal(snapshot.data.filters.includeSource, true);
    assert.equal(snapshot.data.filters.includeBounds, true);
    assert.equal(snapshot.data.refs.length, 1);
    assert.equal(snapshot.data.refs[0].ref, "@e1");
    assert.equal(snapshot.data.refs[0].role, "button");
    assert.equal(snapshot.data.refs[0].label, "Add customer");
    assert.equal(snapshot.data.refs[0].testID, "add-customer");
    assert.deepEqual(snapshot.data.refs[0].source, { file: "app/customers/index.tsx", line: 42, column: 7 });
    assert.deepEqual(snapshot.data.refs[0].box, { x: 20, y: 44, width: 160, height: 48 });
    assert.equal((await fs.stat(snapshot.data.artifacts.json)).isFile(), true);

    const refs = parseJson(await runCli(["--json", "--state-dir", stateDir, "refs"], { cwd: project }));
    assert.equal(refs.data.available, true);
    assert.equal(refs.data.refs[0].ref, "@e1");

    const source = parseJson(await runCli(["--json", "--state-dir", stateDir, "get", "source", "@e1"], { cwd: project }));
    assert.deepEqual(source.data, {
      ref: "@e1",
      field: "source",
      stale: false,
      value: { file: "app/customers/index.tsx", line: 42, column: 7 },
    });

    const missing = parseJson(await runCli(["--json", "--state-dir", stateDir, "get", "source", "@e9"], { cwd: project }));
    assert.deepEqual(missing.data, {
      available: false,
      reason: "Ref not found in the latest snapshot.",
      ref: "@e9",
    });
  } finally {
    await metro.close().catch(() => {});
  }
});

test("expo-ios snapshot and accessibility prefer plugin bridge semantics when available", async () => {
  const project = await fs.mkdtemp(path.join(os.tmpdir(), "expo-ios-semantic-bridge-"));
  const fakeBin = path.join(project, "bin");
  const stateDir = path.join(project, ".scratch", "expo-ios", "runs");
  await fs.mkdir(fakeBin, { recursive: true });
  await writeExecutable(path.join(fakeBin, "xcrun"), `#!/bin/sh
if [ "$1 $2 $3 $4 $5" = "simctl list devices available --json" ]; then
  cat <<'JSON'
{"devices":{"com.apple.CoreSimulator.SimRuntime.iOS-18-0":[{"name":"iPhone 15","udid":"SIM-1","state":"Booted","isAvailable":true}]}}
JSON
  exit 0
fi
echo "unexpected xcrun $*" >&2
exit 64
`);
  await writeExecutable(path.join(fakeBin, "axe"), `#!/bin/sh
if [ "$1" = "describe-ui" ]; then
  cat <<'JSON'
[{"role":"AXApplication","children":[{"role":"AXStaticText","AXLabel":"Native Customers","frame":{"x":8,"y":8,"width":120,"height":24}}]}]
JSON
  exit 0
fi
echo "unexpected axe $*" >&2
exit 64
`);
  const fake = await startFakeMetroHermes({ websocket: { semanticValue: fakeSemanticValue() } });
  const env = { ...process.env, PATH: `${fakeBin}${path.delimiter}${process.env.PATH}` };
  try {
    await runCli(["--json", "--state-dir", stateDir, "session", "new", "review"], { cwd: project });
    const listed = parseJson(await runCli([
      "--json",
      "--state-dir",
      stateDir,
      "target",
      "list",
      "--metro-port",
      String(fake.metroPort),
    ], { cwd: project, env }));
    const targetId = listed.data.targets[0].targetId;
    await runCli([
      "--json",
      "--state-dir",
      stateDir,
      "target",
      "select",
      targetId,
      "--metro-port",
      String(fake.metroPort),
    ], { cwd: project, env });

    const snapshot = parseJson(await runCli([
      "--json",
      "--state-dir",
      stateDir,
      "snapshot",
      "--interactive",
      "--source",
      "--bounds",
      "--metro-port",
      String(fake.metroPort),
    ], { cwd: project, env }));
    const refs = parseJson(await runCli(["--json", "--state-dir", stateDir, "refs"], { cwd: project }));
    const ax = parseJson(await runCli([
      "--json",
      "accessibility",
      "tree",
      "--metro-port",
      String(fake.metroPort),
    ], { cwd: project, env }));

    assert.deepEqual(snapshot.data.source, ["plugin-bridge-semantic"]);
    assert.equal(snapshot.data.routeHint, "/customers");
    assert.equal(snapshot.data.refs.length, 1);
    assert.equal(snapshot.data.refs[0].component, "AddCustomerButton");
    assert.equal(snapshot.data.refs[0].raw.token, "[redacted]");
    assert.equal(refs.data.source[0], "plugin-bridge-semantic");
    assert.equal(ax.data.semanticBridge.available, true);
    assert.deepEqual(ax.data.source, ["plugin-bridge-semantic", "native-accessibility"]);
    assert.deepEqual(fake.actions, ["semantic-snapshot", "semantic-snapshot"]);
  } finally {
    await fake.close();
  }
});

test("expo-ios refs reports when no snapshot cache exists", async () => {
  const project = await fs.mkdtemp(path.join(os.tmpdir(), "expo-ios-refs-missing-"));
  const stateDir = path.join(project, ".scratch", "expo-ios", "runs");
  await runCli(["--json", "--state-dir", stateDir, "session", "new", "review"], { cwd: project });

  const payload = parseJson(await runCli(["--json", "--state-dir", stateDir, "refs"], { cwd: project }));

  assert.deepEqual(payload.data, {
    available: false,
    reason: "No snapshot exists for the current session.",
  });
});

test("expo-ios find and ref tap dry-run use cached semantic refs", async () => {
  const fixture = await createSnapshotRefFixture();
  try {
    const found = parseJson(await runCli([
      "--json",
      "--state-dir",
      fixture.stateDir,
      "find",
      "role",
      "button",
      "--name",
      "Add",
    ], { cwd: fixture.project }));
    assert.equal(found.data.available, true);
    assert.equal(found.data.matches.length, 1);
    assert.equal(found.data.matches[0].ref, "@e1");

    const finderAction = parseJson(await runCli([
      "--json",
      "--state-dir",
      fixture.stateDir,
      "find",
      "role",
      "button",
      "--name",
      "Add",
      "tap",
    ], { cwd: fixture.project }));
    assert.equal(finderAction.data.actionResult.dryRun, true);
    assert.equal(finderAction.data.actionResult.plan.ref, "@e1");
    assert.equal(finderAction.data.actionResult.plan.action, "tap");

    const tap = parseJson(await runCli([
      "--json",
      "--state-dir",
      fixture.stateDir,
      "tap",
      "@e1",
      "--dry-run",
      "true",
    ], { cwd: fixture.project }));
    assert.deepEqual(tap.data.plan, {
      action: "tap",
      ref: "@e1",
      targetId: fixture.targetId,
      box: { x: 20, y: 44, width: 160, height: 48 },
      point: { x: 100, y: 68 },
    });
  } finally {
    await fixture.close();
  }
});

test("expo-ios ref actions reject stale and disabled refs with stable JSON", async () => {
  const fixture = await createSnapshotRefFixture();
  try {
    const cache = JSON.parse(await fs.readFile(fixture.refsPath, "utf8"));
    cache.refs[0].stale = true;
    await fs.writeFile(fixture.refsPath, `${JSON.stringify(cache, null, 2)}\n`);

    const stale = parseJson(await runCli([
      "--json",
      "--state-dir",
      fixture.stateDir,
      "tap",
      "@e1",
      "--dry-run",
      "true",
    ], { cwd: fixture.project }));
    assert.deepEqual(stale.data, {
      available: false,
      reason: "Ref is stale. Capture a new snapshot before acting.",
      ref: "@e1",
    });

    cache.refs[0].stale = false;
    cache.refs[0].actions = ["inspect"];
    await fs.writeFile(fixture.refsPath, `${JSON.stringify(cache, null, 2)}\n`);
    const disabled = parseJson(await runCli([
      "--json",
      "--state-dir",
      fixture.stateDir,
      "tap",
      "@e1",
      "--dry-run",
      "true",
    ], { cwd: fixture.project }));
    assert.deepEqual(disabled.data, {
      available: false,
      reason: "Action is not available for this ref.",
      ref: "@e1",
      action: "tap",
      availableActions: ["inspect"],
    });
  } finally {
    await fixture.close();
  }
});

test("expo-ios wait matches cached text and visible refs", async () => {
  const fixture = await createSnapshotRefFixture({ interactive: false });
  try {
    const text = parseJson(await runCli([
      "--json",
      "--state-dir",
      fixture.stateDir,
      "wait",
      "--text",
      "Customers",
      "--timeout-ms",
      "1",
    ], { cwd: fixture.project }));
    assert.equal(text.data.matched, true);
    assert.equal(text.data.predicate.kind, "text");
    assert.equal(text.data.ref.text ?? text.data.ref.label, "Customers");

    const visible = parseJson(await runCli([
      "--json",
      "--state-dir",
      fixture.stateDir,
      "wait",
      text.data.ref.ref,
      "--state",
      "visible",
    ], { cwd: fixture.project }));
    assert.equal(visible.data.matched, true);
    assert.equal(visible.data.predicate.kind, "ref-state");
    assert.equal(visible.data.ref.ref, text.data.ref.ref);

    const missing = parseJson(await runCli([
      "--json",
      "--state-dir",
      fixture.stateDir,
      "wait",
      "--text",
      "Invoices",
      "--timeout-ms",
      "1",
    ], { cwd: fixture.project }));
    assert.equal(missing.data.matched, false);
    assert.equal(missing.data.reason, "Timed out waiting for text.");
    assert.ok(missing.data.lastEvidence.refCount >= 2);
  } finally {
    await fixture.close();
  }
});

test("expo-ios wait reports stale ref state without acting", async () => {
  const fixture = await createSnapshotRefFixture();
  try {
    const cache = JSON.parse(await fs.readFile(fixture.refsPath, "utf8"));
    cache.refs[0].stale = true;
    await fs.writeFile(fixture.refsPath, `${JSON.stringify(cache, null, 2)}\n`);

    const payload = parseJson(await runCli([
      "--json",
      "--state-dir",
      fixture.stateDir,
      "wait",
      "@e1",
      "--state",
      "visible",
    ], { cwd: fixture.project }));

    assert.deepEqual(payload.data, {
      matched: false,
      reason: "Ref is stale. Capture a new snapshot before waiting on it.",
      ref: "@e1",
    });
  } finally {
    await fixture.close();
  }
});

test("expo-ios batch runs steps with shared session state and bails on failure", async () => {
  const fixture = await createSnapshotRefFixture({ interactive: false });
  try {
    const payload = parseJson(await runCli([
      "--json",
      "--state-dir",
      fixture.stateDir,
      "batch",
      JSON.stringify(["wait", "--text", "Customers"]),
      JSON.stringify(["get", "source", "@e1"]),
      JSON.stringify(["unknown-command"]),
      JSON.stringify(["get", "source", "@e2"]),
      "--bail",
      "true",
    ], { cwd: fixture.project }));

    assert.equal(payload.data.ok, false);
    assert.equal(payload.data.bail, true);
    assert.equal(payload.data.failureIndex, 2);
    assert.equal(payload.data.steps.length, 3);
    assert.equal(payload.data.steps[0].ok, true);
    assert.equal(payload.data.steps[0].data.matched, true);
    assert.equal(payload.data.steps[1].ok, true);
    assert.equal(payload.data.steps[1].data.ref, "@e1");
    assert.equal(payload.data.steps[2].ok, false);
    assert.match(payload.data.steps[2].error.message, /Unknown command/);
  } finally {
    await fixture.close();
  }
});

test("expo-ios screenshot annotate writes ref-bound image artifacts", async () => {
  const fixture = await createSnapshotRefFixture();
  const outputPath = path.join(fixture.project, "annotated-screen.png");
  try {
    const payload = parseJson(await runCli([
      "--json",
      "--state-dir",
      fixture.stateDir,
      "screenshot",
      "--annotate",
      "true",
      "--output-path",
      outputPath,
    ], { cwd: fixture.project, env: fixture.env }));

    assert.equal(payload.data.available, true);
    assert.equal(payload.data.annotated, true);
    assert.equal(payload.data.artifacts.screenshot, outputPath);
    assert.equal(await fs.readFile(outputPath, "utf8"), "fakepng");

    const labelMap = JSON.parse(await fs.readFile(payload.data.artifacts.labelMap, "utf8"));
    const overlay = await fs.readFile(payload.data.artifacts.annotatedImage, "utf8");
    assert.equal(labelMap.snapshotId, fixture.snapshot.data.snapshotId);
    assert.equal(labelMap.targetId, fixture.targetId);
    assert.equal(labelMap.labels.length, fixture.snapshot.data.refs.length);
    assert.ok(labelMap.labels.every((label) => label.snapshotId === labelMap.snapshotId));
    assert.ok(labelMap.labels.every((label) => label.targetId === labelMap.targetId));
    assert.ok(labelMap.labels.every((label) => label.box && Number.isFinite(label.box.x)));
    assert.match(overlay, /@e1/);
  } finally {
    await fixture.close();
  }
});

test("expo-ios screenshot annotate refuses to guess missing ref bounds", async () => {
  const fixture = await createSnapshotRefFixture();
  try {
    const cache = JSON.parse(await fs.readFile(fixture.refsPath, "utf8"));
    delete cache.refs[0].box;
    await fs.writeFile(fixture.refsPath, `${JSON.stringify(cache, null, 2)}\n`);

    const payload = parseJson(await runCli([
      "--json",
      "--state-dir",
      fixture.stateDir,
      "screenshot",
      "--annotate",
      "true",
      "--output-path",
      path.join(fixture.project, "missing-bounds.png"),
    ], { cwd: fixture.project, env: fixture.env }));

    assert.equal(payload.data.available, false);
    assert.equal(payload.data.reason, "Cannot annotate screenshot because one or more refs do not include bounds.");
    assert.deepEqual(payload.data.missingRefs, ["@e1"]);
  } finally {
    await fixture.close();
  }
});

test("expo-ios project-info reports Expo metadata from a fixture app", async () => {
  const project = await fs.mkdtemp(path.join(os.tmpdir(), "expo-ios-project-"));
  const nested = path.join(project, "app", "settings");
  await fs.mkdir(nested, { recursive: true });
  await fs.writeFile(path.join(project, "package-lock.json"), "{}");
  await fs.writeFile(path.join(project, "package.json"), JSON.stringify({
    scripts: { start: "expo start", ios: "expo run:ios" },
    dependencies: {
      expo: "^54.0.0",
      "react-native": "^0.83.0",
      "expo-router": "^6.0.0",
    },
  }));
  await fs.writeFile(path.join(project, "app.json"), JSON.stringify({
    expo: {
      name: "Fixture App",
      slug: "fixture-app",
      scheme: "fixture",
      ios: { bundleIdentifier: "com.example.fixture" },
      android: { package: "com.example.fixture" },
      extra: { eas: { projectId: "fixture-project-id" } },
    },
  }));

  const payload = parseJson(await runCli(["--json", "project-info", "--cwd", nested]));

  assert.equal(payload.ok, true);
  assert.equal(payload.data.cwd, nested);
  assert.equal(payload.data.projectRoot, project);
  assert.equal(payload.data.isExpoProject, true);
  assert.equal(payload.data.packageManager, "npm");
  assert.equal(payload.data.expoDependency, "^54.0.0");
  assert.equal(payload.data.reactNativeDependency, "^0.83.0");
  assert.equal(payload.data.expoRouterDependency, "^6.0.0");
  assert.deepEqual(payload.data.scripts, { start: "expo start", ios: "expo run:ios" });
  assert.deepEqual(payload.data.appConfig, {
    source: "app.json",
    name: "Fixture App",
    slug: "fixture-app",
    scheme: "fixture",
    iosBundleIdentifier: "com.example.fixture",
    androidPackage: "com.example.fixture",
    easProjectId: "fixture-project-id",
  });
});

test("expo-ios expo upstream-policy reports compatible direct and internal-reference upstream surfaces", async () => {
  const project = await fs.mkdtemp(path.join(os.tmpdir(), "expo-ios-upstream-compatible-"));
  await fs.writeFile(path.join(project, "package.json"), JSON.stringify({
    dependencies: {
      expo: "^54.0.0",
      "react-native": "0.81.4",
      metro: "^0.83.0",
      "@react-native/dev-middleware": "^0.81.4",
      "@rozenite/runtime": "^1.0.0",
    },
  }));

  const payload = parseJson(await runCli(["--json", "expo", "upstream-policy", "--cwd", project]));

  assert.equal(payload.ok, true);
  assert.equal(payload.data.action, "upstream-policy");
  assert.equal(payload.data.available, true);
  const report = payload.data.report;
  assert.equal(report.schemaVersion, 1);
  assert.ok(report.policy.categories.some((category) => category.id === "public-api" && category.mayImportDirectly === true));
  assert.ok(report.policy.categories.some((category) => category.id === "internal-reference-only" && category.requiresShim === true));

  const expo = report.dependencies.find((dependency) => dependency.id === "expo-public-api");
  const rn = report.dependencies.find((dependency) => dependency.id === "hermes-react-native-cdp");
  const devtools = report.dependencies.find((dependency) => dependency.id === "react-native-devtools");
  const rozenite = report.dependencies.find((dependency) => dependency.id === "rozenite-devtools-bridge");
  const expoCliInternals = report.dependencies.find((dependency) => dependency.id === "expo-cli-internals");

  assert.equal(expo.classification, "public-api");
  assert.equal(expo.usage, "direct-dependency");
  assert.equal(expo.compatibility.state, "compatible");
  assert.equal(rn.compatibility.state, "compatible");
  assert.equal(devtools.classification, "documented-unstable-api");
  assert.equal(devtools.usage, "internal-reference-only");
  assert.equal(rozenite.status, "present");
  assert.equal(expoCliInternals.classification, "internal-reference-only");
  assert.equal(expoCliInternals.status, "not-depended-on");
});

test("expo-ios project-info reports missing and mismatched upstream dependency classifications", async () => {
  const missingProject = await fs.mkdtemp(path.join(os.tmpdir(), "expo-ios-upstream-missing-"));
  await fs.writeFile(path.join(missingProject, "package.json"), JSON.stringify({
    dependencies: {
      expo: "^54.0.0",
    },
  }));
  const missing = parseJson(await runCli(["--json", "project-info", "--cwd", missingProject]));

  assert.equal(missing.ok, true);
  assert.ok(missing.data.upstreamDependencies.summary.missing.includes("hermes-react-native-cdp"));
  assert.ok(missing.data.upstreamDependencies.summary.missing.includes("rozenite-devtools-bridge"));
  const missingRn = missing.data.upstreamDependencies.dependencies.find((dependency) => dependency.id === "hermes-react-native-cdp");
  assert.equal(missingRn.status, "missing");
  assert.equal(missingRn.compatibility.state, "missing");

  const mismatchedProject = await fs.mkdtemp(path.join(os.tmpdir(), "expo-ios-upstream-mismatched-"));
  await fs.writeFile(path.join(mismatchedProject, "package.json"), JSON.stringify({
    dependencies: {
      expo: "^54.0.0",
      "react-native": "0.74.5",
    },
  }));
  const mismatched = parseJson(await runCli(["--json", "project-info", "--cwd", mismatchedProject]));
  const rn = mismatched.data.upstreamDependencies.dependencies.find((dependency) => dependency.id === "hermes-react-native-cdp");

  assert.equal(rn.status, "present");
  assert.equal(rn.compatibility.state, "mismatched");
  assert.ok(mismatched.data.upstreamDependencies.summary.mismatched.includes("hermes-react-native-cdp"));
});

test("expo-ios project-info reports a stable non-project shape", async () => {
  const project = await fs.mkdtemp(path.join(os.tmpdir(), "expo-ios-empty-project-"));

  const payload = parseJson(await runCli(["--json", "project-info", "--cwd", project]));

  assert.equal(payload.ok, true);
  assert.equal(payload.data.cwd, project);
  assert.equal(payload.data.isExpoProject, false);
  assert.match(payload.data.reason, /No package\.json found/);
});

test("expo-ios project-info reports monorepo package manager and dynamic app config summary", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "expo-ios-monorepo-"));
  const project = path.join(workspace, "apps", "mobile");
  await fs.mkdir(project, { recursive: true });
  await fs.writeFile(path.join(workspace, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
  await fs.writeFile(path.join(project, "package.json"), JSON.stringify({
    dependencies: {
      expo: "catalog:",
      "react-native": "catalog:",
      "expo-router": "catalog:",
    },
  }));
  await fs.writeFile(path.join(project, "app.config.ts"), `
export default () => ({
  name: "Dynamic Fixture",
  slug: "dynamic-fixture",
  scheme: "dynamic-fixture",
  userInterfaceStyle: "automatic",
  ios: { bundleIdentifier: "com.example.dynamic" },
  android: { package: "com.example.dynamic" },
  extra: { eas: { projectId: "dynamic-project-id" } },
});
`);

  const payload = parseJson(await runCli(["--json", "project-info", "--cwd", project]));

  assert.equal(payload.ok, true);
  assert.equal(payload.data.packageManager, "pnpm");
  assert.deepEqual(payload.data.appConfig, {
    source: "app.config.ts",
    name: "Dynamic Fixture",
    slug: "dynamic-fixture",
    scheme: "dynamic-fixture",
    iosBundleIdentifier: "com.example.dynamic",
    androidPackage: "com.example.dynamic",
    easProjectId: "dynamic-project-id",
    userInterfaceStyle: "automatic",
    dynamic: true,
  });
  assert.equal(payload.data.hasDynamicAppConfig, true);
});

test("expo-ios routes emits exact route metadata from an Expo Router fixture", async () => {
  const project = await fs.mkdtemp(path.join(os.tmpdir(), "expo-ios-cli-"));
  const sentinel = path.join(project, "route-evaluated");
  await fs.writeFile(path.join(project, "package.json"), JSON.stringify({ dependencies: { expo: "^54.0.0", "expo-router": "^6.0.0" } }));
  await fs.mkdir(path.join(project, "app", "customers"), { recursive: true });
  await fs.mkdir(path.join(project, "app", "docs"), { recursive: true });
  await fs.writeFile(path.join(project, "app", "index.tsx"), "export default function Home() { return null; }");
  await fs.writeFile(path.join(project, "app", "customers", "[id].tsx"), "export default function Customer() { return null; }");
  await fs.writeFile(path.join(project, "app", "docs", "[[slug]].tsx"), "export default function Doc() { return null; }");
  await fs.writeFile(path.join(project, "app", "[...missing].tsx"), `import fs from "node:fs"; fs.writeFileSync(${JSON.stringify(sentinel)}, "evaluated");`);
  await fs.writeFile(path.join(project, "app", "_layout.tsx"), "export default function Layout() { return null; }");
  await fs.writeFile(path.join(project, "app", "+not-found.tsx"), "export default function NotFound() { return null; }");

  const payload = parseJson(await runCli(["--json", "routes", "--cwd", project]));

  assert.equal(payload.ok, true);
  assert.deepEqual(payload.data.routes.map((route) => route.route), ["/", "/*missing", "/customers/:id", "/docs/:slug?"]);
  assert.deepEqual(payload.data.specialFiles.map((file) => file.kind).sort(), ["layout", "special"]);
  await assert.rejects(fs.access(sentinel));
});

test("expo-ios devices parses simulator and Android fixtures", async () => {
  const project = await fs.mkdtemp(path.join(os.tmpdir(), "expo-ios-devices-"));
  const fakeBin = path.join(project, "bin");
  await fs.mkdir(fakeBin, { recursive: true });
  await writeExecutable(path.join(fakeBin, "xcrun"), `#!/bin/sh
if [ "$1 $2 $3 $4 $5" = "simctl list devices available --json" ]; then
  cat <<'JSON'
{"devices":{"com.apple.CoreSimulator.SimRuntime.iOS-18-0":[{"name":"iPhone 16","udid":"SIM-2","state":"Shutdown","isAvailable":true},{"name":"iPhone 15","udid":"SIM-1","state":"Booted","isAvailable":true}]}}
JSON
  exit 0
fi
if [ "$1 $2 $3 $4 $5" = "devicectl list devices --json-output -" ]; then
  cat <<'JSON'
{"result":{"devices":[{"identifier":"PHONE-1","deviceProperties":{"name":"Pedro iPhone","platform":"iOS"},"hardwareProperties":{"marketingName":"iPhone 16 Pro"},"connectionProperties":{"transportType":"usb","pairingState":"paired"}}]}}
JSON
  exit 0
fi
echo "unexpected xcrun $*" >&2
exit 64
`);
  await writeExecutable(path.join(fakeBin, "adb"), `#!/bin/sh
if [ "$1 $2" = "devices -l" ]; then
  cat <<'TEXT'
List of devices attached
emulator-5554 device product:sdk_gphone model:sdk_gphone64_arm64 device:emu64
offline-1 offline transport_id:2
TEXT
  exit 0
fi
echo "unexpected adb $*" >&2
exit 64
`);

  const payload = parseJson(await runCli(["--json", "devices", "--platform", "all"], {
    cwd: project,
    env: { ...process.env, PATH: `${fakeBin}${path.delimiter}${process.env.PATH}` },
  }));

  assert.equal(payload.ok, true);
  assert.equal(payload.data.ios.ok, true);
  assert.deepEqual(payload.data.ios.value.map((device) => [device.udid, device.state]), [["SIM-1", "Booted"], ["SIM-2", "Shutdown"]]);
  assert.equal(payload.data.iosPhysical.ok, true);
  assert.equal(payload.data.iosPhysical.value[0].identifier, "PHONE-1");
  assert.equal(payload.data.android.ok, true);
  assert.deepEqual(payload.data.android.value.map((device) => [device.serial, device.state]), [["emulator-5554", "device"], ["offline-1", "offline"]]);
});

test("expo-ios app actions and screenshot return stable JSON with fixture tools", async () => {
  const project = await fs.mkdtemp(path.join(os.tmpdir(), "expo-ios-actions-"));
  const fakeBin = path.join(project, "bin");
  const screenshot = path.join(project, "screen.png");
  await fs.mkdir(fakeBin, { recursive: true });
  await writeExecutable(path.join(fakeBin, "xcrun"), `#!/bin/sh
if [ "$1 $2 $3 $4 $5" = "simctl list devices available --json" ]; then
  cat <<'JSON'
{"devices":{"com.apple.CoreSimulator.SimRuntime.iOS-18-0":[{"name":"iPhone 15","udid":"SIM-1","state":"Booted","isAvailable":true}]}}
JSON
  exit 0
fi
if [ "$1 $2" = "simctl boot" ]; then echo "booted $3"; exit 0; fi
if [ "$1 $2" = "simctl openurl" ]; then echo "opened $3 $4"; exit 0; fi
if [ "$1 $2" = "simctl launch" ]; then echo "launched $3 $4"; exit 0; fi
if [ "$1 $2" = "simctl io" ] && [ "$4" = "screenshot" ]; then printf 'fakepng' > "$5"; echo "screenshot $5"; exit 0; fi
echo "unexpected xcrun $*" >&2
exit 64
`);

  const boot = parseJson(await runCli(["--json", "boot-simulator", "--open-simulator", "false"], {
    cwd: project,
    env: { ...process.env, PATH: `${fakeBin}${path.delimiter}${process.env.PATH}` },
  }));
  const opened = parseJson(await runCli(["--json", "open-url", "fixture://customers/1"], {
    cwd: project,
    env: { ...process.env, PATH: `${fakeBin}${path.delimiter}${process.env.PATH}` },
  }));
  const launched = parseJson(await runCli(["--json", "launch-app", "--bundle-id", "com.example.fixture"], {
    cwd: project,
    env: { ...process.env, PATH: `${fakeBin}${path.delimiter}${process.env.PATH}` },
  }));
  const captured = parseJson(await runCli(["--json", "screenshot", "--output-path", screenshot], {
    cwd: project,
    env: { ...process.env, PATH: `${fakeBin}${path.delimiter}${process.env.PATH}` },
  }));

  assert.equal(boot.data.device.udid, "SIM-1");
  assert.equal(boot.data.openSimulator, false);
  assert.match(opened.data.stdout, /opened SIM-1 fixture:\/\/customers\/1/);
  assert.equal(launched.data.bundleId, "com.example.fixture");
  assert.match(launched.data.stdout, /launched SIM-1 com\.example\.fixture/);
  assert.equal(captured.data.outputPath, screenshot);
  assert.equal(await fs.readFile(screenshot, "utf8"), "fakepng");
});

test("expo-ios launch-app reports matching iOS crash reports as failed live evidence", async () => {
  const project = await fs.mkdtemp(path.join(os.tmpdir(), "expo-ios-launch-crash-"));
  const fakeBin = path.join(project, "bin");
  const reports = path.join(project, "DiagnosticReports");
  await fs.mkdir(fakeBin, { recursive: true });
  await fs.mkdir(reports, { recursive: true });
  await writeExecutable(path.join(fakeBin, "xcrun"), `#!/bin/sh
if [ "$1 $2 $3 $4 $5" = "simctl list devices available --json" ]; then
  cat <<'JSON'
{"devices":{"com.apple.CoreSimulator.SimRuntime.iOS-18-0":[{"name":"iPhone 15","udid":"SIM-1","state":"Booted","isAvailable":true}]}}
JSON
  exit 0
fi
if [ "$1 $2" = "simctl launch" ]; then
  cat > ${JSON.stringify(path.join(reports, "MaddieConsole-test.ips"))} <<'JSON'
{"app_name":"MaddieConsole","bundleID":"com.maddie.console","incident_id":"CRASH-1"}
{"exception":{"type":"EXC_BAD_ACCESS","signal":"SIGSEGV"}}
JSON
  echo "com.maddie.console: 1234"
  exit 0
fi
echo "unexpected xcrun $*" >&2
exit 64
`);

  const payload = parseJson(await runCli([
    "--json",
    "launch-app",
    "--device",
    "SIM-1",
    "--bundle-id",
    "com.maddie.console",
    "--crash-check-ms",
    "1",
  ], {
    cwd: project,
    env: {
      ...process.env,
      PATH: `${fakeBin}${path.delimiter}/usr/bin:/bin`,
      EXPO_IOS_DIAGNOSTIC_REPORTS_DIR: reports,
    },
  }));

  assert.equal(payload.data.available, false);
  assert.match(payload.data.reason, /generated 1 matching iOS crash report/);
  assert.equal(payload.data.crashCheck.reportCount, 1);
  assert.equal(payload.data.crashReports[0].bundleId, "com.maddie.console");
  assert.equal(payload.data.crashReports[0].incidentId, "CRASH-1");
});

test("expo-ios screenshot full captures and stitches real scroll segments when tooling is available", async () => {
  const project = await fs.mkdtemp(path.join(os.tmpdir(), "expo-ios-full-shot-"));
  const fakeBin = path.join(project, "bin");
  const screenshot = path.join(project, "full.png");
  await fs.mkdir(fakeBin, { recursive: true });
  await writeExecutable(path.join(fakeBin, "xcrun"), `#!/bin/sh
if [ "$1 $2 $3 $4 $5" = "simctl list devices available --json" ]; then
  cat <<'JSON'
{"devices":{"com.apple.CoreSimulator.SimRuntime.iOS-18-0":[{"name":"iPhone 15","udid":"SIM-1","state":"Booted","isAvailable":true}]}}
JSON
  exit 0
fi
if [ "$1 $2" = "simctl io" ] && [ "$4" = "screenshot" ]; then printf 'fakepng:%s\\n' "$5" > "$5"; echo "screenshot $5"; exit 0; fi
echo "unexpected xcrun $*" >&2
exit 64
`);
  await writeExecutable(path.join(fakeBin, "axe"), `#!/bin/sh
if [ "$1" = "swipe" ]; then echo "swiped $*"; exit 0; fi
echo "unexpected axe $*" >&2
exit 64
`);
  await writeExecutable(path.join(fakeBin, "magick"), `#!/bin/sh
if [ "$1" = "identify" ]; then echo "390 844"; exit 0; fi
last=""
for arg do last="$arg"; done
: > "$last"
for arg do
  if [ "$arg" = "-append" ]; then break; fi
  cat "$arg" >> "$last"
done
exit 0
`);

  const payload = parseJson(await runCli([
    "--json",
    "screenshot",
    "--full",
    "true",
    "--full-segments",
    "2",
    "--output-path",
    screenshot,
  ], {
    cwd: project,
    env: { ...process.env, PATH: `${fakeBin}${path.delimiter}/usr/bin:/bin` },
  }));

  assert.equal(payload.data.available, true);
  assert.equal(payload.data.mode, "full");
  assert.equal(payload.data.strategy, "segmented-scroll-stitch");
  assert.equal(payload.data.outputPath, screenshot);
  assert.equal(payload.data.segments.length, 2);
  assert.match(await fs.readFile(screenshot, "utf8"), /segment-000\.png/);
  assert.match(await fs.readFile(screenshot, "utf8"), /segment-001\.png/);
});

test("expo-ios tap reports an iOS setup hint when coordinate tooling is unavailable", async () => {
  const project = await fs.mkdtemp(path.join(os.tmpdir(), "expo-ios-tap-"));
  const fakeBin = path.join(project, "bin");
  await fs.mkdir(fakeBin, { recursive: true });

  const result = await runCli(["--json", "tap", "--x", "12", "--y", "34"], {
    cwd: project,
    env: { ...process.env, PATH: `${fakeBin}${path.delimiter}/usr/bin:/bin` },
  });

  assert.equal(result.code, 1);
  const payload = JSON.parse(result.stderr);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, "runtime_failure");
  assert.match(payload.error.message, /iOS coordinate taps require the idb or axe CLI/);
});

test("expo-ios coordinate tap uses axe when idb is unavailable", async () => {
  const project = await fs.mkdtemp(path.join(os.tmpdir(), "expo-ios-tap-axe-"));
  const fakeBin = path.join(project, "bin");
  const sentinel = path.join(project, "axe-args.txt");
  await fs.mkdir(fakeBin, { recursive: true });
  await writeExecutable(path.join(fakeBin, "xcrun"), `#!/bin/sh
if [ "$1 $2 $3 $4 $5" = "simctl list devices available --json" ]; then
  cat <<'JSON'
{"devices":{"com.apple.CoreSimulator.SimRuntime.iOS-18-0":[{"name":"iPhone 15","udid":"SIM-1","state":"Booted","isAvailable":true}]}}
JSON
  exit 0
fi
echo "unexpected xcrun $*" >&2
exit 64
`);
  await writeExecutable(path.join(fakeBin, "axe"), `#!/bin/sh
echo "$@" > ${JSON.stringify(sentinel)}
echo "axe tapped"
`);

  const payload = parseJson(await runCli(["--json", "tap", "--x", "12", "--y", "34"], {
    cwd: project,
    env: { ...process.env, PATH: `${fakeBin}${path.delimiter}/usr/bin:/bin` },
  }));

  assert.equal(payload.data.tool, "axe");
  assert.equal(payload.data.device.udid, "SIM-1");
  assert.equal(payload.data.stdout.trim(), "axe tapped");
  assert.equal(await fs.readFile(sentinel, "utf8"), "tap -x 12 -y 34 --udid SIM-1\n");
});

test("expo-ios coordinate tap dry-run does not require device tooling", async () => {
  const project = await fs.mkdtemp(path.join(os.tmpdir(), "expo-ios-tap-dry-run-"));
  const fakeBin = path.join(project, "bin");
  await fs.mkdir(fakeBin, { recursive: true });

  const payload = parseJson(await runCli([
    "--json",
    "tap",
    "--x",
    "12",
    "--y",
    "34",
    "--dry-run",
    "true",
  ], {
    cwd: project,
    env: { ...process.env, PATH: `${fakeBin}${path.delimiter}/usr/bin:/bin` },
  }));

  assert.equal(payload.data.available, true);
  assert.equal(payload.data.dryRun, true);
  assert.deepEqual(payload.data.point, { x: 12, y: 34 });
  assert.deepEqual(payload.data.command, ["idb", "ui", "tap", "12", "34", "--udid", "<booted-device>"]);
});

test("expo-ios logs returns bounded evidence when native log collection fails", async () => {
  const project = await fs.mkdtemp(path.join(os.tmpdir(), "expo-ios-logs-"));
  const fakeBin = path.join(project, "bin");
  await fs.mkdir(fakeBin, { recursive: true });
  await writeExecutable(path.join(fakeBin, "xcrun"), `#!/bin/sh
if [ "$1 $2 $3 $4 $5" = "simctl list devices available --json" ]; then
  cat <<'JSON'
{"devices":{"com.apple.CoreSimulator.SimRuntime.iOS-18-0":[{"name":"iPhone 15","udid":"SIM-1","state":"Booted","isAvailable":true}]}}
JSON
  exit 0
fi
if [ "$1 $2 $3 $4" = "simctl spawn SIM-1 log" ]; then
  echo "log database unavailable" >&2
  exit 65
fi
echo "unexpected xcrun $*" >&2
exit 64
`);

  const payload = parseJson(await runCli(["--json", "logs", "--bundle-id", "com.example.fixture", "--last", "30s"], {
    cwd: project,
    env: { ...process.env, PATH: `${fakeBin}${path.delimiter}${process.env.PATH}` },
  }));

  assert.equal(payload.ok, true);
  assert.equal(payload.data.platform, "ios");
  assert.equal(payload.data.device.udid, "SIM-1");
  assert.match(payload.data.stderr, /log database unavailable/);
});

test("expo-ios ux-context degrades unavailable evidence per probe", async () => {
  const project = await fs.mkdtemp(path.join(os.tmpdir(), "expo-ios-ux-context-"));
  const fakeBin = path.join(project, "bin");
  await fs.mkdir(fakeBin, { recursive: true });
  await fs.writeFile(path.join(project, "package.json"), JSON.stringify({ dependencies: { expo: "^54.0.0" } }));
  await fs.writeFile(path.join(project, "app.json"), JSON.stringify({
    expo: { name: "Fixture", slug: "fixture", ios: { bundleIdentifier: "com.example.fixture" } },
  }));
  await writeExecutable(path.join(fakeBin, "xcrun"), `#!/bin/sh
if [ "$1 $2 $3 $4 $5" = "simctl list devices available --json" ]; then
  cat <<'JSON'
{"devices":{"com.apple.CoreSimulator.SimRuntime.iOS-18-0":[{"name":"iPhone 15","udid":"SIM-1","state":"Booted","isAvailable":true}]}}
JSON
  exit 0
fi
if [ "$1 $2 $3 $4" = "simctl get_app_container SIM-1 com.example.fixture" ]; then
  echo "container unavailable" >&2
  exit 65
fi
if [ "$1 $2" = "simctl io" ] && [ "$4" = "screenshot" ]; then
  echo "screenshot unavailable" >&2
  exit 65
fi
if [ "$1 $2 $3 $4" = "simctl spawn SIM-1 log" ]; then
  echo "log unavailable" >&2
  exit 65
fi
echo "unexpected xcrun $*" >&2
exit 64
`);

  const payload = parseJson(await runCli([
    "--json",
    "ux-context",
    "--cwd",
    project,
    "--metro-port",
    "9",
    "--include-logs",
    "true",
  ], {
    cwd: project,
    env: { ...process.env, PATH: `${fakeBin}${path.delimiter}/usr/bin:/bin` },
  }));

  assert.equal(payload.ok, true);
  assert.match(payload.data.metro.status, /unavailable/i);
  assert.equal(payload.data.runtime.available, false);
  assert.equal(payload.data.screenshot.error.code, 65);
  assert.equal(payload.data.visualAnalysis.ok, false);
  assert.equal(payload.data.hierarchy.available, false);
  assert.equal(payload.data.logs.error.code, 65);
  assert.equal(payload.data.routes.routeCount, 0);
});

test("expo-ios trace preserves unavailable JSON contract", async () => {
  const payload = parseJson(await runCli(["--json", "trace", "--action", "read", "--metro-port", "9"]));

  assert.deepEqual(payload, {
    ok: true,
    data: {
      available: false,
      action: "read",
      reason: "No Metro inspector target.",
      metroPort: 9,
      limitations: [
        "No Hermes Runtime.evaluate trace was collected.",
        "React commits, layout changes, animation frames, and handler-bearing components are unavailable for this read.",
      ],
    },
  });
});

test("expo-ios inspector preserves unavailable JSON contract", async () => {
  const payload = parseJson(await runCli(["--json", "inspector", "probe", "--metro-port", "9"]));

  assert.deepEqual(payload, {
    ok: true,
    data: {
      available: false,
      action: "probe",
      reason: "No Metro inspector target.",
      metroPort: 9,
    },
  });
});

test("expo-ios open-dev-menu uses Expo Metro message socket before simulator shake", async () => {
  const fake = await startFakeMetroMessageSocket();
  try {
    const payload = parseJson(await runCli([
      "--json",
      "open-dev-menu",
      "--metro-port",
      String(fake.port),
    ]));

    assert.equal(payload.ok, true);
    assert.equal(payload.data.available, true);
    assert.equal(payload.data.transport, "metro-message-socket");
    assert.equal(payload.data.messageSocket.connectedPeerCount, 1);
    assert.deepEqual(fake.messages, ["devMenu"]);
  } finally {
    await fake.close();
  }
});

test("expo-ios open-dev-menu can reconnect an Expo dev client before broadcasting", async () => {
  const project = await fs.mkdtemp(path.join(os.tmpdir(), "expo-ios-devmenu-reconnect-"));
  const fakeBin = path.join(project, "bin");
  const opened = path.join(project, "opened.txt");
  await fs.mkdir(fakeBin, { recursive: true });
  await writeExecutable(path.join(fakeBin, "xcrun"), `#!/bin/sh
if [ "$1 $2 $3 $4 $5" = "simctl list devices available --json" ]; then
  cat <<'JSON'
{"devices":{"com.apple.CoreSimulator.SimRuntime.iOS-18-0":[{"name":"iPhone 15","udid":"SIM-1","state":"Booted","isAvailable":true}]}}
JSON
  exit 0
fi
if [ "$1 $2" = "simctl terminate" ]; then echo "terminated $3 $4"; exit 0; fi
if [ "$1 $2" = "simctl openurl" ]; then echo "$4" > ${JSON.stringify(opened)}; exit 0; fi
echo "unexpected xcrun $*" >&2
exit 64
`);
  const fake = await startFakeMetroMessageSocket({ peerCounts: [0, 1, 1] });
  try {
    const payload = parseJson(await runCli([
      "--json",
      "open-dev-menu",
      "--metro-port",
      String(fake.port),
      "--device",
      "SIM-1",
      "--bundle-id",
      "com.example.fixture",
      "--dev-client-url",
      "exp+fixture://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A8081",
      "--restart-dev-client",
      "true",
    ], {
      cwd: project,
      env: { ...process.env, PATH: `${fakeBin}${path.delimiter}/usr/bin:/bin` },
    }));

    assert.equal(payload.ok, true);
    assert.equal(payload.data.available, true);
    assert.equal(payload.data.transport, "metro-message-socket");
    assert.equal(payload.data.devClientRepair.available, true);
    assert.match(await fs.readFile(opened, "utf8"), /exp\+fixture/);
    assert.deepEqual(fake.messages, ["devMenu"]);
  } finally {
    await fake.close();
  }
});

test("expo-ios open-dev-menu records no-peer and timeout message socket fallbacks", async () => {
  for (const mode of ["no-peer", "timeout"]) {
    const project = await fs.mkdtemp(path.join(os.tmpdir(), `expo-ios-devmenu-${mode}-`));
    const fakeBin = path.join(project, "bin");
    await fs.mkdir(fakeBin, { recursive: true });
    await writeExecutable(path.join(fakeBin, "xcrun"), `#!/bin/sh
if [ "$1 $2 $3 $4 $5" = "simctl list devices available --json" ]; then
  cat <<'JSON'
{"devices":{"com.apple.CoreSimulator.SimRuntime.iOS-18-0":[{"name":"iPhone 15","udid":"SIM-1","state":"Booted","isAvailable":true}]}}
JSON
  exit 0
fi
if [ "$1 $2 $3" = "simctl io SIM-1" ]; then echo "shake"; exit 0; fi
echo "unexpected xcrun $*" >&2
exit 64
`);
    const fake = await startFakeMetroMessageSocket(mode === "timeout" ? { timeoutGetPeers: true } : { peerCounts: [0] });
    try {
      const payload = parseJson(await runCli([
        "--json",
        "open-dev-menu",
        "--metro-port",
        String(fake.port),
        "--device",
        "SIM-1",
      ], {
        cwd: project,
        env: { ...process.env, PATH: `${fakeBin}${path.delimiter}/usr/bin:/bin` },
      }));

      assert.equal(payload.data.available, true);
      assert.equal(payload.data.messageSocket.available, false);
      assert.match(payload.data.messageSocket.reason, mode === "timeout" ? /getpeers timed out/ : /No connected app peers/);
      assert.deepEqual(payload.data.command, ["xcrun", "simctl", "io", "SIM-1", "shake"]);
    } finally {
      await fake.close();
    }
  }
});

test("expo-ios open-dev-menu reports dev-client reconnect crash evidence", async () => {
  const project = await fs.mkdtemp(path.join(os.tmpdir(), "expo-ios-devmenu-crash-"));
  const fakeBin = path.join(project, "bin");
  const reports = path.join(project, "DiagnosticReports");
  await fs.mkdir(fakeBin, { recursive: true });
  await fs.mkdir(reports, { recursive: true });
  await writeExecutable(path.join(fakeBin, "xcrun"), `#!/bin/sh
if [ "$1 $2 $3 $4 $5" = "simctl list devices available --json" ]; then
  cat <<'JSON'
{"devices":{"com.apple.CoreSimulator.SimRuntime.iOS-18-0":[{"name":"iPhone 15","udid":"SIM-1","state":"Booted","isAvailable":true}]}}
JSON
  exit 0
fi
if [ "$1 $2" = "simctl openurl" ]; then
  cat > ${JSON.stringify(path.join(reports, "MaddieConsole-devclient.ips"))} <<'JSON'
{"app_name":"MaddieConsole","bundleID":"com.maddie.console","incident_id":"DEVCLIENT-CRASH"}
{"exception":{"type":"EXC_BAD_ACCESS","signal":"SIGSEGV"}}
JSON
  echo "$4"
  exit 0
fi
echo "unexpected xcrun $*" >&2
exit 64
`);
  const fake = await startFakeMetroMessageSocket({ peerCounts: [0, 1] });
  try {
    const payload = parseJson(await runCli([
      "--json",
      "open-dev-menu",
      "--metro-port",
      String(fake.port),
      "--device",
      "SIM-1",
      "--bundle-id",
      "com.maddie.console",
      "--dev-client-url",
      "exp+maddie://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A8081",
      "--crash-check-ms",
      "1",
    ], {
      cwd: project,
      env: {
        ...process.env,
        PATH: `${fakeBin}${path.delimiter}/usr/bin:/bin`,
        EXPO_IOS_DIAGNOSTIC_REPORTS_DIR: reports,
        EXPO_IOS_DEV_CLIENT_RECONNECT_TIMEOUT_MS: "100",
      },
    }));

    assert.equal(payload.data.available, false);
    assert.match(payload.data.reason, /generated an iOS crash report/);
    assert.equal(payload.data.devClientRepair.crashCheck.reportCount, 1);
    assert.equal(payload.data.devClientRepair.crashReports[0].incidentId, "DEVCLIENT-CRASH");
  } finally {
    await fake.close();
  }
});

test("expo-ios devtools capabilities reports unavailable structured sources", async () => {
  const payload = parseJson(await runCli(["--json", "devtools", "capabilities", "--metro-port", "9"]));

  assert.equal(payload.ok, true);
  assert.equal(payload.data.action, "capabilities");
  assert.equal(payload.data.metro.status, "unavailable");
  const metro = payload.data.capabilities.find((capability) => capability.name === "metro-http");
  const runtime = payload.data.capabilities.find((capability) => capability.name === "hermes-runtime");
  assert.equal(metro.available, false);
  assert.equal(metro.transport, "http");
  assert.ok(metro.limitations.length > 0);
  assert.equal(runtime.available, false);
  assert.equal(runtime.transport, "websocket");
  assert.match(runtime.reason, /No Metro inspector target/);
});

test("expo-ios devtools panels reports React Native DevTools network panel capability", async () => {
  const metro = await startFakeTargetMetro([
    {
      id: "metro-devtools",
      title: "Fixture App",
      appId: "fake.app",
      deviceName: "iPhone 15",
      description: "Hermes target",
      devtoolsFrontendUrl: "/debugger-frontend/rn_fusebox.html?unstable_enableNetworkPanel=true",
      webSocketDebuggerUrl: "ws://127.0.0.1:65530/inspector",
    },
  ]);
  try {
    const payload = parseJson(await runCli([
      "--json",
      "devtools",
      "panels",
      "--metro-port",
      String(metro.port),
    ]));
    const network = payload.data.panels.find((panel) => panel.name === "network");
    assert.equal(network.available, true);
    assert.equal(network.transport, "react-native-devtools");
  } finally {
    await metro.close();
  }
});

test("expo-ios devtools status distinguishes human panels machine domains and attachment risk", async () => {
  const metro = await startFakeTargetMetro([
    {
      id: "metro-devtools-human",
      title: "Fixture App",
      appId: "fake.app",
      deviceName: "iPhone 15",
      description: "RN DevTools target",
      devtoolsFrontendUrl: "/debugger-frontend/rn_fusebox.html",
      reactNative: { debuggerFrontendConnected: true },
    },
  ]);
  try {
    const payload = parseJson(await runCli([
      "--json",
      "devtools",
      "status",
      "--metro-port",
      String(metro.port),
    ]));

    assert.equal(payload.data.frontend.available, true);
    assert.equal(payload.data.attachmentState.state, "attached");
    assert.equal(payload.data.attachmentRisk.mayDetachHumanDebugger, true);
    const debuggerPanel = payload.data.humanVisiblePanels.find((panel) => panel.name === "debugger");
    const consoleDomain = payload.data.machineReadableDomains.find((panel) => panel.name === "console");
    assert.equal(debuggerPanel.humanVisible, true);
    assert.equal(debuggerPanel.machineReadable, false);
    assert.equal(consoleDomain.machineReadable, true);
    assert.equal(consoleDomain.available, false);
  } finally {
    await metro.close();
  }
});

test("expo-ios devtools capabilities include command artifacts and repair metadata", async () => {
  const metro = await startFakeTargetMetro([
    {
      id: "metro-devtools-machine",
      title: "Fixture App",
      appId: "fake.app",
      deviceName: "iPhone 15",
      description: "Hermes target",
      devtoolsFrontendUrl: "/debugger-frontend/rn_fusebox.html?unstable_enableNetworkPanel=true",
      webSocketDebuggerUrl: "ws://127.0.0.1:65530/inspector",
      reactNative: { debuggerFrontendConnected: false },
    },
  ]);
  try {
    const payload = parseJson(await runCli([
      "--json",
      "devtools",
      "capabilities",
      "--metro-port",
      String(metro.port),
    ]));

    const devtools = payload.data.capabilities.find((capability) => capability.name === "react-native-devtools");
    const hermes = payload.data.capabilities.find((capability) => capability.name === "hermes-runtime");
    const network = payload.data.capabilities.find((capability) => capability.name === "react-native-devtools-network-panel");
    assert.equal(payload.data.reactNativeDevTools.attachmentState.state, "not-attached");
    for (const capability of [devtools, hermes, network]) {
      assert.ok(Array.isArray(capability.readCommands));
      assert.ok(Array.isArray(capability.writeCommands));
      assert.ok(Array.isArray(capability.artifactTypes));
      assert.ok(Array.isArray(capability.repairHints));
      assert.equal(typeof capability.source, "string");
    }
    assert.equal(network.available, true);
    assert.ok(network.artifactTypes.includes("human-visible-panel"));
  } finally {
    await metro.close();
  }
});

test("expo-ios devtools open reports open failures without hiding launch risk", async () => {
  const project = await fs.mkdtemp(path.join(os.tmpdir(), "expo-ios-devtools-open-"));
  const fakeBin = path.join(project, "bin");
  await fs.mkdir(fakeBin, { recursive: true });
  await writeExecutable(path.join(fakeBin, "open"), `#!/bin/sh\necho "cannot open $1" >&2\nexit 42\n`);
  const metro = await startFakeTargetMetro([
    {
      id: "metro-devtools-open",
      title: "Fixture App",
      appId: "fake.app",
      deviceName: "iPhone 15",
      devtoolsFrontendUrl: "/debugger-frontend/rn_fusebox.html",
      webSocketDebuggerUrl: "ws://127.0.0.1:65530/inspector",
    },
  ]);
  try {
    const payload = parseJson(await runCli([
      "--json",
      "devtools",
      "open",
      "--metro-port",
      String(metro.port),
    ], {
      cwd: project,
      env: { ...process.env, PATH: `${fakeBin}${path.delimiter}/usr/bin:/bin` },
    }));

    assert.equal(payload.data.available, false);
    assert.equal(payload.data.launchPath, "metro-devtools-frontend-url");
    assert.equal(payload.data.mirrorsUpstreamLaunch, true);
    assert.equal(payload.data.attachmentRisk.mayDetachHumanDebugger, true);
    assert.match(payload.data.stderr, /cannot open/);
  } finally {
    await metro.close();
  }
});

test("expo-ios metro status reports targets and symbolication without starting Metro", async () => {
  const fake = await startFakeMetroHermes();
  try {
    const payload = parseJson(await runCli([
      "--json",
      "metro",
      "status",
      "--metro-port",
      String(fake.metroPort),
    ]));

    assert.equal(payload.ok, true);
    assert.equal(payload.data.available, true);
    assert.equal(payload.data.status, "available");
    assert.equal(payload.data.statusText, "packager-status:running");
    assert.equal(payload.data.targetCount, 1);
    assert.equal(payload.data.targets[0].appId, "fake.app");
    assert.equal(payload.data.symbolication.available, true);
    assert.match(payload.data.limitations.join(" "), /never starts Metro/);
  } finally {
    await fake.close();
  }
});

test("expo-ios metro status accepts IPv6 loopback Metro bindings", async () => {
  const fake = await startFakeMetroHermes({ host: "::1" });
  try {
    const payload = parseJson(await runCli([
      "--json",
      "metro",
      "status",
      "--metro-port",
      String(fake.metroPort),
    ]));

    assert.equal(payload.ok, true);
    assert.equal(payload.data.available, true);
    assert.equal(payload.data.statusText, "packager-status:running");
    assert.equal(payload.data.targetCount, 1);
    assert.equal(payload.data.symbolication.available, true);
  } finally {
    await fake.close();
  }
});

test("expo-ios metro status normalizes multiple malformed and symbolication-failed targets", async () => {
  const metro = await startFakeTargetMetro([
    {
      id: "target-1",
      title: "Fixture One",
      appId: "app.one",
      deviceName: "iPhone 15",
      webSocketDebuggerUrl: "ws://127.0.0.1:65530/one",
    },
    "not-a-target",
    {
      id: "target-2",
      title: "Fixture Two",
      appId: "app.two",
      deviceName: "iPhone 16",
      devtoolsFrontendUrl: "/debugger-frontend/rn_fusebox.html",
    },
  ], { symbolicateStatus: 500 });
  try {
    const payload = parseJson(await runCli([
      "--json",
      "metro",
      "status",
      "--metro-port",
      String(metro.port),
    ]));

    assert.equal(payload.data.available, true);
    assert.equal(payload.data.targetCount, 2);
    assert.equal(payload.data.targets[0].capabilities.hermesRuntime, true);
    assert.equal(payload.data.targets[1].capabilities.devtoolsFrontend, true);
    assert.equal(payload.data.targetDiscovery.available, true);
    assert.equal(payload.data.targetDiscovery.malformedTargets.length, 1);
    assert.equal(payload.data.symbolication.available, false);
    assert.equal(payload.data.symbolication.status, 500);
  } finally {
    await metro.close();
  }
});

test("expo-ios metro status reports malformed and unavailable discovery with stable JSON", async () => {
  const malformed = await startFakeTargetMetro({ not: "an-array" });
  try {
    const payload = parseJson(await runCli([
      "--json",
      "metro",
      "status",
      "--metro-port",
      String(malformed.port),
    ]));

    assert.equal(payload.data.available, true);
    assert.equal(payload.data.targetCount, 0);
    assert.equal(payload.data.targetDiscovery.available, false);
    assert.match(payload.data.targetDiscovery.reason, /malformed/);
  } finally {
    await malformed.close();
  }

  const unavailable = parseJson(await runCli([
    "--json",
    "metro",
    "status",
    "--metro-port",
    "9",
  ]));

  assert.equal(unavailable.data.available, false);
  assert.equal(unavailable.data.status, "unavailable");
  assert.equal(unavailable.data.targetDiscovery.available, false);
  assert.equal(unavailable.data.symbolication.available, false);
});

test("expo-ios console and errors read bounded runtime diagnostics", async () => {
  const fake = await startFakeMetroHermes();
  try {
    const logs = parseJson(await runCli([
      "--json",
      "console",
      "--limit",
      "1",
      "--metro-port",
      String(fake.metroPort),
    ]));
    const errors = parseJson(await runCli([
      "--json",
      "errors",
      "--limit",
      "1",
      "--metro-port",
      String(fake.metroPort),
    ]));

    assert.equal(logs.data.available, true);
    assert.equal(logs.data.kind, "console");
    assert.equal(logs.data.limit, 1);
    assert.deepEqual(logs.data.messages, [{ level: "warn", message: "Slow render" }]);
    assert.equal(errors.data.available, true);
    assert.equal(errors.data.kind, "errors");
    assert.deepEqual(errors.data.messages, [{ level: "error", message: "Unhandled promise rejection" }]);
    assert.deepEqual(fake.actions, ["console", "errors"]);
  } finally {
    await fake.close();
  }
});

test("expo-ios console reports bounded CDP diagnostics for protocol errors invalid JSON closes and timeouts", async () => {
  const protocol = await startFakeMetroHermes({ websocket: { protocolError: true, invalidJsonAfterEnable: true } });
  try {
    const payload = parseJson(await runCli([
      "--json",
      "console",
      "--metro-port",
      String(protocol.metroPort),
    ]));

    assert.equal(payload.data.available, false);
    assert.match(payload.data.reason, /Fixture protocol failure/);
    assert.equal(payload.data.cdp.transport, "cdp-websocket");
    assert.ok(payload.data.cdp.calls.some((call) => call.method === "Runtime.evaluate" && call.status === "protocol-error"));
    assert.equal(payload.data.cdp.invalidMessages.length, 1);
  } finally {
    await protocol.close();
  }

  const closed = await startFakeMetroHermes({ websocket: { closeOnEvaluate: true } });
  try {
    const payload = parseJson(await runCli([
      "--json",
      "console",
      "--metro-port",
      String(closed.metroPort),
    ]));

    assert.equal(payload.data.available, false);
    assert.match(payload.data.reason, /closed before Runtime\.evaluate completed/);
    assert.ok(payload.data.cdp.calls.some((call) => call.status === "protocol-error" || call.status === "closed"));
  } finally {
    await closed.close();
  }

  const timeout = await startFakeMetroHermes({ websocket: { timeoutEvaluate: true } });
  try {
    const payload = parseJson(await runCli([
      "--json",
      "console",
      "--metro-port",
      String(timeout.metroPort),
    ]));

    assert.equal(payload.data.available, false);
    assert.match(payload.data.reason, /Runtime\.evaluate timed out/);
    assert.ok(payload.data.cdp.calls.some((call) => call.method === "Runtime.evaluate" && call.status === "timeout"));
  } finally {
    await timeout.close();
  }
});

test("expo-ios ux-context exercises concurrent CDP calls and event capture", async () => {
  const fake = await startFakeMetroHermes({ websocket: { emitScriptParsed: true } });
  try {
    const payload = parseJson(await runCli([
      "--json",
      "ux-context",
      "--metro-port",
      String(fake.metroPort),
      "--include-screenshot",
      "false",
      "--include-hierarchy",
      "false",
      "--include-logs",
      "false",
    ]));

    assert.equal(payload.data.runtime.available, true);
    assert.ok(payload.data.runtime.cdp.calls.some((call) => call.method === "Runtime.getHeapUsage" && call.status === "ok"));
    assert.ok(payload.data.runtime.cdp.events.some((event) => event.method === "Debugger.scriptParsed"));
    assert.equal(fake.maxConcurrentEvaluate, 2);
  } finally {
    await fake.close();
  }
});

test("expo-ios navigation reads bridge state and executes bridge actions", async () => {
  const fake = await startFakeMetroHermes();
  const project = await fs.mkdtemp(path.join(os.tmpdir(), "expo-ios-navigation-policy-"));
  const policyPath = path.join(project, "policy.json");
  await fs.writeFile(policyPath, JSON.stringify({
    allow: ["navigation.back", "navigation.pop-to-root", "navigation.tab"],
  }));
  try {
    const state = parseJson(await runCli([
      "--json",
      "navigation",
      "state",
      "--metro-port",
      String(fake.metroPort),
    ]));
    const denied = parseJson(await runCli([
      "--json",
      "navigation",
      "back",
      "--metro-port",
      String(fake.metroPort),
    ]));
    const back = parseJson(await runCli([
      "--json",
      "--action-policy",
      policyPath,
      "navigation",
      "back",
      "--metro-port",
      String(fake.metroPort),
    ]));
    const pop = parseJson(await runCli([
      "--json",
      "--action-policy",
      policyPath,
      "navigation",
      "pop-to-root",
      "--metro-port",
      String(fake.metroPort),
    ]));
    const tab = parseJson(await runCli([
      "--json",
      "--action-policy",
      policyPath,
      "navigation",
      "tab",
      "settings",
      "--metro-port",
      String(fake.metroPort),
    ]));

    assert.equal(state.data.available, true);
    assert.equal(state.data.source, "plugin-bridge");
    assert.equal(state.data.evidenceSource, "plugin-bridge");
    assert.equal(state.data.transport.name, "metro-inspector-hermes-cdp");
    assert.equal(state.data.state.route, "/customers");
    assert.equal(state.data.policy.sideEffect, "read");
    assert.equal(denied.data.available, false);
    assert.equal(denied.data.policy.allowed, false);
    assert.match(denied.data.reason, /No action policy/);
    assert.equal(back.data.result.action, "back");
    assert.equal(pop.data.result.action, "pop-to-root");
    assert.equal(tab.data.tab, "settings");
    assert.equal(tab.data.policy.sideEffect, "device");
    assert.equal(tab.data.policy.allowed, true);
    assert.deepEqual(fake.actions, ["state", "back", "pop-to-root", "tab"]);
  } finally {
    await fake.close();
  }
});

test("expo-ios navigation reports unavailable state without a runtime bridge", async () => {
  const payload = parseJson(await runCli(["--json", "navigation", "state", "--metro-port", "9"]));

  assert.equal(payload.ok, true);
  assert.equal(payload.data.available, false);
  assert.equal(payload.data.action, "state");
  assert.equal(payload.data.source, "app-instrumentation");
  assert.equal(payload.data.evidenceSource, "unavailable");
  assert.equal(payload.data.reason, "No Metro inspector target.");
  assert.ok(payload.data.limitations.some((limitation) => /instrumentation bridge/.test(limitation)));
});

test("expo-ios navigation reports plugin bridge version mismatch without private fallback", async () => {
  const fake = await startFakeMetroHermes({
    websocket: {
      navigationValue: (action) => fakeNavigationValue(action, {
        available: false,
        code: "version-mismatch",
        bridgeVersion: "0.0.1",
        expectedBridgeVersion: "1.0.0",
        reason: "Navigation plugin bridge version is not compatible with this CLI.",
        state: null,
      }),
    },
  });
  try {
    const payload = parseJson(await runCli([
      "--json",
      "navigation",
      "state",
      "--metro-port",
      String(fake.metroPort),
    ]));

    assert.equal(payload.data.available, false);
    assert.equal(payload.data.source, "plugin-bridge");
    assert.equal(payload.data.evidenceSource, "plugin-bridge");
    assert.equal(payload.data.code, "version-mismatch");
    assert.equal(payload.data.bridgeVersion, "0.0.1");
  } finally {
    await fake.close();
  }
});

test("expo-ios navigation deep-link delegates to open-route evidence", async () => {
  const project = await fs.mkdtemp(path.join(os.tmpdir(), "expo-ios-navigation-"));
  const fakeBin = path.join(project, "bin");
  const stateDir = path.join(project, ".scratch", "expo-ios", "runs");
  await fs.mkdir(fakeBin, { recursive: true });
  await fs.writeFile(path.join(project, "package.json"), JSON.stringify({ dependencies: { expo: "^54.0.0" } }));
  await writeExecutable(path.join(fakeBin, "xcrun"), `#!/bin/sh
if [ "$1 $2 $3 $4 $5" = "simctl list devices available --json" ]; then
  cat <<'JSON'
{"devices":{"com.apple.CoreSimulator.SimRuntime.iOS-18-0":[{"name":"iPhone 15","udid":"SIM-1","state":"Booted","isAvailable":true}]}}
JSON
  exit 0
fi
if [ "$1 $2" = "simctl openurl" ]; then echo "opened $3 $4"; exit 0; fi
echo "unexpected xcrun $*" >&2
exit 64
`);
  const env = { ...process.env, PATH: `${fakeBin}${path.delimiter}${process.env.PATH}` };
  await runCli(["--json", "--state-dir", stateDir, "session", "new", "review"], { cwd: project });

  const payload = parseJson(await runCli([
    "--json",
    "--state-dir",
    stateDir,
    "navigation",
    "deep-link",
    "/customers",
    "--scheme",
    "fixture",
  ], { cwd: project, env }));

  assert.equal(payload.data.available, true);
  assert.equal(payload.data.action, "deep-link");
  assert.equal(payload.data.source, "open-route");
  assert.equal(payload.data.deepLink.url, "fixture:///customers");
  assert.match(payload.data.deepLink.stdout, /opened SIM-1 fixture:\/\/\/customers/);
  assert.match(payload.data.evidence.sessionId, /^review-/);
  assert.equal(payload.data.evidence.route, "/customers");
});

test("expo-ios network reports status and redacted request evidence", async () => {
  const fake = await startFakeMetroHermes();
  try {
    const status = parseJson(await runCli([
      "--json",
      "network",
      "status",
      "--metro-port",
      String(fake.metroPort),
    ]));
    const requests = parseJson(await runCli([
      "--json",
      "network",
      "requests",
      "--limit",
      "5",
      "--metro-port",
      String(fake.metroPort),
    ]));
    const detail = parseJson(await runCli([
      "--json",
      "network",
      "request",
      "req-1",
      "--metro-port",
      String(fake.metroPort),
    ]));

    assert.equal(status.data.available, true);
    assert.equal(status.data.source, "plugin-bridge");
    assert.equal(status.data.evidenceSource, "plugin-bridge");
    assert.equal(status.data.transport.name, "metro-inspector-hermes-cdp");
    assert.deepEqual(status.data.hooks, { fetch: true, xhr: true });
    assert.equal(requests.data.requests.length, 1);
    assert.equal(requests.data.captureTiming.observedRequestCount, 1);
    assert.doesNotMatch(JSON.stringify(requests.data), /secret-token|secret-cookie/);
    assert.match(requests.data.requests[0].url, /token=/);
    assert.equal(requests.data.requests[0].headers.authorization, "[redacted]");
    assert.equal(requests.data.requests[0].headers.cookie, "[redacted]");
    assert.equal(requests.data.requests[0].response.body, "[redacted]");
    assert.equal(detail.data.request.id, "req-1");
    assert.deepEqual(fake.actions, ["status", "requests", "request"]);
  } finally {
    await fake.close();
  }
});

test("expo-ios network har stop writes a redacted artifact", async () => {
  const fake = await startFakeMetroHermes();
  const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), "expo-ios-network-"));
  const outputPath = path.join(outputDir, "network.har");
  try {
    const started = parseJson(await runCli([
      "--json",
      "network",
      "har",
      "start",
      "--metro-port",
      String(fake.metroPort),
    ]));
    const stopped = parseJson(await runCli([
      "--json",
      "network",
      "har",
      "stop",
      outputPath,
      "--metro-port",
      String(fake.metroPort),
    ]));

    assert.equal(started.data.available, true);
    assert.equal(stopped.data.available, true);
    assert.equal(stopped.data.artifact, outputPath);
    const har = await fs.readFile(outputPath, "utf8");
    assert.match(har, /"log"/);
    const harPayload = JSON.parse(har);
    assert.equal(harPayload.log._expoIos.source, "plugin-bridge");
    assert.equal(harPayload.log._expoIos.transport.name, "metro-inspector-hermes-cdp");
    assert.equal(harPayload.log._expoIos.captureTiming.observedRequestCount, 1);
    assert.ok(har.includes("[redacted]") || har.includes("%5Bredacted%5D"));
    assert.doesNotMatch(har, /secret-token|secret-cookie/);
    assert.deepEqual(fake.actions, ["har-start", "har-stop"]);
  } finally {
    await fake.close();
  }
});

test("expo-ios network reports unavailable without runtime instrumentation", async () => {
  const payload = parseJson(await runCli(["--json", "network", "requests", "--metro-port", "9"]));

  assert.equal(payload.ok, true);
  assert.equal(payload.data.available, false);
  assert.equal(payload.data.action, "requests");
  assert.equal(payload.data.code, "no-runtime-target");
  assert.equal(payload.data.reason, "No Metro inspector target.");
  assert.deepEqual(payload.data.requests, []);
});

test("expo-ios network distinguishes unavailable upstream bridge and malformed payload states", async () => {
  const noDevtools = await startFakeMetroHermes({
    websocket: {
      networkValue: { available: false, action: "requests", source: "react-native-devtools-network", code: "no-devtools-network-domain", reason: "No DevTools network domain.", requests: [] },
    },
  });
  try {
    const payload = parseJson(await runCli(["--json", "network", "requests", "--metro-port", String(noDevtools.metroPort)]));
    assert.equal(payload.data.available, false);
    assert.equal(payload.data.source, "react-native-devtools-network");
    assert.equal(payload.data.code, "no-devtools-network-domain");
  } finally {
    await noDevtools.close();
  }

  const noBridge = await startFakeMetroHermes({
    websocket: {
      networkValue: { available: false, action: "requests", source: "plugin-bridge", code: "no-bridge-domain", reason: "No bridge network domain.", requests: [] },
    },
  });
  try {
    const payload = parseJson(await runCli(["--json", "network", "requests", "--metro-port", String(noBridge.metroPort)]));
    assert.equal(payload.data.available, false);
    assert.equal(payload.data.source, "plugin-bridge");
    assert.equal(payload.data.code, "no-bridge-domain");
  } finally {
    await noBridge.close();
  }

  const noTraffic = await startFakeMetroHermes({
    websocket: {
      networkValue: { available: true, action: "requests", source: "plugin-bridge", requests: [] },
    },
  });
  try {
    const payload = parseJson(await runCli(["--json", "network", "requests", "--metro-port", String(noTraffic.metroPort)]));
    assert.equal(payload.data.available, false);
    assert.equal(payload.data.code, "no-observed-traffic");
  } finally {
    await noTraffic.close();
  }

  const malformed = await startFakeMetroHermes({
    websocket: {
      networkValue: { available: true, action: "requests", source: "plugin-bridge", requests: { id: "bad" } },
    },
  });
  try {
    const payload = parseJson(await runCli(["--json", "network", "requests", "--metro-port", String(malformed.metroPort)]));
    assert.equal(payload.data.available, false);
    assert.equal(payload.data.code, "malformed-payload");
  } finally {
    await malformed.close();
  }
});

test("expo-ios storage reads are bounded redacted and unsupported stores are unavailable", async () => {
  const fake = await startFakeMetroHermes();
  try {
    const listed = parseJson(await runCli([
      "--json",
      "storage",
      "async",
      "list",
      "--limit",
      "10",
      "--metro-port",
      String(fake.metroPort),
    ]));
    const value = parseJson(await runCli([
      "--json",
      "storage",
      "async",
      "get",
      "auth",
      "--metro-port",
      String(fake.metroPort),
    ]));
    const unsupported = parseJson(await runCli([
      "--json",
      "storage",
      "secure",
      "list",
      "--metro-port",
      String(fake.metroPort),
    ]));

    assert.equal(listed.data.available, true);
    assert.equal(listed.data.source, "plugin-bridge");
    assert.equal(listed.data.evidenceSource, "plugin-bridge");
    assert.deepEqual(listed.data.keys, ["auth", "featureFlags"]);
    assert.equal(value.data.value.token, "[redacted]");
    assert.equal(value.data.value.theme, "dark");
    assert.equal(unsupported.data.available, false);
    assert.equal(unsupported.data.code, "missing-domain");
    assert.equal(unsupported.data.reason, "Unsupported storage store.");
    assert.deepEqual(fake.actions, ["list", "get", "list"]);
  } finally {
    await fake.close();
  }
});

test("expo-ios storage and state mutations require action policy approval", async () => {
  const fake = await startFakeMetroHermes();
  const project = await fs.mkdtemp(path.join(os.tmpdir(), "expo-ios-policy-"));
  const policyPath = path.join(project, "policy.json");
  await fs.writeFile(policyPath, JSON.stringify({ allow: ["storage.set", "controls.press"] }));
  try {
    const deniedStorage = parseJson(await runCli([
      "--json",
      "storage",
      "async",
      "set",
      "auth",
      "{\"token\":\"secret-token\"}",
      "--metro-port",
      String(fake.metroPort),
    ]));
    const allowedStorage = parseJson(await runCli([
      "--json",
      "--action-policy",
      policyPath,
      "storage",
      "async",
      "set",
      "auth",
      "{\"token\":\"secret-token\"}",
      "--metro-port",
      String(fake.metroPort),
    ]));
    const deniedState = parseJson(await runCli([
      "--json",
      "state",
      "load",
      "logged-in",
      "--metro-port",
      String(fake.metroPort),
    ]));

    assert.equal(deniedStorage.data.denied, true);
    assert.equal(deniedStorage.data.policy.allowed, false);
    assert.equal(allowedStorage.data.available, true);
    assert.equal(allowedStorage.data.policy.allowed, true);
    assert.equal(allowedStorage.data.source, "plugin-bridge");
    assert.equal(allowedStorage.data.before.token, "[redacted]");
    assert.equal(allowedStorage.data.after.token, "[redacted]");
    assert.equal(deniedState.data.denied, true);
    assert.equal(deniedState.data.policy.action, "state.load");
    assert.deepEqual(fake.actions, ["set"]);
  } finally {
    await fake.close();
  }
});

test("expo-ios controls list get and policy-approved press use the bridge contract", async () => {
  const fake = await startFakeMetroHermes();
  const project = await fs.mkdtemp(path.join(os.tmpdir(), "expo-ios-controls-"));
  const policyPath = path.join(project, "policy.json");
  await fs.writeFile(policyPath, JSON.stringify({ actions: { "controls.press": "allow" } }));
  try {
    const listed = parseJson(await runCli([
      "--json",
      "controls",
      "list",
      "--metro-port",
      String(fake.metroPort),
    ]));
    const control = parseJson(await runCli([
      "--json",
      "controls",
      "get",
      "refreshCustomers",
      "--metro-port",
      String(fake.metroPort),
    ]));
    const deniedPress = parseJson(await runCli([
      "--json",
      "controls",
      "press",
      "refreshCustomers",
      "--metro-port",
      String(fake.metroPort),
    ]));
    const pressed = parseJson(await runCli([
      "--json",
      "--action-policy",
      policyPath,
      "controls",
      "press",
      "refreshCustomers",
      "--metro-port",
      String(fake.metroPort),
    ]));

    assert.equal(listed.data.available, true);
    assert.equal(listed.data.source, "plugin-bridge");
    assert.equal(listed.data.controls[0].name, "refreshCustomers");
    assert.equal(control.data.control.title, "Refresh customers");
    assert.equal(deniedPress.data.denied, true);
    assert.equal(deniedPress.data.policy.allowed, false);
    assert.equal(pressed.data.result.pressed, true);
    assert.equal(pressed.data.source, "plugin-bridge");
    assert.equal(pressed.data.evidenceSource, "plugin-bridge");
    assert.equal(pressed.data.policy.allowed, true);
    assert.deepEqual(fake.actions, ["list", "get", "press"]);
  } finally {
    await fake.close();
  }
});

test("expo-ios storage and controls report stable missing domain and version mismatch states", async () => {
  const missingStorage = await startFakeMetroHermes({
    websocket: {
      storageValue: { available: false, source: "plugin-bridge", domain: "storage", code: "missing-domain", reason: "Storage domain missing.", store: "async", action: "list" },
    },
  });
  try {
    const payload = parseJson(await runCli(["--json", "storage", "async", "list", "--metro-port", String(missingStorage.metroPort)]));
    assert.equal(payload.data.available, false);
    assert.equal(payload.data.source, "plugin-bridge");
    assert.equal(payload.data.code, "missing-domain");
  } finally {
    await missingStorage.close();
  }

  const mismatchedControls = await startFakeMetroHermes({
    websocket: {
      controlsValue: (action) => ({
        available: false,
        source: "plugin-bridge",
        domain: "controls",
        code: "version-mismatch",
        bridgeVersion: "0.0.1",
        expectedBridgeVersion: "1.0.0",
        reason: "Controls plugin bridge version is not compatible with this CLI.",
        action,
      }),
    },
  });
  try {
    const payload = parseJson(await runCli(["--json", "controls", "list", "--metro-port", String(mismatchedControls.metroPort)]));
    assert.equal(payload.data.available, false);
    assert.equal(payload.data.source, "plugin-bridge");
    assert.equal(payload.data.code, "version-mismatch");
    assert.equal(payload.data.bridgeVersion, "0.0.1");
  } finally {
    await mismatchedControls.close();
  }
});

test("expo-ios bridge planner reports absent present stale and incompatible states", async () => {
  const absent = await fs.mkdtemp(path.join(os.tmpdir(), "expo-ios-bridge-absent-"));
  await fs.writeFile(path.join(absent, "package.json"), JSON.stringify({ dependencies: { expo: "^54.0.0" } }));
  const absentStatus = parseJson(await runCli(["--json", "bridge", "status", "--cwd", absent]));
  const absentPlan = parseJson(await runCli(["--json", "bridge", "plan", "--cwd", absent]));
  assert.equal(absentStatus.data.state, "absent");
  assert.equal(absentPlan.data.plan.permissionRequired, true);
  assert.equal(absentPlan.data.plan.developmentOnly, true);
  assert.ok(absentPlan.data.plan.removalPlan.some((step) => step.action === "delete"));

  const present = await fs.mkdtemp(path.join(os.tmpdir(), "expo-ios-bridge-present-"));
  await fs.mkdir(path.join(present, ".expo-ios"), { recursive: true });
  await fs.mkdir(path.join(present, "src"), { recursive: true });
  await fs.writeFile(path.join(present, "package.json"), JSON.stringify({ dependencies: { expo: "^54.0.0", "@rozenite/runtime": "^1.0.0" } }));
  await fs.writeFile(path.join(present, ".expo-ios", "bridge.json"), JSON.stringify({ schemaVersion: 1, bridgeVersion: "1.0.0", developmentOnly: true }));
  await fs.writeFile(path.join(present, "src", "expo-ios-devtools-bridge.ts"), "export {}\n");
  const presentStatus = parseJson(await runCli(["--json", "bridge", "status", "--cwd", present]));
  assert.equal(presentStatus.data.state, "present");
  assert.equal(presentStatus.data.developmentOnly, true);
  assert.deepEqual(presentStatus.data.dependencies.rozenite, [{ name: "@rozenite/runtime", version: "^1.0.0" }]);

  await fs.writeFile(path.join(present, ".expo-ios", "bridge.json"), JSON.stringify({ schemaVersion: 1, bridgeVersion: "0.0.1", developmentOnly: true }));
  const staleStatus = parseJson(await runCli(["--json", "bridge", "status", "--cwd", present]));
  assert.equal(staleStatus.data.state, "stale");
  assert.equal(staleStatus.data.issues[0].code, "version-mismatch");

  const incompatible = await fs.mkdtemp(path.join(os.tmpdir(), "expo-ios-bridge-incompatible-"));
  await fs.writeFile(path.join(incompatible, "package.json"), JSON.stringify({ dependencies: { react: "^19.0.0" } }));
  const incompatibleStatus = parseJson(await runCli(["--json", "bridge", "status", "--cwd", incompatible]));
  assert.equal(incompatibleStatus.data.state, "incompatible");
  assert.equal(incompatibleStatus.data.issues[0].code, "missing-expo");
});

test("expo-ios bridge install and remove refuse mutation without explicit permission", async () => {
  const project = await fs.mkdtemp(path.join(os.tmpdir(), "expo-ios-bridge-refusal-"));
  await fs.writeFile(path.join(project, "package.json"), JSON.stringify({ dependencies: { expo: "^54.0.0" } }));

  const install = parseJson(await runCli(["--json", "bridge", "install", "--cwd", project]));
  assert.equal(install.data.available, false);
  assert.equal(install.data.requiredConfirmation, "bridge-install");
  await assert.rejects(fs.access(path.join(project, ".expo-ios", "bridge.json")));
  await assert.rejects(fs.access(path.join(project, "src", "expo-ios-devtools-bridge.ts")));

  const remove = parseJson(await runCli(["--json", "bridge", "remove", "--cwd", project]));
  assert.equal(remove.data.available, false);
  assert.equal(remove.data.requiredConfirmation, "bridge-remove");
});

test("expo-ios bridge health reports runtime registration domains policy gates and redaction", async () => {
  const fake = await startFakeMetroHermes({ websocket: { bridgeHealth: fakeBridgeHealthValue() } });
  const project = await fs.mkdtemp(path.join(os.tmpdir(), "expo-ios-bridge-health-"));
  await fs.writeFile(path.join(project, "package.json"), JSON.stringify({ dependencies: { expo: "^54.0.0" } }));
  try {
    const health = parseJson(await runCli([
      "--json",
      "bridge",
      "health",
      "--cwd",
      project,
      "--metro-port",
      String(fake.metroPort),
    ]));
    const domains = parseJson(await runCli([
      "--json",
      "bridge",
      "domains",
      "storage",
      "set",
      "--cwd",
      project,
      "--metro-port",
      String(fake.metroPort),
    ]));

    assert.equal(health.data.available, true);
    assert.equal(health.data.appRegistration.registered, true);
    assert.equal(health.data.bridgeVersion, "1.0.0");
    assert.equal(health.data.compatibleCliVersion, true);
    assert.equal(health.data.transport.target.capabilities.hermesRuntime, true);
    const navigation = health.data.domains.find((domain) => domain.name === "navigation");
    const rn = health.data.domains.find((domain) => domain.name === "rn");
    const storage = health.data.domains.find((domain) => domain.name === "storage");
    assert.ok(navigation.readCommands.includes("state"));
    assert.ok(navigation.writeCommands.includes("deep-link"));
    assert.equal(navigation.actionPolicyRequiredForWrites, true);
    assert.deepEqual(rn.writeCommands, []);
    assert.equal(rn.actionPolicyRequiredForWrites, false);
    assert.ok(storage.redactionBoundaries.includes("secure-store values"));
    assert.equal(domains.data.policy.allowed, false);
    assert.equal(domains.data.policy.denied, true);
    assert.equal(domains.data.policy.actionPolicyRequired, true);
    assert.deepEqual(fake.actions, ["bridge-health", "bridge-health"]);
  } finally {
    await fake.close();
  }
});

test("expo-ios bridge health returns stable unavailable states", async () => {
  const project = await fs.mkdtemp(path.join(os.tmpdir(), "expo-ios-bridge-unavailable-"));
  await fs.writeFile(path.join(project, "package.json"), JSON.stringify({ dependencies: { expo: "^54.0.0" } }));

  const missing = await startFakeMetroHermes({ websocket: { bridgeHealth: { available: false, code: "missing-bridge", reason: "No bridge." } } });
  try {
    const payload = parseJson(await runCli([
      "--json",
      "bridge",
      "health",
      "--cwd",
      project,
      "--metro-port",
      String(missing.metroPort),
    ]));
    assert.equal(payload.data.available, false);
    assert.equal(payload.data.code, "missing-bridge");
    assert.equal(payload.data.health, "unavailable");
  } finally {
    await missing.close();
  }

  const unregistered = await startFakeMetroHermes({ websocket: { bridgeHealth: { available: false, registered: false, bridgeVersion: "1.0.0" } } });
  try {
    const payload = parseJson(await runCli([
      "--json",
      "bridge",
      "health",
      "--cwd",
      project,
      "--metro-port",
      String(unregistered.metroPort),
    ]));
    assert.equal(payload.data.available, false);
    assert.equal(payload.data.code, "missing-app-registration");
  } finally {
    await unregistered.close();
  }

  const incompatible = await startFakeMetroHermes({ websocket: { bridgeHealth: fakeBridgeHealthValue({ bridgeVersion: "0.0.1" }) } });
  try {
    const payload = parseJson(await runCli([
      "--json",
      "bridge",
      "health",
      "--cwd",
      project,
      "--metro-port",
      String(incompatible.metroPort),
    ]));
    assert.equal(payload.data.available, false);
    assert.equal(payload.data.code, "version-mismatch");
    assert.equal(payload.data.compatibleCliVersion, false);
  } finally {
    await incompatible.close();
  }

  const stale = await fs.mkdtemp(path.join(os.tmpdir(), "expo-ios-bridge-stale-"));
  await fs.mkdir(path.join(stale, ".expo-ios"), { recursive: true });
  await fs.mkdir(path.join(stale, "src"), { recursive: true });
  await fs.writeFile(path.join(stale, "package.json"), JSON.stringify({ dependencies: { expo: "^54.0.0" } }));
  await fs.writeFile(path.join(stale, ".expo-ios", "bridge.json"), JSON.stringify({ schemaVersion: 1, bridgeVersion: "0.0.1", developmentOnly: true }));
  await fs.writeFile(path.join(stale, "src", "expo-ios-devtools-bridge.ts"), "export {}\n");
  const stalePayload = parseJson(await runCli(["--json", "bridge", "health", "--cwd", stale]));
  assert.equal(stalePayload.data.available, false);
  assert.equal(stalePayload.data.code, "stale-bridge");
});

test("expo-ios accessibility tree inspect and audit return evidence", async () => {
  const fixture = await createSnapshotRefFixture();
  try {
    const tree = parseJson(await runCli([
      "--json",
      "--state-dir",
      fixture.stateDir,
      "accessibility",
      "tree",
    ], { cwd: fixture.project, env: fixture.env }));
    const inspect = parseJson(await runCli([
      "--json",
      "--state-dir",
      fixture.stateDir,
      "accessibility",
      "inspect",
      "@e1",
    ], { cwd: fixture.project, env: fixture.env }));
    const audit = parseJson(await runCli([
      "--json",
      "--state-dir",
      fixture.stateDir,
      "accessibility",
      "audit",
    ], { cwd: fixture.project, env: fixture.env }));

    assert.equal(tree.data.available, true);
    assert.equal(tree.data.source, "native-accessibility");
    assert.equal(tree.data.tree[0].role, "AXApplication");
    assert.equal(inspect.data.available, true);
    assert.equal(inspect.data.record.ref, "@e1");
    assert.equal(audit.data.available, true);
    assert.equal(audit.data.issueCount, 0);
  } finally {
    await fixture.close();
  }
});

test("expo-ios accessibility focus can plan through the ref action path", async () => {
  const fixture = await createSnapshotRefFixture();
  try {
    const focus = parseJson(await runCli([
      "--json",
      "--state-dir",
      fixture.stateDir,
      "accessibility",
      "focus",
      "@e1",
      "--dry-run",
      "true",
    ], { cwd: fixture.project, env: fixture.env }));

    assert.equal(focus.data.available, true);
    assert.equal(focus.data.action, "focus");
    assert.equal(focus.data.dryRun, true);
    assert.equal(focus.data.plan.ref, "@e1");
    assert.match(focus.data.limitations[0], /accessibility focus APIs/);
  } finally {
    await fixture.close();
  }
});

test("expo-ios inspect and highlight use cached ref evidence", async () => {
  const fixture = await createSnapshotRefFixture();
  try {
    const inspect = parseJson(await runCli([
      "--json",
      "--state-dir",
      fixture.stateDir,
      "inspect",
      "@e1",
    ], { cwd: fixture.project, env: fixture.env }));
    const highlight = parseJson(await runCli([
      "--json",
      "--state-dir",
      fixture.stateDir,
      "highlight",
      "@e1",
      "--duration-ms",
      "250",
    ], { cwd: fixture.project, env: fixture.env }));

    assert.equal(inspect.data.available, true);
    assert.equal(inspect.data.element.ref, "@e1");
    assert.deepEqual(inspect.data.element.source, { file: "app/customers/index.tsx", line: 42, column: 7 });
    assert.equal(highlight.data.available, true);
    assert.equal(highlight.data.ref, "@e1");
    assert.match(await fs.readFile(highlight.data.outputPath, "utf8"), /@e1 Add customer/);
  } finally {
    await fixture.close();
  }
});

test("expo-ios review report and matrix assemble run evidence artifacts", async () => {
  const fixture = await createSnapshotRefFixture();
  const reportPath = path.join(fixture.project, "review-report.json");
  const matrixPath = path.join(fixture.project, "review-matrix.json");
  try {
    await runCli([
      "--json",
      "--state-dir",
      fixture.stateDir,
      "refs",
    ], { cwd: fixture.project, env: fixture.env });
    const report = parseJson(await runCli([
      "--json",
      "--state-dir",
      fixture.stateDir,
      "review",
      "report",
      "--output-path",
      reportPath,
    ], { cwd: fixture.project, env: fixture.env }));
    const matrix = parseJson(await runCli([
      "--json",
      "--state-dir",
      fixture.stateDir,
      "review",
      "matrix",
      "--output-path",
      matrixPath,
    ], { cwd: fixture.project, env: fixture.env }));

    assert.equal(report.data.available, true);
    assert.equal(report.data.outputPath, reportPath);
    assert.equal(report.data.refCount, fixture.snapshot.data.refs.length);
    assert.equal(JSON.parse(await fs.readFile(reportPath, "utf8")).action, "report");
    assert.equal(matrix.data.available, true);
    assert.ok(matrix.data.checks.some((check) => check.name === "snapshot" && check.passed === true));
    assert.equal(JSON.parse(await fs.readFile(matrixPath, "utf8")).action, "matrix");
  } finally {
    await fixture.close();
  }
});

test("expo-ios policy redact and global output controls are stable", async () => {
  const project = await fs.mkdtemp(path.join(os.tmpdir(), "expo-ios-security-"));
  const policyPath = path.join(project, "policy.json");
  const secretPath = path.join(project, "secret.json");
  const redactedPath = path.join(project, "secret.redacted.json");
  await fs.writeFile(policyPath, JSON.stringify({ allow: ["uninstall-app"] }));
  await fs.writeFile(secretPath, JSON.stringify({ url: "myapp://x?token=session-secret", headers: { authorization: "Bearer session-secret" } }));

  const shown = parseJson(await runCli([
    "--json",
    "--action-policy",
    policyPath,
    "policy",
    "show",
  ], { cwd: project }));
  const checked = parseJson(await runCli([
    "--json",
    "--action-policy",
    policyPath,
    "policy",
    "check",
    "action",
    "uninstall-app",
  ], { cwd: project }));
  const redacted = parseJson(await runCli([
    "--json",
    "redact",
    secretPath,
    "--output-path",
    redactedPath,
  ], { cwd: project }));
  const bounded = await runCli([
    "--json",
    "--content-boundaries",
    "--max-output",
    "120",
    "policy",
    "show",
  ], { cwd: project });

  assert.equal(shown.data.source, policyPath);
  assert.equal(checked.data.decision.allowed, true);
  assert.equal(redacted.data.redacted.url, "myapp://x?token=[redacted]");
  assert.equal(redacted.data.redacted.headers.authorization, "[redacted]");
  assert.doesNotMatch(await fs.readFile(redactedPath, "utf8"), /session-secret/);
  assert.equal(bounded.code, 0, bounded.stderr);
  assert.match(bounded.stdout, /expo-ios output truncated by --max-output/);
  assert.doesNotMatch(bounded.stdout, /session-secret/);
});

test("expo-ios profiler is a stable alias for native ettrace evidence", async () => {
  const project = await fs.mkdtemp(path.join(os.tmpdir(), "expo-ios-profiler-"));
  const artifactPath = path.join(project, "capture.trace");
  const payload = parseJson(await runCli([
    "--json",
    "profiler",
    "stop",
    artifactPath,
    "--cwd",
    project,
  ], { cwd: project }));

  assert.equal(payload.data.action, "ettrace");
  assert.equal(payload.data.subaction, "stop");
  assert.equal(payload.data.nativeArtifact, artifactPath);
  assert.equal(await fs.readFile(artifactPath, "utf8"), "ettrace placeholder\n");
});

test("expo-ios dialog and sheet commands report and dismiss blockers", async () => {
  const fake = await startFakeMetroHermes();
  try {
    const dialog = parseJson(await runCli([
      "--json",
      "dialog",
      "status",
      "--metro-port",
      String(fake.metroPort),
    ]));
    const accepted = parseJson(await runCli([
      "--json",
      "dialog",
      "accept",
      "--metro-port",
      String(fake.metroPort),
    ]));
    const sheet = parseJson(await runCli([
      "--json",
      "sheet",
      "status",
      "--metro-port",
      String(fake.metroPort),
    ]));
    const dismissed = parseJson(await runCli([
      "--json",
      "sheet",
      "dismiss",
      "--metro-port",
      String(fake.metroPort),
    ]));

    assert.equal(dialog.data.available, true);
    assert.equal(dialog.data.visible, true);
    assert.equal(dialog.data.dialog.title, "Delete customer?");
    assert.equal(accepted.data.result.accepted, true);
    assert.equal(sheet.data.sheet.title, "Filters");
    assert.equal(dismissed.data.result.dismissed, true);
    assert.deepEqual(fake.actions, ["status", "accept", "status", "dismiss"]);
  } finally {
    await fake.close();
  }
});

test("expo-ios expo introspection reports modules config doctor and prebuild risk", async () => {
  const project = await fs.mkdtemp(path.join(os.tmpdir(), "expo-ios-expo-"));
  await fs.mkdir(path.join(project, "ios"), { recursive: true });
  await fs.writeFile(path.join(project, "package.json"), `${JSON.stringify({
    dependencies: {
      expo: "^54.0.0",
      "expo-camera": "^17.0.0",
      "expo-router": "^6.0.0",
      "@config-plugins/react-native-ble-plx": "^9.0.0",
      "react-native": "^0.83.0",
    },
  }, null, 2)}\n`);
  await fs.writeFile(path.join(project, "app.json"), `${JSON.stringify({
    expo: {
      name: "Fixture",
      slug: "fixture",
      scheme: "fixture",
      plugins: ["expo-camera", "@config-plugins/react-native-ble-plx"],
      ios: { bundleIdentifier: "com.example.fixture" },
    },
  }, null, 2)}\n`);

  const modules = parseJson(await runCli(["--json", "expo", "modules", "--cwd", project]));
  const config = parseJson(await runCli(["--json", "expo", "config", "--cwd", project]));
  const doctorPayload = parseJson(await runCli(["--json", "expo", "doctor", "--cwd", project]));
  const prebuild = parseJson(await runCli(["--json", "expo", "prebuild-plan", "--cwd", project]));

  assert.equal(modules.data.available, true);
  assert.deepEqual(modules.data.sources, ["project"]);
  assert.equal(modules.data.expoDependency, "^54.0.0");
  assert.ok(modules.data.modules.some((module) => module.name === "expo-camera"));
  assert.ok(modules.data.modules.some((module) => module.category === "config-plugin"));
  assert.equal(config.data.appConfig.name, "Fixture");
  assert.deepEqual(config.data.sources, ["project"]);
  assert.equal(doctorPayload.data.summary.cli.name, "expo-ios");
  assert.ok(doctorPayload.data.sources.includes("project"));
  assert.equal(prebuild.data.riskLevel, "high");
  assert.ok(prebuild.data.risks.some((risk) => risk.kind === "native-project-present"));
  assert.ok(prebuild.data.risks.some((risk) => risk.kind === "config-plugin"));
});

test("expo-ios rn tree and renders report runtime instrumentation sources", async () => {
  const fake = await startFakeMetroHermes();
  try {
    const tree = parseJson(await runCli([
      "--json",
      "rn",
      "tree",
      "--metro-port",
      String(fake.metroPort),
    ]));
    const started = parseJson(await runCli([
      "--json",
      "rn",
      "renders",
      "start",
      "--metro-port",
      String(fake.metroPort),
    ]));
    const stopped = parseJson(await runCli([
      "--json",
      "rn",
      "renders",
      "stop",
      "--metro-port",
      String(fake.metroPort),
    ]));

    assert.equal(tree.data.available, true);
    assert.deepEqual(tree.data.sources, ["runtime", "app-instrumentation"]);
    assert.equal(tree.data.tree[0].name, "App");
    assert.match(tree.data.limitations.join(" "), /private React Native hooks/);
    assert.equal(started.data.renders.recording, true);
    assert.equal(stopped.data.renders.recording, false);
    assert.deepEqual(fake.actions, ["tree", "renders-start", "renders-stop"]);
  } finally {
    await fake.close();
  }
});

test("expo-ios rn inspect reads cached refs with source limitations", async () => {
  const fixture = await createSnapshotRefFixture();
  try {
    const inspect = parseJson(await runCli([
      "--json",
      "--state-dir",
      fixture.stateDir,
      "rn",
      "inspect",
      "@e1",
    ], { cwd: fixture.project, env: fixture.env }));

    assert.equal(inspect.data.available, true);
    assert.equal(inspect.data.ref, "@e1");
    assert.deepEqual(inspect.data.sources, ["native-accessibility", "snapshot-cache"]);
    assert.equal(inspect.data.record.ref, "@e1");
    assert.match(inspect.data.limitations.join(" "), /private React Native hooks/);
  } finally {
    await fixture.close();
  }
});

test("expo-ios rn tree reports unavailable without a runtime target", async () => {
  const payload = parseJson(await runCli(["--json", "rn", "tree", "--metro-port", "9"]));

  assert.equal(payload.ok, true);
  assert.equal(payload.data.available, false);
  assert.equal(payload.data.action, "tree");
  assert.equal(payload.data.source, "app-instrumentation");
  assert.equal(payload.data.reason, "No Metro inspector target.");
  assert.ok(payload.data.limitations.some((limitation) => /instrumentation bridge/.test(limitation)));
});

test("expo-ios perf summary labels available and unavailable development evidence", async () => {
  const project = await fs.mkdtemp(path.join(os.tmpdir(), "expo-ios-perf-summary-"));
  await fs.writeFile(path.join(project, "package.json"), `${JSON.stringify({
    dependencies: { expo: "^54.0.0", "react-native": "^0.83.0" },
  }, null, 2)}\n`);

  const payload = parseJson(await runCli([
    "--json",
    "perf",
    "summary",
    "--cwd",
    project,
    "--metro-port",
    "9",
  ]));

  assert.equal(payload.data.available, true);
  assert.equal(payload.data.mode, "development");
  assert.equal(payload.data.context.build.releaseLike, false);
  assert.ok(payload.data.metrics.some((metric) => metric.name === "project.dependencies"));
  assert.ok(payload.data.capabilities.some((capability) => capability.source === "plugin-bridge-performance"));
  assert.ok(payload.data.capabilities.some((capability) => capability.type === "native-fallback"));
  assert.ok(payload.data.unavailableSources.some((source) => source.source === "plugin-bridge-performance"));
  assert.ok(payload.data.limitations.some((limitation) => /Development-mode/.test(limitation)));
});

test("expo-ios perf startup and action write runtime evidence artifacts", async () => {
  const fake = await startFakeMetroHermes();
  const project = await fs.mkdtemp(path.join(os.tmpdir(), "expo-ios-perf-runtime-"));
  const outputDir = path.join(project, "perf");
  try {
    const startupPath = path.join(outputDir, "startup.json");
    const actionPath = path.join(outputDir, "action.json");
    const startup = parseJson(await runCli([
      "--json",
      "perf",
      "startup",
      "--cwd",
      project,
      "--metro-port",
      String(fake.metroPort),
      "--output-path",
      startupPath,
    ]));
    const action = parseJson(await runCli([
      "--json",
      "perf",
      "action",
      "open customer",
      "--cwd",
      project,
      "--metro-port",
      String(fake.metroPort),
      "--output-path",
      actionPath,
    ]));

    assert.equal(startup.data.available, true);
    assert.equal(startup.data.evidenceSource, "plugin-bridge-performance");
    assert.equal(startup.data.metrics[0].source, "rozenite-performance");
    assert.equal(startup.data.transport.name, "metro-inspector-hermes-cdp");
    assert.equal(startup.data.context.metro.status, "available");
    assert.equal(startup.data.context.build.mode, "development");
    assert.equal(startup.data.artifacts[0], startupPath);
    assert.equal(JSON.parse(await fs.readFile(startupPath, "utf8")).action, "startup");
    assert.equal(action.data.actionName, "open customer");
    assert.equal(action.data.metrics[0].name, "interaction.duration");
    assert.equal(action.data.artifacts[0], actionPath);
    assert.deepEqual(fake.actions, ["startup", "action"]);
  } finally {
    await fake.close();
  }
});

test("expo-ios perf bundle reports static bundle artifact context", async () => {
  const project = await fs.mkdtemp(path.join(os.tmpdir(), "expo-ios-perf-bundle-"));
  const bundlePath = path.join(project, "index.ios.bundle");
  const outputPath = path.join(project, "bundle-report.json");
  await fs.writeFile(path.join(project, "package.json"), `${JSON.stringify({
    dependencies: { expo: "^54.0.0", "react-native": "^0.83.0" },
  }, null, 2)}\n`);
  await fs.writeFile(bundlePath, "console.log('fixture bundle');\n");

  const payload = parseJson(await runCli([
    "--json",
    "perf",
    "bundle",
    bundlePath,
    "--cwd",
    project,
    "--output-path",
    outputPath,
  ]));

  assert.equal(payload.data.available, true);
  assert.equal(payload.data.context.build.mode, "development");
  assert.equal(payload.data.metrics[0].name, "bundle.bytes");
  assert.equal(payload.data.metrics[0].unit, "bytes");
  assert.equal(payload.data.bundleArtifact, bundlePath);
  assert.equal(payload.data.artifacts[0], outputPath);
  assert.equal(JSON.parse(await fs.readFile(outputPath, "utf8")).bundleArtifact, bundlePath);
});

test("expo-ios perf mark measure compare and budget produce stable artifacts", async () => {
  const fake = await startFakeMetroHermes();
  const project = await fs.mkdtemp(path.join(os.tmpdir(), "expo-ios-perf-deep-"));
  const baselinePath = path.join(project, "baseline.json");
  const candidatePath = path.join(project, "candidate.json");
  const budgetPath = path.join(project, "budget.json");
  const comparePath = path.join(project, "compare.json");
  const budgetReportPath = path.join(project, "budget-report.json");
  await fs.writeFile(baselinePath, `${JSON.stringify({
    metrics: [{ name: "startup.ready", value: 1000, unit: "ms", source: "rozenite-performance", confidence: "medium" }],
  }, null, 2)}\n`);
  await fs.writeFile(candidatePath, `${JSON.stringify({
    metrics: [{ name: "startup.ready", value: 850, unit: "ms", source: "rozenite-performance", confidence: "medium" }],
  }, null, 2)}\n`);
  await fs.writeFile(budgetPath, `${JSON.stringify({
    budgets: [{ metric: "startup.ready", max: 900 }],
  }, null, 2)}\n`);

  try {
    const marks = parseJson(await runCli([
      "--json",
      "perf",
      "mark",
      "list",
      "--metro-port",
      String(fake.metroPort),
    ]));
    const measureStart = parseJson(await runCli([
      "--json",
      "perf",
      "measure",
      "start",
      "checkout",
      "--metro-port",
      String(fake.metroPort),
    ]));
    const measureStop = parseJson(await runCli([
      "--json",
      "perf",
      "measure",
      "stop",
      "checkout",
      "--metro-port",
      String(fake.metroPort),
    ]));
    const compare = parseJson(await runCli([
      "--json",
      "perf",
      "compare",
      "--baseline",
      baselinePath,
      "--candidate",
      candidatePath,
      "--output-path",
      comparePath,
    ]));
    const budget = parseJson(await runCli([
      "--json",
      "perf",
      "budget",
      "check",
      "--file",
      budgetPath,
      "--candidate",
      candidatePath,
      "--output-path",
      budgetReportPath,
    ]));

    assert.equal(marks.data.available, true);
    assert.equal(marks.data.evidenceSource, "plugin-bridge-performance");
    assert.equal(marks.data.marks[0].name, "app.ready");
    assert.equal(measureStart.data.measure.name, "checkout");
    assert.equal(measureStop.data.measure.durationMs, 64);
    assert.equal(compare.data.deltas[0].metric, "startup.ready");
    assert.equal(compare.data.deltas[0].delta, -150);
    assert.equal(compare.data.artifacts[0], comparePath);
    assert.equal(JSON.parse(await fs.readFile(comparePath, "utf8")).action, "compare");
    assert.equal(budget.data.passed, true);
    assert.equal(budget.data.checks[0].metric, "startup.ready");
    assert.equal(budget.data.artifacts[0], budgetReportPath);
    assert.deepEqual(fake.actions, ["mark-list", "measure-start", "measure-stop"]);
  } finally {
    await fake.close();
  }
});

test("expo-ios perf reports missing plugin metrics and malformed metric payloads", async () => {
  const missing = await startFakeMetroHermes({
    websocket: {
      perfValue: { available: false, source: "plugin-bridge-performance", sources: ["plugin-bridge"], code: "missing-domain", reason: "Performance domain missing.", metrics: [] },
    },
  });
  try {
    const payload = parseJson(await runCli(["--json", "perf", "startup", "--metro-port", String(missing.metroPort)]));
    assert.equal(payload.data.available, false);
    assert.equal(payload.data.evidenceSource, "plugin-bridge-performance");
    assert.equal(payload.data.code, "missing-domain");
  } finally {
    await missing.close();
  }

  const malformed = await startFakeMetroHermes({
    websocket: {
      perfValue: { available: true, source: "plugin-bridge-performance", sources: ["plugin-bridge"], metrics: { name: "bad" } },
    },
  });
  try {
    const payload = parseJson(await runCli(["--json", "perf", "mark", "list", "--metro-port", String(malformed.metroPort)]));
    assert.equal(payload.data.available, false);
    assert.equal(payload.data.code, "malformed-payload");
    assert.deepEqual(payload.data.metrics, []);
  } finally {
    await malformed.close();
  }
});

test("expo-ios perf memory does not allow leak claims from a single sample", async () => {
  const project = await fs.mkdtemp(path.join(os.tmpdir(), "expo-ios-perf-memory-"));
  const outputPath = path.join(project, "memory.json");
  const payload = parseJson(await runCli([
    "--json",
    "perf",
    "memory",
    "--samples",
    "1",
    "--cwd",
    project,
    "--output-path",
    outputPath,
  ]));

  assert.equal(payload.data.available, true);
  assert.equal(payload.data.leakClaim.allowed, false);
  assert.match(payload.data.leakClaim.reason, /Repeated measurements/);
  assert.equal(payload.data.artifacts[0], outputPath);
  assert.equal(JSON.parse(await fs.readFile(outputPath, "utf8")).action, "memory");
});

test("expo-ios perf native profiler commands record artifacts with limitations", async () => {
  const project = await fs.mkdtemp(path.join(os.tmpdir(), "expo-ios-perf-native-"));
  const traceArtifact = path.join(project, "capture.trace");
  const traceMetadata = path.join(project, "ettrace.json");
  const memgraphArtifact = path.join(project, "heap.memgraph");
  const memgraphMetadata = path.join(project, "memgraph.json");

  const ettrace = parseJson(await runCli([
    "--json",
    "perf",
    "ettrace",
    "stop",
    traceArtifact,
    "--cwd",
    project,
    "--output-path",
    traceMetadata,
  ]));
  const memgraph = parseJson(await runCli([
    "--json",
    "perf",
    "memgraph",
    "capture",
    memgraphArtifact,
    "--cwd",
    project,
    "--output-path",
    memgraphMetadata,
  ]));

  assert.equal(ettrace.data.available, true);
  assert.equal(ettrace.data.profiler, "ettrace");
  assert.equal(ettrace.data.nativeArtifact, traceArtifact);
  assert.match(ettrace.data.limitations.join(" "), /native profiler/);
  assert.equal(await fs.readFile(traceArtifact, "utf8"), "ettrace placeholder\n");
  assert.equal(memgraph.data.profiler, "memgraph");
  assert.equal(memgraph.data.nativeArtifact, memgraphArtifact);
  assert.equal(await fs.readFile(memgraphArtifact, "utf8"), "memgraph placeholder\n");
});

test("expo-ios dashboard starts reports and stops a local session view", async () => {
  const project = await fs.mkdtemp(path.join(os.tmpdir(), "expo-ios-dashboard-"));
  const stateDir = path.join(project, ".scratch", "expo-ios", "runs");
  const outputPath = path.join(project, "dashboard.json");
  await runCli(["--json", "--state-dir", stateDir, "session", "new", "review"], { cwd: project });

  const started = parseJson(await runCli([
    "--json",
    "--state-dir",
    stateDir,
    "dashboard",
    "start",
    "--output-path",
    outputPath,
    "--port",
    "0",
  ], { cwd: project }));
  const status = parseJson(await runCli([
    "--json",
    "--state-dir",
    stateDir,
    "dashboard",
    "status",
  ], { cwd: project }));
  const stopped = parseJson(await runCli([
    "--json",
    "--state-dir",
    stateDir,
    "dashboard",
    "stop",
  ], { cwd: project }));

  assert.equal(started.data.status, "running");
  assert.equal(started.data.sessions.length, 1);
  assert.equal(started.data.artifacts.json, outputPath);
  assert.match(await fs.readFile(started.data.artifacts.html, "utf8"), /expo-ios dashboard/);
  assert.equal(status.data.status, "running");
  assert.equal(stopped.data.status, "stopped");
});

test("expo-ios skills list and get return version matched guidance", async () => {
  const listed = parseJson(await runCli(["--json", "skills", "list"]));
  const skill = parseJson(await runCli(["--json", "skills", "get", "expo-ios-cli"]));

  assert.equal(listed.data.pluginVersion, "0.1.0");
  assert.ok(listed.data.skills.some((item) => item.name === "expo-ios-cli"));
  assert.equal(skill.data.name, "expo-ios-cli");
  assert.equal(skill.data.pluginVersion, "0.1.0");
  assert.match(skill.data.content, /expo-ios --json doctor/);
});

test("expo-ios install upgrade and release checks work outside the repo", async () => {
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), "expo-ios-outside-"));
  const prefix = path.join(outside, "local");

  const install = parseJson(await runCli(["--json", "install", "check", "--prefix", prefix], { cwd: outside }));
  const upgrade = parseJson(await runCli(["--json", "upgrade", "check", "--prefix", prefix], { cwd: outside }));
  const release = parseJson(await runCli(["--json", "release", "check", "--cwd", outside], { cwd: outside }));

  assert.equal(install.data.action, "check");
  assert.equal(install.data.binPath, path.join(prefix, "bin", "expo-ios"));
  assert.equal(upgrade.data.upgradeAvailable, false);
  assert.equal(release.data.available, true);
  assert.ok(release.data.checks.every((check) => check.ok));
  assert.ok(release.data.checks.some((check) => check.name === "version"));
  assert.ok(release.data.checks.some((check) => check.name === "doctor-json"));
  assert.ok(release.data.checks.some((check) => check.name === "routes-fixture-json"));
});

test("expo-ios live-backlog matrix is derived from dispatcher and help output", async () => {
  const project = await fs.mkdtemp(path.join(os.tmpdir(), "expo-ios-live-matrix-"));
  await fs.mkdir(path.join(project, "app"), { recursive: true });
  await fs.writeFile(path.join(project, "package.json"), JSON.stringify({
    dependencies: {
      expo: "^54.0.0",
      "react-native": "0.81.4",
    },
  }));

  const payload = parseJson(await runCli([
    "--json",
    "live-backlog",
    "matrix",
    "--scope",
    "full",
    "--cwd",
    project,
  ]));

  assert.equal(payload.ok, true);
  assert.equal(payload.data.selfCheck.ok, true);
  assert.equal(payload.data.source.unrepresentedDispatcherCommands.length, 0);
  assert.equal(payload.data.source.unrepresentedHelpCommands.length, 0);
  assert.equal(payload.data.rowCount, payload.data.source.dispatcherCommandCount);
  assert.ok(payload.data.rows.some((row) => row.command === "open-dev-menu" && row.mutatesRuntime === true));
  assert.ok(payload.data.rows.every((row) => row.captures.includes("stdout") && row.captures.includes("stderr") && row.captures.includes("exit-code")));
});

test("expo-ios live-backlog smoke run saves row artifacts and blocks runtime rows without evidence", async () => {
  const project = await fs.mkdtemp(path.join(os.tmpdir(), "expo-ios-live-run-"));
  const outputDir = path.join(project, "live-output");
  await fs.mkdir(path.join(project, "app"), { recursive: true });
  await fs.writeFile(path.join(project, "package.json"), JSON.stringify({
    dependencies: {
      expo: "^54.0.0",
      "react-native": "0.81.4",
    },
  }));
  await fs.writeFile(path.join(project, "app", "index.tsx"), "export default function Index() { return null; }\n");

  const payload = parseJson(await runCli([
    "--json",
    "live-backlog",
    "run",
    "--scope",
    "smoke",
    "--cwd",
    project,
    "--output-dir",
    outputDir,
    "--metro-port",
    "9",
  ]));

  assert.equal(payload.ok, true);
  assert.equal(payload.data.hiddenPreflights.length, 0);
  assert.equal(payload.data.reportPath, path.join(outputDir, "live-backlog-report.json"));
  assert.ok(payload.data.summary.rowCount > 0);
  assert.ok(payload.data.summary.environmentBlockedCount >= 1);

  const runtimeRows = payload.data.rows.filter((row) => ["metro", "console", "errors", "devtools"].includes(row.command));
  assert.ok(runtimeRows.length >= 4);
  assert.ok(runtimeRows.every((row) => row.classification === "environment-blocked"));

  for (const row of payload.data.rows) {
    assert.equal(typeof row.exactCommand[0], "string");
    for (const artifactPath of [row.stdoutPath, row.stderrPath, row.exitCodePath, ...row.runRecordPaths]) {
      assert.ok((await fs.stat(artifactPath)).isFile(), artifactPath);
    }
  }

  const report = JSON.parse(await fs.readFile(payload.data.reportPath, "utf8"));
  assert.equal(report.rows.length, payload.data.rows.length);
});

test("expo-ios record and diff write session-tied artifacts", async () => {
  const fixture = await createSnapshotRefFixture();
  const baselinePath = path.join(fixture.project, "baseline-snapshot.json");
  const diffPath = path.join(fixture.project, "snapshot-diff.json");
  const recordingPath = path.join(fixture.project, "recording.mov");
  try {
    await fs.writeFile(baselinePath, `${JSON.stringify({
      snapshotId: "baseline",
      targetId: fixture.targetId,
      refs: [],
    }, null, 2)}\n`);

    const started = parseJson(await runCli([
      "--json",
      "--state-dir",
      fixture.stateDir,
      "record",
      "start",
    ], { cwd: fixture.project }));
    const stopped = parseJson(await runCli([
      "--json",
      "--state-dir",
      fixture.stateDir,
      "record",
      "stop",
      recordingPath,
    ], { cwd: fixture.project }));
    const diff = parseJson(await runCli([
      "--json",
      "--state-dir",
      fixture.stateDir,
      "diff",
      "snapshot",
      "--baseline",
      baselinePath,
      "--output-path",
      diffPath,
    ], { cwd: fixture.project }));

    assert.equal(started.data.status, "recording");
    assert.match(started.data.sessionId, /^review-/);
    assert.equal(stopped.data.outputPath, recordingPath);
    assert.equal(await fs.readFile(recordingPath, "utf8"), "recording placeholder\n");
    assert.equal(diff.data.available, true);
    assert.equal(diff.data.outputPath, diffPath);
    assert.ok(diff.data.addedRefs.includes("@e1"));
    const artifact = JSON.parse(await fs.readFile(diffPath, "utf8"));
    assert.equal(artifact.sessionId, started.data.sessionId);
    assert.equal(artifact.targetId, fixture.targetId);
  } finally {
    await fixture.close();
  }
});

test("expo-ios review-next suggests calendar workflow constraints", async () => {
  const payload = parseJson(await runCli([
    "--json",
    "review-next",
    "--surface",
    "calendar",
    "--stage",
    "pre-patch",
    "--issue",
    "drag creates scroll conflict",
    "--changed-gesture",
    "true",
    "--has-acceptance-contract",
    "false",
  ]));

  assert.equal(payload.ok, true);
  assert.equal(payload.data.constraint.tocStep, "exploit");
  assert.match(payload.data.nextStep, /acceptance contract/i);
  assert.match(payload.data.requiredFlows.representativeAction, /drag/i);
  assert.ok(payload.data.requiredFlows.flows.includes("scroll-vs-drag conflict"));
  assert.ok(payload.data.stopConditions.some((condition) => /acceptance contract/.test(condition)));
  assert.ok(payload.data.suggestedCommands.some((command) => /ux-context/.test(command)));
  assert.ok(payload.data.suggestedCommands.some((command) => /inspector toggle/.test(command)));
});

test("expo-ios review-next elevates verifier errors tied to changed workflow", async () => {
  const payload = parseJson(await runCli([
    "--json",
    "review-next",
    "--surface",
    "calendar",
    "--stage",
    "verifier-failed",
    "--has-acceptance-contract",
    "true",
    "--has-screenshot",
    "true",
    "--changed-gesture",
    "true",
    "--verifier-rule",
    "touch-gesture-handler-thread",
  ]));

  assert.equal(payload.ok, true);
  assert.equal(payload.data.constraint.tocStep, "elevate");
  assert.match(payload.data.constraint.reason, /touch-gesture-handler-thread/);
  assert.ok(payload.data.stopConditions.some((condition) => /touch-gesture-handler-thread/.test(condition)));
});

test("expo-ios gesture dry-run plans iOS long press without device tooling", async () => {
  const payload = parseJson(await runCli([
    "--json",
    "gesture",
    "long-press",
    "--x",
    "100",
    "--y",
    "240",
    "--duration-ms",
    "900",
    "--dry-run",
    "true",
  ]));

  assert.equal(payload.ok, true);
  assert.equal(payload.data.dryRun, true);
  assert.equal(payload.data.gesture, "long-press");
  assert.deepEqual(payload.data.coordinates, { x: 100, y: 240 });
  assert.deepEqual(payload.data.plan.command.slice(0, 6), ["idb", "ui", "tap", "100", "240", "--duration"]);
  assert.equal(payload.data.plan.command[6], "0.9");
  assert.match(payload.data.reviewQuestionsThisCanAnswer.join(" "), /long press/);
});

test("expo-ios gesture uses axe when idb is unavailable", async () => {
  const project = await fs.mkdtemp(path.join(os.tmpdir(), "expo-ios-gesture-axe-"));
  const fakeBin = path.join(project, "bin");
  const sentinel = path.join(project, "axe-gesture-args.txt");
  await fs.mkdir(fakeBin, { recursive: true });
  await writeExecutable(path.join(fakeBin, "xcrun"), `#!/bin/sh
if [ "$1 $2 $3 $4 $5" = "simctl list devices available --json" ]; then
  cat <<'JSON'
{"devices":{"com.apple.CoreSimulator.SimRuntime.iOS-18-0":[{"name":"iPhone 15","udid":"SIM-1","state":"Booted","isAvailable":true}]}}
JSON
  exit 0
fi
echo "unexpected xcrun $*" >&2
exit 64
`);
  await writeExecutable(path.join(fakeBin, "axe"), `#!/bin/sh
echo "$@" > ${JSON.stringify(sentinel)}
echo "axe gesture"
`);

  const payload = parseJson(await runCli([
    "--json",
    "gesture",
    "long-press",
    "--x",
    "100",
    "--y",
    "240",
    "--duration-ms",
    "900",
  ], {
    cwd: project,
    env: { ...process.env, PATH: `${fakeBin}${path.delimiter}/usr/bin:/bin` },
  }));

  assert.equal(payload.data.execution.available, true);
  assert.equal(payload.data.execution.tool, "axe");
  assert.deepEqual(payload.data.execution.command, ["axe", "touch", "-x", "100", "-y", "240", "--down", "--up", "--delay", "0.9", "--udid", "SIM-1"]);
  assert.equal(await fs.readFile(sentinel, "utf8"), "touch -x 100 -y 240 --down --up --delay 0.9 --udid SIM-1\n");
});

test("expo-ios gesture dry-run includes requested evidence intent", async () => {
  const payload = parseJson(await runCli([
    "--json",
    "gesture",
    "drag",
    "--start-x",
    "180",
    "--start-y",
    "900",
    "--end-x",
    "180",
    "--end-y",
    "1200",
    "--duration-ms",
    "1100",
    "--dry-run",
    "true",
    "--capture-before-after",
    "true",
    "--include-trace",
    "true",
  ]));

  assert.equal(payload.ok, true);
  assert.equal(payload.data.dryRun, true);
  assert.equal(payload.data.captureBeforeAfter, true);
  assert.equal(payload.data.includeTrace, true);
  assert.equal(payload.data.plan.tool, "idb");
  assert.ok(payload.data.reviewQuestionsThisCanAnswer.some((question) => /screenshots before and after/i.test(question)));
});

test("expo-ios gesture dry-run plans drag evidence commands", async () => {
  const payload = parseJson(await runCli([
    "--json",
    "gesture",
    "drag",
    "--start-x",
    "180",
    "--start-y",
    "900",
    "--end-x",
    "180",
    "--end-y",
    "1200",
    "--duration-ms",
    "1100",
    "--dry-run",
    "true",
  ]));

  assert.equal(payload.ok, true);
  assert.equal(payload.data.gesture, "drag");
  assert.deepEqual(payload.data.coordinates, { startX: 180, startY: 900, endX: 180, endY: 1200 });
  assert.deepEqual(payload.data.plan.command.slice(0, 7), ["idb", "ui", "swipe", "180", "900", "180", "1200"]);
  assert.ok(payload.data.reviewQuestionsThisCanAnswer.some((question) => /scroll/.test(question)));
});

test("expo-ios annotate-screen creates readable annotation artifacts from existing screenshot", async () => {
  const project = await fs.mkdtemp(path.join(os.tmpdir(), "expo-ios-annotate-"));
  const screenshot = path.join(project, "screen.png");
  const outputDir = path.join(project, "annotations");
  await fs.writeFile(screenshot, Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
    "base64",
  ));

  const payload = parseJson(await runCli([
    "--json",
    "annotate-screen",
    "--screenshot-path",
    screenshot,
    "--output-dir",
    outputDir,
    "--title",
    "Schedule review",
    "--serve",
    "false",
  ]));

  assert.equal(payload.ok, true);
  assert.equal(payload.data.outputDir, outputDir);
  assert.equal(payload.data.server, null);
  const html = await fs.readFile(path.join(outputDir, "annotate.html"), "utf8");
  const annotations = JSON.parse(await fs.readFile(path.join(outputDir, "annotations.json"), "utf8"));
  const context = JSON.parse(await fs.readFile(path.join(outputDir, "context.json"), "utf8"));
  assert.match(html, /Click for a point comment/);
  assert.ok(html.includes("/annotations"));
  assert.deepEqual(annotations.comments, []);
  assert.equal(annotations.title, "Schedule review");
  assert.equal(context.source, "provided-screenshot");
});

test("expo-ios review-overlay scaffolds an in-app review overlay", async () => {
  const project = await fs.mkdtemp(path.join(os.tmpdir(), "expo-ios-overlay-"));
  await fs.writeFile(path.join(project, "package.json"), JSON.stringify({ dependencies: { expo: "^54.0.0", "react-native": "^0.83.0" } }));

  const payload = parseJson(await runCli([
    "--json",
    "review-overlay",
    "scaffold",
    "--cwd",
    project,
  ]));

  assert.equal(payload.ok, true);
  const source = await fs.readFile(path.join(project, "codex-review-overlay", "CodexReviewOverlay.tsx"), "utf8");
  const index = await fs.readFile(path.join(project, "codex-review-overlay", "index.ts"), "utf8");
  assert.match(source, /export function CodexReviewOverlay/);
  assert.match(source, /Comment/);
  assert.match(source, /getInspectorDataForViewAtPoint/);
  assert.match(source, /fetch\(endpoint\)/);
  assert.match(source, /handleCommentPress/);
  assert.match(source, /hoverPreview/);
  assert.match(source, /onPointerMove/);
  assert.match(source, /pointerEndpointFrom/);
  assert.match(source, /\/pointer/);
  assert.match(source, /copyEndpointFrom/);
  assert.match(source, /\/copy/);
  assert.match(source, /formatFeedbackMarkdown/);
  assert.match(source, /Page Feedback/);
  assert.match(source, /Click to comment this target/);
  assert.match(source, /Move pointer to preview/);
  assert.match(source, />Copy</);
  assert.match(source, /Comment again to clear/);
  assert.match(source, /onLongPress={confirmClearComments}/);
  assert.match(source, /delayLongPress=\{350\}/);
  assert.match(source, /method: "DELETE"/);
  assert.doesNotMatch(source, /Browse/);
  assert.doesNotMatch(source, /Region/);
  assert.match(source, /fetch\(endpoint/);
  assert.match(index, /CodexReviewOverlay/);
  assert.match(payload.data.integration.jsx, /CodexReviewOverlay/);
  assert.match(payload.data.integration.jsx, /inspectedViewRef/);
});

test("expo-ios review-overlay prepare and read create a stable event channel", async () => {
  const project = await fs.mkdtemp(path.join(os.tmpdir(), "expo-ios-overlay-"));
  await fs.writeFile(path.join(project, "package.json"), JSON.stringify({ dependencies: { expo: "^54.0.0" } }));
  const outputDir = path.join(project, ".scratch", "codex-review-overlay");

  const prepared = parseJson(await runCli([
    "--json",
    "review-overlay",
    "prepare",
    "--cwd",
    project,
    "--output-dir",
    outputDir,
    "--title",
    "Schedule review",
    "--serve",
    "false",
  ]));
  const read = parseJson(await runCli([
    "--json",
    "review-overlay",
    "read",
    "--cwd",
    project,
    "--output-dir",
    outputDir,
  ]));

  assert.equal(prepared.ok, true);
  assert.equal(prepared.data.eventsPath, path.join(outputDir, "events.json"));
  assert.equal(prepared.data.server, null);
  assert.equal(read.data.title, "Schedule review");
  assert.deepEqual(read.data.events, []);
});

test("expo-ios review-overlay server clears comments with DELETE", async () => {
  const project = await fs.mkdtemp(path.join(os.tmpdir(), "expo-ios-overlay-"));
  await fs.writeFile(path.join(project, "package.json"), JSON.stringify({ dependencies: { expo: "^54.0.0" } }));
  const outputDir = path.join(project, ".scratch", "codex-review-overlay");
  const fakeBin = path.join(project, "bin");
  const copiedPath = path.join(project, "copied.txt");
  let prepared;

  try {
    await fs.mkdir(fakeBin, { recursive: true });
    await fs.writeFile(path.join(fakeBin, "cliclick"), "#!/bin/sh\nprintf '200,400\\n'\n");
    await fs.writeFile(path.join(fakeBin, "osascript"), "#!/bin/sh\nprintf '100,200,400,800\\n'\n");
    await fs.writeFile(path.join(fakeBin, "pbcopy"), "#!/bin/sh\ncat > \"$PBCOPY_OUT\"\n");
    await fs.chmod(path.join(fakeBin, "cliclick"), 0o755);
    await fs.chmod(path.join(fakeBin, "osascript"), 0o755);
    await fs.chmod(path.join(fakeBin, "pbcopy"), 0o755);

    prepared = parseJson(await runCli([
      "--json",
      "review-overlay",
      "prepare",
      "--cwd",
      project,
      "--output-dir",
      outputDir,
      "--serve",
      "true",
    ], { env: { ...process.env, PATH: `${fakeBin}${path.delimiter}${process.env.PATH}`, PBCOPY_OUT: copiedPath } }));

    const endpoint = prepared.data.server.endpoint;
    await waitForHttpJson(`${prepared.data.server.url}health`);
    const pointer = await fetch(`${prepared.data.server.url}pointer?viewportWidth=300&viewportHeight=600`).then((response) => response.json());
    assert.equal(pointer.ok, true);
    assert.equal(pointer.inside, true);
    assert.deepEqual(pointer.point, { x: 75, y: 150 });

    const copied = await fetch(`${prepared.data.server.url}copy`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "## Page Feedback: /" }),
    }).then((response) => response.json());
    assert.equal(typeof copied.copied, "boolean");

    await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "review-1", type: "element", text: "clear me" }),
    });
    const loaded = await fetch(endpoint).then((response) => response.json());
    assert.equal(loaded.events.length, 1);
    const before = parseJson(await runCli([
      "--json",
      "review-overlay",
      "read",
      "--cwd",
      project,
      "--output-dir",
      outputDir,
    ]));
    assert.equal(before.data.events.length, 1);

    const cleared = await fetch(endpoint, { method: "DELETE" }).then((response) => response.json());
    const after = parseJson(await runCli([
      "--json",
      "review-overlay",
      "read",
      "--cwd",
      project,
      "--output-dir",
      outputDir,
    ]));

    assert.equal(cleared.ok, true);
    assert.equal(cleared.cleared, true);
    assert.equal(cleared.eventCount, 0);
    assert.deepEqual(after.data.events, []);
  } finally {
    if (prepared?.data?.server?.pid) {
      try {
        process.kill(prepared.data.server.pid);
      } catch {}
    }
  }
});

test("expo-ios review-overlay read can symbolicate element component stacks", async () => {
  const project = await fs.mkdtemp(path.join(os.tmpdir(), "expo-ios-overlay-"));
  const outputDir = path.join(project, ".scratch", "codex-review-overlay");
  await fs.mkdir(outputDir, { recursive: true });

  const symbolicator = http.createServer(async (request, response) => {
    assert.equal(request.url, "/symbolicate");
    assert.equal(request.method, "POST");
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({
      stack: [
        {
          methodName: "HourGuide",
          file: "/tmp/app/packages/features/console/src/native/ClinicCalendar.tsx",
          lineNumber: 857,
          column: 2,
          collapse: false,
        },
      ],
    }));
  });
  symbolicator.listen(0, "127.0.0.1");
  await once(symbolicator, "listening");
  const metroPort = symbolicator.address().port;

  try {
    await fs.writeFile(path.join(outputDir, "events.json"), JSON.stringify({
      version: 1,
      title: "Schedule review",
      createdAt: "2026-05-21T00:00:00.000Z",
      events: [
        {
          id: "review-1",
          type: "element",
          screenName: "Schedule",
          text: "Slot is ambiguous",
          createdAt: "2026-05-21T00:00:01.000Z",
          viewport: { width: 402, height: 874 },
          point: { x: 159, y: 438, nx: 0.39, ny: 0.5 },
          gesture: { durationMs: 100, dx: 0, dy: 0 },
          element: {
            frame: { left: 72, top: 391, width: 316, height: 82 },
            name: "View",
            source: null,
            componentStack: `\n    at HourGuide (http://127.0.0.1:${metroPort}/index.bundle:110379:22)`,
            hierarchy: [{ name: "HourGuide", selected: true }],
          },
        },
      ],
    }, null, 2));

    const read = parseJson(await runCli([
      "--json",
      "review-overlay",
      "read",
      "--cwd",
      project,
      "--output-dir",
      outputDir,
      "--metro-port",
      String(metroPort),
    ]));

    assert.equal(read.ok, true);
    assert.equal(read.data.symbolication.attempted, 1);
    assert.equal(read.data.symbolication.enriched, 1);
    assert.equal(read.data.events[0].element.source.fileName, "/tmp/app/packages/features/console/src/native/ClinicCalendar.tsx");
    assert.equal(read.data.events[0].element.source.lineNumber, 857);
    assert.equal(read.data.events[0].element.sourceLinks[0].methodName, "HourGuide");
  } finally {
    await closeServer(symbolicator);
  }
});

test("expo-ios CLI errors are machine-readable and credential-free", async () => {
  const result = await runCli(["--json", "trace", "--action", "read", "--metro-port", "nope"]);
  assert.equal(result.code, 2);

  const payload = JSON.parse(result.stderr);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, "invalid_usage");
  assert.equal(payload.error.exitCode, 2);
  assert.match(payload.error.message, /Expected a finite number/);
  assert.doesNotMatch(payload.error.message, /token|authorization|cookie/i);
});

test("standalone package exposes only the CLI path, with no MCP server config", async () => {
  const manifest = JSON.parse(await fs.readFile(new URL("package.json", PROJECT_ROOT), "utf8"));
  const readme = await fs.readFile(new URL("README.md", PROJECT_ROOT), "utf8");

  assert.deepEqual(manifest.bin, { "expo-ios": "./cli/expo-ios.mjs" });
  assert.equal(Object.hasOwn(manifest, "mcpServers"), false);
  await assert.rejects(fs.access(new URL(".mcp.json", PROJECT_ROOT)));
  assert.match(readme, /expo-ios --json/);
  assert.doesNotMatch(readme, /expo-local-dev|tool-call|mcp-tools/i);
});

test("removed adapter commands are not part of the CLI surface", async () => {
  const result = await runCli(["--json", "tool-call", "trace_interaction", "--args-json", "{}"]);
  assert.equal(result.code, 2);
  const payload = JSON.parse(result.stderr);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, "invalid_usage");
  assert.match(payload.error.message, /Unknown command: tool-call/);
});

test("expo-ios trace serializes Hermes Runtime.evaluate actions from the CLI path", async () => {
  const fake = await startFakeMetroHermes();
  try {
    const actions = ["start", "read", "stop"];
    const payloads = [];
    for (const action of actions) {
      payloads.push(parseJson(await runCli([
        "--json",
        "trace",
        "--action",
        action,
        "--metro-port",
        String(fake.metroPort),
        "--max-events",
        "5",
      ])));
    }

    for (const payload of payloads) {
      assert.equal(payload.ok, true);
      assert.equal(payload.data.protocolError, null);
      assert.equal(payload.data.trace.available, true);
      assert.equal(Object.hasOwn(payload.data.trace, "events"), false);
    }
    assert.deepEqual(fake.actions, actions);
    assert.equal(fake.maxConcurrentEvaluate, 1);
  } finally {
    await fake.close();
  }
});

test("expo-ios inspector serializes runtime inspector actions from the CLI path", async () => {
  const fake = await startFakeMetroHermes();
  try {
    const install = parseJson(await runCli([
      "--json",
      "inspector",
      "install-comment-menu",
      "--metro-port",
      String(fake.metroPort),
      "--comment-title",
      "Codex: Review note",
    ]));
    const read = parseJson(await runCli([
      "--json",
      "inspector",
      "read-comments",
      "--metro-port",
      String(fake.metroPort),
    ]));

    assert.equal(install.ok, true);
    assert.equal(install.data.protocolError, null);
    assert.equal(install.data.inspector.action, "install-comment-menu");
    assert.equal(install.data.inspector.installed, true);
    assert.equal(read.data.inspector.action, "read-comments");
    assert.deepEqual(read.data.inspector.comments, [{ text: "Current day is missing" }]);
    assert.deepEqual(fake.actions, ["install-comment-menu", "read-comments"]);
  } finally {
    await fake.close();
  }
});

async function startFakeMetroHermes(options = {}) {
  const host = options.host ?? "127.0.0.1";
  const websocket = await startFakeHermesWebSocket(options.websocket ?? {});
  const metro = http.createServer((request, response) => {
    if (request.url === "/status") {
      response.writeHead(200, { "content-type": "text/plain" });
      response.end("packager-status:running");
      return;
    }
    if (request.url === "/json/list") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify([
        {
          id: "hermes-1",
          title: "fake.app",
          appId: "fake.app",
          deviceName: "Fake Simulator",
          description: "Fake Hermes",
          devtoolsFrontendUrl: "http://127.0.0.1/devtools",
          webSocketDebuggerUrl: `ws://127.0.0.1:${websocket.port}/inspector`,
        },
      ]));
      return;
    }
    if (request.url === "/json/version") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ Browser: "React Native" }));
      return;
    }
    if (request.url === "/symbolicate" && request.method === "POST") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ stack: [] }));
      return;
    }
    response.writeHead(404).end();
  });
  metro.listen(0, host);
  await once(metro, "listening");
  const metroPort = metro.address().port;
  return {
    metroPort,
    actions: websocket.actions,
    get maxConcurrentEvaluate() {
      return websocket.maxConcurrentEvaluate;
    },
    async close() {
      await Promise.all([
        closeServer(metro),
        websocket.close(),
      ]);
    },
  };
}

async function createSnapshotRefFixture(options = {}) {
  const project = await fs.mkdtemp(path.join(os.tmpdir(), "expo-ios-ref-fixture-"));
  const fakeBin = path.join(project, "bin");
  const stateDir = path.join(project, ".scratch", "expo-ios", "runs");
  await fs.mkdir(fakeBin, { recursive: true });
  await writeExecutable(path.join(fakeBin, "xcrun"), `#!/bin/sh
if [ "$1 $2 $3 $4 $5" = "simctl list devices available --json" ]; then
  cat <<'JSON'
{"devices":{"com.apple.CoreSimulator.SimRuntime.iOS-18-0":[{"name":"iPhone 15","udid":"SIM-1","state":"Booted","isAvailable":true}]}}
JSON
  exit 0
fi
if [ "$1 $2" = "simctl io" ] && [ "$4" = "screenshot" ]; then
  printf 'fakepng' > "$5"
  echo "screenshot $5"
  exit 0
fi
echo "unexpected xcrun $*" >&2
exit 64
`);
  await writeExecutable(path.join(fakeBin, "axe"), `#!/bin/sh
if [ "$1" = "describe-ui" ]; then
  cat <<'JSON'
[{"role":"AXApplication","children":[{"role":"AXButton","AXLabel":"Add customer","testID":"add-customer","frame":{"x":20,"y":44,"width":160,"height":48},"source":{"file":"app/customers/index.tsx","line":42,"column":7}},{"role":"AXStaticText","AXLabel":"Customers","AXValue":"Customers","frame":{"x":20,"y":108,"width":220,"height":32}}]}]
JSON
  exit 0
fi
echo "unexpected axe $*" >&2
exit 64
`);
  const metro = await startFakeTargetMetro([
    {
      id: "metro-1",
      title: "Fixture App",
      appId: "com.example.fixture",
      deviceName: "iPhone 15",
      description: "Hermes target",
      webSocketDebuggerUrl: "ws://127.0.0.1:65530/inspector",
    },
  ]);
  const env = { ...process.env, PATH: `${fakeBin}${path.delimiter}${process.env.PATH}` };
  const session = parseJson(await runCli(["--json", "--state-dir", stateDir, "session", "new", "review"], { cwd: project }));
  const listed = parseJson(await runCli([
    "--json",
    "--state-dir",
    stateDir,
    "target",
    "list",
    "--metro-port",
    String(metro.port),
  ], { cwd: project, env }));
  const targetId = listed.data.targets[0].targetId;
  await runCli([
    "--json",
    "--state-dir",
    stateDir,
    "target",
    "select",
    targetId,
    "--metro-port",
    String(metro.port),
  ], { cwd: project, env });
  const snapshotArgs = [
    "--json",
    "--state-dir",
    stateDir,
    "snapshot",
    "--source",
    "--bounds",
  ];
  if (options.interactive !== false) snapshotArgs.push("--interactive");
  const snapshot = parseJson(await runCli(snapshotArgs, { cwd: project, env }));
  return {
    project,
    stateDir,
    targetId,
    refsPath: path.join(project, ".scratch", "expo-ios", "sessions", session.data.sessionId, "refs.json"),
    snapshot,
    env,
    close: () => metro.close().catch(() => {}),
  };
}

async function startFakeTargetMetro(targets, options = {}) {
  const metro = http.createServer((request, response) => {
    if (request.url === "/json/list") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(targets));
      return;
    }
    if (request.url === "/status") {
      response.writeHead(200, { "content-type": "text/plain" });
      response.end("packager-status:running");
      return;
    }
    if (request.url === "/json/version") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ Browser: "React Native" }));
      return;
    }
    if (request.url === "/symbolicate" && request.method === "POST") {
      const status = options.symbolicateStatus ?? 200;
      response.writeHead(status, { "content-type": "application/json" });
      response.end(JSON.stringify(status >= 200 && status < 300 ? { stack: [] } : { error: "symbolication failed" }));
      return;
    }
    response.writeHead(404).end();
  });
  metro.listen(0, "127.0.0.1");
  await once(metro, "listening");
  return {
    port: metro.address().port,
    close: () => closeServer(metro),
  };
}

async function startFakeHermesWebSocket(options = {}) {
  const actions = [];
  let activeEvaluate = 0;
  let maxConcurrentEvaluate = 0;
  const server = net.createServer((socket) => {
    let handshake = "";
    let data = Buffer.alloc(0);
    socket.on("data", async (chunk) => {
      if (!handshake.includes("\r\n\r\n")) {
        handshake += chunk.toString("utf8");
        if (!handshake.includes("\r\n\r\n")) return;
        const key = handshake.match(/sec-websocket-key: (.+)\r/i)?.[1]?.trim();
        const accept = crypto
          .createHash("sha1")
          .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
          .digest("base64");
        socket.write([
          "HTTP/1.1 101 Switching Protocols",
          "Upgrade: websocket",
          "Connection: Upgrade",
          `Sec-WebSocket-Accept: ${accept}`,
          "\r\n",
        ].join("\r\n"));
        const rest = chunk.subarray(Buffer.byteLength(handshake));
        if (rest.length) data = Buffer.concat([data, rest]);
      } else {
        data = Buffer.concat([data, chunk]);
      }

      let frame;
      while ((frame = readClientFrame(data))) {
        data = data.subarray(frame.bytes);
        if (frame.opcode === 8) {
          socket.end();
          break;
        }
        if (frame.opcode !== 1) continue;
        const message = JSON.parse(frame.text);
        if (message.method === "Runtime.enable") {
          socket.write(serverFrame(JSON.stringify({ id: message.id, result: {} })));
          if (options.invalidJsonAfterEnable) {
            socket.write(serverFrame("{not valid json"));
          }
          continue;
        }
        if (message.method === "Debugger.enable") {
          socket.write(serverFrame(JSON.stringify({ id: message.id, result: {} })));
          if (options.emitScriptParsed) {
            socket.write(serverFrame(JSON.stringify({
              method: "Debugger.scriptParsed",
              params: { url: "app:///index.bundle", scriptId: "1" },
            })));
          }
          continue;
        }
        if (message.method === "Runtime.getHeapUsage") {
          socket.write(serverFrame(JSON.stringify({ id: message.id, result: { usedSize: 1024, totalSize: 4096 } })));
          continue;
        }
        if (message.method === "Runtime.evaluate") {
          activeEvaluate += 1;
          maxConcurrentEvaluate = Math.max(maxConcurrentEvaluate, activeEvaluate);
          const isNavigation = message.params.expression.includes("__EXPO_IOS_NAVIGATION_BRIDGE__");
          const isNetwork = message.params.expression.includes("__EXPO_IOS_NETWORK_BRIDGE__");
          const isStorage = message.params.expression.includes("__EXPO_IOS_STORAGE_BRIDGE__");
          const isState = message.params.expression.includes("__EXPO_IOS_STATE_BRIDGE__");
          const isControls = message.params.expression.includes("__EXPO_IOS_CONTROLS_BRIDGE__");
          const isDialog = message.params.expression.includes("__EXPO_IOS_DIALOG_BRIDGE__");
          const isSheet = message.params.expression.includes("__EXPO_IOS_SHEET_BRIDGE__");
          const isRn = message.params.expression.includes("__EXPO_IOS_RN_BRIDGE__");
          const isPerf = message.params.expression.includes("__EXPO_IOS_PERF_BRIDGE__");
          const isSemantic = message.params.expression.includes("plugin-bridge-semantic") || message.params.expression.includes("snapshot.capture");
          const isBridgeHealth = message.params.expression.includes("__EXPO_IOS_BRIDGE_HEALTH__");
          const isDiagnostics = message.params.expression.includes("__EXPO_IOS_DIAGNOSTICS__");
          const kind = message.params.expression.match(/const kind = "([^"]+)"/)?.[1] ?? "console";
          const action = isSemantic ? "semantic-snapshot" : isBridgeHealth ? "bridge-health" : isDiagnostics ? kind : message.params.expression.match(/const action = "([^"]+)"/)?.[1] ?? "unknown";
          const isRuntimeInspector = message.params.expression.includes("__CODEX_SIMULATOR_REVIEW__");
          actions.push(action);
          await new Promise((resolve) => setTimeout(resolve, 75));
          activeEvaluate -= 1;
          if (options.closeOnEvaluate) {
            socket.end();
            continue;
          }
          if (options.timeoutEvaluate) {
            continue;
          }
          if (options.protocolError) {
            socket.write(serverFrame(JSON.stringify({
              id: message.id,
              error: {
                code: -32000,
                message: "Fixture protocol failure",
                data: { method: message.method },
              },
            })));
            continue;
          }
          const value = isNavigation
            ? typeof options.navigationValue === "function"
              ? options.navigationValue(action)
              : options.navigationValue ?? fakeNavigationValue(action)
            : isNetwork
            ? typeof options.networkValue === "function"
              ? options.networkValue(action)
              : options.networkValue ?? fakeNetworkValue(action)
            : isStorage
            ? typeof options.storageValue === "function"
              ? options.storageValue(message.params.expression, action)
              : options.storageValue ?? fakeStorageValue(message.params.expression, action)
            : isState
            ? fakeStateValue(action)
            : isControls
            ? typeof options.controlsValue === "function"
              ? options.controlsValue(action)
              : options.controlsValue ?? fakeControlsValue(action)
            : isDialog
            ? fakeModalValue("dialog", action)
            : isSheet
            ? fakeModalValue("sheet", action)
            : isRn
            ? fakeRnValue(action)
            : isPerf
            ? typeof options.perfValue === "function"
              ? options.perfValue(message.params.expression, action)
              : options.perfValue ?? fakePerfValue(message.params.expression, action)
            : isSemantic
            ? options.semanticValue ?? fakeSemanticValue()
            : isBridgeHealth
            ? options.bridgeHealth ?? fakeBridgeHealthValue()
            : isDiagnostics
            ? {
                available: true,
                source: "runtime-diagnostics-buffer",
                total: kind === "errors" ? 2 : 3,
                messages: kind === "errors"
                  ? [{ level: "error", message: "Unhandled promise rejection" }]
                  : [{ level: "warn", message: "Slow render" }],
                limitations: ["fixture diagnostics"],
              }
            : isRuntimeInspector
            ? {
                available: true,
                action,
                installed: action === "install-comment-menu",
                comments: action === "read-comments" ? [{ text: "Current day is missing" }] : [],
              }
            : {
                available: true,
                installed: action !== "stop",
                action,
                counts: { [action]: 1 },
                recentEvents: [{ type: action }],
              };
          socket.write(serverFrame(JSON.stringify({
            id: message.id,
            result: {
              result: {
                type: "object",
                value,
              },
            },
          })));
        }
      }
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return {
    port: server.address().port,
    actions,
    get maxConcurrentEvaluate() {
      return maxConcurrentEvaluate;
    },
    close: () => closeServer(server),
  };
}

async function startFakeMetroMessageSocket(options = {}) {
  const messages = [];
  const peerCounts = options.peerCounts ?? [1];
  let peerIndex = 0;
  const server = net.createServer((socket) => {
    let handshake = "";
    let data = Buffer.alloc(0);
    socket.on("data", (chunk) => {
      if (!handshake.includes("\r\n\r\n")) {
        handshake += chunk.toString("utf8");
        if (!handshake.includes("\r\n\r\n")) return;
        const key = handshake.match(/sec-websocket-key: (.+)\r/i)?.[1]?.trim();
        const accept = crypto
          .createHash("sha1")
          .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
          .digest("base64");
        socket.write([
          "HTTP/1.1 101 Switching Protocols",
          "Upgrade: websocket",
          "Connection: Upgrade",
          `Sec-WebSocket-Accept: ${accept}`,
          "\r\n",
        ].join("\r\n"));
        const rest = chunk.subarray(Buffer.byteLength(handshake));
        if (rest.length) data = Buffer.concat([data, rest]);
      } else {
        data = Buffer.concat([data, chunk]);
      }

      let frame;
      while ((frame = readClientFrame(data))) {
        data = data.subarray(frame.bytes);
        if (frame.opcode === 8) {
          socket.end();
          break;
        }
        if (frame.opcode !== 1) continue;
        const message = JSON.parse(frame.text);
        if (message.method === "getpeers" && message.target === "server") {
          if (options.timeoutGetPeers) continue;
          const peerCount = peerCounts[Math.min(peerIndex, peerCounts.length - 1)];
          peerIndex += 1;
          const result = {};
          for (let index = 0; index < peerCount; index += 1) {
            result[`app-peer-${index}`] = "platform=ios&device=iPhone";
          }
          socket.write(serverFrame(JSON.stringify({
            id: message.id,
            result,
          })));
          continue;
        }
        messages.push(message.method);
      }
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return {
    port: server.address().port,
    messages,
    close: () => closeServer(server),
  };
}

function fakeNetworkValue(action) {
  const request = {
    id: "req-1",
    method: "GET",
    url: "https://api.example.test/customers?token=secret-token&status=open",
    startedAt: "2026-05-22T10:00:00.000Z",
    durationMs: 42,
    headers: {
      authorization: "Bearer secret-token",
      cookie: "sid=secret-cookie",
      accept: "application/json",
    },
    response: {
      status: 200,
      headers: {
        "set-cookie": "sid=secret-cookie",
        "content-type": "application/json",
      },
      body: "{\"token\":\"secret-token\"}",
    },
  };
  if (action === "status") {
    return {
      available: true,
      action,
      source: "plugin-bridge",
      domain: "network",
      bridgeVersion: "1.0.0",
      hooks: { fetch: true, xhr: true },
    };
  }
  if (action === "requests") {
    return { available: true, action, source: "plugin-bridge", domain: "network", bridgeVersion: "1.0.0", requests: [request] };
  }
  if (action === "request") {
    return { available: true, action, source: "plugin-bridge", domain: "network", bridgeVersion: "1.0.0", request };
  }
  if (action === "har-start") {
    return { available: true, action, source: "plugin-bridge", domain: "network", bridgeVersion: "1.0.0", started: true };
  }
  if (action === "har-stop") {
    return {
      available: true,
      action,
      source: "plugin-bridge",
      domain: "network",
      bridgeVersion: "1.0.0",
      har: {
        log: {
          version: "1.2",
          creator: { name: "fixture", version: "1" },
          entries: [
            {
              startedDateTime: request.startedAt,
              time: request.durationMs,
              request: {
                method: request.method,
                url: request.url,
                headers: request.headers,
                cookies: [{ name: "sid", value: "secret-cookie" }],
              },
              response: {
                status: 200,
                headers: request.response.headers,
                content: { text: request.response.body },
              },
            },
          ],
        },
      },
      requests: [request],
    };
  }
  return { available: true, action, source: "app-instrumentation", cleared: true };
}

function fakeStorageValue(expression, action) {
  const store = expression.match(/const store = "([^"]+)"/)?.[1] ?? "async";
  const key = expression.match(/const key = "([^"]+)"/)?.[1] ?? "auth";
  if (store === "secure") {
    return { available: false, source: "plugin-bridge", domain: "storage", code: "missing-domain", reason: "Unsupported storage store.", store, action };
  }
  if (action === "list") {
    return { available: true, source: "plugin-bridge", domain: "storage", bridgeVersion: "1.0.0", store, action, keys: ["auth", "featureFlags"] };
  }
  if (action === "get") {
    return {
      available: true,
      source: "plugin-bridge",
      domain: "storage",
      bridgeVersion: "1.0.0",
      store,
      action,
      key,
      value: { token: "secret-token", theme: "dark" },
    };
  }
  return {
    available: true,
    source: "plugin-bridge",
    domain: "storage",
    bridgeVersion: "1.0.0",
    store,
    action,
    key,
    before: { token: "old-secret-token" },
    after: { token: "secret-token" },
    result: { ok: true },
  };
}

function fakeRnValue(action) {
  const limitations = ["fixture preserves private React Native hooks limitations"];
  if (action === "tree") {
    return {
      available: true,
      action,
      sources: ["runtime", "app-instrumentation"],
      tree: [{ name: "App", children: [{ name: "CustomerList", children: [] }] }],
      limitations,
    };
  }
  if (action === "fiber") {
    return {
      available: false,
      action,
      sources: ["runtime", "app-instrumentation"],
      reason: "Fiber details are unavailable in this fixture.",
      limitations,
    };
  }
  return {
    available: true,
    action,
    sources: ["runtime", "app-instrumentation"],
    renders: {
      recording: action === "renders-start",
      commits: action === "renders-stop" ? 2 : 0,
    },
    limitations,
  };
}

function fakePerfValue(expression, action) {
  const label = expression.match(/const label = "([^"]+)"/)?.[1] ?? null;
  if (action === "mark-list") {
    return {
      available: true,
      source: "plugin-bridge-performance",
      sources: ["plugin-bridge", "rozenite-performance"],
      marks: [{ name: "app.ready", startTime: 820 }],
      measures: [],
      metrics: [{ name: "marks.count", value: 1, unit: "count", source: "rozenite-performance", confidence: "medium" }],
    };
  }
  if (action === "measure-start") {
    return {
      available: true,
      source: "plugin-bridge-performance",
      sources: ["plugin-bridge", "rozenite-performance"],
      measure: { name: label, status: "started" },
      metrics: [],
    };
  }
  if (action === "measure-stop") {
    return {
      available: true,
      source: "plugin-bridge-performance",
      sources: ["plugin-bridge", "rozenite-performance"],
      measure: { name: label, status: "stopped", durationMs: 64 },
      metrics: [{ name: `measure.${label}.duration`, value: 64, unit: "ms", source: "rozenite-performance", confidence: "medium" }],
    };
  }
  if (action === "startup") {
    return {
      available: true,
      source: "plugin-bridge-performance",
      sources: ["plugin-bridge", "rozenite-performance"],
      mode: "development",
      metrics: [
        { name: "startup.ready", value: 820, unit: "ms", source: "rozenite-performance", confidence: "medium" },
      ],
      limitations: ["fixture startup metric"],
    };
  }
  return {
    available: true,
    source: "plugin-bridge-performance",
      sources: ["plugin-bridge", "rozenite-performance"],
    mode: "development",
    actionName: label,
    metrics: [
      { name: "interaction.duration", value: 145, unit: "ms", source: "rozenite-performance", confidence: "medium" },
      { name: "interaction.renderCommits", value: 2, unit: "count", source: "react-devtools-hook", confidence: "medium" },
    ],
    limitations: ["fixture action metric"],
  };
}

function fakeBridgeHealthValue(overrides = {}) {
  return {
    available: true,
    registered: true,
    appRegistration: { registered: true, appId: "com.maddie.native", runtimeName: "Maddie Native" },
    bridgeVersion: "1.0.0",
    domains: [
      {
        name: "navigation",
        readCommands: ["state"],
        writeCommands: ["back", "pop-to-root", "tab", "deep-link"],
        redactionBoundaries: ["route params", "query values"],
      },
      {
        name: "storage",
        readCommands: ["list", "get"],
        writeCommands: ["set", "clear"],
        redactionBoundaries: ["keys", "values", "secure-store values"],
      },
      {
        name: "rn",
        readCommands: ["tree", "inspect", "fiber"],
        writeCommands: [],
        redactionBoundaries: ["props", "text content"],
      },
    ],
    ...overrides,
  };
}

function fakeSemanticValue(overrides = {}) {
  return {
    available: true,
    source: "plugin-bridge-semantic",
    bridgeVersion: "1.0.0",
    routeHint: "/customers",
    refs: [
      {
        role: "button",
        label: "Add customer",
        testID: "add-customer",
        component: "AddCustomerButton",
        source: { file: "app/customers/index.tsx", line: 42, column: 7 },
        box: { x: 20, y: 44, width: 160, height: 48 },
        actions: ["tap"],
        raw: { token: "secret-token" },
      },
      {
        role: "text",
        text: "Customers",
        box: { x: 20, y: 108, width: 220, height: 32 },
        actions: [],
      },
    ],
    limitations: ["fixture semantic bridge"],
    ...overrides,
  };
}

function fakeNavigationValue(action, overrides = {}) {
  return {
    available: true,
    action,
    source: "plugin-bridge",
    domain: "navigation",
    bridgeVersion: "1.0.0",
    state: action === "state" ? { route: "/customers", index: 1, routes: ["/", "/customers"] } : null,
    tab: action === "tab" ? "settings" : null,
    result: action === "state" ? null : { ok: true, action },
    ...overrides,
  };
}

function fakeStateValue(action) {
  if (action === "list") {
    return { available: true, source: "app-instrumentation", action, states: [{ name: "logged-in", savedAt: "2026-05-22T10:00:00.000Z" }] };
  }
  return { available: true, source: "app-instrumentation", action, result: { ok: true } };
}

function fakeControlsValue(action) {
  const controls = [
    { name: "refreshCustomers", title: "Refresh customers", sideEffects: "network" },
  ];
  if (action === "list") return { available: true, source: "plugin-bridge", domain: "controls", bridgeVersion: "1.0.0", action, controls };
  if (action === "get") return { available: true, source: "plugin-bridge", domain: "controls", bridgeVersion: "1.0.0", action, name: "refreshCustomers", control: controls[0] };
  return { available: true, source: "plugin-bridge", domain: "controls", bridgeVersion: "1.0.0", action, name: "refreshCustomers", before: controls[0], after: controls[0], result: { pressed: true } };
}

function fakeModalValue(domain, action) {
  if (action === "status") {
    return {
      available: true,
      source: "app-instrumentation",
      action,
      visible: true,
      [domain]: domain === "dialog"
        ? { title: "Delete customer?", buttons: ["Cancel", "Delete"] }
        : { title: "Filters", detent: "medium" },
    };
  }
  return {
    available: true,
    source: "app-instrumentation",
    action,
    result: action === "accept" ? { accepted: true } : { dismissed: true },
  };
}

function readClientFrame(buffer) {
  if (buffer.length < 2) return null;
  const second = buffer[1];
  let length = second & 0x7f;
  let offset = 2;
  if (length === 126) {
    if (buffer.length < 4) return null;
    length = buffer.readUInt16BE(2);
    offset = 4;
  } else if (length === 127) {
    throw new Error("Test websocket does not support 64-bit frames.");
  }
  const masked = (second & 0x80) !== 0;
  const maskLength = masked ? 4 : 0;
  if (buffer.length < offset + maskLength + length) return null;
  const mask = masked ? buffer.subarray(offset, offset + 4) : null;
  offset += maskLength;
  const payload = Buffer.from(buffer.subarray(offset, offset + length));
  if (mask) {
    for (let i = 0; i < payload.length; i += 1) payload[i] ^= mask[i % 4];
  }
  return {
    bytes: offset + length,
    opcode: buffer[0] & 0x0f,
    text: payload.toString("utf8"),
  };
}

function serverFrame(text) {
  const payload = Buffer.from(text, "utf8");
  if (payload.length < 126) {
    return Buffer.concat([Buffer.from([0x81, payload.length]), payload]);
  }
  const header = Buffer.alloc(4);
  header[0] = 0x81;
  header[1] = 126;
  header.writeUInt16BE(payload.length, 2);
  return Buffer.concat([header, payload]);
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

async function waitForHttpJson(url, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return response.json();
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw lastError ?? new Error(`Timed out waiting for ${url}`);
}
