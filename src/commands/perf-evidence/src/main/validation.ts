import { realValidation } from "../../../../core/real-validation/src/main/index.ts";
import { perfEvidenceSource, perfOverallConfidence } from "./model.js";

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
  const hasNativeArtifact = Boolean(payload.nativeSummary?.available);
  const hasNative = hasNativeArtifact && Boolean(payload.pid && payload.seconds);
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
      reason: hasNativeArtifact ? "Native sample artifact was parsed, but PID and sample duration were not attached to this evidence." : "No parseable native sample artifact was available.",
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
    (action === "report" && (hasNetwork || hasRender || hasFrames || hasNativeArtifact)) ||
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
