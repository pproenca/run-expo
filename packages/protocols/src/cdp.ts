/**
 * S9 — Hermes CDP service (AC-030, AC-022 transport).
 *
 * Connection model (preserved from legacy, with the AC-030 loopback FIX added):
 *   1. LOOPBACK-ENFORCE the `webSocketDebuggerUrl` BEFORE connecting (reject non-loopback —
 *      this is the AC-030 fix that closes the legacy CWE-918 gap). Mirrors Metro's allowlist.
 *   2. Open WS to the (now-validated) url with `Origin: http://127.0.0.1[:port]`, bounded by
 *      `min(timeoutMs, 2500)`ms.
 *   3. Send `Runtime.enable`, then `Runtime.evaluate {returnByValue:true, awaitPromise:true}`.
 *   4. Correlate responses by an incrementing `id`.
 *   5. Malformed JSON frame -> reject with the raw text truncated to 1000 chars.
 *   6. All attempts fail -> `{ error, diagnostics:{ attemptedUrls } }`.
 *
 * ============================================================================================
 * SPLIT SURFACE + the `@expo98/core` capability seam
 * --------------------------------------------------------------------------------------------
 * The interface is split into TWO capabilities so the dispatcher can withhold the dangerous one:
 *
 *   - `HermesEvidence` (READ-EVAL surface): harvests evidence by evaluating a FIXED, in-package
 *     read-only expression set (e.g. `network` request collection). This is the surface a
 *     `read`-classed handler legitimately uses (the legacy `network` command is `read` yet
 *     evaluates JS — architecture finding C1).
 *
 *   - `HermesRuntimeEval` (RUNTIME-EVAL MUTATION surface): evaluates ARBITRARY caller-supplied JS
 *     in the app (the `wait --fn` / `trace` / `inspector` mutation class). This is the capability
 *     the dispatcher MUST withhold unless the typed command's side-effect class is `runtime-eval`
 *     and the fail-closed gate passed.
 *
 * INTEGRATION SEAM (@expo98/core): in the real system, `@expo98/core`'s Dispatch Runtime (S6)
 * constructs `HermesRuntimeEval` and provides it into a handler's Effect `R` environment *only
 * after* the policy gate passes for a `runtime-eval`-classed command. A `read`-classed handler's
 * `R` simply lacks `HermesRuntimeEval`, so calling it is a COMPILE error — the gate is a type fact,
 * not a runtime convention. THIS PACKAGE ONLY DOCUMENTS THAT SEAM: it exposes the split tags and
 * leaves the withholding to core. We do NOT implement the gate here.
 * ============================================================================================
 */
import { Context, Effect, Layer } from "effect"
import { CdpSocketFactory, type CdpSocket } from "./cdp-socket.js"
import { CdpMalformedFrame, CdpProtocolError, CdpSocketError, LoopbackViolation } from "./errors.js"
import { checkLoopbackUrl, clamp, resolveMetroPort } from "./loopback.js"

// ----------------------------------------------------------------------------------------------
// Constants (AC-030 / AC-053)
// ----------------------------------------------------------------------------------------------

/** Bounded-open ceiling: open <= min(timeoutMs, 2500). */
export const MAX_OPEN_MS = 2_500 as const
/** Default per-evaluation timeout when the caller gives none. */
export const DEFAULT_EVAL_TIMEOUT_MS = 8_000 as const
/** Malformed-frame raw preview cap (AC-030). */
export const MALFORMED_PREVIEW_CHARS = 1_000 as const

/** Compute the bounded open ms: `min(timeoutMs, 2500)` (AC-030). PURE — exported for the test. */
export const boundedOpenMs = (timeoutMs: number): number => Math.min(timeoutMs, MAX_OPEN_MS)

/** Compute the connect-time Origin header value: `http://127.0.0.1[:port]` (AC-030). PURE. */
export const originForPort = (metroPort: number | undefined | null): string =>
  `http://127.0.0.1:${resolveMetroPort(metroPort)}`

// ----------------------------------------------------------------------------------------------
// Result shapes
// ----------------------------------------------------------------------------------------------

/** A successful CDP `Runtime.evaluate` result (value already unwrapped via returnByValue). */
export interface CdpEvaluation {
  readonly value: unknown
  /** The loopback url that succeeded. */
  readonly url: string
}

/** All-attempts-failed diagnostics (AC-030). */
export interface CdpFailureDiagnostics {
  readonly attemptedUrls: ReadonlyArray<string>
}

export interface CdpUnavailable {
  readonly available: false
  readonly error: string
  readonly diagnostics: CdpFailureDiagnostics
}

export type CdpEvaluateResult = { readonly available: true; readonly result: CdpEvaluation } | CdpUnavailable

// ----------------------------------------------------------------------------------------------
// Split capability surfaces (the dispatcher-withholds seam)
// ----------------------------------------------------------------------------------------------

/** Shared options for any CDP evaluation. */
export interface CdpEvaluateOptions {
  /** Candidate `webSocketDebuggerUrl`s (from Metro /json/list). Tried in order. */
  readonly attemptedUrls: ReadonlyArray<string>
  /** Metro port — drives the Origin header value. */
  readonly metroPort?: number
  /** Per-evaluation timeout in ms (open is bounded separately to min(this, 2500)). */
  readonly timeoutMs?: number
}

/**
 * READ-EVAL surface — evidence harvesting via a FIXED read-only expression. A `read`-classed
 * handler legitimately depends on this (e.g. `network`). It still goes over loopback CDP, but the
 * expression is package-controlled, not caller-supplied.
 */
export interface HermesEvidence {
  readonly evaluateReadOnly: (expression: string, options: CdpEvaluateOptions) => Effect.Effect<CdpEvaluateResult>
}

export const HermesEvidence = Context.GenericTag<HermesEvidence>("@expo98/protocols/HermesEvidence")

/**
 * RUNTIME-EVAL MUTATION surface — arbitrary caller-supplied JS. The dispatcher (in `@expo98/core`)
 * WITHHOLDS this capability from a handler's `R` unless the command is `runtime-eval`-classed and
 * the gate passed. Documented seam only; not gated here.
 */
export interface HermesRuntimeEval {
  readonly evaluate: (expression: string, options: CdpEvaluateOptions) => Effect.Effect<CdpEvaluateResult>
}

export const HermesRuntimeEval = Context.GenericTag<HermesRuntimeEval>("@expo98/protocols/HermesRuntimeEval")

// ----------------------------------------------------------------------------------------------
// CDP wire helpers
// ----------------------------------------------------------------------------------------------

interface CdpFrame {
  readonly id?: number
  readonly result?: unknown
  readonly error?: { readonly code?: number; readonly message?: string }
}

const truncate = (text: string, max: number): string => (text.length <= max ? text : text.slice(0, max))

/** Parse a frame; reject with a truncated raw preview on malformed JSON (AC-030). */
const parseFrame = (raw: string): Effect.Effect<CdpFrame, CdpMalformedFrame> =>
  Effect.try({
    try: () => JSON.parse(raw) as CdpFrame,
    catch: () => new CdpMalformedFrame({ rawTruncated: truncate(raw, MALFORMED_PREVIEW_CHARS) }),
  })

/**
 * Read frames off the socket until one whose `id` matches `wantId` arrives. Frames for other ids
 * (or notifications without an id) are skipped. A clean close before the id arrives is an error.
 */
const awaitResponse = (
  socket: CdpSocket,
  wantId: number,
): Effect.Effect<CdpFrame, CdpSocketError | CdpMalformedFrame | CdpProtocolError> =>
  Effect.gen(function* () {
    for (;;) {
      const raw = yield* socket.receive
      if (raw === null) {
        return yield* new CdpSocketError({
          url: "",
          reason: "Close",
          cause: "socket closed before response",
        })
      }
      const frame = yield* parseFrame(raw)
      if (frame.id !== wantId) continue
      if (frame.error) {
        return yield* new CdpProtocolError({
          code: frame.error.code ?? null,
          message: frame.error.message ?? "CDP evaluation error.",
        })
      }
      return frame
    }
  })

/** Run the enable -> evaluate sequence against ONE already-open socket, id-correlated. */
const runEvaluateSequence = (
  socket: CdpSocket,
  expression: string,
  timeoutMs: number,
): Effect.Effect<unknown, CdpSocketError | CdpMalformedFrame | CdpProtocolError> =>
  Effect.gen(function* () {
    let nextId = 0
    const send = (method: string, params?: Record<string, unknown>) => {
      const id = ++nextId
      return socket.send(JSON.stringify({ id, method, params: params ?? {} })).pipe(Effect.as(id))
    }

    // Per-message timeout (AC-053): a stalled response becomes a typed Read socket error.
    const withTimeout = <A, E>(eff: Effect.Effect<A, E>): Effect.Effect<A, E | CdpSocketError> =>
      eff.pipe(
        Effect.timeoutFail({
          duration: timeoutMs,
          onTimeout: () =>
            new CdpSocketError({
              url: "",
              reason: "Read",
              cause: `response exceeded ${timeoutMs}ms`,
            }),
        }),
      )

    // 1. Runtime.enable
    const enableId = yield* send("Runtime.enable")
    yield* withTimeout(awaitResponse(socket, enableId))

    // 2. Runtime.evaluate { returnByValue: true, awaitPromise: true }
    const evalId = yield* send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    })
    const frame = yield* withTimeout(awaitResponse(socket, evalId))

    // Unwrap CDP `result.result.value` (returnByValue shape), tolerating shallower shapes.
    const result = frame.result as { result?: { value?: unknown }; value?: unknown } | undefined
    if (result && typeof result === "object" && "result" in result && result.result) {
      return result.result.value
    }
    return result?.value ?? frame.result ?? null
  })

/**
 * Try each candidate url in order. For each: enforce loopback (AC-030 FIX), open with Origin +
 * bounded open, run the sequence. First success wins; if all fail, return the unavailable payload
 * with `diagnostics.attemptedUrls` (AC-030).
 */
const evaluateOverCandidates = (
  factory: CdpSocketFactory,
  expression: string,
  options: CdpEvaluateOptions,
): Effect.Effect<CdpEvaluateResult> =>
  Effect.gen(function* () {
    const origin = originForPort(options.metroPort)
    const timeoutMs = options.timeoutMs ?? DEFAULT_EVAL_TIMEOUT_MS
    const openTimeoutMs = boundedOpenMs(timeoutMs)
    const attemptedUrls = options.attemptedUrls

    for (const url of attemptedUrls) {
      // (1) AC-030 FIX: reject a non-loopback debugger url BEFORE opening any socket.
      const loopback = checkLoopbackUrl(url)
      if (!loopback.ok) {
        // Skip non-loopback candidates entirely; they are never connected.
        continue
      }

      // (2) Open + run, scoped so the socket is always closed. Collapse all failures to "try next".
      const attempt = Effect.scoped(
        Effect.gen(function* () {
          const socket = yield* Effect.acquireRelease(factory.connect({ url, origin, openTimeoutMs }), (s) => s.close)
          const value = yield* runEvaluateSequence(socket, expression, timeoutMs)
          return { url, value }
        }),
      )

      const outcome = yield* attempt.pipe(Effect.either)
      if (outcome._tag === "Right") {
        return {
          available: true,
          result: { value: outcome.right.value, url: outcome.right.url },
        } satisfies CdpEvaluateResult
      }
      // else: fall through to the next candidate
    }

    return {
      available: false,
      error:
        attemptedUrls.length === 0
          ? "No Hermes debugger targets were provided."
          : "All CDP connection attempts failed.",
      diagnostics: { attemptedUrls },
    } satisfies CdpEvaluateResult
  })

// ----------------------------------------------------------------------------------------------
// Layers — both surfaces are backed by the SAME engine; the SPLIT is the point.
// ----------------------------------------------------------------------------------------------

const makeEvidence = Effect.gen(function* () {
  const factory = yield* CdpSocketFactory
  return {
    evaluateReadOnly: (expression, options) => evaluateOverCandidates(factory, expression, options),
  } satisfies HermesEvidence
})

const makeRuntimeEval = Effect.gen(function* () {
  const factory = yield* CdpSocketFactory
  return {
    evaluate: (expression, options) => evaluateOverCandidates(factory, expression, options),
  } satisfies HermesRuntimeEval
})

/** Read-eval surface layer. Safe for `read`-classed handlers. Requires a {@link CdpSocketFactory}. */
export const HermesEvidenceLayer = Layer.effect(HermesEvidence, makeEvidence)

/**
 * Runtime-eval mutation surface layer. The dispatcher (core) must WITHHOLD this from `read`-classed
 * handlers' `R` — provide it only when the command is `runtime-eval`-classed and the gate passed.
 */
export const HermesRuntimeEvalLayer = Layer.effect(HermesRuntimeEval, makeRuntimeEval)

/**
 * Pre-connect loopback assertion as a standalone Effect, for callers that want to validate a url
 * before threading it through (AC-030). Fails with {@link LoopbackViolation}.
 */
export const assertLoopbackUrl = (url: string): Effect.Effect<string, LoopbackViolation> => {
  const res = checkLoopbackUrl(url)
  if (res.ok) return Effect.succeed(url)
  return Effect.fail(new LoopbackViolation({ host: res.host, url, reason: res.reason ?? "Non-loopback host." }))
}

/** Re-export for the test: bounded-open is a clamp to [.., 2500]. */
export const __boundedOpenClamp = (timeoutMs: number): number => clamp(boundedOpenMs(timeoutMs), 0, MAX_OPEN_MS)
