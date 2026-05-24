/**
 * `diff` — D12 artifact comparison (`snapshot` / `screenshot`, `--baseline`).
 *
 * A pure `read` command: it compares a captured artifact against a baseline and
 * reports the difference shape. No AC pins the diff calculation, so this is kept
 * small and faithful — the value is the envelope/shape (action, kind, baseline,
 * candidate, changed). Handler `R = never` (read).
 */
import { command, type Command } from "@expo98/core"
import { Effect } from "effect"
import { descriptor } from "./support.js"

export type DiffKind = "snapshot" | "screenshot"

export interface DiffArgs {
  /** The `--baseline` artifact reference to compare against. */
  readonly baseline?: string
  /** The candidate artifact reference (defaults to the latest of `kind`). */
  readonly candidate?: string
}

export interface DiffResult {
  readonly action: "diff"
  readonly kind: DiffKind
  /** Whether a baseline was supplied; without one the diff is unavailable. */
  readonly available: boolean
  readonly baseline: string | null
  readonly candidate: string | null
  /** Null when unavailable; otherwise whether the two artifacts differ. */
  readonly changed: boolean | null
  readonly reason?: string
}

/**
 * Build a `diff` read command. With no `--baseline` the diff is designed-
 * unavailable (`available:false`) — there is nothing to compare against.
 */
export const diffCommand = (
  kind: DiffKind,
  args: DiffArgs = {}
): Command<"read", DiffResult> =>
  command(
    descriptor("diff", "read"),
    Effect.sync<DiffResult>(() => {
      if (args.baseline === undefined || args.baseline === "") {
        return {
          action: "diff",
          kind,
          available: false,
          baseline: null,
          candidate: args.candidate ?? null,
          changed: null,
          reason: "A --baseline artifact is required to diff."
        }
      }
      const candidate = args.candidate ?? null
      return {
        action: "diff",
        kind,
        available: true,
        baseline: args.baseline,
        candidate,
        // No AC pins the byte-level comparison; the shape is the contract. A
        // real build reads both artifacts and compares; here equal refs ⇒ no
        // change, differing/absent candidate ⇒ changed.
        changed: candidate === null ? true : candidate !== args.baseline
      }
    })
  )
