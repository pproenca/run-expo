import { promises as fs } from "node:fs";
import path from "node:path";

import { evaluateHermesExpression as sharedEvaluateHermesExpression } from "../../../../platform/hermes-cdp-client/src/main/index.ts";
import { CURRENT_CLI_NAME } from "../../../../core/cli-identity/src/main/index.ts";
import { realValidation } from "../../../../core/real-validation/src/main/index.ts";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export interface ToolTextResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

export interface NetworkCommandArgs {
  action?: unknown;
  harAction?: unknown;
  metroPort?: unknown;
  limit?: unknown;
  requestId?: unknown;
  outputPath?: string;
  stateDir?: string;
  _?: string[];
}

export interface NetworkTarget {
  id?: string | null;
  title?: string | null;
  description?: string | null;
  appId?: string | null;
  deviceName?: string | null;
  devtoolsFrontendUrl?: string | null;
  webSocketDebuggerUrl?: string | null;
  reactNative?: Record<string, unknown> | null;
  capabilities?: Record<string, unknown>;
}

export interface NetworkTargetSummary {
  id: string | null;
  title: string | null;
  description: string | null;
  appId: string | null;
  deviceName: string | null;
  devtoolsFrontendUrl: string | null;
  webSocketDebuggerUrl: string | null;
  reactNative: Record<string, unknown> | null;
  capabilities: {
    hermesRuntime: boolean;
    devtoolsFrontend: boolean;
    reactNative: boolean;
  } | Record<string, unknown>;
}

export interface NetworkTransport {
  name: "metro-inspector-hermes-cdp";
  metroPort: number;
  protocol: "Runtime.evaluate";
  target: NetworkTargetSummary | null;
  cdp: unknown;
}

export interface NetworkRequestMessage {
  method?: string;
  url?: string;
  headers?: Record<string, unknown>;
  cookies?: unknown;
  body?: unknown;
  postData?: unknown;
  content?: { text?: unknown; [key: string]: unknown };
  status?: number;
  statusText?: string;
  mimeType?: string;
  [key: string]: unknown;
}

export interface NetworkRequest {
  id?: string;
  method?: string;
  url?: string;
  startedAt?: string;
  durationMs?: number;
  status?: number;
  headers?: Record<string, unknown>;
  request?: NetworkRequestMessage;
  response?: NetworkRequestMessage;
  [key: string]: unknown;
}

export interface NetworkEvidencePayload {
  available?: boolean;
  action?: string;
  source?: string;
  evidenceSource?: string;
  domain?: string;
  bridgeVersion?: string | null;
  code?: string;
  reason?: string;
  metroPort?: number;
  requestId?: unknown;
  requests?: NetworkRequest[];
  request?: NetworkRequest;
  target?: NetworkTargetSummary | null;
  transport?: NetworkTransport | null;
  limitations?: string[];
  captureTiming?: NetworkCaptureTiming;
  artifact?: string;
  har?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface NetworkCaptureTiming {
  startedAt: string | null;
  stoppedAt: string;
  observedRequestCount: number;
}

export interface HermesEvaluationResult {
  result?: { result?: { value?: unknown } };
  error?: string;
  diagnostics?: unknown;
}

export interface NetworkCommandDependencies {
  metroTargets?: (metroPort: number) => Promise<NetworkTarget[]>;
  evaluateHermesExpression?: (
    webSocketDebuggerUrl: string,
    expression: string,
    options: { timeoutMs: number },
  ) => Promise<HermesEvaluationResult | null | undefined>;
  fileSystem?: {
    mkdir(path: string, options: { recursive: true }): Promise<void>;
    writeJsonFile(path: string, value: unknown): Promise<void>;
  };
  clock?: {
    now(): Date;
  };
  path?: {
    resolve(path: string): string;
    join(...segments: string[]): string;
    dirname(path: string): string;
  };
  resolveExpoStateRoot?: (args: NetworkCommandArgs) => string;
}

const CLI_NAME = CURRENT_CLI_NAME;
const CLI_VERSION = "0.1.0";
const EXPO_IOS_BRIDGE_VERSION = "1.0.0";
const REDACTED = "[redacted]";
const UNAVAILABLE_LIMITATIONS = [
  "Network evidence requires dev-only app instrumentation that patches fetch/XHR or an equivalent app network adapter.",
  "Native networking stacks are unavailable unless the app exposes them through the bridge.",
];

export function clampNumber(value: unknown, min: number, max: number): number {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`Expected a finite number, got ${String(value)}.`);
  return Math.min(Math.max(number, min), max);
}

export async function networkCommand(
  args: NetworkCommandArgs = {},
  deps: NetworkCommandDependencies = defaultNetworkDependencies,
): Promise<ToolTextResult> {
  const action = requireString(args.action ?? "status", "action");
  if (!["status", "requests", "request", "clear", "har", "waterfall"].includes(action)) {
    throw new Error(`Unknown network action: ${action}`);
  }
  const harAction = action === "har" ? requireString(args.harAction ?? "start", "harAction") : null;
  const bridgeAction = action === "har" ? `har-${harAction}` : action;
  if (harAction && !["start", "stop"].includes(harAction)) {
    throw new Error(`Unknown network HAR action: ${harAction}`);
  }

  const metroPort = clampNumber(args.metroPort ?? 8081, 1, 65535);
  const limit = clampNumber(args.limit ?? 100, 1, 1000);
  const targets = await deps.metroTargets(metroPort);
  const target = targets.find((item) => item.webSocketDebuggerUrl) ?? targets[0] ?? null;
  const webSocketDebuggerUrl = target?.webSocketDebuggerUrl ?? null;
  if (!webSocketDebuggerUrl) {
    return toolJson(networkUnavailable({
      action: bridgeAction,
      metroPort,
      code: "no-runtime-target",
      reason: "No Metro inspector target.",
    }));
  }
  if (!deps.evaluateHermesExpression) {
    return toolJson(networkUnavailable({
      action: bridgeAction,
      metroPort,
      code: "transport-failure",
      reason: "No Hermes evaluator is configured.",
      target: targetSummary(target),
    }));
  }

  const result = await deps.evaluateHermesExpression(
    webSocketDebuggerUrl,
    networkExpression({ action: bridgeAction, requestId: args.requestId, limit }),
    { timeoutMs: 5000 },
  );
  const value = result?.result?.result?.value;
  if (!value) {
    return toolJson(networkUnavailable({
      action: bridgeAction,
      metroPort,
      code: "transport-failure",
      reason: result?.error ?? "Network bridge did not return a value.",
      target: targetSummary(target),
      transport: networkTransport(metroPort, target, result?.diagnostics),
    }));
  }

  const transport = networkTransport(metroPort, target, result.diagnostics);
  const redacted = normalizeNetworkEvidence(redactNetworkEvidence(value), bridgeAction);
  const clock = deps.clock ?? systemClock;

  if (bridgeAction === "har-stop" && redacted.available !== false) {
    const paths = deps.path ?? defaultPath;
    const stateRoot = (deps.resolveExpoStateRoot ?? defaultResolveExpoStateRoot)(args);
    const timestamp = clock.now().toISOString().replace(/[:.]/g, "-");
    const outputPath = paths.resolve(args.outputPath ?? paths.join(stateRoot, "artifacts", `network-${timestamp}.har`));
    const captureTiming = networkCaptureTiming(redacted, clock);
    const har = annotateHar(redacted.har ?? harFromNetworkRequests(redacted.requests ?? [], clock), {
      source: redacted.source ?? "unknown",
      transport,
      limitations: networkLimitations(redacted),
      captureTiming,
    });
    const fileSystem = deps.fileSystem ?? defaultFileSystem;
    await fileSystem.mkdir(paths.dirname(outputPath), { recursive: true });
    await fileSystem.writeJsonFile(outputPath, har);
    return toolJson({
      ...redacted,
      action: bridgeAction,
      metroPort,
      target: targetSummary(target),
      transport,
      evidenceSource: redacted.source ?? "unknown",
      limitations: networkLimitations(redacted),
      captureTiming,
      artifact: outputPath,
      har,
    });
  }

  const payload = {
    ...redacted,
    action: bridgeAction,
    metroPort,
    target: targetSummary(target),
    transport,
    evidenceSource: redacted.source ?? "unknown",
    limitations: networkLimitations(redacted),
    captureTiming: networkCaptureTiming(redacted, clock),
  };
  return toolJson(action === "waterfall" ? networkWaterfallPayload(payload) : payload);
}

const defaultNetworkDependencies: NetworkCommandDependencies = {
  metroTargets: defaultMetroTargets,
  evaluateHermesExpression: sharedEvaluateHermesExpression,
};

async function defaultMetroTargets(metroPort: number): Promise<NetworkTarget[]> {
  try {
    const response = await fetch(`http://localhost:${metroPort}/json/list`);
    if (!response.ok) return [];
    const parsed = await response.json() as unknown;
    return Array.isArray(parsed) ? parsed.map((target) => target as NetworkTarget) : [];
  } catch {
    return [];
  }
}

export function networkUnavailable(input: {
  action: string;
  metroPort: number;
  reason: string;
  target?: NetworkTargetSummary | null;
  code?: string;
  source?: string | null;
  transport?: NetworkTransport | null;
}): NetworkEvidencePayload {
  const code = input.code ?? "unavailable";
  const evidenceSource = input.source ?? (code === "no-runtime-target" ? "runtime-target" : "app-instrumentation");
  return {
    available: false,
    action: input.action,
    source: evidenceSource,
    evidenceSource: "unavailable",
    code,
    reason: input.reason,
    metroPort: input.metroPort,
    target: input.target ?? null,
    transport: input.transport ?? {
      name: "metro-inspector-hermes-cdp",
      metroPort: input.metroPort,
      protocol: "Runtime.evaluate",
      target: input.target ?? null,
      cdp: null,
    },
    requests: [],
    limitations: UNAVAILABLE_LIMITATIONS,
    realValidation: realValidation({
      state: code === "no-runtime-target" ? "environment-blocked" : "unvalidated",
      evidence: [{ source: evidenceSource, command: `network.${input.action}`, confidence: "low" }],
      missingEvidence: [{
        signal: code === "no-runtime-target" ? "metro-hermes-target" : "network-bridge",
        reason: input.reason,
        recommendedFix: code === "no-runtime-target"
          ? "Start Metro, launch the app in a Hermes dev client, and rerun with --metro-port."
          : "Install or mount the dev-only network bridge, then rerun network requests.",
      }],
    }),
  };
}

export function networkExpression(input: { action: string; requestId?: unknown; limit: number }): string {
  const { action, requestId, limit } = input;
  return `(() => {
    const action = ${JSON.stringify(action)};
    const requestId = ${JSON.stringify(requestId ?? null)};
    const limit = ${Number(limit)};
    const expectedBridgeVersion = ${JSON.stringify(EXPO_IOS_BRIDGE_VERSION)};
    const pluginBridge = globalThis.__EXPO_IOS_DEVTOOLS_BRIDGE__ ||
      globalThis.__EXPO_IOS_PLUGIN_BRIDGE__ ||
      globalThis.__ROZENITE_AGENT_BRIDGE__;
    const pluginMetadata = pluginBridge?.metadata || pluginBridge?.expoIosDevtoolsBridgeMetadata || pluginBridge?.bridgeMetadata || {};
    const pluginVersion = pluginMetadata.bridgeVersion || pluginBridge?.bridgeVersion || pluginBridge?.version || null;
    const pluginNetwork = pluginBridge?.network ||
      (pluginBridge?.domains && !Array.isArray(pluginBridge.domains) ? pluginBridge.domains.network : null) ||
      (pluginBridge?.domainRegistry ? pluginBridge.domainRegistry.network : null);
    const pluginCallTool = typeof pluginBridge?.callTool === 'function' ? pluginBridge.callTool.bind(pluginBridge) : null;
    const callNetwork = (name, payload = {}) => {
      if (pluginNetwork && typeof pluginNetwork[name] === 'function') return pluginNetwork[name](payload);
      if (pluginNetwork && pluginNetwork.actions && typeof pluginNetwork.actions[name] === 'function') return pluginNetwork.actions[name](payload);
      if (pluginCallTool) return pluginBridge.callTool('network.' + name, payload);
      return null;
    };
    const hasPluginNetwork = Boolean(pluginNetwork || pluginCallTool || (Array.isArray(pluginBridge?.domains) && pluginBridge.domains.some((domain) => domain?.name === 'network')));
    if (hasPluginNetwork) {
      if (pluginVersion && pluginVersion !== expectedBridgeVersion) {
        return { available: false, action, source: 'plugin-bridge', code: 'version-mismatch', bridgeVersion: pluginVersion, expectedBridgeVersion, reason: 'Network plugin bridge version is not compatible with this CLI.', requests: [] };
      }
      const list = () => {
        const raw = pluginNetwork && typeof pluginNetwork.requests === 'function'
          ? pluginNetwork.requests({ limit })
          : pluginNetwork?.requests || callNetwork('requests', { limit }) || [];
        return Array.isArray(raw) ? raw.slice(-limit) : raw;
      };
      if (action === 'status') return { available: true, action, source: 'plugin-bridge', domain: 'network', bridgeVersion: pluginVersion, hooks: pluginNetwork?.hooks || callNetwork('status') || { fetch: true, xhr: true } };
      if (action === 'requests' || action === 'waterfall') return { available: true, action, source: 'plugin-bridge', domain: 'network', bridgeVersion: pluginVersion, requests: list() };
      if (action === 'request') {
        const requests = list();
        if (!Array.isArray(requests)) return { available: false, action, source: 'plugin-bridge', code: 'malformed-payload', reason: 'Network plugin bridge returned a malformed request list.', requests: [] };
        const found = requests.find((request) => request && request.id === requestId) || null;
        return found
          ? { available: true, action, source: 'plugin-bridge', domain: 'network', bridgeVersion: pluginVersion, request: found }
          : { available: false, action, source: 'plugin-bridge', code: 'no-observed-traffic', reason: 'Request not found.', requestId, requests: [] };
      }
      if (action === 'clear') return { available: true, action, source: 'plugin-bridge', domain: 'network', bridgeVersion: pluginVersion, cleared: callNetwork('clear') ?? true };
      if (action === 'har-start') return { available: true, action, source: 'plugin-bridge', domain: 'network', bridgeVersion: pluginVersion, started: callNetwork('har-start') ?? true, startedAt: new Date().toISOString() };
      if (action === 'har-stop') {
        const har = callNetwork('har-stop');
        return { available: true, action, source: 'plugin-bridge', domain: 'network', bridgeVersion: pluginVersion, har: har?.log ? har : null, requests: list(), stoppedAt: new Date().toISOString() };
      }
    }
    const devtoolsNetwork = globalThis.__REACT_NATIVE_DEVTOOLS_NETWORK__ ||
      globalThis.__RN_DEVTOOLS_NETWORK__ ||
      globalThis.__REACT_DEVTOOLS_NETWORK__;
    if (devtoolsNetwork && typeof devtoolsNetwork === 'object') {
      const list = () => {
        const raw = typeof devtoolsNetwork.requests === 'function' ? devtoolsNetwork.requests({ limit }) : devtoolsNetwork.requests || [];
        return Array.isArray(raw) ? raw.slice(-limit) : raw;
      };
      if (action === 'status') return { available: true, action, source: 'react-native-devtools-network', hooks: devtoolsNetwork.hooks || { fetch: true, xhr: true } };
      if (action === 'requests' || action === 'waterfall') return { available: true, action, source: 'react-native-devtools-network', requests: list() };
      if (action === 'request') {
        const found = list().find((request) => request && request.id === requestId) || null;
        return found
          ? { available: true, action, source: 'react-native-devtools-network', request: found }
          : { available: false, action, source: 'react-native-devtools-network', code: 'no-observed-traffic', reason: 'Request not found.', requestId, requests: [] };
      }
      if (action === 'har-start') return { available: true, action, source: 'react-native-devtools-network', started: true, startedAt: new Date().toISOString() };
      if (action === 'har-stop') return { available: true, action, source: 'react-native-devtools-network', requests: list(), stoppedAt: new Date().toISOString() };
    }
    const bridge = globalThis.__EXPO_IOS_NETWORK_BRIDGE__ ||
      (globalThis.__EXPO_IOS_INSTRUMENTATION__ && globalThis.__EXPO_IOS_INSTRUMENTATION__.network);
    if (!bridge) {
      return {
        available: false,
        action,
        source: 'app-instrumentation',
        code: 'no-bridge-domain',
        reason: 'Network bridge is not installed.',
        requests: []
      };
    }
    const list = () => {
      const raw = typeof bridge.requests === 'function' ? bridge.requests({ limit }) : bridge.requests || [];
      return Array.isArray(raw) ? raw.slice(-limit) : [];
    };
    if (action === 'status') {
      return {
        available: true,
        action,
        source: 'app-instrumentation',
        hooks: typeof bridge.status === 'function' ? bridge.status() : (bridge.hooks || { fetch: true, xhr: true })
      };
    }
    if (action === 'requests' || action === 'waterfall') {
      return { available: true, action, source: 'app-instrumentation', requests: list() };
    }
    if (action === 'request') {
      const found = list().find((request) => request && request.id === requestId) || null;
      return found
        ? { available: true, action, source: 'app-instrumentation', request: found }
        : { available: false, action, source: 'app-instrumentation', reason: 'Request not found.', requestId };
    }
    if (action === 'clear') {
      if (typeof bridge.clear === 'function') bridge.clear();
      return { available: true, action, source: 'app-instrumentation', cleared: true };
    }
    if (action === 'har-start') {
      if (typeof bridge.harStart === 'function') return { available: true, action, source: 'app-instrumentation', har: bridge.harStart() };
      return { available: true, action, source: 'app-instrumentation', started: true };
    }
    if (action === 'har-stop') {
      if (typeof bridge.harStop === 'function') return { available: true, action, source: 'app-instrumentation', har: bridge.harStop(), requests: list() };
      return { available: true, action, source: 'app-instrumentation', requests: list() };
    }
    return { available: false, action, source: 'app-instrumentation', reason: 'Unsupported network action.' };
  })()`;
}

export function redactNetworkEvidence<T>(value: T): T {
  if (!isRecord(value)) return value;
  const clone = { ...value } as Record<string, unknown>;
  if (Array.isArray(clone.requests)) clone.requests = clone.requests.map(redactNetworkRequest).map(normalizeNetworkRequest);
  if (clone.request) clone.request = normalizeNetworkRequest(redactNetworkRequest(clone.request));
  if (clone.har) clone.har = redactHar(clone.har);
  return clone as T;
}

export function normalizeNetworkEvidence(value: unknown, action: string): NetworkEvidencePayload {
  if (!isRecord(value) || Array.isArray(value)) {
    return {
      available: false,
      action,
      source: "runtime",
      code: "malformed-payload",
      reason: "Network runtime returned a malformed payload.",
      requests: [],
    };
  }
  const normalized = { ...value } as NetworkEvidencePayload;
  if (normalized.requests !== undefined && !Array.isArray(normalized.requests)) {
    return {
      ...normalized,
      available: false,
      action,
      code: "malformed-payload",
      reason: "Network runtime returned a malformed request list.",
      requests: [],
    };
  }
  if (Array.isArray(normalized.requests)) normalized.requests = normalized.requests.map(normalizeNetworkRequest);
  if (normalized.request) normalized.request = normalizeNetworkRequest(normalized.request) as NetworkRequest;
  if ((action === "requests" || action === "waterfall" || action === "har-stop") && normalized.available !== false && Array.isArray(normalized.requests) && normalized.requests.length === 0) {
    return {
      ...normalized,
      available: false,
      action,
      code: "no-observed-traffic",
      reason: "No network traffic was observed by the selected upstream/bridge path.",
      requests: [],
      realValidation: realValidation({
        state: "partial",
        evidence: [{ source: String(normalized.source ?? "network"), command: `network.${action}`, confidence: "low" }],
        missingEvidence: [{
          signal: "observed-network-traffic",
          reason: "No network traffic was observed by the selected upstream/bridge path.",
          recommendedFix: "Start capture before the interaction or verify the app network bridge patches fetch/XHR.",
        }],
      }),
    };
  }
  return {
    ...normalized,
    realValidation: networkRealValidation(normalized, action),
  };
}

export function networkTransport(metroPort: number, target: NetworkTarget | null, cdp: unknown = null): NetworkTransport {
  return {
    name: "metro-inspector-hermes-cdp",
    metroPort,
    protocol: "Runtime.evaluate",
    target: targetSummary(target),
    cdp,
  };
}

export function networkLimitations(value: unknown): string[] {
  const record = isRecord(value) ? value : {};
  const limitations = [
    "Network evidence is limited to traffic observed by the selected React Native DevTools or app bridge network domain.",
    "Headers, cookies, credentials, request bodies, and response bodies are redacted before stdout and artifact writes.",
  ];
  if (record.source === "app-instrumentation") {
    limitations.push("Legacy app instrumentation was used because no upstream DevTools or plugin bridge network domain was available.");
  }
  if (record.available === false && record.code === "no-observed-traffic") {
    limitations.push("No observed traffic is not proof that the app made no native network requests outside the selected domain.");
  }
  return limitations;
}

export function networkWaterfallPayload(payload: NetworkEvidencePayload): NetworkEvidencePayload {
  const requests = Array.isArray(payload.requests) ? payload.requests.map(normalizeNetworkRequest) as NetworkRequest[] : [];
  const rankedRequests = [...requests]
    .filter((request) => typeof request.durationMs === "number")
    .sort((a, b) => Number(b.durationMs ?? 0) - Number(a.durationMs ?? 0))
    .slice(0, 50);
  const duplicateGroups = duplicateNetworkRequests(requests);
  const slowThresholdMs = 500;
  const waterfall = {
    requestCount: requests.length,
    slowThresholdMs,
    slowRequestCount: rankedRequests.filter((request) => Number(request.durationMs ?? 0) >= slowThresholdMs).length,
    rankedRequests,
    duplicateGroups,
    timings: requests.map((request) => ({
      requestId: request.requestId ?? request.id ?? null,
      method: request.method ?? "GET",
      origin: request.origin ?? null,
      path: request.path ?? null,
      startedAt: request.startedAt ?? null,
      endedAt: request.endedAt ?? null,
      durationMs: request.durationMs ?? null,
      status: request.status ?? null,
      initiator: request.initiator ?? null,
    })),
  };
  return {
    ...payload,
    action: "waterfall",
    requests,
    waterfall,
    realValidation: networkRealValidation({ ...payload, requests }, "waterfall"),
  };
}

export function networkCaptureTiming(value: unknown, clock = systemClock): NetworkCaptureTiming {
  const record = isRecord(value) ? value : {};
  const requests = Array.isArray(record.requests) ? record.requests : record.request ? [record.request] : [];
  const times = requests
    .map((request) => isRecord(request) ? request.startedAt : undefined)
    .filter((item): item is string => typeof item === "string" && item.length > 0)
    .sort();
  return {
    startedAt: typeof record.startedAt === "string" ? record.startedAt : times[0] ?? null,
    stoppedAt: typeof record.stoppedAt === "string" ? record.stoppedAt : clock.now().toISOString(),
    observedRequestCount: requests.length,
  };
}

function networkRealValidation(value: NetworkEvidencePayload, action: string) {
  const requests = Array.isArray(value.requests) ? value.requests : value.request ? [value.request] : [];
  const hasTimedRequests = requests.some((request) => typeof request?.durationMs === "number");
  const hasWaterfallMetadata = requests.some((request) => typeof request?.startedAt === "string" && typeof request?.endedAt === "string");
  return realValidation({
    state: value.available === false ? "unvalidated" : hasTimedRequests ? (action === "waterfall" && !hasWaterfallMetadata ? "partial" : "validated") : "partial",
    claimsAllowed: {
      networkLatency: hasTimedRequests,
      networkWaterfall: action === "waterfall" && hasWaterfallMetadata,
    },
    evidence: [{
      source: String(value.source ?? value.evidenceSource ?? "network"),
      command: `network.${action}`,
      timestamp: new Date().toISOString(),
      confidence: hasTimedRequests ? "medium" : "low",
    }],
    missingEvidence: [
      ...(!hasTimedRequests ? [{
        signal: "request-duration",
        reason: "No timed network request rows were present.",
        recommendedFix: "Run network requests after a real interaction or mount a bridge that records durationMs.",
      }] : []),
      ...(action === "waterfall" && !hasWaterfallMetadata ? [{
        signal: "network-phase-timestamps",
        reason: "Request rows do not include complete endedAt/phase timing metadata.",
        recommendedFix: "Upgrade the app bridge to record endedAt and phase timing metadata.",
      }] : []),
    ],
  });
}

function normalizeNetworkRequest(request: unknown): unknown {
  if (!isRecord(request)) return request;
  const url = String(request.url ?? (isRecord(request.request) ? request.request.url : "") ?? "");
  const parsed = parseUrlParts(url);
  const startedAt = optionalString(request.startedAt);
  const durationMs = numberOrNull(request.durationMs);
  const endedAt = optionalString(request.endedAt ?? request.completedAt) ?? inferEndedAt(startedAt, durationMs);
  const response = isRecord(request.response) ? request.response : {};
  const status = numberOrNull(request.status) ?? numberOrNull(response.status);
  return {
    ...request,
    id: optionalString(request.id) ?? optionalString(request.requestId) ?? null,
    requestId: optionalString(request.requestId) ?? optionalString(request.id) ?? null,
    method: optionalString(request.method) ?? optionalString(isRecord(request.request) ? request.request.method : null) ?? "GET",
    url,
    origin: parsed.origin,
    path: parsed.path,
    startedAt,
    endedAt,
    durationMs,
    status,
    ok: typeof request.ok === "boolean" ? request.ok : (typeof status === "number" ? status >= 200 && status < 400 : undefined),
    requestBytes: numberOrNull(request.requestBytes ?? request.encodedRequestBytes),
    responseBytes: numberOrNull(request.responseBytes ?? request.encodedResponseBytes ?? response.encodedBodySize ?? response.size),
    cache: isRecord(request.cache) ? request.cache : undefined,
    retryCount: numberOrNull(request.retryCount) ?? 0,
    aborted: request.aborted === true,
    error: optionalString(request.error),
    initiator: normalizeInitiator(request.initiator),
  };
}

function duplicateNetworkRequests(requests: NetworkRequest[]): Array<Record<string, unknown>> {
  const groups = new Map<string, NetworkRequest[]>();
  for (const request of requests) {
    const key = `${request.method ?? "GET"} ${request.origin ?? ""}${request.path ?? request.url ?? ""}`;
    const group = groups.get(key) ?? [];
    group.push(request);
    groups.set(key, group);
  }
  return [...groups.entries()]
    .filter(([, group]) => group.length > 1)
    .map(([key, group]) => ({
      key,
      count: group.length,
      requestIds: group.map((request) => request.requestId ?? request.id ?? null).filter(Boolean),
      totalDurationMs: group.reduce((sum, request) => sum + Number(request.durationMs ?? 0), 0),
    }));
}

export function harFromNetworkRequests(requests: NetworkRequest[], clock = systemClock): Record<string, unknown> {
  return {
    log: {
      version: "1.2",
      creator: { name: CLI_NAME, version: CLI_VERSION },
      entries: requests.map((request) => ({
        startedDateTime: request.startedAt ?? clock.now().toISOString(),
        time: request.durationMs ?? 0,
        request: {
          method: request.method ?? request.request?.method ?? "GET",
          url: request.url ?? request.request?.url ?? "",
          headers: request.headers ?? request.request?.headers ?? {},
          queryString: [],
          cookies: [],
        },
        response: {
          status: request.status ?? request.response?.status ?? 0,
          statusText: request.response?.statusText ?? "",
          headers: request.response?.headers ?? {},
          cookies: [],
          content: { size: request.responseBytes ?? 0, mimeType: request.response?.mimeType ?? "" },
        },
      })),
    },
  };
}

export function annotateHar(har: unknown, metadata: {
  source: string;
  transport: NetworkTransport | null;
  limitations: string[];
  captureTiming: NetworkCaptureTiming;
}): Record<string, unknown> {
  const copy = cloneJson(isRecord(har) ? har : harFromNetworkRequests([]));
  const log = isRecord(copy.log) ? copy.log : { version: "1.2", creator: { name: CLI_NAME, version: CLI_VERSION }, entries: [] };
  copy.log = log;
  log._expoIos = {
    source: metadata.source,
    transport: metadata.transport,
    limitations: metadata.limitations,
    captureTiming: metadata.captureTiming,
    redaction: {
      headers: ["authorization", "cookie", "set-cookie", "token", "secret", "api-key"],
      bodies: true,
      query: ["token", "secret", "key", "password", "auth", "session", "cookie"],
    },
  };
  return copy;
}

export function targetSummary(target: NetworkTarget | null | undefined): NetworkTargetSummary | null {
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

function toolJson(value: unknown): ToolTextResult {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${field} must be a non-empty string.`);
  }
  return value.trim();
}

function redactNetworkRequest(request: unknown): unknown {
  if (!isRecord(request)) return request;
  const content = isRecord(request.content)
    ? { ...request.content, text: undefined }
    : undefined;
  return {
    ...request,
    url: redactNetworkUrl(request.url),
    request: request.request ? redactNetworkMessage(request.request) : undefined,
    response: request.response ? redactNetworkMessage(request.response) : undefined,
    headers: request.headers ? redactHeaders(request.headers) : undefined,
    cookies: request.cookies ? REDACTED : undefined,
    body: undefined,
    postData: undefined,
    content,
  };
}

function redactNetworkMessage(message: unknown): unknown {
  if (!isRecord(message)) return message;
  const content = isRecord(message.content)
    ? { ...message.content, text: undefined }
    : undefined;
  return {
    ...message,
    url: redactNetworkUrl(message.url),
    headers: message.headers ? redactHeaders(message.headers) : undefined,
    cookies: message.cookies ? REDACTED : undefined,
    body: undefined,
    postData: undefined,
    content,
  };
}

function redactHeaders(headers: unknown): unknown {
  if (Array.isArray(headers)) {
    return headers.map((header) => {
      if (!isRecord(header)) return header;
      const name = String(header.name ?? "");
      return {
        ...header,
        value: /authorization|cookie|token|secret|api[-_]?key|password|set-cookie/i.test(name) ? REDACTED : header.value,
      };
    });
  }
  if (!isRecord(headers)) return headers;
  return Object.fromEntries(Object.entries(headers).map(([key, value]) => [
    key,
    /authorization|cookie|token|secret|api[-_]?key|password|set-cookie/i.test(key) ? REDACTED : value,
  ]));
}

function redactNetworkUrl(url: unknown): unknown {
  if (!url) return url;
  try {
    const parsed = new URL(String(url));
    for (const key of [...parsed.searchParams.keys()]) {
      if (/token|secret|key|password|auth|session|cookie/i.test(key)) parsed.searchParams.set(key, REDACTED);
    }
    parsed.username = parsed.username ? REDACTED : "";
    parsed.password = parsed.password ? REDACTED : "";
    return parsed.toString();
  } catch {
    return String(url).replace(/([?&][^=]*(token|secret|key|password|auth|session|cookie)[^=]*=)[^&]+/gi, `$1${REDACTED}`);
  }
}

function redactHar(har: unknown): unknown {
  if (!isRecord(har)) return har;
  const copy = cloneJson(har);
  const entries = isRecord(copy.log) ? copy.log.entries : undefined;
  if (Array.isArray(entries)) {
    for (const entry of entries) {
      if (!isRecord(entry)) continue;
      if (entry.request) entry.request = redactNetworkMessage(entry.request);
      if (entry.response) entry.response = redactNetworkMessage(entry.response);
    }
  }
  return copy;
}

function cloneJson<T>(value: T): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function parseUrlParts(url: string): { origin: string | null; path: string | null } {
  if (!url) return { origin: null, path: null };
  try {
    const parsed = new URL(url);
    return { origin: parsed.origin, path: `${parsed.pathname}${parsed.search}` };
  } catch {
    return { origin: null, path: url || null };
  }
}

function inferEndedAt(startedAt: string | null, durationMs: number | null): string | null {
  if (!startedAt || typeof durationMs !== "number") return null;
  const started = Date.parse(startedAt);
  if (!Number.isFinite(started)) return null;
  return new Date(started + durationMs).toISOString();
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function numberOrNull(value: unknown): number | null {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function normalizeInitiator(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined;
  const out = {
    route: optionalString(value.route),
    screen: optionalString(value.screen),
    interactionId: optionalString(value.interactionId),
    interactionName: optionalString(value.interactionName),
    queryKey: optionalString(value.queryKey),
    component: optionalString(value.component),
    source: isRecord(value.source) ? value.source : undefined,
  };
  return Object.values(out).some((item) => item !== undefined && item !== null) ? out : undefined;
}

const systemClock = {
  now: () => new Date(),
};

const defaultPath = {
  resolve: (filePath: string) => path.resolve(filePath),
  join: (...segments: string[]) => path.join(...segments),
  dirname: (filePath: string) => path.dirname(filePath),
};

const defaultFileSystem = {
  mkdir: (filePath: string, options: { recursive: true }) => fs.mkdir(filePath, options).then(() => undefined),
  writeJsonFile: (filePath: string, value: unknown) => fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8"),
};

function defaultResolveExpoStateRoot(args: NetworkCommandArgs): string {
  if (typeof args.stateDir === "string" && args.stateDir.length > 0) return args.stateDir;
  return ".scratch/expo98";
}
