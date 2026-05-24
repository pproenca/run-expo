/**
 * Direction-aware performance comparison (AC-049 — the FIX). PURE.
 *
 * Legacy DEFECT (RULE-049): `improved = candidate ≤ baseline` for EVERY metric,
 * so an FPS GAIN (candidate > baseline) was marked NOT improved. The greenfield
 * branches on each metric's DIRECTION:
 *
 *   - HIGHER-IS-BETTER (improved iff candidate > baseline): the Q#15 set —
 *     `avgFps`, throughput / req-per-sec, and counts-of-good.
 *   - LOWER-IS-BETTER (improved iff candidate < baseline): everything else —
 *     latency, dropped/long-frame counts, footprint, etc.
 *
 * Q#15 (MODERNIZATION_BRIEF §6) fixes the higher-is-better NAME SET. We match by
 * exact name and by a small set of well-known suffixes/substrings so derived
 * metric names (e.g. `interaction.avgFps`, `network.throughput`) classify
 * correctly without hardcoding every call site.
 *
 *   - `delta = candidate − baseline`
 *   - `confidence = lowerConfidence(baseline, candidate)`
 *   - only metrics present in BOTH with NUMERIC values are compared.
 */
import { lowerConfidence, type PerfConfidence } from "./perf-confidence.js"

export type MetricDirection = "higher-is-better" | "lower-is-better"

export interface PerfMetricLike {
  readonly name: string
  readonly value: unknown
  readonly unit?: string | null
  readonly confidence?: unknown
}

export interface ComparisonDelta {
  readonly metric: string
  readonly baseline: number
  readonly candidate: number
  readonly delta: number
  readonly unit: string | null
  readonly direction: MetricDirection
  readonly improved: boolean
  readonly confidence: PerfConfidence
}

/**
 * The Q#15 higher-is-better metric set (exact names). Anything not classified
 * here (nor by the substring rules below) is lower-is-better. PURE data.
 */
export const HIGHER_IS_BETTER_NAMES: ReadonlySet<string> = new Set([
  "avgFps",
  "fps",
  "throughput",
  "requestsPerSecond",
  "reqPerSec",
  "goodFrameCount",
  "goodCount"
])

/**
 * Substrings (case-insensitive) that mark a derived metric name as
 * higher-is-better: `avgfps`/`fps`, `throughput`, `per-sec`/`persec`/`req-per-sec`,
 * and `counts-of-good` (`good` + `count`/`frames`). PURE.
 */
const higherIsBetterByShape = (name: string): boolean => {
  const lower = name.toLowerCase()
  if (lower.includes("avgfps") || lower.endsWith("fps") || lower.includes(".fps")) {
    return true
  }
  if (lower.includes("throughput")) {
    return true
  }
  if (lower.includes("persec") || lower.includes("per-sec") || lower.includes("per_sec")) {
    return true
  }
  // counts-of-good: a "good"-prefixed count is a higher-is-better signal.
  if (lower.includes("good") && (lower.includes("count") || lower.includes("frames"))) {
    return true
  }
  return false
}

/**
 * Classify a metric name's optimisation direction (AC-049 / Q#15). PURE.
 * Higher-is-better when in the exact set OR matched by shape; else lower-is-better.
 */
export const metricDirection = (name: string): MetricDirection =>
  HIGHER_IS_BETTER_NAMES.has(name) || higherIsBetterByShape(name)
    ? "higher-is-better"
    : "lower-is-better"

/** Build a name→metric map, last-wins on duplicate names (legacy `metricMap`). PURE. */
const metricMap = (
  metrics: ReadonlyArray<PerfMetricLike>
): ReadonlyMap<string, PerfMetricLike> => {
  const map = new Map<string, PerfMetricLike>()
  for (const metric of metrics) {
    map.set(metric.name, metric)
  }
  return map
}

/**
 * Compare candidate metrics against baseline, direction-aware (AC-049). PURE.
 *
 * For each baseline metric with a numeric value whose name also exists in the
 * candidate with a numeric value:
 *   - `delta = candidate − baseline`
 *   - `improved` per `metricDirection(name)`:
 *       higher-is-better → candidate > baseline
 *       lower-is-better  → candidate < baseline
 *   - `confidence = lowerConfidence(baseline.confidence, candidate.confidence)`
 *
 * (An equal value is NOT an improvement under either direction — this also
 * corrects the legacy `≤`, which counted "no change" as improved.)
 */
export const comparePerfMetrics = (
  baseline: ReadonlyArray<PerfMetricLike>,
  candidate: ReadonlyArray<PerfMetricLike>
): ReadonlyArray<ComparisonDelta> => {
  const candidateMetrics = metricMap(candidate)
  const deltas: Array<ComparisonDelta> = []
  for (const base of baseline) {
    const next = candidateMetrics.get(base.name)
    if (next === undefined) {
      continue
    }
    if (typeof base.value !== "number" || typeof next.value !== "number") {
      continue
    }
    const direction = metricDirection(base.name)
    const improved =
      direction === "higher-is-better" ? next.value > base.value : next.value < base.value
    deltas.push({
      metric: base.name,
      baseline: base.value,
      candidate: next.value,
      delta: next.value - base.value,
      unit: next.unit ?? base.unit ?? null,
      direction,
      improved,
      confidence: lowerConfidence(base.confidence, next.confidence)
    })
  }
  return deltas
}
