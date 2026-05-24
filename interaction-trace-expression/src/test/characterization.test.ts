import { describe, it } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";

import {
  clampNumber,
  interactionTraceExpression,
  requireOptionalString,
  targetSummary,
  toolJson,
  traceInteraction,
  unwrapToolJson,
} from "../main/index.js";
import type { TraceInteractionDependencies } from "../main/index.js";

const TRACE_KEY = "__EXPO_LOCAL_DEV_INTERACTION_TRACE__";

describe("interaction-trace-expression legacy characterization", () => {
  it("wraps and unwraps legacy JSON tool payloads", () => {
    assert.deepEqual(toolJson({ available: true }), {
      content: [{ type: "text", text: "{\n  \"available\": true\n}\n" }],
      isError: false,
    });
    assert.deepEqual(unwrapToolJson(toolJson({ available: true })), { available: true });
    assert.deepEqual(unwrapToolJson({ content: [{ type: "text", text: "plain" }] }), { text: "plain" });
  });

  it("validates trace command numbers, optional strings, and target summaries", () => {
    assert.equal(clampNumber(0, 1, 2000), 1);
    assert.equal(clampNumber(9000, 1, 2000), 2000);
    assert.throws(() => clampNumber("NaN", 1, 2000), /Expected a finite number, got NaN\./);
    assert.equal(requireOptionalString("  Calendar  "), "Calendar");
    assert.equal(requireOptionalString(" "), null);
    assert.deepEqual(targetSummary({
      title: "Hermes App",
      appId: "com.example.app",
      deviceName: "iPhone 15",
      description: "React Native",
      webSocketDebuggerUrl: "ws://target",
    }), {
      title: "Hermes App",
      appId: "com.example.app",
      deviceName: "iPhone 15",
      description: "React Native",
    });
  });

  it("traceInteraction returns the legacy unavailable payload when Metro has no websocket target", async () => {
    assert.deepEqual(unwrapToolJson(await traceInteraction({
      action: "read",
      metroPort: 70_000,
    }, traceDeps({ fetchMetroTargets: async () => [] }))), {
      available: false,
      action: "read",
      reason: "No Metro inspector target.",
      metroPort: 65535,
      limitations: [
        "No Hermes Runtime.evaluate trace was collected.",
        "React commits, layout changes, animation frames, and handler-bearing components are unavailable for this read.",
      ],
    });
  });

  it("traceInteraction catches Metro target fetch failures as no-target results", async () => {
    assert.deepEqual(unwrapToolJson(await traceInteraction({
      action: "start",
      metroPort: 8082,
    }, traceDeps({
      fetchMetroTargets: async () => {
        throw new Error("ECONNREFUSED");
      },
    }))), {
      available: false,
      action: "start",
      reason: "No Metro inspector target.",
      metroPort: 8082,
      limitations: [
        "No Hermes Runtime.evaluate trace was collected.",
        "React commits, layout changes, animation frames, and handler-bearing components are unavailable for this read.",
      ],
    });
  });

  it("traceInteraction evaluates the trace expression against the first Hermes target", async () => {
    let websocket = "";
    let expression = "";
    let timeout = 0;

    const payload = unwrapToolJson(await traceInteraction({
      action: "read",
      maxEvents: 9000,
      componentFilter: " Calendar ",
      includeEvents: true,
      metroPort: 8083,
    }, traceDeps({
      evaluateHermesExpression: async (url, expr, options) => {
        websocket = url;
        expression = expr;
        timeout = options.timeoutMs;
        return {
          result: { result: { value: { available: true, returnedEventCount: 2 } } },
          diagnostics: { sent: ["Runtime.evaluate"] },
        };
      },
    })));

    assert.equal(websocket, "ws://target");
    assert.equal(timeout, 8000);
    assert.match(expression, /const action = "read"/);
    assert.match(expression, /const maxEvents = 2000/);
    assert.match(expression, /const includeEvents = true/);
    assert.match(expression, /const componentFilter = "Calendar"/);
    assert.deepEqual(payload, {
      action: "read",
      metroPort: 8083,
      target: {
        title: "Hermes App",
        appId: "com.example.app",
        deviceName: "iPhone 15",
        description: "React Native",
      },
      trace: { available: true, returnedEventCount: 2 },
      protocolError: null,
      cdp: { sent: ["Runtime.evaluate"] },
    });
  });

  it("traceInteraction preserves protocol exceptions and CDP fallback diagnostics", async () => {
    assert.deepEqual(unwrapToolJson(await traceInteraction({
      action: "stop",
    }, traceDeps({
      evaluateHermesExpression: async () => ({
        result: { exceptionDetails: { text: "boom" } },
        cdp: { fallback: true },
      }),
    }))), {
      action: "stop",
      metroPort: 8081,
      target: {
        title: "Hermes App",
        appId: "com.example.app",
        deviceName: "iPhone 15",
        description: "React Native",
      },
      trace: null,
      protocolError: { text: "boom" },
      cdp: { fallback: true },
    });
  });

  it("embeds action, maxEvents, includeEvents, component filter, and tracer global key", () => {
    const expression = interactionTraceExpression({
      action: "start",
      maxEvents: 12,
      componentFilter: "Calendar",
      includeEvents: true,
    });

    assert.match(expression, /const action = "start"/);
    assert.match(expression, /const maxEvents = 12/);
    assert.match(expression, /const includeEvents = true/);
    assert.match(expression, /const componentFilter = "Calendar"/);
    assert.match(expression, /__EXPO_LOCAL_DEV_INTERACTION_TRACE__/);
    assert.match(expression, /React DevTools hook not available/);
  });

  it("returns an unavailable payload for unknown actions", () => {
    assert.deepEqual(runTrace("bogus"), {
      available: false,
      reason: "Unknown trace action: bogus",
    });
  });

  it("starts tracing without a React hook, records warning and traceStarted, and reads compact events", () => {
    const context = makeContext();
    const start = runTrace("start", { maxEvents: 20, componentFilter: "Button" }, context);

    assert.equal(start.available, true);
    assert.equal(start.installed, true);
    assert.equal(start.filter, "Button");
    assert.equal(start.eventCount, 2);
    assert.equal(start.returnedEventCount, 2);
    assert.deepEqual(start.counts, { warning: 1, traceStarted: 1 });
    assert.deepEqual(start.recentEvents.map((event: { type: string }) => event.type), ["warning", "traceStarted"]);
    assert.equal(start.recentEvents[0].message, "React DevTools hook not available; only requestAnimationFrame patch can be installed.");

    const read = runTrace("read", { maxEvents: 1 }, context);
    assert.equal(read.eventCount, 2);
    assert.equal(read.returnedEventCount, 1);
    assert.deepEqual(read.counts, { traceStarted: 1 });
  });

  it("patches requestAnimationFrame, records animation frame events, and restores on stop", () => {
    const callbacks: Array<(ts: number) => void> = [];
    const originalRaf = function original(callback: (ts: number) => void) {
      callbacks.push(callback);
      return 7;
    };
    const context = makeContext({ requestAnimationFrame: originalRaf });

    runTrace("start", { maxEvents: 20 }, context);
    const patched = context.requestAnimationFrame;
    assert.notEqual(patched, originalRaf);
    assert.equal(patched((ts: number) => {
      context.callbackTs = ts;
    }), 7);
    callbacks[0]?.(123.4);

    const read = runTrace("read", { maxEvents: 20 }, context);
    assert.equal(read.counts.requestAnimationFrame, 1);
    assert.equal(read.counts.animationFrame, 1);
    assert.equal(read.recentEvents.at(-1).frameTime, 123.4);
    assert.equal(context.callbackTs, 123.4);

    const stop = runTrace("stop", { maxEvents: 20 }, context);
    assert.equal(stop.installed, false);
    assert.equal(context.requestAnimationFrame, originalRaf);
    assert.equal(stop.counts.traceStopped, 1);
  });

  it("clears prior events and errors, resets lastSnapshot, and records traceCleared", () => {
    const context = makeContext();
    context[TRACE_KEY] = {
      installed: true,
      startedAt: "earlier",
      events: [{ t: 1, type: "old" }],
      lastSnapshot: new Map([["0", "sig"]]),
      originals: {},
      errors: ["bad"],
    };

    const clear = runTrace("clear", { maxEvents: 20, includeEvents: true }, context);

    assert.equal(clear.eventCount, 1);
    assert.deepEqual(clear.counts, { traceCleared: 1 });
    assert.deepEqual(clear.errors, []);
    assert.deepEqual(clear.events.map((event: { type: string }) => event.type), ["traceCleared"]);
    assert.equal(context[TRACE_KEY].lastSnapshot.size, 0);
  });

  it("summarizes React commit trees, active elements, handlers, layout changes, and filters", () => {
    const root = reactRoot(buttonFiber({ width: 100, className: "primary" }));
    const hook = makeHook(root);
    const context = makeContext({ __REACT_DEVTOOLS_GLOBAL_HOOK__: hook });

    const start = runTrace("start", { maxEvents: 20, componentFilter: "save" }, context);

    assert.equal(start.counts.initialTree, 1);
    assert.equal(start.activeElements.length, 1);
    assert.equal(start.activeElements[0].name, "SaveButton");
    assert.deepEqual(start.topDeclaredHandlers, [{ name: "onPress", count: 1 }]);
    assert.deepEqual(start.topComponents, [{ name: "SaveButton", count: 1 }]);
    assert.equal(start.layoutChanges.length, 0);

    root.current.child = buttonFiber({ width: 120, className: "primary" });
    hook.onCommitFiberRoot(1, root);
    const read = runTrace("read", { maxEvents: 20 }, context);

    assert.equal(read.counts.reactCommit, 1);
    assert.equal(read.layoutChanges.length, 1);
    assert.equal(read.layoutChanges[0].name, "SaveButton");
    assert.deepEqual(read.layoutChanges[0].before.style, { width: 100 });
    assert.deepEqual(read.layoutChanges[0].after.style, { width: 120 });
    assert.equal(read.recentEvents.at(-1).changedLayoutCount, 1);
  });

  it("omits raw events unless includeEvents is true and includes them when requested", () => {
    const context = makeContext();
    runTrace("clear", { maxEvents: 20 }, context);
    const withoutEvents = runTrace("read", { maxEvents: 20, includeEvents: false }, context);
    const withEvents = runTrace("read", { maxEvents: 20, includeEvents: true }, context);

    assert.equal(Object.prototype.hasOwnProperty.call(withoutEvents, "events"), false);
    assert.equal(Array.isArray(withEvents.events), true);
  });
});

function traceDeps(overrides: Partial<TraceInteractionDependencies> = {}): TraceInteractionDependencies {
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
      result: { result: { value: { available: true } } },
      diagnostics: { calls: 1 },
    }),
    ...overrides,
  };
}

function runTrace(action: string, options: Record<string, unknown> = {}, context = makeContext()): Record<string, any> {
  return JSON.parse(JSON.stringify(vm.runInContext(interactionTraceExpression({
    action,
    maxEvents: options.maxEvents ?? 300,
    componentFilter: options.componentFilter,
    includeEvents: options.includeEvents,
  }), context)));
}

function makeContext(globals: Record<string, unknown> = {}): Record<string, any> {
  return vm.createContext({
    Date,
    Map,
    Object,
    Array,
    JSON,
    String,
    Number,
    Boolean,
    Math,
    performance: { now: () => 10 },
    ...globals,
  }) as Record<string, any>;
}

function makeHook(root: Record<string, any>): Record<string, any> {
  return {
    renderers: new Map([[1, {}]]),
    getFiberRoots: () => [root],
    onCommitFiberRoot: null,
  };
}

function reactRoot(child: Record<string, any>): Record<string, any> {
  return { current: { child } };
}

function buttonFiber(style: Record<string, unknown>): Record<string, any> {
  return {
    tag: 0,
    type: { displayName: "SaveButton" },
    elementType: null,
    _debugOwner: { tag: 0, type: { displayName: "SettingsScreen" } },
    _debugSource: { fileName: "/app/settings.tsx", lineNumber: 12, columnNumber: 3 },
    memoizedProps: {
      accessibilityLabel: "Save",
      accessibilityRole: "button",
      testID: "save-button",
      className: "save-button",
      style,
      onPress: () => undefined,
      children: ["Save", " changes"],
    },
    child: null,
    sibling: null,
  };
}
