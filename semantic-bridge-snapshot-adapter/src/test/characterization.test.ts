import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  bridgeRuntimeTransport,
  normalizeSemanticBridgeRefs,
  semanticBridgeExpression,
  semanticBridgeSnapshot,
  targetSummary
} from "../main/index.js";
import type { SnapshotFilters } from "../main/index.js";

const FILTERS: SnapshotFilters = {
  interactiveOnly: false,
  compact: false,
  depth: null,
  includeSource: true,
  includeBounds: true,
};

describe("semantic-bridge-snapshot-adapter legacy characterization", () => {
  it("returns no-runtime-target with clamped metro port and first target summary", async () => {
    const payload = await semanticBridgeSnapshot(
      { metroPort: 0 },
      { filters: FILTERS },
      {
        metroTargets: () => [{ id: "target-1", title: "No WS" }],
        evaluateHermesExpression: unreachableEvaluate,
      },
    );

    assert.deepEqual(payload, {
      available: false,
      source: "plugin-bridge-semantic",
      code: "no-runtime-target",
      reason: "No Metro inspector target.",
      metroPort: 1,
      transport: bridgeRuntimeTransport(1, { id: "target-1", title: "No WS" }, null),
    });
  });

  it("prefers a target with websocket and evaluates the semantic expression with timeout", async () => {
    const calls: any[] = [];
    const payload = await semanticBridgeSnapshot(
      { metroPort: 8082 },
      { stateRoot: "/state", session: { sessionId: "session-1" }, filters: FILTERS },
      {
        metroTargets: () => [
          { id: "target-no-ws" },
          { id: "target-ws", webSocketDebuggerUrl: "ws://debugger", devtoolsFrontendUrl: "/debug" },
        ],
        evaluateHermesExpression: (url, expression, options) => {
          calls.push({ url, expression, options });
          return hermesValue({
            available: true,
            source: "custom-semantic",
            bridgeVersion: "1.0.0",
            routeHint: "/home",
            refs: [{ role: "AXButton", label: "Save", frame: { x: 1, y: 2, width: 3, height: 4 } }],
            limitations: ["runtime-defined"],
          }, { connected: true });
        },
      },
    );

    assert.equal(calls[0].url, "ws://debugger");
    assert.match(calls[0].expression, /snapshot\.capture/);
    assert.deepEqual(calls[0].options, { timeoutMs: 5000 });
    assert.equal(payload.available, true);
    assert.equal(payload.source, "custom-semantic");
    assert.equal(payload.routeHint, "/home");
    assert.equal(payload.rawCount, 1);
    assert.deepEqual(payload.transport.cdp, { connected: true });
    assert.deepEqual(payload.refs[0].box, { x: 1, y: 2, width: 3, height: 4 });
  });

  it("returns transport-failure when Hermes evaluation has no object value", async () => {
    const payload = await semanticBridgeSnapshot(
      {},
      { filters: FILTERS },
      {
        metroTargets: () => [{ webSocketDebuggerUrl: "ws://debugger" }],
        evaluateHermesExpression: () => ({ error: "boom", diagnostics: { closed: true } }),
      },
    );

    assert.equal(payload.available, false);
    assert.equal(payload.code, "transport-failure");
    assert.equal(payload.reason, "boom");
    assert.deepEqual(payload.transport.cdp, { closed: true });
  });

  it("redacts unavailable runtime payloads and preserves source fallback", async () => {
    const payload = await semanticBridgeSnapshot(
      {},
      { filters: FILTERS },
      {
        metroTargets: () => [{ webSocketDebuggerUrl: "ws://debugger" }],
        evaluateHermesExpression: () => hermesValue({
          available: false,
          code: "missing-domain",
          reason: "Semantic snapshot bridge domain is not registered.",
          raw: { authorization: "Bearer secret", url: "https://example.test?token=secret&ok=1" },
        }),
      },
    );

    assert.equal(payload.available, false);
    assert.equal(payload.source, "plugin-bridge-semantic");
    assert.deepEqual(payload.raw, {
      authorization: "[redacted]",
      url: "https://example.test?token=[redacted]&ok=1",
    });
  });

  it("uses elements fallback, default source, default limitations, and raw count", async () => {
    const payload = await semanticBridgeSnapshot(
      {},
      { filters: { ...FILTERS, includeSource: false, includeBounds: false } },
      {
        metroTargets: () => [{ webSocketDebuggerUrl: "ws://debugger" }],
        evaluateHermesExpression: () => hermesValue({
          available: true,
          elements: [{ type: "AXTextField", name: "Email", source: { file: "Email.tsx" }, box: { x: 1, y: 2, width: 3, height: 4 } }],
        }),
      },
    );

    assert.equal(payload.source, "plugin-bridge-semantic");
    assert.equal(payload.bridgeVersion, null);
    assert.equal(payload.routeHint, null);
    assert.equal(payload.rawCount, 1);
    assert.equal(payload.refs[0].source, null);
    assert.equal(payload.refs[0].box, null);
    assert.deepEqual(payload.limitations, [
      "Semantic bridge data is app-defined and should be cross-checked with native accessibility or screenshots for visual assertions.",
    ]);
  });

  it("normalizes semantic refs with filters, field fallbacks, disabled flag, and raw redaction", () => {
    const refs = normalizeSemanticBridgeRefs([
      {
        type: "AXButton",
        name: "Submit",
        value: "Send",
        nativeID: "native-submit",
        component: "SubmitButton",
        raw: { password: "secret" },
      },
      { role: "AXImage", raw: { token: "secret" } },
    ], { ...FILTERS, interactiveOnly: true });

    assert.deepEqual(refs, [{
      role: "button",
      label: "Submit",
      text: "Send",
      placeholder: null,
      testID: "native-submit",
      nativeID: "native-submit",
      component: "SubmitButton",
      source: null,
      box: null,
      actions: ["tap", "inspect"],
      disabled: false,
      raw: { password: "[redacted]" },
    }]);
  });

  it("preserves target summary and expression markers", () => {
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
      capabilities: { hermesRuntime: true, devtoolsFrontend: true, reactNative: true },
    });
    assert.match(semanticBridgeExpression({ filters: FILTERS }), /__EXPO_IOS_DEVTOOLS_BRIDGE__/);
    assert.match(semanticBridgeExpression({ filters: FILTERS }), /__ROZENITE_AGENT_BRIDGE__/);
  });
});

function hermesValue(value: Record<string, unknown>, diagnostics: unknown = null) {
  return {
    result: { result: { value } },
    diagnostics,
  };
}

function unreachableEvaluate(): never {
  throw new Error("evaluateHermesExpression should not be called");
}
