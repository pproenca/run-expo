import { Schema } from "effect"
import { RunId, SessionId, SnapshotId, TargetId } from "./ids.js"
import {
  DeviceSummary,
  RefRecord,
  RunPayloadSummary,
  SemanticBridgeSnapshot,
  SidecarRecord,
  SnapshotFilters,
  SnapshotNode
} from "./value-objects.js"

/**
 * Persisted entities — the four aggregate roots + their on-disk JSON shapes.
 *
 * All structs are the STRICT canonical variants (entities.md §"Schema drift to
 * resolve"). The lenient legacy variants are accepted only by the migration
 * shim (`./migration.ts`), which normalises them up to these structs; every
 * write is strict.
 */

export const SCHEMA_VERSION = 1 as const
export const BRIDGE_VERSION = "1.0.0" as const

// ===========================================================================
// Session aggregate root — sessions/<id>/session.json
// ===========================================================================

/**
 * Session name (AC-043): already normalised + capped to 48 chars by the time it
 * lands in a `SessionRecord`. We enforce the bound at the schema boundary so a
 * hand-written or migrated record cannot smuggle a >48-char name through.
 */
export const SessionName = Schema.String.pipe(Schema.maxLength(48))
export type SessionName = Schema.Schema.Type<typeof SessionName>

export const SessionRecord = Schema.Struct({
  schemaVersion: Schema.Literal(SCHEMA_VERSION),
  sessionId: SessionId,
  name: SessionName,
  artifactDir: Schema.String,
  createdAt: Schema.String,
  updatedAt: Schema.String,
  closedAt: Schema.optional(Schema.String),
  // Soft pointers (the 3 Session invariants live in S7 Persistence, AC-026).
  activeTargetId: Schema.NullOr(Schema.String),
  lastSnapshotId: Schema.NullOr(Schema.String),
  sidecars: Schema.Array(SidecarRecord)
})
export type SessionRecord = Schema.Schema.Type<typeof SessionRecord>

// ===========================================================================
// Target — sessions/<id>/target.json (1 active per session)
// ===========================================================================

export const Platform = Schema.Literal("ios", "android", "unknown")
export type Platform = Schema.Schema.Type<typeof Platform>

export const TargetApp = Schema.Struct({
  bundleId: Schema.NullOr(Schema.String),
  processName: Schema.NullOr(Schema.String),
  running: Schema.Boolean
})
export type TargetApp = Schema.Schema.Type<typeof TargetApp>

export const TargetMetro = Schema.Struct({
  port: Schema.NullOr(Schema.Number),
  status: Schema.NullOr(Schema.String),
  targetId: Schema.NullOr(Schema.String),
  title: Schema.NullOr(Schema.String),
  appId: Schema.NullOr(Schema.String),
  debuggerUrl: Schema.NullOr(Schema.String)
})
export type TargetMetro = Schema.Schema.Type<typeof TargetMetro>

export const TargetRecord = Schema.Struct({
  // targetId = platform:device.id:appId:metroPort (AC-018 composition).
  targetId: TargetId,
  platform: Platform,
  device: DeviceSummary,
  app: TargetApp,
  metro: TargetMetro,
  selected: Schema.Boolean,
  // Recomputed on rediscovery (AC-018).
  stale: Schema.Boolean
})
export type TargetRecord = Schema.Schema.Type<typeof TargetRecord>

// ===========================================================================
// Snapshot — sessions/<id>/snapshots/<sid>.json (many per session)
// ===========================================================================

export const SnapshotArtifacts = Schema.Struct({
  json: Schema.NullOr(Schema.String),
  screenshot: Schema.NullOr(Schema.String),
  annotatedScreenshot: Schema.NullOr(Schema.String)
})
export type SnapshotArtifacts = Schema.Schema.Type<typeof SnapshotArtifacts>

export const SnapshotResult = Schema.Struct({
  snapshotId: SnapshotId,
  targetId: TargetId,
  routeHint: Schema.NullOr(Schema.String),
  source: Schema.Array(Schema.String),
  // Tightened from legacy `unknown` (schema-drift note).
  semanticBridge: Schema.optional(SemanticBridgeSnapshot),
  generatedAt: Schema.String,
  filters: SnapshotFilters,
  refs: Schema.Array(RefRecord),
  tree: Schema.Array(SnapshotNode),
  artifacts: SnapshotArtifacts,
  limitations: Schema.Array(Schema.String)
})
export type SnapshotResult = Schema.Schema.Type<typeof SnapshotResult>

// ===========================================================================
// RefCache — sessions/<id>/refs.json (mirrors lastSnapshotId)
// ===========================================================================

export const RefCache = Schema.Struct({
  snapshotId: SnapshotId,
  targetId: TargetId,
  source: Schema.Array(Schema.String),
  semanticBridge: Schema.optional(SemanticBridgeSnapshot),
  refs: Schema.Array(RefRecord)
})
export type RefCache = Schema.Schema.Type<typeof RefCache>

// ===========================================================================
// RunRecord aggregate — <stateDir>/<runId>.json  (running -> completed|failed)
// ===========================================================================

export const RunStatus = Schema.Literal("running", "completed", "failed")
export type RunStatus = Schema.Schema.Type<typeof RunStatus>

export const RunCli = Schema.Struct({
  name: Schema.String,
  version: Schema.String
})
export type RunCli = Schema.Schema.Type<typeof RunCli>

/**
 * The base fields shared by the running and finished states. `args` are already
 * redacted (AC-003) by @expo98/core before they reach this schema; we keep them
 * as an unknown array so any redacted shape round-trips.
 */
const RunRecordFields = {
  schemaVersion: Schema.Literal(SCHEMA_VERSION),
  runId: RunId,
  cli: RunCli,
  command: Schema.String,
  args: Schema.Array(Schema.Unknown),
  root: Schema.String,
  stateDir: Schema.String,
  startedAt: Schema.String,
  finishedAt: Schema.NullOr(Schema.String),
  status: RunStatus,
  exitCode: Schema.NullOr(Schema.Number),
  summary: Schema.NullOr(RunPayloadSummary),
  error: Schema.NullOr(Schema.String)
} as const

/** A run record in any state (running | completed | failed). */
export const RunRecord = Schema.Struct(RunRecordFields)
export type RunRecord = Schema.Schema.Type<typeof RunRecord>

/** A freshly-opened, in-flight run (status = running). */
export const RunningRunRecord = Schema.Struct({
  ...RunRecordFields,
  status: Schema.Literal("running"),
  finishedAt: Schema.Null,
  exitCode: Schema.Null,
  summary: Schema.Null,
  error: Schema.Null
})
export type RunningRunRecord = Schema.Schema.Type<typeof RunningRunRecord>

/** A terminal run record (completed | failed). */
export const FinishedRunRecord = Schema.Struct({
  ...RunRecordFields,
  status: Schema.Literal("completed", "failed"),
  finishedAt: Schema.String
})
export type FinishedRunRecord = Schema.Schema.Type<typeof FinishedRunRecord>

// ===========================================================================
// BridgeMetadata aggregate — <projectRoot>/.expo98/bridge.json (project-scoped)
// ===========================================================================

/** Domain element schema (was an untyped `string[]` in legacy). */
export const BridgeDomain = Schema.Literal(
  "navigation",
  "network",
  "storage",
  "controls",
  "performance",
  "snapshot"
)
export type BridgeDomain = Schema.Schema.Type<typeof BridgeDomain>

export const BridgeMetadata = Schema.Struct({
  schemaVersion: Schema.Literal(SCHEMA_VERSION),
  bridgeVersion: Schema.Literal(BRIDGE_VERSION),
  developmentOnly: Schema.Literal(true),
  generatedBy: Schema.Literal("expo98"),
  domains: Schema.Array(BridgeDomain)
})
export type BridgeMetadata = Schema.Schema.Type<typeof BridgeMetadata>

// ===========================================================================
// OverlayEventsFile aggregate — <overlayDir>/events.json (append-only)
// ===========================================================================

/**
 * Overlay comment element (AC-014: `comments[]` schema validation). Legacy had
 * no element schema (`events: any[]`); the rewrite validates an `OverlayEvent`
 * shape before append. Kept permissive but typed: an event carries a free-form
 * redacted payload plus required provenance.
 */
export const OverlayEvent = Schema.Struct({
  id: Schema.String,
  createdAt: Schema.String,
  kind: Schema.String,
  payload: Schema.Record({ key: Schema.String, value: Schema.Unknown })
})
export type OverlayEvent = Schema.Schema.Type<typeof OverlayEvent>

export const OverlayEventsFile = Schema.Struct({
  version: Schema.Literal(1),
  title: Schema.String,
  createdAt: Schema.String,
  updatedAt: Schema.optional(Schema.String),
  events: Schema.Array(OverlayEvent)
})
export type OverlayEventsFile = Schema.Schema.Type<typeof OverlayEventsFile>
