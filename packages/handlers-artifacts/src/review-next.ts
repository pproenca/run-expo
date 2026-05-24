/**
 * `review-next` — D12 next-step guidance (`--surface` / `--stage` / `--issue`).
 *
 * A pure `read` command that echoes the review context (surface/stage/issue) and
 * returns a small ordered next-step list. No AC pins the guidance calculation, so
 * this is kept small and faithful — the contract is the envelope/shape. Handler
 * `R = never` (read).
 */
import { command, type Command } from "@expo98/core"
import { Effect } from "effect"
import { descriptor } from "./support.js"

export interface ReviewNextArgs {
  readonly surface?: string
  readonly stage?: string
  readonly issue?: string
}

export interface ReviewNextResult {
  readonly action: "review-next"
  readonly surface: string | null
  readonly stage: string | null
  readonly issue: string | null
  /** Ordered next-step suggestions derived from the supplied context. */
  readonly steps: ReadonlyArray<string>
}

/** Build a `review-next` read command from the review context flags. */
export const reviewNextCommand = (
  args: ReviewNextArgs = {}
): Command<"read", ReviewNextResult> =>
  command(
    descriptor("review-next", "read"),
    Effect.sync<ReviewNextResult>(() => {
      const surface = args.surface ?? null
      const stage = args.stage ?? null
      const issue = args.issue ?? null
      const steps: Array<string> = []
      if (surface !== null) {
        steps.push(`Capture evidence for surface "${surface}".`)
      }
      if (stage !== null) {
        steps.push(`Advance the "${stage}" review stage.`)
      }
      if (issue !== null) {
        steps.push(`Reproduce and document issue "${issue}".`)
      }
      if (steps.length === 0) {
        steps.push("Provide --surface, --stage, or --issue for targeted guidance.")
      }
      return { action: "review-next", surface, stage, issue, steps }
    })
  )
