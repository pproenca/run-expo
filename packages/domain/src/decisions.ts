import { Schema } from "effect"
import type { RefCache, SnapshotResult, TargetRecord } from "./entities.js"
import type { RefRecord, ScreenBox, ScreenPoint } from "./value-objects.js"

/**
 * Pure domain decisions over persisted entities — ref validity (AC-017), target
 * staleness (AC-018), and snapshot prerequisites (AC-019). These are the
 * read-side rules the handlers and S7 share; modelled as pure functions +
 * Schema-typed result DTOs so they can be property-tested and round-tripped.
 */

// ---------------------------------------------------------------------------
// AC-017 — ref validity
// ---------------------------------------------------------------------------

export const REF_FORMAT = /^@e\d+$/
export const STALE_REASON = "Ref is stale. Capture a new snapshot before acting."

export const RefUnavailableReason = Schema.Literal(
  "no-ref-cache",
  "ref-missing",
  "ref-stale",
  "ref-lacks-action",
  "ref-lacks-bounds",
  "invalid-ref-format",
)
export type RefUnavailableReason = Schema.Schema.Type<typeof RefUnavailableReason>

const ScreenBoxStruct = Schema.Struct({
  x: Schema.Number,
  y: Schema.Number,
  width: Schema.Number,
  height: Schema.Number,
})
const ScreenPointStruct = Schema.Struct({ x: Schema.Number, y: Schema.Number })

export const RefActionPlan = Schema.Struct({
  available: Schema.Literal(true),
  action: Schema.String,
  ref: Schema.String,
  targetId: Schema.String,
  // null only for non-point actions on a boundless ref; point actions are
  // rejected earlier with `ref-lacks-bounds`.
  box: Schema.NullOr(ScreenBoxStruct),
  point: Schema.NullOr(ScreenPointStruct),
})
export type RefActionPlan = Schema.Schema.Type<typeof RefActionPlan>

export const RefUnavailable = Schema.Struct({
  available: Schema.Literal(false),
  reason: Schema.String,
  code: RefUnavailableReason,
  availableActions: Schema.optional(Schema.Array(Schema.String)),
})
export type RefUnavailable = Schema.Schema.Type<typeof RefUnavailable>

export type RefDecision = RefActionPlan | RefUnavailable

/** AC-036: point = box centre. */
export const centerOf = (box: ScreenBox): ScreenPoint => ({
  x: box.x + box.width / 2,
  y: box.y + box.height / 2,
})

/**
 * AC-017: a ref action requires a current, valid, action-capable, bounded ref.
 * `pointAction` ⇒ the action needs coordinates (so a missing box → unavailable).
 */
export const planRefAction = (input: {
  readonly cache: RefCache | null
  readonly ref: string
  readonly action: string
  readonly pointAction: boolean
}): RefDecision => {
  if (!REF_FORMAT.test(input.ref)) {
    return {
      available: false,
      code: "invalid-ref-format",
      reason: `Ref must match ${REF_FORMAT.source}.`,
    }
  }
  if (input.cache === null) {
    return { available: false, code: "no-ref-cache", reason: "No ref cache available." }
  }
  const found: RefRecord | undefined = input.cache.refs.find((r) => r.ref === input.ref)
  if (found === undefined) {
    return { available: false, code: "ref-missing", reason: "Ref not found in cache." }
  }
  if (found.stale) {
    return { available: false, code: "ref-stale", reason: STALE_REASON }
  }
  if (!found.actions.includes(input.action)) {
    return {
      available: false,
      code: "ref-lacks-action",
      reason: `Ref does not support action "${input.action}".`,
      availableActions: found.actions,
    }
  }
  if (input.pointAction && found.box === null) {
    return {
      available: false,
      code: "ref-lacks-bounds",
      reason: "Ref has no bounds; cannot compute a point.",
    }
  }
  // box is guaranteed non-null here when pointAction (checked above); for a
  // non-point action it may be null, in which case point is null too.
  const box = found.box
  return {
    available: true,
    action: input.action,
    ref: input.ref,
    targetId: input.cache.targetId,
    box,
    point: box === null ? null : centerOf(box),
  }
}

// ---------------------------------------------------------------------------
// AC-018 — target staleness on rediscovery
// ---------------------------------------------------------------------------

export type TargetDecision =
  | { readonly available: true; readonly target: TargetRecord }
  | {
      readonly available: false
      readonly reason: string
      readonly target?: TargetRecord
      readonly targetId?: string
    }

/**
 * AC-018: a persisted target is valid only while rediscovered.
 * - rediscovered ⇒ `{available:true, target:{...current, selected:true, stale:false}}`
 * - not rediscovered ⇒ `{available:false, "Selected target is stale.", target:{...persisted, stale:true}}`
 */
export const resolveTargetCurrent = (input: {
  readonly persisted: TargetRecord
  readonly rediscovered: TargetRecord | null
}): TargetDecision => {
  if (input.rediscovered !== null) {
    return {
      available: true,
      target: { ...input.rediscovered, selected: true, stale: false },
    }
  }
  return {
    available: false,
    reason: "Selected target is stale.",
    target: { ...input.persisted, stale: true },
  }
}

/** AC-018: `target select <id>` against the rediscovery set. */
export const resolveTargetSelect = (input: {
  readonly id: string
  readonly discovered: ReadonlyArray<TargetRecord>
}): TargetDecision => {
  const match = input.discovered.find((t) => t.targetId === input.id)
  if (match === undefined) {
    return { available: false, reason: "Target not found.", targetId: input.id }
  }
  return { available: true, target: { ...match, selected: true, stale: false } }
}

// ---------------------------------------------------------------------------
// AC-019 — snapshot prerequisites
// ---------------------------------------------------------------------------

export const SnapshotUnavailableReason = Schema.Literal("no-session", "no-active-target", "missing-device-id")
export type SnapshotUnavailableReason = Schema.Schema.Type<typeof SnapshotUnavailableReason>

export type SnapshotPrereqDecision =
  | { readonly available: true }
  | { readonly available: false; readonly reason: string; readonly code: SnapshotUnavailableReason }

/**
 * AC-019: snapshot capture needs session + active target + device metadata.
 * Returns unavailable+reason and (by contract) the caller writes NO artifacts.
 */
export const checkSnapshotPrereqs = (input: {
  readonly hasSession: boolean
  readonly activeTarget: TargetRecord | null
}): SnapshotPrereqDecision => {
  if (!input.hasSession) {
    return { available: false, code: "no-session", reason: "No active session." }
  }
  if (input.activeTarget === null) {
    return { available: false, code: "no-active-target", reason: "No active target selected." }
  }
  if (input.activeTarget.device.id.length === 0) {
    return {
      available: false,
      code: "missing-device-id",
      reason: "Active target is missing device.id.",
    }
  }
  return { available: true }
}

/**
 * AC-026 helper: rewrite a captured snapshot's refs to `@e1..@eN` with
 * `stale:false`, keeping the original ordering. Used by the capture path before
 * `snapshotPersist`.
 */
export const renumberRefs = (snapshot: SnapshotResult): SnapshotResult => {
  const refs = snapshot.refs.map((r, i) => ({
    ...r,
    ref: `@e${i + 1}` as RefRecord["ref"],
    snapshotId: snapshot.snapshotId,
    stale: false,
  }))
  const tree = snapshot.tree.map((n, i) => ({
    ...n,
    ref: `@e${i + 1}` as RefRecord["ref"],
  }))
  return { ...snapshot, refs, tree }
}
