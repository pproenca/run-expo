/**
 * Shared support for the D12 artifacts/review/observability/orchestration handlers.
 *
 * - `descriptor`: the same typed-descriptor helper the devtools package uses, so
 *   each command carries a REQUIRED, literal `sideEffect` and the `command`
 *   builder can pin the handler's `R` to `CapabilityFor<S>`. Every D12 command in
 *   this package is `read` (R = never): they read evidence / files / state, never
 *   inject JS or drive the device.
 * - Canonical key-cap constants for AC-042 (backlog 20, run-record 40).
 *
 * NOTE on the dropped scope: video `record` and the in-app HTML overlay scaffold
 * are NOT here (Phase B). This package owns the read-only artifacts/review/
 * observability/orchestration surface only.
 */
import type { CommandDescriptor, SideEffect } from "@expo98/core"

/** AC-042: live-backlog payload summary caps to the first 20 top-level keys. */
export const BACKLOG_SUMMARY_KEY_CAP = 20 as const

/** AC-042: run-record payload summary caps to the first 40 top-level keys. */
export const RUN_RECORD_SUMMARY_KEY_CAP = 40 as const

/**
 * Build a typed `CommandDescriptor` from a fully-resolved action string and a
 * literal side-effect class. The `S` generic is preserved so the `command`
 * builder pins the handler's `R` to `CapabilityFor<S>`. Every D12 command in this
 * package passes `"read"`, so its handler `R` is `never`.
 */
export const descriptor = <S extends SideEffect>(
  action: string,
  sideEffect: S,
): CommandDescriptor & { readonly sideEffect: S } => ({ action, sideEffect })
