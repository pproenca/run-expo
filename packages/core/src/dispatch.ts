import { Effect, Stream } from "effect"
import {
  DeviceCapability,
  RuntimeEvalCapability,
  SourceWriteCapability
} from "./capabilities.js"
import { CliRuntimeError, type DomainError, EXIT_SUCCESS, type ExitCode } from "./errors.js"
import {
  type CommandDescriptor,
  classify,
  gate,
  type PolicyDeniedPayload,
  type PolicyDocument,
  type SideEffect
} from "./policy.js"
import { redact } from "./redaction.js"
import { RunningTruncator } from "./truncate.js"

/**
 * S6 — Dispatch Runtime. THE capability-injection gate.
 * AC-001, AC-015, AC-016, AC-025, AC-031, AC-041.
 *
 * Flow: classify → gate → PROVIDE-CAPABILITIES-IFF-ALLOWED → run handler →
 * redact + truncate at the boundary → emit. The run-record write is strictly
 * OBSERVATIONAL (AC-025): a failing recorder is caught and NEVER changes the
 * exit code.
 */

/**
 * Map a side-effect class to the capability tag a handler of that class is
 * ALLOWED to require in its `R`. This is the type-level contract that makes the
 * withholding real:
 *   - read         ⇒ never  (no dangerous capability — calling one won't compile)
 *   - device       ⇒ DeviceCapability
 *   - runtime-eval ⇒ RuntimeEvalCapability
 *   - source-write ⇒ SourceWriteCapability
 */
export type CapabilityFor<S extends SideEffect> = S extends "read"
  ? never
  : S extends "device"
    ? DeviceCapability
    : S extends "runtime-eval"
      ? RuntimeEvalCapability
      : S extends "source-write"
        ? SourceWriteCapability
        : never

/**
 * A command = a descriptor with a literal `sideEffect`, plus a handler whose
 * `R` is bounded to AT MOST the capability allowed for that class. A `read`
 * handler therefore has `R = never`; it cannot name a dangerous capability.
 */
export interface Command<S extends SideEffect, A> {
  readonly descriptor: CommandDescriptor & { readonly sideEffect: S }
  readonly handler: Effect.Effect<A, DomainError, CapabilityFor<S>>
}

/** Helper that infers `S` and pins the handler's `R` to `CapabilityFor<S>`. */
export const command = <S extends SideEffect, A>(
  descriptor: CommandDescriptor & { readonly sideEffect: S },
  handler: Effect.Effect<A, DomainError, CapabilityFor<S>>
): Command<S, A> => ({ descriptor, handler })

/** The capabilities the dispatcher needs available to *provide* on gate-pass. */
export type CapabilityEnv =
  | RuntimeEvalCapability
  | DeviceCapability
  | SourceWriteCapability

/** A boundary-finalised result, ready for the CLI shell to serialise. */
export interface DispatchResult<A> {
  readonly exitCode: ExitCode
  /** Redacted + truncated payload — `A` on allow+success, denial payload on deny. */
  readonly payload: unknown
  readonly sideEffect: SideEffect
}

/** Observational run-recorder (AC-025). `finish` failures are swallowed upstream. */
export interface RunRecorder {
  readonly start: (descriptor: CommandDescriptor) => Effect.Effect<void, unknown>
  readonly finish: (outcome: {
    readonly status: "completed" | "failed"
    readonly exitCode: ExitCode
    readonly summary: unknown
  }) => Effect.Effect<void, unknown>
}

/** A no-op recorder (used when neither `--record` nor `--state-dir` is set). */
export const NoopRecorder: RunRecorder = {
  start: () => Effect.void,
  finish: () => Effect.void
}

/**
 * The output boundary applied inside dispatch: redact whole values (AC-003 +
 * AC-012). Truncation (AC-041) is intentionally NOT applied here. It is enforced
 * ONCE, at the actual stdout serialisation boundary (the CLI shell's envelope /
 * ndjson stream, which call `truncate`/`RunningTruncator`), so the structured,
 * redacted payload survives dispatch intact for the consumers that need it:
 * `batch` step composition (AC-031) and run-record summaries (AC-042). Collapsing
 * a large structured payload into a marker here would silently destroy `--json`
 * data for any consumer that legitimately requested many rows.
 */
const finaliseBoundary = (payload: unknown): unknown => redact(payload)

/**
 * Dispatch one typed command.
 *
 * The `provide*` calls below are the WITHHOLDING in action: a capability layer
 * is provided into the handler's `R` ONLY on the matching gate-pass branch. On
 * deny we never even build the handler's environment, so the dangerous service
 * is never constructed — AC-005's "denial performs zero xcrun/simctl".
 */
export const dispatch = <S extends SideEffect, A>(
  cmd: Command<S, A>,
  policy: PolicyDocument,
  recorder: RunRecorder = NoopRecorder
): Effect.Effect<DispatchResult<A>, never, CapabilityEnv> =>
  Effect.gen(function* () {
    const sideEffect = classify(cmd.descriptor)
    const decision = gate(cmd.descriptor, policy)

    // AC-025: recording is observational. Start-record failure is swallowed.
    yield* recorder.start(cmd.descriptor).pipe(Effect.ignore)

    if (decision._tag === "deny") {
      const denial: PolicyDeniedPayload = decision.payload
      const result: DispatchResult<A> = {
        exitCode: EXIT_SUCCESS, // designed-unavailable: exit 0 (AC-001/§3.2)
        payload: finaliseBoundary(denial),
        sideEffect
      }
      // AC-025: finish-record failure must NOT change the exit code.
      yield* recorder
        .finish({ status: "completed", exitCode: result.exitCode, summary: denial })
        .pipe(Effect.ignore)
      return result
    }

    // ── Gate passed: PROVIDE the matching capability into the handler's R ──
    const provided = provideCapabilityFor(sideEffect, cmd.handler)
    const exit = yield* Effect.exit(provided)

    if (exit._tag === "Success") {
      const payload = finaliseBoundary(exit.value)
      const result: DispatchResult<A> = {
        exitCode: EXIT_SUCCESS,
        payload,
        sideEffect
      }
      yield* recorder
        .finish({ status: "completed", exitCode: result.exitCode, summary: payload })
        .pipe(Effect.ignore)
      return result
    }

    // Handler failed: classify the error to an exit code (AC-015/016) and
    // redact the surfaced error message at the boundary.
    const cause = exit.cause
    const error = extractError(cause)
    const exitCode = exitCodeForDomainError(error)
    const result: DispatchResult<A> = {
      exitCode,
      payload: finaliseBoundary({ ok: false, error: errorMessage(error) }),
      sideEffect
    }
    yield* recorder
      .finish({ status: "failed", exitCode, summary: result.payload })
      .pipe(Effect.ignore)
    return result
  })

/**
 * Provide the capability matching the (already gate-approved) class into the
 * handler's `R`, discharging the requirement using the CONCRETE service the
 * deployment supplied via `CapabilityEnv`. For `read` there is nothing to
 * provide — the handler's `R` is `never`.
 *
 * This is the WITHHOLDING made operational: only on the matching gate-pass
 * branch is the concrete service read from the environment and handed to the
 * handler. A denied command never reaches here, so its capability is never
 * provided (AC-005: denial does zero device work).
 *
 * SAFETY: the cast localises the unavoidable type bridge between the runtime
 * branch and the per-class `CapabilityFor<S>`; it is sound because the branch is
 * selected by the SAME `sideEffect` value that types the handler.
 */
const provideCapabilityFor = <S extends SideEffect, A>(
  sideEffect: SideEffect,
  handler: Effect.Effect<A, DomainError, CapabilityFor<S>>
): Effect.Effect<A, DomainError, CapabilityEnv> => {
  const h = handler as Effect.Effect<A, DomainError, CapabilityEnv>
  switch (sideEffect) {
    case "read":
      return h
    case "device":
      return DeviceCapability.pipe(
        Effect.flatMap((cap) => Effect.provideService(h, DeviceCapability, cap))
      )
    case "runtime-eval":
      return RuntimeEvalCapability.pipe(
        Effect.flatMap((cap) =>
          Effect.provideService(h, RuntimeEvalCapability, cap)
        )
      )
    case "source-write":
      return SourceWriteCapability.pipe(
        Effect.flatMap((cap) =>
          Effect.provideService(h, SourceWriteCapability, cap)
        )
      )
  }
}

const exitCodeForDomainError = (error: DomainError): ExitCode =>
  error._tag === "CliUsageError" ? 2 : 1

const errorMessage = (error: DomainError): string =>
  "message" in error && typeof error.message === "string"
    ? error.message
    : error._tag

/** Pull the first failure out of a Cause without throwing. */
const extractError = (cause: unknown): DomainError => {
  if (
    typeof cause === "object" &&
    cause !== null &&
    "_tag" in cause &&
    (cause as { _tag: unknown })._tag === "Fail" &&
    "error" in cause
  ) {
    return (cause as { error: DomainError }).error
  }
  return new CliRuntimeError({ message: "Unexpected handler defect." })
}

// ──────────────────────────────────────────────────────────────────────────
// AC-031 — batch: in-process serial fibers, bail-on-first-failure,
// exit-code-isolated. Each step is dispatched in declaration order; a
// non-success exit code records the failure index and (when `bail`) halts.
// Steps are exit-code-isolated: one step's exit code never mutates another's.
// ──────────────────────────────────────────────────────────────────────────

export interface BatchStepResult {
  readonly exitCode: ExitCode
  readonly payload: unknown
  readonly sideEffect: SideEffect
}

export interface BatchResult {
  readonly ok: boolean
  readonly bail: boolean
  readonly failureIndex: number | null
  readonly steps: ReadonlyArray<BatchStepResult>
}

/** A batch step closes over its own dispatch Effect (already fully typed). */
export interface BatchStep {
  readonly run: Effect.Effect<DispatchResult<unknown>, never, CapabilityEnv>
}

export const runBatch = (
  steps: ReadonlyArray<BatchStep>,
  bail: boolean
): Effect.Effect<BatchResult, never, CapabilityEnv> =>
  Effect.gen(function* () {
    const results: Array<BatchStepResult> = []
    let failureIndex: number | null = null

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i]
      if (step === undefined) {
        continue
      }
      // Serial: await each before the next (in-process fibers, ordered).
      const result = yield* step.run
      results.push({
        exitCode: result.exitCode,
        payload: result.payload,
        sideEffect: result.sideEffect
      })
      if (result.exitCode !== EXIT_SUCCESS && failureIndex === null) {
        failureIndex = i
        if (bail) {
          break // bail-on-first-failure
        }
      }
    }

    return {
      ok: failureIndex === null,
      bail,
      failureIndex,
      steps: results
    }
  })

// ──────────────────────────────────────────────────────────────────────────
// AC-041 (streaming) — NDJSON progress with a RUNNING-TOTAL budget and one
// terminal overflow marker. Redaction is applied to WHOLE values before
// serialisation (finding M2), so a secret cannot split across events.
// ──────────────────────────────────────────────────────────────────────────

export const ndjsonStream = <E, R>(
  events: Stream.Stream<unknown, E, R>
): Stream.Stream<string, E, R> =>
  Stream.suspend(() => {
    const budget = new RunningTruncator()
    return events.pipe(
      // redact whole value, serialise one JSON per line, apply running budget
      Stream.map((event) => {
        const line = JSON.stringify(redact(event)) + "\n"
        return budget.push(line)
      }),
      Stream.filter((emitted) => emitted.length > 0)
    )
  })

// Re-export so callers can map errors→exit codes without importing errors.ts
// alongside dispatch (single import surface for the shell).
export const exitCodeForError = exitCodeForDomainError
