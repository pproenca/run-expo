/**
 * Shared support for the D6 (lifecycle) + D7 (interaction) handlers.
 *
 * - `descriptor`: build a typed `CommandDescriptor` whose `sideEffect` literal is
 *   preserved so `command(...)` can pin a handler's `R` to `CapabilityFor<S>`.
 * - The canonical clamp bounds for the gesture / scroll / screenshot / wait / crash
 *   calculations (AC-035/036/037/054/056).
 *
 * NOTE on the capability seam (THE design rule): handlers in this package depend
 * ONLY on core's `DeviceCapability` / `RuntimeEvalCapability` tags, which the
 * dispatcher injects into `R` on the gate-pass branch for the matching class. They
 * NEVER import `@expo98/protocols`' CDP eval surface (`HermesRuntimeEval`) or any
 * subprocess module directly — that would re-introduce the legacy ungated path the
 * rebuild exists to delete.
 */
import type { CommandDescriptor, SideEffect } from "@expo98/core"
import { clamp } from "@expo98/protocols"

export { clamp }

// ── Metro port (AC-038). All ports clamp 1..65535. ──
export const MIN_PORT = 1 as const
export const MAX_PORT = 65_535 as const
export const DEFAULT_METRO_PORT = 8_081 as const

/** Clamp `metroPort ?? 8081` into [1, 65535] (AC-038). */
export const resolveMetroPort = (metroPort: number | undefined): number =>
  clamp(metroPort ?? DEFAULT_METRO_PORT, MIN_PORT, MAX_PORT)

/**
 * Build a typed `CommandDescriptor` from a fully-resolved action string and a
 * literal side-effect class. The `S` generic is preserved so the `command`
 * builder can pin the handler's `R` to `CapabilityFor<S>`.
 */
export const descriptor = <S extends SideEffect>(
  action: string,
  sideEffect: S,
): CommandDescriptor & { readonly sideEffect: S } => ({ action, sideEffect })
