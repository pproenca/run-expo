import { Schema } from "effect"

/**
 * Branded id types (AC-034).
 *
 * The legacy build produced ids as `<prefix>-<timestamp>-<suffix>` where the
 * suffix was `Math.random().toString(36).slice(2,8)` — NOT collision-resistant
 * (could yield <6 chars) and the timestamp format diverged three ways. The
 * reimagined build (resolved Q#16) treats ids as opaque, branded strings with
 * a SINGLE canonical timestamp format and a collision-resistant suffix.
 *
 * Brands give us nominal typing so a `SnapshotId` cannot be passed where a
 * `SessionId` is expected, even though both are strings on the wire.
 */

export const SessionId = Schema.String.pipe(Schema.brand("SessionId"))
export type SessionId = Schema.Schema.Type<typeof SessionId>

export const TargetId = Schema.String.pipe(Schema.brand("TargetId"))
export type TargetId = Schema.Schema.Type<typeof TargetId>

export const SnapshotId = Schema.String.pipe(Schema.brand("SnapshotId"))
export type SnapshotId = Schema.Schema.Type<typeof SnapshotId>

export const RunId = Schema.String.pipe(Schema.brand("RunId"))
export type RunId = Schema.Schema.Type<typeof RunId>

/** A ref handle `@e1..@eN` (AC-017). */
export const RefId = Schema.String.pipe(Schema.pattern(/^@e\d+$/), Schema.brand("RefId"))
export type RefId = Schema.Schema.Type<typeof RefId>

/**
 * Canonical timestamp format — ISO-8601 UTC with trailing `Z`. The legacy
 * `Z`-stripping / case-divergence is dropped (AC-034). We keep a single
 * `Schema.String` (rather than `Schema.Date`) because records are persisted as
 * JSON strings and round-trip must be byte-stable.
 */
export const Timestamp = Schema.String.pipe(Schema.brand("Timestamp"))
export type Timestamp = Schema.Schema.Type<typeof Timestamp>
