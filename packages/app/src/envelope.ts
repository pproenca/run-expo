import { type ExitCode, OUTPUT_BUDGET, redact, RunningTruncator, truncate } from "@expo98/core"
import { Stream } from "effect"

/**
 * Output envelope (S12). AC-041 (truncation) + AC-003/012 (redaction) applied at
 * THIS boundary via core's `redact`/`truncate`.
 *
 * Contract (AI_NATIVE_SPEC §3.2):
 *   --json  → `{ ok:true, data }` | `{ ok:false, error }`
 *   --plain → stable line-oriented output
 *   --ndjson→ one redacted JSON event per line (Stream), running-total truncation
 *
 * EVERY formatter here redacts the WHOLE value FIRST (finding M2 — never on wire
 * chunks), then enforces the single 40,000-char budget on the serialised form.
 */

/** The `--json` success / failure envelope shape. */
export type JsonEnvelope =
  | { readonly ok: true; readonly data: unknown }
  | { readonly ok: false; readonly error: string }

/**
 * Build the `--json` envelope string for a finalised command outcome.
 *
 * `exitCode === 0` ⇒ success envelope around `payload`; non-zero ⇒ failure
 * envelope around the error message. The payload is redacted then the serialised
 * line is truncated to the one canonical budget (AC-041).
 *
 * NOTE: when `payload` was already finalised by `dispatch` (redacted at the core
 * boundary), redaction here is idempotent — `[redacted]` survives a second pass.
 */
export const formatJson = (payload: unknown, exitCode: ExitCode): string => {
  const envelope: JsonEnvelope =
    exitCode === 0 ? { ok: true, data: redact(payload) } : { ok: false, error: errorString(payload) }
  return truncate(JSON.stringify(envelope), OUTPUT_BUDGET)
}

/**
 * Build stable `--plain` line output: one `key=value` line per top-level field,
 * keys sorted for determinism (AC-034 determinism intent). Redacted first; the
 * joined block truncated to the budget.
 */
export const formatPlain = (payload: unknown): string => {
  const redacted = redact(payload)
  const lines = plainLines(redacted)
  return truncate(lines.join("\n"), OUTPUT_BUDGET)
}

/** Pull a string error message out of a failure payload, redacted. */
const errorString = (payload: unknown): string => {
  const redacted = redact(payload)
  if (
    typeof redacted === "object" &&
    redacted !== null &&
    "error" in redacted &&
    typeof (redacted as { error: unknown }).error === "string"
  ) {
    return (redacted as { error: string }).error
  }
  return typeof redacted === "string" ? redacted : JSON.stringify(redacted)
}

/** Stable, line-oriented projection of a plain JSON value. */
const plainLines = (value: unknown): ReadonlyArray<string> => {
  if (value === null || value === undefined) {
    return [String(value)]
  }
  if (typeof value !== "object") {
    return [String(value)]
  }
  if (Array.isArray(value)) {
    return value.map((v, i) => `${i}=${scalar(v)}`)
  }
  const record = value as Record<string, unknown>
  return Object.keys(record)
    .sort()
    .map((key) => `${key}=${scalar(record[key])}`)
}

/** A compact, stable scalar rendering for a plain line. */
const scalar = (v: unknown): string => (typeof v === "object" && v !== null ? JSON.stringify(v) : String(v))

/**
 * AC-041 (streaming) — NDJSON progress as a `Stream<string>`.
 *
 * Each event is redacted as a WHOLE value, serialised to one JSON line, and
 * admitted through ONE `RunningTruncator` whose 40,000-char budget is a RUNNING
 * TOTAL across the whole stream with a single terminal overflow marker (M2).
 * Empty admissions (post-overflow) are dropped.
 *
 * This mirrors core's `ndjsonStream` but is exposed at the shell boundary so the
 * CLI can pipe a handler's progress `Stream` straight to stdout.
 */
export const ndjsonEnvelope = <E, R>(events: Stream.Stream<unknown, E, R>): Stream.Stream<string, E, R> =>
  Stream.suspend(() => {
    const budget = new RunningTruncator()
    return events.pipe(
      Stream.map((event) => budget.push(JSON.stringify(redact(event)) + "\n")),
      Stream.filter((emitted) => emitted.length > 0),
    )
  })

/** Which channel a `CliGlobals` selects. `--ndjson` wins, then `--plain`, else json. */
export type OutputMode = "json" | "plain" | "ndjson"

export const selectMode = (globals: {
  readonly json: boolean
  readonly plain: boolean
  readonly ndjson: boolean
}): OutputMode => (globals.ndjson ? "ndjson" : globals.plain ? "plain" : "json")
