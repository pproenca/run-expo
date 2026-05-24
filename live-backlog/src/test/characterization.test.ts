import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  buildLiveBacklogMatrix,
  classifyLiveBacklogRow,
  hasLiveRuntimeEvidence,
  liveBacklogCommand,
  liveBacklogRowForCommand,
  liveBacklogSelfCheck,
  materializeLiveBacklogArgv,
  parseBacklogJson,
  parseHelpCommandNames,
  summarizeBacklogPayload,
  summarizeLiveBacklogRows,
} from "../main/index.js";
import type { LiveBacklogDependencies, ToolTextResult } from "../main/index.js";

describe("live-backlog legacy characterization", () => {
  it("builds the smoke matrix from dispatcher and help command names", () => {
    const matrix = buildLiveBacklogMatrix({ scope: "smoke" });

    assert.equal(matrix.schemaVersion, 1);
    assert.equal(matrix.scope, "smoke");
    assert.equal(matrix.source.dispatcher, "commandAliases");
    assert.equal(matrix.source.help, "cliHelpText");
    assert.equal(matrix.source.dispatcherCommandCount, 79);
    assert.deepEqual(matrix.source.rowSubset, [
      "bridge", "console", "devices", "devtools", "doctor", "errors", "expo", "install",
      "live-backlog", "metro", "policy", "project-info", "routes", "skills", "upgrade",
    ]);
    assert.equal(matrix.rows.length, 15);
    assert.deepEqual(liveBacklogSelfCheck(matrix), {
      ok: true,
      issueCount: 0,
      issues: [],
      hiddenPreflightPolicy: {
        allowed: false,
        statement: "Simulator, app lifecycle, Metro, Hermes, dev-client, gesture, screenshot, accessibility, log, and crash-report actions must be represented as live-backlog rows.",
      },
    });
  });

  it("creates legacy row templates, requirements, and terminal command ordering", () => {
    const full = buildLiveBacklogMatrix({ scope: "full" });
    const terminate = full.rows[full.rows.length - 1];
    const openDevMenu = liveBacklogRowForCommand("open-dev-menu");
    const fallback = liveBacklogRowForCommand("unknown-command");

    assert.equal(full.rows.length, 79);
    assert.equal(terminate.command, "terminate-app");
    assert.deepEqual(openDevMenu.argv, ["open-dev-menu", "--metro-port", "__METRO_PORT__", "--device", "__DEVICE__", "--bundle-id", "__BUNDLE_ID__", "--dev-client-url", "__DEV_CLIENT_URL__", "--crash-check-ms", "1000"]);
    assert.deepEqual(openDevMenu.requirements, ["metro-message", "simulator", "crash-monitor"]);
    assert.equal(openDevMenu.mutatesRuntime, true);
    assert.deepEqual(fallback.argv, ["unknown-command"]);
    assert.equal(fallback.expectedClass, "expected-usage-error");
  });

  it("parses help command names only from command sections", () => {
    assert.deepEqual(parseHelpCommandNames(`
Usage: expo-ios

Discovery:
  doctor
  routes
Evidence and runtime:
  live-backlog
Examples:
  expo-ios doctor
`), ["doctor", "routes", "live-backlog"]);
  });

  it("materializes row argv placeholders and setup policy paths", () => {
    const argv = materializeLiveBacklogArgv([
      "open-route", "__CWD__", "__METRO_PORT__", "__BUNDLE_ID__", "__DEVICE__",
      "__DEV_CLIENT_URL__", "__ACTION_POLICY__", "__OUTPUT_DIR__", "__ROW_DIR__", "__APP_PATH__",
    ], {
      cwd: "/repo/app",
      metroPort: 19000,
      bundleId: "com.example.app",
      device: "iPhone 15",
      devClientUrl: "exp://custom",
      outputDir: "/tmp/out",
    }, "/tmp/out/row-1");

    assert.deepEqual(argv, [
      "open-route", "/repo/app", "19000", "com.example.app", "iPhone 15",
      "exp://custom", "/tmp/out/row-1/action-policy.json", "/tmp/out", "/tmp/out/row-1", "/tmp/out/row-1/missing.app",
    ]);
  });

  it("classifies captured row output according to RULE-036", () => {
    const staticRow = liveBacklogRowForCommand("doctor");
    const metroRow = liveBacklogRowForCommand("metro");
    const expectedUsage = liveBacklogRowForCommand("get");
    const bridgeRow = liveBacklogRowForCommand("navigation");

    assert.equal(classifyLiveBacklogRow(staticRow, 0, { data: { ok: true } }), "static-pass");
    assert.equal(classifyLiveBacklogRow(metroRow, 0, { data: { available: false } }), "environment-blocked");
    assert.equal(classifyLiveBacklogRow(metroRow, 0, { data: { metro: { status: "packager-status:running" } } }), "live-pass");
    assert.equal(classifyLiveBacklogRow(expectedUsage, 2, null), "expected-usage-error");
    assert.equal(classifyLiveBacklogRow(staticRow, 1, null), "defect");
    assert.equal(classifyLiveBacklogRow(bridgeRow, 0, { data: { target: { webSocketDebuggerUrl: "ws://debug" }, sources: ["app-instrumentation"] } }), "live-pass");
    assert.equal(classifyLiveBacklogRow(bridgeRow, 0, { data: {} }), "environment-blocked");
  });

  it("summarizes parsed payloads and row classifications", () => {
    assert.deepEqual(parseBacklogJson("{\"ok\":true,\"data\":{\"available\":false,\"reason\":\"no metro\",\"extra\":1}}"), {
      ok: true,
      data: { available: false, reason: "no metro", extra: 1 },
    });
    assert.equal(parseBacklogJson("not json"), null);
    assert.deepEqual(summarizeBacklogPayload({ ok: true, data: { available: false, action: "status", reason: "no metro", a: 1 } }), {
      ok: true,
      available: false,
      action: "status",
      reason: "no metro",
      keys: ["available", "action", "reason", "a"],
    });
    assert.deepEqual(summarizeLiveBacklogRows([
      { classification: "static-pass" },
      { classification: "environment-blocked" },
      { classification: "environment-blocked" },
      { classification: "defect" },
    ]), {
      rowCount: 4,
      classifications: { "static-pass": 1, "environment-blocked": 2, defect: 1 },
      defectCount: 1,
      environmentBlockedCount: 2,
      unexplainedPartialCount: 0,
    });
  });

  it("runs self-check and matrix command actions through tool JSON", async () => {
    const matrix = parseToolJson(await liveBacklogCommand({ action: "matrix", cwd: "/repo/app", scope: "smoke" }, deps()));
    const selfCheck = parseToolJson(await liveBacklogCommand({ action: "self-check", cwd: "/repo/app" }, deps()));

    assert.equal(matrix.available, true);
    assert.equal(matrix.action, "matrix");
    assert.equal(matrix.rowCount, 15);
    assert.equal(selfCheck.available, true);
    assert.equal(selfCheck.action, "self-check");
    assert.equal(selfCheck.selfCheck.ok, true);
  });

  it("runs rows, writes evidence artifacts, and reports classified summaries", async () => {
    const writes: Array<{ file: string; data: string }> = [];
    const payload = parseToolJson(await liveBacklogCommand({
      action: "run",
      cwd: "/repo/app",
      scope: "smoke",
      outputDir: "/tmp/live",
    }, deps({
      execFile: async (_file, argv) => {
        const command = argv[argv.length - 1] === "doctor" ? "doctor" : argv[argv.length - 1];
        return { stdout: JSON.stringify({ ok: true, data: { action: command, available: true } }), stderr: "" };
      },
      writeFile: async (file, data) => { writes.push({ file, data }); },
      now: () => new Date("2026-05-23T12:00:00.000Z"),
    })));

    assert.equal(payload.available, undefined);
    assert.equal(payload.action, "run");
    assert.equal(payload.rowCount, undefined);
    assert.equal(payload.summary.rowCount, 15);
    assert.equal(payload.summary.defectCount, 0);
    assert.equal(payload.reportPath, "/tmp/live/live-backlog-report.json");
    assert.equal(writes.some((item) => item.file.endsWith("stdout.json")), true);
    assert.equal(writes.some((item) => item.file.endsWith("live-backlog-report.json")), true);
  });

  it("detects live runtime evidence by requirement family", () => {
    assert.equal(hasLiveRuntimeEvidence({ target: { webSocketDebuggerUrl: "ws://debug" } }, ["hermes-target"]), true);
    assert.equal(hasLiveRuntimeEvidence({ metro: { targets: [{ webSocketDebuggerUrl: "ws://debug" }] } }, ["hermes-target"]), true);
    assert.equal(hasLiveRuntimeEvidence({ metro: { targetCount: 2 } }, ["metro"]), true);
    assert.equal(hasLiveRuntimeEvidence({ messageSocket: { available: true } }, ["metro-message"]), true);
    assert.equal(hasLiveRuntimeEvidence({ source: "app-instrumentation" }, ["app-bridge"]), true);
    assert.equal(hasLiveRuntimeEvidence(null, ["metro"]), false);
  });
});

function deps(overrides: Partial<LiveBacklogDependencies> = {}): LiveBacklogDependencies {
  return {
    mkdir: async () => undefined,
    writeFile: async () => undefined,
    readdir: async () => [],
    execFile: async () => ({ stdout: "{\"ok\":true,\"data\":{\"available\":true}}\n", stderr: "" }),
    now: () => new Date("2026-05-23T00:00:00.000Z"),
    processExecPath: "/usr/local/bin/node",
    cliWrapperPath: "/plugin/cli/expo-ios.mjs",
    ...overrides,
  };
}

function parseToolJson(result: ToolTextResult): any {
  return JSON.parse(result.content[0]?.text ?? "null");
}
