import { Effect, Schema } from "effect"
import { RefCache, SCHEMA_VERSION, SessionRecord, SnapshotResult, TargetRecord } from "./entities.js"
import { CorruptRecord } from "./errors.js"
import { SemanticBridgeSnapshot, SidecarRecord } from "./value-objects.js"

/**
 * Lenient-read / strict-write migration shim (REIMAGINED_ARCHITECTURE §5 step 2).
 *
 *   "Read with a Schema that accepts the looser legacy variants
 *    (e.g. `sidecars: unknown[]`, `semanticBridge: unknown`, the 3 SessionRecord
 *    shapes) and normalise to the strict canonical struct; subsequent writes are
 *    strict. Net: read-old / write-new, no migration script needed."
 *
 * Strategy: decode with a permissive INPUT schema (everything optional/unknown),
 * then map field-by-field up to the strict struct, filling the canonical
 * defaults the looser legacy copies omitted (`closedAt?` absent, `sidecars` as
 * `unknown[]`, `activeTargetId`/`lastSnapshotId` missing, `semanticBridge` as
 * `unknown`). Writes always go through the STRICT entity schemas in `persist.ts`.
 */

// ---------------------------------------------------------------------------
// Permissive input schemas: accept any of the 3 divergent legacy shapes.
// ---------------------------------------------------------------------------

const LooseSessionInput = Schema.Struct({
  schemaVersion: Schema.optional(Schema.Number),
  sessionId: Schema.String,
  name: Schema.String,
  artifactDir: Schema.String,
  createdAt: Schema.String,
  updatedAt: Schema.optional(Schema.String),
  closedAt: Schema.optional(Schema.String),
  activeTargetId: Schema.optional(Schema.NullOr(Schema.String)),
  lastSnapshotId: Schema.optional(Schema.NullOr(Schema.String)),
  // The looser copies typed this `unknown[]`; accept anything.
  sidecars: Schema.optional(Schema.Array(Schema.Unknown)),
})

const decodeLooseSession = Schema.decodeUnknown(LooseSessionInput)

const normalizeSidecar = (raw: unknown): Schema.Schema.Type<typeof SidecarRecord> | null => {
  if (typeof raw !== "object" || raw === null) return null
  const r = raw as Record<string, unknown>
  if (typeof r["name"] !== "string") return null
  const status = r["status"]
  const validStatus =
    status === "running" || status === "stale" || status === "stopped" || status === "unknown" ? status : "unknown"
  return {
    name: r["name"],
    pid: typeof r["pid"] === "number" ? r["pid"] : null,
    port: typeof r["port"] === "number" ? r["port"] : null,
    status: validStatus,
  }
}

/**
 * Read a possibly-legacy `session.json` and normalise to the strict canonical
 * `SessionRecord` (schemaVersion:1, typed sidecars, present pointers).
 */
export const readSessionLenient = (
  input: unknown,
  path: string,
): Effect.Effect<Schema.Schema.Type<typeof SessionRecord>, CorruptRecord> =>
  decodeLooseSession(input).pipe(
    Effect.mapError((e) => new CorruptRecord({ path, reason: `session: ${String(e)}` })),
    Effect.map((loose) => ({
      schemaVersion: SCHEMA_VERSION,
      sessionId: loose.sessionId as Schema.Schema.Type<typeof SessionRecord>["sessionId"],
      // Re-cap legacy names that predate the 48-char bound.
      name: loose.name.slice(0, 48),
      artifactDir: loose.artifactDir,
      createdAt: loose.createdAt,
      updatedAt: loose.updatedAt ?? loose.createdAt,
      ...(loose.closedAt !== undefined ? { closedAt: loose.closedAt } : {}),
      activeTargetId: loose.activeTargetId ?? null,
      lastSnapshotId: loose.lastSnapshotId ?? null,
      sidecars: (loose.sidecars ?? [])
        .map(normalizeSidecar)
        .filter((s): s is Schema.Schema.Type<typeof SidecarRecord> => s !== null),
    })),
  )

// ---------------------------------------------------------------------------
// semanticBridge: legacy stored `unknown` on both Snapshot and RefCache. Coerce
// to the typed `SemanticBridgeSnapshot` when shaped, else drop it.
// ---------------------------------------------------------------------------

const decodeBridge = Schema.decodeUnknown(SemanticBridgeSnapshot)

const coerceSemanticBridge = (
  raw: unknown,
): Effect.Effect<Schema.Schema.Type<typeof SemanticBridgeSnapshot> | undefined> =>
  raw === undefined || raw === null
    ? Effect.succeed(undefined)
    : decodeBridge(raw).pipe(Effect.orElseSucceed(() => undefined))

/**
 * Read a possibly-legacy snapshot. The bulk of the shape was already strict in
 * legacy; the one drift is `semanticBridge: unknown`. We decode the strict body
 * with the bridge stripped, then re-attach a coerced typed bridge.
 */
export const readSnapshotLenient = (
  input: unknown,
  path: string,
): Effect.Effect<Schema.Schema.Type<typeof SnapshotResult>, CorruptRecord> =>
  Effect.gen(function* () {
    const obj = typeof input === "object" && input !== null ? (input as Record<string, unknown>) : {}
    const { semanticBridge: rawBridge, ...rest } = obj
    const bridge = yield* coerceSemanticBridge(rawBridge)
    const body = yield* Schema.decodeUnknown(SnapshotResult.omit("semanticBridge"))(rest).pipe(
      Effect.mapError((e) => new CorruptRecord({ path, reason: `snapshot: ${String(e)}` })),
    )
    return bridge === undefined ? body : { ...body, semanticBridge: bridge }
  })

export const readRefCacheLenient = (
  input: unknown,
  path: string,
): Effect.Effect<Schema.Schema.Type<typeof RefCache>, CorruptRecord> =>
  Effect.gen(function* () {
    const obj = typeof input === "object" && input !== null ? (input as Record<string, unknown>) : {}
    const { semanticBridge: rawBridge, ...rest } = obj
    const bridge = yield* coerceSemanticBridge(rawBridge)
    const body = yield* Schema.decodeUnknown(RefCache.omit("semanticBridge"))(rest).pipe(
      Effect.mapError((e) => new CorruptRecord({ path, reason: `refcache: ${String(e)}` })),
    )
    return bridge === undefined ? body : { ...body, semanticBridge: bridge }
  })

/**
 * Targets were also loosened in `snapshot-evidence` (entities.md). The strict
 * `TargetRecord` decoder is permissive enough that the legacy shape decodes
 * directly; this wrapper just gives it a `CorruptRecord` error channel and a
 * single named entry point alongside the others.
 */
export const readTargetLenient = (
  input: unknown,
  path: string,
): Effect.Effect<Schema.Schema.Type<typeof TargetRecord>, CorruptRecord> =>
  Schema.decodeUnknown(TargetRecord)(input).pipe(
    Effect.mapError((e) => new CorruptRecord({ path, reason: `target: ${String(e)}` })),
  )
