import { toolJson } from "../../../../core/tool-json-envelope/src/main/index.ts";
import {
  perfBudgetPayload,
  perfBundlePayload,
  perfComparePayload,
  perfInstrumentedPayload,
  perfInteractionPayload,
  perfMemoryPayload,
  perfNativeProfilerPayload,
  perfReportPayload,
  perfRuntimePayload,
  perfSummaryPayload,
} from "./actions.js";
import { firstPositional, requireString } from "./common.js";
import { PERF_ACTIONS, type PerfDependencies, type ToolTextResult } from "./types.js";

export { toolJson };
export type { PerfDependencies, StateRootArgs, ToolTextResult } from "./types.js";
export { PERF_ACTIONS } from "./types.js";
export {
  perfBudgetPayload,
  perfBundlePayload,
  perfComparePayload,
  perfInstrumentedPayload,
  perfInteractionPayload,
  perfMemoryPayload,
  perfNativeProfilerPayload,
  perfReportPayload,
  perfRuntimePayload,
  perfSummaryPayload,
} from "./actions.js";
export { parseNativeSampleArtifact, writePerfArtifact } from "./artifacts.js";
export {
  clampNumber,
  requireOptionalString,
  requireString,
  resolveExpoStateRoot,
} from "./common.js";
export {
  lowerConfidence,
  metricMap,
  normalizePerfBridgePayload,
  normalizePerfBuildKind,
  normalizePerfReport,
  perfContext,
  perfDevelopmentLimitations,
  perfEvidenceSource,
  perfMetric,
  perfOverallConfidence,
  perfTransport,
  targetSummary,
} from "./model.js";
export { perfBridgeAction, perfExpression } from "./runtime-bridge.js";
export { perfValidation } from "./validation.js";

export async function perfCommand(
  args: Record<string, any> = {},
  deps: PerfDependencies = {},
): Promise<ToolTextResult> {
  const action = requireString(args.action ?? firstPositional(args) ?? "summary", "action");
  if (!PERF_ACTIONS.includes(action)) throw new Error(`Unknown performance action: ${action}`);
  if (action === "summary") return toolJson(await perfSummaryPayload(args, deps));
  if (action === "bundle") return toolJson(await perfBundlePayload(args, deps));
  if (action === "compare") return toolJson(await perfComparePayload(args, deps));
  if (action === "budget") return toolJson(await perfBudgetPayload(args, deps));
  if (action === "memory") return toolJson(await perfMemoryPayload(args, deps));
  if (action === "ettrace" || action === "memgraph")
    return toolJson(await perfNativeProfilerPayload(args, action, deps));
  if (action === "interaction") return toolJson(await perfInteractionPayload(args, deps));
  if (action === "report") return toolJson(await perfReportPayload(args, deps));
  if (["mark", "measure", "js-thread", "frames"].includes(action))
    return toolJson(await perfInstrumentedPayload(args, action, deps));
  return toolJson(await perfRuntimePayload(args, action, deps));
}
