import { evaluateHermesExpression as sharedEvaluateHermesExpression } from "../../../hermes-cdp-client/src/main/index.ts";
import { metroTargets } from "../../../metro-probes/src/main/index.ts";

export interface ToolTextResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

export interface ModalBridgeTarget {
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

export interface PolicyDecision {
  checked?: boolean;
  action?: string;
  sideEffect?: string;
  allowed?: boolean | null;
  source?: string | null;
  reason?: string;
  [key: string]: unknown;
}

export interface HermesEvaluationResult {
  result?: { result?: { value?: unknown } };
  error?: string;
  diagnostics?: unknown;
  cdp?: unknown;
}

export interface ModalBridgeDependencies {
  metroTargets?: (metroPort: number) => Promise<ModalBridgeTarget[]> | ModalBridgeTarget[];
  evaluateHermesExpression?: (
    webSocketDebuggerUrl: string,
    expression: string,
    options: { timeoutMs: number },
  ) => Promise<HermesEvaluationResult | null | undefined> | HermesEvaluationResult | null | undefined;
  redactValue?: (value: unknown) => unknown;
}

export interface BridgeRuntimeTransport {
  name: "metro-inspector-hermes-cdp";
  metroPort: number;
  protocol: "Runtime.evaluate";
  target: TargetSummary | null;
  cdp: unknown;
}

export interface DomainUnavailable {
  available: false;
  domain: string;
  action: string;
  source: "app-instrumentation";
  evidenceSource: "unavailable";
  code: string;
  reason: string;
  metroPort: number;
  target: TargetSummary | null;
  transport: BridgeRuntimeTransport;
  policy: PolicyDecision | null;
  limitations: string[];
}

interface ModalBridgeCommandInput {
  args: Record<string, unknown>;
  domain: "dialog" | "sheet";
  action: string;
  expression: string;
  policy: PolicyDecision;
}

const MAX_OUTPUT = 40_000;
const MAX_ARRAY_ITEMS = 1000;

export function toolJson(value: unknown): ToolTextResult {
  return { content: [{ type: "text", text: stringifyBoundedJson(value) }] };
}

export async function dialogCommand(
  args: Record<string, unknown> = {},
  deps: ModalBridgeDependencies = defaultModalBridgeDependencies,
): Promise<ToolTextResult> {
  return modalBridgeCommand({ args, domain: "dialog", actions: ["status", "accept", "dismiss"] }, deps);
}

export async function sheetCommand(
  args: Record<string, unknown> = {},
  deps: ModalBridgeDependencies = defaultModalBridgeDependencies,
): Promise<ToolTextResult> {
  return modalBridgeCommand({ args, domain: "sheet", actions: ["status", "dismiss"] }, deps);
}

const defaultModalBridgeDependencies: ModalBridgeDependencies = {
  metroTargets: (metroPort) => metroTargets(metroPort) as Promise<ModalBridgeTarget[]>,
  evaluateHermesExpression: sharedEvaluateHermesExpression,
};

async function modalBridgeCommand(
  input: { args: Record<string, unknown>; domain: "dialog" | "sheet"; actions: string[] },
  deps: ModalBridgeDependencies,
): Promise<ToolTextResult> {
  const positionals = Array.isArray(input.args._) ? input.args._ : [];
  const action = requireString(input.args.action ?? positionals[0] ?? "status", "action");
  if (!input.actions.includes(action)) throw new Error(`Unknown ${input.domain} action: ${action}`);
  const sideEffect = action === "status" ? "read" : "device";
  const policy = {
    checked: true,
    action: `${input.domain}.${action}`,
    sideEffect,
    allowed: true,
    reason: "Modal action is non-destructive.",
  };
  return toolJson(await bridgeDomainCommand({
    args: input.args,
    domain: input.domain,
    action,
    expression: modalExpression({
      domain: input.domain,
      action,
      text: input.args.text ?? positionals[1],
    }),
    policy,
  }, deps));
}

async function bridgeDomainCommand(
  input: ModalBridgeCommandInput,
  deps: ModalBridgeDependencies,
): Promise<Record<string, any> | DomainUnavailable> {
  const metroPort = clampNumber(input.args.metroPort ?? 8081, 1, 65535);
  const targets = deps.metroTargets ? await deps.metroTargets(metroPort) : [];
  const target = targets[0] ?? null;
  const webSocketDebuggerUrl = target?.webSocketDebuggerUrl ?? null;
  if (!webSocketDebuggerUrl) {
    return domainUnavailable({
      domain: input.domain,
      action: input.action,
      metroPort,
      code: "no-runtime-target",
      reason: "No Metro inspector target.",
      policy: input.policy,
    });
  }
  if (!deps.evaluateHermesExpression) {
    return domainUnavailable({
      domain: input.domain,
      action: input.action,
      metroPort,
      code: "transport-failure",
      reason: `${input.domain} bridge did not return a value.`,
      target: targetSummary(target),
      policy: input.policy,
    });
  }
  const result = await deps.evaluateHermesExpression(webSocketDebuggerUrl, input.expression, { timeoutMs: 5000 });
  const value = result?.result?.result?.value;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return domainUnavailable({
      domain: input.domain,
      action: input.action,
      metroPort,
      code: "transport-failure",
      reason: result?.error ?? `${input.domain} bridge did not return a value.`,
      target: targetSummary(target),
      transport: bridgeRuntimeTransport(metroPort, target, result?.diagnostics ?? result?.cdp ?? null),
      policy: input.policy,
    });
  }
  const redacted = sanitizePayload(deps.redactValue ? deps.redactValue(value) : value) as Record<string, any>;
  return sanitizePayload({
    ...redacted,
    domain: input.domain,
    action: input.action,
    metroPort,
    target: targetSummary(target),
    transport: bridgeRuntimeTransport(metroPort, target, result?.diagnostics ?? result?.cdp ?? null),
    evidenceSource: typeof redacted.source === "string" ? redacted.source : "unknown",
    policy: input.policy,
  }) as Record<string, any>;
}

export function domainUnavailable(args: {
  domain: string;
  action: string;
  metroPort: number;
  reason: string;
  target?: TargetSummary | ModalBridgeTarget | null;
  policy?: PolicyDecision | null;
  code?: string;
  transport?: BridgeRuntimeTransport | null;
}): DomainUnavailable {
  return sanitizePayload({
    available: false,
    domain: args.domain,
    action: args.action,
    source: "app-instrumentation",
    evidenceSource: "unavailable",
    code: args.code ?? "unavailable",
    reason: args.reason,
    metroPort: args.metroPort,
    target: targetSummary(args.target),
    transport: args.transport ?? bridgeRuntimeTransport(args.metroPort, args.target ?? null, null),
    policy: args.policy ?? null,
    limitations: [`${args.domain} evidence requires the dev-only app instrumentation bridge.`],
  }) as DomainUnavailable;
}

export function bridgeRuntimeTransport(
  metroPort: number,
  target: ModalBridgeTarget | TargetSummary | null | undefined,
  cdp: unknown = null,
): BridgeRuntimeTransport {
  return sanitizePayload({
    name: "metro-inspector-hermes-cdp",
    metroPort,
    protocol: "Runtime.evaluate",
    target: targetSummary(target),
    cdp,
  }) as BridgeRuntimeTransport;
}

function modalExpression(args: { domain: "dialog" | "sheet"; action: unknown; text?: unknown }): string {
  const globalName = args.domain === "dialog" ? "__EXPO_IOS_DIALOG_BRIDGE__" : "__EXPO_IOS_SHEET_BRIDGE__";
  return `(() => {
    const action = ${JSON.stringify(args.action)};
    const text = ${JSON.stringify(args.text ?? null)};
    const bridge = globalThis.${globalName} ||
      (globalThis.__EXPO_IOS_INSTRUMENTATION__ && globalThis.__EXPO_IOS_INSTRUMENTATION__[${JSON.stringify(args.domain)}]);
    if (!bridge) return { available: false, source: 'app-instrumentation', reason: ${JSON.stringify(`${args.domain} bridge is not installed.`)}, action };
    if (action === 'status') return { available: true, source: 'app-instrumentation', action, visible: !!bridge.visible, ${args.domain}: bridge.current || null };
    if (action === 'accept') return { available: true, source: 'app-instrumentation', action, result: bridge.accept ? bridge.accept(text) : { accepted: true, text } };
    if (action === 'dismiss') return { available: true, source: 'app-instrumentation', action, result: bridge.dismiss ? bridge.dismiss() : { dismissed: true } };
    return { available: false, source: 'app-instrumentation', reason: 'Unsupported modal action.', action };
  })()`;
}

export function targetSummary(target: ModalBridgeTarget | TargetSummary | null | undefined): TargetSummary | null {
  if (!target) return null;
  return sanitizePayload({
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
  }) as TargetSummary;
}

export function clampNumber(value: unknown, min: number, max: number): number {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`Expected a finite number, got ${String(value)}.`);
  return Math.min(Math.max(number, min), max);
}

export function requireString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${name} must be a non-empty string.`);
  return value.trim();
}

function sanitizePayload(value: unknown): unknown {
  return boundValue(redactValue(value));
}

function stringifyBoundedJson(value: unknown): string {
  const sanitized = sanitizePayload(value);
  const text = JSON.stringify(sanitized, null, 2);
  if (text.length <= MAX_OUTPUT) return text;
  const record = asRecord(sanitized);
  const envelope: Record<string, unknown> = {
    available: false,
    source: "output-boundary",
    evidenceSource: "output-boundary",
    code: "output-truncated",
    outputTruncated: true,
    originalLength: text.length,
    domain: record?.domain,
    action: record?.action,
    preview: "",
  };
  let budget = MAX_OUTPUT - JSON.stringify(envelope, null, 2).length - 128;
  envelope.preview = text.slice(0, Math.max(0, budget));
  let output = JSON.stringify(envelope, null, 2);
  while (output.length > MAX_OUTPUT && typeof envelope.preview === "string") {
    budget -= output.length - MAX_OUTPUT + 128;
    envelope.preview = envelope.preview.slice(0, Math.max(0, budget));
    output = JSON.stringify(envelope, null, 2);
  }
  return output;
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

function truncate(value: unknown, max = MAX_OUTPUT): string {
  const text = String(value ?? "");
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n...[truncated ${text.length - max} chars]`;
}

function asRecord(value: unknown): Record<string, any> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : null;
}

async function evaluateHermesExpression(
  webSocketDebuggerUrl: string,
  expression: string,
  options: { timeoutMs: number },
): Promise<HermesEvaluationResult> {
  if (typeof WebSocket !== "function") {
    return { error: "This Node runtime does not expose a WebSocket client." };
  }
  const ws = new WebSocket(webSocketDebuggerUrl);
  await waitForOpen(ws, Math.min(options.timeoutMs, 2500));
  try {
    ws.send(JSON.stringify({ id: 1, method: "Runtime.enable", params: {} }));
    await waitForMessage(ws, 1, options.timeoutMs).catch(() => null);
    ws.send(JSON.stringify({ id: 2, method: "Runtime.evaluate", params: { expression, returnByValue: true, awaitPromise: true } }));
    return await waitForMessage(ws, 2, options.timeoutMs) as HermesEvaluationResult;
  } finally {
    ws.close();
  }
}

function waitForOpen(ws: WebSocket, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timed out opening WebSocket.")), timeoutMs);
    ws.addEventListener("open", () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
    ws.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new Error("WebSocket connection failed."));
    }, { once: true });
  });
}

function waitForMessage(ws: WebSocket, id: number, timeoutMs: number): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timed out waiting for CDP response.")), timeoutMs);
    ws.addEventListener("message", (event) => {
      const parsed = JSON.parse(String(event.data));
      if (parsed?.id !== id) return;
      clearTimeout(timer);
      resolve(parsed);
    });
    ws.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new Error("WebSocket connection failed."));
    }, { once: true });
  });
}
