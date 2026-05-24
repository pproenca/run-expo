import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  dialogCommand,
  sheetCommand,
  bridgeRuntimeTransport,
  domainUnavailable,
  toolJson,
} from "../main/index.js";
import type { ModalBridgeDependencies, ToolTextResult } from "../main/index.js";

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

describe("modal-blocker-actions legacy characterization", () => {
  it("defaults dialog and sheet actions to status and preserves read policy metadata", async () => {
    const expressions: string[] = [];
    const deps = depsWithRuntime({
      evaluateHermesExpression: async (_url, expression, options) => {
        expressions.push(expression);
        assert.equal(options.timeoutMs, 5000);
        return hermesValue({
          available: true,
          source: "app-instrumentation",
          action: "status",
          visible: true,
          dialog: { title: "Confirm", message: "Proceed?" },
        });
      },
    });

    const payload = parseToolJson(await dialogCommand({}, deps));

    assert.equal(payload.available, true);
    assert.equal(payload.domain, "dialog");
    assert.equal(payload.action, "status");
    assert.equal(payload.policy.sideEffect, "read");
    assert.equal(payload.policy.allowed, true);
    assert.match(expressions[0] ?? "", /__EXPO_IOS_DIALOG_BRIDGE__/);
    assert.match(expressions[0] ?? "", /const action = "status"/);
  });

  it("accepts dialog text from flags or positionals and marks accept/dismiss as legacy non-destructive device actions", async () => {
    const expressions: string[] = [];
    const deps = depsWithRuntime({
      evaluateHermesExpression: async (_url, expression) => {
        expressions.push(expression);
        return hermesValue({
          available: true,
          source: "app-instrumentation",
          action: "accept",
          result: { accepted: true, token: "secret-token" },
        });
      },
    });

    const flagged = parseToolJson(await dialogCommand({ action: "accept", text: "OK" }, deps));
    const positional = parseToolJson(await dialogCommand({ _: ["accept", "Proceed"] }, deps));

    assert.equal(flagged.policy.action, "dialog.accept");
    assert.equal(flagged.policy.sideEffect, "device");
    assert.equal(flagged.policy.allowed, true);
    assert.equal(flagged.policy.reason, "Modal action is non-destructive.");
    assert.equal(flagged.result.token, "[redacted]");
    assert.match(expressions[0] ?? "", /const text = "OK"/);
    assert.match(expressions[1] ?? "", /const text = "Proceed"/);
    assert.equal(positional.action, "accept");
  });

  it("handles sheet status and dismiss with sheet-specific bridge globals and payload keys", async () => {
    const expressions: string[] = [];
    const deps = depsWithRuntime({
      evaluateHermesExpression: async (_url, expression) => {
        expressions.push(expression);
        if (expression.includes('const action = "status"')) {
          return hermesValue({
            available: true,
            source: "app-instrumentation",
            action: "status",
            visible: true,
            sheet: { name: "checkout" },
          });
        }
        return hermesValue({
          available: true,
          source: "app-instrumentation",
          action: "dismiss",
          result: { dismissed: true },
        });
      },
    });

    const status = parseToolJson(await sheetCommand({}, deps));
    const dismissed = parseToolJson(await sheetCommand({ action: "dismiss" }, deps));

    assert.equal(status.sheet.name, "checkout");
    assert.equal(status.policy.action, "sheet.status");
    assert.equal(dismissed.result.dismissed, true);
    assert.equal(dismissed.policy.action, "sheet.dismiss");
    assert.equal(dismissed.policy.sideEffect, "device");
    assert.match(expressions[0] ?? "", /__EXPO_IOS_SHEET_BRIDGE__/);
    assert.match(expressions[1] ?? "", /const action = "dismiss"/);
  });

  it("rejects unknown modal actions with legacy messages", async () => {
    await assert.rejects(() => dialogCommand({ action: "close" }), /Unknown dialog action: close/);
    await assert.rejects(() => sheetCommand({ action: "accept" }), /Unknown sheet action: accept/);
  });

  it("surfaces no-runtime-target, transport-failure, and bridge unavailable states", async () => {
    const noTarget = parseToolJson(await dialogCommand({ action: "status", metroPort: 9 }, {
      metroTargets: async () => [],
    }));
    const noValue = parseToolJson(await sheetCommand({ action: "status" }, depsWithRuntime({
      evaluateHermesExpression: async () => ({ error: "runtime exploded" }),
    })));
    const missingBridge = parseToolJson(await dialogCommand({ action: "status" }, depsWithRuntime({
      evaluateHermesExpression: async () => hermesValue({
        available: false,
        source: "app-instrumentation",
        reason: "dialog bridge is not installed.",
        action: "status",
      }),
    })));

    assert.equal(noTarget.code, "no-runtime-target");
    assert.equal(noValue.code, "transport-failure");
    assert.equal(noValue.reason, "runtime exploded");
    assert.equal(missingBridge.available, false);
    assert.equal(missingBridge.reason, "dialog bridge is not installed.");
  });

  it("preserves stable transport, unavailable, and bounded tool JSON helper contracts", () => {
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
    assert.equal(domainUnavailable({
      domain: "dialog",
      action: "status",
      metroPort: 8081,
      reason: "No Metro inspector target.",
      policy: { checked: true, action: "dialog.status", allowed: true, source: "/tmp/policy.json?token=secret-token" },
    }).policy?.source, "/tmp/policy.json?token=[redacted]");

    const bounded = toolJson({
      domain: "dialog",
      action: "status",
      value: Object.fromEntries(Array.from({ length: 2000 }, (_, index) => [`key${index}`, "x".repeat(100)])),
    });
    const payload = parseToolJson(bounded);
    assert.equal(payload.code, "output-truncated");
    assert.equal(payload.outputTruncated, true);
    assert.equal((bounded.content[0]?.text.length ?? 0) <= 40000, true);
  });
});

function depsWithRuntime(overrides: Partial<ModalBridgeDependencies> = {}): ModalBridgeDependencies {
  return {
    metroTargets: async () => [TARGET],
    ...overrides,
  };
}

function hermesValue(value: unknown) {
  return { result: { result: { value } }, diagnostics: { calls: 1 } };
}

function parseToolJson(result: ToolTextResult): any {
  return JSON.parse(result.content[0]?.text ?? "null");
}
