import { requireOptionalString } from "./common.js";
import { redactPerfValue as redactValue } from "./redaction.js";
import type {
  PerfConfidence,
  PerfFinding,
  PerfFrameSample,
  PerfMetric,
  PerfNativeSummary,
  PerfNetworkRequest,
  PerfRenderCommit,
  PerfReport,
  PerfRuntimePayload,
} from "./types.js";

export function metricMap(metrics: unknown): Map<string, PerfMetric> {
  if (!Array.isArray(metrics)) return new Map();
  return new Map(metrics.map((metric) => {
    const record = metric && typeof metric === "object" && !Array.isArray(metric) ? metric as Record<string, unknown> : {};
    const normalized = perfMetric(record);
    return [normalized.name, normalized];
  }));
}

export function lowerConfidence(left: unknown, right: unknown): PerfConfidence {
  const order: PerfConfidence[] = ["low", "medium", "high"];
  const leftIndex = order.indexOf(normalizeConfidence(left));
  const rightIndex = order.indexOf(normalizeConfidence(right));
  return order[Math.min(leftIndex === -1 ? 0 : leftIndex, rightIndex === -1 ? 0 : rightIndex)];
}

export function normalizePerfBridgePayload(value: any, action: string): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { available: false, action, sources: ["runtime"], source: "runtime", code: "malformed-payload", reason: "Performance runtime returned a malformed payload.", metrics: [] };
  }
  if (value.metrics !== undefined && !Array.isArray(value.metrics)) {
    return { ...value, available: false, action, code: "malformed-payload", reason: "Performance runtime returned malformed metrics.", metrics: [] };
  }
  const metrics = (value.metrics ?? []).map((metric: any) => perfMetric({
    name: metric.name,
    value: metric.value,
    unit: metric.unit,
    source: metric.source ?? value.source ?? value.sources?.[0] ?? "runtime",
    confidence: metric.confidence ?? value.confidence ?? "medium",
  }));
  return { ...value, action, metrics };
}

export function normalizePerfReport(runtimePayload: unknown, nativeSummary: PerfNativeSummary | null): PerfReport {
  const runtime = normalizeRuntimePayload(runtimePayload);
  const requests = runtimeNetworkRequests(runtime);
  const renders = runtimeRenderCommits(runtime);
  const frames = runtimeFrameSamples(runtime);
  const findings: PerfFinding[] = [];
  const slowRequests = requests
    .filter((request) => Number(request.durationMs) >= 500)
    .sort((a, b) => Number(b.durationMs ?? 0) - Number(a.durationMs ?? 0));
  if (slowRequests[0]) {
    findings.push({
      type: "network-latency",
      severity: Number(slowRequests[0].durationMs) >= 1000 ? "high" : "medium",
      summary: `Slow network request: ${slowRequests[0].method ?? "GET"} ${slowRequests[0].url ?? ""}`,
      evidence: { durationMs: slowRequests[0].durationMs, status: slowRequests[0].status ?? null },
    });
  }
  const worstCommit = renders.reduce<PerfRenderCommit | null>((worst, commit) => Number(commit.durationMs ?? commit.actualDuration ?? 0) > Number(worst?.durationMs ?? worst?.actualDuration ?? 0) ? commit : worst, null);
  if (worstCommit && Number(worstCommit.durationMs ?? worstCommit.actualDuration ?? 0) >= 16.7) {
    findings.push({
      type: "render-cost",
      severity: Number(worstCommit.durationMs ?? worstCommit.actualDuration ?? 0) >= 50 ? "high" : "medium",
      summary: "React render commit exceeded one frame budget.",
      evidence: worstCommit,
    });
  }
  const droppedFrames = Number(runtime?.frames?.droppedFrameCount ?? frames.filter((frame) => Number(frame.deltaMs) > 33.4).length);
  if (droppedFrames > 0) {
    findings.push({
      type: "frame-jank",
      severity: droppedFrames >= 5 ? "high" : "medium",
      summary: "Frame samples include dropped or long frames.",
      evidence: { droppedFrameCount: droppedFrames, worstFrameMs: runtime?.frames?.worstFrameMs ?? null },
    });
  }
  if (nativeSummary?.available) {
    findings.push({
      type: "native-sample",
      severity: "info",
      summary: "Native sample artifact was parsed.",
      evidence: {
        physicalFootprintMb: nativeSummary.physicalFootprintMb,
        peakFootprintMb: nativeSummary.peakFootprintMb,
        topBuckets: nativeSummary.buckets,
      },
    });
  }
  const metrics = [
    perfMetric({ name: "network.requests", value: requests.length, unit: "count", source: "network", confidence: requests.length ? "medium" : "low" }),
    perfMetric({ name: "renders.commits", value: renders.length, unit: "count", source: "react-profiler", confidence: renders.length ? "medium" : "low" }),
    perfMetric({ name: "frames.samples", value: frames.length, unit: "count", source: "frame-sampler", confidence: frames.length ? "medium" : "low" }),
    ...(nativeSummary?.available ? [perfMetric({ name: "native.sample.bytes", value: nativeSummary.bytes, unit: "bytes", source: "native-profiler", confidence: "medium" })] : []),
  ];
  return {
    available: Boolean(runtime || nativeSummary?.available),
    sources: [
      ...(runtime ? ["runtime"] : []),
      ...(requests.length ? ["network"] : []),
      ...(renders.length ? ["react-profiler"] : []),
      ...(frames.length ? ["frame-sampler"] : []),
      ...(nativeSummary?.available ? ["native-profiler"] : []),
    ],
    runtime,
    findings: findings.length ? findings : [{ type: "insufficient-evidence", severity: "info", summary: "No bottleneck can be ranked from the available evidence." }],
    metrics,
    confidence: perfOverallConfidence(metrics),
    limitations: [
      ...(!renders.length ? ["Render cost is unavailable because no React Profiler commit records were returned."] : []),
      ...(!frames.length ? ["Frame jank is unavailable because no frame samples were returned."] : []),
      ...(!requests.length ? ["Network attribution is unavailable because no request rows were returned."] : []),
    ],
  };
}

function normalizeRuntimePayload(value: unknown): PerfRuntimePayload | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? redactValue(value) as PerfRuntimePayload
    : null;
}

function runtimeNetworkRequests(runtime: PerfRuntimePayload | null): PerfNetworkRequest[] {
  return Array.isArray(runtime?.network?.requests) ? runtime.network.requests : [];
}

function runtimeRenderCommits(runtime: PerfRuntimePayload | null): PerfRenderCommit[] {
  return Array.isArray(runtime?.renders?.commits) ? runtime.renders.commits : [];
}

function runtimeFrameSamples(runtime: PerfRuntimePayload | null): PerfFrameSample[] {
  return Array.isArray(runtime?.frames?.samples) ? runtime.frames.samples : [];
}

export function perfEvidenceSource(value: any): string {
  if (typeof value?.source === "string") return value.source;
  if (Array.isArray(value?.sources) && value.sources.length > 0) return value.sources[0];
  return "unknown";
}

export function perfTransport(metroPort: number, target: any, cdp: unknown = null): Record<string, any> {
  return { name: "metro-inspector-hermes-cdp", metroPort, protocol: "Runtime.evaluate", target: targetSummary(target), cdp };
}

export async function perfContext({ args, projectRoot, metro, target = null }: { args: Record<string, any>; projectRoot: string; metro: any; target?: any }): Promise<Record<string, any>> {
  const buildMode = normalizePerfBuildKind(args.buildKind);
  return {
    projectRoot,
    build: { mode: buildMode, releaseLike: ["preview", "release-export", "production"].includes(buildMode) },
    platform: args.platform ?? "ios",
    device: target?.deviceName ?? null,
    metro: metro
      ? { port: metro.metroPort ?? args.metroPort ?? 8081, status: metro.available ? "available" : "unavailable", targetCount: metro.targetCount ?? 0, devMode: buildMode === "development" ? true : null }
      : { port: args.metroPort ?? 8081, status: "not-measured", targetCount: 0, devMode: buildMode === "development" ? true : null },
    coldStart: null,
    samples: 1,
  };
}

export function normalizePerfBuildKind(value: unknown): string {
  const buildKind = requireOptionalString(value) ?? "development";
  if (buildKind === "production") return "production";
  if (["development", "dev-build", "preview", "release-export", "unknown"].includes(buildKind)) return buildKind;
  throw new Error(`Unknown performance build kind: ${buildKind}`);
}

export function perfMetric({ name, value, unit, source, confidence }: {
  name?: unknown;
  value?: unknown;
  unit?: unknown;
  source?: unknown;
  confidence?: unknown;
}): PerfMetric {
  return {
    name: String(name),
    value,
    unit: unit == null ? null : String(unit),
    source: typeof source === "string" && source ? source : "unknown",
    confidence: confidence === "high" || confidence === "medium" || confidence === "low" ? confidence : "low",
  };
}

export function perfOverallConfidence(metrics: Array<Pick<PerfMetric, "confidence">>): PerfConfidence {
  if (!metrics.length) return "low";
  if (metrics.some((metric) => metric.confidence === "high")) return "high";
  if (metrics.some((metric) => metric.confidence === "medium")) return "medium";
  return "low";
}

function normalizeConfidence(value: unknown): PerfConfidence {
  return value === "high" || value === "medium" || value === "low" ? value : "low";
}

export function perfDevelopmentLimitations(extra: unknown[] = []): string[] {
  return [
    ...extra.map(String),
    "Development-mode measurements include Metro, dev runtime, and instrumentation overhead and must not be generalized to release performance.",
  ];
}

export function targetSummary(target: any): Record<string, any> | null {
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
