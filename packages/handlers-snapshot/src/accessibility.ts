/**
 * `accessibility` — D8 accessibility `tree` / `audit` (AC-023).
 *
 * Both verbs are pure `read`s over the persisted RefCache (no capability, no
 * policy; handler `R = never`). The cache is supplied by the shell (it reads
 * `refs.json` via domain persistence) so this module stays a pure projection.
 *
 * AC-023 audit rule `interactive-name`: a cached ref with `actions.length > 0`
 * and NO `label` and NO `text` is flagged. With no snapshot/ref cache the result
 * is `available:false`.
 */
import { command, type Command } from "@expo98/core"
import type { RefCache, RefRecord } from "@expo98/domain"
import { Effect } from "effect"
import { descriptor } from "./support.js"

export type AccessibilityVerb = "tree" | "audit"

/** A single accessibility finding. */
export interface AccessibilityFinding {
  readonly ref: string
  readonly rule: "interactive-name"
  readonly message: string
}

export const INTERACTIVE_NAME_MESSAGE = "Interactive ref has no label or text." as const

/** A flat accessibility tree row projected from a cached ref. */
export interface AccessibilityTreeRow {
  readonly ref: string
  readonly role: string | null
  readonly label: string | null
  readonly text: string | null
  readonly actions: ReadonlyArray<string>
}

export interface AccessibilityUnavailable {
  readonly available: false
  readonly action: string
  readonly reason: string
}

export interface AccessibilityTreeResult {
  readonly available: true
  readonly action: "accessibility.tree"
  readonly snapshotId: string
  readonly rows: ReadonlyArray<AccessibilityTreeRow>
}

export interface AccessibilityAuditResult {
  readonly available: true
  readonly action: "accessibility.audit"
  readonly snapshotId: string
  readonly findings: ReadonlyArray<AccessibilityFinding>
}

export type AccessibilityResult = AccessibilityUnavailable | AccessibilityTreeResult | AccessibilityAuditResult

const NO_CACHE_REASON = "No snapshot or ref cache available. Capture a snapshot first."

/**
 * AC-023: a ref is interactive-but-unnamed iff it has ≥1 action and neither a
 * `label` nor a `text`. PURE — exported for direct unit assertions.
 */
export const isInteractiveUnnamed = (ref: RefRecord): boolean =>
  ref.actions.length > 0 &&
  (ref.label === null || ref.label.length === 0) &&
  (ref.text === null || ref.text.length === 0)

/** Project the cached refs into a flat accessibility tree (AC-023 `tree`). */
const buildTree = (cache: RefCache): ReadonlyArray<AccessibilityTreeRow> =>
  cache.refs.map((r) => ({
    ref: r.ref,
    role: r.role,
    label: r.label,
    text: r.text,
    actions: r.actions,
  }))

/** Run the `interactive-name` audit over the cached refs (AC-023 `audit`). */
const runAudit = (cache: RefCache): ReadonlyArray<AccessibilityFinding> =>
  cache.refs.filter(isInteractiveUnnamed).map((r) => ({
    ref: r.ref,
    rule: "interactive-name" as const,
    message: INTERACTIVE_NAME_MESSAGE,
  }))

/**
 * Compute the accessibility result for a verb against a (possibly null) cache.
 * No cache ⇒ unavailable (AC-023 edge). PURE.
 */
export const accessibilityResult = (verb: AccessibilityVerb, cache: RefCache | null): AccessibilityResult => {
  if (cache === null) {
    return { available: false, action: `accessibility.${verb}`, reason: NO_CACHE_REASON }
  }
  return verb === "tree"
    ? {
        available: true,
        action: "accessibility.tree",
        snapshotId: cache.snapshotId,
        rows: buildTree(cache),
      }
    : {
        available: true,
        action: "accessibility.audit",
        snapshotId: cache.snapshotId,
        findings: runAudit(cache),
      }
}

/**
 * Build the `accessibility.<verb>` read command from a cache (or null). The
 * projection is computed at construction time so the handler is a pure `read`
 * (R = never) — the cache is read from `refs.json` by the shell beforehand.
 */
export const accessibilityCommand = (
  verb: AccessibilityVerb,
  cache: RefCache | null,
): Command<"read", AccessibilityResult> =>
  command(descriptor(`accessibility.${verb}`, "read"), Effect.succeed(accessibilityResult(verb, cache)))
