import { promises as fs } from "node:fs";
import path from "node:path";

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

const CLI_NAME = "expo-ios";
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
  if (!["status", "requests", "request", "clear", "har"].includes(action)) {
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
  if (!deps.evaluateHermesExpression) throw new Error("networkCommand requires an evaluateHermesExpression adapter.");

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

  return toolJson({
    ...redacted,
    action: bridgeAction,
    metroPort,
    target: targetSummary(target),
    transport,
    evidenceSource: redacted.source ?? "unknown",
    limitations: networkLimitations(redacted),
    captureTiming: networkCaptureTiming(redacted, clock),
  });
}

const defaultNetworkDependencies: NetworkCommandDependencies = {
  metroTargets: defaultMetroTargets,
  evaluateHermesExpression: defaultEvaluateHermesExpression,
};

async function defaultMetroTargets(metroPort: number): Promise<NetworkTarget[]> {
  const response = await fetch(`http://localhost:${metroPort}/json/list`);
  if (!response.ok) return [];
  const parsed = await response.json() as unknown;
  return Array.isArray(parsed) ? parsed.map((target) => target as NetworkTarget) : [];
}

async function defaultEvaluateHermesExpression(
  webSocketDebuggerUrl: string,
  expression: string,
  options: { timeoutMs: number },
): Promise<HermesEvaluationResult> {
  if (typeof WebSocket !== "function") {
    return { error: "WebSocket is not available in this Node runtime." };
  }

  return new Promise((resolve) => {
    const ws = new WebSocket(webSocketDebuggerUrl);
    const timer = setTimeout(() => {
      try {
        ws.close();
      } catch {
        // ignore close errors during timeout cleanup
      }
      resolve({ error: `Hermes evaluation timed out after ${options.timeoutMs}ms.` });
    }, options.timeoutMs);

    ws.addEventListener("open", () => {
      ws.send(JSON.stringify({
        id: 1,
        method: "Runtime.evaluate",
        params: { expression, returnByValue: true, awaitPromise: true },
      }));
    });
    ws.addEventListener("message", (event) => {
      clearTimeout(timer);
      try {
        ws.close();
      } catch {
        // ignore close errors after a response
      }
      try {
        resolve({ result: JSON.parse(String(event.data)) });
      } catch (error) {
        resolve({ error: formatError(error) });
      }
    });
    ws.addEventListener("error", () => {
      clearTimeout(timer);
      resolve({ error: "Hermes websocket connection failed." });
    });
  });
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
      if (action === 'requests') return { available: true, action, source: 'plugin-bridge', domain: 'network', bridgeVersion: pluginVersion, requests: list() };
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
      if (action === 'requests') return { available: true, action, source: 'react-native-devtools-network', requests: list() };
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
    if (action === 'requests') {
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
  if (Array.isArray(clone.requests)) clone.requests = clone.requests.map(redactNetworkRequest);
  if (clone.request) clone.request = redactNetworkRequest(clone.request);
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
  if ((action === "requests" || action === "har-stop") && normalized.available !== false && Array.isArray(normalized.requests) && normalized.requests.length === 0) {
    return {
      ...normalized,
      available: false,
      action,
      code: "no-observed-traffic",
      reason: "No network traffic was observed by the selected upstream/bridge path.",
      requests: [],
    };
  }
  return normalized;
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
          content: { size: 0, mimeType: request.response?.mimeType ?? "", text: request.response?.body ?? "" },
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
    ? { ...request.content, text: request.content.text ? REDACTED : request.content.text }
    : undefined;
  return {
    ...request,
    url: redactNetworkUrl(request.url),
    request: request.request ? redactNetworkMessage(request.request) : undefined,
    response: request.response ? redactNetworkMessage(request.response) : undefined,
    headers: request.headers ? redactHeaders(request.headers) : undefined,
    cookies: request.cookies ? REDACTED : undefined,
    body: request.body ? REDACTED : undefined,
    postData: request.postData ? REDACTED : undefined,
    content,
  };
}

function redactNetworkMessage(message: unknown): unknown {
  if (!isRecord(message)) return message;
  const content = isRecord(message.content)
    ? { ...message.content, text: message.content.text ? REDACTED : message.content.text }
    : undefined;
  return {
    ...message,
    url: redactNetworkUrl(message.url),
    headers: message.headers ? redactHeaders(message.headers) : undefined,
    cookies: message.cookies ? REDACTED : undefined,
    body: message.body ? REDACTED : undefined,
    postData: message.postData ? REDACTED : undefined,
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
  return ".scratch/expo-ios";
}
