/**
 * AC-042 — run/backlog payload summaries cap the key list.
 *
 * A persisted/displayed payload summary lists only the first N top-level keys
 * plus rollups:
 *   - run records:  `Object.keys(payload).slice(0, 40)` + `available` /
 *                   `routeCount` / `eventCount`   (the run-record side)
 *   - live-backlog: `Object.keys(payload).slice(0, 20)` + rollups
 *
 * The run-record shape REUSES the domain's `RunPayloadSummary` schema type
 * (`@expo98/domain`) — there is no behavioural helper in core/domain that builds
 * it, only the `Schema.Struct` for persistence, so this module implements the
 * builder. (Overlap note: the cap value 40 is mirrored by `RUN_RECORD_SUMMARY_KEY_CAP`
 * here and by the AC-042 comment on `RunPayloadSummary` in domain; the schema is
 * the persisted shape, this is the calculation.)
 */
import type { RunPayloadSummary } from "@expo98/domain"
import {
  BACKLOG_SUMMARY_KEY_CAP,
  RUN_RECORD_SUMMARY_KEY_CAP
} from "./support.js"

/** Top-level keys of a payload, in insertion order. Non-objects ⇒ no keys. */
const topLevelKeys = (payload: unknown): ReadonlyArray<string> =>
  payload !== null && typeof payload === "object" && !Array.isArray(payload)
    ? Object.keys(payload as Record<string, unknown>)
    : []

/** Read an optional numeric rollup field off a payload (else undefined). */
const numberField = (
  payload: unknown,
  field: string
): number | undefined => {
  if (payload === null || typeof payload !== "object") {
    return undefined
  }
  const value = (payload as Record<string, unknown>)[field]
  return typeof value === "number" ? value : undefined
}

/** Read the optional boolean `available` rollup off a payload (else undefined). */
const availableField = (payload: unknown): boolean | undefined => {
  if (payload === null || typeof payload !== "object") {
    return undefined
  }
  const value = (payload as Record<string, unknown>).available
  return typeof value === "boolean" ? value : undefined
}

/**
 * AC-042 (run-record side) — `keys.slice(0, 40)` + `available`/`routeCount`/
 * `eventCount` rollups. The result is exactly the domain `RunPayloadSummary`
 * shape, so it persists into a `RunRecord.summary` field unchanged.
 *
 * `available`/`routeCount`/`eventCount` are emitted ONLY when present on the
 * payload (the domain schema marks them optional).
 */
export const summarizeRunRecordPayload = (payload: unknown): RunPayloadSummary => {
  const keys = topLevelKeys(payload).slice(0, RUN_RECORD_SUMMARY_KEY_CAP)
  const available = availableField(payload)
  const routeCount = numberField(payload, "routeCount")
  const eventCount = numberField(payload, "eventCount")
  return {
    keys,
    ...(available === undefined ? {} : { available }),
    ...(routeCount === undefined ? {} : { routeCount }),
    ...(eventCount === undefined ? {} : { eventCount })
  }
}

/**
 * A live-backlog summary's row-classification rollups (AC-042 + AC-057 counts).
 * `rowCount` is the number of classified rows; `byClassification` is the count
 * per classification label.
 */
export interface BacklogSummary {
  /** `Object.keys(payload).slice(0, 20)` — the capped top-level key list. */
  readonly keys: ReadonlyArray<string>
  /** Total classified rows. */
  readonly rowCount: number
  /** Count per classification label (AC-057). */
  readonly byClassification: Readonly<Record<string, number>>
}

/**
 * AC-042 (backlog side) — `keys.slice(0, 20)` + classification rollups. The
 * payload is the full backlog run payload; the classification labels are read
 * from `payload.rows[].classification` when present.
 */
export const summarizeBacklogPayload = (payload: unknown): BacklogSummary => {
  const keys = topLevelKeys(payload).slice(0, BACKLOG_SUMMARY_KEY_CAP)
  const rows = rowsOf(payload)
  const byClassification: Record<string, number> = {}
  for (const row of rows) {
    const label = classificationOf(row)
    if (label !== undefined) {
      byClassification[label] = (byClassification[label] ?? 0) + 1
    }
  }
  return { keys, rowCount: rows.length, byClassification }
}

const rowsOf = (payload: unknown): ReadonlyArray<unknown> => {
  if (payload === null || typeof payload !== "object") {
    return []
  }
  const rows = (payload as Record<string, unknown>).rows
  return Array.isArray(rows) ? rows : []
}

const classificationOf = (row: unknown): string | undefined => {
  if (row === null || typeof row !== "object") {
    return undefined
  }
  const value = (row as Record<string, unknown>).classification
  return typeof value === "string" ? value : undefined
}
