/**
 * `@expo98/handlers-net-perf` — D11 network-evidence + performance handlers.
 *
 * The network/perf evidence is HARVESTED over the documented read-eval CDP seam
 * (`@expo98/protocols`' `HermesEvidence.evaluateReadOnly`, a FIXED package-
 * controlled read-only expression — NOT the withheld `HermesRuntimeEval`
 * arbitrary-JS surface). Everything this package exports is the PURE
 * post-processing of an already-harvested payload, so it is tested directly and
 * exhaustively with literal inputs — no sockets are opened here.
 *
 * AC map:
 *   - AC-045  network waterfall / duplicates / HAR / `ok` derivation   → network.ts
 *   - AC-013  HAR `--output-path` confinement (FIX)                    → network.ts (confinePath)
 *   - AC-022  network shape validation (reused from protocols)         → re-exported below
 *   - AC-046  perf finding thresholds (network/render/frame)           → perf-report.ts
 *   - AC-047  frame / FPS calc at EXACT 16.67/33.33 budgets (Q#18)     → perf-frames.ts
 *   - AC-048  confidence rollup + lowerConfidence                      → perf-confidence.ts
 *   - AC-049  direction-aware compare (FIX; higher-is-better Q#15)     → perf-compare.ts
 *   - AC-050  budget fail-closed on a missing metric                   → perf-budget.ts
 *   - AC-051  memory-leak claim needs ≥2 samples or a native artifact  → perf-memory.ts
 *   - AC-052  native macOS `sample` parse (PRESERVE; version pinned)   → native-sample.ts
 */

// Shared bounds + helpers (re-exports protocols' clamp/resolveMetroPort).
export {
  clamp,
  DEFAULT_LIMIT,
  DEFAULT_SAMPLES,
  isRecord,
  MAX_LIMIT,
  MAX_SAMPLES,
  MIN_LIMIT,
  MIN_SAMPLES,
  numberOrNull,
  optionalString,
  resolveMetroPort,
  resolveSamples,
} from "./support.js"

// AC-045 + AC-013 — network derivations and HAR confinement.
export {
  buildWaterfall,
  confineHarOutputPath,
  type DuplicateGroup,
  duplicateGroups,
  HAR_VERSION,
  harFromRequests,
  type HarCreator,
  type HarDocument,
  type HarEntry,
  type HarLog,
  inferEndedAt,
  type NetworkWaterfall,
  type NormalizedNetworkRequest,
  normalizeRequest,
  normalizeRequests,
  parseUrlParts,
  type RawNetworkRequest,
  SLOW_THRESHOLD_MS,
  WATERFALL_TOP_N,
} from "./network.js"

// AC-022 — network shape validation, REUSED from protocols (not re-implemented).
export {
  type NetworkEvidenceInput,
  type NetworkEvidenceResult,
  type NetworkEvidenceValidated,
  type NetworkUnavailableCode,
  validateNetworkEvidence,
} from "@expo98/protocols"

// AC-046 — perf finding thresholds.
export {
  FRAME_DROP_MS,
  FRAME_HIGH_COUNT,
  NETWORK_HIGH_MS,
  NETWORK_SLOW_MS,
  type PerfFinding,
  type PerfSeverity,
  RENDER_FLAG_MS,
  RENDER_HIGH_MS,
  type ReportInput,
  reportFindings,
} from "./perf-report.js"

// AC-047 — frame / FPS calc (exact budgets).
export {
  FRAME_1,
  FRAME_2,
  frameDeltaMs,
  type FrameSample,
  frameStats,
  type FrameStats,
  pushFrame,
  RETAIN_WINDOW,
  round1,
  STATS_WINDOW,
} from "./perf-frames.js"

// AC-048 — confidence rollup.
export { lowerConfidence, normalizeConfidence, overallConfidence, type PerfConfidence } from "./perf-confidence.js"

// AC-049 — direction-aware compare (FIX).
export {
  type ComparisonDelta,
  comparePerfMetrics,
  HIGHER_IS_BETTER_NAMES,
  type MetricDirection,
  metricDirection,
  type PerfMetricLike,
} from "./perf-compare.js"

// AC-050 — budget fail-closed.
export { type BudgetCheck, type BudgetResult, type BudgetRule, evaluateBudget } from "./perf-budget.js"

// AC-051 — memory-leak claim gating.
export {
  evaluateMemoryEvidence,
  type LeakClaim,
  type MemoryEvidence,
  type MemoryEvidenceInput,
  MIN_SAMPLES_FOR_CLAIM,
} from "./perf-memory.js"

// AC-052 — native macOS `sample` parse (PRESERVE).
export {
  type NativeSampleBuckets,
  type NativeSampleSummary,
  type NativeSampleSymbol,
  parseNativeSample,
} from "./native-sample.js"
