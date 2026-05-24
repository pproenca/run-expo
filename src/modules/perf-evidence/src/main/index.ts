import { execFile as nodeExecFile } from "node:child_process";
import { mkdir as fsMkdir, readFile, stat as fsStat, writeFile as fsWriteFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

import { evaluateHermesExpression as sharedEvaluateHermesExpression } from "../../../hermes-cdp-client/src/main/index.ts";
import { metroStatusPayload, metroTargets } from "../../../metro-probes/src/main/index.ts";
import { realValidation } from "../../../real-validation/src/main/index.ts";

const EXPO_IOS_BRIDGE_VERSION = "1.0.0";

export interface ToolTextResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

export interface PerfDependencies {
  normalizeProjectCwd?: (cwd: unknown, options: { allowMissingPackageJson: true }) => Promise<string> | string;
  expoProjectRuntimeSummary?: (cwd: string) => Promise<Record<string, any>> | Record<string, any>;
  metroStatusPayload?: (args: { metroPort: number }) => Promise<Record<string, any>> | Record<string, any>;
  metroTargets?: (metroPort: number) => Promise<Array<Record<string, any>>> | Array<Record<string, any>>;
  evaluateHermesExpression?: (url: string, expression: string, options: { timeoutMs: number }) => Promise<Record<string, any>> | Record<string, any>;
  findUp?: (cwd: string, name: string) => Promise<string | null> | string | null;
  readJsonFile?: (file: string) => Promise<any> | any;
  writeFile?: (file: string, data: string, encoding: "utf8") => Promise<void> | void;
  mkdir?: (path: string, options: { recursive: true }) => Promise<void> | void;
  pathExists?: (path: string) => Promise<boolean> | boolean;
  stat?: (path: string) => Promise<{ isFile(): boolean; size: number } | null> | { isFile(): boolean; size: number } | null;
  now?: () => Date;
}

export interface StateRootArgs extends Record<string, unknown> {
  stateDir?: string | null;
  root?: string | null;
  cwd?: string | null;
}

const PERF_ACTIONS = ["summary", "startup", "action", "bundle", "mark", "measure", "compare", "budget", "js-thread", "frames", "memory", "ettrace", "memgraph", "interaction", "report"];

export function toolJson(value: unknown): ToolTextResult {
  return { content: [{ type: "text", text: `${JSON.stringify(value, null, 2)}\n` }] };
}

export async function perfCommand(args: Record<string, any> = {}, deps: PerfDependencies = {}): Promise<ToolTextResult> {
  const action = requireString(args.action ?? firstPositional(args) ?? "summary", "action");
  if (!PERF_ACTIONS.includes(action)) throw new Error(`Unknown performance action: ${action}`);
  if (action === "summary") return toolJson(await perfSummaryPayload(args, deps));
  if (action === "bundle") return toolJson(await perfBundlePayload(args, deps));
  if (action === "compare") return toolJson(await perfComparePayload(args, deps));
  if (action === "budget") return toolJson(await perfBudgetPayload(args, deps));
  if (action === "memory") return toolJson(await perfMemoryPayload(args, deps));
  if (action === "ettrace" || action === "memgraph") return toolJson(await perfNativeProfilerPayload(args, action, deps));
  if (action === "interaction") return toolJson(await perfInteractionPayload(args, deps));
  if (action === "report") return toolJson(await perfReportPayload(args, deps));
  if (["mark", "measure", "js-thread", "frames"].includes(action)) return toolJson(await perfInstrumentedPayload(args, action, deps));
  return toolJson(await perfRuntimePayload(args, action, deps));
}

export async function perfSummaryPayload(args: Record<string, any> = {}, deps: PerfDependencies = {}): Promise<Record<string, any>> {
  const cwd = await projectCwd(args.cwd, deps);
  const summary = await projectSummary(cwd, deps);
  const metroPort = clampNumber(args.metroPort ?? 8081, 1, 65_535);
  const metro = await metroStatus({ metroPort }, deps);
  const metrics = [];
  const unavailableSources = [];
  const packageJsonPath = await findUpFile(summary.projectRoot, "package.json", deps);
  if (packageJsonPath) {
    const packageJson = await readJson(packageJsonPath, deps);
    metrics.push(perfMetric({
      name: "project.dependencies",
      value: Object.keys({ ...(packageJson.dependencies ?? {}), ...(packageJson.devDependencies ?? {}) }).length,
      unit: "count",
      source: "project",
      confidence: "low",
    }));
  } else {
    unavailableSources.push({ source: "project", reason: "No package.json found." });
  }
  if (metro.available) {
    metrics.push(perfMetric({
      name: "metro.targets",
      value: metro.targetCount,
      unit: "count",
      source: "metro",
      confidence: "medium",
    }));
  } else {
    unavailableSources.push({ source: "metro", reason: metro.reason });
  }
  const capabilities = [
    { source: "plugin-bridge-performance", available: metro.targets?.some((target: any) => target.capabilities?.hermesRuntime) === true, type: "upstream-plugin", confidence: "medium" },
    { source: "expo-devtools-performance", available: metro.available === true, type: "upstream-devtools", confidence: "low" },
    { source: "native-profiler", available: true, type: "native-fallback", confidence: "high" },
    { source: "bundle-artifact", available: false, type: "static-fallback", confidence: "high" },
  ];
  unavailableSources.push({ source: "plugin-bridge-performance", reason: "Run perf startup/action/mark against an app with the performance bridge domain registered." });
  unavailableSources.push({ source: "expo-devtools-performance", reason: "No machine-readable Expo DevTools performance domain was confirmed." });
  unavailableSources.push({ source: "bundle-artifact", reason: "Pass an existing bundle artifact to perf bundle for byte evidence." });
  const payload = {
    available: true,
    action: "summary",
    mode: "development",
    sources: ["project", "metro"],
    capabilities,
    confidence: perfOverallConfidence(metrics),
    context: await perfContext({ args, projectRoot: summary.projectRoot, metro }),
    metrics,
    unavailableSources,
    limitations: perfDevelopmentLimitations(["Summary reports evidence availability and lightweight signals; it is not a performance score."]),
  };
  return {
    ...payload,
    realValidation: perfValidation(payload, "summary"),
  };
}

export async function perfRuntimePayload(args: Record<string, any> = {}, action: string, deps: PerfDependencies = {}): Promise<Record<string, any>> {
  const metroPort = clampNumber(args.metroPort ?? 8081, 1, 65_535);
  const targets = await listMetroTargets(metroPort, deps);
  const target = targets[0] ?? null;
  const projectRoot = await projectCwd(args.cwd, deps);
  const metro = target
    ? { available: true, metroPort, status: "available", statusText: null, targetCount: targets.length, targets: targets.map(targetSummary) }
    : await metroStatus({ metroPort }, deps);
  let bridgePayload = null;
  if (target?.webSocketDebuggerUrl) {
    const result = await evaluateHermes(String(target.webSocketDebuggerUrl), perfExpression({ action, label: args.label }), deps);
    bridgePayload = result?.result?.result?.value ?? null;
  }
  const basePayload = bridgePayload && typeof bridgePayload === "object"
    ? normalizePerfBridgePayload(redactValue(bridgePayload), action)
    : {
        available: false,
        sources: ["runtime", "app-instrumentation"],
        metrics: [],
        code: target ? "malformed-payload" : "no-runtime-target",
        reason: target ? "Performance bridge did not return a value." : "No Metro inspector target.",
      };
  const payload = {
    ...basePayload,
    action,
    ...(action === "action" ? { actionName: requireString(args.label, "label") } : {}),
    mode: "development",
    context: await perfContext({ args, projectRoot, metro, target }),
    transport: perfTransport(metroPort, target, null),
    evidenceSource: perfEvidenceSource(basePayload),
    confidence: perfOverallConfidence(basePayload.metrics ?? []),
    limitations: perfDevelopmentLimitations(basePayload.limitations),
  };
  return writePerfArtifact(args, action, { ...payload, realValidation: perfValidation(payload, action) }, deps);
}

export async function perfInstrumentedPayload(args: Record<string, any> = {}, action: string, deps: PerfDependencies = {}): Promise<Record<string, any>> {
  const subaction = requireOptionalString(args.subaction);
  const label = requireOptionalString(args.label);
  const bridgeAction = perfBridgeAction(action, subaction);
  const metroPort = clampNumber(args.metroPort ?? 8081, 1, 65_535);
  const targets = await listMetroTargets(metroPort, deps);
  const target = targets[0] ?? null;
  const projectRoot = await projectCwd(args.cwd, deps);
  const metro = target
    ? { available: true, metroPort, status: "available", targetCount: targets.length, targets: targets.map(targetSummary) }
    : await metroStatus({ metroPort }, deps);
  let bridgePayload = null;
  if (target?.webSocketDebuggerUrl) {
    const result = await evaluateHermes(String(target.webSocketDebuggerUrl), perfExpression({ action: bridgeAction, label }), deps);
    bridgePayload = result?.result?.result?.value ?? null;
  }
  const basePayload = bridgePayload && typeof bridgePayload === "object"
    ? normalizePerfBridgePayload(redactValue(bridgePayload), action)
    : {
        available: false,
        sources: ["runtime", "app-instrumentation"],
        metrics: [],
        code: target ? "malformed-payload" : "no-runtime-target",
        reason: target ? "Performance bridge did not return a value." : "No Metro inspector target.",
      };
  const payload = {
    ...basePayload,
    action,
    subaction,
    bridgeAction,
    mode: "development",
    context: await perfContext({ args, projectRoot, metro, target }),
    transport: perfTransport(metroPort, target, null),
    evidenceSource: perfEvidenceSource(basePayload),
    confidence: perfOverallConfidence(basePayload.metrics ?? []),
    limitations: perfDevelopmentLimitations(basePayload.limitations),
  };
  return writePerfArtifact(args, action, { ...payload, realValidation: perfValidation(payload, action) }, deps);
}

export function perfBridgeAction(action: string, subaction?: string | null): string {
  if (action === "mark") return `mark-${subaction ?? "list"}`;
  if (action === "measure") return `measure-${subaction ?? "start"}`;
  if (action === "interaction") return `interaction-${subaction ?? "read"}`;
  return action;
}

export async function perfInteractionPayload(args: Record<string, any> = {}, deps: PerfDependencies = {}): Promise<Record<string, any>> {
  const subaction = requireString(args.subaction ?? "read", "subaction");
  if (!["start", "stop", "read"].includes(subaction)) throw new Error(`Unknown performance interaction action: ${subaction}`);
  const label = requireOptionalString(args.label ?? args.interaction);
  const metroPort = clampNumber(args.metroPort ?? 8081, 1, 65_535);
  const targets = await listMetroTargets(metroPort, deps);
  const target = targets[0] ?? null;
  const projectRoot = await projectCwd(args.cwd, deps);
  const metro = target
    ? { available: true, metroPort, status: "available", targetCount: targets.length, targets: targets.map(targetSummary) }
    : await metroStatus({ metroPort }, deps);
  let bridgePayload = null;
  let diagnostics = null;
  if (target?.webSocketDebuggerUrl) {
    const result = await evaluateHermes(String(target.webSocketDebuggerUrl), perfExpression({ action: `interaction-${subaction}`, label }), deps);
    bridgePayload = result?.result?.result?.value ?? null;
    diagnostics = result?.diagnostics ?? null;
  }
  const basePayload = bridgePayload && typeof bridgePayload === "object"
    ? normalizePerfBridgePayload(redactValue(bridgePayload), "interaction")
    : {
        available: false,
        sources: ["runtime", "app-instrumentation"],
        metrics: [],
        code: target ? "malformed-payload" : "no-runtime-target",
        reason: target ? "Performance interaction bridge did not return a value." : "No Metro inspector target.",
      };
  const payload = {
    ...basePayload,
    action: "interaction",
    subaction,
    interaction: label,
    mode: "development",
    context: await perfContext({ args, projectRoot, metro, target }),
    transport: perfTransport(metroPort, target, diagnostics),
    evidenceSource: perfEvidenceSource(basePayload),
    confidence: perfOverallConfidence(basePayload.metrics ?? []),
    limitations: perfDevelopmentLimitations(basePayload.limitations),
  };
  return writePerfArtifact(args, "interaction", { ...payload, realValidation: perfValidation(payload, "interaction") }, deps);
}

export async function perfReportPayload(args: Record<string, any> = {}, deps: PerfDependencies = {}): Promise<Record<string, any>> {
  const metroPort = clampNumber(args.metroPort ?? 8081, 1, 65_535);
  const targets = await listMetroTargets(metroPort, deps);
  const target = targets[0] ?? null;
  const projectRoot = await projectCwd(args.cwd, deps);
  const nativeArtifact = requireOptionalString(args.nativeArtifact);
  let runtimePayload = null;
  let diagnostics = null;
  if (target?.webSocketDebuggerUrl) {
    const result = await evaluateHermes(String(target.webSocketDebuggerUrl), perfExpression({ action: "report", label: args.interaction ?? args.label }), deps);
    runtimePayload = result?.result?.result?.value ?? null;
    diagnostics = result?.diagnostics ?? null;
  }
  const nativeSummary = nativeArtifact ? await parseNativeSampleArtifact(resolve(nativeArtifact), deps) : null;
  const report = normalizePerfReport(runtimePayload, nativeSummary);
  const metro = target
    ? { available: true, metroPort, status: "available", targetCount: targets.length, targets: targets.map(targetSummary) }
    : await metroStatus({ metroPort }, deps);
  const payload = {
    available: report.available,
    action: "report",
    interaction: args.interaction ?? args.label ?? null,
    mode: "development",
    sources: report.sources,
    findings: report.findings,
    metrics: report.metrics,
    runtime: report.runtime,
    nativeSummary,
    context: await perfContext({ args, projectRoot, metro, target }),
    transport: perfTransport(metroPort, target, diagnostics),
    confidence: report.confidence,
    limitations: perfDevelopmentLimitations(report.limitations),
  };
  return writePerfArtifact(args, "report", { ...payload, realValidation: perfValidation(payload, "report") }, deps);
}

export async function perfComparePayload(args: Record<string, any> = {}, deps: PerfDependencies = {}): Promise<Record<string, any>> {
  const baselinePath = resolve(requireString(args.baseline, "baseline"));
  const candidatePath = resolve(requireString(args.candidate, "candidate"));
  const baseline = await readJson(baselinePath, deps);
  const candidate = await readJson(candidatePath, deps);
  const candidateMetrics = metricMap(candidate.metrics ?? []);
  const deltas = [];
  for (const metric of baseline.metrics ?? []) {
    const next = candidateMetrics.get(metric.name);
    if (!next || typeof metric.value !== "number" || typeof next.value !== "number") continue;
    deltas.push({
      metric: metric.name,
      baseline: metric.value,
      candidate: next.value,
      delta: next.value - metric.value,
      unit: next.unit ?? metric.unit,
      improved: next.value <= metric.value,
      confidence: lowerConfidence(metric.confidence, next.confidence),
    });
  }
  return writePerfArtifact(args, "compare", {
    available: true,
    action: "compare",
    sources: ["artifact"],
    baseline: baselinePath,
    candidate: candidatePath,
    deltas,
    confidence: perfOverallConfidence(deltas.map((delta) => ({ confidence: delta.confidence }))),
    limitations: ["Comparison uses only matching metric names and does not infer user impact without workflow context."],
  }, deps);
}

export async function perfBudgetPayload(args: Record<string, any> = {}, deps: PerfDependencies = {}): Promise<Record<string, any>> {
  const subaction = requireString(args.subaction ?? "check", "subaction");
  if (subaction !== "check") throw new Error(`Unknown performance budget action: ${subaction}`);
  const budgetPath = resolve(requireString(args.file, "file"));
  const candidatePath = resolve(requireString(args.candidate, "candidate"));
  const budget = await readJson(budgetPath, deps);
  const candidate = await readJson(candidatePath, deps);
  const metrics = metricMap(candidate.metrics ?? []);
  const checks = (budget.budgets ?? []).map((rule: any) => {
    const metric = metrics.get(rule.metric);
    const value = metric?.value ?? null;
    const passed = typeof value === "number" &&
      (typeof rule.max !== "number" || value <= rule.max) &&
      (typeof rule.min !== "number" || value >= rule.min);
    return { metric: rule.metric, value, min: rule.min ?? null, max: rule.max ?? null, passed, unit: metric?.unit ?? null };
  });
  return writePerfArtifact(args, "budget", {
    available: true,
    action: "budget",
    subaction,
    sources: ["artifact"],
    file: budgetPath,
    candidate: candidatePath,
    passed: checks.every((check: any) => check.passed),
    checks,
    limitations: ["Budget checks compare numeric metrics only; choose budgets that match build mode and device context."],
  }, deps);
}

export async function perfMemoryPayload(args: Record<string, any> = {}, deps: PerfDependencies = {}): Promise<Record<string, any>> {
  const samples = clampNumber(args.samples ?? 1, 1, 100);
  const nativeArtifact = requireOptionalString(args.nativeArtifact);
  const projectRoot = await projectCwd(args.cwd, deps);
  const metrics = [perfMetric({
    name: "memory.samples",
    value: samples,
    unit: "count",
    source: nativeArtifact ? "memgraph" : "simulator",
    confidence: samples >= 2 || nativeArtifact ? "medium" : "low",
  })];
  const leakAllowed = samples >= 2 || Boolean(nativeArtifact);
  const payload = {
    available: true,
    action: "memory",
    mode: "development",
    sources: nativeArtifact ? ["native-profiler", "memgraph"] : ["simulator"],
    metrics,
    context: await perfContext({ args, projectRoot, metro: null }),
    leakClaim: {
      allowed: leakAllowed,
      reason: leakAllowed
        ? "Repeated measurements or native artifacts are present."
        : "Repeated measurements or a native memgraph artifact are required before making a memory-leak claim.",
    },
    nativeArtifact: nativeArtifact ? resolve(nativeArtifact) : null,
    confidence: perfOverallConfidence(metrics),
    limitations: perfDevelopmentLimitations(["A single memory sample is only a hint, not leak evidence."]),
  };
  return writePerfArtifact(args, "memory", { ...payload, realValidation: perfValidation(payload, "memory") }, deps);
}

export async function perfNativeProfilerPayload(args: Record<string, any> = {}, profiler: string, deps: PerfDependencies = {}): Promise<Record<string, any>> {
  const subaction = requireString(args.subaction ?? (profiler === "memgraph" ? "capture" : "stop"), "subaction");
  const allowed = profiler === "ettrace" ? ["start", "stop"] : ["capture"];
  if (!allowed.includes(subaction)) throw new Error(`Unknown ${profiler} action: ${subaction}`);
  const defaultName = profiler === "ettrace" ? "capture.trace" : "heap.memgraph";
  const nativeArtifact = resolve(args.nativeArtifact ?? join(resolveExpoStateRoot(args), "artifacts", "perf", defaultName));
  await (deps.mkdir ?? fsMkdir)(dirname(nativeArtifact), { recursive: true });
  let sampleResult: Record<string, any> | null = null;
  if (profiler === "ettrace" && subaction === "start" && args.pid !== undefined) {
    const pid = requirePid(args.pid);
    const seconds = String(clampNumber(args.seconds ?? 1, 1, 30));
    sampleResult = await execFile("sample", [String(pid), seconds, "-file", nativeArtifact], { timeout: (Number(seconds) + 20) * 1000 });
  } else if (subaction !== "start" && !(await exists(nativeArtifact, deps))) {
    await (deps.writeFile ?? fsWriteFile)(nativeArtifact, `${profiler} placeholder\n`, "utf8");
  }
  const projectRoot = await projectCwd(args.cwd, deps);
  const nativeSummary = await parseNativeSampleArtifact(nativeArtifact, deps);
  const payload = {
    available: true,
    action: profiler,
    subaction,
    profiler,
    mode: "development",
    sources: ["native-profiler"],
    nativeArtifact,
    sample: sampleResult,
    nativeSummary,
    metrics: [],
    context: await perfContext({ args, projectRoot, metro: null }),
    confidence: subaction === "start" ? "low" : "high",
    limitations: [
      `${profiler} metadata records native profiler evidence boundaries; collect and symbolicate native profiler artifacts before making native CPU or memory claims.`,
      "Native profiler workflows are heavier than routine runtime evidence and may require platform tooling outside this CLI.",
    ],
  };
  return writePerfArtifact(args, profiler, { ...payload, realValidation: perfValidation(payload, profiler) }, deps);
}

function requirePid(value: unknown): number {
  const pid = Number(value);
  if (!Number.isInteger(pid) || pid <= 0) throw new Error(`pid must be a positive integer, got ${String(value)}.`);
  return pid;
}

export async function perfBundlePayload(args: Record<string, any> = {}, deps: PerfDependencies = {}): Promise<Record<string, any>> {
  const cwd = await projectCwd(args.cwd, deps);
  const bundleArtifact = requireOptionalString(args.bundleArtifact);
  const metrics = [];
  const unavailableSources = [];
  let available = false;
  let bundlePath = null;
  if (bundleArtifact) {
    bundlePath = resolve(bundleArtifact);
    const stat = await fileStat(bundlePath, deps);
    if (stat?.isFile()) {
      available = true;
      metrics.push(perfMetric({ name: "bundle.bytes", value: stat.size, unit: "bytes", source: "metro", confidence: "high" }));
    } else {
      unavailableSources.push({ source: "bundle-artifact", reason: "Bundle artifact was not found.", path: bundlePath });
    }
  } else {
    unavailableSources.push({ source: "bundle-artifact", reason: "Pass an existing Metro/Expo bundle artifact path." });
  }
  return writePerfArtifact(args, "bundle", {
    available,
    action: "bundle",
    mode: "development",
    sources: available ? ["project", "metro"] : ["project"],
    bundleArtifact: bundlePath,
    metrics,
    unavailableSources,
    context: await perfContext({ args, projectRoot: cwd, metro: null }),
    confidence: perfOverallConfidence(metrics),
    limitations: perfDevelopmentLimitations(["Bundle byte evidence depends on the supplied artifact and does not imply release performance unless the artifact is release-like."]),
  }, deps);
}

export function metricMap(metrics: any[]): Map<string, any> {
  return new Map((metrics ?? []).map((metric) => [metric.name, metric]));
}

export function lowerConfidence(left: unknown, right: unknown): string {
  const order = ["low", "medium", "high"];
  const leftIndex = order.indexOf(String(left));
  const rightIndex = order.indexOf(String(right));
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

export function normalizePerfReport(runtimePayload: unknown, nativeSummary: Record<string, any> | null): Record<string, any> {
  const runtime = runtimePayload && typeof runtimePayload === "object" && !Array.isArray(runtimePayload) ? redactValue(runtimePayload as any) : null;
  const requests = Array.isArray((runtime as any)?.network?.requests) ? (runtime as any).network.requests : [];
  const renders = Array.isArray((runtime as any)?.renders?.commits) ? (runtime as any).renders.commits : [];
  const frames = Array.isArray((runtime as any)?.frames?.samples) ? (runtime as any).frames.samples : [];
  const findings = [];
  const slowRequests = requests
    .filter((request: any) => Number(request.durationMs) >= 500)
    .sort((a: any, b: any) => Number(b.durationMs ?? 0) - Number(a.durationMs ?? 0));
  if (slowRequests[0]) {
    findings.push({
      type: "network-latency",
      severity: Number(slowRequests[0].durationMs) >= 1000 ? "high" : "medium",
      summary: `Slow network request: ${slowRequests[0].method ?? "GET"} ${slowRequests[0].url ?? ""}`,
      evidence: { durationMs: slowRequests[0].durationMs, status: slowRequests[0].status ?? null },
    });
  }
  const worstCommit = renders.reduce((worst: any, commit: any) => Number(commit.durationMs ?? commit.actualDuration ?? 0) > Number(worst?.durationMs ?? worst?.actualDuration ?? 0) ? commit : worst, null);
  if (worstCommit && Number(worstCommit.durationMs ?? worstCommit.actualDuration ?? 0) >= 16.7) {
    findings.push({
      type: "render-cost",
      severity: Number(worstCommit.durationMs ?? worstCommit.actualDuration ?? 0) >= 50 ? "high" : "medium",
      summary: "React render commit exceeded one frame budget.",
      evidence: worstCommit,
    });
  }
  const droppedFrames = Number((runtime as any)?.frames?.droppedFrameCount ?? frames.filter((frame: any) => Number(frame.deltaMs) > 33.4).length);
  if (droppedFrames > 0) {
    findings.push({
      type: "frame-jank",
      severity: droppedFrames >= 5 ? "high" : "medium",
      summary: "Frame samples include dropped or long frames.",
      evidence: { droppedFrameCount: droppedFrames, worstFrameMs: (runtime as any)?.frames?.worstFrameMs ?? null },
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
    { name: "network.requests", value: requests.length, unit: "count", source: "network", confidence: requests.length ? "medium" : "low" },
    { name: "renders.commits", value: renders.length, unit: "count", source: "react-profiler", confidence: renders.length ? "medium" : "low" },
    { name: "frames.samples", value: frames.length, unit: "count", source: "frame-sampler", confidence: frames.length ? "medium" : "low" },
    ...(nativeSummary?.available ? [{ name: "native.sample.bytes", value: nativeSummary.bytes, unit: "bytes", source: "native-profiler", confidence: "medium" }] : []),
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

export function perfEvidenceSource(value: any): string {
  if (typeof value?.source === "string") return value.source;
  if (Array.isArray(value?.sources) && value.sources.length > 0) return value.sources[0];
  return "unknown";
}

export function perfTransport(metroPort: number, target: any, cdp: unknown = null): Record<string, any> {
  return { name: "metro-inspector-hermes-cdp", metroPort, protocol: "Runtime.evaluate", target: targetSummary(target), cdp };
}

export function perfExpression({ action, label }: { action: string; label?: unknown }): string {
  return `(() => {
    const action = ${JSON.stringify(action)};
    const label = ${JSON.stringify(label ?? null)};
    const expectedBridgeVersion = ${JSON.stringify(EXPO_IOS_BRIDGE_VERSION)};
    const pluginBridge = globalThis.__EXPO_IOS_DEVTOOLS_BRIDGE__ ||
      globalThis.__EXPO_IOS_PLUGIN_BRIDGE__ ||
      globalThis.__ROZENITE_AGENT_BRIDGE__;
    const pluginMetadata = pluginBridge?.metadata || pluginBridge?.expoIosDevtoolsBridgeMetadata || pluginBridge?.bridgeMetadata || {};
    const pluginVersion = pluginMetadata.bridgeVersion || pluginBridge?.bridgeVersion || pluginBridge?.version || null;
    const pluginPerf = pluginBridge?.performance ||
      pluginBridge?.perf ||
      (pluginBridge?.domains && !Array.isArray(pluginBridge.domains) ? (pluginBridge.domains.performance || pluginBridge.domains.perf) : null) ||
      (pluginBridge?.domainRegistry ? (pluginBridge.domainRegistry.performance || pluginBridge.domainRegistry.perf) : null);
    const pluginCallTool = typeof pluginBridge?.callTool === 'function' ? pluginBridge.callTool.bind(pluginBridge) : null;
    const callPerf = (command, payload = {}) => {
      if (pluginPerf && typeof pluginPerf[command] === 'function') return pluginPerf[command](payload);
      if (pluginPerf && pluginPerf.actions && typeof pluginPerf.actions[command] === 'function') return pluginPerf.actions[command](payload);
      if (pluginCallTool) return pluginCallTool('performance.' + command, payload);
      return null;
    };
    const hasPluginPerf = Boolean(pluginPerf || pluginCallTool || (Array.isArray(pluginBridge?.domains) && pluginBridge.domains.some((domain) => domain?.name === 'performance' || domain?.name === 'perf')));
    if (hasPluginPerf) {
      if (pluginVersion && pluginVersion !== expectedBridgeVersion) {
        return { available: false, source: 'plugin-bridge-performance', sources: ['plugin-bridge', 'rozenite-performance'], code: 'version-mismatch', bridgeVersion: pluginVersion, expectedBridgeVersion, reason: 'Performance plugin bridge version is not compatible with this CLI.', metrics: [] };
      }
      if (action === 'mark-list') return callPerf('mark-list', { label }) || callPerf('marks', { label }) || { available: true, source: 'plugin-bridge-performance', sources: ['plugin-bridge', 'rozenite-performance'], marks: pluginPerf?.marks || [], metrics: [] };
      if (action === 'mark-clear') return callPerf('mark-clear', { label }) || { available: true, source: 'plugin-bridge-performance', sources: ['plugin-bridge', 'rozenite-performance'], cleared: true, metrics: [] };
      if (action === 'measure-start') return callPerf('measure-start', { label }) || { available: true, source: 'plugin-bridge-performance', sources: ['plugin-bridge', 'rozenite-performance'], measure: { name: label, status: 'started' }, metrics: [] };
      if (action === 'measure-stop') return callPerf('measure-stop', { label }) || { available: true, source: 'plugin-bridge-performance', sources: ['plugin-bridge', 'rozenite-performance'], measure: { name: label, status: 'stopped' }, metrics: [] };
      if (action === 'js-thread') return callPerf('js-thread', { label }) || { available: false, source: 'plugin-bridge-performance', sources: ['plugin-bridge', 'rozenite-performance'], code: 'missing-metric', reason: 'JS thread evidence is not exposed by the performance plugin bridge.', metrics: [] };
      if (action === 'frames') return callPerf('frames', { label }) || { available: false, source: 'plugin-bridge-performance', sources: ['plugin-bridge', 'rozenite-performance'], code: 'missing-metric', reason: 'Frame evidence is not exposed by the performance plugin bridge.', metrics: [] };
      if (action === 'startup') return callPerf('startup', { label }) || { available: true, source: 'plugin-bridge-performance', sources: ['plugin-bridge', 'rozenite-performance'], metrics: pluginPerf?.startupMetrics || [] };
      if (action === 'action') return callPerf('action', { label }) || { available: true, source: 'plugin-bridge-performance', sources: ['plugin-bridge', 'rozenite-performance'], actionName: label, metrics: pluginPerf?.actionMetrics || [] };
    } else if (pluginBridge) {
      return { available: false, source: 'plugin-bridge-performance', sources: ['plugin-bridge'], code: 'missing-domain', reason: 'Performance bridge domain is not registered.', metrics: [] };
    }
    const expoDevtoolsPerf = globalThis.__EXPO_DEVTOOLS_PERFORMANCE__ || globalThis.__REACT_NATIVE_DEVTOOLS_PERFORMANCE__;
    if (expoDevtoolsPerf && typeof expoDevtoolsPerf === 'object') {
      const call = (command, payload = {}) => typeof expoDevtoolsPerf[command] === 'function' ? expoDevtoolsPerf[command](payload) : null;
      if (action === 'startup') return call('startup', { label }) || { available: true, source: 'expo-devtools-performance', sources: ['expo-devtools'], metrics: expoDevtoolsPerf.startupMetrics || [] };
      if (action === 'action') return call('action', { label }) || { available: true, source: 'expo-devtools-performance', sources: ['expo-devtools'], actionName: label, metrics: expoDevtoolsPerf.actionMetrics || [] };
      if (action === 'mark-list') return call('marks', { label }) || { available: true, source: 'expo-devtools-performance', sources: ['expo-devtools'], marks: expoDevtoolsPerf.marks || [], metrics: [] };
    }
    const bridge = globalThis.__EXPO_IOS_PERF_BRIDGE__ ||
      (globalThis.__EXPO_IOS_INSTRUMENTATION__ && globalThis.__EXPO_IOS_INSTRUMENTATION__.performance);
    const networkBridge = globalThis.__EXPO_IOS_NETWORK_BRIDGE__ ||
      (globalThis.__EXPO_IOS_INSTRUMENTATION__ && globalThis.__EXPO_IOS_INSTRUMENTATION__.network);
    const rnBridge = globalThis.__EXPO_IOS_RN_BRIDGE__ ||
      (globalThis.__EXPO_IOS_INSTRUMENTATION__ && globalThis.__EXPO_IOS_INSTRUMENTATION__.rn);
    const perfState = globalThis.__EXPO_IOS_PERF_STATE__ ||= { interactions: {}, frames: [], lastFrameTs: null };
    const readRequests = () => {
      try {
        const raw = networkBridge && typeof networkBridge.requests === 'function' ? networkBridge.requests({ limit: 1000 }) : networkBridge?.requests || [];
        return Array.isArray(raw) ? raw : [];
      } catch { return []; }
    };
    const readRenders = () => {
      try {
        if (bridge?.renders?.read) return bridge.renders.read();
        if (rnBridge?.renders?.read) return rnBridge.renders.read();
        return { commits: bridge?.commits || [], recording: false };
      } catch { return { commits: [], recording: false }; }
    };
    const readFrames = () => {
      try {
        if (bridge?.frames) {
          const value = typeof bridge.frames === 'function' ? bridge.frames() : bridge.frames;
          if (value && typeof value === 'object' && Array.isArray(value.samples)) return value;
        }
      } catch {}
      const samples = Array.isArray(perfState.frames) ? perfState.frames.slice(-300) : [];
      const deltas = samples.map((sample) => Number(sample.deltaMs)).filter(Number.isFinite);
      const droppedFrameCount = deltas.filter((delta) => delta > 33.4).length;
      return {
        available: samples.length > 0,
        source: 'frame-sampler',
        samples,
        sampleCount: samples.length,
        avgFps: deltas.length ? Math.round((1000 / (deltas.reduce((sum, value) => sum + value, 0) / deltas.length)) * 10) / 10 : null,
        worstFrameMs: deltas.length ? Math.max(...deltas) : null,
        droppedFrameCount,
        longFrameCount: deltas.filter((delta) => delta > 16.7).length
      };
    };
    if (typeof globalThis.requestAnimationFrame === 'function' && !perfState.rafPatched) {
      perfState.rafPatched = true;
      const originalRaf = globalThis.requestAnimationFrame.bind(globalThis);
      globalThis.requestAnimationFrame = (callback) => originalRaf((ts) => {
        if (perfState.lastFrameTs != null) {
          perfState.frames.push({ t: ts, deltaMs: Math.round((ts - perfState.lastFrameTs) * 10) / 10, interactionId: perfState.activeInteractionId || null });
          if (perfState.frames.length > 1000) perfState.frames.splice(0, perfState.frames.length - 1000);
        }
        perfState.lastFrameTs = ts;
        callback(ts);
      });
    }
    const interactionSummary = (name) => {
      const requests = readRequests();
      const renders = readRenders();
      const frames = readFrames();
      const commits = Array.isArray(renders?.commits) ? renders.commits : [];
      const networkDurationMs = requests.reduce((sum, request) => sum + (Number(request.durationMs) || 0), 0);
      const worstCommitMs = commits.reduce((max, commit) => Math.max(max, Number(commit.durationMs ?? commit.actualDuration) || 0), 0);
      const lastRequestEnd = requests.reduce((max, request) => {
        const start = Date.parse(request.startedAt || 0);
        const duration = Number(request.durationMs) || 0;
        return Number.isFinite(start) ? Math.max(max, start + duration) : max;
      }, 0);
      return { requests, renders, frames, networkDurationMs, worstCommitMs, lastRequestEnd, name };
    };
    if (action === 'interaction-start') {
      const name = label || 'interaction';
      const id = 'interaction-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
      perfState.activeInteractionId = id;
      perfState.interactions[name] = {
        id,
        name,
        startedAt: new Date().toISOString(),
        startedMs: Date.now(),
        baseline: {
          requestCount: readRequests().length,
          commitCount: (readRenders()?.commits || []).length,
          frameCount: readFrames().samples?.length || 0
        }
      };
      return { available: true, source: 'app-instrumentation', sources: ['runtime', 'app-instrumentation'], interaction: perfState.interactions[name], metrics: [] };
    }
    if (action === 'interaction-stop' || action === 'interaction-read') {
      const name = label || Object.keys(perfState.interactions).slice(-1)[0] || 'interaction';
      const interaction = perfState.interactions[name] || null;
      const summary = interactionSummary(name);
      const elapsedMs = interaction ? Date.now() - interaction.startedMs : 0;
      if (interaction && action === 'interaction-stop') {
        interaction.stoppedAt = new Date().toISOString();
        interaction.elapsedMs = elapsedMs;
        perfState.activeInteractionId = null;
      }
      const baseline = interaction?.baseline || { requestCount: 0, commitCount: 0, frameCount: 0 };
      const interactionRequests = summary.requests.slice(baseline.requestCount || 0);
      const interactionCommits = (summary.renders?.commits || []).slice(baseline.commitCount || 0);
      const interactionFrames = (summary.frames?.samples || []).slice(baseline.frameCount || 0);
      const networkDurationMs = interactionRequests.reduce((sum, request) => sum + (Number(request.durationMs) || 0), 0);
      const worstCommitMs = interactionCommits.reduce((max, commit) => Math.max(max, Number(commit.durationMs ?? commit.actualDuration) || 0), 0);
      const worstFrameMs = interactionFrames.reduce((max, frame) => Math.max(max, Number(frame.deltaMs) || 0), 0);
      const lastRequestEnd = interactionRequests.reduce((max, request) => {
        const start = Date.parse(request.startedAt || 0);
        const duration = Number(request.durationMs) || 0;
        return Number.isFinite(start) ? Math.max(max, start + duration) : max;
      }, 0);
      return {
        available: Boolean(interaction),
        source: 'app-instrumentation',
        sources: ['runtime', 'app-instrumentation'],
        interaction: { ...interaction, name, elapsedMs },
        requests: interactionRequests,
        renders: { commits: interactionCommits },
        frames: { samples: interactionFrames, worstFrameMs, droppedFrameCount: interactionFrames.filter((frame) => Number(frame.deltaMs) > 33.4).length },
        metrics: [
          { name: 'interaction.elapsed', value: elapsedMs, unit: 'ms', source: 'app-performance-mark', confidence: interaction ? 'medium' : 'low' },
          { name: 'interaction.networkDuration', value: networkDurationMs, unit: 'ms', source: 'network', confidence: interactionRequests.length ? 'medium' : 'low' },
          { name: 'interaction.commitCount', value: interactionCommits.length, unit: 'count', source: 'react-profiler', confidence: interactionCommits.length ? 'medium' : 'low' },
          { name: 'interaction.worstCommit', value: worstCommitMs, unit: 'ms', source: 'react-profiler', confidence: interactionCommits.length ? 'medium' : 'low' },
          { name: 'interaction.worstFrame', value: worstFrameMs, unit: 'ms', source: 'frame-sampler', confidence: interactionFrames.length ? 'medium' : 'low' },
          { name: 'interaction.settledAfterResponse', value: lastRequestEnd && interaction ? Math.max(0, Date.now() - lastRequestEnd) : 0, unit: 'ms', source: 'correlation', confidence: lastRequestEnd ? 'low' : 'low' }
        ]
      };
    }
    if (action === 'report') {
      const requests = readRequests();
      const renders = readRenders();
      const frames = readFrames();
      return {
        available: true,
        source: 'app-instrumentation',
        sources: ['runtime', 'app-instrumentation'],
        interaction: label || perfState.activeInteractionId || null,
        network: { requests },
        renders,
        frames,
        jsThread: bridge?.jsThread ? bridge.jsThread() : { available: false, reason: 'JS thread long-task evidence is not exposed.' },
        interactions: perfState.interactions,
        metrics: []
      };
    }
    if (!bridge) return { available: false, source: 'app-instrumentation', sources: ['runtime', 'app-instrumentation'], code: 'unavailable-bridge', reason: 'Performance bridge is not installed.', metrics: [] };
    if (action === 'mark-list') return bridge.marks ? bridge.marks() : { available: true, sources: ['runtime', 'app-instrumentation'], marks: performance.getEntriesByType ? performance.getEntriesByType('mark') : [], metrics: [] };
    if (action === 'mark-clear') return bridge.clearMarks ? bridge.clearMarks() : { available: true, sources: ['runtime', 'app-instrumentation'], cleared: true, metrics: [] };
    if (action === 'measure-start') return bridge.measureStart ? bridge.measureStart(label) : { available: true, sources: ['runtime', 'app-instrumentation'], measure: { name: label, status: 'started' }, metrics: [] };
    if (action === 'measure-stop') return bridge.measureStop ? bridge.measureStop(label) : { available: true, sources: ['runtime', 'app-instrumentation'], measure: { name: label, status: 'stopped' }, metrics: [] };
    if (action === 'js-thread') return bridge.jsThread ? bridge.jsThread() : { available: false, sources: ['runtime', 'app-instrumentation'], reason: 'JS thread evidence is not exposed by the performance bridge.', metrics: [] };
    if (action === 'frames') return bridge.frames ? bridge.frames() : { available: false, sources: ['runtime', 'app-instrumentation'], reason: 'Frame evidence is not exposed by the performance bridge.', metrics: [] };
    if (action === 'startup') return bridge.startup ? bridge.startup() : { available: true, sources: ['runtime', 'app-instrumentation'], metrics: bridge.startupMetrics || [] };
    if (action === 'action') return bridge.action ? bridge.action(label) : { available: false, sources: ['runtime', 'app-instrumentation'], actionName: label, code: 'missing-interaction-measurement', reason: 'Performance action requires interaction start/stop evidence.', metrics: bridge.actionMetrics || [] };
    return { available: false, sources: ['runtime', 'app-instrumentation'], reason: 'Unsupported performance action.', metrics: [] };
  })()`;
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

export function perfMetric({ name, value, unit, source, confidence }: Record<string, any>): Record<string, any> {
  return { name, value, unit, source, confidence };
}

export function perfOverallConfidence(metrics: Array<Record<string, any>>): string {
  if (!metrics.length) return "low";
  if (metrics.some((metric) => metric.confidence === "high")) return "high";
  if (metrics.some((metric) => metric.confidence === "medium")) return "medium";
  return "low";
}

export function perfDevelopmentLimitations(extra: unknown[] = []): string[] {
  return [
    ...extra.map(String),
    "Development-mode measurements include Metro, dev runtime, and instrumentation overhead and must not be generalized to release performance.",
  ];
}

export async function writePerfArtifact(args: Record<string, any>, action: string, payload: Record<string, any>, deps: PerfDependencies = {}): Promise<Record<string, any>> {
  const timestamp = (deps.now?.() ?? new Date()).toISOString().replace(/[:.]/g, "-");
  const artifactPath = resolve(args.outputPath ?? join(resolveExpoStateRoot(args), "artifacts", "perf", `${action}-${timestamp}.json`));
  await (deps.mkdir ?? fsMkdir)(dirname(artifactPath), { recursive: true });
  const withArtifact = { ...payload, artifacts: [...(payload.artifacts ?? []), artifactPath] };
  await writeJsonFile(artifactPath, withArtifact, deps);
  return withArtifact;
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

export function perfValidation(payload: Record<string, any>, action: string) {
  const metrics = Array.isArray(payload.metrics) ? payload.metrics : [];
  const hasNetwork = metrics.some((metric) => /network/i.test(String(metric.name)) && Number(metric.value) > 0) ||
    Array.isArray(payload.requests) && payload.requests.length > 0 ||
    Array.isArray(payload.runtime?.network?.requests) && payload.runtime.network.requests.length > 0;
  const hasRender = metrics.some((metric) => /commit|render/i.test(String(metric.name)) && Number(metric.value) > 0) ||
    Array.isArray(payload.renders?.commits) && payload.renders.commits.length > 0 ||
    Array.isArray(payload.runtime?.renders?.commits) && payload.runtime.renders.commits.length > 0;
  const hasFrames = metrics.some((metric) => /frame/i.test(String(metric.name)) && Number(metric.value) > 0 && !/available/.test(String(metric.name))) ||
    Array.isArray(payload.frames?.samples) && payload.frames.samples.length > 0 ||
    Array.isArray(payload.runtime?.frames?.samples) && payload.runtime.frames.samples.length > 0;
  const hasNative = Boolean(payload.nativeSummary?.available);
  const releaseLike = payload.context?.build?.releaseLike === true;
  const placeholderMetric = metrics.some((metric) => /available$|bridge\.available|interaction\.duration/.test(String(metric.name)) && Number(metric.value) <= 1);
  const missingEvidence = [
    ...(!hasNetwork && ["interaction", "report"].includes(action) ? [{
      signal: "network-interaction-correlation",
      reason: "No interaction-scoped network request evidence was returned.",
      recommendedFix: "Run network requests after a real interaction or mount the metadata network bridge.",
    }] : []),
    ...(!hasRender && ["interaction", "report", "action"].includes(action) ? [{
      signal: "react-profiler-commits",
      reason: "No React Profiler commit duration records were returned.",
      recommendedFix: "Mount the dev-only Profiler wrapper or run rn renders start/read/stop with bridge commit records.",
    }] : []),
    ...(!hasFrames && ["frames", "interaction", "report"].includes(action) ? [{
      signal: "frame-samples",
      reason: "No requestAnimationFrame delta samples were returned.",
      recommendedFix: "Start frame sampling before exercising the interaction and rerun perf frames/report.",
    }] : []),
    ...(!hasNative && ["ettrace", "report"].includes(action) ? [{
      signal: "native-sample-summary",
      reason: "No parseable native sample artifact was available.",
      recommendedFix: "Run profiler start with --pid, --seconds, and --native-artifact, then pass that artifact to perf report.",
    }] : []),
    ...(!releaseLike ? [{
      signal: "release-like-build",
      reason: "This evidence was collected in development mode.",
      recommendedFix: "Repeat the profile against a preview or production build before making release performance claims.",
    }] : []),
  ];
  const validated = payload.available !== false && !placeholderMetric && (
    action === "summary" ||
    action === "startup" ||
    action === "memory" ||
    action === "bundle" ||
    action === "compare" ||
    action === "budget" ||
    (action === "ettrace" && hasNative) ||
    (action === "frames" && hasFrames) ||
    (action === "report" && (hasNetwork || hasRender || hasFrames || hasNative)) ||
    (action === "interaction" && (hasNetwork || hasRender || hasFrames))
  );
  return realValidation({
    state: payload.available === false ? "unvalidated" : validated ? "validated" : "partial",
    claimsAllowed: {
      networkLatency: hasNetwork,
      networkWaterfall: hasNetwork,
      renderCost: hasRender,
      frameJank: hasFrames,
      nativeCpu: hasNative,
      releasePerformance: releaseLike && (hasNetwork || hasRender || hasFrames || hasNative),
    },
    evidence: [{
      source: perfEvidenceSource(payload),
      artifactPath: Array.isArray(payload.artifacts) ? payload.artifacts[0] : null,
      command: `perf.${action}`,
      timestamp: new Date().toISOString(),
      buildKind: payload.context?.build?.mode ?? payload.mode ?? "development",
      confidence: payload.confidence ?? perfOverallConfidence(metrics),
    }],
    missingEvidence,
  });
}

export async function parseNativeSampleArtifact(file: string, deps: Pick<PerfDependencies, "readJsonFile"> = {}): Promise<Record<string, any>> {
  const text = await readFile(file, "utf8").catch(() => null);
  if (!text) return { available: false, artifact: file, reason: "Native sample artifact was not found or unreadable." };
  const physicalFootprintMb = numberFromMatch(text, /Physical footprint:\s+([0-9.]+)M/);
  const peakFootprintMb = numberFromMatch(text, /Physical footprint \(peak\):\s+([0-9.]+)M/);
  const mainThreadSamples = numberFromMatch(text, /Call graph:\s*\n\s+(\d+)\s+Thread_[^:\n]+:\s+Main Thread/s);
  const idleSamples = countSampleBucket(text, [/mach_msg/i, /CFRunLoopServiceMachPort/i]);
  const buckets = {
    hermes: countSampleBucket(text, [/hermes/i]),
    yoga: countSampleBucket(text, [/yoga/i]),
    mounting: countSampleBucket(text, [/RCTMountingManager/i, /RCTPerformMountInstructions/i]),
    coreAnimation: countSampleBucket(text, [/QuartzCore/i, /CA::Layer/i, /CoreAnimation/i]),
    uiKit: countSampleBucket(text, [/UIKitCore/i]),
  };
  const topSymbols = [...text.matchAll(/^\s*([0-9]+)\s+(.+?)\s+\(in\s+(.+?)\)/gm)]
    .slice(0, 30)
    .map((match) => ({ samples: Number(match[1]), symbol: match[2].trim(), library: match[3].trim() }));
  return {
    available: Boolean(physicalFootprintMb || peakFootprintMb || topSymbols.length),
    artifact: file,
    bytes: Buffer.byteLength(text),
    physicalFootprintMb,
    peakFootprintMb,
    mainThreadSamples,
    estimatedMainThreadIdleSamples: idleSamples,
    estimatedMainThreadBusySamples: mainThreadSamples == null ? null : Math.max(0, mainThreadSamples - idleSamples),
    buckets,
    topSymbols,
  };
}

function numberFromMatch(text: string, pattern: RegExp): number | null {
  const match = pattern.exec(text);
  return match ? Number(match[1]) : null;
}

function countSampleBucket(text: string, patterns: RegExp[]): number {
  let count = 0;
  for (const line of text.split(/\r?\n/)) {
    if (!patterns.some((pattern) => pattern.test(line))) continue;
    const match = /^\s*[+!:| ]*\s*(\d+)\s+/.exec(line);
    count += match ? Number(match[1]) : 1;
  }
  return count;
}

export function resolveExpoStateRoot(args: StateRootArgs = {}): string {
  if (args.stateDir) {
    const resolved = resolve(args.stateDir);
    return basename(resolved) === "runs" ? resolve(join(resolved, "..")) : resolved;
  }
  const root = resolve(args.root ?? args.cwd ?? process.cwd());
  return join(root, ".scratch", "expo-ios");
}

export function requireString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${name} must be a non-empty string.`);
  return value.trim();
}

export function requireOptionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export function clampNumber(value: unknown, min: number, max: number): number {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`Expected a finite number, got ${String(value)}.`);
  return Math.min(Math.max(number, min), max);
}

async function projectCwd(cwd: unknown, deps: PerfDependencies): Promise<string> {
  if (deps.normalizeProjectCwd) {
    return Promise.resolve(deps.normalizeProjectCwd(cwd, { allowMissingPackageJson: true }))
      .catch(() => resolve(String(cwd ?? process.cwd())));
  }
  return resolve(String(cwd ?? process.cwd()));
}

async function projectSummary(cwd: string, deps: PerfDependencies): Promise<Record<string, any>> {
  return deps.expoProjectRuntimeSummary ? deps.expoProjectRuntimeSummary(cwd) : { projectRoot: cwd };
}

async function metroStatus(args: { metroPort: number }, deps: PerfDependencies): Promise<Record<string, any>> {
  return deps.metroStatusPayload ? deps.metroStatusPayload(args) : metroStatusPayload(args);
}

async function listMetroTargets(metroPort: number, deps: PerfDependencies): Promise<Array<Record<string, any>>> {
  return deps.metroTargets ? deps.metroTargets(metroPort) : metroTargets(metroPort);
}

async function evaluateHermes(url: string, expression: string, deps: PerfDependencies): Promise<Record<string, any>> {
  return deps.evaluateHermesExpression ? deps.evaluateHermesExpression(url, expression, { timeoutMs: 5000 }) : sharedEvaluateHermesExpression(url, expression, { timeoutMs: 5000 });
}

async function findUpFile(cwd: string, name: string, deps: PerfDependencies): Promise<string | null> {
  return deps.findUp ? deps.findUp(cwd, name) : null;
}

async function readJson(file: string, deps: PerfDependencies): Promise<any> {
  if (deps.readJsonFile) return deps.readJsonFile(file);
  return JSON.parse(await readFile(file, "utf8"));
}

async function writeJsonFile(file: string, value: unknown, deps: PerfDependencies): Promise<void> {
  await (deps.writeFile ?? fsWriteFile)(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function exists(path: string, deps: PerfDependencies): Promise<boolean> {
  return deps.pathExists ? deps.pathExists(path) : fsStat(path).then(() => true, () => false);
}

async function fileStat(path: string, deps: PerfDependencies): Promise<{ isFile(): boolean; size: number } | null> {
  return deps.stat ? deps.stat(path) : fsStat(path).catch(() => null);
}

function execFile(
  file: string,
  argv: string[],
  options: { timeout: number },
): Promise<{ stdout: string; stderr: string; error: null | { message: string; code?: number | string | null; signal?: string | null } }> {
  return new Promise((resolveExec) => {
    nodeExecFile(file, argv, { timeout: options.timeout, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
      resolveExec({
        stdout: String(stdout ?? ""),
        stderr: String(stderr ?? ""),
        error: error ? { message: error.message, code: error.code, signal: error.signal } : null,
      });
    });
  });
}

function redactValue(value: any): any {
  if (Array.isArray(value)) return value.map(redactValue);
  if (!value || typeof value !== "object") return value;
  const result: Record<string, any> = {};
  for (const [key, item] of Object.entries(value)) {
    if (/body|postData/i.test(key)) continue;
    result[key] = /token|authorization|cookie|password|secret|apikey/i.test(key) ? "[redacted]" : redactValue(item);
  }
  return result;
}

function firstPositional(args: Record<string, any>): unknown {
  return Array.isArray(args._) ? args._[0] : undefined;
}
