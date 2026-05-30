/**
 * `wait` — D7 polling/predicate command (AC-004, AC-035).
 *
 * `wait` is a READ by default, but `wait --fn` injects a RUNTIME PREDICATE into
 * the app, so that ONE verb (`wait.fn`) is classed `runtime-eval` and gated:
 *
 *   - `wait.fn` requires `--allow-runtime-eval` OR a policy entry. With neither,
 *     the dispatcher denies it and the eval capability is NEVER invoked (AC-004).
 *   - With a runtime adapter the predicate is evaluated through the injected
 *     `RuntimeEvalCapability`; with NO adapter the handler is built BUT a runtime
 *     predicate must report `{ matched:false, available:false, reason:"Runtime wait
 *     predicates require a runtime adapter." }` (unavailable, not a crash).
 *
 * Non-fn paths are `read`:
 *   - `--ms`: sleep `clamp(args.ms ?? 0, 0, 60000)` then `matched:true` (AC-035).
 *   - predicate (`--text`/`@eN --state`): poll on a bounded cadence (AC-035):
 *       `timeoutMs = clamp(args.timeoutMs ?? 5000, 0, 60000)`
 *       `intervalMs = min(max(floor(timeoutMs/10), 25), 250)`
 *       each tick sleeps `min(intervalMs, timeoutMs - elapsed)` until matched/timeout.
 *
 * The handler reaches `RuntimeEvalCapability` ONLY in the `wait.fn` branch (its
 * descriptor class is `runtime-eval`); the read branches have `R = never`.
 */
import { CliRuntimeError, command, type Command, RuntimeEvalCapability } from "@expo98/core"
import { Clock, Effect } from "effect"
import { clamp } from "./support.js"
import { descriptor } from "./support.js"

// ── AC-035 cadence bounds ──
export const MIN_TIMEOUT_MS = 0 as const
export const MAX_TIMEOUT_MS = 60_000 as const
export const DEFAULT_TIMEOUT_MS = 5_000 as const

export const MIN_INTERVAL_MS = 25 as const
export const MAX_INTERVAL_MS = 250 as const

export const MIN_MS = 0 as const
export const MAX_MS = 60_000 as const

/** AC-035: `timeoutMs = clamp(args.timeoutMs ?? 5000, 0, 60000)`. */
export const resolveTimeoutMs = (timeoutMs: number | undefined): number =>
  clamp(timeoutMs ?? DEFAULT_TIMEOUT_MS, MIN_TIMEOUT_MS, MAX_TIMEOUT_MS)

/** AC-035: `intervalMs = min(max(floor(timeoutMs/10), 25), 250)`. */
export const resolveIntervalMs = (timeoutMs: number): number =>
  Math.min(Math.max(Math.floor(timeoutMs / 10), MIN_INTERVAL_MS), MAX_INTERVAL_MS)

/** AC-035: `ms = clamp(args.ms ?? 0, 0, 60000)`. */
export const resolveMs = (ms: number | undefined): number => clamp(ms ?? MIN_MS, MIN_MS, MAX_MS)

/** AC-035: each tick sleeps `min(intervalMs, timeoutMs - elapsed)`. */
export const tickSleepMs = (intervalMs: number, timeoutMs: number, elapsedMs: number): number =>
  Math.min(intervalMs, timeoutMs - elapsedMs)

export type WaitMode = "ms" | "predicate" | "fn"

export interface WaitArgs {
  readonly ms?: number
  readonly timeoutMs?: number
  readonly text?: string
  readonly ref?: string
  readonly state?: string
  /** The runtime predicate body (`--fn`) — only legal in the `fn` mode. */
  readonly fn?: string
}

export interface WaitResult {
  readonly action: string
  readonly mode: WaitMode
  readonly matched: boolean
  readonly available: boolean
  readonly timeoutMs?: number
  readonly intervalMs?: number
  readonly waitedMs?: number
  readonly reason?: string
  readonly value?: unknown
}

/**
 * The side-effect class for a `wait` invocation. `--fn` → `runtime-eval`
 * (AC-004); everything else → `read` (AC-035). Modelled as an explicit function
 * so the classification can never drift from how the command is built.
 */
export const waitMode = (args: WaitArgs): WaitMode =>
  args.fn !== undefined ? "fn" : args.ms !== undefined ? "ms" : "predicate"

export const waitSideEffect = (mode: WaitMode): "read" | "runtime-eval" => (mode === "fn" ? "runtime-eval" : "read")

/**
 * A non-runtime predicate sampled each tick. Returns whether it matched at the
 * current moment; the cadence loop owns the timing. In a real build this is fed
 * by a snapshot/ref read; here it is supplied by the caller for determinism.
 */
export type Predicate = () => Effect.Effect<boolean>

const RUNTIME_ADAPTER_REASON = "Runtime wait predicates require a runtime adapter." as const

// ── `--ms` path (read): sleep the clamped duration, report matched:true ──

const msWaitCommand = (args: WaitArgs): Command<"read", WaitResult> => {
  const ms = resolveMs(args.ms)
  return command(
    descriptor("wait", "read"),
    Clock.sleep(`${ms} millis`).pipe(
      Effect.as<WaitResult>({
        action: "wait",
        mode: "ms",
        matched: true,
        available: true,
        waitedMs: ms,
      }),
    ),
  )
}

// ── predicate path (read): poll on the AC-035 cadence until match/timeout ──

const predicateWaitCommand = (args: WaitArgs, predicate: Predicate): Command<"read", WaitResult> => {
  const timeoutMs = resolveTimeoutMs(args.timeoutMs)
  const intervalMs = resolveIntervalMs(timeoutMs)
  return command(
    descriptor("wait", "read"),
    Effect.gen(function* () {
      const start = yield* Clock.currentTimeMillis
      let elapsed = 0
      // Sample once before the first sleep so a zero timeout still evaluates once.
      let matched = yield* predicate()
      while (!matched && elapsed < timeoutMs) {
        const sleepMs = tickSleepMs(intervalMs, timeoutMs, elapsed)
        if (sleepMs <= 0) {
          break
        }
        yield* Clock.sleep(`${sleepMs} millis`)
        const now = yield* Clock.currentTimeMillis
        elapsed = now - start
        matched = yield* predicate()
      }
      const result: WaitResult = {
        action: "wait",
        mode: "predicate",
        matched,
        available: true,
        timeoutMs,
        intervalMs,
        waitedMs: elapsed,
      }
      return result
    }),
  )
}

// ── `--fn` path (runtime-eval): gated; needs a runtime adapter ──

/**
 * `wait --fn` with a runtime adapter present: evaluate the predicate through the
 * injected `RuntimeEvalCapability` (only reachable because this descriptor is
 * classed `runtime-eval` and the gate passed).
 */
const fnWaitCommand = (args: WaitArgs): Command<"runtime-eval", WaitResult> => {
  const timeoutMs = resolveTimeoutMs(args.timeoutMs)
  const fn = args.fn ?? "true"
  return command(
    descriptor("wait.fn", "runtime-eval"),
    RuntimeEvalCapability.pipe(
      Effect.flatMap((evalCap) =>
        evalCap.evaluate(`Boolean(${fn})`).pipe(
          Effect.timeoutFail({
            duration: `${timeoutMs} millis`,
            onTimeout: () => new CliRuntimeError({ message: `Runtime wait predicate timed out after ${timeoutMs}ms.` }),
          }),
        ),
      ),
      Effect.map(
        (value): WaitResult => ({
          action: "wait.fn",
          mode: "fn",
          matched: value === true,
          available: true,
          timeoutMs,
          value,
        }),
      ),
    ),
  )
}

/**
 * `wait --fn` with NO runtime adapter: still classed `runtime-eval` (so it is
 * gated), but the handler short-circuits to the AC-004 unavailable shape WITHOUT
 * invoking the eval capability (there is nothing to evaluate against).
 */
const fnWaitUnavailableCommand = (): Command<"runtime-eval", WaitResult> =>
  command(
    descriptor("wait.fn", "runtime-eval"),
    Effect.succeed<WaitResult>({
      action: "wait.fn",
      mode: "fn",
      matched: false,
      available: false,
      reason: RUNTIME_ADAPTER_REASON,
    }),
  )

export interface WaitDeps {
  /** A sampled predicate for the non-fn predicate path. */
  readonly predicate?: Predicate
  /** Whether a runtime adapter is available for the `--fn` path (AC-004). */
  readonly hasRuntimeAdapter?: boolean
}

/**
 * Build the right `wait` command for the args (EXHAUSTIVE over the three modes):
 *   - `--fn`            → `runtime-eval` (gated; adapter-aware unavailable shape)
 *   - `--ms`            → `read` (clamped sleep, matched:true)
 *   - predicate default → `read` (AC-035 cadence loop)
 */
export const waitCommand = (
  args: WaitArgs = {},
  deps: WaitDeps = {},
): Command<"read", WaitResult> | Command<"runtime-eval", WaitResult> => {
  const mode = waitMode(args)
  switch (mode) {
    case "fn":
      return deps.hasRuntimeAdapter === true ? fnWaitCommand(args) : fnWaitUnavailableCommand()
    case "ms":
      return msWaitCommand(args)
    case "predicate":
      return predicateWaitCommand(args, deps.predicate ?? (() => Effect.succeed(false)))
  }
}
