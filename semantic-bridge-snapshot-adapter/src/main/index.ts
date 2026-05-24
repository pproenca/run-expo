export const EXPO_IOS_BRIDGE_VERSION = "1.0.0";

export type SnapshotFilters = {
  interactiveOnly: boolean;
  compact: boolean;
  depth: number | null;
  includeSource: boolean;
  includeBounds: boolean;
};

export type SemanticBridgeSnapshotArgs = {
  metroPort?: unknown;
  [key: string]: unknown;
};

export type SemanticBridgeSnapshotContext = {
  stateRoot?: string;
  session?: unknown;
  filters: SnapshotFilters;
};

export type MetroTarget = Record<string, any> & {
  webSocketDebuggerUrl?: string;
};

export type HermesEvaluationResult = {
  result?: { result?: { value?: unknown } };
  diagnostics?: unknown;
  error?: string | null;
};

export type SemanticBridgeSnapshotDependencies = {
  metroTargets: (metroPort: number) => Promise<MetroTarget[]> | MetroTarget[];
  evaluateHermesExpression: (webSocketDebuggerUrl: string, expression: string, options: { timeoutMs: 5000 }) => Promise<HermesEvaluationResult> | HermesEvaluationResult;
};

export async function semanticBridgeSnapshot(
  args: SemanticBridgeSnapshotArgs,
  { filters }: SemanticBridgeSnapshotContext,
  deps: SemanticBridgeSnapshotDependencies,
): Promise<Record<string, any>> {
  const metroPort = clampNumber(args.metroPort ?? 8081, 1, 65535);
  const targets = await deps.metroTargets(metroPort);
  const target = targets.find((item) => item.webSocketDebuggerUrl) ?? targets[0] ?? null;
  if (!target?.webSocketDebuggerUrl) {
    return {
      available: false,
      source: "plugin-bridge-semantic",
      code: "no-runtime-target",
      reason: "No Metro inspector target.",
      metroPort,
      transport: bridgeRuntimeTransport(metroPort, target, null),
    };
  }

  const result = await deps.evaluateHermesExpression(target.webSocketDebuggerUrl, semanticBridgeExpression({ filters }), { timeoutMs: 5000 });
  const value = result.result?.result?.value;
  if (!isRecord(value)) {
    return {
      available: false,
      source: "plugin-bridge-semantic",
      code: "transport-failure",
      reason: result.error ?? "Semantic bridge did not return a value.",
      metroPort,
      transport: bridgeRuntimeTransport(metroPort, target, result.diagnostics),
    };
  }

  if (value.available === false) {
    return {
      ...redactValue(value) as Record<string, unknown>,
      source: value.source ?? "plugin-bridge-semantic",
      metroPort,
      transport: bridgeRuntimeTransport(metroPort, target, result.diagnostics),
    };
  }

  const rawRefs = value.refs ?? value.elements ?? [];
  const refs = normalizeSemanticBridgeRefs(rawRefs, filters);
  return {
    available: true,
    source: value.source ?? "plugin-bridge-semantic",
    bridgeVersion: value.bridgeVersion ?? null,
    routeHint: value.routeHint ?? null,
    refs,
    rawCount: Array.isArray(rawRefs) ? rawRefs.length : 0,
    metroPort,
    transport: bridgeRuntimeTransport(metroPort, target, result.diagnostics),
    limitations: value.limitations ?? ["Semantic bridge data is app-defined and should be cross-checked with native accessibility or screenshots for visual assertions."],
  };
}

export function bridgeRuntimeTransport(metroPort: number, target: MetroTarget | null, cdp: unknown = null) {
  return {
    name: "metro-inspector-hermes-cdp",
    metroPort,
    protocol: "Runtime.evaluate",
    target: targetSummary(target),
    cdp,
  };
}

export function targetSummary(target: MetroTarget | null | undefined) {
  if (!target) return null;
  return {
    id: target.id ?? null,
    title: target.title ?? null,
    description: target.description ?? null,
    appId: target.appId ?? null,
    deviceName: target.deviceName ?? null,
    devtoolsFrontendUrl: target.devtoolsFrontendUrl ?? null,
    webSocketDebuggerUrl: target.webSocketDebuggerUrl ?? null,
    reactNative: target.reactNative ?? null,
    capabilities: target.capabilities ?? {
      hermesRuntime: typeof target.webSocketDebuggerUrl === "string" && target.webSocketDebuggerUrl.startsWith("ws"),
      devtoolsFrontend: typeof target.devtoolsFrontendUrl === "string" && target.devtoolsFrontendUrl.length > 0,
      reactNative: Boolean(target.reactNative),
    },
  };
}

export function normalizeSemanticBridgeRefs(refs: unknown, filters: SnapshotFilters) {
  if (!Array.isArray(refs)) return [];
  return refs
    .filter(isRecord)
    .map((item) => {
      const role = normalizeAccessibilityRole(item.role ?? item.type ?? null);
      const actions = Array.isArray(item.actions) ? item.actions.map(String) : actionsForAccessibilityRole(role);
      return {
        role,
        label: item.label ?? item.name ?? null,
        text: item.text ?? item.value ?? null,
        placeholder: item.placeholder ?? null,
        testID: item.testID ?? item.testId ?? item.nativeID ?? null,
        nativeID: item.nativeID ?? null,
        component: item.component ?? null,
        source: filters.includeSource ? item.source ?? null : null,
        box: filters.includeBounds ? normalizeFrame(item.box ?? item.frame) : null,
        actions,
        disabled: item.disabled === true,
        raw: redactValue(item.raw ?? item),
      };
    })
    .filter((record) => {
      if (filters.interactiveOnly && record.actions.length === 0) return false;
      if (filters.compact && !record.label && !record.text && record.actions.length === 0) return false;
      return true;
    });
}

export function semanticBridgeExpression({ filters }: { filters: unknown }): string {
  return `(() => {
    const expectedBridgeVersion = ${JSON.stringify(EXPO_IOS_BRIDGE_VERSION)};
    const filters = ${JSON.stringify(filters)};
    const pluginBridge = globalThis.__EXPO_IOS_DEVTOOLS_BRIDGE__ ||
      globalThis.__EXPO_IOS_PLUGIN_BRIDGE__ ||
      globalThis.__ROZENITE_AGENT_BRIDGE__;
    const metadata = pluginBridge?.metadata || pluginBridge?.expoIosDevtoolsBridgeMetadata || pluginBridge?.bridgeMetadata || {};
    const bridgeVersion = metadata.bridgeVersion || pluginBridge?.bridgeVersion || pluginBridge?.version || null;
    const semantic = pluginBridge?.snapshot ||
      pluginBridge?.semantics ||
      (pluginBridge?.domains && !Array.isArray(pluginBridge.domains) ? (pluginBridge.domains.snapshot || pluginBridge.domains.semantics) : null) ||
      (pluginBridge?.domainRegistry ? (pluginBridge.domainRegistry.snapshot || pluginBridge.domainRegistry.semantics) : null);
    const callTool = typeof pluginBridge?.callTool === 'function' ? pluginBridge.callTool.bind(pluginBridge) : null;
    const hasSemantic = Boolean(semantic || callTool || (Array.isArray(pluginBridge?.domains) && pluginBridge.domains.some((domain) => domain?.name === 'snapshot' || domain?.name === 'semantics')));
    if (!hasSemantic) {
      return { available: false, source: 'plugin-bridge-semantic', code: pluginBridge ? 'missing-domain' : 'unavailable-bridge', reason: pluginBridge ? 'Semantic snapshot bridge domain is not registered.' : 'Semantic bridge is not installed.', refs: [] };
    }
    if (bridgeVersion && bridgeVersion !== expectedBridgeVersion) {
      return { available: false, source: 'plugin-bridge-semantic', code: 'version-mismatch', bridgeVersion, expectedBridgeVersion, reason: 'Semantic bridge version is not compatible with this CLI.', refs: [] };
    }
    const captured = semantic && typeof semantic.capture === 'function'
      ? semantic.capture({ filters })
      : semantic?.refs
      ? { refs: semantic.refs }
      : callTool
      ? callTool('snapshot.capture', { filters })
      : { refs: [] };
    return {
      available: true,
      source: 'plugin-bridge-semantic',
      bridgeVersion,
      routeHint: captured?.routeHint || null,
      refs: Array.isArray(captured?.refs) ? captured.refs : Array.isArray(captured) ? captured : [],
      limitations: captured?.limitations || []
    };
  })()`;
}

export function normalizeAccessibilityRole(role: unknown): string | null {
  const text = String(role ?? "").replace(/^AX/, "").toLowerCase();
  if (text === "statictext") return "text";
  if (text === "button") return "button";
  if (text === "textfield" || text === "textbox") return "textbox";
  if (text === "switch") return "switch";
  if (text === "link") return "link";
  return text || null;
}

export function actionsForAccessibilityRole(role: string | null): string[] {
  if (role === "button" || role === "link") return ["tap", "inspect"];
  if (role === "textbox") return ["tap", "fill", "focus", "inspect"];
  if (role === "switch") return ["tap", "inspect"];
  return [];
}

export function normalizeFrame(frame: unknown) {
  if (!isRecord(frame)) return null;
  const x = Number(frame.x ?? frame.left);
  const y = Number(frame.y ?? frame.top);
  const width = Number(frame.width);
  const height = Number(frame.height);
  if (![x, y, width, height].every(Number.isFinite)) return null;
  return { x, y, width, height };
}

export function redactValue(value: unknown, key = ""): unknown {
  if (typeof value === "string") {
    if (isSecretKey(key)) return "[redacted]";
    return value.replace(/([?&](cookie|token|authorization|password|secret)=)[^&]+/gi, "$1[redacted]");
  }
  if (Array.isArray(value)) return value.map((item) => redactValue(item, key));
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([entryKey, entryValue]) => [
      entryKey,
      isSecretKey(entryKey) ? "[redacted]" : redactValue(entryValue, entryKey),
    ]));
  }
  return value;
}

function isSecretKey(key: string): boolean {
  return /(token|authorization|cookie|password|secret|apikey|apiKey)/.test(key);
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function clampNumber(value: unknown, min: number, max: number): number {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new Error(`Expected a finite number, got ${value}.`);
  }
  return Math.min(Math.max(number, min), max);
}
