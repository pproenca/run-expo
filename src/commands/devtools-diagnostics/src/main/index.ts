import { evaluateHermesExpression as defaultEvaluateHermesExpression } from "../../../../platform/hermes-cdp-client/src/main/index.ts";
import type { ToolTextResult } from "../../../../core/tool-json-envelope/src/main/index.ts";

export interface DevtoolsTarget {
  id?: string | null;
  title?: string | null;
  description?: string | null;
  appId?: string | null;
  deviceName?: string | null;
  devtoolsFrontendUrl?: string | null;
  webSocketDebuggerUrl?: string | null;
  reactNative?: Record<string, unknown> | null;
  attached?: unknown;
  capabilities?: Record<string, unknown>;
}

export interface TargetSummary {
  id: string | null;
  title: string | null;
  description: string | null;
  appId: string | null;
  deviceName: string | null;
  devtoolsFrontendUrl: string | null;
  webSocketDebuggerUrl: string | null;
  reactNative: Record<string, unknown> | null;
  capabilities: Record<string, unknown>;
}

export interface MetroStatusLike {
  available: boolean;
  reason?: string | null;
  metroPort: number;
  status?: string;
  symbolication: { available: boolean; reason?: string | null };
  targetCount?: number;
  targets: DevtoolsTarget[];
  [key: string]: unknown;
}

export interface MetroTargetsResult {
  available: boolean;
  endpoint: "/json/list";
  targets: DevtoolsTarget[];
  malformedTargets: unknown[];
  reason: string | null;
}

export interface DevtoolsPanel {
  name: string;
  kind: "human-visible-panel" | "machine-readable-domain";
  machineReadable: boolean;
  humanVisible: boolean;
  available: boolean;
  transport: string;
  source: string;
  readCommands: string[];
  writeCommands: string[];
  artifactTypes: string[];
  limitations: string[];
  repairHints: string[];
}

export interface ReactNativeDevToolsReport {
  target: DevtoolsTarget | null;
  frontend: {
    available: boolean;
    url: string | null;
    launchPath: "metro-devtools-frontend-url" | null;
  };
  attachmentState: Record<string, unknown>;
  attachmentRisk: Record<string, unknown>;
  panels: DevtoolsPanel[];
}

export interface ExecResult {
  stdout?: unknown;
  stderr?: unknown;
  error?: unknown;
}

export interface HermesEvaluationResult {
  result?: { result?: { value?: unknown } };
  error?: string;
  diagnostics?: unknown;
  cdp?: unknown;
}

export interface DevtoolsDiagnosticsDependencies {
  metroStatusPayload?: (args: Record<string, unknown>) => Promise<MetroStatusLike> | MetroStatusLike;
  resolveExpoStateRoot?: (args: Record<string, unknown>) => string;
  now?: () => string;
  mkdir?: (dir: string, options?: { recursive: boolean }) => Promise<unknown> | unknown;
  readJsonFile?: (file: string) => Promise<unknown> | unknown;
  writeJsonFile?: (file: string, payload: unknown) => Promise<unknown> | unknown;
  execFile?: (
    file: string,
    args: string[],
    options: { timeout: number; rejectOnError: false },
  ) => Promise<ExecResult> | ExecResult;
  fetch?: (url: string, options?: Record<string, unknown>) => Promise<unknown>;
  redactValue?: (value: unknown) => unknown;
  targetDiscovery?: MetroTargetsResult | ((metroPort: number) => Promise<MetroTargetsResult> | MetroTargetsResult);
  evaluateHermesExpression?: (
    webSocketDebuggerUrl: string,
    expression: string,
    options: { timeoutMs: number },
  ) => Promise<HermesEvaluationResult> | HermesEvaluationResult;
}

export interface DevtoolsCapability {
  name: string;
  source: string;
  transport: string;
  available: boolean;
  confidence: string;
  reason: string | null;
  readCommands: string[];
  writeCommands: string[];
  artifactTypes: string[];
  repairHints: string[];
  limitations: string[];
}

const DEVTOOLS_EVENTS_LIMITATIONS = [
  "This v1 collector records DevTools capability/session events, not a raw Chrome DevTools Protocol stream.",
];
const DIAGNOSTICS_LIMITATIONS = [
  "Start Metro and connect a debuggable Hermes target before reading JS diagnostics.",
];
const MAX_OUTPUT = 40_000;
const MAX_ARRAY_ITEMS = 500;
const defaultDevtoolsDiagnosticsDependencies: DevtoolsDiagnosticsDependencies = {
  evaluateHermesExpression: defaultEvaluateHermesExpression,
};

export function toolJson(value: unknown): ToolTextResult {
  return { content: [{ type: "text", text: JSON.stringify(sanitizePayload(value), null, 2) }] };
}

export function requireString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${name} must be a non-empty string.`);
  }
  return value.trim();
}

export function clampNumber(value: unknown, min: number, max: number): number {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new Error(`Expected a finite number, got ${String(value)}.`);
  }
  return Math.min(Math.max(number, min), max);
}

export function truncate(value: unknown, max = MAX_OUTPUT): string {
  const text = String(value ?? "");
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n...[truncated ${text.length - max} chars]`;
}

export function targetSummary(target: DevtoolsTarget | null | undefined): TargetSummary | null {
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

export async function devtoolsCommand(
  args: Record<string, unknown> = {},
  deps: DevtoolsDiagnosticsDependencies = defaultDevtoolsDiagnosticsDependencies,
): Promise<ToolTextResult> {
  const action = requireString(args.action ?? "capabilities", "action");
  if (action === "status" || action === "panels") return toolJson(await devtoolsStatusPayload(args, action, deps));
  if (action === "open") return toolJson(await devtoolsOpenPayload(args, deps));
  if (action === "events") return toolJson(await devtoolsEventsPayload(args, deps));
  if (action !== "capabilities") throw new Error(`Unknown devtools action: ${action}`);

  const metro = await metroStatusPayload(args, deps);
  const rnDevTools = reactNativeDevToolsReport(metro);
  const hasTarget = metro.targets.length > 0;
  const hasRuntime = metro.targets.some((target) => target.webSocketDebuggerUrl);
  const hasDevtoolsFrontend = rnDevTools.frontend.available;
  const hasNetworkPanel = metro.targets.some(targetHasDevtoolsNetworkPanel);
  return toolJson({
    action,
    metroPort: metro.metroPort,
    reactNativeDevTools: rnDevTools,
    capabilities: [
      capabilityRecord({
        name: "metro-http",
        source: "metro",
        transport: "http",
        available: metro.available,
        confidence: metro.available ? "high" : "low",
        reason: metro.available ? null : (metro.reason ?? null),
        readCommands: ["metro status", "target list", "devtools capabilities"],
        writeCommands: [],
        artifactTypes: ["json"],
        repairHints: metro.available ? [] : ["Start Metro for the Maddie Native app and rerun with the correct --metro-port."],
        limitations: metro.available
          ? ["Reports Metro server and target discovery only; it does not prove the app UI is ready."]
          : ["Metro was not reachable on the requested port."],
      }),
      capabilityRecord({
        name: "metro-symbolication",
        source: "metro",
        transport: "http",
        available: metro.symbolication.available,
        confidence: metro.symbolication.available ? "high" : "low",
        reason: metro.symbolication.available ? null : (metro.symbolication.reason ?? null),
        readCommands: ["metro symbolicate"],
        writeCommands: [],
        artifactTypes: ["json"],
        repairHints: metro.symbolication.available ? [] : ["Confirm Metro is serving the current bundle and source maps."],
        limitations: metro.symbolication.available
          ? ["Symbolication quality depends on source maps for the current bundle."]
          : ["The Metro /symbolicate endpoint did not accept a probe request."],
      }),
      capabilityRecord({
        name: "hermes-runtime",
        source: "hermes-inspector",
        transport: "websocket",
        available: hasRuntime,
        confidence: hasRuntime ? "medium" : "low",
        reason: hasRuntime ? null : (hasTarget ? "No target exposes a websocket debugger URL." : "No Metro inspector target."),
        readCommands: ["console", "errors", "rn tree", "trace --action read"],
        writeCommands: ["trace --action start", "trace --action stop", "inspector install-comment-menu"],
        artifactTypes: ["json", "run-record"],
        repairHints: hasRuntime ? [] : ["Open Maddie Native in a debuggable development build and confirm /json/list includes webSocketDebuggerUrl."],
        limitations: hasRuntime
          ? ["Runtime signals are unavailable in disconnected, production, or non-Hermes targets."]
          : ["Console, errors, React tree, and runtime globals cannot be read without an inspector websocket."],
      }),
      capabilityRecord({
        name: "react-native-devtools",
        source: "react-native-devtools",
        transport: "metro-http",
        available: hasDevtoolsFrontend,
        confidence: hasDevtoolsFrontend ? "medium" : "low",
        reason: hasDevtoolsFrontend ? null : "No target advertises a React Native DevTools frontend URL.",
        readCommands: ["devtools status", "devtools panels", "devtools open"],
        writeCommands: ["devtools open"],
        artifactTypes: ["json"],
        repairHints: hasDevtoolsFrontend ? [] : ["Connect a React Native target to Metro that advertises devtoolsFrontendUrl."],
        limitations: hasDevtoolsFrontend
          ? ["The CLI can open and report the DevTools frontend; interactive panel state remains owned by React Native DevTools."]
          : ["React Native DevTools cannot be opened without a Metro target frontend URL."],
      }),
      capabilityRecord({
        name: "react-native-devtools-network-panel",
        source: "react-native-devtools",
        transport: "metro-http",
        available: hasNetworkPanel,
        confidence: hasNetworkPanel ? "medium" : "low",
        reason: hasNetworkPanel ? null : "No target advertises unstable_enableNetworkPanel=true in its DevTools frontend URL.",
        readCommands: ["devtools panels", "devtools open"],
        writeCommands: [],
        artifactTypes: ["human-visible-panel"],
        repairHints: hasNetworkPanel ? [] : ["Enable or connect a React Native DevTools target whose frontend URL includes unstable_enableNetworkPanel=true."],
        limitations: hasNetworkPanel
          ? ["The panel is an interactive DevTools UI surface; command-line HAR/export still uses app bridge evidence."]
          : ["Use the app network bridge for CLI-readable request evidence when the DevTools network panel is absent."],
      }),
      capabilityRecord({
        name: "console",
        source: "runtime-diagnostics",
        transport: "hermes-runtime",
        available: hasRuntime,
        confidence: hasRuntime ? "medium" : "low",
        reason: hasRuntime ? null : "No runtime diagnostics source is available.",
        readCommands: ["console"],
        writeCommands: [],
        artifactTypes: ["json", "run-record"],
        repairHints: hasRuntime ? [] : ["Connect Hermes runtime and install diagnostics instrumentation if the buffer is empty."],
        limitations: [
          "JS console diagnostics require app/runtime instrumentation or a readable runtime buffer.",
          "Native device logs are a different evidence stream; use logs for those.",
        ],
      }),
      capabilityRecord({
        name: "errors",
        source: "runtime-diagnostics",
        transport: "hermes-runtime",
        available: hasRuntime,
        confidence: hasRuntime ? "medium" : "low",
        reason: hasRuntime ? null : "No runtime diagnostics source is available.",
        readCommands: ["errors"],
        writeCommands: [],
        artifactTypes: ["json", "run-record"],
        repairHints: hasRuntime ? [] : ["Connect Hermes runtime and verify the app exposes bounded error diagnostics."],
        limitations: [
          "Error diagnostics depend on runtime buffers and may not include native crashes.",
          "Use logs and trace evidence for lower-level failures.",
        ],
      }),
    ],
    metro,
  });
}

export async function devtoolsStatusPayload(
  args: Record<string, unknown> = {},
  action = "status",
  deps: DevtoolsDiagnosticsDependencies = {},
): Promise<Record<string, unknown> & {
  panels: DevtoolsPanel[];
  machineReadableDomains: DevtoolsPanel[];
  humanVisiblePanels: DevtoolsPanel[];
}> {
  const metro = await metroStatusPayload(args, deps);
  const reactNativeDevTools = reactNativeDevToolsReport(metro);
  const panels = reactNativeDevTools.panels;
  const payload = {
    available: metro.available,
    action,
    metroPort: metro.metroPort,
    metro,
    target: reactNativeDevTools.target,
    frontend: reactNativeDevTools.frontend,
    attachmentState: reactNativeDevTools.attachmentState,
    attachmentRisk: reactNativeDevTools.attachmentRisk,
    panels,
    machineReadableDomains: panels.filter((panel) => panel.kind === "machine-readable-domain"),
    humanVisiblePanels: panels.filter((panel) => panel.kind === "human-visible-panel"),
  };
  return sanitizePayload(payload) as typeof payload;
}

export function reactNativeDevToolsReport(metro: MetroStatusLike): ReactNativeDevToolsReport {
  const target = metro.targets.find((item) => item.devtoolsFrontendUrl) ?? metro.targets[0] ?? null;
  const frontendUrl = frontendUrlForTarget(target, metro.metroPort);
  const hasNetworkPanel = targetHasDevtoolsNetworkPanel(target);
  const hasRuntime = Boolean(target?.webSocketDebuggerUrl);
  const attachmentState = detectDevToolsAttachmentState(target);
  const attachmentRisk = {
    level: hasRuntime || frontendUrl ? "medium" : "low",
    mayDetachHumanDebugger: Boolean(hasRuntime || frontendUrl),
    reason: hasRuntime || frontendUrl
      ? "Opening React Native DevTools can attach to the selected target and may affect an existing human debugger session."
      : "No debuggable React Native target is available.",
  };
  const panels = [
    devtoolsPanelRecord({
      name: "debugger",
      kind: "human-visible-panel",
      available: Boolean(frontendUrl),
      transport: "react-native-devtools",
      source: "devtoolsFrontendUrl",
      readCommands: ["devtools open"],
      writeCommands: ["devtools open"],
      artifactTypes: ["human-visible-panel"],
      limitations: ["Interactive debugger state is owned by React Native DevTools."],
      repairHints: frontendUrl ? [] : ["Connect a Metro target that advertises devtoolsFrontendUrl."],
    }),
    devtoolsPanelRecord({
      name: "network",
      kind: "human-visible-panel",
      available: hasNetworkPanel,
      transport: "react-native-devtools",
      source: "devtoolsFrontendUrl",
      readCommands: ["devtools panels", "devtools open"],
      writeCommands: [],
      artifactTypes: ["human-visible-panel"],
      limitations: ["The network panel is human-visible; CLI-readable HAR still requires network bridge evidence."],
      repairHints: hasNetworkPanel ? [] : ["Use the app network bridge or connect a target with unstable_enableNetworkPanel=true."],
    }),
    devtoolsPanelRecord({
      name: "console",
      kind: "machine-readable-domain",
      available: hasRuntime,
      transport: "hermes-runtime",
      source: "runtime-diagnostics",
      readCommands: ["console"],
      writeCommands: [],
      artifactTypes: ["json", "run-record"],
      limitations: ["Requires a readable runtime diagnostics buffer for bounded CLI output."],
      repairHints: hasRuntime ? [] : ["Connect Hermes runtime and enable app diagnostics instrumentation."],
    }),
    devtoolsPanelRecord({
      name: "errors",
      kind: "machine-readable-domain",
      available: hasRuntime,
      transport: "hermes-runtime",
      source: "runtime-diagnostics",
      readCommands: ["errors"],
      writeCommands: [],
      artifactTypes: ["json", "run-record"],
      limitations: ["Runtime JS errors are separate from native crash reports."],
      repairHints: hasRuntime ? [] : ["Connect Hermes runtime and use logs/crash reports for native failures."],
    }),
    devtoolsPanelRecord({
      name: "react-components",
      kind: "machine-readable-domain",
      available: hasRuntime,
      transport: "react-devtools-hook",
      source: "react-devtools-hook",
      readCommands: ["rn tree", "rn inspect", "snapshot"],
      writeCommands: [],
      artifactTypes: ["json", "run-record"],
      limitations: ["Component tree evidence depends on development runtime hooks and may omit private fiber details."],
      repairHints: hasRuntime ? [] : ["Connect Hermes runtime and confirm React DevTools hook availability."],
    }),
  ];
  return sanitizePayload({
    target,
    frontend: { available: Boolean(frontendUrl), url: frontendUrl, launchPath: frontendUrl ? "metro-devtools-frontend-url" : null },
    attachmentState,
    attachmentRisk,
    panels,
  }) as ReactNativeDevToolsReport;
}

export async function devtoolsOpenPayload(
  args: Record<string, unknown> = {},
  deps: DevtoolsDiagnosticsDependencies = {},
): Promise<Record<string, unknown>> {
  const metro = await metroStatusPayload(args, deps);
  const reactNativeDevTools = reactNativeDevToolsReport(metro);
  const target = reactNativeDevTools.target;
  const url = reactNativeDevTools.frontend.url;
  if (!url) {
    return sanitizePayload({
      available: false,
      action: "open",
      reason: "No DevTools frontend URL is available.",
      metro,
      reactNativeDevTools,
    }) as Record<string, unknown>;
  }
  const result = await execFile(deps, "open", [url], { timeout: 10_000, rejectOnError: false });
  return sanitizePayload({
    available: !result.error,
    action: "open",
    url,
    target,
    launchPath: "metro-devtools-frontend-url",
    mirrorsUpstreamLaunch: true,
    attachmentState: reactNativeDevTools.attachmentState,
    attachmentRisk: reactNativeDevTools.attachmentRisk,
    stdout: truncate(result.stdout),
    stderr: truncate(result.stderr),
    error: result.error ?? null,
  }) as Record<string, unknown>;
}

export async function devtoolsEventsPayload(
  args: Record<string, unknown> = {},
  deps: DevtoolsDiagnosticsDependencies = {},
): Promise<{
  available: true;
  action: "events";
  subaction: string;
  artifact: string;
  events: Array<Record<string, unknown>>;
  limitations: string[];
}> {
  const subaction = requireString(args.subaction ?? "read", "subaction");
  if (!["start", "read", "stop"].includes(subaction)) throw new Error(`Unknown devtools events action: ${subaction}`);
  const stateRoot = resolveExpoStateRoot(args, deps);
  const eventsDir = joinPath(stateRoot, "artifacts", "devtools-events");
  await mkdir(deps, eventsDir, { recursive: true });
  const file = joinPath(eventsDir, "events.json");
  const existing = await readJsonFile(deps, file).catch(() => ({ events: [] }));
  const previousEvents = Array.isArray(asRecord(existing)?.events) ? asRecord(existing)?.events as Array<Record<string, unknown>> : [];
  const event = {
    type: `devtools.${subaction}`,
    timestamp: now(deps),
    metro: sanitizePayload(await metroStatusPayload(args, deps)),
  };
  const payload = {
    available: true as const,
    action: "events" as const,
    subaction,
    artifact: file,
    events: subaction === "start" ? [event] : [...previousEvents, event],
    limitations: DEVTOOLS_EVENTS_LIMITATIONS,
  };
  const sanitized = sanitizePayload(payload) as typeof payload;
  await writeJsonFile(deps, file, sanitized);
  return sanitized;
}

export async function consoleCommand(
  args: Record<string, unknown> = {},
  deps: DevtoolsDiagnosticsDependencies = defaultDevtoolsDiagnosticsDependencies,
): Promise<ToolTextResult> {
  return diagnosticMessagesCommand("console", args, deps);
}

export async function errorsCommand(
  args: Record<string, unknown> = {},
  deps: DevtoolsDiagnosticsDependencies = defaultDevtoolsDiagnosticsDependencies,
): Promise<ToolTextResult> {
  return diagnosticMessagesCommand("errors", args, deps);
}

export async function diagnosticMessagesCommand(
  kind: "console" | "errors" | string,
  args: Record<string, unknown> = {},
  deps: DevtoolsDiagnosticsDependencies = defaultDevtoolsDiagnosticsDependencies,
): Promise<ToolTextResult> {
  const action = args.action ?? "read";
  const metroPort = clampNumber(args.metroPort ?? 8081, 1, 65535);
  const limit = clampNumber(args.limit ?? 100, 1, 1000);
  const targetDiscovery = await metroTargetDiscovery(metroPort, deps);
  const targets = targetDiscovery.targets;
  const webSocketDebuggerUrl = targets[0]?.webSocketDebuggerUrl ?? null;
  if (!webSocketDebuggerUrl) {
    return toolJson({
      available: false,
      kind,
      source: "hermes-runtime",
      reason: targetDiscovery.reason ?? "No Metro inspector target.",
      metroPort,
      messages: [],
      targetDiscovery,
      limitations: DIAGNOSTICS_LIMITATIONS,
    });
  }
  if (action === "clear") {
    const result = await evaluateHermesExpression(deps, webSocketDebuggerUrl, clearDiagnosticsExpression(kind), { timeoutMs: 5000 });
    const value = valueFromHermes(result);
    return toolJson({
      ...(value && typeof value === "object" && !Array.isArray(value) ? value : { available: false, reason: result?.error ?? "Runtime diagnostics did not return a value." }),
      kind,
      action,
      metroPort,
      target: targetSummary(targets[0]),
      cdp: result?.diagnostics ?? result?.cdp ?? null,
    });
  }
  const result = await evaluateHermesExpression(deps, webSocketDebuggerUrl, diagnosticsExpression({ kind, limit }), { timeoutMs: 5000 });
  const value = valueFromHermes(result);
  if (!value) {
    return toolJson({
      available: false,
      kind,
      source: "hermes-runtime",
      reason: result?.error ?? "Runtime diagnostics did not return a value.",
      metroPort,
      messages: [],
      cdp: result?.diagnostics ?? result?.cdp ?? null,
    });
  }
  const record = asRecord(value) ?? {};
  const messages = Array.isArray(record.messages) ? record.messages.slice(-limit) : [];
  return toolJson({
    ...record,
    kind,
    metroPort,
    target: targetSummary(targets[0]),
    messages,
    limit,
    cdp: result?.diagnostics ?? result?.cdp ?? null,
  });
}

export function diagnosticsExpression({ kind, limit }: { kind: string; limit: number }): string {
  return `(() => {
    const kind = ${JSON.stringify(kind)};
    const limit = ${Number(limit)};
    const diagnostics = globalThis.__EXPO_IOS_DIAGNOSTICS__ || globalThis.__CODEX_DIAGNOSTICS__ || {};
    const raw = diagnostics[kind] || diagnostics[kind === 'errors' ? 'error' : 'logs'] || [];
    const messages = Array.isArray(raw) ? raw.slice(-limit).map((entry, index) => ({
      index,
      level: entry && typeof entry === 'object' ? (entry.level || (kind === 'errors' ? 'error' : 'log')) : (kind === 'errors' ? 'error' : 'log'),
      message: entry && typeof entry === 'object' ? String(entry.message || entry.text || entry.value || '') : String(entry),
      timestamp: entry && typeof entry === 'object' ? (entry.timestamp || entry.time || null) : null,
      source: entry && typeof entry === 'object' ? (entry.source || null) : null,
      stack: entry && typeof entry === 'object' ? (entry.stack || null) : null
    })) : [];
    return {
      available: Array.isArray(raw),
      source: Array.isArray(raw) ? 'runtime-diagnostics-buffer' : 'missing-runtime-diagnostics-buffer',
      total: Array.isArray(raw) ? raw.length : 0,
      messages,
      limitations: Array.isArray(raw)
        ? ['Runtime diagnostics reflect the app-provided buffer; native logs are not included.']
        : ['Install or enable runtime diagnostics instrumentation to populate this buffer.']
    };
  })()`;
}

export function capabilityRecord(args: {
  name: string;
  source: string;
  transport: string;
  available: boolean;
  confidence: string;
  reason: string | null;
  readCommands?: string[];
  writeCommands?: string[];
  artifactTypes?: string[];
  repairHints?: string[];
  limitations: string[];
}): DevtoolsCapability {
  return {
    name: args.name,
    source: args.source,
    transport: args.transport,
    available: args.available === true,
    confidence: args.confidence,
    reason: args.reason,
    readCommands: args.readCommands ?? [],
    writeCommands: args.writeCommands ?? [],
    artifactTypes: args.artifactTypes ?? [],
    repairHints: args.repairHints ?? [],
    limitations: args.limitations,
  };
}

export function detectDevToolsAttachmentState(target: DevtoolsTarget | null | undefined): Record<string, unknown> {
  if (!target) return { state: "unavailable", detectable: false, reason: "No Metro target." };
  const raw = target.reactNative ?? {};
  const attached = raw.debuggerFrontendConnected ?? raw.debuggerConnected ?? raw.isDebuggerConnected ?? target.attached;
  if (attached === true) return { state: "attached", detectable: true };
  if (attached === false) return { state: "not-attached", detectable: true };
  return { state: "unknown", detectable: false, reason: "Metro target metadata did not expose debugger attachment state." };
}

export function targetHasDevtoolsNetworkPanel(target: DevtoolsTarget | null | undefined): boolean {
  const url = target?.devtoolsFrontendUrl;
  if (!url) return false;
  try {
    const parsed = new URL(url, "http://127.0.0.1");
    return parsed.searchParams.get("unstable_enableNetworkPanel") === "true";
  } catch {
    return /[?&]unstable_enableNetworkPanel=true(?:&|$)/.test(String(url));
  }
}

function devtoolsPanelRecord(args: {
  name: string;
  kind: "human-visible-panel" | "machine-readable-domain";
  available: boolean;
  transport: string;
  source: string;
  readCommands: string[];
  writeCommands: string[];
  artifactTypes: string[];
  limitations: string[];
  repairHints: string[];
}): DevtoolsPanel {
  return {
    name: args.name,
    kind: args.kind,
    machineReadable: args.kind === "machine-readable-domain",
    humanVisible: args.kind === "human-visible-panel",
    available: args.available === true,
    transport: args.transport,
    source: args.source,
    readCommands: args.readCommands,
    writeCommands: args.writeCommands,
    artifactTypes: args.artifactTypes,
    limitations: args.limitations,
    repairHints: args.repairHints,
  };
}

function frontendUrlForTarget(target: DevtoolsTarget | null, metroPort: number): string | null {
  const url = target?.devtoolsFrontendUrl;
  if (!url) return null;
  return url.startsWith("http") ? url : `http://127.0.0.1:${metroPort}${url}`;
}

async function metroStatusPayload(
  args: Record<string, unknown>,
  deps: DevtoolsDiagnosticsDependencies,
): Promise<MetroStatusLike> {
  if (deps.metroStatusPayload) return deps.metroStatusPayload(args);
  const metroPort = clampNumber(args.metroPort ?? 8081, 1, 65535);
  const baseUrl = `http://127.0.0.1:${metroPort}`;
  const status = await fetchText(deps, `${baseUrl}/status`, 1500);
  if (!status.available) {
    return {
      available: false,
      reason: "Metro is not reachable on the requested port.",
      metroPort,
      status: "unavailable",
      statusText: null,
      error: status.error,
      symbolication: { available: false, reason: "Metro is unavailable." },
      targetCount: 0,
      targets: [],
    };
  }
  const targetDiscovery = await fetchMetroTargets(deps, metroPort);
  const version = await fetchJson(deps, `${baseUrl}/json/version`, 1500).catch((error) => ({
    __error: formatError(error),
  }));
  const symbolication = await probeMetroSymbolication(deps, metroPort);
  return {
    available: true,
    reason: null,
    metroPort,
    status: "available",
    statusText: status.text,
    version: asRecord(version)?.__error ? null : version,
    versionError: asRecord(version)?.__error as string | undefined ?? null,
    symbolication,
    targetCount: targetDiscovery.targets.length,
    targets: targetDiscovery.targets,
    targetDiscovery,
  };
}

async function fetchMetroTargets(deps: DevtoolsDiagnosticsDependencies, metroPort: number): Promise<MetroTargetsResult> {
  const raw = await fetchJson(deps, `http://127.0.0.1:${metroPort}/json/list`, 2500).catch((error) => ({
    __error: formatError(error),
  }));
  const error = asRecord(raw)?.__error;
  if (typeof error === "string") {
    return { available: false, endpoint: "/json/list", targets: [], malformedTargets: [], reason: error };
  }
  if (!Array.isArray(raw)) {
    return {
      available: false,
      endpoint: "/json/list",
      targets: [],
      malformedTargets: [{ index: null, reason: "Metro target list was not an array.", shape: responseShape(raw) }],
      reason: "Metro target list was malformed.",
    };
  }
  const targets: DevtoolsTarget[] = [];
  const malformedTargets: unknown[] = [];
  raw.forEach((entry, index) => {
    const normalized = normalizeMetroTarget(entry, index);
    if (normalized.target) targets.push(normalized.target);
    if (normalized.error) malformedTargets.push(normalized.error);
  });
  return {
    available: true,
    endpoint: "/json/list",
    targets,
    malformedTargets,
    reason: malformedTargets.length > 0 ? "Some Metro targets were malformed and skipped." : null,
  };
}

async function metroTargetDiscovery(metroPort: number, deps: DevtoolsDiagnosticsDependencies): Promise<MetroTargetsResult> {
  if (typeof deps.targetDiscovery === "function") return deps.targetDiscovery(metroPort);
  if (deps.targetDiscovery) return deps.targetDiscovery;
  return fetchMetroTargets(deps, metroPort);
}

function clearDiagnosticsExpression(kind: string): string {
  return `(() => {
      const diagnostics = globalThis.__EXPO_IOS_DIAGNOSTICS__ || globalThis.__CODEX_DIAGNOSTICS__;
      if (!diagnostics) return { available: false, cleared: false, reason: 'Runtime diagnostics buffer is not installed.' };
      if (Array.isArray(diagnostics[${JSON.stringify(kind)}])) diagnostics[${JSON.stringify(kind)}].length = 0;
      return { available: true, cleared: true };
    })()`;
}

async function evaluateHermesExpression(
  deps: DevtoolsDiagnosticsDependencies,
  webSocketDebuggerUrl: string,
  expression: string,
  options: { timeoutMs: number },
): Promise<HermesEvaluationResult | null | undefined> {
  const evaluate = deps.evaluateHermesExpression ?? defaultEvaluateHermesExpression;
  return evaluate(webSocketDebuggerUrl, expression, options);
}

function valueFromHermes(result: HermesEvaluationResult | null | undefined): unknown {
  return result?.result?.result?.value;
}

async function execFile(
  deps: DevtoolsDiagnosticsDependencies,
  file: string,
  args: string[],
  options: { timeout: number; rejectOnError: false },
): Promise<ExecResult> {
  if (deps.execFile) return deps.execFile(file, args, options);
  const childProcess = await import("node:child_process");
  return new Promise((resolve) => {
    childProcess.execFile(file, args, { timeout: options.timeout }, (error, stdout, stderr) => {
      resolve({
        stdout,
        stderr,
        error: error ? formatError(error) : null,
      });
    });
  });
}

function resolveExpoStateRoot(args: Record<string, unknown>, deps: DevtoolsDiagnosticsDependencies): string {
  if (deps.resolveExpoStateRoot) return deps.resolveExpoStateRoot(args);
  const explicit = typeof args.stateDir === "string" && args.stateDir.length > 0 ? args.stateDir : null;
  if (explicit?.endsWith("/runs")) return explicit.slice(0, -"/runs".length);
  return explicit ?? joinPath(typeof args.root === "string" ? args.root : ".", ".scratch", "expo98");
}

async function mkdir(deps: DevtoolsDiagnosticsDependencies, dir: string, options: { recursive: boolean }): Promise<unknown> {
  if (deps.mkdir) return deps.mkdir(dir, options);
  const fs = await import("node:fs/promises");
  return fs.mkdir(dir, options);
}

async function readJsonFile(deps: DevtoolsDiagnosticsDependencies, file: string): Promise<unknown> {
  if (!deps.readJsonFile) {
    const fs = await import("node:fs/promises");
    return JSON.parse(await fs.readFile(file, "utf8"));
  }
  return deps.readJsonFile(file);
}

async function writeJsonFile(deps: DevtoolsDiagnosticsDependencies, file: string, payload: unknown): Promise<unknown> {
  const redacted = sanitizePayload(deps.redactValue ? deps.redactValue(payload) : payload);
  if (!deps.writeJsonFile) {
    const fs = await import("node:fs/promises");
    await fs.writeFile(file, `${JSON.stringify(redacted, null, 2)}\n`, "utf8");
    return undefined;
  }
  return deps.writeJsonFile(file, redacted);
}

function now(deps: DevtoolsDiagnosticsDependencies): string {
  return deps.now ? deps.now() : new Date().toISOString();
}

function joinPath(...parts: string[]): string {
  const absolute = parts[0]?.startsWith("/") === true;
  const joined = parts
    .flatMap((part) => part.split("/"))
    .filter((part, index) => part.length > 0 || (absolute && index === 0))
    .join("/");
  return absolute ? `/${joined}`.replace(/\/+/g, "/") : joined.replace(/\/+/g, "/");
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

async function probeMetroSymbolication(
  deps: DevtoolsDiagnosticsDependencies,
  metroPort: number,
): Promise<{ available: boolean; endpoint: "/symbolicate"; status: number | null; reason: string | null }> {
  try {
    const response = asFetchResponse(await fetchWithTimeout(deps, `http://127.0.0.1:${metroPort}/symbolicate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ stack: [] }),
      timeoutMs: 1500,
    }));
    return {
      available: response.ok,
      endpoint: "/symbolicate",
      status: response.status,
      reason: response.ok ? null : `Metro symbolicate HTTP ${response.status}`,
    };
  } catch (error) {
    return { available: false, endpoint: "/symbolicate", status: null, reason: formatError(error) };
  }
}

async function fetchText(
  deps: DevtoolsDiagnosticsDependencies,
  url: string,
  timeoutMs: number,
): Promise<{ available: boolean; text: string | null; error: string | null }> {
  try {
    const response = asFetchResponse(await fetchWithTimeout(deps, url, { timeoutMs }));
    return { available: response.ok, text: await response.text(), error: response.ok ? null : `HTTP ${response.status}` };
  } catch (error) {
    return { available: false, text: null, error: formatError(error) };
  }
}

async function fetchJson(deps: DevtoolsDiagnosticsDependencies, url: string, timeoutMs: number): Promise<unknown> {
  const response = asFetchResponse(await fetchWithTimeout(deps, url, { timeoutMs }));
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function fetchWithTimeout(
  deps: DevtoolsDiagnosticsDependencies,
  url: string,
  options: Record<string, unknown>,
): Promise<unknown> {
  const fetcher = deps.fetch ?? (globalThis as unknown as { fetch?: DevtoolsDiagnosticsDependencies["fetch"] }).fetch;
  if (!fetcher) throw new Error("fetch is not available in this runtime.");
  const timeoutMs = Number(options.timeoutMs ?? 1500);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const { timeoutMs: _timeoutMs, ...requestOptions } = options;
    return await fetcher(url, { ...requestOptions, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function asFetchResponse(value: unknown): {
  ok: boolean;
  status: number;
  text(): Promise<string>;
  json(): Promise<unknown>;
} {
  const response = value as {
    ok?: unknown;
    status?: unknown;
    text?: unknown;
    json?: unknown;
  };
  return {
    ok: response.ok === true,
    status: typeof response.status === "number" ? response.status : 0,
    text: typeof response.text === "function" ? response.text.bind(response) : async () => "",
    json: typeof response.json === "function" ? response.json.bind(response) : async () => null,
  };
}

function normalizeMetroTarget(value: unknown, index: number): { target: DevtoolsTarget | null; error: unknown | null } {
  const record = asRecord(value);
  if (!record) {
    return { target: null, error: { index, reason: "Target was not an object.", shape: responseShape(value) } };
  }
  const target = {
    id: optionalString(record.id),
    title: optionalString(record.title),
    description: optionalString(record.description),
    appId: optionalString(record.appId),
    deviceName: optionalString(record.deviceName),
    devtoolsFrontendUrl: optionalString(record.devtoolsFrontendUrl),
    webSocketDebuggerUrl: optionalString(record.webSocketDebuggerUrl),
    reactNative: asRecord(record.reactNative),
    attached: record.attached,
  };
  if (!target.id && !target.title && !target.webSocketDebuggerUrl && !target.devtoolsFrontendUrl) {
    return {
      target: null,
      error: { index, reason: "Target did not include any stable identifying metadata.", shape: responseShape(value) },
    };
  }
  return { target, error: null };
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function responseShape(value: unknown): unknown {
  if (Array.isArray(value)) return { type: "array", length: value.length };
  if (value && typeof value === "object") return { type: "object", keys: Object.keys(value).slice(0, 20) };
  return { type: typeof value };
}

function sanitizePayload(value: unknown): unknown {
  return boundValue(redactValue(value));
}

function boundValue(value: unknown): unknown {
  if (typeof value === "string") return truncate(value);
  if (Array.isArray(value)) return value.slice(-MAX_ARRAY_ITEMS).map(boundValue);
  const record = asRecord(value);
  if (!record) return value;
  return Object.fromEntries(Object.entries(record).map(([key, nested]) => [key, boundValue(nested)]));
}

function redactValue(value: unknown): unknown {
  if (typeof value === "string") return redactString(value);
  if (Array.isArray(value)) return value.map(redactValue);
  const record = asRecord(value);
  if (!record) return value;
  return Object.fromEntries(Object.entries(record).map(([key, nested]) => [
    key,
    isSensitiveKey(key) ? "[redacted]" : redactValue(nested),
  ]));
}

function redactString(value: string): string {
  try {
    const parsed = new URL(value);
    let changed = false;
    for (const key of [...parsed.searchParams.keys()]) {
      if (isSensitiveKey(key)) {
        parsed.searchParams.set(key, "[redacted]");
        changed = true;
      }
    }
    return changed ? parsed.toString() : value;
  } catch {
    return value.replace(/([?&](?:cookie|token|authorization|password|secret|api[-_]?key|apikey)=)[^&\s]+/gi, "$1[redacted]");
  }
}

function isSensitiveKey(key: string): boolean {
  return /token|authorization|cookie|password|secret|apikey|apiKey/i.test(key);
}

function formatError(error: unknown): string {
  const record = asRecord(error);
  const message = record?.message;
  return message == null ? String(error) : String(message);
}
