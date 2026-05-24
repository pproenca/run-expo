import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  EXPO_IOS_BRIDGE_VERSION,
  bridgeHealthExpression,
  bridgeHealthPayload,
  bridgeInstallSummary,
  targetSummary
} from "../main/index.js";
import type { BridgeInstallStatus } from "../main/index.js";

const PROJECT_ROOT = "/work/expo-app";
const PLAN = { requiredConfirmations: ["bridge-install", "bridge-remove"], status: "present" };

describe("bridge-health-payload-adapter legacy characterization", () => {
  it("short-circuits stale bridge installs before Metro probing", async () => {
    let probed = false;
    const payload = await bridgeHealthPayload(
      { domain: "storage", command: "set" },
      { action: "health", status: statusFixture({ state: "stale", issues: [{ code: "partial-install", message: "Bridge metadata and source file are not both present." }] }), plan: PLAN },
      { metroTargets: () => { probed = true; return metroResult(); } }
    );

    assert.equal(probed, false);
    assert.equal(payload.available, false);
    assert.equal(payload.code, "stale-bridge");
    assert.equal(payload.reason, "Bridge metadata and source file are not both present.");
    assert.equal(payload.domainCount, 8);
    assert.equal((payload.policy as any).action, "storage.set");
    assert.equal((payload.policy as any).denied, true);
  });

  it("short-circuits incompatible projects with install summary", async () => {
    const status = statusFixture({ state: "incompatible", issues: [{ code: "missing-expo", message: "The project does not declare expo, so an Expo DevTools bridge cannot be installed safely." }] });
    const payload = await bridgeHealthPayload({}, { action: "domains", status, plan: PLAN });

    assert.equal(payload.code, "incompatible-project");
    assert.deepEqual(payload.install, bridgeInstallSummary(status));
    assert.equal(payload.transport.inspectorEndpoint, "http://127.0.0.1:8081/json/list");
  });

  it("returns transport failure with Metro evidence when no Hermes WebSocket target is available", async () => {
    const payload = await bridgeHealthPayload(
      { metroPort: 90000 },
      { action: "health", status: statusFixture(), plan: PLAN },
      {
        metroTargets: (metroPort) => metroResult({
          available: true,
          endpoint: `http://127.0.0.1:${metroPort}/json/list`,
          targets: [{ id: "target-1", title: "No WS" }],
          malformedTargets: [{ bad: true }]
        })
      }
    );

    assert.equal(payload.code, "transport-failure");
    assert.equal(payload.transport.metroPort, 65535);
    assert.equal(payload.transport.target.id, "target-1");
    assert.equal(payload.metro.targetCount, 1);
    assert.deepEqual(payload.metro.malformedTargets, [{ bad: true }]);
  });

  it("prefers a websocket target and evaluates the bridge health expression with diagnostics", async () => {
    const calls: any[] = [];
    const payload = await bridgeHealthPayload(
      { domain: "navigation", command: "state" },
      { action: "health", status: statusFixture(), plan: PLAN },
      {
        metroTargets: () => metroResult({
          targets: [
            { id: "no-ws", title: "No WS" },
            { id: "ws", title: "Hermes", webSocketDebuggerUrl: "ws://debugger", devtoolsFrontendUrl: "/debug", reactNative: { logicalDeviceId: "sim" } }
          ]
        }),
        evaluateHermesExpression: (webSocketDebuggerUrl, expression, options) => {
          calls.push({ webSocketDebuggerUrl, expression, options });
          return hermesValue({
            available: true,
            registered: true,
            bridgeVersion: EXPO_IOS_BRIDGE_VERSION,
            appRegistration: { appId: "app-1", runtimeName: "Expo Go" },
            domains: [{ name: "navigation", readCommands: ["state"], writeCommands: ["deep-link"] }]
          }, { diagnostics: { connected: true } });
        }
      }
    );

    assert.equal(calls[0].webSocketDebuggerUrl, "ws://debugger");
    assert.match(calls[0].expression, /__EXPO_IOS_BRIDGE_HEALTH__/);
    assert.deepEqual(calls[0].options, { timeoutMs: 5000 });
    assert.equal(payload.available, true);
    assert.equal(payload.health, "healthy");
    assert.equal(payload.transport.target.id, "ws");
    assert.deepEqual(payload.transport.cdp, { connected: true });
    assert.equal(payload.appRegistration.appId, "app-1");
    assert.equal(payload.policy.allowed, true);
  });

  it("returns transport failure when Runtime.evaluate has no value", async () => {
    const payload = await bridgeHealthPayload(
      {},
      { action: "health", status: statusFixture(), plan: PLAN },
      {
        metroTargets: () => metroResult({ targets: [{ webSocketDebuggerUrl: "ws://debugger" }] }),
        evaluateHermesExpression: () => ({ error: "boom" })
      }
    );

    assert.equal(payload.code, "transport-failure");
    assert.equal(payload.reason, "boom");
  });

  it("normalizes missing app registration and version mismatch as unavailable", async () => {
    const missingRegistration = await payloadForRuntime({ available: true, registered: false, bridgeVersion: EXPO_IOS_BRIDGE_VERSION });
    const mismatch = await payloadForRuntime({ available: true, registered: true, bridgeVersion: "0.9.0" });

    assert.equal(missingRegistration.code, "missing-app-registration");
    assert.equal(missingRegistration.reason, "The bridge object exists but the app has not registered with it.");
    assert.equal(mismatch.code, "version-mismatch");
    assert.equal(mismatch.reason, "Bridge version 0.9.0 does not match CLI bridge version 1.0.0.");
  });

  it("normalizes runtime domains, appends unknown domains, and reports redaction boundaries", async () => {
    const payload = await payloadForRuntime({
      available: true,
      registered: true,
      metadata: { bridgeVersion: EXPO_IOS_BRIDGE_VERSION },
      domains: [
        { name: "network", readCommands: ["list"], writeCommands: ["clear"], redactionBoundaries: ["headers.authorization"] },
        { name: "custom", reads: ["read"], writes: ["write"] }
      ]
    }, { domain: "custom", command: "write", actionPolicy: "/tmp/policy.json" });

    assert.equal(payload.available, true);
    assert.equal(payload.domainCount, 9);
    assert.equal(payload.writableDomainCount, 7);
    assert.equal(payload.domains.find((domain: any) => domain.name === "custom").source, "runtime-registration");
    assert.deepEqual(payload.redactionBoundaries.find((item: any) => item.domain === "custom"), {
      domain: "custom",
      boundaries: ["domain-defined values"]
    });
    assert.deepEqual(payload.policy, {
      checked: true,
      allowed: null,
      denied: null,
      sideEffect: "write",
      action: "custom.write",
      reason: "Policy file will be evaluated before executing bridge write commands.",
      source: "/tmp/policy.json",
      domain: "custom",
      command: "write",
      actionPolicyRequired: true
    });
  });

  it("preserves target summaries and bridge expression markers", () => {
    assert.equal(targetSummary(null), null);
    assert.deepEqual(targetSummary({ webSocketDebuggerUrl: "ws://debugger", devtoolsFrontendUrl: "/debug", reactNative: true }), {
      id: null,
      title: null,
      description: null,
      appId: null,
      deviceName: null,
      devtoolsFrontendUrl: "/debug",
      webSocketDebuggerUrl: "ws://debugger",
      reactNative: true,
      capabilities: { hermesRuntime: true, devtoolsFrontend: true, reactNative: true }
    });
    assert.match(bridgeHealthExpression(), /__EXPO_IOS_DEVTOOLS_BRIDGE__/);
    assert.match(bridgeHealthExpression(), /__ROZENITE_AGENT_BRIDGE__/);
  });
});

async function payloadForRuntime(value: Record<string, unknown>, args: Record<string, unknown> = {}) {
  return bridgeHealthPayload(args, { action: "health", status: statusFixture(), plan: PLAN }, {
    metroTargets: () => metroResult({ targets: [{ webSocketDebuggerUrl: "ws://debugger" }] }),
    evaluateHermesExpression: () => hermesValue(value),
    resolvePath: (...parts) => parts.join("/")
  });
}

function statusFixture(overrides: Partial<BridgeInstallStatus> = {}): BridgeInstallStatus {
  return { ...baseStatus(), ...overrides };
}

function baseStatus(): BridgeInstallStatus {
  return {
    projectRoot: PROJECT_ROOT,
    state: "present",
    bridgeVersion: "1.0.0",
    expectedBridgeVersion: "1.0.0",
    developmentOnly: true,
    metadataPath: `${PROJECT_ROOT}/.expo-ios/bridge.json`,
    sourcePath: `${PROJECT_ROOT}/src/expo-ios-devtools-bridge.ts`,
    files: { metadata: true, source: true },
    dependencies: { expo: "~52.0.0", rozenite: [] },
    issues: []
  };
}

function metroResult(overrides: Partial<any> = {}) {
  return {
    available: false,
    endpoint: "http://127.0.0.1:8081/json/list",
    targets: [],
    malformedTargets: [],
    reason: "No Metro Hermes inspector target is available for bridge discovery.",
    ...overrides
  };
}

function hermesValue(value: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return {
    result: { result: { value } },
    ...extra
  };
}
