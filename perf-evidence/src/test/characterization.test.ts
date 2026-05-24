import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  normalizePerfBridgePayload,
  perfBridgeAction,
  perfCommand,
  perfContext,
  perfDevelopmentLimitations,
  perfEvidenceSource,
  perfExpression,
  perfMetric,
  perfOverallConfidence,
  perfTransport,
  toolJson,
} from "../main/index.js";
import type { PerfDependencies, ToolTextResult } from "../main/index.js";

const PROJECT = { projectRoot: "/repo/app" };
const TARGET = {
  id: "metro-1",
  title: "App",
  appId: "com.example.app",
  deviceName: "iPhone 15",
  webSocketDebuggerUrl: "ws://debug",
  capabilities: { hermesRuntime: true },
};

describe("perf-evidence legacy characterization", () => {
  it("builds summary evidence from project dependencies and Metro status", async () => {
    const payload = parseToolJson(await perfCommand({ action: "summary", cwd: "/repo/app", metroPort: 19000 }, deps()));

    assert.equal(payload.available, true);
    assert.equal(payload.action, "summary");
    assert.equal(payload.mode, "development");
    assert.deepEqual(payload.sources, ["project", "metro"]);
    assert.equal(payload.context.projectRoot, "/repo/app");
    assert.equal(payload.context.metro.port, 19000);
    assert.equal(payload.confidence, "medium");
    assert.deepEqual(payload.metrics, [
      { name: "project.dependencies", value: 3, unit: "count", source: "project", confidence: "low" },
      { name: "metro.targets", value: 1, unit: "count", source: "metro", confidence: "medium" },
    ]);
    assert.equal(payload.capabilities[0].available, true);
    assert.match(payload.limitations[0], /Summary reports evidence availability/);
  });

  it("captures runtime payloads, normalizes bridge metrics, and writes artifacts", async () => {
    const writes: Array<{ file: string; data: string }> = [];
    const payload = parseToolJson(await perfCommand({ action: "startup", cwd: "/repo/app", outputPath: "/tmp/startup.json" }, deps({
      evaluateHermesExpression: async () => ({ result: { result: { value: {
        available: true,
        source: "plugin-bridge-performance",
        metrics: [{ name: "startup.time", value: 120, unit: "ms" }],
      } } } }),
      writeFile: async (file, data) => { writes.push({ file, data }); },
    })));

    assert.equal(payload.available, true);
    assert.equal(payload.action, "startup");
    assert.equal(payload.evidenceSource, "plugin-bridge-performance");
    assert.equal(payload.confidence, "medium");
    assert.equal(payload.metrics[0].confidence, "medium");
    assert.equal(payload.artifacts[0], "/tmp/startup.json");
    assert.equal(writes.length, 1);
  });

  it("returns no-runtime or malformed runtime states and requires action labels", async () => {
    const noTarget = parseToolJson(await perfCommand({ action: "frames" }, deps({ metroTargets: async () => [], metroStatusPayload: async () => ({ available: false, reason: "No Metro" }) })));
    const malformed = parseToolJson(await perfCommand({ action: "startup" }, deps({ evaluateHermesExpression: async () => ({ result: { result: { value: null } } }) })));

    assert.equal(noTarget.available, false);
    assert.equal(noTarget.code, "no-runtime-target");
    assert.equal(noTarget.reason, "No Metro inspector target.");
    assert.equal(malformed.available, false);
    assert.equal(malformed.code, "malformed-payload");
    assert.equal(malformed.reason, "Performance bridge did not return a value.");
    await assert.rejects(() => perfCommand({ action: "action" }, deps()), /label must be a non-empty string/);
  });

  it("maps instrumented mark and measure subactions to bridge actions", async () => {
    const calls: string[] = [];
    const mark = parseToolJson(await perfCommand({ action: "mark", subaction: "clear", label: "nav" }, deps({
      evaluateHermesExpression: async (_url, expression) => {
        calls.push(expression);
        return { result: { result: { value: { available: true, metrics: [] } } } };
      },
    })));

    assert.equal(mark.action, "mark");
    assert.equal(mark.subaction, "clear");
    assert.equal(mark.bridgeAction, "mark-clear");
    assert.match(calls[0], /const action = "mark-clear"/);
    assert.equal(perfBridgeAction("measure", "stop"), "measure-stop");
    assert.equal(perfBridgeAction("frames", undefined), "frames");
  });

  it("compares artifacts and checks numeric budgets", async () => {
    const compare = parseToolJson(await perfCommand({ action: "compare", baseline: "/tmp/base.json", candidate: "/tmp/candidate.json" }, deps({
      readJsonFile: async (file) => file.includes("base")
        ? { metrics: [{ name: "render.ms", value: 100, unit: "ms", confidence: "high" }] }
        : { metrics: [{ name: "render.ms", value: 90, unit: "ms", confidence: "medium" }] },
    })));
    const budget = parseToolJson(await perfCommand({ action: "budget", file: "/tmp/budget.json", candidate: "/tmp/candidate.json" }, deps({
      readJsonFile: async (file) => file.includes("budget")
        ? { budgets: [{ metric: "render.ms", max: 95 }] }
        : { metrics: [{ name: "render.ms", value: 90, unit: "ms" }] },
    })));

    assert.deepEqual(compare.deltas, [{ metric: "render.ms", baseline: 100, candidate: 90, delta: -10, unit: "ms", improved: true, confidence: "medium" }]);
    assert.equal(compare.confidence, "medium");
    assert.equal(budget.passed, true);
    assert.deepEqual(budget.checks, [{ metric: "render.ms", value: 90, min: null, max: 95, passed: true, unit: "ms" }]);
    await assert.rejects(() => perfCommand({ action: "budget", subaction: "list", file: "x", candidate: "y" }, deps()), /Unknown performance budget action: list/);
  });

  it("records memory and native profiler metadata with leak-claim caveats", async () => {
    const memory = parseToolJson(await perfCommand({ action: "memory", samples: 1, cwd: "/repo/app" }, deps()));
    const ettrace = parseToolJson(await perfCommand({ action: "ettrace", subaction: "stop", nativeArtifact: "/tmp/capture.trace" }, deps({ pathExists: async () => false })));
    const memgraph = parseToolJson(await perfCommand({ action: "memgraph" }, deps({ pathExists: async () => true })));

    assert.equal(memory.leakClaim.allowed, false);
    assert.equal(memory.metrics[0].confidence, "low");
    assert.equal(ettrace.subaction, "stop");
    assert.equal(ettrace.confidence, "high");
    assert.equal(memgraph.subaction, "capture");
    await assert.rejects(() => perfCommand({ action: "memgraph", subaction: "start" }, deps()), /Unknown memgraph action: start/);
  });

  it("measures bundle artifacts and reports unavailable missing artifacts", async () => {
    const available = parseToolJson(await perfCommand({ action: "bundle", bundleArtifact: "/tmp/index.js" }, deps({
      stat: async () => ({ isFile: () => true, size: 4096 }),
    })));
    const missing = parseToolJson(await perfCommand({ action: "bundle", bundleArtifact: "/tmp/missing.js" }, deps({
      stat: async () => null,
    })));

    assert.equal(available.available, true);
    assert.deepEqual(available.metrics[0], { name: "bundle.bytes", value: 4096, unit: "bytes", source: "metro", confidence: "high" });
    assert.equal(missing.available, false);
    assert.equal(missing.unavailableSources[0].reason, "Bundle artifact was not found.");
  });

  it("preserves helper contracts for normalization, context, transport, expression, and command errors", async () => {
    assert.deepEqual(normalizePerfBridgePayload({ metrics: "bad" }, "startup"), {
      metrics: [],
      available: false,
      action: "startup",
      code: "malformed-payload",
      reason: "Performance runtime returned malformed metrics.",
    });
    assert.deepEqual(perfMetric({ name: "x", value: 1, unit: "ms", source: "runtime", confidence: "high" }), { name: "x", value: 1, unit: "ms", source: "runtime", confidence: "high" });
    assert.equal(perfOverallConfidence([]), "low");
    assert.equal(perfOverallConfidence([{ confidence: "medium" }]), "medium");
    assert.equal(perfEvidenceSource({ sources: ["runtime"] }), "runtime");
    assert.equal(perfDevelopmentLimitations(["extra"])[1], "Development-mode measurements include Metro, dev runtime, and instrumentation overhead and must not be generalized to release performance.");
    assert.deepEqual(await perfContext({ args: { buildKind: "preview", platform: "ios" }, projectRoot: "/repo/app", metro: null }), {
      projectRoot: "/repo/app",
      build: { mode: "preview", releaseLike: true },
      platform: "ios",
      device: null,
      metro: { port: 8081, status: "not-measured", targetCount: 0, devMode: null },
      coldStart: null,
      samples: 1,
    });
    assert.equal(perfTransport(8081, TARGET).target.id, "metro-1");
    assert.match(perfExpression({ action: "startup", label: "nav" }), /Performance bridge domain is not registered/);
    await assert.rejects(() => perfCommand({ action: "unknown" }, deps()), /Unknown performance action: unknown/);
    assert.equal(JSON.parse(toolJson({ ok: true }).content[0].text).ok, true);
  });
});

function deps(overrides: Partial<PerfDependencies> = {}): PerfDependencies {
  return {
    normalizeProjectCwd: async () => "/repo/app",
    expoProjectRuntimeSummary: async () => PROJECT,
    metroStatusPayload: async (args) => ({ available: true, metroPort: args.metroPort, targetCount: 1, targets: [TARGET] }),
    metroTargets: async () => [TARGET],
    evaluateHermesExpression: async () => ({ result: { result: { value: { available: true, metrics: [] } } } }),
    findUp: async () => "/repo/app/package.json",
    readJsonFile: async () => ({ dependencies: { expo: "1", react: "1" }, devDependencies: { typescript: "1" } }),
    writeFile: async () => undefined,
    mkdir: async () => undefined,
    pathExists: async () => true,
    stat: async () => null,
    now: () => new Date("2026-05-23T00:00:00.000Z"),
    ...overrides,
  };
}

function parseToolJson(result: ToolTextResult): any {
  return JSON.parse(result.content[0]?.text ?? "null");
}
