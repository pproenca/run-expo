import { Data } from "effect"

/**
 * Persistence (S7) error taxonomy.
 *
 * NOTE (parallel-safety): @expo98/core defines its own `CliUsageError` /
 * `CliRuntimeError` / `PolicyDenied` family. We deliberately DO NOT import them
 * here so this package typechecks independently of core's in-flight API. These
 * persistence errors map cleanly onto core's exit-code classifier at the
 * dispatch boundary (a CliRuntimeError → exit 1).
 *
 * // INTEGRATION SEAM (@expo98/core): the dispatcher will adapt these tagged
 * // errors to core's `DomainError` union / `exitCodeForError`. None of them
 * // is a usage error, so all map to exit code 1.
 */

/** A requested session/target/snapshot/run was not found on disk. */
export class NotFound extends Data.TaggedError("NotFound")<{
  readonly entity: "session" | "target" | "snapshot" | "refcache" | "run"
  readonly id: string
}> {}

/** A persisted JSON file failed strict Schema decoding (corrupt / drifted). */
export class CorruptRecord extends Data.TaggedError("CorruptRecord")<{
  readonly path: string
  readonly reason: string
}> {}

/** A raw filesystem operation failed (read/write/list/remove). */
export class StorageFailure extends Data.TaggedError("StorageFailure")<{
  readonly op: "read" | "write" | "list" | "remove" | "exists" | "mkdir"
  readonly path: string
  readonly reason: string
}> {}

/**
 * One of the three Session pointer invariants would be violated by a write
 * (AC-026): `activeTargetId`→target.json, `lastSnapshotId`→existing snapshot,
 * `refs.json` mirrors `lastSnapshotId`.
 */
export class InvariantViolation extends Data.TaggedError("InvariantViolation")<{
  readonly invariant:
    | "activeTargetId-points-at-target"
    | "lastSnapshotId-points-at-snapshot"
    | "refcache-mirrors-lastSnapshotId"
    | "snapshot-target-matches-active-target"
  readonly sessionId: string
  readonly detail: string
}> {}

/** A supplied session name normalised to empty (AC-043). */
export class EmptySessionName extends Data.TaggedError("EmptySessionName")<{
  readonly input: string
}> {}

/** A duration string did not match `^(\d+)([smhd])$` (AC-043). */
export class InvalidDuration extends Data.TaggedError("InvalidDuration")<{
  readonly input: string
}> {}

/** The union of every error S7 Persistence can surface. */
export type PersistenceError =
  | NotFound
  | CorruptRecord
  | StorageFailure
  | InvariantViolation
  | EmptySessionName
  | InvalidDuration
