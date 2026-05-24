import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  clampNumber,
  navigationCommand,
  navigationDeepLink,
  navigationExpression,
  navigationPolicyDecision,
  navigationTransport,
  navigationUnavailable,
  targetSummary,
} from "../main/index.js";
import type {
  NavigationCommandArgs,
  NavigationCommandDependencies,
  NavigationPolicyDecision,
  NavigationTarget,
  NavigationTargetSummary,
  ToolTextResult,
} from "../main/index.js";

const LIMITATIONS = [
  "Navigation state and imperative navigation actions require the dev-only app instrumentation bridge.",
  "Use open-route or navigation deep-link when only URL navigation is available.",
];

const READ_POLICY: NavigationPolicyDecision = {
  checked: true,
  action: "navigation.state",
  sideEffect: "read",
  allowed: true,
  reason: "Read action does not require policy approval.",
};

const DEEP_LINK_POLICY: NavigationPolicyDecision = {
  checked: true,
  action: "navigation.deep-link",
  sideEffect: "device",
  allowed: true,
  reason: "Deep-link navigation uses the existing open-route fallback policy.",
};

const TARGET: NavigationTarget = {
  id: "target-1",
  title: "Expo Go",
  description: "",
  appId: "host.exp.Exponent",
  deviceName: "iPhone 15",
  devtoolsFrontendUrl: "http://127.0.0.1:8081/debugger-ui",
  webSocketDebuggerUrl: "ws://127.0.0.1:8081/inspector/debug?device=iPhone",
  reactNative: { logicalDeviceId: "device-1" },
};

const TARGET_SUMMARY: NavigationTargetSummary = {
  id: "target-1",
  title: "Expo Go",
  description: "",
  appId: "host.exp.Exponent",
  deviceName: "iPhone 15",
  devtoolsFrontendUrl: "http://127.0.0.1:8081/debugger-ui",
  webSocketDebuggerUrl: "ws://127.0.0.1:8081/inspector/debug?device=iPhone",
  reactNative: { logicalDeviceId: "device-1" },
  capabilities: {
    hermesRuntime: true,
    devtoolsFrontend: true,
    reactNative: true,
  },
};

describe("navigation-deeplinks legacy characterization", () => {
  describe("command validation, defaults, and policy gates", () => {
    it("defaults action to state and rejects unknown or blank actions with legacy messages", async () => {
      const payload = parseToolJson(await navigationCommand({}, {
        policyDecision: async () => {
          throw new Error("state must not call the policy adapter");
        },
        metroTargets: async () => [],
      }));

      assert.deepEqual(payload, unavailableState(8081));
      await assert.rejects(() => navigationCommand({ action: "launch" }), /Unknown navigation action: launch/);
      await assert.rejects(() => navigationCommand({ action: "   " }), /action must be a non-empty string\./);
    });

    it("defaults Metro port to 8081 and clamps finite values to 1..65535", async () => {
      assert.equal(clampNumber(8081, 1, 65535), 8081);
      assert.equal(clampNumber(0, 1, 65535), 1);
      assert.equal(clampNumber(-20, 1, 65535), 1);
      assert.equal(clampNumber("65536", 1, 65535), 65535);

      const ports: number[] = [];
      const deps: NavigationCommandDependencies = {
        metroTargets: async (metroPort) => {
          ports.push(metroPort);
          return [];
        },
      };

      parseToolJson(await navigationCommand({ action: "state" }, deps));
      parseToolJson(await navigationCommand({ action: "state", metroPort: 0 }, deps));
      parseToolJson(await navigationCommand({ action: "state", metroPort: 70000 }, deps));

      assert.deepEqual(ports, [8081, 1, 65535]);
    });

    it("allows navigation.state as a read without policy adapter calls", async () => {
      const expressions: string[] = [];
      const payload = parseToolJson(await navigationCommand({ action: "state", metroPort: 19000 }, {
        policyDecision: async () => {
          throw new Error("state must not call policyDecision");
        },
        metroTargets: async () => [TARGET],
        evaluateHermesExpression: async (_webSocketDebuggerUrl, expression, options) => {
          expressions.push(expression);
          assert.deepEqual(options, { timeoutMs: 5000 });
          return {
            result: { result: { value: { available: true, source: "plugin-bridge", state: { route: "/customers" } } } },
            diagnostics: { sessionId: "cdp-session-1" },
          };
        },
      }));

      assert.deepEqual(payload, {
        available: true,
        source: "plugin-bridge",
        state: { route: "/customers" },
        action: "state",
        metroPort: 19000,
        target: TARGET_SUMMARY,
        transport: {
          name: "metro-inspector-hermes-cdp",
          metroPort: 19000,
          protocol: "Runtime.evaluate",
          target: TARGET_SUMMARY,
          cdp: { sessionId: "cdp-session-1" },
        },
        evidenceSource: "plugin-bridge",
        policy: READ_POLICY,
      });
      assert.equal(expressions.length, 1);
      assert.match(expressions[0] ?? "", /const action = "state";/);
    });

    it("returns policy-denied envelopes for back, pop-to-root, and tab before target or evaluation calls", async () => {
      const calls: string[] = [];
      const deps: NavigationCommandDependencies = {
        policyDecision: async (_args, action, sideEffect) => {
          calls.push(`${action}:${sideEffect}`);
          return deniedPolicy(action, sideEffect);
        },
        metroTargets: async () => {
          throw new Error("policy denial must not read Metro targets");
        },
        evaluateHermesExpression: async () => {
          throw new Error("policy denial must not evaluate Hermes");
        },
      };

      assert.deepEqual(parseToolJson(await navigationCommand({ action: "back", metroPort: 19000 }, deps)), {
        available: false,
        action: "back",
        metroPort: 19000,
        source: "policy",
        evidenceSource: "policy",
        reason: "No action policy allowed this state-changing operation.",
        policy: deniedPolicy("navigation.back", "device"),
        transport: {
          name: "metro-inspector-hermes-cdp",
          metroPort: 19000,
          protocol: "Runtime.evaluate",
          target: null,
          cdp: null,
        },
      });
      assert.deepEqual(parseToolJson(await navigationCommand({ action: "pop-to-root", metroPort: 19001 }, deps)), {
        available: false,
        action: "pop-to-root",
        metroPort: 19001,
        source: "policy",
        evidenceSource: "policy",
        reason: "No action policy allowed this state-changing operation.",
        policy: deniedPolicy("navigation.pop-to-root", "device"),
        transport: {
          name: "metro-inspector-hermes-cdp",
          metroPort: 19001,
          protocol: "Runtime.evaluate",
          target: null,
          cdp: null,
        },
      });
      assert.deepEqual(parseToolJson(await navigationCommand({ action: "tab", tab: "settings", metroPort: 19002 }, deps)), {
        available: false,
        action: "tab",
        metroPort: 19002,
        source: "policy",
        evidenceSource: "policy",
        reason: "No action policy allowed this state-changing operation.",
        policy: deniedPolicy("navigation.tab", "device"),
        transport: {
          name: "metro-inspector-hermes-cdp",
          metroPort: 19002,
          protocol: "Runtime.evaluate",
          target: null,
          cdp: null,
        },
      });
      assert.deepEqual(calls, ["navigation.back:device", "navigation.pop-to-root:device", "navigation.tab:device"]);
    });

    it("encodes the legacy navigation policy decision branches", async () => {
      assert.deepEqual(await navigationPolicyDecision({}, "state"), READ_POLICY);
      assert.deepEqual(await navigationPolicyDecision({}, "deep-link"), DEEP_LINK_POLICY);
      assert.deepEqual(await navigationPolicyDecision({ actionPolicy: "/tmp/policy.json" }, "back", {
        policyDecision: async (args, action, sideEffect) => ({
          checked: true,
          action,
          sideEffect,
          allowed: true,
          source: String(args.actionPolicy),
          reason: "Action allowed by policy.",
        }),
      }), {
        checked: true,
        action: "navigation.back",
        sideEffect: "device",
        allowed: true,
        source: "/tmp/policy.json",
        reason: "Action allowed by policy.",
      });
    });
  });

  describe("deep-link fallback behavior", () => {
    it("allows deep-link through fallback policy, delegates open-route, and includes target and session evidence", async () => {
      const opened = {
        platform: "ios",
        device: { name: "iPhone 15", udid: "SIM-1" },
        url: "fixture:///customers?token=[redacted]&status=open",
        stdout: "opened SIM-1 fixture:///customers?token=[redacted]&status=open\n",
        stderr: "",
        error: null,
      };
      const openCalls: NavigationCommandArgs[] = [];

      assert.deepEqual(await navigationDeepLink({
        route: "/customers",
        query: "token=secret-token&status=open",
        scheme: "fixture",
        stateDir: "/tmp/expo-ios/runs",
      }, {
        policyDecision: async () => {
          throw new Error("deep-link must use the fallback policy without consulting the policy adapter");
        },
        openExpoRoute: async (args) => {
          openCalls.push(args);
          return toolJson(opened);
        },
        selectedTargetId: async () => "target-1",
        latestSessionId: async () => "review-2026-05-23T10-00-00-000Z",
      }), {
        available: true,
        action: "deep-link",
        source: "open-route",
        evidenceSource: "deep-link",
        transport: {
          name: "simulator-open-url",
          command: "open-route",
          target: { name: "iPhone 15", udid: "SIM-1" },
        },
        policy: DEEP_LINK_POLICY,
        deepLink: opened,
        evidence: {
          targetId: "target-1",
          sessionId: "review-2026-05-23T10-00-00-000Z",
          route: "/customers",
          url: "fixture:///customers?token=[redacted]&status=open",
        },
      });
      assert.equal(openCalls.length, 1);
      assert.equal(openCalls[0]?.route, "/customers");
      assert.equal(openCalls[0]?.query, "token=secret-token&status=open");
    });

    it("redacts sensitive query values from open-route deep-link payloads at the wrapper boundary", async () => {
      const payload = await navigationDeepLink({ route: "/customers" }, {
        openExpoRoute: async () => toolJson({
          platform: "ios",
          device: { name: "iPhone 15", udid: "SIM-1" },
          url: "fixture:///customers?token=secret-token&cookie=session-cookie&status=open",
          stdout: "opened SIM-1 fixture:///customers?token=secret-token&cookie=session-cookie&status=open",
          stderr: "warning fixture:///customers?authorization=Bearer-secret",
          error: null,
        }),
        selectedTargetId: async () => null,
        latestSessionId: async () => null,
      });

      assert.equal(
        (payload.deepLink as { url?: unknown }).url,
        "fixture:///customers?token=[redacted]&cookie=[redacted]&status=open",
      );
      assert.equal(
        (payload.deepLink as { stdout?: unknown }).stdout,
        "opened SIM-1 fixture:///customers?token=[redacted]&cookie=[redacted]&status=open",
      );
      assert.equal(
        (payload.deepLink as { stderr?: unknown }).stderr,
        "warning fixture:///customers?authorization=[redacted]",
      );
      assert.deepEqual((payload.evidence as { url?: unknown }).url, "fixture:///customers?token=[redacted]&cookie=[redacted]&status=open");
    });

    it("fails closed when the open-route adapter returns malformed output", async () => {
      assert.deepEqual(await navigationDeepLink({ route: "/customers" }, {
        openExpoRoute: async () => toolJson("not-json-object" as unknown),
      }), {
        available: false,
        action: "deep-link",
        source: "open-route",
        evidenceSource: "deep-link",
        reason: "Open-route result was malformed.",
        policy: DEEP_LINK_POLICY,
      });
    });
  });

  describe("runtime availability and transport envelopes", () => {
    it("returns the legacy unavailable payload and limitations when Metro has no inspector websocket", async () => {
      const payload = parseToolJson(await navigationCommand({ action: "state", metroPort: 9 }, {
        metroTargets: async () => [
          { id: "metadata-only", title: "No runtime", webSocketDebuggerUrl: null },
        ],
      }));

      assert.deepEqual(payload, unavailableState(9));
    });

    it("returns unavailable with target summary and default Hermes transport when Hermes returns no value", async () => {
      const payload = parseToolJson(await navigationCommand({ action: "state", metroPort: 19000 }, {
        metroTargets: async () => [TARGET],
        evaluateHermesExpression: async () => ({
          error: "Runtime.evaluate failed.",
          diagnostics: { sessionId: "cdp-session-1", closeCode: 1006 },
        }),
      }));

      assert.deepEqual(payload, {
        available: false,
        action: "state",
        source: "app-instrumentation",
        evidenceSource: "unavailable",
        reason: "Runtime.evaluate failed.",
        metroPort: 19000,
        target: TARGET_SUMMARY,
        transport: {
          name: "metro-inspector-hermes-cdp",
          metroPort: 19000,
          protocol: "Runtime.evaluate",
          target: TARGET_SUMMARY,
          cdp: null,
        },
        policy: READ_POLICY,
        limitations: LIMITATIONS,
      });
    });

    it("merges successful Hermes values with action, port, target summary, diagnostics, evidenceSource, and policy", async () => {
      const payload = parseToolJson(await navigationCommand({ action: "state", metroPort: 19000 }, {
        metroTargets: async () => [TARGET],
        evaluateHermesExpression: async () => ({
          result: {
            result: {
              value: {
                available: true,
                source: "plugin-bridge",
                domain: "navigation",
                bridgeVersion: "1.0.0",
                state: { route: "/customers" },
              },
            },
          },
          diagnostics: { sessionId: "cdp-session-1", calls: [{ method: "Runtime.evaluate" }] },
        }),
      }));

      assert.deepEqual(payload, {
        available: true,
        source: "plugin-bridge",
        domain: "navigation",
        bridgeVersion: "1.0.0",
        state: { route: "/customers" },
        action: "state",
        metroPort: 19000,
        target: TARGET_SUMMARY,
        transport: {
          name: "metro-inspector-hermes-cdp",
          metroPort: 19000,
          protocol: "Runtime.evaluate",
          target: TARGET_SUMMARY,
          cdp: { sessionId: "cdp-session-1", calls: [{ method: "Runtime.evaluate" }] },
        },
        evidenceSource: "plugin-bridge",
        policy: READ_POLICY,
      });
    });

    it("exposes target summaries, unavailable envelopes, and navigation transport exactly like legacy helpers", () => {
      assert.equal(targetSummary(null), null);
      assert.deepEqual(targetSummary(TARGET), TARGET_SUMMARY);
      assert.deepEqual(navigationTransport(19000, TARGET, { sessionId: "cdp-session-1" }), {
        name: "metro-inspector-hermes-cdp",
        metroPort: 19000,
        protocol: "Runtime.evaluate",
        target: TARGET_SUMMARY,
        cdp: { sessionId: "cdp-session-1" },
      });
      assert.deepEqual(navigationUnavailable({
        action: "tab",
        metroPort: 19000,
        reason: "Navigation bridge did not return a value.",
        target: TARGET_SUMMARY,
        policy: deniedPolicy("navigation.tab", "device"),
      }), {
        available: false,
        action: "tab",
        source: "app-instrumentation",
        evidenceSource: "unavailable",
        reason: "Navigation bridge did not return a value.",
        metroPort: 19000,
        target: TARGET_SUMMARY,
        transport: {
          name: "metro-inspector-hermes-cdp",
          metroPort: 19000,
          protocol: "Runtime.evaluate",
          target: TARGET_SUMMARY,
          cdp: null,
        },
        policy: deniedPolicy("navigation.tab", "device"),
        limitations: LIMITATIONS,
      });
    });
  });

  describe("runtime navigation expression", () => {
    it("includes plugin bridge lookup, version mismatch, navigation actions, tab payload, and app instrumentation fallback", () => {
      const expression = navigationExpression({ action: "state" });

      assert.match(expression, /__EXPO_IOS_DEVTOOLS_BRIDGE__/);
      assert.match(expression, /__EXPO_IOS_PLUGIN_BRIDGE__/);
      assert.match(expression, /__ROZENITE_AGENT_BRIDGE__/);
      assert.match(expression, /version-mismatch/);
      assert.match(expression, /navigation\.state/);
      assert.match(expression, /popToRoot/);
      assert.match(expression, /__EXPO_IOS_NAVIGATION_BRIDGE__/);
      assert.match(expression, /__EXPO_IOS_INSTRUMENTATION__/);

      assert.deepEqual(evaluateNavigationExpression(expression, {
        __EXPO_IOS_DEVTOOLS_BRIDGE__: {
          metadata: { bridgeVersion: "0.0.1" },
          navigation: { state: { route: "/customers" } },
        },
      }), {
        available: false,
        action: "state",
        source: "plugin-bridge",
        domain: "navigation",
        code: "version-mismatch",
        bridgeVersion: "0.0.1",
        expectedBridgeVersion: "1.0.0",
        reason: "Navigation plugin bridge version is not compatible with this CLI.",
        state: null,
      });

      assert.deepEqual(evaluateNavigationExpression(navigationExpression({ action: "state" }), {
        __EXPO_IOS_PLUGIN_BRIDGE__: {
          metadata: { bridgeVersion: "1.0.0" },
          navigation: { state: { route: "/customers" } },
        },
      }), {
        available: true,
        action: "state",
        source: "plugin-bridge",
        domain: "navigation",
        bridgeVersion: "1.0.0",
        state: { route: "/customers" },
      });

      assert.deepEqual(evaluateNavigationExpression(navigationExpression({ action: "back" }), {
        __EXPO_IOS_PLUGIN_BRIDGE__: {
          navigation: { actions: { back: () => ({ action: "back" }) } },
        },
      }), {
        available: true,
        action: "back",
        source: "plugin-bridge",
        domain: "navigation",
        bridgeVersion: null,
        result: { action: "back" },
      });

      assert.deepEqual(evaluateNavigationExpression(navigationExpression({ action: "pop-to-root" }), {
        __EXPO_IOS_PLUGIN_BRIDGE__: {
          navigation: { actions: { popToRoot: () => ({ action: "pop-to-root" }) } },
        },
      }), {
        available: true,
        action: "pop-to-root",
        source: "plugin-bridge",
        domain: "navigation",
        bridgeVersion: null,
        result: { action: "pop-to-root" },
      });

      assert.deepEqual(evaluateNavigationExpression(navigationExpression({ action: "tab", tab: "settings" }), {
        __EXPO_IOS_PLUGIN_BRIDGE__: {
          domains: [{ name: "navigation" }],
          callTool: (name: string, payload: unknown) => ({ name, payload }),
        },
      }), {
        available: true,
        action: "tab",
        source: "plugin-bridge",
        domain: "navigation",
        bridgeVersion: null,
        tab: "settings",
        result: { name: "navigation.tab", payload: { tab: "settings" } },
      });

      assert.deepEqual(evaluateNavigationExpression(navigationExpression({ action: "state" }), {
        __EXPO_IOS_INSTRUMENTATION__: {
          navigation: { state: () => ({ route: "/instrumented" }) },
        },
      }), {
        available: true,
        action: "state",
        source: "app-instrumentation",
        state: { route: "/instrumented" },
      });
    });
  });
});

function deniedPolicy(action: string, sideEffect: "device"): NavigationPolicyDecision {
  return {
    checked: true,
    action,
    sideEffect,
    allowed: false,
    source: null,
    reason: "No action policy allowed this state-changing operation.",
  };
}

function unavailableState(metroPort: number): unknown {
  return {
    available: false,
    action: "state",
    source: "app-instrumentation",
    evidenceSource: "unavailable",
    reason: "No Metro inspector target.",
    metroPort,
    target: null,
    transport: {
      name: "metro-inspector-hermes-cdp",
      metroPort,
      protocol: "Runtime.evaluate",
      target: null,
      cdp: null,
    },
    policy: READ_POLICY,
    limitations: LIMITATIONS,
  };
}

function toolJson(value: unknown): ToolTextResult {
  return { content: [{ type: "text", text: `${JSON.stringify(value, null, 2)}\n` }] };
}

function parseToolJson(result: ToolTextResult): unknown {
  return JSON.parse(result.content[0]?.text ?? "null") as unknown;
}

function evaluateNavigationExpression(expression: string, sandbox: Record<string, unknown>): unknown {
  const evaluate = Function("sandbox", `"use strict"; const globalThis = sandbox; return ${expression};`) as (
    sandbox: Record<string, unknown>,
  ) => unknown;
  return evaluate(sandbox);
}
