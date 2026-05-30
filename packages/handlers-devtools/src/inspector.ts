/**
 * `inspector` — D10 in-app inspector / comment menu (AC-011, the FIX).
 *
 * The interesting case: ONE command name whose verbs map to THREE different
 * side-effect classes. The legacy gated only `open-dev-menu`; the shared
 * `evaluateHermesExpression` path ran injected JS ungated for everything else
 * (CWE-862/94). Here each verb is classified explicitly:
 *
 *   - `probe`, `read-comments`            → `read`          (no capability; ungated)
 *   - `install-comment-menu`,
 *     `clear-comments`, `toggle`          → `runtime-eval`  (gated; mutates the
 *                                                            runtime global
 *                                                            `__CODEX_SIMULATOR_REVIEW__`)
 *   - `open-dev-menu`                      → `device`        (gated)
 *
 * The verb→class map is `Match.exhaustive`, so a new verb without a class is a
 * COMPILE error. Each verb produces a `Command<S, …>` whose handler `R` is bounded
 * to exactly `CapabilityFor<S>` — a `read` verb's handler is `R = never` and
 * literally cannot name the eval capability.
 */
import { CliRuntimeError, command, type Command, DeviceCapability, RuntimeEvalCapability } from "@expo98/core"
import { Effect, Match } from "effect"
import { descriptor, EVAL_TIMEOUT_MS } from "./support.js"

/** Inspector verbs and their side-effect classes (see module header). */
export type InspectorReadVerb = "probe" | "read-comments"
export type InspectorEvalVerb = "install-comment-menu" | "clear-comments" | "toggle"
export type InspectorDeviceVerb = "open-dev-menu"
export type InspectorVerb = InspectorReadVerb | InspectorEvalVerb | InspectorDeviceVerb

export type InspectorSideEffect = "read" | "runtime-eval" | "device"

/**
 * Per-verb side-effect class. EXHAUSTIVE — adding a verb to `InspectorVerb`
 * without a branch is a COMPILE error (AC-011: mutating verbs can never silently
 * be left ungated).
 */
export const inspectorSideEffect = (verb: InspectorVerb): InspectorSideEffect =>
  Match.value(verb).pipe(
    Match.when("probe", () => "read" as const),
    Match.when("read-comments", () => "read" as const),
    Match.when("install-comment-menu", () => "runtime-eval" as const),
    Match.when("clear-comments", () => "runtime-eval" as const),
    Match.when("toggle", () => "runtime-eval" as const),
    Match.when("open-dev-menu", () => "device" as const),
    Match.exhaustive,
  )

export interface InspectorResult {
  readonly action: string
  readonly verb: InspectorVerb
  readonly sideEffect: InspectorSideEffect
  readonly available?: boolean
  readonly reason?: string
  readonly timeoutMs: number
  readonly value: unknown
}

export interface InspectorArgs {
  readonly probe?: unknown
  readonly comments?: unknown
}

/** Package-controlled mutating expression (writes the runtime review global). */
const inspectorEvalExpression = (verb: InspectorEvalVerb): string =>
  `globalThis.__CODEX_SIMULATOR_REVIEW__ && globalThis.__CODEX_SIMULATOR_REVIEW__.${
    verb === "install-comment-menu" ? "install" : verb === "clear-comments" ? "clear" : "toggle"
  }()`

const result = (verb: InspectorVerb, sideEffect: InspectorSideEffect, value: unknown): InspectorResult => ({
  action: `inspector.${verb}`,
  verb,
  sideEffect,
  timeoutMs: EVAL_TIMEOUT_MS,
  value,
})

// ── Per-class command builders (each pins handler R to exactly its class) ──

/**
 * A read verb's handler. `R = CapabilityFor<"read"> = never`: it CANNOT name the
 * eval capability — the AC-011 structural guarantee at this boundary.
 */
const readInspectorCommand = (verb: InspectorReadVerb, args: InspectorArgs): Command<"read", InspectorResult> =>
  command(
    descriptor(`inspector.${verb}`, "read"),
    Effect.sync(() => {
      const value = verb === "probe" ? args.probe : args.comments
      if (value === undefined) {
        return {
          ...result(verb, "read", null),
          available: false,
          reason: "No inspector read evidence was provided.",
        }
      }
      return { ...result(verb, "read", value), available: true }
    }),
  )

/** A mutating verb's handler — reaches the eval capability via `R` (gated). */
const evalInspectorCommand = (verb: InspectorEvalVerb): Command<"runtime-eval", InspectorResult> =>
  command(
    descriptor(`inspector.${verb}`, "runtime-eval"),
    RuntimeEvalCapability.pipe(
      Effect.flatMap((evalCap) =>
        evalCap.evaluate(inspectorEvalExpression(verb)).pipe(
          Effect.timeoutFail({
            duration: `${EVAL_TIMEOUT_MS} millis`,
            onTimeout: () => new CliRuntimeError({ message: `Runtime eval timed out after ${EVAL_TIMEOUT_MS}ms.` }),
          }),
        ),
      ),
      Effect.map((value) => result(verb, "runtime-eval", value)),
    ),
  )

/** The device verb's handler — reaches the device capability via `R` (gated). */
const deviceInspectorCommand = (verb: InspectorDeviceVerb): Command<"device", InspectorResult> =>
  command(
    descriptor(`inspector.${verb}`, "device"),
    DeviceCapability.pipe(
      Effect.flatMap((device) => device.invoke("xcrun", ["simctl", "ui", "dev-menu"])),
      Effect.map((value) => result(verb, "device", value)),
    ),
  )

/**
 * The full inspector command, as a discriminated union over the verb's class.
 * Callers (and the dispatch tests) narrow on `.descriptor.sideEffect`.
 */
export type InspectorCommand =
  | Command<"read", InspectorResult>
  | Command<"runtime-eval", InspectorResult>
  | Command<"device", InspectorResult>

/** Build the right per-class command for a verb (EXHAUSTIVE over the class). */
export const inspectorCommand = (verb: InspectorVerb, args: InspectorArgs = {}): InspectorCommand =>
  Match.value(inspectorSideEffect(verb)).pipe(
    Match.when("read", () => readInspectorCommand(verb as InspectorReadVerb, args)),
    Match.when("runtime-eval", () => evalInspectorCommand(verb as InspectorEvalVerb)),
    Match.when("device", () => deviceInspectorCommand(verb as InspectorDeviceVerb)),
    Match.exhaustive,
  )
