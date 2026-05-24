/**
 * `snapshot` — D8 capture orchestration (AC-019, AC-026) + the depth filter (AC-040).
 *
 * Capture is a pure `read` command: it reaches evidence over READ surfaces only —
 * the package-controlled semantic-bridge probe (`SemanticCapture`, a fixed CDP
 * `HermesEvidence` expression) and, as a fallback, the native `axe describe-ui`
 * CLI (`NativeAxe`, a subprocess). Neither is the dispatcher-withheld runtime-eval
 * mutation surface, so the handler never needs a dangerous capability in `R`.
 *
 * Orchestration (AC-019):
 *   1. PREREQUISITES — reuse domain's `checkSnapshotPrereqs`: no session / no active
 *      target / missing `device.id` ⇒ unavailable + matching reason, write NO artifacts.
 *   2. SEMANTIC — try the semantic bridge; on a payload, build + persist the snapshot
 *      via domain's `snapshotPersist` (the AC-026 path, semantic refs renumbered to
 *      `@e1..@eN`, `stale:false`).
 *   3. NATIVE FALLBACK — else if the `axe` CLI is present, run `describe-ui`, build +
 *      persist the snapshot from the native elements.
 *   4. UNAVAILABLE — else `transport-failure` (or `no-axe`), write nothing.
 *
 * Persistence is domain-owned: `snapshotPersist` writes `snapshots/<id>.json` +
 * `refs.json`, moves `lastSnapshotId`/`updatedAt`, then asserts the THREE Session
 * pointer invariants (AC-026). We never re-implement that here.
 */
import { command, type Command } from "@expo98/core"
import {
  type CorruptRecord,
  checkSnapshotPrereqs,
  type InvariantViolation,
  makeSnapshotId,
  type NotFound,
  type PersistenceClock,
  PersistenceService,
  type RefRecord,
  renumberRefs,
  type ScreenBox,
  type SemanticBridgeSnapshot,
  type SessionRecord,
  type SnapshotFilters,
  type SnapshotNode,
  type SnapshotResult,
  type SnapshotUnavailableReason,
  type StorageFailure,
  type TargetRecord,
} from "@expo98/domain"
import { Effect } from "effect"
import {
  descriptor,
  NativeAxe,
  type NativeAxeElement,
  resolveDepth,
  SemanticCapture,
  type SemanticRef,
} from "./support.js"

// ───────────────────────────────────────────────────────────────────────────
// Result envelopes
// ───────────────────────────────────────────────────────────────────────────

/** A capture that did not produce a snapshot. NO artifacts were written. */
export interface SnapshotUnavailable {
  readonly available: false
  readonly action: "snapshot"
  readonly reason: string
  readonly code: SnapshotUnavailableReason | "transport-failure" | "no-axe"
}

/** A capture that produced + persisted a snapshot (AC-026). */
export interface SnapshotCaptured {
  readonly available: true
  readonly action: "snapshot"
  readonly snapshotId: string
  /** Provenance: `["semantic-bridge"]` or `["native-axe"]`. */
  readonly source: ReadonlyArray<string>
  readonly refCount: number
  /** The session after the pointers moved (lastSnapshotId/updatedAt set). */
  readonly session: SessionRecord
}

export type SnapshotCaptureResult = SnapshotUnavailable | SnapshotCaptured

/** Inputs the orchestrator needs that are NOT on the seams (session/target context). */
export interface SnapshotCaptureInput {
  readonly stateRoot: string
  readonly sessionId: string
  readonly hasSession: boolean
  readonly activeTarget: TargetRecord | null
  readonly routeHint?: string | null
  /** AC-040 depth filter applied to the captured tree. */
  readonly depth?: number | null
  readonly filters?: Partial<SnapshotFilters>
  /** Time + id seam (domain's clock); the same one wired into persistence. */
  readonly clock: PersistenceClock
}

// ───────────────────────────────────────────────────────────────────────────
// AC-040 — snapshot depth filter (clamp 1..100, prune deeper nodes; root depth 0)
// ───────────────────────────────────────────────────────────────────────────

/** A node carrying its own depth (root = 0). The flat tree is built with depths. */
export interface DepthedNode {
  readonly node: SnapshotNode
  readonly depth: number
}

/**
 * AC-040: keep only nodes at depth ≤ the (clamped) limit; `null` = unbounded.
 * Root depth is 0, so `depth=1` keeps the root + its immediate children.
 */
export const filterByDepth = (
  nodes: ReadonlyArray<DepthedNode>,
  depthLimit: number | null,
): ReadonlyArray<SnapshotNode> =>
  (depthLimit === null ? nodes : nodes.filter((n) => n.depth <= depthLimit)).map((n) => n.node)

// ───────────────────────────────────────────────────────────────────────────
// Snapshot assembly (shared by the semantic + native paths)
// ───────────────────────────────────────────────────────────────────────────

const DEFAULT_FILTERS: SnapshotFilters = {
  interactiveOnly: false,
  compact: false,
  depth: null,
  includeSource: true,
  includeBounds: true,
}

const toBox = (
  box: { readonly x: number; readonly y: number; readonly width: number; readonly height: number } | null | undefined,
): ScreenBox | null =>
  box === null || box === undefined ? null : { x: box.x, y: box.y, width: box.width, height: box.height }

/**
 * Build a placeholder RefRecord (ref/snapshotId are rewritten by `renumberRefs`
 * just before persistence, so the indices here are provisional).
 */
const toRefRecord = (
  source: {
    readonly role?: string | null
    readonly label?: string | null
    readonly text?: string | null
    readonly testID?: string | null
    readonly nativeID?: string | null
    readonly box?: { readonly x: number; readonly y: number; readonly width: number; readonly height: number } | null
    readonly actions?: ReadonlyArray<string>
  },
  index: number,
  targetId: TargetRecord["targetId"],
  snapshotId: SnapshotResult["snapshotId"],
): RefRecord => ({
  ref: `@e${index + 1}` as RefRecord["ref"],
  snapshotId,
  targetId,
  stale: false,
  role: source.role ?? null,
  label: source.label ?? null,
  text: source.text ?? null,
  placeholder: null,
  testID: source.testID ?? null,
  nativeID: source.nativeID ?? null,
  component: null,
  box: toBox(source.box),
  actions: source.actions ?? [],
})

const toNode = (ref: RefRecord, source: string): SnapshotNode => ({
  ref: ref.ref,
  role: ref.role,
  label: ref.label,
  text: ref.text,
  testID: ref.testID,
  source,
  box: ref.box,
  actions: ref.actions,
})

interface AssemblyInput {
  readonly source: string
  readonly sourceTag: string
  readonly target: TargetRecord
  readonly routeHint: string | null
  readonly depthLimit: number | null
  readonly filters: SnapshotFilters
  readonly snapshotId: SnapshotResult["snapshotId"]
  readonly generatedAt: string
  readonly elements: ReadonlyArray<NativeAxeElement | SemanticRef>
  readonly semanticBridge?: SemanticBridgeSnapshot
  readonly limitations: ReadonlyArray<string>
}

/** Assemble a `SnapshotResult` from a captured element list, then renumber refs. */
const assembleSnapshot = (input: AssemblyInput): SnapshotResult => {
  // Element-index aligned refs + FULL tree. The native/semantic surfaces return
  // a flat list; depth is a position-derived nesting hint (the tree is a flat
  // array, not nested — entities.md). The first element is the root (depth 0),
  // the rest its children (depth 1) — a faithful flat-tree model.
  const refs = input.elements.map((el, i) => toRefRecord(el, i, input.target.targetId, input.snapshotId))
  const fullTree = refs.map((ref) => toNode(ref, input.sourceTag))

  const base: SnapshotResult = {
    snapshotId: input.snapshotId,
    targetId: input.target.targetId,
    routeHint: input.routeHint,
    source: [input.source],
    generatedAt: input.generatedAt,
    filters: { ...input.filters, depth: input.depthLimit },
    refs,
    tree: fullTree,
    artifacts: { json: null, screenshot: null, annotatedScreenshot: null },
    limitations: input.limitations,
    ...(input.semanticBridge !== undefined ? { semanticBridge: input.semanticBridge } : {}),
  }
  // AC-026: rewrite refs+tree to @e1..@eN with stale:false (the canonical step
  // domain owns — the single ref normaliser). refs and tree stay index-aligned.
  const normalised = renumberRefs(base)

  // AC-040: prune the (already @eN-numbered) tree by depth, AFTER renumbering so
  // surviving tree nodes keep the @eN refs that still match the refs array. The
  // refs array itself is NOT pruned (it is the addressable set); only the display
  // tree is depth-filtered.
  const depthed: ReadonlyArray<DepthedNode> = normalised.tree.map((node, i) => ({
    node,
    depth: i === 0 ? 0 : 1,
  }))
  return { ...normalised, tree: filterByDepth(depthed, input.depthLimit) }
}

// ───────────────────────────────────────────────────────────────────────────
// AC-019 / AC-026 — capture orchestration
// ───────────────────────────────────────────────────────────────────────────

const unavailable = (reason: string, code: SnapshotUnavailable["code"]): SnapshotUnavailable => ({
  available: false,
  action: "snapshot",
  reason,
  code,
})

/**
 * AC-019 + AC-026: orchestrate a snapshot capture and persist it via domain.
 *
 * Requires the two capture SEAMS (`SemanticCapture`, `NativeAxe`) and domain's
 * `PersistenceService`. Surfaces domain persistence errors typed; on a prereq
 * miss or no transport it returns an unavailable envelope WITHOUT touching disk.
 */
export const captureSnapshot = (
  input: SnapshotCaptureInput,
): Effect.Effect<
  SnapshotCaptureResult,
  StorageFailure | NotFound | CorruptRecord | InvariantViolation,
  SemanticCapture | NativeAxe | PersistenceService
> =>
  Effect.gen(function* () {
    // 1. Prerequisites (reuse domain's decision; write NO artifacts on a miss).
    const prereq = checkSnapshotPrereqs({
      hasSession: input.hasSession,
      activeTarget: input.activeTarget,
    })
    if (!prereq.available) {
      return unavailable(prereq.reason, prereq.code)
    }
    // `checkSnapshotPrereqs` guarantees a non-null active target with a device.id.
    const target = input.activeTarget as TargetRecord

    const filters: SnapshotFilters = { ...DEFAULT_FILTERS, ...input.filters }
    const depthLimit = resolveDepth(input.depth)
    const routeHint = input.routeHint ?? null

    const persistence = yield* PersistenceService
    const semantic = yield* SemanticCapture
    const native = yield* NativeAxe

    const persist = (snapshot: SnapshotResult, source: string) =>
      persistence.snapshotPersist(input.stateRoot, input.sessionId, snapshot).pipe(
        Effect.map(
          (session): SnapshotCaptured => ({
            available: true,
            action: "snapshot",
            snapshotId: snapshot.snapshotId,
            source: [source],
            refCount: snapshot.refs.length,
            session,
          }),
        ),
      )

    // 2. SEMANTIC bridge path (primary).
    const semanticPayload = yield* semantic.capture()
    if (semanticPayload !== null) {
      const snapshotId = makeSnapshotId(input.clock.nowIso(), input.clock.suffix())
      const generatedAt = input.clock.nowIso()
      const semanticBridge: SemanticBridgeSnapshot = {
        ...(semanticPayload.routeHint !== undefined ? { routeHint: semanticPayload.routeHint } : {}),
        refs: semanticPayload.refs.map((r) => ({
          role: r.role ?? null,
          label: r.label ?? null,
          text: r.text ?? null,
          testID: r.testID ?? null,
          nativeID: r.nativeID ?? null,
          box: toBox(r.box),
          actions: r.actions ?? [],
        })),
        limitations: semanticPayload.limitations,
      }
      const snapshot = assembleSnapshot({
        source: "semantic-bridge",
        sourceTag: "semantic-bridge",
        target,
        routeHint: semanticPayload.routeHint ?? routeHint,
        depthLimit,
        filters,
        snapshotId,
        generatedAt,
        elements: semanticPayload.refs,
        semanticBridge,
        limitations: semanticPayload.limitations,
      })
      return yield* persist(snapshot, "semantic-bridge")
    }

    // 3. NATIVE `axe describe-ui` fallback.
    const nativeResult = yield* native.describeUi()
    switch (nativeResult._tag) {
      case "ok": {
        const snapshotId = makeSnapshotId(input.clock.nowIso(), input.clock.suffix())
        const generatedAt = input.clock.nowIso()
        const snapshot = assembleSnapshot({
          source: "native-axe",
          sourceTag: "native-axe",
          target,
          routeHint,
          depthLimit,
          filters,
          snapshotId,
          generatedAt,
          elements: nativeResult.elements,
          limitations: [],
        })
        return yield* persist(snapshot, "native-axe")
      }
      case "transport-failure":
        return unavailable(`Native axe capture failed: ${nativeResult.reason}`, "transport-failure")
      case "absent":
        // 4. No transport available at all.
        return unavailable("No semantic bridge and the axe CLI is not installed.", "no-axe")
    }
  })

// ───────────────────────────────────────────────────────────────────────────
// Read command wrapper (dispatch parity)
// ───────────────────────────────────────────────────────────────────────────

/**
 * Wrap a pre-computed capture result as a `read` command so it can flow through
 * core's `dispatch` (R = never). The orchestration (which needs the seams +
 * persistence) is run by the shell ahead of this wrapper, exactly like the read
 * handlers compute their payload at construction time.
 */
export const snapshotCommand = (result: SnapshotCaptureResult): Command<"read", SnapshotCaptureResult> =>
  command(descriptor("snapshot", "read"), Effect.succeed(result))
