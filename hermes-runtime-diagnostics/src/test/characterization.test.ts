import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  evaluateHermesExpression,
  inspectHermesRuntime,
  normalizeProtocolError,
  protocolErrorMessage,
  responseShape,
  runtimeGlobalsExpression,
  shortDiagnostic,
  summarizeScripts,
} from "../main/index.js";
import type {
  HermesCdpClientLike,
  HermesRuntimeDiagnosticsDependencies,
} from "../main/index.js";

describe("hermes-runtime-diagnostics legacy characterization", () => {
  it("returns unavailable payloads for missing target URL or unavailable WebSocket runtime", async () => {
    const deps = depsWithClient(new FakeHermesClient());
    assert.deepEqual(await inspectHermesRuntime(null, deps), {
      available: false,
      reason: "No Metro inspector target.",
    });
    assert.deepEqual(await inspectHermesRuntime("ws://target", { ...deps, webSocketAvailable: false }), {
      available: false,
      reason: "This Node runtime does not expose a WebSocket client.",
    });
    assert.deepEqual(await evaluateHermesExpression("ws://target", "1", { ...deps, webSocketAvailable: false }), {
      error: "This Node runtime does not expose a WebSocket client.",
    });
  });

  it("orchestrates inspectHermesRuntime calls, waits, summarizes scripts, and closes the client", async () => {
    const client = new FakeHermesClient({
      calls: {
        "Runtime.getHeapUsage": { result: { usedSize: 10 } },
        "Runtime.evaluate:globals": { result: { result: { value: { hermes: true } } } },
        "Runtime.evaluate:components": { result: { result: { value: { tree: ["Root"] } } } },
      },
      events: [
        { method: "Debugger.scriptParsed", params: { scriptId: "1", url: "http://localhost:8081/apps/mobile/app/index.tsx?platform=ios", sourceMapURL: null } },
        { method: "Debugger.scriptParsed", params: { scriptId: "2", url: "http://localhost:8081/node_modules/react/index.js", sourceMapURL: null } },
      ],
      diagnostics: { calls: [{ method: "Runtime.enable" }] },
    });
    const waits: number[] = [];
    const deps = depsWithClient(client, {
      wait: (ms) => {
        waits.push(ms);
      },
      componentHierarchyExpression: () => "COMPONENT_EXPR",
    });

    assert.deepEqual(await inspectHermesRuntime("ws://target", deps, { target: { id: "target-1" } }), {
      available: true,
      webSocketDebuggerUrl: "ws://target",
      heap: { usedSize: 10 },
      globals: { hermes: true },
      componentHierarchy: { tree: ["Root"] },
      unsupportedOrErrors: [],
      loadedAppScripts: {
        totalScriptsObserved: 2,
        appScriptCount: 1,
        appScripts: [{ scriptId: "1", url: "http://localhost:8081/apps/mobile/app/index.tsx?platform=ios", sourceMapURL: null }],
        sourceOwners: ["/apps/mobile/app/index.tsx"],
      },
      cdp: { calls: [{ method: "Runtime.enable" }] },
    });
    assert.deepEqual(waits, [350]);
    assert.equal(client.closed, true);
    assert.deepEqual(client.callLog.map((call) => [call.method, call.options?.timeoutMs]), [
      ["Runtime.enable", 2500],
      ["Debugger.enable", 2500],
      ["Runtime.getHeapUsage", 2500],
      ["Runtime.evaluate", 2500],
      ["Runtime.evaluate", 3000],
    ]);
  });

  it("skips component hierarchy evaluation when includeComponents is false", async () => {
    const client = new FakeHermesClient({
      calls: {
        "Runtime.getHeapUsage": { result: { usedSize: 1 } },
        "Runtime.evaluate:globals": { result: { result: { value: { dev: true } } } },
      },
    });

    const payload = await inspectHermesRuntime("ws://target", depsWithClient(client), { includeComponents: false });

    assert.equal(payload.available, true);
    assert.deepEqual(payload.componentHierarchy, { skipped: true, reason: "includeComponents is false" });
    assert.equal(client.callLog.filter((call) => call.method === "Runtime.evaluate").length, 1);
  });

  it("returns formatted inspect errors with diagnostics and closes the client", async () => {
    const client = new FakeHermesClient({ connectError: new Error("connect failed"), diagnostics: { close: null } });

    assert.deepEqual(await inspectHermesRuntime("ws://target", depsWithClient(client)), {
      available: false,
      webSocketDebuggerUrl: "ws://target",
      error: "connect failed",
      cdp: { close: null },
    });
    assert.equal(client.closed, true);
  });

  it("enables runtime before evaluating expressions and returns diagnostics on enable errors", async () => {
    const enableErrorClient = new FakeHermesClient({
      calls: {
        "Runtime.enable": { error: "enable failed" },
      },
      diagnostics: { transport: "cdp" },
    });
    assert.deepEqual(await evaluateHermesExpression("ws://target", "1 + 1", depsWithClient(enableErrorClient)), {
      error: "enable failed",
      diagnostics: { transport: "cdp" },
    });
    assert.equal(enableErrorClient.closed, true);

    const client = new FakeHermesClient({
      calls: {
        "Runtime.evaluate:custom": { result: { result: { value: 2 } } },
      },
      diagnostics: { transport: "cdp" },
    });
    assert.deepEqual(await evaluateHermesExpression("ws://target", "1 + 1", depsWithClient(client), { timeoutMs: 99 }), {
      method: "Runtime.evaluate",
      result: { result: { value: 2 } },
      diagnostics: { transport: "cdp" },
    });
    assert.deepEqual(client.callLog.map((call) => ({ method: call.method, params: call.params, options: call.options })), [
      { method: "Runtime.enable", params: {}, options: { timeoutMs: 1500 } },
      {
        method: "Runtime.evaluate",
        params: { expression: "1 + 1", returnByValue: true, awaitPromise: true },
        options: { timeoutMs: 99 },
      },
    ]);
  });

  it("characterizes response shapes, protocol errors, messages, and short diagnostics", () => {
    assert.equal(responseShape(null), null);
    assert.deepEqual(responseShape([1, 2, 3]), { type: "array", length: 3 });
    assert.deepEqual(responseShape("text"), { type: "string" });
    const shaped = responseShape(Object.fromEntries(Array.from({ length: 25 }, (_, index) => [`k${index}`, index])));
    assert.deepEqual((shaped as { keys: string[] }).keys, Array.from({ length: 20 }, (_, index) => `k${index}`));
    assert.deepEqual(responseShape({ type: "object", result: { value: 1 } }), {
      type: "object",
      keys: ["type", "result"],
      resultType: "object",
      result: { type: "object", keys: ["value"] },
    });

    assert.deepEqual(normalizeProtocolError("bad"), { message: "bad", code: "protocol-error" });
    assert.deepEqual(normalizeProtocolError({ description: "denied", code: -32000, data: { reason: "nope" } }), {
      message: "denied",
      code: -32000,
      data: "{\"reason\":\"nope\"}",
    });
    assert.equal(protocolErrorMessage("bad"), "bad");
    assert.equal(protocolErrorMessage({ description: "denied", code: -32000 }), "denied (-32000)");
    assert.equal(protocolErrorMessage({}), "CDP protocol error");
    assert.equal(shortDiagnostic("abcdef", 3), "abc...");
  });

  it("summarizes loaded app scripts and source owners with legacy filters and limits", () => {
    const scripts = [
      { scriptId: "1", url: "http://localhost:8081/apps/mobile/app/index.tsx?platform=ios", sourceMapURL: null },
      { scriptId: "2", url: "http://localhost:8081/app/root.tsx", sourceMapURL: "http://localhost:8081/apps/mobile/app/root.tsx.map?x=1" },
      { scriptId: "3", url: "http://localhost:8081/node_modules/react/index.js", sourceMapURL: null },
      { scriptId: "4", sourceMapURL: "http://localhost:8081/apps/mobile/app/%5Bslug%5D.tsx.map?x=1" },
    ];

    assert.deepEqual(summarizeScripts(scripts), {
      totalScriptsObserved: 4,
      appScriptCount: 3,
      appScripts: [
        { scriptId: "1", url: "http://localhost:8081/apps/mobile/app/index.tsx?platform=ios", sourceMapURL: null },
        { scriptId: "2", url: "http://localhost:8081/app/root.tsx", sourceMapURL: "http://localhost:8081/apps/mobile/app/root.tsx.map?x=1" },
        { scriptId: "4", url: null, sourceMapURL: "http://localhost:8081/apps/mobile/app/%5Bslug%5D.tsx.map?x=1" },
      ],
      sourceOwners: [
        "/apps/mobile/app/index.tsx",
        "/apps/mobile/app/root.tsx.map",
        "/apps/mobile/app/[slug].tsx.map",
      ],
    });
  });

  it("keeps the runtime globals expression shape used by legacy Runtime.evaluate", () => {
    const expression = runtimeGlobalsExpression();
    assert.match(expression, /typeof __DEV__ !== 'undefined'/);
    assert.match(expression, /!!globalThis\.HermesInternal/);
    assert.match(expression, /Object\.keys\(globalThis\).*slice\(0, 80\)/s);
  });
});

class FakeHermesClient implements HermesCdpClientLike {
  readonly callLog: Array<{ method: string; params?: Record<string, unknown>; options?: { timeoutMs: number } }> = [];
  closed = false;

  constructor(private readonly options: {
    connectError?: unknown;
    calls?: Record<string, Record<string, any>>;
    events?: Array<{ method: string; params?: Record<string, any> }>;
    diagnostics?: unknown;
  } = {}) {}

  connect(): void {
    if (this.options.connectError) throw this.options.connectError;
  }

  call(method: string, params: Record<string, unknown> = {}, options?: { timeoutMs: number }): Record<string, any> {
    this.callLog.push({ method, params, options });
    if (method === "Runtime.enable") return this.options.calls?.["Runtime.enable"] ?? { result: {} };
    if (method === "Debugger.enable") return this.options.calls?.["Debugger.enable"] ?? { result: {} };
    if (method === "Runtime.getHeapUsage") return this.options.calls?.["Runtime.getHeapUsage"] ?? { result: {} };
    if (method === "Runtime.evaluate" && params.expression === "COMPONENT_EXPR") return this.options.calls?.["Runtime.evaluate:components"] ?? { result: { result: { value: null } } };
    if (method === "Runtime.evaluate" && params.expression === runtimeGlobalsExpression()) return this.options.calls?.["Runtime.evaluate:globals"] ?? { result: { result: { value: null } } };
    if (method === "Runtime.evaluate") return {
      method,
      ...(this.options.calls?.["Runtime.evaluate:custom"] ?? { result: { result: { value: null } } }),
    };
    return { result: {} };
  }

  events(method: string): Array<{ params?: Record<string, any> }> {
    return (this.options.events ?? []).filter((event) => event.method === method);
  }

  diagnostics(): unknown {
    return this.options.diagnostics ?? {};
  }

  close(): void {
    this.closed = true;
  }
}

function depsWithClient(client: FakeHermesClient, overrides: Partial<HermesRuntimeDiagnosticsDependencies> = {}): HermesRuntimeDiagnosticsDependencies {
  return {
    createClient: () => client,
    ...overrides,
  };
}
