import { execFile as nodeExecFile } from "node:child_process";
import { mkdir as fsMkdir, readFile, stat as fsStat, writeFile as fsWriteFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

import { evaluateHermesExpression as sharedEvaluateHermesExpression } from "../../../hermes-cdp-client/src/main/index.ts";
import { metroStatusPayload, metroTargets } from "../../../metro-probes/src/main/index.ts";

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

const PERF_ACTIONS = ["summary", "startup", "action", "bundle", "mark", "measure", "compare", "budget", "js-thread", "frames", "memory", "ettrace", "memgraph"];

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
  return {
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
  return writePerfArtifact(args, action, payload, deps);
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
  return writePerfArtifact(args, action, {
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
  }, deps);
}

export function perfBridgeAction(action: string, subaction?: string | null): string {
  if (action === "mark") return `mark-${subaction ?? "list"}`;
  if (action === "measure") return `measure-${subaction ?? "start"}`;
  return action;
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
  return writePerfArtifact(args, "memory", {
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
  }, deps);
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
  return writePerfArtifact(args, profiler, {
    available: true,
    action: profiler,
    subaction,
    profiler,
    mode: "development",
    sources: ["native-profiler"],
    nativeArtifact,
    sample: sampleResult,
    metrics: [],
    context: await perfContext({ args, projectRoot, metro: null }),
    confidence: subaction === "start" ? "low" : "high",
    limitations: [
      `${profiler} metadata records native profiler evidence boundaries; collect and symbolicate native profiler artifacts before making native CPU or memory claims.`,
      "Native profiler workflows are heavier than routine runtime evidence and may require platform tooling outside this CLI.",
    ],
  }, deps);
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
    if (!bridge) return { available: false, source: 'app-instrumentation', sources: ['runtime', 'app-instrumentation'], code: 'unavailable-bridge', reason: 'Performance bridge is not installed.', metrics: [] };
    if (action === 'mark-list') return bridge.marks ? bridge.marks() : { available: true, sources: ['runtime', 'app-instrumentation'], marks: performance.getEntriesByType ? performance.getEntriesByType('mark') : [], metrics: [] };
    if (action === 'mark-clear') return bridge.clearMarks ? bridge.clearMarks() : { available: true, sources: ['runtime', 'app-instrumentation'], cleared: true, metrics: [] };
    if (action === 'measure-start') return bridge.measureStart ? bridge.measureStart(label) : { available: true, sources: ['runtime', 'app-instrumentation'], measure: { name: label, status: 'started' }, metrics: [] };
    if (action === 'measure-stop') return bridge.measureStop ? bridge.measureStop(label) : { available: true, sources: ['runtime', 'app-instrumentation'], measure: { name: label, status: 'stopped' }, metrics: [] };
    if (action === 'js-thread') return bridge.jsThread ? bridge.jsThread() : { available: false, sources: ['runtime', 'app-instrumentation'], reason: 'JS thread evidence is not exposed by the performance bridge.', metrics: [] };
    if (action === 'frames') return bridge.frames ? bridge.frames() : { available: false, sources: ['runtime', 'app-instrumentation'], reason: 'Frame evidence is not exposed by the performance bridge.', metrics: [] };
    if (action === 'startup') return bridge.startup ? bridge.startup() : { available: true, sources: ['runtime', 'app-instrumentation'], metrics: bridge.startupMetrics || [] };
    if (action === 'action') return bridge.action ? bridge.action(label) : { available: true, sources: ['runtime', 'app-instrumentation'], actionName: label, metrics: bridge.actionMetrics || [] };
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
    result[key] = /token|authorization|cookie|password|secret|apikey/i.test(key) ? "[redacted]" : redactValue(item);
  }
  return result;
}

function firstPositional(args: Record<string, any>): unknown {
  return Array.isArray(args._) ? args._[0] : undefined;
}
