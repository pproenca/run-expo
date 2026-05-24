/**
 * `review` — D12 review artifacts (`report` / `matrix`).
 *
 * A pure `read` command that renders a review `report` or `matrix` from captured
 * evidence. No AC pins the rendering calculation, so this is kept small and
 * faithful — the contract is the envelope/shape (action, verb, and the rendered
 * rows/sections). Handler `R = never` (read).
 */
import { command, type Command } from "@expo98/core"
import { Effect } from "effect"
import { descriptor } from "./support.js"

export type ReviewVerb = "report" | "matrix"

export interface ReviewArgs {
  /** Evidence entries to render (opaque rows; shape is the caller's). */
  readonly entries?: ReadonlyArray<unknown>
}

export interface ReviewResult {
  readonly action: "review"
  readonly verb: ReviewVerb
  readonly entryCount: number
  readonly entries: ReadonlyArray<unknown>
}

/** Build a `review report`/`review matrix` read command over captured evidence. */
export const reviewCommand = (verb: ReviewVerb, args: ReviewArgs = {}): Command<"read", ReviewResult> => {
  const entries = args.entries ?? []
  return command(
    descriptor(`review.${verb}`, "read"),
    Effect.succeed<ReviewResult>({
      action: "review",
      verb,
      entryCount: entries.length,
      entries,
    }),
  )
}
