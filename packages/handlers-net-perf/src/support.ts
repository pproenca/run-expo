/**
 * Shared support for the D11 network-evidence + performance handlers.
 *
 * Canonical numeric bounds and small pure helpers reused across `network`,
 * `perf`, and the native-sample parser. The clamp + Metro-port resolution are
 * re-exported from `@expo98/protocols` so this package has ONE source of truth
 * for those bounds (AC-038/039) — it does NOT re-implement them.
 *
 * THE CAPABILITY SEAM (read-eval): the live `network`/`perf` evidence is
 * harvested over CDP by evaluating a FIXED, package-controlled read-only
 * expression. That surface is `@expo98/protocols`' `HermesEvidence`
 * (`evaluateReadOnly`) — the dispatcher provides it (or, for `read`-classed
 * handlers, it is reached via `R` with no dangerous capability). These handlers
 * NEVER import `HermesRuntimeEval` (the arbitrary-JS mutation surface). All the
 * logic in this package is PURE post-processing of an already-harvested payload,
 * so it is tested directly with literal inputs — no sockets are opened here.
 */
import { clamp, resolveMetroPort } from "@expo98/protocols"

export { clamp, resolveMetroPort }

// ── Network list bounds (AC-039: limit clamp 1..1000) ──
export const MIN_LIMIT = 1 as const
export const MAX_LIMIT = 1_000 as const
export const DEFAULT_LIMIT = 100 as const

// ── Memory-sample bounds (AC-051: samples clamp 1..100) ──
export const MIN_SAMPLES = 1 as const
export const MAX_SAMPLES = 100 as const
export const DEFAULT_SAMPLES = 1 as const

/** Resolve `samples ?? 1` into [1, 100] (AC-051). PURE. */
export const resolveSamples = (samples: number | undefined): number =>
  clamp(Number.isFinite(samples) ? (samples as number) : DEFAULT_SAMPLES, MIN_SAMPLES, MAX_SAMPLES)

/** True iff `value` is a non-null, non-array object. */
export const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)

/** `Number(value)` when finite, else `null` (legacy `numberOrNull`). PURE. */
export const numberOrNull = (value: unknown): number | null => {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

/** A non-empty string, else `null` (legacy `optionalString`). PURE. */
export const optionalString = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null
