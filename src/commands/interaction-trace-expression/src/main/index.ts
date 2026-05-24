import {
  realValidation,
  type RealValidation,
} from "../../../../core/real-validation/src/main/index.ts";
import {
  toolJson,
  unwrapToolJson,
  type ToolTextResult,
} from "../../../../core/tool-json-envelope/src/main/index.ts";
import { evaluateHermesExpression as sharedEvaluateHermesExpression } from "../../../../platform/hermes-cdp-client/src/main/index.ts";
import { metroTargets } from "../../../metro-probes/src/main/index.ts";

export interface InteractionTraceExpressionArgs {
  action: unknown;
  maxEvents: unknown;
  componentFilter?: unknown;
  includeEvents?: unknown;
}

export interface TraceInteractionArgs {
  action?: unknown;
  metroPort?: unknown;
  maxEvents?: unknown;
  componentFilter?: unknown;
  includeEvents?: unknown;
}

export interface MetroTargetSummary {
  title?: unknown;
  appId?: unknown;
  deviceName?: unknown;
  description?: unknown;
  webSocketDebuggerUrl?: unknown;
}

export interface TraceInteractionDependencies {
  fetchMetroTargets: (metroPort: number) => Promise<unknown>;
  evaluateHermesExpression: (
    webSocketDebuggerUrl: string,
    expression: string,
    options: { timeoutMs: number },
  ) => Promise<unknown>;
}

export async function traceInteraction(
  args: TraceInteractionArgs = {},
  deps: TraceInteractionDependencies = defaultTraceInteractionDependencies,
): Promise<ToolTextResult> {
  const metroPort = clampNumber(args.metroPort ?? 8081, 1, 65535);
  const action = args.action;
  const maxEvents = clampNumber(args.maxEvents ?? 300, 1, 2000);
  const includeEvents = args.includeEvents === true;
  const componentFilter = requireOptionalString(args.componentFilter);
  const targets = await deps.fetchMetroTargets(metroPort).catch(() => []);
  const targetList = Array.isArray(targets) ? targets : [];
  const webSocketDebuggerUrl = asString(asRecord(targetList[0])?.webSocketDebuggerUrl);

  if (!webSocketDebuggerUrl) {
    return toolJson({
      available: false,
      action,
      reason: "No Metro inspector target.",
      metroPort,
      realValidation: realValidation({
        state: "environment-blocked",
        evidence: [
          { source: "metro", command: `trace.${String(action ?? "read")}`, confidence: "low" },
        ],
        missingEvidence: [
          {
            signal: "metro-hermes-target",
            reason: "No Metro inspector target.",
            recommendedFix:
              "Start Metro, launch the app in a Hermes dev client, and rerun with --metro-port.",
          },
        ],
      }),
      limitations: [
        "No Hermes Runtime.evaluate trace was collected.",
        "React commits, layout changes, animation frames, and handler-bearing components are unavailable for this read.",
      ],
    });
  }

  const expression = interactionTraceExpression({
    action,
    maxEvents,
    componentFilter,
    includeEvents,
  });
  const result = await deps.evaluateHermesExpression(webSocketDebuggerUrl, expression, {
    timeoutMs: 8000,
  });

  const trace = getPath(result, ["result", "result", "value"]) ?? null;
  return toolJson({
    action,
    metroPort,
    target: targetSummary(targetList[0]),
    trace,
    protocolError:
      getPath(result, ["result", "exceptionDetails"]) ?? asRecord(result)?.error ?? null,
    cdp: asRecord(result)?.diagnostics ?? asRecord(result)?.cdp ?? null,
    realValidation: traceRealValidation(trace, action),
  });
}

const defaultTraceInteractionDependencies: TraceInteractionDependencies = {
  fetchMetroTargets: (metroPort) => metroTargets(metroPort),
  evaluateHermesExpression: sharedEvaluateHermesExpression,
};

export { toolJson, unwrapToolJson };

export function interactionTraceExpression({
  action,
  maxEvents,
  componentFilter,
  includeEvents,
}: InteractionTraceExpressionArgs): string {
  return `(() => {
    const action = ${JSON.stringify(action)};
    const maxEvents = ${JSON.stringify(maxEvents)};
    const includeEvents = ${JSON.stringify(Boolean(includeEvents))};
    const componentFilter = ${JSON.stringify(componentFilter ?? "")};
    const filterNeedle = String(componentFilter || '').toLowerCase();
    const now = () => Math.round((typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now()) * 10) / 10;
    const globalKey = '__EXPO_LOCAL_DEV_INTERACTION_TRACE__';
    const tracer = globalThis[globalKey] ||= {
      installed: false,
      startedAt: null,
      events: [],
      lastSnapshot: new Map(),
      originals: {},
      errors: []
    };

    function short(value, max = 160) {
      if (value == null) return null;
      const text = String(value);
      return text.length > max ? text.slice(0, max) + '...' : text;
    }

    function push(type, payload = {}) {
      const event = { t: now(), type, ...payload };
      tracer.events.push(event);
      const hardLimit = Math.max(2000, maxEvents * 3);
      if (tracer.events.length > hardLimit) tracer.events.splice(0, tracer.events.length - hardLimit);
      return event;
    }

    function primitive(value) {
      return value == null || ['string', 'number', 'boolean'].includes(typeof value);
    }

    function typeName(type) {
      if (!type) return null;
      if (typeof type === 'string') return type;
      return type.displayName || type.name || type.render?.displayName || type.render?.name || type.type?.displayName || type.type?.name || null;
    }

    function fiberName(fiber) {
      return typeName(fiber.elementType) || typeName(fiber.type) || fiber._debugName || tagName(fiber.tag);
    }

    function tagName(tag) {
      const names = { 0: 'FunctionComponent', 1: 'ClassComponent', 3: 'HostRoot', 5: 'HostComponent', 6: 'HostText', 7: 'Fragment', 10: 'ContextProvider', 11: 'ForwardRef', 14: 'MemoComponent', 15: 'SimpleMemoComponent' };
      return names[tag] || ('FiberTag' + tag);
    }

    function debugSource(fiber) {
      const source = fiber?._debugSource;
      if (!source) return null;
      return { fileName: source.fileName || null, lineNumber: source.lineNumber || null, columnNumber: source.columnNumber || null };
    }

    function ownerName(fiber) {
      return fiber?._debugOwner ? fiberName(fiber._debugOwner) : null;
    }

    function flattenText(value, out = []) {
      if (out.join(' ').length > 220) return out;
      if (typeof value === 'string' || typeof value === 'number') {
        const text = String(value).trim();
        if (text) out.push(short(text, 100));
      } else if (Array.isArray(value)) {
        for (const item of value.slice(0, 16)) flattenText(item, out);
      }
      return out;
    }

    const layoutKeys = [
      'display','position','top','right','bottom','left','width','height','minWidth','minHeight','maxWidth','maxHeight',
      'flex','flexGrow','flexShrink','flexBasis','flexDirection','alignItems','alignSelf','justifyContent',
      'gap','rowGap','columnGap','margin','marginTop','marginRight','marginBottom','marginLeft',
      'padding','paddingTop','paddingRight','paddingBottom','paddingLeft','textAlign','overflow',
      'transform','opacity'
    ];
    const classKeys = ['className', 'contentContainerClassName'];
    const styleKeys = ['style', 'contentContainerStyle', 'containerStyle', 'indicatorStyle'];
    const handlerKeys = [
      'onScroll','onScrollBeginDrag','onScrollEndDrag','onMomentumScrollBegin','onMomentumScrollEnd',
      'onTouchStart','onTouchMove','onTouchEnd','onResponderGrant','onResponderMove','onResponderRelease',
      'onStartShouldSetResponder','onMoveShouldSetResponder','onGestureEvent','onHandlerStateChange',
      'onPress','onPressIn','onPressOut','onLongPress'
    ];

    function summarizeStyle(style, depth = 0) {
      if (!style || depth > 4) return null;
      if (typeof style === 'number') return { stylesheetId: style };
      if (Array.isArray(style)) {
        const merged = {};
        for (const item of style.slice(0, 12)) {
          const part = summarizeStyle(item, depth + 1);
          if (part && typeof part === 'object' && !Array.isArray(part)) Object.assign(merged, part);
        }
        return Object.keys(merged).length ? merged : null;
      }
      if (typeof style !== 'object') return null;
      const summary = {};
      for (const key of layoutKeys) {
        if (primitive(style[key])) summary[key] = style[key];
        else if (key === 'transform' && Array.isArray(style[key])) {
          try { summary[key] = JSON.parse(JSON.stringify(style[key].slice(0, 8))); } catch {}
        }
      }
      return Object.keys(summary).length ? summary : null;
    }

    function summarizeProps(props) {
      if (!props || typeof props !== 'object') return {};
      const summary = {};
      for (const key of ['accessibilityLabel','accessibilityRole','testID','nativeID','pointerEvents']) {
        if (primitive(props[key])) summary[key] = short(props[key], 140);
      }
      const text = flattenText(props.children).join(' ');
      if (text) summary.text = short(text, 180);
      for (const key of classKeys) {
        if (typeof props[key] === 'string' && props[key].trim()) summary[key] = short(props[key], 240);
      }
      for (const key of styleKeys) {
        const style = summarizeStyle(props[key]);
        if (style) summary[key] = style;
      }
      const handlers = handlerKeys.filter((key) => typeof props[key] === 'function');
      if (handlers.length) summary.handlers = handlers;
      return summary;
    }

    function matches(info) {
      if (!filterNeedle) return true;
      return [info.name, info.owner, info.label, info.testID, info.text, info.className, info.contentContainerClassName, info.source?.fileName]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(filterNeedle));
    }

    function walk(root) {
      const nodes = [];
      let truncated = false;
      function visit(fiber, depth, parentId, path) {
        if (!fiber || nodes.length >= 1800) {
          if (fiber) truncated = true;
          return;
        }
        const props = summarizeProps(fiber.memoizedProps);
        const label = props.accessibilityLabel || props.text || null;
        const info = {
          id: nodes.length + 1,
          parentId,
          depth,
          path,
          name: fiberName(fiber),
          owner: ownerName(fiber),
          label,
          text: props.text || null,
          testID: props.testID || null,
          role: props.accessibilityRole || null,
          className: props.className || null,
          contentContainerClassName: props.contentContainerClassName || null,
          source: debugSource(fiber),
          layout: {
            className: props.className || null,
            contentContainerClassName: props.contentContainerClassName || null,
            style: props.style || null,
            contentContainerStyle: props.contentContainerStyle || null,
            containerStyle: props.containerStyle || null,
            indicatorStyle: props.indicatorStyle || null,
            pointerEvents: props.pointerEvents || null
          },
          handlers: props.handlers || []
        };
        nodes.push(info);
        let child = fiber.child;
        let index = 0;
        while (child) {
          visit(child, depth + 1, info.id, path + '.' + index);
          child = child.sibling;
          index += 1;
        }
      }
      visit(root?.current?.child, 0, null, '0');
      return { nodes, truncated };
    }

    function layoutSignature(info) {
      return JSON.stringify(info.layout || {});
    }

    function handleCommit(root, reason = 'reactCommit') {
      const result = walk(root);
      const changed = [];
      const active = [];
      for (const info of result.nodes) {
        const sig = layoutSignature(info);
        const prev = tracer.lastSnapshot.get(info.path);
        if (matches(info) && (info.handlers.length || info.label || info.testID || /Animated|Scroll|Gesture|Pressable|Calendar|Draft|Event|Glass|Tab|Screen|Route/.test(info.name))) {
          active.push({
            id: info.id,
            parentId: info.parentId,
            depth: info.depth,
            name: info.name,
            owner: info.owner,
            label: info.label,
            role: info.role,
            testID: info.testID,
            handlers: info.handlers,
            layout: info.layout
          });
        }
        if (matches(info) && prev && prev !== sig) {
          changed.push({
            id: info.id,
            parentId: info.parentId,
            depth: info.depth,
            name: info.name,
            owner: info.owner,
            label: info.label,
            role: info.role,
            testID: info.testID,
            before: safeParse(prev),
            after: info.layout
          });
        }
        tracer.lastSnapshot.set(info.path, sig);
      }
      push(reason, {
        nodeCount: result.nodes.length,
        truncated: result.truncated,
        changedLayout: changed.slice(0, 40),
        activeElements: active.slice(0, 24)
      });
    }

    function safeParse(text) {
      try { return JSON.parse(text); } catch { return text; }
    }

    function compactLayout(layout) {
      if (!layout || typeof layout !== 'object') return null;
      return {
        className: layout.className || null,
        contentContainerClassName: layout.contentContainerClassName || null,
        style: layout.style || null,
        contentContainerStyle: layout.contentContainerStyle || null,
        containerStyle: layout.containerStyle || null,
        indicatorStyle: layout.indicatorStyle || null,
        pointerEvents: layout.pointerEvents || null
      };
    }

    function compactElement(info) {
      if (!info || typeof info !== 'object') return null;
      return {
        id: info.id ?? null,
        parentId: info.parentId ?? null,
        depth: info.depth ?? null,
        name: info.name || null,
        owner: info.owner || null,
        label: info.label || null,
        role: info.role || null,
        testID: info.testID || null,
        handlers: Array.isArray(info.handlers) ? info.handlers.slice(0, 16) : [],
        layout: compactLayout(info.layout)
      };
    }

    function compactChange(change) {
      if (!change || typeof change !== 'object') return null;
      return {
        id: change.id ?? null,
        parentId: change.parentId ?? null,
        depth: change.depth ?? null,
        name: change.name || null,
        owner: change.owner || null,
        label: change.label || null,
        role: change.role || null,
        testID: change.testID || null,
        before: compactLayout(change.before),
        after: compactLayout(change.after)
      };
    }

    function compactEvent(event) {
      const out = {
        t: event.t,
        type: event.type
      };
      if (event.filter != null) out.filter = event.filter;
      if (event.message) out.message = event.message;
      if (event.nodeCount != null) out.nodeCount = event.nodeCount;
      if (event.truncated != null) out.truncated = event.truncated;
      if (event.frameTime != null) out.frameTime = event.frameTime;
      if (event.changedLayout?.length) {
        out.changedLayoutCount = event.changedLayout.length;
        out.changedComponents = event.changedLayout.slice(0, 8).map((item) => ({
          name: item?.name || null,
          owner: item?.owner || null,
          label: item?.label || null,
          testID: item?.testID || null
        }));
      }
      if (event.activeElements?.length) {
        out.activeElementCount = event.activeElements.length;
        out.activeComponents = event.activeElements.slice(0, 8).map((item) => ({
          name: item?.name || null,
          owner: item?.owner || null,
          label: item?.label || null,
          testID: item?.testID || null,
          handlers: Array.isArray(item?.handlers) ? item.handlers.slice(0, 8) : []
        }));
      }
      return out;
    }

    function install() {
      tracer.filter = componentFilter || null;
      if (tracer.installed) {
        push('traceAlreadyInstalled', { filter: tracer.filter });
        return;
      }
      tracer.installed = true;
      tracer.startedAt = new Date().toISOString();
      const hook = globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__;
      if (hook && typeof hook.getFiberRoots === 'function') {
        tracer.originals.onCommitFiberRoot = hook.onCommitFiberRoot;
        hook.onCommitFiberRoot = function tracedCommit(...args) {
          try { handleCommit(args[1]); } catch (error) { tracer.errors.push(short(error?.message || error, 220)); }
          if (typeof tracer.originals.onCommitFiberRoot === 'function') return tracer.originals.onCommitFiberRoot.apply(this, args);
        };
        for (const rendererId of Array.from(hook.renderers?.keys?.() || [])) {
          for (const root of Array.from(hook.getFiberRoots(rendererId) || [])) {
            try { handleCommit(root, 'initialTree'); } catch (error) { tracer.errors.push(short(error?.message || error, 220)); }
          }
        }
      } else {
        push('warning', { message: 'React DevTools hook not available; only requestAnimationFrame patch can be installed.' });
      }
      if (typeof globalThis.requestAnimationFrame === 'function' && !tracer.originals.requestAnimationFrame) {
        tracer.originals.requestAnimationFrame = globalThis.requestAnimationFrame;
        globalThis.requestAnimationFrame = function tracedRaf(callback) {
          push('requestAnimationFrame', {});
          return tracer.originals.requestAnimationFrame.call(this, function tracedRafCallback(ts) {
            push('animationFrame', { frameTime: ts });
            return callback(ts);
          });
        };
      }
      push('traceStarted', { filter: tracer.filter });
    }

    function read() {
      const events = tracer.events.slice(-maxEvents);
      const counts = {};
      const handlers = {};
      const components = {};
      const layoutChanges = [];
      const activeElements = new Map();
      for (const event of events) {
        counts[event.type] = (counts[event.type] || 0) + 1;
        if (event.handler) handlers[event.handler] = (handlers[event.handler] || 0) + 1;
        if (event.component) components[event.component] = (components[event.component] || 0) + 1;
        if (event.changedLayout?.length) {
          layoutChanges.push(...event.changedLayout);
          for (const item of event.changedLayout) {
            if (item?.name) components[item.name] = (components[item.name] || 0) + 1;
          }
        }
        if (event.activeElements?.length) {
          for (const item of event.activeElements) {
            if (item?.name) components[item.name] = (components[item.name] || 0) + 1;
            for (const handler of item?.handlers || []) handlers[handler] = (handlers[handler] || 0) + 1;
            const key = [item?.name, item?.owner, item?.label, item?.testID, item?.depth].filter(Boolean).join('|');
            if (key) activeElements.set(key, compactElement(item));
          }
        }
      }
      const top = (object) => Object.entries(object).sort((a, b) => b[1] - a[1]).slice(0, 20).map(([name, count]) => ({ name, count }));
      const compactEvents = events.map(compactEvent);
      const perfBridge = globalThis.__EXPO98_PERF_BRIDGE__ ||
      globalThis.__EXPO_IOS_PERF_BRIDGE__ ||
        (globalThis.__EXPO98_INSTRUMENTATION__?.performance || globalThis.__EXPO_IOS_INSTRUMENTATION__?.performance);
      const renderPayload = (() => {
        try { return perfBridge?.renders?.read ? perfBridge.renders.read() : null; } catch { return null; }
      })();
      const commits = Array.isArray(renderPayload?.renders?.commits) ? renderPayload.renders.commits : Array.isArray(renderPayload?.commits) ? renderPayload.commits : [];
      const frameEvents = events.filter((event) => event.type === 'animationFrame' && event.frameTime != null);
      const frameDeltas = [];
      for (let index = 1; index < frameEvents.length; index += 1) {
        frameDeltas.push(Math.round((Number(frameEvents[index].frameTime) - Number(frameEvents[index - 1].frameTime)) * 10) / 10);
      }
      const response = {
        available: true,
        installed: tracer.installed,
        startedAt: tracer.startedAt,
        filter: tracer.filter || null,
        eventCount: tracer.events.length,
        returnedEventCount: events.length,
        counts,
        topDeclaredHandlers: top(handlers),
        topComponents: top(components),
        activeElements: Array.from(activeElements.values()).slice(-30),
        layoutChanges: layoutChanges.slice(-40).map(compactChange).filter(Boolean),
        renderSummary: {
          commitCount: commits.length,
          worstCommitMs: commits.reduce((max, commit) => Math.max(max, Number(commit.durationMs ?? commit.actualDuration) || 0), 0),
          commits: commits.slice(-40)
        },
        frameSummary: {
          sampleCount: frameDeltas.length,
          worstFrameMs: frameDeltas.length ? Math.max(...frameDeltas) : null,
          droppedFrameCount: frameDeltas.filter((delta) => delta > 33.4).length,
          longFrameCount: frameDeltas.filter((delta) => delta > 16.7).length
        },
        recentEvents: compactEvents.slice(-20),
        errors: tracer.errors.slice(-20),
        interpretationHints: [
          'Scroll or drag bugs usually show reactCommit/layout changes and handler-bearing components such as onScroll/onResponderMove/onGestureEvent near the affected subtree.',
          'This tracer does not wrap app event handlers; topDeclaredHandlers reports handler props present in the committed tree, not handler invocations.',
          'If requestAnimationFrame/animationFrame is active but no React commits occur, the animation may be native-driver/Reanimated/UI-thread and needs screenshot/video or native instrumentation.',
          'changedLayout is declared prop/class/style churn, not final Yoga frame movement.'
        ]
      };
      if (includeEvents) response.events = events;
      return response;
    }

    function stop() {
      const hook = globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__;
      if (hook && tracer.originals && Object.prototype.hasOwnProperty.call(tracer.originals, 'onCommitFiberRoot')) {
        hook.onCommitFiberRoot = tracer.originals.onCommitFiberRoot;
      }
      if (tracer.originals?.requestAnimationFrame) {
        globalThis.requestAnimationFrame = tracer.originals.requestAnimationFrame;
      }
      tracer.installed = false;
      push('traceStopped', {});
      return read();
    }

    if (action === 'start') {
      tracer.events = [];
      tracer.errors = [];
      tracer.lastSnapshot = new Map();
      install();
      return read();
    }
    if (action === 'read') return read();
    if (action === 'clear') {
      tracer.events = [];
      tracer.errors = [];
      tracer.lastSnapshot = new Map();
      push('traceCleared', {});
      return read();
    }
    if (action === 'stop') return stop();
    return { available: false, reason: 'Unknown trace action: ' + action };
  })()`;
}

export function targetSummary(target: unknown): Record<string, unknown> | null {
  const record = asRecord(target);
  if (!record) return null;
  return {
    title: record.title,
    appId: record.appId,
    deviceName: record.deviceName,
    description: record.description,
  };
}

export function traceRealValidation(trace: unknown, action: unknown): RealValidation {
  const record = asRecord(trace);
  if (!record || record.available === false) {
    return realValidation({
      state: "unvalidated",
      evidence: [
        { source: "trace", command: `trace.${String(action ?? "read")}`, confidence: "low" },
      ],
      missingEvidence: [
        {
          signal: "trace-runtime",
          reason: "No Hermes trace payload was returned.",
          recommendedFix:
            "Start Metro, launch a Hermes target, and run trace --action start before reading.",
        },
      ],
    });
  }
  const hasCommits = Number(asRecord(record.renderSummary)?.commitCount ?? 0) > 0;
  const hasFrames = Number(asRecord(record.frameSummary)?.sampleCount ?? 0) > 0;
  const hasEvents = Number(record.eventCount ?? 0) > 0;
  return realValidation({
    state: hasEvents && (hasCommits || hasFrames) ? "validated" : "partial",
    claimsAllowed: {
      renderCost: hasCommits,
      frameJank: hasFrames,
    },
    evidence: [
      {
        source: "hermes-runtime-trace",
        command: `trace.${String(action ?? "read")}`,
        confidence: hasEvents ? "medium" : "low",
      },
    ],
    missingEvidence: [
      ...(!hasCommits
        ? [
            {
              signal: "react-profiler-commits",
              reason: "Trace did not include React Profiler commit durations.",
              recommendedFix:
                "Mount the dev-only Profiler bridge or run rn renders with commit recording.",
            },
          ]
        : []),
      ...(!hasFrames
        ? [
            {
              signal: "frame-deltas",
              reason: "Trace did not observe enough animation frames to compute frame deltas.",
              recommendedFix:
                "Start trace before an animated interaction and rerun trace read/stop.",
            },
          ]
        : []),
    ],
  });
}

export function requireOptionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function clampNumber(value: unknown, min: number, max: number): number {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) {
    throw new Error(`Expected a finite number, got ${value}.`);
  }
  return Math.min(Math.max(numberValue, min), max);
}

function getPath(value: unknown, path: string[]): unknown {
  let current = value;
  for (const key of path) {
    current = asRecord(current)?.[key];
  }
  return current;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function asRecord(value: unknown): Record<string, any> | null {
  return value && typeof value === "object" ? (value as Record<string, any>) : null;
}
