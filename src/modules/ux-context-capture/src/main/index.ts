export interface ToolTextResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

export interface UxContextDependencies {
  normalizeProjectCwd: (cwd: unknown, options: { allowMissingPackageJson: true }) => Promise<string>;
  resolveIosDevice: (device: unknown, options: { preferBooted: true }) => Promise<Record<string, any>>;
  expoProjectRuntimeSummary: (cwd: string) => Promise<Record<string, any>>;
  inspectMetro: (metroPort: number, options: { includeComponents: boolean; componentFilter: string | null }) => Promise<{
    metro?: Record<string, any> | null;
    runtime?: Record<string, any> | null;
  }>;
  iosInstalledAppInfo: (udid: string, bundleId: string) => Promise<Record<string, any>>;
  captureIosScreenshot: (udid: string, outputPath: unknown) => Promise<Record<string, any>>;
  analyzePngScreenshot: (outputPath: string) => Promise<Record<string, any>>;
  expoRouteContext: (cwd: string) => Promise<Record<string, any>>;
  describeIosHierarchy: (udid: string) => Promise<Record<string, any>>;
  collectFilteredIosLogs: (udid: string, options: { last: string; bundleId: string | null; processName: string | null }) => Promise<Record<string, any>>;
  now?: () => Date;
  nowMs?: () => number;
}

export interface CaptureUxContextArgs extends Record<string, unknown> {
  cwd?: unknown;
  device?: unknown;
  metroPort?: unknown;
  componentFilter?: unknown;
  bundleId?: unknown;
  processName?: unknown;
  outputPath?: unknown;
  includeRuntime?: boolean;
  includeComponents?: boolean;
  includeScreenshot?: boolean;
  includeImageAnalysis?: boolean;
  includeHierarchy?: boolean;
  includeLogs?: boolean;
  logsLast?: string;
}

export const REVIEW_CONTEXT_QUESTIONS = [
  "Is the screen blank because of empty data, loading, failed network, or render failure?",
  "Which route/source file likely owns the visible screen?",
  "Is the app connected to Metro and running Hermes/Fabric/New Architecture?",
  "What colors, contrast, visual density, and coarse composition does the current screen expose?",
  "Which React components and host elements are likely composing the current screen?",
  "Which labels, text nodes, roles, test IDs, and source owner hints map visible UI back to code?",
  "Does the app expose a usable simulator hierarchy, or is screenshot/coordinate review the only reliable UI surface?",
  "Are recent native logs showing failed requests, reloads, exceptions, or slow local calls during the reviewed state?",
];

export function toolJson(value: unknown): ToolTextResult {
  return { content: [{ type: "text", text: `${JSON.stringify(value, null, 2)}\n` }] };
}

export async function captureUxContext(
  args: CaptureUxContextArgs = {},
  deps: UxContextDependencies,
): Promise<ToolTextResult> {
  const startedAt = nowMs(deps);
  const cwd = await deps.normalizeProjectCwd(args.cwd, { allowMissingPackageJson: true });
  const device = await deps.resolveIosDevice(args.device, { preferBooted: true });
  const metroPort = clampNumber(args.metroPort ?? 8081, 1, 65535);
  const context: Record<string, any> = {
    capturedAt: now(deps).toISOString(),
    cwd,
    device,
    elapsedMs: null,
    app: null,
    screenshot: null,
    visualAnalysis: null,
    metro: null,
    runtime: null,
    componentHierarchy: null,
    routes: null,
    hierarchy: null,
    logs: null,
    reviewQuestionsThisCanAnswer: REVIEW_CONTEXT_QUESTIONS,
  };

  const projectSummary = await safeToolSection(() => deps.expoProjectRuntimeSummary(cwd));
  context.project = projectSummary.ok ? projectSummary.value : projectSummary;

  const metroSummary = args.includeRuntime === false
    ? { ok: false as const, skipped: true, reason: "includeRuntime is false" }
    : await safeToolSection(() => deps.inspectMetro(metroPort, {
      includeComponents: args.includeComponents !== false,
      componentFilter: requireOptionalString(args.componentFilter),
    }));
  if (metroSummary.ok === true) {
    context.metro = metroSummary.value.metro;
    context.runtime = metroSummary.value.runtime;
  } else {
    context.metro = metroSummary;
    context.runtime = metroSummary;
  }
  context.componentHierarchy = context.runtime?.componentHierarchy ?? (
    args.includeRuntime === false
      ? { skipped: true, reason: "includeRuntime is false" }
      : args.includeComponents === false
        ? { skipped: true, reason: "includeComponents is false" }
        : { available: false, reason: "No component hierarchy returned by runtime probe." }
  );
  if (context.runtime && typeof context.runtime === "object" && "componentHierarchy" in context.runtime) {
    delete context.runtime.componentHierarchy;
  }

  const inferredBundleId =
    requireOptionalString(args.bundleId) ??
    firstMetroAppId(context.metro) ??
    appConfigBundleId(context.project) ??
    null;
  const processName = requireOptionalString(args.processName) ?? processNameFromBundleId(inferredBundleId);
  if (inferredBundleId) {
    const appInfo = await safeToolSection(() => deps.iosInstalledAppInfo(String(device.udid), inferredBundleId));
    context.app = appInfo.ok ? appInfo.value : { bundleId: inferredBundleId, ...appInfo };
  } else {
    context.app = { bundleId: null, warning: "Could not infer bundleId. Pass bundleId for app container details and precise log filtering." };
  }

  if (args.includeScreenshot !== false) {
    const screenshot = await safeToolSection(() => deps.captureIosScreenshot(String(device.udid), args.outputPath));
    context.screenshot = screenshot.ok ? screenshot.value : screenshot;
    if (screenshot.ok && args.includeImageAnalysis !== false) {
      const outputPath = screenshot.value.outputPath;
      const analysis = await safeToolSection(() => deps.analyzePngScreenshot(String(outputPath)));
      context.visualAnalysis = analysis.ok ? analysis.value : analysis;
    }
  } else {
    context.screenshot = { skipped: true, reason: "includeScreenshot is false" };
    context.visualAnalysis = { skipped: true, reason: "No screenshot captured." };
  }

  context.routes = await safeToolSection(() => deps.expoRouteContext(cwd));
  if (context.routes.ok) context.routes = context.routes.value;

  if (args.includeHierarchy !== false) {
    const hierarchy = await safeToolSection(() => deps.describeIosHierarchy(String(device.udid)));
    context.hierarchy = hierarchy.ok ? hierarchy.value : hierarchy;
  } else {
    context.hierarchy = { skipped: true, reason: "includeHierarchy is false" };
  }

  if (args.includeLogs) {
    const logsLast = args.logsLast ?? "60s";
    if (!/^\d+[smhd]$/.test(logsLast)) throw new Error("logsLast must look like 30s, 2m, 1h, or 1d.");
    const logs = await safeToolSection(() => deps.collectFilteredIosLogs(String(device.udid), {
      last: logsLast,
      bundleId: inferredBundleId,
      processName,
    }));
    context.logs = logs.ok ? logs.value : logs;
  } else {
    context.logs = {
      skipped: true,
      reason: "includeLogs is false. Set includeLogs=true for recent filtered iOS logs.",
      suggestedFilter: processName ? `process == "${processName}"` : inferredBundleId ? `process CONTAINS "${processNameFromBundleId(inferredBundleId)}"` : null,
    };
  }

  context.elapsedMs = nowMs(deps) - startedAt;
  return toolJson(context);
}

export async function safeToolSection<T>(fn: () => Promise<T> | T): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
  try {
    return { ok: true, value: await fn() };
  } catch (error) {
    return { ok: false, error: formatError(error) };
  }
}

export function requireOptionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function processNameFromBundleId(bundleId: unknown): string | null {
  if (!bundleId) return null;
  const last = String(bundleId).split(".").filter(Boolean).at(-1);
  return last ? last.replace(/[^a-zA-Z0-9_-]/g, "") : null;
}

export function clampNumber(value: unknown, min: number, max: number): number {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) {
    throw new Error(`Expected a finite number, got ${value}.`);
  }
  return Math.min(Math.max(numberValue, min), max);
}

function firstMetroAppId(metro: unknown): string | null {
  const targets = asRecord(metro)?.targets;
  if (!Array.isArray(targets)) return null;
  const target = targets.find((candidate) => asRecord(candidate)?.appId);
  return typeof target?.appId === "string" ? target.appId : null;
}

function appConfigBundleId(project: unknown): string | null {
  const bundleId = asRecord(asRecord(project)?.appConfig)?.iosBundleIdentifier;
  return typeof bundleId === "string" && bundleId.length > 0 ? bundleId : null;
}

function asRecord(value: unknown): Record<string, any> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : null;
}

function now(deps: UxContextDependencies): Date {
  return deps.now?.() ?? new Date();
}

function nowMs(deps: UxContextDependencies): number {
  return deps.nowMs?.() ?? Date.now();
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
