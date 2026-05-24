import { Effect } from "effect"
import { EmptySessionName, InvalidDuration } from "./errors.js"
import type { SessionId, SnapshotId } from "./ids.js"

/**
 * Name / duration / id calculation rules (AC-043, AC-034).
 *
 * These are pure value functions over strings + a clock seam, kept separate
 * from Schema so they can be unit-tested directly. The `IdGen` seam below makes
 * id production deterministic in tests.
 */

export const DEFAULT_SESSION_NAME = "review"
export const MAX_SESSION_NAME = 48
export const DEFAULT_CLEAN_AGE = "7d"

/**
 * AC-043 session-name normalisation pipeline:
 *   lowercase → replace `[^a-z0-9_.-]+` with `-` → trim leading/trailing `-`
 *   → throw if empty → slice(0, 48).
 */
export const normalizeSessionName = (
  raw: string | undefined
): Effect.Effect<string, EmptySessionName> => {
  const input = raw ?? DEFAULT_SESSION_NAME
  const normalized = input
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
  if (normalized.length === 0) {
    return Effect.fail(new EmptySessionName({ input }))
  }
  return Effect.succeed(normalized.slice(0, MAX_SESSION_NAME))
}

const DURATION_UNITS: Record<string, number> = {
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000
}

/** AC-043 duration parse: `^(\d+)([smhd])$` × unit-ms, else fail. */
export const parseDuration = (input: string): Effect.Effect<number, InvalidDuration> => {
  const m = /^(\d+)([smhd])$/.exec(input)
  if (m === null) return Effect.fail(new InvalidDuration({ input }))
  const value = Number(m[1])
  const unit = DURATION_UNITS[m[2] as string]
  if (unit === undefined || !Number.isFinite(value)) {
    return Effect.fail(new InvalidDuration({ input }))
  }
  return Effect.succeed(value * unit)
}

/**
 * AC-034 id format: `<prefix>-<timestamp>-<suffix>`.
 *
 * FIX vs legacy: a SINGLE canonical timestamp format (ISO-8601 UTC, no
 * `Z`-stripping, no case divergence) and a collision-resistant suffix. The
 * legacy `Math.random().toString(36).slice(2,8)` could yield <6 chars and was
 * not collision-resistant; we require a fixed-width hex suffix.
 *
 * `nowIso` and `suffix` are injected so tests can assert the produced shape
 * deterministically (this is the `Clock`/`Id` seam S3 owns in @expo98/core).
 */
export interface IdParts {
  readonly prefix: string
  readonly nowIso: string
  readonly suffix: string
}

/** Compact a canonical ISO timestamp into an id-safe segment (no `:`/`.`). */
export const idTimestampSegment = (nowIso: string): string =>
  nowIso.replace(/[:.]/g, "-")

export const makeEvidenceId = ({ prefix, nowIso, suffix }: IdParts): string =>
  `${prefix}-${idTimestampSegment(nowIso)}-${suffix}`

export const makeSessionId = (name: string, nowIso: string, suffix: string): SessionId =>
  makeEvidenceId({ prefix: name, nowIso, suffix }) as SessionId

export const makeSnapshotId = (nowIso: string, suffix: string): SnapshotId =>
  makeEvidenceId({ prefix: "snapshot", nowIso, suffix }) as SnapshotId

/**
 * AC-018 target id composition:
 *   [platform, device.id, appId||metroId||metroTitle||"no-runtime",
 *    metroPort||"no-metro"].join(":")
 */
export const composeTargetId = (input: {
  readonly platform: string
  readonly deviceId: string
  readonly appId?: string | null
  readonly metroId?: string | null
  readonly metroTitle?: string | null
  readonly metroPort?: number | null
}): string => {
  const runtime =
    input.appId || input.metroId || input.metroTitle || "no-runtime"
  const port =
    input.metroPort === null || input.metroPort === undefined
      ? "no-metro"
      : String(input.metroPort)
  return [input.platform, input.deviceId, runtime, port].join(":")
}
