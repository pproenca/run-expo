/**
 * Performance confidence rollup (AC-048). PURE.
 *
 *   - `overallConfidence(signals)`: empty/none → `low`; any `high` → `high`;
 *     else any `medium` → `medium`; else `low`.
 *   - `lowerConfidence(a, b)`: the WEAKER (lower) of two confidences; an
 *     unrecognised value normalises to `low`.
 */

export type PerfConfidence = "low" | "medium" | "high"

/** The order used for rank comparisons. */
const ORDER: ReadonlyArray<PerfConfidence> = ["low", "medium", "high"]

/** Normalise an arbitrary value to a `PerfConfidence` (unknown → `low`). PURE. */
export const normalizeConfidence = (value: unknown): PerfConfidence =>
  value === "high" || value === "medium" || value === "low" ? value : "low"

/**
 * The highest confidence present, else `low` (AC-048). Empty → `low`.
 * Accepts any object carrying a `confidence` field (e.g. a metric or a delta).
 */
export const overallConfidence = (
  signals: ReadonlyArray<{ readonly confidence: unknown }>
): PerfConfidence => {
  if (signals.length === 0) {
    return "low"
  }
  if (signals.some((signal) => normalizeConfidence(signal.confidence) === "high")) {
    return "high"
  }
  if (signals.some((signal) => normalizeConfidence(signal.confidence) === "medium")) {
    return "medium"
  }
  return "low"
}

/** The weaker (lower) of two confidences (AC-048). Unknown → `low`. PURE. */
export const lowerConfidence = (left: unknown, right: unknown): PerfConfidence => {
  const leftIndex = ORDER.indexOf(normalizeConfidence(left))
  const rightIndex = ORDER.indexOf(normalizeConfidence(right))
  // indexOf is always ≥ 0 here because normalizeConfidence returns a valid member.
  return ORDER[Math.min(leftIndex, rightIndex)] ?? "low"
}
