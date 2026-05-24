/**
 * Shared support for the D10 devtools handlers.
 *
 * - `clamp` and the canonical parameter bounds (AC-010/039 — eval timeout,
 *   maxEvents, metroPort, limit).
 * - `CommandSpec`: one command name's verb → side-effect class mapping, modelled
 *   so a new verb without a class is a COMPILE error (`Match.exhaustive`).
 *
 * NOTE on the capability seam: handlers in this package depend ONLY on core's
 * `RuntimeEvalCapability` / `DeviceCapability` tags, which the dispatcher injects
 * into `R` on the gate-pass branch for the matching class. They NEVER import
 * `@expo98/protocols`' `HermesRuntimeEval` (the CDP eval surface) directly — that
 * would re-introduce the legacy ungated path the rebuild exists to delete.
 */
import type { CommandDescriptor, SideEffect } from "@expo98/core"
import { clamp } from "@expo98/protocols"

export { clamp }

// ── Canonical bounds (AC-010 trace / AC-039 console+errors / AC-038 metroPort) ──

/** Per-evaluation timeout for runtime-eval handlers (AC-010). */
export const EVAL_TIMEOUT_MS = 8_000 as const

/** `trace` event ring bounds (AC-010). */
export const MIN_MAX_EVENTS = 1 as const
export const MAX_MAX_EVENTS = 2_000 as const
export const DEFAULT_MAX_EVENTS = 200 as const

/** Metro port bounds (AC-038). All ports clamp 1..65535. */
export const MIN_PORT = 1 as const
export const MAX_PORT = 65_535 as const
export const DEFAULT_METRO_PORT = 8_081 as const

/** Console / errors / request list limit bounds (AC-039). */
export const MIN_LIMIT = 1 as const
export const MAX_LIMIT = 1_000 as const
export const DEFAULT_LIMIT = 100 as const

/** Clamp `metroPort ?? 8081` into [1, 65535] (AC-038). */
export const resolveMetroPort = (metroPort: number | undefined): number =>
  clamp(metroPort ?? DEFAULT_METRO_PORT, MIN_PORT, MAX_PORT)

/** Clamp `maxEvents ?? 200` into [1, 2000] (AC-010). */
export const resolveMaxEvents = (maxEvents: number | undefined): number =>
  clamp(maxEvents ?? DEFAULT_MAX_EVENTS, MIN_MAX_EVENTS, MAX_MAX_EVENTS)

/** Clamp `limit ?? 100` into [1, 1000] (AC-039). */
export const resolveLimit = (limit: number | undefined): number =>
  clamp(limit ?? DEFAULT_LIMIT, MIN_LIMIT, MAX_LIMIT)

/** Take the LAST `n` entries of a list (AC-039). */
export const takeLast = <A>(items: ReadonlyArray<A>, n: number): ReadonlyArray<A> =>
  n >= items.length ? items : items.slice(items.length - n)

/**
 * Build a typed `CommandDescriptor` from a fully-resolved action string and a
 * literal side-effect class. The `S` generic is preserved so the `command`
 * builder can pin the handler's `R` to `CapabilityFor<S>`.
 */
export const descriptor = <S extends SideEffect>(
  action: string,
  sideEffect: S
): CommandDescriptor & { readonly sideEffect: S } => ({ action, sideEffect })
