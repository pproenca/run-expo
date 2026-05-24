import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  clampNumber,
  normalizeRuntimeInspectorAction,
  openIosDevMenu,
  requireOptionalString,
  runtimeInspector,
  runtimeInspectorExpression,
  targetSummary,
  toolJson,
  truncate,
  unwrapToolJson,
} from "../main/index.js";
import type {
  OpenDevMenuDependencies,
  RuntimeInspectorDependencies,
} from "../main/index.js";

function runtimeDeps(overrides: Partial<RuntimeInspectorDependencies> = {}): RuntimeInspectorDependencies {
  return {
    fetchMetroTargets: async () => [
      {
        title: "Hermes App",
        appId: "com.example.app",
        deviceName: "iPhone 15",
        description: "React Native",
        webSocketDebuggerUrl: "ws://target",
      },
    ],
    evaluateHermesExpression: async () => ({
      result: { result: { value: { available: true, action: "probe" } } },
      diagnostics: { calls: 1 },
    }),
    openIosDevMenu: async () => ({ available: true, action: "open-dev-menu" }),
    ...overrides,
  };
}

function devMenuDeps(overrides: Partial<OpenDevMenuDependencies> = {}): OpenDevMenuDependencies {
  return {
    broadcastMetroMessage: async () => ({ available: false, reason: "No connected app peers on Metro /message websocket." }),
    resolveIosDevice: async () => ({ udid: "SIM-1", name: "iPhone 15" }),
    openDevClientForMessageSocket: async () => ({ available: true, crashReports: [] }),
    execFile: async () => ({ stdout: "ok", stderr: "", error: null }),
    ...overrides,
  };
}

describe("runtime-inspector-actions legacy characterization", () => {
  it("validates inspector actions, required strings, optional strings, and clamped numbers", () => {
    assert.equal(normalizeRuntimeInspectorAction(" probe "), "probe");
    assert.equal(normalizeRuntimeInspectorAction("open-dev-menu"), "open-dev-menu");
    assert.throws(() => normalizeRuntimeInspectorAction("bad"), /Unknown inspector action: bad/);
    assert.throws(() => normalizeRuntimeInspectorAction(" "), /action must be a non-empty string\./);
    assert.equal(requireOptionalString(undefined), null);
    assert.equal(requireOptionalString("  text  "), "text");
    assert.equal(clampNumber(0, 1, 500), 1);
    assert.equal(clampNumber(800, 1, 500), 500);
    assert.throws(() => clampNumber("NaN", 1, 500), /Expected a finite number, got NaN\./);
  });

  it("wraps and unwraps the legacy JSON tool envelope", () => {
    assert.deepEqual(toolJson({ available: true }), {
      content: [{ type: "text", text: "{\n  \"available\": true\n}\n" }],
      isError: false,
    });
    assert.deepEqual(unwrapToolJson(toolJson({ available: true })), { available: true });
    assert.deepEqual(unwrapToolJson({ content: [{ type: "text", text: "plain" }] }), { text: "plain" });
  });

  it("returns unavailable runtime inspector payload when Metro has no websocket target", async () => {
    assert.deepEqual(unwrapToolJson(await runtimeInspector({ action: "toggle", metroPort: 70000 }, runtimeDeps({
      fetchMetroTargets: async () => [],
    }))), {
      available: false,
      action: "toggle",
      reason: "No Metro inspector target.",
      metroPort: 65535,
    });
  });

  it("evaluates Hermes inspector expressions with default action, title, comments, target summary, and CDP diagnostics", async () => {
    let expression = "";
    let websocket = "";
    let timeout = 0;

    const payload = unwrapToolJson(await runtimeInspector({}, runtimeDeps({
      evaluateHermesExpression: async (url, expr, options) => {
        websocket = url;
        expression = expr;
        timeout = options.timeoutMs;
        return {
          result: { result: { value: { available: true, action: "probe", comments: { commentCount: 0 } } } },
          cdp: { sent: ["Runtime.evaluate"] },
        };
      },
    })));

    assert.equal(websocket, "ws://target");
    assert.equal(timeout, 8000);
    assert.match(expression, /const action = "probe"/);
    assert.match(expression, /const commentTitle = "Codex: Add UI comment"/);
    assert.match(expression, /const maxComments = 50/);
    assert.match(expression, /__CODEX_SIMULATOR_REVIEW__/);
    assert.deepEqual(payload, {
      action: "probe",
      metroPort: 8081,
      target: {
        title: "Hermes App",
        appId: "com.example.app",
        deviceName: "iPhone 15",
        description: "React Native",
      },
      inspector: { available: true, action: "probe", comments: { commentCount: 0 } },
      protocolError: null,
      cdp: { sent: ["Runtime.evaluate"] },
    });
  });

  it("uses exception details or result errors as protocolError like the legacy payload", async () => {
    assert.deepEqual(unwrapToolJson(await runtimeInspector({ action: "read-comments" }, runtimeDeps({
      evaluateHermesExpression: async () => ({
        result: { exceptionDetails: { text: "boom" } },
        diagnostics: { ok: false },
      }),
    }))), {
      action: "read-comments",
      metroPort: 8081,
      target: {
        title: "Hermes App",
        appId: "com.example.app",
        deviceName: "iPhone 15",
        description: "React Native",
      },
      inspector: null,
      protocolError: { text: "boom" },
      cdp: { ok: false },
    });
  });

  it("delegates open-dev-menu action to the iOS dev menu helper", async () => {
    const payload = unwrapToolJson(await runtimeInspector({ action: "open-dev-menu", metroPort: 3000, device: "SIM-2" }, runtimeDeps({
      openIosDevMenu: async (args) => ({ seen: args }),
    })));

    assert.deepEqual(payload, {
      seen: {
        action: "open-dev-menu",
        metroPort: 3000,
        device: "SIM-2",
      },
    });
  });

  it("returns immediately when Metro /message devMenu broadcast succeeds", async () => {
    const calls: string[] = [];
    const payload = await openIosDevMenu({ metroPort: 8082, device: "SIM-1" }, devMenuDeps({
      broadcastMetroMessage: async (metroPort, method) => {
        calls.push(`${metroPort}:${method}`);
        return { available: true, connectedPeerCount: 1 };
      },
      resolveIosDevice: async () => {
        throw new Error("device should not resolve when broadcast succeeds");
      },
    }));

    assert.deepEqual(calls, ["8082:devMenu"]);
    assert.deepEqual(payload, {
      available: true,
      action: "open-dev-menu",
      platform: "ios",
      transport: "metro-message-socket",
      metroPort: 8082,
      requestedDevice: "SIM-1",
      messageSocket: { available: true, connectedPeerCount: 1 },
      note: "This uses Expo/Metro's /message websocket devMenu broadcast, matching the Expo CLI toggle developer menu path.",
    });
  });

  it("opens a dev client URL, reports crash evidence, and skips the shake fallback when crashes are present", async () => {
    const payload = await openIosDevMenu({ devClientUrl: "myapp:///", bundleId: "com.example.app", restartDevClient: true }, devMenuDeps({
      openDevClientForMessageSocket: async (args) => ({
        available: false,
        args,
        crashReports: [{ path: "crash.ips" }],
      }),
    }));

    assert.deepEqual(payload, {
      available: false,
      action: "open-dev-menu",
      platform: "ios",
      device: { udid: "SIM-1", name: "iPhone 15" },
      metroPort: 8081,
      devClientRepair: {
        available: false,
        args: {
          device: { udid: "SIM-1", name: "iPhone 15" },
          bundleId: "com.example.app",
          devClientUrl: "myapp:///",
          restartDevClient: true,
          metroPort: 8081,
          crashCheckMs: undefined,
        },
        crashReports: [{ path: "crash.ips" }],
      },
      messageSocket: { available: false, reason: "No connected app peers on Metro /message websocket." },
      reason: "The app generated an iOS crash report after opening the development client URL.",
    });
  });

  it("retries Metro broadcast after dev-client repair and returns the connected message-socket transport", async () => {
    let broadcastCount = 0;
    const payload = await openIosDevMenu({ devClientUrl: "myapp:///" }, devMenuDeps({
      broadcastMetroMessage: async () => {
        broadcastCount += 1;
        return broadcastCount === 1
          ? { available: false, connectedPeerCount: 0 }
          : { available: true, connectedPeerCount: 1 };
      },
      openDevClientForMessageSocket: async () => ({ available: true, crashReports: [] }),
    }));

    assert.deepEqual(payload, {
      available: true,
      action: "open-dev-menu",
      platform: "ios",
      transport: "metro-message-socket",
      metroPort: 8081,
      requestedDevice: null,
      device: { udid: "SIM-1", name: "iPhone 15" },
      devClientRepair: { available: true, crashReports: [] },
      messageSocket: { available: true, connectedPeerCount: 1 },
      note: "Opened the supplied Expo development client URL, then used Metro's /message websocket devMenu broadcast.",
    });
  });

  it("falls back to simulator shake and truncates exec output when Metro message transport remains unavailable", async () => {
    const error = { message: "failed" };
    const payload = await openIosDevMenu({}, devMenuDeps({
      execFile: async (command, args, options) => {
        assert.equal(command, "xcrun");
        assert.deepEqual(args, ["simctl", "io", "SIM-1", "shake"]);
        assert.deepEqual(options, { timeout: 15000, rejectOnError: false });
        return { stdout: "x".repeat(8), stderr: "bad", error };
      },
      truncate: (value) => String(value).slice(0, 3),
    }));

    assert.deepEqual(payload, {
      available: false,
      action: "open-dev-menu",
      platform: "ios",
      device: { udid: "SIM-1", name: "iPhone 15" },
      command: ["xcrun", "simctl", "io", "SIM-1", "shake"],
      stdout: "xxx",
      stderr: "bad",
      error,
      messageSocket: { available: false, reason: "No connected app peers on Metro /message websocket." },
      devClientRepair: null,
      note: "Tried Expo/Metro's /message websocket devMenu broadcast first, then fell back to the simulator shake gesture.",
    });
  });

  it("generates the runtime expression branches and stable target summaries", () => {
    const expression = runtimeInspectorExpression({
      action: "install-comment-menu",
      commentTitle: "Custom comment",
      maxComments: 7,
    });

    assert.match(expression, /const action = "install-comment-menu"/);
    assert.match(expression, /const commentTitle = "Custom comment"/);
    assert.match(expression, /state.comments.slice\(-maxComments\)/);
    assert.match(expression, /if \(action === 'clear-comments'\)/);
    assert.deepEqual(targetSummary({ title: "t", appId: "a", deviceName: "d", description: "desc", extra: true }), {
      title: "t",
      appId: "a",
      deviceName: "d",
      description: "desc",
    });
    assert.equal(targetSummary(null), null);
    assert.equal(truncate("abcdef", 3), "abc\n[truncated 3 characters]");
  });
});

