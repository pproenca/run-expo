import { Schema } from "effect"
import { RefId, SnapshotId, TargetId } from "./ids.js"

/**
 * Embedded value objects — persisted INSIDE a parent entity, no independent
 * identity (entities.md §1, "Embedded value objects"). Each is a strict
 * `Schema.Struct`; the legacy looseness (`semanticBridge: unknown`,
 * `sidecars: unknown[]`) is tightened here per the schema-drift notes.
 */

// ---------------------------------------------------------------------------
// ScreenBox / RefBox — Ref.box, SnapshotNode.box
// ---------------------------------------------------------------------------
export const ScreenBox = Schema.Struct({
  x: Schema.Number,
  y: Schema.Number,
  width: Schema.Number,
  height: Schema.Number,
})
export type ScreenBox = Schema.Schema.Type<typeof ScreenBox>

/** Centre point of a box (AC-036). Derived, not persisted, but schema-typed. */
export const ScreenPoint = Schema.Struct({
  x: Schema.Number,
  y: Schema.Number,
})
export type ScreenPoint = Schema.Schema.Type<typeof ScreenPoint>

// ---------------------------------------------------------------------------
// DeviceSummary — Target.device
// ---------------------------------------------------------------------------
export const DeviceState = Schema.Literal("booted", "shutdown", "connected", "unknown")
export type DeviceState = Schema.Schema.Type<typeof DeviceState>

export const DeviceSummary = Schema.Struct({
  id: Schema.String,
  name: Schema.NullOr(Schema.String),
  state: DeviceState,
})
export type DeviceSummary = Schema.Schema.Type<typeof DeviceSummary>

// ---------------------------------------------------------------------------
// SidecarRecord — Session.sidecars (AC-033: real running->stale->stopped
// lifecycle in the rewrite, not a dead forward-declaration).
// ---------------------------------------------------------------------------
export const SidecarStatus = Schema.Literal("running", "stale", "stopped", "unknown")
export type SidecarStatus = Schema.Schema.Type<typeof SidecarStatus>

export const SidecarRecord = Schema.Struct({
  name: Schema.String,
  pid: Schema.NullOr(Schema.Number),
  port: Schema.NullOr(Schema.Number),
  status: SidecarStatus,
})
export type SidecarRecord = Schema.Schema.Type<typeof SidecarRecord>

// ---------------------------------------------------------------------------
// SnapshotFilters — Snapshot.filters
// ---------------------------------------------------------------------------
export const SnapshotFilters = Schema.Struct({
  interactiveOnly: Schema.Boolean,
  compact: Schema.Boolean,
  // depth: null (unbounded) or clamped 1..100 (AC-040).
  depth: Schema.NullOr(Schema.Number.pipe(Schema.int(), Schema.between(1, 100))),
  includeSource: Schema.Boolean,
  includeBounds: Schema.Boolean,
})
export type SnapshotFilters = Schema.Schema.Type<typeof SnapshotFilters>

// ---------------------------------------------------------------------------
// Ref (RefRecord) — embedded in Snapshot + RefCache
// ---------------------------------------------------------------------------
export const RefRecord = Schema.Struct({
  ref: RefId,
  snapshotId: SnapshotId,
  targetId: TargetId,
  stale: Schema.Boolean,
  role: Schema.NullOr(Schema.String),
  label: Schema.NullOr(Schema.String),
  text: Schema.NullOr(Schema.String),
  placeholder: Schema.NullOr(Schema.String),
  testID: Schema.NullOr(Schema.String),
  nativeID: Schema.NullOr(Schema.String),
  component: Schema.NullOr(Schema.String),
  box: Schema.NullOr(ScreenBox),
  actions: Schema.Array(Schema.String),
  disabled: Schema.optional(Schema.Boolean),
  // `raw` is the untyped passthrough of the source accessibility node; kept as
  // an unknown record so we never lose provenance, but it is always redacted at
  // the output boundary (AC-003, owned by @expo98/core).
  raw: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.Unknown })),
})
export type RefRecord = Schema.Schema.Type<typeof RefRecord>

// ---------------------------------------------------------------------------
// SnapshotNode — Snapshot.tree (FLAT array, not nested)
// ---------------------------------------------------------------------------
export const SnapshotNode = Schema.Struct({
  ref: RefId,
  role: Schema.NullOr(Schema.String),
  label: Schema.NullOr(Schema.String),
  text: Schema.NullOr(Schema.String),
  testID: Schema.NullOr(Schema.String),
  source: Schema.String,
  box: Schema.NullOr(ScreenBox),
  actions: Schema.Array(Schema.String),
})
export type SnapshotNode = Schema.Schema.Type<typeof SnapshotNode>

// ---------------------------------------------------------------------------
// SemanticBridgeSnapshot — Snapshot.semanticBridge?, RefCache.semanticBridge?
// Legacy stored this as `unknown`; tightened here (schema-drift note).
// `refs` are Partial<RefRecord> from the bridge before they are normalised to
// @e1..@eN, so we model them as a permissive partial struct.
// ---------------------------------------------------------------------------
export const SemanticBridgeRef = Schema.partial(
  Schema.Struct({
    ref: Schema.String,
    role: Schema.NullOr(Schema.String),
    label: Schema.NullOr(Schema.String),
    text: Schema.NullOr(Schema.String),
    testID: Schema.NullOr(Schema.String),
    nativeID: Schema.NullOr(Schema.String),
    box: Schema.NullOr(ScreenBox),
    actions: Schema.Array(Schema.String),
  }),
)
export type SemanticBridgeRef = Schema.Schema.Type<typeof SemanticBridgeRef>

export const SemanticBridgeSnapshot = Schema.Struct({
  routeHint: Schema.optional(Schema.NullOr(Schema.String)),
  refs: Schema.Array(SemanticBridgeRef),
  limitations: Schema.Array(Schema.String),
})
export type SemanticBridgeSnapshot = Schema.Schema.Type<typeof SemanticBridgeSnapshot>

// ---------------------------------------------------------------------------
// RunPayloadSummary — RunRecord.summary (AC-042: first 40 keys + rollups)
// ---------------------------------------------------------------------------
export const RunPayloadSummary = Schema.Struct({
  keys: Schema.Array(Schema.String),
  available: Schema.optional(Schema.Boolean),
  routeCount: Schema.optional(Schema.Number),
  eventCount: Schema.optional(Schema.Number),
})
export type RunPayloadSummary = Schema.Schema.Type<typeof RunPayloadSummary>
