/**
 * `@expo98/handlers-devtools` — D10 runtime/devtools command handlers.
 *
 * Lands AC-010 (`trace`) and AC-011 (`inspector`) END-TO-END through
 * `@expo98/core`'s capability-injection gate, plus AC-007 (`navigation`) and
 * AC-039 (`console`/`errors`). Every handler is built with core's `command`
 * helper, declaring a REQUIRED typed `sideEffect`; it reaches a dangerous
 * capability ONLY because its class entitles it and the dispatcher provided that
 * capability into `R` on the gate-pass branch.
 *
 * Handlers depend ONLY on core's `RuntimeEvalCapability` / `DeviceCapability`
 * tags — never on `@expo98/protocols`' CDP eval surface (`HermesRuntimeEval`)
 * directly. That structural rule is what makes the legacy ungated-runtime-eval
 * defect impossible to re-introduce here.
 */

// trace (AC-010) — all verbs runtime-eval
export { type TraceArgs, type TraceResult, type TraceVerb, traceCommand, traceSideEffect } from "./trace.js"

// inspector (AC-011) — verbs map to read / runtime-eval / device
export {
  type InspectorCommand,
  inspectorCommand,
  type InspectorDeviceVerb,
  type InspectorEvalVerb,
  type InspectorReadVerb,
  type InspectorResult,
  type InspectorSideEffect,
  inspectorSideEffect,
  type InspectorVerb,
} from "./inspector.js"

// navigation (AC-007) — state read, mutations device
export {
  type NavigationArgs,
  type NavigationCommand,
  navigationCommand,
  type NavigationDeviceVerb,
  type NavigationReadVerb,
  type NavigationResult,
  type NavigationSideEffect,
  navigationSideEffect,
  type NavigationVerb,
} from "./navigation.js"

// console / errors (AC-039) — read, clamped, last-N
export { type LogArgs, type LogEntry, type LogResult, type LogStream, logsCommand } from "./logs.js"

// shared bounds (canonical clamp params for AC-010/038/039)
export {
  DEFAULT_LIMIT,
  DEFAULT_MAX_EVENTS,
  DEFAULT_METRO_PORT,
  EVAL_TIMEOUT_MS,
  MAX_LIMIT,
  MAX_MAX_EVENTS,
  MAX_PORT,
  MIN_LIMIT,
  MIN_MAX_EVENTS,
  MIN_PORT,
  resolveLimit,
  resolveMaxEvents,
  resolveMetroPort,
  takeLast,
} from "./support.js"
