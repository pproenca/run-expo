import { mkdir as fsMkdir, writeFile as fsWriteFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { parseNativeSampleArtifact, writePerfArtifact } from "./artifacts.js";
import { clampNumber, requireOptionalString, requireString, resolveExpoStateRoot } from "./common.js";
import { execFile, exists, fileStat, findUpFile, metroStatus, projectCwd, projectSummary, readJson } from "./dependencies.js";
import { collectRuntimeBridgeEvidence, perfBridgeAction, writeRuntimePerfArtifact } from "./runtime-bridge.js";
import {
  lowerConfidence,
  metricMap,
  normalizePerfReport,
  perfContext,
  perfDevelopmentLimitations,
  perfMetric,
  perfOverallConfidence,
  perfTransport,
} from "./model.js";
import { perfValidation } from "./validation.js";
import type {
  PerfArgs,
  PerfBudgetArtifact,
  PerfBudgetCheck,
  PerfComparisonDelta,
  PerfDependencies,
  PerfMetric,
  PerfPayload,
} from "./types.js";

export async function perfSummaryPayload(args: PerfArgs = {}, deps: PerfDependencies = {}): Promise<PerfPayload> {
  const cwd = await projectCwd(args.cwd, deps);
  const summary = await projectSummary(cwd, deps);
  const metroPort = clampNumber(args.metroPort ?? 8081, 1, 65_535);
  const metro = await metroStatus({ metroPort }, deps);
  const metrics: PerfMetric[] = [];
  const unavailableSources = [];
  const packageJsonPath = await findUpFile(summary.projectRoot, "package.json", deps);
  if (packageJsonPath) {
    const packageJson = asRecord(await readJson(packageJsonPath, deps)) ?? {};
    const dependencies = asRecord(packageJson.dependencies) ?? {};
    const devDependencies = asRecord(packageJson.devDependencies) ?? {};
    metrics.push(perfMetric({
      name: "project.dependencies",
      value: Object.keys({ ...dependencies, ...devDependencies }).length,
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

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export async function perfRuntimePayload(args: PerfArgs = {}, action: string, deps: PerfDependencies = {}): Promise<PerfPayload> {
  return writeRuntimePerfArtifact(args, deps, {
    artifactAction: action,
    bridgeAction: action,
    normalizeAction: action,
    label: args.label,
    extraFields: () => action === "action" ? { actionName: requireString(args.label, "label") } : {},
  });
}

export async function perfInstrumentedPayload(args: PerfArgs = {}, action: string, deps: PerfDependencies = {}): Promise<PerfPayload> {
  const subaction = requireOptionalString(args.subaction);
  const label = requireOptionalString(args.label);
  const bridgeAction = perfBridgeAction(action, subaction);
  return writeRuntimePerfArtifact(args, deps, {
    artifactAction: action,
    bridgeAction,
    normalizeAction: action,
    label,
    extraFields: () => ({ subaction, bridgeAction }),
  });
}

export async function perfInteractionPayload(args: PerfArgs = {}, deps: PerfDependencies = {}): Promise<PerfPayload> {
  const subaction = requireString(args.subaction ?? "read", "subaction");
  if (!["start", "stop", "read"].includes(subaction)) throw new Error(`Unknown performance interaction action: ${subaction}`);
  const label = requireOptionalString(args.label ?? args.interaction);
  return writeRuntimePerfArtifact(args, deps, {
    artifactAction: "interaction",
    bridgeAction: `interaction-${subaction}`,
    normalizeAction: "interaction",
    label,
    unavailableReason: "Performance interaction bridge did not return a value.",
    extraFields: () => ({ subaction, interaction: label }),
  });
}

export async function perfReportPayload(args: PerfArgs = {}, deps: PerfDependencies = {}): Promise<PerfPayload> {
  const nativeArtifact = requireOptionalString(args.nativeArtifact);
  const evidence = await collectRuntimeBridgeEvidence(args, deps, { action: "report", label: args.interaction ?? args.label });
  const nativeSummary = nativeArtifact ? await parseNativeSampleArtifact(resolve(nativeArtifact)) : null;
  const report = normalizePerfReport(evidence.bridgePayload, nativeSummary);
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
    context: await perfContext({ args, projectRoot: evidence.projectRoot, metro: evidence.metro, target: evidence.target }),
    transport: perfTransport(evidence.metroPort, evidence.target, evidence.diagnostics),
    confidence: report.confidence,
    limitations: perfDevelopmentLimitations(report.limitations),
  };
  return writePerfArtifact(args, "report", { ...payload, realValidation: perfValidation(payload, "report") }, deps);
}


export async function perfComparePayload(args: PerfArgs = {}, deps: PerfDependencies = {}): Promise<PerfPayload> {
  const baselinePath = resolve(requireString(args.baseline, "baseline"));
  const candidatePath = resolve(requireString(args.candidate, "candidate"));
  const baseline = await readJson(baselinePath, deps) as PerfPayload;
  const candidate = await readJson(candidatePath, deps) as PerfPayload;
  const candidateMetrics = metricMap(candidate.metrics ?? []);
  const deltas: PerfComparisonDelta[] = [];
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

export async function perfBudgetPayload(args: PerfArgs = {}, deps: PerfDependencies = {}): Promise<PerfPayload> {
  const subaction = requireString(args.subaction ?? "check", "subaction");
  if (subaction !== "check") throw new Error(`Unknown performance budget action: ${subaction}`);
  const budgetPath = resolve(requireString(args.file, "file"));
  const candidatePath = resolve(requireString(args.candidate, "candidate"));
  const budget = await readJson(budgetPath, deps) as PerfBudgetArtifact;
  const candidate = await readJson(candidatePath, deps) as PerfPayload;
  const metrics = metricMap(candidate.metrics ?? []);
  const checks: PerfBudgetCheck[] = (budget.budgets ?? []).map((rule) => {
    const metric = metrics.get(rule.metric);
    const value = typeof metric?.value === "number" ? metric.value : null;
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
    passed: checks.every((check) => check.passed),
    checks,
    limitations: ["Budget checks compare numeric metrics only; choose budgets that match build mode and device context."],
  }, deps);
}

export async function perfMemoryPayload(args: PerfArgs = {}, deps: PerfDependencies = {}): Promise<PerfPayload> {
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

export async function perfNativeProfilerPayload(args: PerfArgs = {}, profiler: string, deps: PerfDependencies = {}): Promise<PerfPayload> {
  const subaction = requireString(args.subaction ?? (profiler === "memgraph" ? "capture" : "stop"), "subaction");
  const allowed = profiler === "ettrace" ? ["start", "stop"] : ["capture"];
  if (!allowed.includes(subaction)) throw new Error(`Unknown ${profiler} action: ${subaction}`);
  const defaultName = profiler === "ettrace" ? "capture.trace" : "heap.memgraph";
  const nativeArtifact = resolve(String(args.nativeArtifact ?? join(resolveExpoStateRoot(args), "artifacts", "perf", defaultName)));
  await (deps.mkdir ?? fsMkdir)(dirname(nativeArtifact), { recursive: true });
  let sampleResult: unknown = null;
  let samplePid: number | null = null;
  let sampleSeconds: number | null = null;
  if (profiler === "ettrace" && subaction === "start" && args.pid !== undefined) {
    const pid = requirePid(args.pid);
    samplePid = pid;
    const seconds = String(clampNumber(args.seconds ?? 1, 1, 30));
    sampleSeconds = Number(seconds);
    sampleResult = await execFile("sample", [String(pid), seconds, "-file", nativeArtifact], { timeout: (Number(seconds) + 20) * 1000 });
  } else if (subaction !== "start" && !(await exists(nativeArtifact, deps))) {
    await (deps.writeFile ?? fsWriteFile)(nativeArtifact, `${profiler} placeholder\n`, "utf8");
  }
  const projectRoot = await projectCwd(args.cwd, deps);
  const nativeSummary = await parseNativeSampleArtifact(nativeArtifact);
  const payload = {
    available: true,
    action: profiler,
    subaction,
    profiler,
    mode: "development",
    sources: ["native-profiler"],
    nativeArtifact,
    pid: samplePid,
    seconds: sampleSeconds,
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

export async function perfBundlePayload(args: PerfArgs = {}, deps: PerfDependencies = {}): Promise<PerfPayload> {
  const cwd = await projectCwd(args.cwd, deps);
  const bundleArtifact = requireOptionalString(args.bundleArtifact);
  const metrics: PerfMetric[] = [];
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
