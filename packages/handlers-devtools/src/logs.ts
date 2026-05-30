/**
 * `console` / `errors` — D10 log readers (AC-039).
 *
 * Both are pure `read` commands: no policy required, no dangerous capability in
 * `R` (handler `R = never`). The limit is `clamp(args.limit ?? 100, 1, 1000)` and
 * the result is the LAST N entries (AC-039).
 */
import { command, type Command } from "@expo98/core"
import { Effect } from "effect"
import { descriptor, resolveLimit, takeLast } from "./support.js"

export type LogStream = "console" | "errors"

export interface LogEntry {
  readonly level: string
  readonly message: string
  readonly timestamp: number
}

export interface LogArgs {
  readonly limit?: number
  /** The captured buffer (in a real build, harvested via `HermesEvidence`). */
  readonly entries?: ReadonlyArray<LogEntry>
}

export interface LogResult {
  readonly action: string
  readonly stream: LogStream
  readonly available: boolean
  readonly reason?: string
  readonly limit: number
  readonly entries: ReadonlyArray<LogEntry>
}

/**
 * Build a `console`/`errors` read command. The clamp + take-last is applied at
 * construction time so the handler stays a pure `read` (R = never).
 */
export const logsCommand = (stream: LogStream, args: LogArgs = {}): Command<"read", LogResult> => {
  const limit = resolveLimit(args.limit)
  const hasEvidence = args.entries !== undefined
  const entries = takeLast(args.entries ?? [], limit)
  const action = stream
  return command(
    descriptor(action, "read"),
    Effect.succeed<LogResult>({
      action,
      stream,
      available: hasEvidence,
      ...(hasEvidence ? {} : { reason: "No log read evidence was provided." }),
      limit,
      entries,
    }),
  )
}
