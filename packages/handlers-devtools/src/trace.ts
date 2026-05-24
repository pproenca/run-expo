/**
 * `trace` — D10 runtime tracer (AC-010, the FIX).
 *
 * Every `trace` verb (`start`/`read`/`clear`/`stop`) injects/evaluates JS in the
 * running app (the legacy patched `requestAnimationFrame` + the DevTools
 * `onCommitFiberRoot` commit hook and mutated a global tracer — CWE-862/94, all
 * ungated). Here EVERY verb is classified `runtime-eval`, so the dispatcher only
 * provides `RuntimeEvalCapability` into the handler's `R` AFTER the fail-closed
 * gate passes (policy allows `trace.<verb>` OR `--allow-runtime-eval`). With no
 * policy and no flag the handler is never even built — the eval capability is
 * never invoked.
 */
import { command, type Command, RuntimeEvalCapability } from "@expo98/core"
import { Effect, Match } from "effect"
import {
  descriptor,
  EVAL_TIMEOUT_MS,
  resolveMaxEvents,
  resolveMetroPort
} from "./support.js"

/** The trace verbs. */
export type TraceVerb = "start" | "read" | "clear" | "stop"

/**
 * Per-verb side-effect class. EXHAUSTIVE — a new verb added to `TraceVerb`
 * without a branch here is a COMPILE error (AC-010: no verb can silently un-gate).
 */
export const traceSideEffect = (verb: TraceVerb): "runtime-eval" =>
  Match.value(verb).pipe(
    Match.when("start", () => "runtime-eval" as const),
    Match.when("read", () => "runtime-eval" as const),
    Match.when("clear", () => "runtime-eval" as const),
    Match.when("stop", () => "runtime-eval" as const),
    Match.exhaustive
  )

export interface TraceArgs {
  readonly maxEvents?: number
  readonly metroPort?: number
}

/** The package-controlled tracer expression for a verb (caller never supplies JS). */
const traceExpression = (verb: TraceVerb, maxEvents: number): string =>
  `globalThis.__EXPO98_TRACE__ && globalThis.__EXPO98_TRACE__.${verb}(${maxEvents})`

export interface TraceResult {
  readonly action: string
  readonly verb: TraceVerb
  readonly maxEvents: number
  readonly metroPort: number
  readonly timeoutMs: number
  readonly value: unknown
}

/**
 * Build a fully-typed `trace.<verb>` command. The handler reaches
 * `RuntimeEvalCapability` ONLY because its descriptor class is `runtime-eval`
 * and the gate passed; a `read` descriptor would make the `.evaluate(...)` call
 * a compile error (proven in `trace.type-test.ts`).
 */
export const traceCommand = (
  verb: TraceVerb,
  args: TraceArgs = {}
): Command<"runtime-eval", TraceResult> => {
  const maxEvents = resolveMaxEvents(args.maxEvents)
  const metroPort = resolveMetroPort(args.metroPort)
  const action = `trace.${verb}`

  return command(
    descriptor(action, traceSideEffect(verb)),
    RuntimeEvalCapability.pipe(
      Effect.flatMap((evalCap) => evalCap.evaluate(traceExpression(verb, maxEvents))),
      Effect.map(
        (value): TraceResult => ({
          action,
          verb,
          maxEvents,
          metroPort,
          timeoutMs: EVAL_TIMEOUT_MS,
          value
        })
      )
    )
  )
}
