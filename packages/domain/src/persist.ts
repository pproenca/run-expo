import { Context, Effect, Layer, Schema } from "effect"
import {
  RefCache,
  RunRecord,
  SCHEMA_VERSION,
  SessionRecord,
  SnapshotResult,
  TargetRecord
} from "./entities.js"
import {
  CorruptRecord,
  InvariantViolation,
  NotFound,
  StorageFailure
} from "./errors.js"
import { Fs } from "./fs-port.js"
import type { FsPort } from "./fs-port.js"
import type { SessionId } from "./ids.js"
import {
  DEFAULT_CLEAN_AGE,
  makeSessionId,
  normalizeSessionName,
  parseDuration
} from "./naming.js"
import {
  readRefCacheLenient,
  readSessionLenient,
  readSnapshotLenient,
  readTargetLenient
} from "./migration.js"
import * as P from "./paths.js"

/**
 * S7 Persistence service (REIMAGINED_ARCHITECTURE §3, row S7).
 *
 * Schema-validated JSON repos over the four aggregates, enforcing the THREE
 * Session pointer invariants (AC-026). Reads go through the lenient migration
 * shim; writes are STRICT (encode through the canonical entity schemas).
 *
 * Depends only on the `Fs` PORT — never on `@effect/platform-node`.
 */

// ---------------------------------------------------------------------------
// Service inputs
// ---------------------------------------------------------------------------

/** Time + id seam injected by the caller (S3 Clock/Id in @expo98/core). */
export interface PersistenceClock {
  readonly nowIso: () => string
  /** Collision-resistant suffix (AC-034). */
  readonly suffix: () => string
}

export interface NewSessionInput {
  readonly stateRoot: string
  readonly name?: string
}

export interface SessionListEntry {
  readonly sessionId: string
  readonly record: SessionRecord
}

export interface CleanInput {
  readonly stateRoot: string
  /** Duration string `^(\d+)([smhd])$`; default `7d` (AC-024). */
  readonly olderThan?: string
}

// ---------------------------------------------------------------------------
// Service interface
// ---------------------------------------------------------------------------

export interface Persistence {
  // -- Session lifecycle (AC-024) -----------------------------------------
  readonly sessionNew: (
    input: NewSessionInput
  ) => Effect.Effect<SessionRecord, StorageFailure | import("./errors.js").EmptySessionName>

  readonly sessionShow: (
    stateRoot: string,
    sessionId: string
  ) => Effect.Effect<SessionRecord, NotFound | CorruptRecord | StorageFailure>

  /** Corrupt `session.json` is SKIPPED, not fatal (AC-024). */
  readonly sessionList: (
    stateRoot: string
  ) => Effect.Effect<ReadonlyArray<SessionListEntry>, StorageFailure>

  readonly sessionClose: (
    stateRoot: string,
    sessionId: string
  ) => Effect.Effect<SessionRecord, NotFound | CorruptRecord | StorageFailure>

  /** Delete dirs of sessions whose createdAt < now − olderThan (AC-024). */
  readonly sessionClean: (
    input: CleanInput
  ) => Effect.Effect<ReadonlyArray<string>, StorageFailure | import("./errors.js").InvalidDuration>

  // -- Target (AC-018) ----------------------------------------------------
  readonly targetSave: (
    stateRoot: string,
    sessionId: string,
    target: TargetRecord
  ) => Effect.Effect<SessionRecord, NotFound | CorruptRecord | StorageFailure>

  readonly targetCurrent: (
    stateRoot: string,
    sessionId: string
  ) => Effect.Effect<TargetRecord, NotFound | CorruptRecord | StorageFailure>

  // -- Snapshot + RefCache (AC-026) ---------------------------------------
  readonly snapshotPersist: (
    stateRoot: string,
    sessionId: string,
    snapshot: SnapshotResult
  ) => Effect.Effect<
    SessionRecord,
    NotFound | CorruptRecord | StorageFailure | InvariantViolation
  >

  readonly snapshotShow: (
    stateRoot: string,
    sessionId: string,
    snapshotId: string
  ) => Effect.Effect<SnapshotResult, NotFound | CorruptRecord | StorageFailure>

  readonly refCacheRead: (
    stateRoot: string,
    sessionId: string
  ) => Effect.Effect<RefCache, NotFound | CorruptRecord | StorageFailure>

  // -- Invariant verification (AC-026) ------------------------------------
  /** Assert the three Session pointer invariants hold for a session on disk. */
  readonly verifyInvariants: (
    stateRoot: string,
    sessionId: string
  ) => Effect.Effect<void, NotFound | CorruptRecord | StorageFailure | InvariantViolation>

  // -- RunRecord (AC-025) -------------------------------------------------
  readonly runStart: (
    stateDir: string,
    record: RunRecord
  ) => Effect.Effect<void, StorageFailure>

  readonly runFinish: (
    stateDir: string,
    record: RunRecord
  ) => Effect.Effect<void, StorageFailure>

  readonly runShow: (
    stateDir: string,
    runId: string
  ) => Effect.Effect<RunRecord, NotFound | CorruptRecord | StorageFailure>
}

export class PersistenceService extends Context.Tag("@expo98/domain/Persistence")<
  PersistenceService,
  Persistence
>() {}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

const encodeSession = Schema.encode(SessionRecord)
const encodeTarget = Schema.encode(TargetRecord)
const encodeSnapshot = Schema.encode(SnapshotResult)
const encodeRefCache = Schema.encode(RefCache)
const encodeRun = Schema.encode(RunRecord)
const decodeRun = Schema.decodeUnknown(RunRecord)

const writeJson =
  (fs: FsPort) =>
  (path: string, value: unknown): Effect.Effect<void, StorageFailure> =>
    fs.writeFile(path, JSON.stringify(value, null, 2))

const readJson =
  (fs: FsPort) =>
  (path: string): Effect.Effect<unknown, StorageFailure | CorruptRecord> =>
    fs.readFile(path).pipe(
      Effect.flatMap((raw) =>
        Effect.try({
          try: () => JSON.parse(raw) as unknown,
          catch: (e) => new CorruptRecord({ path, reason: `JSON.parse: ${String(e)}` })
        })
      )
    )

/**
 * Build the Persistence implementation against an injected `Fs` port + clock.
 * Exposed as a function so the CLI shell can supply a node clock and the tests
 * a deterministic one.
 */
export const makePersistence = (fs: FsPort, clock: PersistenceClock): Persistence => {
  const write = writeJson(fs)
  const read = readJson(fs)

  // -- session helpers ----------------------------------------------------
  const loadSession = (
    layout: P.Layout,
    sessionId: string
  ): Effect.Effect<SessionRecord, NotFound | CorruptRecord | StorageFailure> =>
    Effect.gen(function* () {
      const path = P.sessionFile(layout, sessionId)
      const ok = yield* fs.exists(path)
      if (!ok) return yield* Effect.fail(new NotFound({ entity: "session", id: sessionId }))
      const raw = yield* read(path)
      return yield* readSessionLenient(raw, path)
    })

  const writeSession = (
    layout: P.Layout,
    record: SessionRecord
  ): Effect.Effect<void, StorageFailure> =>
    encodeSession(record).pipe(
      Effect.orDie,
      Effect.flatMap((encoded) => write(P.sessionFile(layout, record.sessionId), encoded))
    )

  // -- invariants (AC-026) ------------------------------------------------
  const checkInvariants = (
    layout: P.Layout,
    session: SessionRecord
  ): Effect.Effect<void, StorageFailure | CorruptRecord | InvariantViolation> =>
    Effect.gen(function* () {
      const sid = session.sessionId
      // Invariant 1: activeTargetId → target.json must exist.
      if (session.activeTargetId !== null) {
        const targetPath = P.targetFile(layout, sid)
        const hasTarget = yield* fs.exists(targetPath)
        if (!hasTarget) {
          return yield* Effect.fail(
            new InvariantViolation({
              invariant: "activeTargetId-points-at-target",
              sessionId: sid,
              detail: `activeTargetId=${session.activeTargetId} but ${targetPath} is missing`
            })
          )
        }
      }
      // Invariant 2: lastSnapshotId → an existing snapshot file.
      if (session.lastSnapshotId !== null) {
        const snapPath = P.snapshotFile(layout, sid, session.lastSnapshotId)
        const hasSnap = yield* fs.exists(snapPath)
        if (!hasSnap) {
          return yield* Effect.fail(
            new InvariantViolation({
              invariant: "lastSnapshotId-points-at-snapshot",
              sessionId: sid,
              detail: `lastSnapshotId=${session.lastSnapshotId} but ${snapPath} is missing`
            })
          )
        }
        // Invariant 3: refs.json mirrors lastSnapshotId.
        const refsPath = P.refsFile(layout, sid)
        const hasRefs = yield* fs.exists(refsPath)
        if (!hasRefs) {
          return yield* Effect.fail(
            new InvariantViolation({
              invariant: "refcache-mirrors-lastSnapshotId",
              sessionId: sid,
              detail: `refs.json missing while lastSnapshotId=${session.lastSnapshotId}`
            })
          )
        }
        const refsRaw = yield* read(refsPath)
        const cache = yield* readRefCacheLenient(refsRaw, refsPath)
        if (cache.snapshotId !== session.lastSnapshotId) {
          return yield* Effect.fail(
            new InvariantViolation({
              invariant: "refcache-mirrors-lastSnapshotId",
              sessionId: sid,
              detail: `refs.json.snapshotId=${cache.snapshotId} != lastSnapshotId=${session.lastSnapshotId}`
            })
          )
        }
      }
    })

  // -- public methods -----------------------------------------------------

  const sessionNew: Persistence["sessionNew"] = (input) =>
    Effect.gen(function* () {
      const name = yield* normalizeSessionName(input.name)
      const nowIso = clock.nowIso()
      const sessionId = makeSessionId(name, nowIso, clock.suffix())
      const layout = P.makeLayout(input.stateRoot)
      const record: SessionRecord = {
        schemaVersion: SCHEMA_VERSION,
        sessionId,
        name,
        artifactDir: P.artifactsDir(layout, sessionId),
        createdAt: nowIso,
        updatedAt: nowIso,
        activeTargetId: null,
        lastSnapshotId: null,
        sidecars: []
      }
      yield* fs.mkdirp(P.artifactsDir(layout, sessionId))
      yield* writeSession(layout, record)
      return record
    })

  const sessionShow: Persistence["sessionShow"] = (stateRoot, sessionId) =>
    loadSession(P.makeLayout(stateRoot), sessionId)

  const sessionList: Persistence["sessionList"] = (stateRoot) =>
    Effect.gen(function* () {
      const layout = P.makeLayout(stateRoot)
      const dir = P.sessionsDir(layout)
      const dirExists = yield* fs.exists(dir)
      if (!dirExists) return []
      const ids = yield* fs.readDir(dir)
      const out: Array<SessionListEntry> = []
      for (const id of ids) {
        // AC-024: corrupt session.json is SKIPPED on list, not fatal.
        const maybe = yield* loadSession(layout, id).pipe(
          Effect.map((record) => ({ sessionId: id, record })),
          Effect.catchTags({
            NotFound: () => Effect.succeed(null),
            CorruptRecord: () => Effect.succeed(null)
          })
        )
        if (maybe !== null) out.push(maybe)
      }
      return out
    })

  const sessionClose: Persistence["sessionClose"] = (stateRoot, sessionId) =>
    Effect.gen(function* () {
      const layout = P.makeLayout(stateRoot)
      const session = yield* loadSession(layout, sessionId)
      const closedAt = clock.nowIso()
      const updated: SessionRecord = {
        ...session,
        closedAt,
        updatedAt: closedAt,
        // AC-024: clear sidecars on close (record retained).
        sidecars: []
      }
      yield* writeSession(layout, updated)
      return updated
    })

  const sessionClean: Persistence["sessionClean"] = (input) =>
    Effect.gen(function* () {
      const olderThanMs = yield* parseDuration(input.olderThan ?? DEFAULT_CLEAN_AGE)
      const layout = P.makeLayout(input.stateRoot)
      const dir = P.sessionsDir(layout)
      const dirExists = yield* fs.exists(dir)
      if (!dirExists) return []
      const ids = yield* fs.readDir(dir)
      const cutoff = Date.parse(clock.nowIso()) - olderThanMs
      const deleted: Array<string> = []
      for (const id of ids) {
        const loaded = yield* loadSession(layout, id).pipe(
          Effect.map((r): SessionRecord | null => r),
          Effect.catchTags({
            NotFound: () => Effect.succeed(null),
            CorruptRecord: () => Effect.succeed(null)
          })
        )
        // Corrupt/unreadable → not deleted. Missing createdAt → not deleted.
        if (loaded === null) continue
        const created = Date.parse(loaded.createdAt)
        if (!Number.isFinite(created)) continue
        if (created < cutoff) {
          yield* fs.remove(P.sessionDir(layout, id))
          deleted.push(id)
        }
      }
      return deleted
    })

  const targetSave: Persistence["targetSave"] = (stateRoot, sessionId, target) =>
    Effect.gen(function* () {
      const layout = P.makeLayout(stateRoot)
      const session = yield* loadSession(layout, sessionId)
      const encoded = yield* Effect.orDie(encodeTarget(target))
      yield* write(P.targetFile(layout, sessionId), encoded)
      // Invariant 1 maintained: pointer set only after target.json is written.
      const updated: SessionRecord = {
        ...session,
        activeTargetId: target.targetId,
        updatedAt: clock.nowIso()
      }
      yield* writeSession(layout, updated)
      return updated
    })

  const targetCurrent: Persistence["targetCurrent"] = (stateRoot, sessionId) =>
    Effect.gen(function* () {
      const layout = P.makeLayout(stateRoot)
      yield* loadSession(layout, sessionId) // ensure session exists
      const path = P.targetFile(layout, sessionId)
      const ok = yield* fs.exists(path)
      if (!ok) return yield* Effect.fail(new NotFound({ entity: "target", id: sessionId }))
      const raw = yield* read(path)
      return yield* readTargetLenient(raw, path)
    })

  const snapshotPersist: Persistence["snapshotPersist"] = (stateRoot, sessionId, snapshot) =>
    Effect.gen(function* () {
      const layout = P.makeLayout(stateRoot)
      const session = yield* loadSession(layout, sessionId)

      // Write the full SnapshotResult (strict).
      const snapEncoded = yield* Effect.orDie(encodeSnapshot(snapshot))
      yield* write(P.snapshotFile(layout, sessionId, snapshot.snapshotId), snapEncoded)

      // Write refs.json mirroring this snapshot (AC-026 invariant 3 source).
      const cache: RefCache = {
        snapshotId: snapshot.snapshotId,
        targetId: snapshot.targetId,
        source: snapshot.source,
        ...(snapshot.semanticBridge !== undefined
          ? { semanticBridge: snapshot.semanticBridge }
          : {}),
        refs: snapshot.refs
      }
      const cacheEncoded = yield* Effect.orDie(encodeRefCache(cache))
      yield* write(P.refsFile(layout, sessionId), cacheEncoded)

      // Move pointers AFTER the files exist, then assert all three invariants.
      const updated: SessionRecord = {
        ...session,
        lastSnapshotId: snapshot.snapshotId,
        updatedAt: snapshot.generatedAt
      }
      yield* writeSession(layout, updated)
      yield* checkInvariants(layout, updated)
      return updated
    })

  const snapshotShow: Persistence["snapshotShow"] = (stateRoot, sessionId, snapshotId) =>
    Effect.gen(function* () {
      const layout = P.makeLayout(stateRoot)
      const path = P.snapshotFile(layout, sessionId, snapshotId)
      const ok = yield* fs.exists(path)
      if (!ok) return yield* Effect.fail(new NotFound({ entity: "snapshot", id: snapshotId }))
      const raw = yield* read(path)
      return yield* readSnapshotLenient(raw, path)
    })

  const refCacheRead: Persistence["refCacheRead"] = (stateRoot, sessionId) =>
    Effect.gen(function* () {
      const layout = P.makeLayout(stateRoot)
      const path = P.refsFile(layout, sessionId)
      const ok = yield* fs.exists(path)
      if (!ok) return yield* Effect.fail(new NotFound({ entity: "refcache", id: sessionId }))
      const raw = yield* read(path)
      return yield* readRefCacheLenient(raw, path)
    })

  const verifyInvariants: Persistence["verifyInvariants"] = (stateRoot, sessionId) =>
    Effect.gen(function* () {
      const layout = P.makeLayout(stateRoot)
      const session = yield* loadSession(layout, sessionId)
      yield* checkInvariants(layout, session)
    })

  // -- RunRecord (observational; AC-025 enforced by the caller/dispatch) ---
  const runStart: Persistence["runStart"] = (stateDir, record) =>
    encodeRun(record).pipe(
      Effect.orDie,
      Effect.flatMap((encoded) => write(P.runRecordFile(stateDir, record.runId), encoded))
    )

  const runFinish: Persistence["runFinish"] = (stateDir, record) =>
    encodeRun(record).pipe(
      Effect.orDie,
      Effect.flatMap((encoded) => write(P.runRecordFile(stateDir, record.runId), encoded))
    )

  const runShow: Persistence["runShow"] = (stateDir, runId) =>
    Effect.gen(function* () {
      const path = P.runRecordFile(stateDir, runId)
      const ok = yield* fs.exists(path)
      if (!ok) return yield* Effect.fail(new NotFound({ entity: "run", id: runId }))
      const raw = yield* read(path)
      return yield* decodeRun(raw).pipe(
        Effect.mapError((e) => new CorruptRecord({ path, reason: `run: ${String(e)}` }))
      )
    })

  return {
    sessionNew,
    sessionShow,
    sessionList,
    sessionClose,
    sessionClean,
    targetSave,
    targetCurrent,
    snapshotPersist,
    snapshotShow,
    refCacheRead,
    verifyInvariants,
    runStart,
    runFinish,
    runShow
  }
}

/**
 * Layer wiring: build `Persistence` from the `Fs` port + a clock. The clock is
 * passed explicitly here; a default wall-clock layer is provided for tests.
 *
 * // INTEGRATION SEAM (@expo98/core): the production composition root will
 * // replace `defaultClock` with core's S3 Clock/Id service so timestamps and
 * // collision-resistant suffixes come from the one canonical generator.
 */
export const layer = (clock: PersistenceClock): Layer.Layer<PersistenceService, never, Fs> =>
  Layer.effect(
    PersistenceService,
    Fs.pipe(Effect.map((fs) => makePersistence(fs, clock)))
  )

let monotonic = 0
export const defaultClock: PersistenceClock = {
  nowIso: () => new Date().toISOString(),
  suffix: () => {
    monotonic += 1
    return `${Date.now().toString(36)}${monotonic.toString(36).padStart(4, "0")}`
  }
}
