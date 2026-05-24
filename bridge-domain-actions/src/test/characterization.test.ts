import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  bridgeRuntimeTransport,
  controlsCommand,
  parseStorageValue,
  policyDecision,
  policyDeniedPayload,
  stateCommand,
  storageCommand,
} from "../main/index.js";
import type { BridgeDomainDependencies, ToolTextResult } from "../main/index.js";

const TARGET = {
  id: "target-1",
  title: "Expo Go",
  description: "Hermes",
  appId: "host.exp.Exponent",
  deviceName: "iPhone 15",
  devtoolsFrontendUrl: "/debugger-ui",
  webSocketDebuggerUrl: "ws://127.0.0.1:19000/inspector/debug",
  reactNative: { debuggerFrontendConnected: true },
};

describe("bridge-domain-actions legacy characterization", () => {
  describe("policy gates", () => {
    it("allows read actions without a policy and denies write/device actions without one", async () => {
      assert.deepEqual(await policyDecision({}, "storage.list", "read"), {
        checked: true,
        action: "storage.list",
        sideEffect: "read",
        allowed: true,
        source: null,
        reason: "Read action does not require policy approval.",
      });

      assert.deepEqual(await policyDecision({}, "controls.press", "device"), {
        checked: true,
        action: "controls.press",
        sideEffect: "device",
        allowed: false,
        source: null,
        reason: "No action policy allowed this state-changing operation.",
      });
    });

    it("accepts allow[] and actions[action] policy forms for mutating actions", async () => {
      const deps = {
        readJsonFile: async (file: string) => {
          if (file.endsWith("allow.json")) return { allow: ["storage.set"] };
          return { actions: { "controls.press": "allow", "state.clear": true } };
        },
        resolvePath: (file: string) => `/abs/${file}`,
      };

      assert.equal((await policyDecision({ actionPolicy: "allow.json" }, "storage.set", "write", deps)).allowed, true);
      assert.equal((await policyDecision({ actionPolicy: "actions.json" }, "controls.press", "device", deps)).allowed, true);
      assert.equal((await policyDecision({ actionPolicy: "actions.json" }, "state.clear", "write", deps)).allowed, true);
      assert.equal((await policyDecision({ actionPolicy: "actions.json" }, "state.load", "write", deps)).allowed, false);
    });

    it("returns the stable policy denied payload before bridge execution", async () => {
      const deps = depsWithRuntime({
        evaluateHermesExpression: async () => {
          throw new Error("must not evaluate");
        },
      });

      assert.deepEqual(parseToolJson(await controlsCommand({ action: "press", name: "refresh" }, deps)), {
        available: false,
        domain: "controls",
        action: "press",
        source: "policy",
        evidenceSource: "policy",
        code: "policy-denied",
        denied: true,
        reason: "Policy denied action.",
        policy: {
          checked: true,
          action: "controls.press",
          sideEffect: "device",
          allowed: false,
          source: null,
          reason: "No action policy allowed this state-changing operation.",
        },
      });
    });
  });

  describe("storage command", () => {
    it("lists and gets storage through the bridge, clamps limits, and redacts returned values", async () => {
      const evaluated: Array<{ expression: string; timeoutMs: number }> = [];
      const deps = depsWithRuntime({
        evaluateHermesExpression: async (_url: string, expression: string, options: { timeoutMs: number }) => {
          evaluated.push({ expression, timeoutMs: options.timeoutMs });
          if (expression.includes('const action = "list"')) {
            return hermesValue({
              available: true,
              source: "plugin-bridge",
              domain: "storage",
              bridgeVersion: "1.0.0",
              store: "async",
              action: "list",
              keys: ["auth", "featureFlags"],
            });
          }
          return hermesValue({
            available: true,
            source: "plugin-bridge",
            domain: "storage",
            bridgeVersion: "1.0.0",
            store: "async",
            action: "get",
            key: "auth",
            value: { token: "secret-token", theme: "dark" },
          });
        },
      });

      const listed = parseToolJson(await storageCommand({ store: "async", action: "list", limit: 5000, metroPort: 19000 }, deps));
      const value = parseToolJson(await storageCommand({ store: "async", action: "get", key: "auth", metroPort: 19000 }, deps));

      assert.equal(listed.available, true);
      assert.equal(listed.evidenceSource, "plugin-bridge");
      assert.deepEqual(listed.keys, ["auth", "featureFlags"]);
      assert.equal(value.value.token, "[redacted]");
      assert.equal(value.value.theme, "dark");
      assert.match(evaluated[0]?.expression ?? "", /const limit = 1000/);
      assert.equal(evaluated[0]?.timeoutMs, 5000);
    });

    it("requires policy before parsing set values or evaluating runtime storage writes", async () => {
      const denied = parseToolJson(await storageCommand({ store: "async", action: "set", key: "auth", value: "{bad json" }, depsWithRuntime()));
      assert.equal(denied.denied, true);

      await assert.rejects(
        () => storageCommand({
          store: "async",
          action: "set",
          key: "auth",
          value: "{bad json",
          actionPolicy: "policy.json",
        }, depsWithRuntime({
          readJsonFile: async () => ({ allow: ["storage.set"] }),
        })),
        /Invalid JSON for --value/,
      );
    });

    it("executes policy-approved storage set and redacts before/after values", async () => {
      const payload = parseToolJson(await storageCommand({
        store: "async",
        action: "set",
        key: "auth",
        value: "{\"token\":\"secret-token\"}",
        actionPolicy: "policy.json?token=secret-token",
      }, depsWithRuntime({
        readJsonFile: async () => ({ allow: ["storage.set"] }),
        evaluateHermesExpression: async () => hermesValue({
          available: true,
          source: "plugin-bridge",
          domain: "storage",
          bridgeVersion: "1.0.0",
          store: "async",
          action: "set",
          key: "auth",
          before: { token: "old-secret-token" },
          after: { token: "secret-token" },
          result: { ok: true },
        }),
      })));

      assert.equal(payload.available, true);
      assert.equal(payload.policy.allowed, true);
      assert.equal(payload.policy.source, "/abs/policy.json?token=[redacted]");
      assert.equal(payload.before.token, "[redacted]");
      assert.equal(payload.after.token, "[redacted]");
    });

    it("surfaces bridge missing-domain and transport-failure states", async () => {
      const missingDomain = parseToolJson(await storageCommand({ store: "secure", action: "list" }, depsWithRuntime({
        evaluateHermesExpression: async () => hermesValue({
          available: false,
          source: "plugin-bridge",
          domain: "storage",
          code: "missing-domain",
          reason: "Unsupported storage store.",
          store: "secure",
          action: "list",
        }),
      })));
      const noRuntime = parseToolJson(await storageCommand({ store: "async", action: "list", metroPort: 9 }, {
        metroTargets: async () => [],
      }));
      const noValue = parseToolJson(await storageCommand({ store: "async", action: "list" }, depsWithRuntime({
        evaluateHermesExpression: async () => ({ error: "runtime exploded" }),
      })));

      assert.equal(missingDomain.code, "missing-domain");
      assert.equal(noRuntime.code, "no-runtime-target");
      assert.equal(noValue.code, "transport-failure");
      assert.equal(noValue.reason, "runtime exploded");
    });
  });

  describe("state and controls commands", () => {
    it("treats state list/save as reads and load/clear as writes", async () => {
      const list = parseToolJson(await stateCommand({ action: "list" }, depsWithRuntime({
        evaluateHermesExpression: async () => hermesValue({
          available: true,
          source: "app-instrumentation",
          action: "list",
          states: [{ name: "logged-in", savedAt: "2026-05-22T10:00:00.000Z" }],
        }),
      })));
      const save = parseToolJson(await stateCommand({ action: "save", name: "logged-in" }, depsWithRuntime({
        evaluateHermesExpression: async () => hermesValue({
          available: true,
          source: "app-instrumentation",
          action: "save",
          name: "logged-in",
          result: { ok: true },
        }),
      })));
      const deniedLoad = parseToolJson(await stateCommand({ action: "load", name: "logged-in" }, depsWithRuntime()));

      assert.equal(list.available, true);
      assert.equal(list.policy.sideEffect, "read");
      assert.equal(save.policy.sideEffect, "read");
      assert.equal(deniedLoad.denied, true);
      assert.equal(deniedLoad.policy.action, "state.load");
    });

    it("lists, gets, denies, and policy-approves controls press through the bridge contract", async () => {
      const policy = { actions: { "controls.press": "allow" } };
      const deps = depsWithRuntime({
        readJsonFile: async () => policy,
        evaluateHermesExpression: async (_url: string, expression: string) => {
          if (expression.includes('const action = "list"')) return hermesValue(fakeControlsValue("list"));
          if (expression.includes('const action = "get"')) return hermesValue(fakeControlsValue("get"));
          return hermesValue(fakeControlsValue("press"));
        },
      });

      const listed = parseToolJson(await controlsCommand({ action: "list" }, deps));
      const control = parseToolJson(await controlsCommand({ action: "get", name: "refreshCustomers" }, deps));
      const denied = parseToolJson(await controlsCommand({ action: "press", name: "refreshCustomers" }, depsWithRuntime()));
      const pressed = parseToolJson(await controlsCommand({
        action: "press",
        name: "refreshCustomers",
        actionPolicy: "policy.json",
      }, deps));

      assert.equal(listed.controls[0].name, "refreshCustomers");
      assert.equal(control.control.title, "Refresh customers");
      assert.equal(denied.denied, true);
      assert.equal(pressed.result.pressed, true);
      assert.equal(pressed.evidenceSource, "plugin-bridge");
      assert.equal(pressed.policy.allowed, true);
    });

    it("rejects unknown domain actions with legacy messages", async () => {
      await assert.rejects(() => storageCommand({ store: "async", action: "trace" }), /Unknown storage action: trace/);
      await assert.rejects(() => stateCommand({ action: "restore" }), /Unknown state action: restore/);
      await assert.rejects(() => controlsCommand({ action: "set" }), /Unknown controls action: set/);
    });
  });

  describe("shared helpers and expression contracts", () => {
    it("preserves stable transport, unavailable, policy denied, and JSON parsing helpers", () => {
      assert.deepEqual(bridgeRuntimeTransport(19000, TARGET, { calls: 1 }), {
        name: "metro-inspector-hermes-cdp",
        metroPort: 19000,
        protocol: "Runtime.evaluate",
        target: {
          id: "target-1",
          title: "Expo Go",
          description: "Hermes",
          appId: "host.exp.Exponent",
          deviceName: "iPhone 15",
          devtoolsFrontendUrl: "/debugger-ui",
          webSocketDebuggerUrl: "ws://127.0.0.1:19000/inspector/debug",
          reactNative: { debuggerFrontendConnected: true },
          capabilities: { hermesRuntime: true, devtoolsFrontend: true, reactNative: true },
        },
        cdp: { calls: 1 },
      });
      assert.deepEqual(policyDeniedPayload({
        domain: "storage",
        action: "clear",
        policy: { checked: true, allowed: false, source: "/tmp/policy.json?token=secret-token" },
      }), {
        available: false,
        domain: "storage",
        action: "clear",
        source: "policy",
        evidenceSource: "policy",
        code: "policy-denied",
        denied: true,
        reason: "Policy denied action.",
        policy: { checked: true, allowed: false, source: "/tmp/policy.json?token=[redacted]" },
      });
      assert.deepEqual(parseStorageValue({ ok: true }), { ok: true });
      assert.deepEqual(parseStorageValue("{\"ok\":true}"), { ok: true });
      assert.throws(() => parseStorageValue(undefined), /storage set requires a JSON value\./);
    });

    it("generates storage, state, and controls bridge expressions with legacy bridge global fallbacks", async () => {
      const expressions: string[] = [];
      const deps = depsWithRuntime({
        evaluateHermesExpression: async (_url: string, expression: string) => {
          expressions.push(expression);
          return hermesValue({ available: true, source: "app-instrumentation" });
        },
      });

      await storageCommand({ store: "async", action: "get", key: "auth", limit: 10 }, deps);
      await stateCommand({ action: "save", name: "logged-in" }, deps);
      await controlsCommand({ action: "get", name: "refreshCustomers" }, deps);

      const [storage, state, controls] = expressions;

      assert.match(storage ?? "", /__EXPO_IOS_DEVTOOLS_BRIDGE__/);
      assert.match(storage ?? "", /__ROZENITE_AGENT_BRIDGE__/);
      assert.match(storage ?? "", /Storage plugin bridge version is not compatible with this CLI\./);
      assert.match(state ?? "", /__EXPO_IOS_STATE_BRIDGE__/);
      assert.match(state ?? "", /State bridge is not installed\./);
      assert.match(controls ?? "", /__EXPO_IOS_CONTROLS_BRIDGE__/);
      assert.match(controls ?? "", /Controls plugin bridge version is not compatible with this CLI\./);
    });

    it("redacts appended metadata and bounds whole tool output", async () => {
      const payload = parseToolJson(await storageCommand({
        store: "async",
        action: "get",
        key: "auth",
      }, depsWithRuntime({
        evaluateHermesExpression: async () => hermesValue({
          available: true,
          source: "plugin-bridge",
          value: { password: "secret", url: "app://x?token=secret-token" },
        }),
      })));

      assert.equal(payload.value.password, "[redacted]");
      assert.equal(payload.value.url, "app://x?token=%5Bredacted%5D");

      const bounded = await storageCommand({ store: "async", action: "get", key: "huge" }, depsWithRuntime({
        evaluateHermesExpression: async () => hermesValue({
          available: true,
          source: "plugin-bridge",
          value: Object.fromEntries(Array.from({ length: 2000 }, (_, index) => [`key${index}`, "x".repeat(100)])),
        }),
      }));
      const boundedPayload = parseToolJson(bounded);
      assert.equal(boundedPayload.code, "output-truncated");
      assert.equal(boundedPayload.outputTruncated, true);
      assert.equal((bounded.content[0]?.text.length ?? 0) <= 40000, true);
    });
  });
});

function depsWithRuntime(overrides: Partial<BridgeDomainDependencies> = {}): BridgeDomainDependencies {
  return {
    metroTargets: async () => [TARGET],
    resolvePath: (file: string) => `/abs/${file}`,
    ...overrides,
  };
}

function hermesValue(value: unknown) {
  return { result: { result: { value } }, diagnostics: { calls: 1 } };
}

function fakeControlsValue(action: string) {
  const controls = [
    { name: "refreshCustomers", title: "Refresh customers", sideEffects: "network" },
  ];
  if (action === "list") return { available: true, source: "plugin-bridge", domain: "controls", bridgeVersion: "1.0.0", action, controls };
  if (action === "get") return { available: true, source: "plugin-bridge", domain: "controls", bridgeVersion: "1.0.0", action, name: "refreshCustomers", control: controls[0] };
  return { available: true, source: "plugin-bridge", domain: "controls", bridgeVersion: "1.0.0", action, name: "refreshCustomers", before: controls[0], after: controls[0], result: { pressed: true } };
}

function parseToolJson(result: ToolTextResult): any {
  return JSON.parse(result.content[0]?.text ?? "null");
}
