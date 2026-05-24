import { promises as fs } from "node:fs";
import path from "node:path";

import { evaluateHermesExpression as sharedEvaluateHermesExpression } from "../../../../platform/hermes-cdp-client/src/main/index.ts";

export interface ToolTextResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

export interface MetroTarget {
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
  };
}

export interface TargetNormalizationError {
  index: number | null;
  reason: string;
  shape: unknown;
}

export interface MetroTargetsResult {
  available: boolean;
  endpoint: "/json/list";
  targets: MetroTarget[];
  malformedTargets: TargetNormalizationError[];
  reason: string | null;
}

export interface MetroEndpointResult {
  available: boolean;
  endpoint: string;
  text?: string | null;
  value?: unknown;
  error?: string | null;
}

export interface MetroSymbolicationResult {
  available: boolean;
  endpoint: "/symbolicate";
  status: number | null;
  reason: string | null;
  value: unknown;
}

export interface ComponentStackFrame {
  methodName: string;
  file: string;
  lineNumber: number;
  column: number;
}

export interface FetchResponseLike {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

export interface MetroInspectorClientDependencies {
  fetchLocalText?(url: string, options: { timeoutMs: number }): Promise<string>;
  fetchLocalJson?(url: string, options: { timeoutMs: number }): Promise<unknown>;
  fetchLocalLoopback?(
    url: string,
    options: { method: "POST"; headers: Record<string, string>; body: string; timeoutMs: number },
  ): Promise<FetchResponseLike>;
}

export interface MetroCommandDependencies extends MetroInspectorClientDependencies {
  metroStatusPayload?(args: Record<string, unknown>): Promise<unknown>;
  metroReloadPayload?(args: Record<string, unknown>): Promise<unknown>;
  metroSymbolicatePayload?(args: Record<string, unknown>): Promise<unknown>;
  readTextFile?(filePath: string, encoding: "utf8"): Promise<string>;
  resolvePath?(filePath: string): string;
  evaluateHermesExpression?(
    webSocketDebuggerUrl: string,
    expression: string,
    options: { timeoutMs: number },
  ): Promise<HermesEvaluationResult>;
}

interface ProbeSymbolicationResult {
  available: boolean;
  endpoint: "/symbolicate";
  status: number | null;
  reason: string | null;
}

export interface MetroStatusPayload {
  available: boolean;
  reason: string | null;
  metroPort: number;
  status: "available" | "unavailable";
  statusText: string | null | undefined;
  error: string | null;
  version: unknown;
  versionError: string | null;
  targetCount: number;
  targets: Array<Partial<MetroTarget> | null>;
  targetDiscovery: {
    endpoint: "/json/list";
    available: boolean;
    reason: string | null;
    malformedTargets: TargetNormalizationError[];
  };
  symbolication: ProbeSymbolicationResult | { available: false; reason: "Metro is unavailable."; endpoint: "/symbolicate" };
  limitations: string[];
}

export interface HermesEvaluationResult {
  result?: {
    result?: {
      value?: unknown;
    };
  };
  error?: string;
  [key: string]: unknown;
}

const LIMITATIONS = [
  "This command probes existing Metro HTTP endpoints only and never starts Metro implicitly.",
  "Connected targets can be stale when multiple apps or devices are attached.",
];

const MAX_OUTPUT = 16_384;

export function toolJson(value: unknown): ToolTextResult {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

export function unwrapToolJson(result: ToolTextResult): unknown {
  const text = result.content[0]?.text;
  return typeof text === "string" ? JSON.parse(text) : result;
}

export function clampNumber(value: unknown, min: number, max: number): number {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new Error(`Expected a finite number, got ${String(value)}.`);
  }
  return Math.min(Math.max(number, min), max);
}

export function formatError(error: unknown): string {
  if (!error) return "Unknown error";
  const record = asRecord(error);
  const message = record ? record.message : undefined;
  const parts = [message == null ? String(error) : String(message)];
  if (record?.stdout) parts.push(`stdout:\n${truncate(record.stdout)}`);
  if (record?.stderr) parts.push(`stderr:\n${truncate(record.stderr)}`);
  return parts.join("\n\n");
}

export function targetSummary(target: Partial<MetroTarget> | null | undefined): Partial<MetroTarget> | null {
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

export async function metroCommand(
  args: Record<string, unknown> = {},
  deps: MetroCommandDependencies = {},
): Promise<ToolTextResult> {
  const action = requireString(args.action ?? "status", "action");
  if (action === "reload") return toolJson(await (deps.metroReloadPayload ?? ((nextArgs) => metroReloadPayload(nextArgs, deps)))(args));
  if (action === "symbolicate") {
    return toolJson(await (deps.metroSymbolicatePayload ?? ((nextArgs) => metroSymbolicatePayload(nextArgs, deps)))(args));
  }
  if (action !== "status") throw new Error(`Unknown metro action: ${action}`);
  return toolJson(await (deps.metroStatusPayload ?? ((nextArgs) => metroStatusPayload(nextArgs, deps)))(args));
}

export async function metroStatusPayload(
  args: Record<string, unknown> = {},
  deps: MetroInspectorClientDependencies = {},
): Promise<MetroStatusPayload> {
  const metroPort = clampNumber(args.metroPort ?? 8081, 1, 65535);
  return new MetroInspectorClient(metroPort, deps).statusPayload();
}

export async function metroTargets(
  metroPort: number,
  deps: MetroInspectorClientDependencies = {},
): Promise<MetroTarget[]> {
  const result = await new MetroInspectorClient(metroPort, deps).targets();
  return result.targets;
}

export async function probeMetroSymbolication(
  metroPort: number,
  deps: MetroInspectorClientDependencies = {},
): Promise<ProbeSymbolicationResult> {
  return new MetroInspectorClient(metroPort, deps).probeSymbolication();
}

export class MetroInspectorClient {
  private readonly baseUrl: string;
  private readonly fetchLocalText: NonNullable<MetroInspectorClientDependencies["fetchLocalText"]>;
  private readonly fetchLocalJson: NonNullable<MetroInspectorClientDependencies["fetchLocalJson"]>;
  private readonly fetchLocalLoopback: NonNullable<MetroInspectorClientDependencies["fetchLocalLoopback"]>;

  constructor(private readonly metroPort: number, deps: MetroInspectorClientDependencies = {}) {
    this.baseUrl = `http://127.0.0.1:${metroPort}`;
    this.fetchLocalText = deps.fetchLocalText ?? defaultFetchLocalText;
    this.fetchLocalJson = deps.fetchLocalJson ?? defaultFetchLocalJson;
    this.fetchLocalLoopback = deps.fetchLocalLoopback ?? defaultFetchLocalLoopback;
  }

  async status(): Promise<MetroEndpointResult> {
    try {
      const text = await this.fetchLocalText(`${this.baseUrl}/status`, { timeoutMs: 1500 });
      return { available: true, endpoint: "/status", text, error: null };
    } catch (error) {
      return { available: false, endpoint: "/status", text: null, error: formatError(error) };
    }
  }

  async version(): Promise<MetroEndpointResult> {
    try {
      const value = await this.fetchLocalJson(`${this.baseUrl}/json/version`, { timeoutMs: 1500 });
      return { available: true, endpoint: "/json/version", value, error: null };
    } catch (error) {
      return { available: false, endpoint: "/json/version", value: null, error: formatError(error) };
    }
  }

  async targets(): Promise<MetroTargetsResult> {
    let raw: unknown;
    try {
      raw = await this.fetchLocalJson(`${this.baseUrl}/json/list`, { timeoutMs: 2500 });
    } catch (error) {
      return {
        available: false,
        endpoint: "/json/list",
        targets: [],
        malformedTargets: [],
        reason: formatError(error),
      };
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

    const targets: MetroTarget[] = [];
    const malformedTargets: TargetNormalizationError[] = [];
    raw.forEach((target, index) => {
      const normalized = this.normalizeTarget(target, index);
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

  normalizeTarget(target: unknown, index = 0): { target: MetroTarget | null; error: TargetNormalizationError | null } {
    const record = asRecord(target);
    if (!record || Array.isArray(target)) {
      return { target: null, error: { index, reason: "Target was not an object.", shape: responseShape(target) } };
    }

    const normalized: MetroTarget = {
      id: optionalString(record.id),
      title: optionalString(record.title),
      description: optionalString(record.description),
      appId: optionalString(record.appId),
      deviceName: optionalString(record.deviceName),
      devtoolsFrontendUrl: optionalString(record.devtoolsFrontendUrl),
      webSocketDebuggerUrl: optionalString(record.webSocketDebuggerUrl),
      reactNative: record.reactNative && typeof record.reactNative === "object"
        ? record.reactNative as Record<string, unknown>
        : null,
      capabilities: {
        hermesRuntime: typeof record.webSocketDebuggerUrl === "string" && record.webSocketDebuggerUrl.startsWith("ws"),
        devtoolsFrontend: typeof record.devtoolsFrontendUrl === "string" && record.devtoolsFrontendUrl.length > 0,
        reactNative: Boolean(record.reactNative),
      },
    };

    if (!normalized.id && !normalized.title && !normalized.webSocketDebuggerUrl && !normalized.devtoolsFrontendUrl) {
      return {
        target: null,
        error: {
          index,
          reason: "Target did not include any stable identifying metadata.",
          shape: responseShape(target),
        },
      };
    }

    return { target: normalized, error: null };
  }

  async symbolicate(stack: ComponentStackFrame[]): Promise<MetroSymbolicationResult> {
    try {
      const response = await this.fetchLocalLoopback(`${this.baseUrl}/symbolicate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ stack }),
        timeoutMs: 1500,
      });
      const value = response.ok ? await response.json().catch(() => null) : null;
      return {
        available: response.ok,
        endpoint: "/symbolicate",
        status: response.status,
        reason: response.ok ? null : `Metro symbolicate HTTP ${response.status}`,
        value,
      };
    } catch (error) {
      return {
        available: false,
        endpoint: "/symbolicate",
        status: null,
        reason: formatError(error),
        value: null,
      };
    }
  }

  async probeSymbolication(): Promise<ProbeSymbolicationResult> {
    const result = await this.symbolicate([]);
    return {
      available: result.available,
      endpoint: "/symbolicate",
      status: result.status,
      reason: result.reason,
    };
  }

  async statusPayload(): Promise<MetroStatusPayload> {
    const statusResult = await this.status();
    const targetsResult: MetroTargetsResult = statusResult.available
      ? await this.targets()
      : {
        available: false,
        endpoint: "/json/list",
        targets: [],
        malformedTargets: [],
        reason: "Metro is unavailable.",
      };
    const versionResult: MetroEndpointResult = statusResult.available
      ? await this.version()
      : { available: false, endpoint: "/json/version", value: null, error: "Metro is unavailable." };
    const symbolication = statusResult.available
      ? await this.probeSymbolication()
      : { available: false, reason: "Metro is unavailable.", endpoint: "/symbolicate" } as const;

    return {
      available: statusResult.available,
      reason: statusResult.available ? null : "Metro is not reachable on the requested port.",
      metroPort: this.metroPort,
      status: statusResult.available ? "available" : "unavailable",
      statusText: statusResult.text,
      error: statusResult.error ?? null,
      version: versionResult.value,
      versionError: versionResult.error ?? null,
      targetCount: targetsResult.targets.length,
      targets: targetsResult.targets.map(targetSummary),
      targetDiscovery: {
        endpoint: "/json/list",
        available: targetsResult.available,
        reason: targetsResult.reason,
        malformedTargets: targetsResult.malformedTargets,
      },
      symbolication,
      limitations: LIMITATIONS,
    };
  }
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${field} must be a non-empty string.`);
  }
  return value.trim();
}

function responseShape(value: unknown): unknown {
  if (value == null) return null;
  if (Array.isArray(value)) return { type: "array", length: value.length };
  if (typeof value !== "object") return { type: typeof value };
  const record = value as Record<string, unknown>;
  const shape: Record<string, unknown> = { type: "object", keys: Object.keys(record).slice(0, 20) };
  if (typeof record.type === "string") shape.resultType = record.type;
  if (record.result && typeof record.result === "object") shape.result = responseShape(record.result);
  return shape;
}

function truncate(value: unknown, limit = MAX_OUTPUT): string {
  const text = String(value ?? "");
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}\n[truncated ${text.length - limit} characters]`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? value as Record<string, unknown> : null;
}

async function metroReloadPayload(args: Record<string, unknown>, deps: MetroCommandDependencies = {}): Promise<unknown> {
  const metroPort = clampNumber(args.metroPort ?? 8081, 1, 65535);
  const targets = await metroTargets(metroPort, deps);
  const webSocketDebuggerUrl = targets[0]?.webSocketDebuggerUrl ?? null;
  if (!webSocketDebuggerUrl) {
    return { available: false, action: "reload", reason: "No Metro inspector target.", metroPort };
  }
  const evaluate = deps.evaluateHermesExpression ?? sharedEvaluateHermesExpression;
  const result = await evaluate(webSocketDebuggerUrl, `(() => {
    const devSettings = globalThis.NativeModules?.DevSettings || globalThis.__fbBatchedBridgeConfig?.remoteModuleConfig?.DevSettings;
    if (globalThis.location && typeof globalThis.location.reload === 'function') { globalThis.location.reload(); return { available: true, strategy: 'location.reload' }; }
    if (devSettings && typeof devSettings.reload === 'function') { devSettings.reload(); return { available: true, strategy: 'DevSettings.reload' }; }
    return { available: false, reason: 'No runtime reload hook was available.' };
  })()`, { timeoutMs: 3000 });
  const value = result.result?.result?.value;
  return {
    ...(isPlainObject(value) ? value : { available: false, reason: result.error ?? "Runtime reload did not return a value." }),
    action: "reload",
    metroPort,
    target: targetSummary(targets[0]),
  };
}

async function metroSymbolicatePayload(args: Record<string, unknown>, deps: MetroCommandDependencies = {}): Promise<unknown> {
  const stackFile = requireString(args.stackFile ?? positionalArg(args._, 0) ?? args.file, "stackFile");
  const resolvePath = deps.resolvePath ?? path.resolve;
  const readTextFile = deps.readTextFile ?? fs.readFile;
  const resolvedStackFile = resolvePath(stackFile);
  const stack = parseComponentStackFrames(await readTextFile(resolvedStackFile, "utf8"));
  const metroPort = clampNumber(args.metroPort ?? 8081, 1, 65535);
  const result = await postMetroSymbolicate(metroPort, stack, deps);
  return { available: true, action: "symbolicate", metroPort, stackFile: resolvedStackFile, frameCount: stack.length, result };
}

function parseComponentStackFrames(stack: string): ComponentStackFrame[] {
  const frames: ComponentStackFrame[] = [];
  for (const line of String(stack).split("\n")) {
    const match = /^\s*at\s+(.*?)\s+\((http.*):(\d+):(\d+)\)$/.exec(line);
    if (!match) continue;
    frames.push({
      methodName: match[1]?.trim() || "<anonymous>",
      file: match[2] ?? "",
      lineNumber: Number(match[3]),
      column: Number(match[4]),
    });
  }
  return frames;
}

async function postMetroSymbolicate(
  metroPort: number,
  stack: ComponentStackFrame[],
  deps: MetroInspectorClientDependencies = {},
): Promise<unknown> {
  const result = await new MetroInspectorClient(metroPort, deps).symbolicate(stack);
  if (!result.available) throw new Error(result.reason ?? "Metro symbolication failed.");
  return result.value;
}

function positionalArg(value: unknown, index: number): unknown {
  return Array.isArray(value) ? value[index] : undefined;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

async function defaultEvaluateHermesExpression(
  webSocketDebuggerUrl: string,
  expression: string,
  { timeoutMs = 3000 }: { timeoutMs?: number } = {},
): Promise<HermesEvaluationResult> {
  return sharedEvaluateHermesExpression(webSocketDebuggerUrl, expression, { timeoutMs });
}

async function defaultFetchLocalText(url: string, options: { timeoutMs: number }): Promise<string> {
  const response = await defaultFetchLocalLoopback(url, options);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

async function defaultFetchLocalJson(url: string, options: { timeoutMs: number }): Promise<unknown> {
  return JSON.parse(await defaultFetchLocalText(url, options));
}

async function defaultFetchLocalLoopback(
  url: string,
  options: { method?: "POST"; headers?: Record<string, string>; body?: string; timeoutMs?: number } = {},
): Promise<Response> {
  const timeoutMs = options.timeoutMs ?? 1500;
  const { timeoutMs: _timeoutMs, ...request } = options;
  const candidates = loopbackUrlCandidates(url);
  let lastError: unknown = null;
  for (const candidate of candidates) {
    try {
      return await fetchWithTimeout(candidate, timeoutMs, request);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError ?? new Error("Local fetch failed");
}

function loopbackUrlCandidates(url: string): string[] {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return [url];
  }

  if (!["127.0.0.1", "localhost", "[::1]", "::1"].includes(parsed.hostname)) return [url];

  const candidates: string[] = [];
  for (const host of ["127.0.0.1", "localhost", "[::1]"]) {
    const candidate = new URL(url);
    candidate.host = `${host}${parsed.port ? `:${parsed.port}` : ""}`;
    if (!candidates.includes(candidate.toString())) candidates.push(candidate.toString());
  }
  return candidates;
}

async function fetchWithTimeout(url: string, timeoutMs: number, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}
