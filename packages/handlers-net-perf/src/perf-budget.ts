/**
 * Performance budget evaluation — FAIL-CLOSED on a missing metric (AC-050). PURE.
 *
 *   - per rule: `value = candidate metric value when numeric, else null`.
 *   - `passed = value is number
 *               && (max === undefined || value ≤ max)
 *               && (min === undefined || value ≥ min)`.
 *   - a MISSING metric → `value = null` → `passed = false` (fail-closed).
 *   - overall `passed = checks.every(check.passed)`. An EMPTY rule set passes
 *     vacuously (`[].every === true`) — matching the legacy `every`.
 */
import type { PerfMetricLike } from "./perf-compare.js"

export interface BudgetRule {
  readonly metric: string
  readonly min?: number
  readonly max?: number
}

export interface BudgetCheck {
  readonly metric: string
  readonly value: number | null
  readonly min: number | null
  readonly max: number | null
  readonly passed: boolean
  readonly unit: string | null
}

export interface BudgetResult {
  readonly passed: boolean
  readonly checks: ReadonlyArray<BudgetCheck>
}

/** Build a name→metric map (last-wins). PURE. */
const metricMap = (metrics: ReadonlyArray<PerfMetricLike>): ReadonlyMap<string, PerfMetricLike> => {
  const map = new Map<string, PerfMetricLike>()
  for (const metric of metrics) {
    map.set(metric.name, metric)
  }
  return map
}

/**
 * Evaluate a budget against candidate metrics (AC-050). PURE.
 * A rule whose metric is absent (or non-numeric) gets `value = null` and FAILS.
 */
export const evaluateBudget = (
  rules: ReadonlyArray<BudgetRule>,
  candidate: ReadonlyArray<PerfMetricLike>,
): BudgetResult => {
  const metrics = metricMap(candidate)
  const checks: Array<BudgetCheck> = rules.map((rule) => {
    const metric = metrics.get(rule.metric)
    const value = typeof metric?.value === "number" ? (metric.value as number) : null
    const passed =
      typeof value === "number" &&
      (rule.max === undefined || value <= rule.max) &&
      (rule.min === undefined || value >= rule.min)
    return {
      metric: rule.metric,
      value,
      min: rule.min ?? null,
      max: rule.max ?? null,
      passed,
      unit: metric?.unit ?? null,
    }
  })
  return { passed: checks.every((check) => check.passed), checks }
}
