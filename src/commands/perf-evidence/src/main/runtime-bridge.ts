import { clampNumber } from "./common.js";
import { writePerfArtifact } from "./artifacts.js";
import { evaluateHermes, listMetroTargets, metroStatus, projectCwd } from "./dependencies.js";
import {
  normalizePerfBridgePayload,
  perfContext,
  perfDevelopmentLimitations,
  perfEvidenceSource,
  perfOverallConfidence,
  perfTransport,
  targetSummary,
} from "./model.js";
import { redactPerfValue } from "./redaction.js";
import { perfValidation } from "./validation.js";
import { EXPO_IOS_BRIDGE_VERSION, type PerfDependencies } from "./types.js";

export interface RuntimeBridgeEvidence {
  metroPort: number;
  targets: Array<Record<string, any>>;
  target: Record<string, any> | null;
  projectRoot: string;
  metro: Record<string, any>;
  bridgePayload: unknown;
  diagnostics: unknown;
}

export async function collectRuntimeBridgeEvidence(
  args: Record<string, any>,
  deps: PerfDependencies,
  expression: { action: string; label?: unknown },
): Promise<RuntimeBridgeEvidence> {
  const metroPort = clampNumber(args.metroPort ?? 8081, 1, 65_535);
  const targets = await listMetroTargets(metroPort, deps);
  const target = targets[0] ?? null;
  const projectRoot = await projectCwd(args.cwd, deps);
  const metro = target
    ? { available: true, metroPort, status: "available", statusText: null, targetCount: targets.length, targets: targets.map(targetSummary) }
    : await metroStatus({ metroPort }, deps);
  let bridgePayload = null;
  let diagnostics = null;
  if (target?.webSocketDebuggerUrl) {
    const result = await evaluateHermes(String(target.webSocketDebuggerUrl), perfExpression(expression), deps);
    bridgePayload = result?.result?.result?.value ?? null;
    diagnostics = result?.diagnostics ?? null;
  }
  return { metroPort, targets, target, projectRoot, metro, bridgePayload, diagnostics };
}

export async function writeRuntimePerfArtifact(
  args: Record<string, any>,
  deps: PerfDependencies,
  options: {
    artifactAction: string;
    bridgeAction: string;
    normalizeAction: string;
    label?: unknown;
    unavailableReason?: string;
    extraFields?: (basePayload: Record<string, any>, evidence: RuntimeBridgeEvidence) => Record<string, any>;
  },
): Promise<Record<string, any>> {
  const evidence = await collectRuntimeBridgeEvidence(args, deps, { action: options.bridgeAction, label: options.label });
  const basePayload = evidence.bridgePayload && typeof evidence.bridgePayload === "object"
    ? normalizePerfBridgePayload(redactPerfValue(evidence.bridgePayload), options.normalizeAction)
    : {
        available: false,
        sources: ["runtime", "app-instrumentation"],
        metrics: [],
        code: evidence.target ? "malformed-payload" : "no-runtime-target",
        reason: evidence.target ? options.unavailableReason ?? "Performance bridge did not return a value." : "No Metro inspector target.",
      };
  const payload = {
    ...basePayload,
    action: options.artifactAction,
    ...(options.extraFields?.(basePayload, evidence) ?? {}),
    mode: "development",
    context: await perfContext({ args, projectRoot: evidence.projectRoot, metro: evidence.metro, target: evidence.target }),
    transport: perfTransport(evidence.metroPort, evidence.target, evidence.diagnostics),
    evidenceSource: perfEvidenceSource(basePayload),
    confidence: perfOverallConfidence(basePayload.metrics ?? []),
    limitations: perfDevelopmentLimitations(basePayload.limitations),
  };
  return writePerfArtifact(args, options.artifactAction, { ...payload, realValidation: perfValidation(payload, options.artifactAction) }, deps);
}

export function perfBridgeAction(action: string, subaction?: string | null): string {
  if (action === "mark") return `mark-${subaction ?? "list"}`;
  if (action === "measure") return `measure-${subaction ?? "start"}`;
  if (action === "interaction") return `interaction-${subaction ?? "read"}`;
  return action;
}

export function perfExpression({ action, label }: { action: string; label?: unknown }): string {
  return runtimeProgram([
    perfRuntimeInputs(action, label),
    perfPluginBridgeSection(),
    perfExpoDevtoolsSection(),
    perfInstrumentationSetupSection(),
    perfInteractionSection(),
    perfActionDispatchSection(),
  ]);
}

function runtimeProgram(sections: string[]): string {
  return `(() => {\n${sections.join("\n")}\n  })()`;
}

function perfRuntimeInputs(action: string, label: unknown): string {
  return `    const action = ${JSON.stringify(action)};
    const label = ${JSON.stringify(label ?? null)};
    const expectedBridgeVersion = ${JSON.stringify(EXPO_IOS_BRIDGE_VERSION)};`;
}

function perfPluginBridgeSection(): string {
  return `    const pluginBridge = globalThis.__EXPO_IOS_DEVTOOLS_BRIDGE__ ||
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
    }`;
}

function perfExpoDevtoolsSection(): string {
  return `    const expoDevtoolsPerf = globalThis.__EXPO_DEVTOOLS_PERFORMANCE__ || globalThis.__REACT_NATIVE_DEVTOOLS_PERFORMANCE__;
    if (expoDevtoolsPerf && typeof expoDevtoolsPerf === 'object') {
      const call = (command, payload = {}) => typeof expoDevtoolsPerf[command] === 'function' ? expoDevtoolsPerf[command](payload) : null;
      if (action === 'startup') return call('startup', { label }) || { available: true, source: 'expo-devtools-performance', sources: ['expo-devtools'], metrics: expoDevtoolsPerf.startupMetrics || [] };
      if (action === 'action') return call('action', { label }) || { available: true, source: 'expo-devtools-performance', sources: ['expo-devtools'], actionName: label, metrics: expoDevtoolsPerf.actionMetrics || [] };
      if (action === 'mark-list') return call('marks', { label }) || { available: true, source: 'expo-devtools-performance', sources: ['expo-devtools'], marks: expoDevtoolsPerf.marks || [], metrics: [] };
    }`;
}

function perfInstrumentationSetupSection(): string {
  return `    const bridge = globalThis.__EXPO_IOS_PERF_BRIDGE__ ||
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
    const startRenders = () => {
      try {
        if (bridge?.renders?.start) return bridge.renders.start();
        if (rnBridge?.renders?.start) return rnBridge.renders.start();
      } catch {}
      return null;
    };
    const stopRenders = () => {
      try {
        if (bridge?.renders?.stop) return bridge.renders.stop();
        if (rnBridge?.renders?.stop) return rnBridge.renders.stop();
      } catch {}
      return null;
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
    };`;
}

function perfInteractionSection(): string {
  return `    if (action === 'interaction-start') {
      const name = label || 'interaction';
      const id = 'interaction-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
      startRenders();
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
        stopRenders();
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
          { name: 'interaction.settledAfterResponse', value: lastRequestEnd && interaction ? Math.max(0, Date.now() - lastRequestEnd) : 0, unit: 'ms', source: 'correlation', confidence: 'low' }
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
    }`;
}

function perfActionDispatchSection(): string {
  return `    if (!bridge) return { available: false, source: 'app-instrumentation', sources: ['runtime', 'app-instrumentation'], code: 'unavailable-bridge', reason: 'Performance bridge is not installed.', metrics: [] };
    if (action === 'mark-list') return bridge.marks ? bridge.marks() : { available: true, sources: ['runtime', 'app-instrumentation'], marks: performance.getEntriesByType ? performance.getEntriesByType('mark') : [], metrics: [] };
    if (action === 'mark-clear') return bridge.clearMarks ? bridge.clearMarks() : { available: true, sources: ['runtime', 'app-instrumentation'], cleared: true, metrics: [] };
    if (action === 'measure-start') return bridge.measureStart ? bridge.measureStart(label) : { available: true, sources: ['runtime', 'app-instrumentation'], measure: { name: label, status: 'started' }, metrics: [] };
    if (action === 'measure-stop') return bridge.measureStop ? bridge.measureStop(label) : { available: true, sources: ['runtime', 'app-instrumentation'], measure: { name: label, status: 'stopped' }, metrics: [] };
    if (action === 'js-thread') return bridge.jsThread ? bridge.jsThread() : { available: false, sources: ['runtime', 'app-instrumentation'], reason: 'JS thread evidence is not exposed by the performance bridge.', metrics: [] };
    if (action === 'frames') return bridge.frames ? bridge.frames() : { available: false, sources: ['runtime', 'app-instrumentation'], reason: 'Frame evidence is not exposed by the performance bridge.', metrics: [] };
    if (action === 'startup') return bridge.startup ? bridge.startup() : { available: true, sources: ['runtime', 'app-instrumentation'], metrics: bridge.startupMetrics || [] };
    if (action === 'action') return bridge.action ? bridge.action(label) : { available: false, sources: ['runtime', 'app-instrumentation'], actionName: label, code: 'missing-interaction-measurement', reason: 'Performance action requires interaction start/stop evidence.', metrics: bridge.actionMetrics || [] };
    return { available: false, sources: ['runtime', 'app-instrumentation'], reason: 'Unsupported performance action.', metrics: [] };`;
}
