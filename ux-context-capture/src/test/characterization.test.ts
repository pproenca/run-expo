import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  REVIEW_CONTEXT_QUESTIONS,
  captureUxContext,
  clampNumber,
  processNameFromBundleId,
  requireOptionalString,
  safeToolSection,
  toolJson,
} from "../main/index.js";
import type { ToolTextResult, UxContextDependencies } from "../main/index.js";

const DEVICE = { udid: "SIM-1", name: "iPhone 15", state: "Booted" };
const PROJECT = { appConfig: { iosBundleIdentifier: "com.project.app" } };

describe("ux-context-capture legacy characterization", () => {
  it("assembles full UX context from project, runtime, app, screenshot, routes, hierarchy, and skipped logs", async () => {
    const payload = parseToolJson(await captureUxContext({
      cwd: "/repo/app",
      metroPort: "19000",
      componentFilter: "Calendar",
      outputPath: "/tmp/screen.png",
    }, deps()));

    assert.equal(payload.capturedAt, "2026-05-23T12:00:00.000Z");
    assert.equal(payload.cwd, "/repo/app");
    assert.deepEqual(payload.device, DEVICE);
    assert.equal(payload.elapsedMs, 250);
    assert.deepEqual(payload.project, PROJECT);
    assert.deepEqual(payload.metro, { targets: [{ appId: "com.metro.app" }], port: 19000 });
    assert.deepEqual(payload.runtime, { renderer: "fabric", options: { includeComponents: true, componentFilter: "Calendar" } });
    assert.deepEqual(payload.componentHierarchy, { root: "App" });
    assert.deepEqual(payload.app, { bundleId: "com.metro.app", container: "/app" });
    assert.deepEqual(payload.screenshot, { outputPath: "/tmp/screen.png" });
    assert.deepEqual(payload.visualAnalysis, { dominantColors: ["#000"] });
    assert.deepEqual(payload.routes, { routes: ["/"] });
    assert.deepEqual(payload.hierarchy, { nodes: 3 });
    assert.deepEqual(payload.logs, {
      skipped: true,
      reason: "includeLogs is false. Set includeLogs=true for recent filtered iOS logs.",
      suggestedFilter: 'process == "app"',
    });
    assert.deepEqual(payload.reviewQuestionsThisCanAnswer, REVIEW_CONTEXT_QUESTIONS);
  });

  it("skips runtime and component hierarchy when includeRuntime is false and still uses project bundle id", async () => {
    const payload = parseToolJson(await captureUxContext({
      includeRuntime: false,
      includeScreenshot: false,
      includeHierarchy: false,
    }, deps({
      inspectMetro: async () => { throw new Error("should not be called"); },
    })));

    assert.deepEqual(payload.metro, { ok: false, skipped: true, reason: "includeRuntime is false" });
    assert.deepEqual(payload.runtime, { ok: false, skipped: true, reason: "includeRuntime is false" });
    assert.deepEqual(payload.componentHierarchy, { skipped: true, reason: "includeRuntime is false" });
    assert.deepEqual(payload.screenshot, { skipped: true, reason: "includeScreenshot is false" });
    assert.deepEqual(payload.visualAnalysis, { skipped: true, reason: "No screenshot captured." });
    assert.deepEqual(payload.hierarchy, { skipped: true, reason: "includeHierarchy is false" });
    assert.equal(payload.app.bundleId, "com.project.app");
  });

  it("reports unavailable component hierarchy and failed app lookup without throwing", async () => {
    const payload = parseToolJson(await captureUxContext({}, deps({
      inspectMetro: async () => ({ metro: { targets: [] }, runtime: { renderer: "paper" } }),
      iosInstalledAppInfo: async () => { throw new Error("not installed"); },
      expoProjectRuntimeSummary: async () => ({ appConfig: { iosBundleIdentifier: "com.fallback.bundle" } }),
    })));

    assert.deepEqual(payload.componentHierarchy, { available: false, reason: "No component hierarchy returned by runtime probe." });
    assert.deepEqual(payload.app, { bundleId: "com.fallback.bundle", ok: false, error: "not installed" });
  });

  it("uses includeComponents=false skip reason and explicit bundle/process values for log filtering", async () => {
    const logCalls: Array<Record<string, unknown>> = [];
    const payload = parseToolJson(await captureUxContext({
      includeComponents: false,
      includeLogs: true,
      logsLast: "2m",
      bundleId: "com.explicit.bundle",
      processName: "ExplicitProcess",
    }, deps({
      inspectMetro: async (_port, options) => ({ metro: { targets: [] }, runtime: { componentHierarchy: { ignored: true }, options } }),
      collectFilteredIosLogs: async (_udid, options) => {
        logCalls.push(options);
        return { lines: ["ok"] };
      },
    })));

    assert.deepEqual(payload.componentHierarchy, { ignored: true });
    assert.deepEqual(logCalls, [{ last: "2m", bundleId: "com.explicit.bundle", processName: "ExplicitProcess" }]);
    assert.deepEqual(payload.logs, { lines: ["ok"] });
    await assert.rejects(() => captureUxContext({ includeLogs: true, logsLast: "soon" }, deps()), /logsLast must look like 30s, 2m, 1h, or 1d/);
  });

  it("wraps project, screenshot, image analysis, routes, hierarchy, and logs failures as safe sections", async () => {
    const payload = parseToolJson(await captureUxContext({ includeLogs: true }, deps({
      expoProjectRuntimeSummary: async () => { throw new Error("project failed"); },
      inspectMetro: async () => { throw new Error("metro failed"); },
      captureIosScreenshot: async () => { throw new Error("screenshot failed"); },
      expoRouteContext: async () => { throw new Error("routes failed"); },
      describeIosHierarchy: async () => { throw new Error("hierarchy failed"); },
      collectFilteredIosLogs: async () => { throw new Error("logs failed"); },
    })));

    assert.deepEqual(payload.project, { ok: false, error: "project failed" });
    assert.deepEqual(payload.metro, { ok: false, error: "metro failed" });
    assert.deepEqual(payload.runtime, { ok: false, error: "metro failed" });
    assert.deepEqual(payload.screenshot, { ok: false, error: "screenshot failed" });
    assert.equal(payload.visualAnalysis, null);
    assert.deepEqual(payload.routes, { ok: false, error: "routes failed" });
    assert.deepEqual(payload.hierarchy, { ok: false, error: "hierarchy failed" });
    assert.deepEqual(payload.logs, { ok: false, error: "logs failed" });
    assert.deepEqual(payload.app, { bundleId: null, warning: "Could not infer bundleId. Pass bundleId for app container details and precise log filtering." });
  });

  it("preserves helper contracts for optional strings, bundle process names, safe sections, clamping, and tool JSON", async () => {
    assert.equal(requireOptionalString("  value  "), "value");
    assert.equal(requireOptionalString("   "), null);
    assert.equal(requireOptionalString(123), null);
    assert.equal(processNameFromBundleId("com.example.My-App!"), "My-App");
    assert.equal(processNameFromBundleId(null), null);
    assert.equal(clampNumber("70000", 1, 65535), 65535);
    assert.throws(() => clampNumber("bad", 1, 65535), /Expected a finite number, got bad/);
    assert.deepEqual(await safeToolSection(async () => "ok"), { ok: true, value: "ok" });
    assert.deepEqual(await safeToolSection(async () => { throw new Error("nope"); }), { ok: false, error: "nope" });
    assert.equal(JSON.parse(toolJson({ ok: true }).content[0]?.text ?? "{}").ok, true);
  });
});

function deps(overrides: Partial<UxContextDependencies> = {}): UxContextDependencies {
  let nowMs = 1_779_536_400_000;
  return {
    normalizeProjectCwd: async (cwd) => String(cwd ?? "/repo/app"),
    resolveIosDevice: async () => DEVICE,
    expoProjectRuntimeSummary: async () => PROJECT,
    inspectMetro: async (_port, options) => ({
      metro: { targets: [{ appId: "com.metro.app" }], port: _port },
      runtime: { renderer: "fabric", componentHierarchy: { root: "App" }, options },
    }),
    iosInstalledAppInfo: async (_udid, bundleId) => ({ bundleId, container: "/app" }),
    captureIosScreenshot: async (_udid, outputPath) => ({ outputPath: String(outputPath ?? "/tmp/default.png") }),
    analyzePngScreenshot: async () => ({ dominantColors: ["#000"] }),
    expoRouteContext: async () => ({ routes: ["/"] }),
    describeIosHierarchy: async () => ({ nodes: 3 }),
    collectFilteredIosLogs: async () => ({ lines: [] }),
    now: () => new Date("2026-05-23T12:00:00.000Z"),
    nowMs: () => {
      const value = nowMs;
      nowMs += 250;
      return value;
    },
    ...overrides,
  };
}

function parseToolJson(result: ToolTextResult): any {
  return JSON.parse(result.content[0]?.text ?? "null");
}
