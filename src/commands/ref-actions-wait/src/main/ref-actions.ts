import { defaultRefActionDependencies } from "./defaults.js";
import type { RefActionDependencies } from "./domain.js";
import { planRefActionWithDeps, refPointWithDeps, scrollPlanWithDeps } from "./planning.js";

/**
 * RULE-008 and RULE-020: ref actions fail closed for missing/stale/unsupported
 * refs, and point actions use the center of cached bounds.
 */
export function planRefAction(
  args: Record<string, unknown>,
  deps: RefActionDependencies = defaultRefActionDependencies,
): Promise<Record<string, unknown>> {
  return planRefActionWithDeps(args, deps);
}

export function refPoint(
  refValue: unknown,
  deps: RefActionDependencies = defaultRefActionDependencies,
): Promise<Record<string, unknown>> {
  return refPointWithDeps(refValue, deps);
}

export function scrollPlan(
  args: Record<string, unknown>,
  deps: RefActionDependencies = defaultRefActionDependencies,
): Promise<Record<string, unknown>> {
  return scrollPlanWithDeps(args, deps);
}
