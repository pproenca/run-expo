/**
 * Shared support for the D8 snapshot/accessibility/RN-introspection handlers.
 *
 * - `clamp` (re-exported from `@expo98/protocols`) and the canonical parameter
 *   bounds (AC-040 snapshot depth, AC-055 RN caps, AC-019 capture timeouts).
 * - `descriptor`: a typed `CommandDescriptor` builder preserving the `S` generic
 *   so core's `command` helper can pin the handler's `R` to `CapabilityFor<S>`.
 * - The capability SEAMS for capture: a semantic-bridge probe (CDP `HermesEvidence`)
 *   and a native `axe describe-ui` probe (subprocess). Both are documented seams
 *   modelled as `Context.Tag`s so the live transport is injected, never imported.
 *
 * NOTE on the capability model: every command in this package is `read`. Capture
 * reaches its evidence over a READ surface (package-controlled semantic probe or
 * a native `axe` CLI subprocess) — never the dispatcher-withheld runtime-eval
 * mutation surface. The handlers therefore keep `R = never` w.r.t. core's
 * dangerous capability tags; capture I/O arrives via these package-local SEAM tags.
 */
import type { CommandDescriptor, SideEffect } from "@expo98/core"
import { clamp } from "@expo98/protocols"
import { Context, type Effect } from "effect"

export { clamp }

// ── AC-019 capture timeouts / buffers ──────────────────────────────────────

/** Semantic-bridge (CDP `HermesEvidence`) read-eval timeout (AC-019). */
export const SEMANTIC_EVAL_TIMEOUT_MS = 5_000 as const

/** Native `axe describe-ui` subprocess timeout (AC-019). */
export const NATIVE_AXE_TIMEOUT_MS = 12_000 as const

/** Native `axe describe-ui` subprocess output ceiling: 4 MiB (AC-019). */
export const NATIVE_AXE_MAX_BUFFER = 4_194_304 as const

// ── AC-040 snapshot depth filter bounds ────────────────────────────────────

export const MIN_DEPTH = 1 as const
export const MAX_DEPTH = 100 as const

/** AC-040: depth is `null` (unbounded) or `clamp(args.depth, 1, 100)`. */
export const resolveDepth = (depth: number | null | undefined): number | null =>
  depth === null || depth === undefined ? null : clamp(depth, MIN_DEPTH, MAX_DEPTH)

// ── AC-055 RN introspection caps ───────────────────────────────────────────

/** `maxDepth = max(1, min(depth ?? 30, 80))`. */
export const DEFAULT_RN_DEPTH = 30 as const
export const MAX_RN_DEPTH = 80 as const
export const resolveRnMaxDepth = (depth: number | undefined): number =>
  Math.max(1, Math.min(depth ?? DEFAULT_RN_DEPTH, MAX_RN_DEPTH))

/** `maxNodes = max(1, min(limit ?? 500, 2000))`. */
export const DEFAULT_RN_NODES = 500 as const
export const MAX_RN_NODES = 2_000 as const
export const resolveRnMaxNodes = (limit: number | undefined): number =>
  Math.max(1, Math.min(limit ?? DEFAULT_RN_NODES, MAX_RN_NODES))

/** Ancestor path cap: traverse at most 40 deep, then slice 16..24 (AC-055). */
export const ANCESTOR_PATH_DEPTH_CAP = 40 as const
export const ANCESTOR_SLICE_HEAD = 16 as const
export const ANCESTOR_SLICE_TAIL = 24 as const

/** control / record list caps (AC-055). */
export const CONTROL_LIST_CAP = 80 as const
export const RECORD_LIST_CAP = 60 as const

/** Element action list cap (AC-055). */
export const ELEMENT_ACTIONS_CAP = 10 as const

/** AC-055: `round(v) = Math.round(v * 100) / 100`. */
export const round = (v: number): number => Math.round(v * 100) / 100

/**
 * Build a typed `CommandDescriptor` from an action string and a literal
 * side-effect class. Preserves `S` so `command` can pin the handler's `R`.
 */
export const descriptor = <S extends SideEffect>(
  action: string,
  sideEffect: S
): CommandDescriptor & { readonly sideEffect: S } => ({ action, sideEffect })

// ── Capture capability SEAMS (documented; the live transport is injected) ───

/** A semantic-bridge ref harvested from the in-app accessibility bridge. */
export interface SemanticRef {
  readonly role?: string | null
  readonly label?: string | null
  readonly text?: string | null
  readonly testID?: string | null
  readonly nativeID?: string | null
  readonly box?: { readonly x: number; readonly y: number; readonly width: number; readonly height: number } | null
  readonly actions?: ReadonlyArray<string>
}

/** The raw payload the semantic bridge returns (before renumbering to @e1..@eN). */
export interface SemanticCapturePayload {
  readonly routeHint?: string | null
  readonly refs: ReadonlyArray<SemanticRef>
  readonly limitations: ReadonlyArray<string>
}

/**
 * SEAM 1 — the semantic-bridge capture surface (AC-019 primary path).
 *
 * Implemented in a live build over CDP `HermesEvidence.evaluateReadOnly` with a
 * FIXED, package-controlled expression and a 5000ms timeout. It is modelled as a
 * `read` capability: the expression is never caller-supplied, so this is NOT the
 * dispatcher-withheld runtime-eval surface. `null` signals "bridge unavailable"
 * so the orchestrator can fall back to native `axe`.
 */
export interface SemanticCaptureService {
  readonly capture: () => Effect.Effect<SemanticCapturePayload | null>
}

export class SemanticCapture extends Context.Tag(
  "@expo98/handlers-snapshot/SemanticCapture"
)<SemanticCapture, SemanticCaptureService>() {}

/** The native `axe describe-ui` element shape (subset we map to a snapshot). */
export interface NativeAxeElement {
  readonly role?: string | null
  readonly label?: string | null
  readonly text?: string | null
  readonly testID?: string | null
  readonly nativeID?: string | null
  readonly box?: { readonly x: number; readonly y: number; readonly width: number; readonly height: number } | null
  readonly actions?: ReadonlyArray<string>
}

/** The result of probing for / running the native `axe` CLI. */
export type NativeAxeResult =
  | { readonly _tag: "absent" }
  | { readonly _tag: "transport-failure"; readonly reason: string }
  | { readonly _tag: "ok"; readonly elements: ReadonlyArray<NativeAxeElement> }

/**
 * SEAM 2 — the native `axe describe-ui` capture surface (AC-019 fallback).
 *
 * Implemented in a live build over core's `Subprocess` service running
 * `axe describe-ui` with a 12000ms timeout and a 4 MiB maxBuffer. `absent` means
 * the CLI is not installed (fall through to unavailable), `transport-failure`
 * means it ran but failed, `ok` carries the parsed element list.
 */
export interface NativeAxeService {
  readonly describeUi: () => Effect.Effect<NativeAxeResult>
}

export class NativeAxe extends Context.Tag(
  "@expo98/handlers-snapshot/NativeAxe"
)<NativeAxe, NativeAxeService>() {}
