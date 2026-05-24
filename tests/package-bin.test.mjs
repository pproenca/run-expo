import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { access, chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { WebSocketServer } from "ws";

const execFileAsync = promisify(execFile);
const sanitizedEnv = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.toLowerCase().startsWith("npm_config_")),
);
const npxEnv = {
  ...sanitizedEnv,
  npm_config_cache: resolve(tmpdir(), "expo98-npm-cache"),
};
const missingAdapterMessagePattern = new RegExp([
  "adapter is not",
  "configured",
].join(" "), "i");
const missingEvaluatorMessagePattern = new RegExp([
  "evaluator dependency is not",
  "configured",
].join(" "), "i");
const oldSemanticBridgeMessagePattern = new RegExp([
  "Semantic bridge adapter is not",
  "configured",
].join(" "), "i");

async function makeFixtureProject(prefix = "expo98-fixture-") {
  const project = await mkdtemp(resolve(tmpdir(), prefix));
  await writeFile(resolve(project, "package.json"), JSON.stringify({ name: "fixture" }), "utf8");
  return project;
}

async function runJson(args, options = {}) {
  const { stdout } = await execFileAsync(process.execPath, ["cli/expo98.mjs", "--json", ...args], options);
  return JSON.parse(stdout);
}

async function makeFakeHermesMetro(valueForExpression) {
  const expressions = [];
  let lastOrigin = null;
  let port = 0;
  const server = createServer((req, res) => {
    if (req.url?.startsWith("/json/list")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify([{
        id: "fake-target",
        title: "Fake Hermes Target",
        description: "React Native fake target",
        appId: "com.example.fake",
        deviceName: "iPhone 16",
        devtoolsFrontendUrl: `http://localhost:${port}/debugger-frontend`,
        webSocketDebuggerUrl: `ws://localhost:${port}/inspector/debug?device=1&page=1`,
        reactNative: {},
      }]));
      return;
    }
    if (req.url?.startsWith("/status")) {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("packager-status:running");
      return;
    }
    if (req.url?.startsWith("/symbolicate")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ stack: [] }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  const wss = new WebSocketServer({ noServer: true });
  server.on("upgrade", (req, socket, head) => {
    lastOrigin = req.headers.origin ?? null;
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
  });
  wss.on("connection", (ws) => {
    ws.on("message", (message) => {
      const parsed = JSON.parse(String(message));
      if (parsed.method === "Runtime.evaluate") {
        expressions.push(String(parsed.params?.expression ?? ""));
        const value = typeof valueForExpression === "function"
          ? valueForExpression(String(parsed.params?.expression ?? ""))
          : valueForExpression;
        ws.send(JSON.stringify({ id: parsed.id, result: { result: { type: "object", value } } }));
        return;
      }
      ws.send(JSON.stringify({ id: parsed.id, result: {} }));
    });
  });
  await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  port = server.address().port;
  return {
    port,
    expressions,
    get origin() {
      return lastOrigin;
    },
    close: async () => {
      await new Promise((resolveClose) => wss.close(resolveClose));
      await new Promise((resolveClose) => server.close(resolveClose));
    },
  };
}

describe("expo98 package bin", () => {
  it("prints the modernized package version through the direct bin", async () => {
    const { stdout, stderr } = await execFileAsync(process.execPath, ["cli/expo98.mjs", "--version"]);

    assert.equal(stdout, "0.1.0\n");
    assert.equal(stderr, "");
  });

  it("runs the npx-facing binary from the package root without installing from the network", async () => {
    const { stdout, stderr } = await execFileAsync("npx", ["--no-install", "expo98", "--version"], { env: npxEnv });

    assert.equal(stdout, "0.1.0\n");
    assert.equal(stderr, "");
  });

  it("runs the local pnpm expo98 script for development testing", async () => {
    const { stdout, stderr } = await execFileAsync("pnpm", ["expo98", "--version"], { env: npxEnv });

    assert.match(stdout, /0\.1\.0\n$/);
    assert.equal(stderr, "");
  });

  it("returns JSON doctor evidence from the modernized package entrypoint", async () => {
    const { stdout } = await execFileAsync(process.execPath, ["cli/expo98.mjs", "--json", "doctor"]);
    const payload = JSON.parse(stdout);

    assert.equal(payload.ok, true);
    assert.equal(payload.data.cli.name, "expo98");
    assert.equal(payload.data.cli.bin, "expo98");
    assert.equal(payload.data.package.compatibilityBin, "expo-ios");
    assert.equal(payload.data.runtime.supported, true);
  });

  it("dispatches bundled project-info and policy commands without monorepo package imports", async () => {
    const project = await makeFixtureProject("expo98-package-bin-");
    try {
      await writeFile(resolve(project, "package.json"), JSON.stringify({
        dependencies: {
          expo: "~54.0.0",
          "react-native": "0.81.0",
          "expo-router": "^5.0.0",
        },
      }), "utf8");

      const projectInfo = await execFileAsync(process.execPath, [
        "cli/expo98.mjs",
        "--json",
        "project-info",
        "--cwd",
        project,
      ]);
      const policy = await execFileAsync(process.execPath, ["cli/expo98.mjs", "--json", "policy", "show"]);

      const projectPayload = JSON.parse(projectInfo.stdout);
      const policyPayload = JSON.parse(policy.stdout);

      assert.equal(projectPayload.ok, true);
      assert.equal(projectPayload.data.isExpoProject, true);
      assert.equal(projectPayload.data.expoDependency, "~54.0.0");
      assert.equal(projectPayload.data.expoRouterDependency, "^5.0.0");
      assert.equal(policyPayload.ok, true);
      assert.equal(policyPayload.data.available, true);
      assert.equal(policyPayload.data.action, "show");
    } finally {
      await rm(project, { recursive: true, force: true });
    }
  });

  it("denies route-opening device mutations without an action policy", async () => {
    const project = await makeFixtureProject("expo98-route-policy-");
    try {
      await writeFile(resolve(project, "app.json"), JSON.stringify({ expo: { scheme: "fixture" } }), "utf8");

      const openUrlPayload = await runJson(["open-url", "fixture:///customers"]);
      const openRoutePayload = await runJson(["open-route", "/customers", "--cwd", project]);

      assert.equal(openUrlPayload.ok, true);
      assert.equal(openUrlPayload.data.available, false);
      assert.equal(openUrlPayload.data.code, "policy-denied");
      assert.equal(openUrlPayload.data.denied, true);
      assert.equal(openUrlPayload.data.policy.action, "open-url");

      assert.equal(openRoutePayload.ok, true);
      assert.equal(openRoutePayload.data.available, false);
      assert.equal(openRoutePayload.data.code, "policy-denied");
      assert.equal(openRoutePayload.data.denied, true);
      assert.equal(openRoutePayload.data.policy.action, "open-route");
    } finally {
      await rm(project, { recursive: true, force: true });
    }
  });

  it("denies state save without an action policy", async () => {
    const payload = await runJson(["state", "save", "checkpoint"]);

    assert.equal(payload.ok, true);
    assert.equal(payload.data.available, false);
    assert.equal(payload.data.domain, "state");
    assert.equal(payload.data.action, "save");
    assert.equal(payload.data.code, "policy-denied");
    assert.equal(payload.data.policy.action, "state.save");
  });

  it("denies open-dev-menu without an action policy before runtime mutation", async () => {
    const payload = await runJson(["open-dev-menu"]);

    assert.equal(payload.ok, true);
    assert.equal(payload.data.available, false);
    assert.equal(payload.data.domain, "runtime-inspector");
    assert.equal(payload.data.action, "open-dev-menu");
    assert.equal(payload.data.code, "policy-denied");
    assert.equal(payload.data.policy.action, "open-dev-menu");
  });

  it("prepares annotate-screen as an in-app overlay without HTML board artifacts", async () => {
    const project = await makeFixtureProject("expo98-annotate-prepare-");
    try {
      const payload = await runJson([
        "--root",
        project,
        "annotate-screen",
        "prepare",
        "--output-dir",
        resolve(project, "annotations"),
        "--serve",
        "false",
      ]);

      assert.equal(payload.ok, true);
      assert.equal(payload.data.command, "annotate-screen");
      assert.equal(payload.data.annotationSurface, "in-app-overlay");
      assert.equal(payload.data.compatibility.legacyBoard, "removed");
      assert.equal(payload.data.outputDir, resolve(project, "annotations"));
      assert.equal(payload.data.eventsPath, resolve(project, "annotations", "events.json"));
      assert.equal(payload.data.server, null);
      assert.equal(Object.hasOwn(payload.data, "htmlPath"), false);
      assert.equal(Object.hasOwn(payload.data, "screenshotPath"), false);
      assert.equal(Object.hasOwn(payload.data, "contextPath"), false);
      assert.doesNotMatch(JSON.stringify(payload), /annotate\.html|file:\/\/|browser board/i);
    } finally {
      await rm(project, { recursive: true, force: true });
    }
  });

  it("requires explicit confirmation before annotate-screen scaffolds app files", async () => {
    const project = await makeFixtureProject("expo98-annotate-refusal-");
    const overlayDir = resolve(project, "codex-review-overlay");
    try {
      const payload = await runJson(["--root", project, "annotate-screen", "scaffold"]);

      assert.equal(payload.ok, true);
      assert.equal(payload.data.available, false);
      assert.equal(payload.data.code, "confirmation-required");
      assert.equal(payload.data.requiredConfirmation, "annotate-overlay-scaffold");
      assert.equal(payload.data.mutation.writesAppFiles, true);
      await assert.rejects(access(overlayDir));
    } finally {
      await rm(project, { recursive: true, force: true });
    }
  });

  it("delegates confirmed annotate-screen scaffold to the review overlay implementation", async () => {
    const project = await makeFixtureProject("expo98-annotate-scaffold-");
    try {
      const payload = await runJson([
        "--root",
        project,
        "annotate-screen",
        "scaffold",
        "--confirm-actions",
        "annotate-overlay-scaffold",
      ]);

      assert.equal(payload.ok, true);
      assert.equal(payload.data.command, "annotate-screen");
      assert.equal(payload.data.annotationSurface, "in-app-overlay");
      assert.equal(payload.data.componentPath, resolve(project, "codex-review-overlay", "CodexReviewOverlay.tsx"));
      assert.equal(payload.data.indexPath, resolve(project, "codex-review-overlay", "index.ts"));
      assert.match(payload.data.integration.import, /CodexReviewOverlay/);
      await access(payload.data.componentPath);
      await access(payload.data.indexPath);
    } finally {
      await rm(project, { recursive: true, force: true });
    }
  });

  it("returns annotation-server as a deprecation response instead of serving the old HTML workflow", async () => {
    const project = await makeFixtureProject("expo98-annotation-server-");
    try {
      const payload = await runJson(["annotation-server", "--dir", resolve(project, "annotations")]);

      assert.equal(payload.ok, true);
      assert.equal(payload.data.available, false);
      assert.equal(payload.data.action, "annotation-server");
      assert.equal(payload.data.code, "external-annotation-server-removed");
      assert.match(payload.data.replacement.prepare, /annotate-screen prepare --serve true/);
      assert.doesNotMatch(JSON.stringify(payload), /annotate\.html|file:\/\//i);
    } finally {
      await rm(project, { recursive: true, force: true });
    }
  });

  it("resolves iOS devices for interaction commands when simctl device JSON is large", async () => {
    const project = await makeFixtureProject("expo98-large-simctl-");
    const fakeBin = resolve(project, "bin");
    const policyPath = resolve(project, "policy.json");
    try {
      await mkdir(fakeBin, { recursive: true });
      const devices = Array.from({ length: 900 }, (_, index) => ({
        name: `iPhone Fixture ${index}`,
        udid: `00000000-0000-0000-0000-${String(index).padStart(12, "0")}`,
        state: index === 123 ? "Booted" : "Shutdown",
        isAvailable: true,
      }));
      const simctlPayload = JSON.stringify({ devices: { "com.apple.CoreSimulator.SimRuntime.iOS-99-0": devices } });
      assert.ok(Buffer.byteLength(simctlPayload) > 40_000);
      const xcrunPath = resolve(fakeBin, "xcrun");
      const axePath = resolve(fakeBin, "axe");
      await writeFile(xcrunPath, `#!/bin/sh\nprintf '%s\\n' '${simctlPayload}'\n`, "utf8");
      await writeFile(axePath, "#!/bin/sh\nexit 0\n", "utf8");
      await chmod(xcrunPath, 0o755);
      await chmod(axePath, 0o755);
      await writeFile(policyPath, JSON.stringify({ allow: ["keyboard.press"] }), "utf8");

      const payload = await runJson([
        "--root",
        project,
        "press",
        "--key",
        "Return",
        "--dry-run",
        "true",
        "--action-policy",
        policyPath,
      ], {
        env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH ?? ""}` },
      });

      assert.equal(payload.ok, true);
      assert.equal(payload.data.available, true);
      assert.equal(payload.data.device.name, "iPhone Fixture 123");
      assert.equal(payload.data.device.state, "Booted");
    } finally {
      await rm(project, { recursive: true, force: true });
    }
  });

  it("honors highlight output-path and refuses zero-sized bounds", async () => {
    const project = await makeFixtureProject("expo98-highlight-");
    const sessionDir = resolve(project, ".scratch", "expo98", "sessions", "s1");
    const outputPath = resolve(project, "custom-highlight.svg");
    try {
      await mkdir(sessionDir, { recursive: true });
      await writeFile(resolve(sessionDir, "session.json"), JSON.stringify({
        sessionId: "s1",
        createdAt: "2026-05-24T00:00:00.000Z",
        updatedAt: "2026-05-24T00:00:00.000Z",
        lastSnapshotId: "snap1",
      }), "utf8");
      await writeFile(resolve(sessionDir, "refs.json"), JSON.stringify({
        snapshotId: "snap1",
        targetId: "target1",
        refs: [
          { ref: "@e1", stale: false, label: "Save", box: { x: 10, y: 20, width: 80, height: 30 }, actions: ["tap"] },
          { ref: "@e2", stale: false, label: "Empty", box: { x: 0, y: 0, width: 0, height: 0 }, actions: [] },
        ],
      }), "utf8");

      const highlighted = await runJson(["--root", project, "highlight", "@e1", "--output-path", outputPath]);
      assert.equal(highlighted.ok, true);
      assert.equal(highlighted.data.available, true);
      assert.equal(highlighted.data.outputPath, outputPath);
      await access(outputPath);

      const zeroSized = await runJson(["--root", project, "highlight", "@e2"]);
      assert.equal(zeroSized.ok, true);
      assert.equal(zeroSized.data.available, false);
      assert.match(zeroSized.data.reason, /zero-sized/);
    } finally {
      await rm(project, { recursive: true, force: true });
    }
  });

  it("performs ref-backed tap actions from the current snapshot cache", async () => {
    const project = await makeFixtureProject("expo98-ref-tap-");
    const fakeBin = resolve(project, "bin");
    const sessionDir = resolve(project, ".scratch", "expo98", "sessions", "s1");
    const policyPath = resolve(project, "policy.json");
    try {
      await mkdir(fakeBin, { recursive: true });
      await mkdir(sessionDir, { recursive: true });
      const simctlPayload = JSON.stringify({
        devices: {
          "com.apple.CoreSimulator.SimRuntime.iOS-99-0": [{
            name: "iPhone Fixture",
            udid: "00000000-0000-0000-0000-000000000123",
            state: "Booted",
            isAvailable: true,
          }],
        },
      });
      await writeFile(resolve(fakeBin, "xcrun"), `#!/bin/sh\nprintf '%s\\n' '${simctlPayload}'\n`, "utf8");
      await writeFile(resolve(fakeBin, "idb"), "#!/bin/sh\nexit 0\n", "utf8");
      await writeFile(resolve(fakeBin, "axe"), "#!/bin/sh\nexit 0\n", "utf8");
      await chmod(resolve(fakeBin, "xcrun"), 0o755);
      await chmod(resolve(fakeBin, "idb"), 0o755);
      await chmod(resolve(fakeBin, "axe"), 0o755);
      await writeFile(policyPath, JSON.stringify({ allow: ["tap"] }), "utf8");
      await writeFile(resolve(sessionDir, "session.json"), JSON.stringify({
        sessionId: "s1",
        createdAt: "2026-05-24T00:00:00.000Z",
        updatedAt: "2026-05-24T00:00:00.000Z",
        lastSnapshotId: "snap1",
      }), "utf8");
      await writeFile(resolve(sessionDir, "refs.json"), JSON.stringify({
        snapshotId: "snap1",
        targetId: "target1",
        refs: [{ ref: "@e1", stale: false, label: "Send", box: { x: 20, y: 40, width: 100, height: 50 }, actions: ["tap"] }],
      }), "utf8");

      const payload = await runJson([
        "--root",
        project,
        "tap",
        "@e1",
        "--action-policy",
        policyPath,
      ], {
        env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH ?? ""}` },
      });

      assert.equal(payload.ok, true);
      assert.equal(payload.data.x, 70);
      assert.equal(payload.data.y, 65);
      assert.equal(payload.data.stderr, "");
    } finally {
      await rm(project, { recursive: true, force: true });
    }
  });

  it("uses Hermes CDP with a Metro Origin header for rn tree", async () => {
    const metro = await makeFakeHermesMetro({
      available: true,
      source: "app-instrumentation",
      tree: [{ component: "ScheduleRoute", label: "View.", actions: ["tap"] }],
    });
    try {
      const payload = await runJson(["rn", "tree", "--metro-port", String(metro.port)]);

      assert.equal(payload.ok, true);
      assert.equal(payload.data.available, true);
      assert.equal(payload.data.domain, "rn");
      assert.equal(payload.data.action, "tree");
      assert.equal(payload.data.source, "app-instrumentation");
      assert.equal(metro.origin, `http://127.0.0.1:${metro.port}`);
      assert.equal(metro.expressions.some((expression) => expression.includes("__EXPO_IOS_RN_BRIDGE__")), true);
    } finally {
      await metro.close();
    }
  });

  it("returns agent-relevant rn tree summaries by default and keeps raw evidence opt-in", async () => {
    const nativeInspectorPayload = {
      available: true,
      source: "native-inspector",
      evidenceSource: "native-inspector",
      elementCount: 3,
      viewport: { width: 402, height: 874, scale: 3 },
      elements: [
        {
          name: "Text",
          label: "Secure clinic sign-in",
          frame: { left: 72, top: 248, width: 257, height: 35 },
          componentStack: "large stack should not be returned by default",
          hierarchy: [
            { name: "withDevTools(App)" },
            { name: "RootLayout(./_layout.tsx)" },
            { name: "Route(index)" },
            { name: "ScheduleRoute(./index.tsx)" },
            { name: "SignIn" },
            { name: "SignInIntro" },
            { name: "Text" },
            { name: "RCTText" },
          ],
        },
        {
          name: "View",
          role: "button",
          testID: "native-send-magic-link",
          frame: { left: 28, top: 559, width: 345, height: 46 },
          hierarchy: [
            { name: "RootLayout(./_layout.tsx)" },
            { name: "Route(index)" },
            { name: "ScheduleRoute(./index.tsx)" },
            { name: "SignIn" },
            { name: "ConsoleButton" },
            { name: "Pressable" },
            { name: "View" },
            { name: "RCTView" },
          ],
        },
        {
          name: "Text",
          label: "Send sign-in link",
          frame: { left: 135, top: 570, width: 132, height: 24 },
          hierarchy: [
            { name: "RootLayout(./_layout.tsx)" },
            { name: "Route(index)" },
            { name: "ScheduleRoute(./index.tsx)" },
            { name: "SignIn" },
            { name: "ConsoleButton" },
            { name: "Text" },
            { name: "RCTText" },
          ],
        },
      ],
      tree: [{
        name: "withDevTools(App)",
        children: [{
          name: "RootLayout(./_layout.tsx)",
          children: [{
            name: "Route(index)",
            children: [{
              name: "ScheduleRoute(./index.tsx)",
              children: [{ name: "SignIn" }],
            }],
          }],
        }],
      }],
      transport: { cdp: { connectedUrl: "ws://localhost/inspector/debug" } },
    };
    const metro = await makeFakeHermesMetro(nativeInspectorPayload);
    try {
      const concise = await runJson(["rn", "tree", "--metro-port", String(metro.port)]);

      assert.equal(concise.ok, true);
      assert.equal(concise.data.available, true);
      assert.equal(concise.data.source, "native-inspector");
      assert.equal(concise.data.counts.visibleText, 2);
      assert.equal(concise.data.controls[0].testID, "native-send-magic-link");
      assert.equal(concise.data.controls[0].label, "Send sign-in link");
      assert.deepEqual(concise.data.screen.path.slice(0, 4), [
        "RootLayout(./_layout.tsx)",
        "Route(index)",
        "ScheduleRoute(./index.tsx)",
        "SignIn",
      ]);
      assert.equal(concise.data.rawAvailable, true);
      assert.equal("elements" in concise.data, false);
      assert.equal("transport" in concise.data, false);
      assert.doesNotMatch(JSON.stringify(concise), /componentStack|inspector\/debug/);

      const raw = await runJson(["rn", "tree", "--metro-port", String(metro.port), "--raw", "true"]);
      assert.equal(Array.isArray(raw.data.elements), true);
      assert.match(JSON.stringify(raw), /componentStack|inspector\/debug/);
    } finally {
      await metro.close();
    }
  });

  it("reads console diagnostics through the shared Hermes evaluator", async () => {
    const metro = await makeFakeHermesMetro({
      available: true,
      source: "runtime-diagnostics-buffer",
      total: 1,
      messages: [{ level: "log", message: "hello", timestamp: null }],
    });
    try {
      const payload = await runJson(["console", "--metro-port", String(metro.port)]);

      assert.equal(payload.ok, true);
      assert.equal(payload.data.available, true);
      assert.equal(payload.data.kind, "console");
      assert.equal(payload.data.messages[0].message, "hello");
      assert.equal(metro.origin, `http://127.0.0.1:${metro.port}`);
      assert.doesNotMatch(JSON.stringify(payload), missingAdapterMessagePattern);
      assert.doesNotMatch(JSON.stringify(payload), missingEvaluatorMessagePattern);
    } finally {
      await metro.close();
    }
  });

  it("returns metadata-only network waterfall evidence with real validation", async () => {
    const metro = await makeFakeHermesMetro({
      available: true,
      source: "app-instrumentation",
      requests: [{
        id: "req-1",
        method: "GET",
        url: "http://localhost:3000/api/console/customers?token=secret",
        startedAt: "2026-05-24T10:00:00.000Z",
        durationMs: 640,
        status: 200,
        body: "must-not-leak",
        postData: "must-not-leak",
        headers: { authorization: "Bearer secret", accept: "application/json" },
        response: { status: 200, content: { text: "must-not-leak" }, encodedBodySize: 512 },
        initiator: { route: "/", screen: "Schedule", interactionId: "i1", queryKey: "customers" },
      }],
    });
    try {
      const payload = await runJson(["network", "waterfall", "--metro-port", String(metro.port)]);
      const serialized = JSON.stringify(payload);

      assert.equal(payload.ok, true);
      assert.equal(payload.data.available, true);
      assert.equal(payload.data.waterfall.slowRequestCount, 1);
      assert.equal(payload.data.requests[0].origin, "http://localhost:3000");
      assert.equal(payload.data.requests[0].path, "/api/console/customers?token=[redacted]");
      assert.equal(payload.data.realValidation.claimsAllowed.networkLatency, true);
      assert.equal(payload.data.realValidation.claimsAllowed.networkWaterfall, true);
      assert.doesNotMatch(serialized, /must-not-leak|Bearer secret/);
      assert.doesNotMatch(serialized, /"body"|"postData"/);
    } finally {
      await metro.close();
    }
  });

  it("marks placeholder perf action evidence as partial instead of validated", async () => {
    const metro = await makeFakeHermesMetro({
      available: true,
      source: "app-instrumentation",
      actionName: "open customer",
      metrics: [{ name: "interaction.duration", value: 0, unit: "ms", source: "app-performance-mark", confidence: "low" }],
    });
    try {
      const payload = await runJson(["perf", "action", "open customer", "--metro-port", String(metro.port)]);

      assert.equal(payload.ok, true);
      assert.equal(payload.data.available, true);
      assert.equal(payload.data.realValidation.state, "partial");
      assert.equal(payload.data.realValidation.claimsAllowed.renderCost, false);
      assert.equal(payload.data.realValidation.claimsAllowed.frameJank, false);
    } finally {
      await metro.close();
    }
  });

  it("builds a perf report from runtime network, render, and frame evidence", async () => {
    const metro = await makeFakeHermesMetro({
      available: true,
      source: "app-instrumentation",
      network: {
        requests: [{
          id: "req-2",
          method: "GET",
          url: "http://localhost:3000/api/console/customers",
          startedAt: "2026-05-24T10:00:00.000Z",
          durationMs: 1036,
          status: 200,
        }],
      },
      renders: {
        commits: [{ id: "commit-1", durationMs: 42, phase: "update", route: "/customers" }],
      },
      frames: {
        samples: [{ deltaMs: 18 }, { deltaMs: 44 }],
        worstFrameMs: 44,
        droppedFrameCount: 1,
      },
      metrics: [],
    });
    try {
      const payload = await runJson(["perf", "report", "tab-customers", "--metro-port", String(metro.port)]);

      assert.equal(payload.ok, true);
      assert.equal(payload.data.available, true);
      assert.equal(payload.data.realValidation.claimsAllowed.networkLatency, true);
      assert.equal(payload.data.realValidation.claimsAllowed.renderCost, true);
      assert.equal(payload.data.realValidation.claimsAllowed.frameJank, true);
      assert.equal(payload.data.findings.some((finding) => finding.type === "network-latency"), true);
      assert.equal(payload.data.findings.some((finding) => finding.type === "render-cost"), true);
      assert.equal(payload.data.findings.some((finding) => finding.type === "frame-jank"), true);
    } finally {
      await metro.close();
    }
  });

  it("parses native sample artifacts but does not allow native CPU claims without pid and duration", async () => {
    const project = await makeFixtureProject("expo98-native-sample-");
    const samplePath = resolve(project, "sample.txt");
    try {
      await writeFile(samplePath, [
        "Analysis of sampling MaddieConsole (pid 123) every 1 millisecond",
        "Physical footprint:         462.7M",
        "Physical footprint (peak):  473.5M",
        "Call graph:",
        "    100 Thread_1: Main Thread",
        "    + 76 facebook::yoga::calculateLayoutInternal  (in React) + 1512",
        "    + 64 hermes::vm::Runtime::interpretFunctionImpl  (in hermesvm) + 132",
      ].join("\n"), "utf8");

      const payload = await runJson(["--root", project, "perf", "report", "--native-artifact", samplePath]);

      assert.equal(payload.ok, true);
      assert.equal(payload.data.nativeSummary.available, true);
      assert.equal(payload.data.nativeSummary.physicalFootprintMb, 462.7);
      assert.equal(payload.data.realValidation.claimsAllowed.nativeCpu, false);
      assert.equal(payload.data.realValidation.state, "validated");
    } finally {
      await rm(project, { recursive: true, force: true });
    }
  });

  it("persists semantic snapshot refs from Hermes bridge evidence", async () => {
    const project = await makeFixtureProject("expo98-semantic-snapshot-");
    const stateRoot = resolve(project, ".scratch", "expo98");
    const sessionId = "session_test";
    const targetId = "target_test";
    const sessionDir = resolve(stateRoot, "sessions", sessionId);
    const metro = await makeFakeHermesMetro({
      available: true,
      source: "app-instrumentation",
      routeHint: "/",
      refs: [{
        component: "SignInIntro",
        label: "View.",
        text: "Welcome",
        source: { file: "app/index.tsx", line: 12, column: 3 },
        box: { x: 0, y: 0, width: 402, height: 120 },
        actions: ["tap"],
      }],
    });
    try {
      await mkdir(sessionDir, { recursive: true });
      await writeFile(resolve(sessionDir, "session.json"), JSON.stringify({
        schemaVersion: 1,
        sessionId,
        name: "review",
        artifactDir: sessionDir,
        createdAt: "2026-05-24T00:00:00.000Z",
        updatedAt: "2026-05-24T00:00:00.000Z",
        activeTargetId: targetId,
        lastSnapshotId: null,
        sidecars: [],
      }), "utf8");
      await writeFile(resolve(sessionDir, "target.json"), JSON.stringify({
        targetId,
        platform: "ios",
        device: { id: "SIMULATOR-1", name: "iPhone 16", state: "Booted" },
        app: {},
        metro: {},
        selected: true,
        stale: false,
      }), "utf8");

      const payload = await runJson(["--root", project, "snapshot", "--source", "--bounds", "--metro-port", String(metro.port)]);

      assert.equal(payload.ok, true);
      assert.deepEqual(payload.data.source, ["app-instrumentation"]);
      assert.equal(payload.data.refs[0].component, "SignInIntro");
      assert.equal(payload.data.refs[0].label, "View.");
      assert.equal(payload.data.refs[0].box.width, 402);
      assert.equal(metro.origin, `http://127.0.0.1:${metro.port}`);
      assert.doesNotMatch(JSON.stringify(payload), oldSemanticBridgeMessagePattern);
    } finally {
      await metro.close();
      await rm(project, { recursive: true, force: true });
    }
  });

  it("flattens hierarchical semantic snapshot trees into actionable refs", async () => {
    const project = await makeFixtureProject("expo98-semantic-tree-snapshot-");
    const stateRoot = resolve(project, ".scratch", "expo98");
    const sessionId = "session_test";
    const targetId = "target_test";
    const sessionDir = resolve(stateRoot, "sessions", sessionId);
    const metro = await makeFakeHermesMetro({
      available: true,
      source: "native-inspector",
      routeHint: "/",
      tree: [{
        name: "Root",
        element: { frame: { left: 0, top: 0, width: 402, height: 874 } },
        children: [{
          name: "Pressable",
          element: {
            label: "Send sign-in link",
            role: "button",
            frame: { left: 28, top: 559, width: 345, height: 46 },
          },
        }],
      }],
    });
    try {
      await mkdir(sessionDir, { recursive: true });
      await writeFile(resolve(sessionDir, "session.json"), JSON.stringify({
        schemaVersion: 1,
        sessionId,
        name: "review",
        artifactDir: sessionDir,
        createdAt: "2026-05-24T00:00:00.000Z",
        updatedAt: "2026-05-24T00:00:00.000Z",
        activeTargetId: targetId,
        lastSnapshotId: null,
        sidecars: [],
      }), "utf8");
      await writeFile(resolve(sessionDir, "target.json"), JSON.stringify({
        targetId,
        platform: "ios",
        device: { id: "SIMULATOR-1", name: "iPhone 16", state: "Booted" },
        app: {},
        metro: {},
        selected: true,
        stale: false,
      }), "utf8");

      const payload = await runJson(["--root", project, "snapshot", "--bounds", "--metro-port", String(metro.port)]);

      assert.equal(payload.ok, true);
      assert.equal(payload.data.refs.length, 2);
      assert.equal(payload.data.refs[1].component, "Pressable");
      assert.equal(payload.data.refs[1].label, "Send sign-in link");
      assert.equal(payload.data.refs[1].role, "button");
      assert.equal(payload.data.refs[1].box.width, 345);
    } finally {
      await metro.close();
      await rm(project, { recursive: true, force: true });
    }
  });

  it("reports adapter self-check findings without missing runtime adapters", async () => {
    const payload = await runJson(["live-backlog", "self-check"]);

    assert.equal(payload.ok, true);
    assert.equal(payload.data.selfCheck.missingAdapterCount, 0);
    assert.ok(payload.data.selfCheck.adapterFindings.length >= 4);
    assert.equal(payload.data.selfCheck.adapterFindings.every((finding) => finding.status !== "missing" && finding.status !== "stub"), true);
  });

  it("packs as one npm package containing the executable, not workspace package sources", async () => {
    const { stdout } = await execFileAsync("pnpm", ["pack", "--dry-run", "--json"], { env: npxEnv });
    const jsonStart = stdout.lastIndexOf("\n{");
    assert.notEqual(jsonStart, -1);
    const parsedPack = JSON.parse(stdout.slice(jsonStart + 1));
    const pack = Array.isArray(parsedPack) ? parsedPack[0] : parsedPack;
    const files = pack.files.map((file) => file.path).sort();
    const bundledCli = await readFile("cli/expo98.mjs", "utf8");
    const packageJson = JSON.parse(await readFile("package.json", "utf8"));

    assert.ok(files.includes("cli/expo98.mjs"));
    assert.ok(files.includes("cli/expo-ios.mjs"));
    assert.ok(files.includes("package.json"));
    assert.ok(files.includes("README.md"));
    assert.equal(files.some((file) => file.startsWith("package-entrypoints/")), false);
    assert.equal(files.some((file) => file.includes("/src/main/")), false);
    assert.equal(/from\s+["']\.\.\//.test(bundledCli), false);
    assert.equal(/import\s+["']\.\.\//.test(bundledCli), false);
    assert.deepEqual(packageJson.dependencies, { ws: "^8.21.0" });
    assert.deepEqual(packageJson.devDependencies, {
      "@types/node": "^25.9.1",
      "@types/ws": "^8.18.1",
      esbuild: "^0.25.12",
      typescript: "^6.0.3",
    });
  });
});
