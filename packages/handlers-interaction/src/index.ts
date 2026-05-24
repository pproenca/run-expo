/**
 * `@expo98/handlers-interaction` — D6 (app/sim lifecycle) + D7
 * (interaction/gestures/wait) command handlers.
 *
 * Every device / runtime-eval action runs THROUGH `@expo98/core`'s
 * capability-injection gate: a command declares a REQUIRED typed `sideEffect`,
 * and the dispatcher provides the dangerous capability tag (`DeviceCapability` /
 * `RuntimeEvalCapability`) into the handler's Effect `R` ONLY on the gate-pass
 * branch for that class. A `read`-classed handler's `R` is `never` and literally
 * cannot name a dangerous capability (proven in the `*.type-test.ts`). This is
 * what makes AC-005 ("denial does zero xcrun/simctl") and AC-004 (`wait.fn` gated)
 * STRUCTURAL, not conventional.
 *
 * Handlers depend ONLY on core's capability tags + the pure domain/geometry
 * helpers — NEVER on `@expo98/protocols`' CDP eval surface or any subprocess
 * module directly.
 */

// ── Shared bounds + descriptor helper ──
export {
  clamp,
  DEFAULT_METRO_PORT,
  descriptor,
  MAX_PORT,
  MIN_PORT,
  resolveMetroPort
} from "./support.js"

// ── D6 lifecycle (AC-005, AC-029, AC-056) ──
export {
  type LifecycleArgs,
  lifecycle,
  lifecycleCommand,
  type LifecyclePlan,
  lifecyclePlan,
  type LifecycleResult,
  lifecycleSideEffect,
  type LifecycleVerb
} from "./lifecycle.js"

// ── Post-launch crash evidence (AC-029, AC-056) ──
export {
  type CrashAction,
  type CrashCheck,
  type CrashEvaluation,
  type CrashReport,
  type CrashReportCandidate,
  DEFAULT_CRASH_GRACE_MS,
  type EvaluateCrashInput,
  evaluateCrash,
  isCrashReportPath,
  MAX_CRASH_GRACE_MS,
  MIN_CRASH_GRACE_MS,
  resolveCrashGraceMs
} from "./crash.js"

// ── D7 interaction handlers (AC-013, AC-036, AC-037, AC-054) ──
export {
  type ClipboardArgs,
  clipboardCommand,
  type ClipboardResult,
  type ClipboardVerb,
  type GestureResult,
  gestureCommand,
  type KeyboardArgs,
  keyboardCommand,
  type KeyboardResult,
  type KeyboardVerb,
  refActionCommand,
  refActionIsPointAction,
  type RefActionArgs,
  type RefActionResult,
  type RefActionVerb,
  type ScreenshotArgs,
  screenshotCommand,
  type ScreenshotResult,
  type TapArgs,
  tapCommand,
  type TapResult
} from "./interaction.js"

// ── Pure gesture / scroll geometry (AC-036, AC-037) ──
export {
  centerOf,
  DEFAULT_DURATION_MS,
  DEFAULT_INTERVAL_MS,
  DEFAULT_MAX_EVENTS,
  DEFAULT_REPEAT,
  DEFAULT_SCROLL_AMOUNT,
  DEFAULT_SCROLL_ORIGIN,
  type GestureArgs,
  type GestureKind,
  type GesturePlan,
  MAX_DURATION_MS,
  MAX_INTERVAL_MS,
  MAX_MAX_EVENTS,
  MAX_REPEAT,
  MAX_SCROLL_AMOUNT,
  MIN_DURATION_MS,
  MIN_INTERVAL_MS,
  MIN_MAX_EVENTS,
  MIN_REPEAT,
  MIN_SCROLL_AMOUNT,
  planGesture,
  planScroll,
  pointForBox,
  resolveDurationMs,
  resolveIntervalMs as resolveGestureIntervalMs,
  resolveMaxEvents,
  resolveRepeat,
  resolveScrollAmount,
  type ScreenBox,
  type ScreenPoint,
  type ScrollArgs,
  type ScrollDirection,
  type ScrollPlan,
  scrollDelta
} from "./gesture-plan.js"

// ── Pure full-screenshot stitch geometry (AC-054) ──
export {
  DEFAULT_SEGMENTS,
  END_Y_FRACTION,
  FALLBACK_HEIGHT,
  FALLBACK_WIDTH,
  type FullScreenshotArgs,
  type FullScreenshotPlan,
  MAX_SEGMENTS,
  MIN_SEGMENTS,
  planFullScreenshot,
  resolveSegmentCount,
  type SegmentSwipe,
  START_Y_FRACTION
} from "./screenshot-geometry.js"

// ── wait (AC-004 runtime-eval gate, AC-035 cadence) ──
export {
  DEFAULT_TIMEOUT_MS as WAIT_DEFAULT_TIMEOUT_MS,
  MAX_MS,
  MAX_TIMEOUT_MS,
  MIN_MS,
  MIN_TIMEOUT_MS,
  type Predicate,
  resolveIntervalMs as resolveWaitIntervalMs,
  resolveMs,
  resolveTimeoutMs,
  tickSleepMs,
  type WaitArgs,
  waitCommand,
  type WaitDeps,
  type WaitMode,
  waitMode,
  type WaitResult,
  waitSideEffect
} from "./wait.js"
