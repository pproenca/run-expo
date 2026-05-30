import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { renumberRefs } from "../src/decisions.js"
import type { SnapshotResult, TargetRecord } from "../src/entities.js"
import { makeMemoryFs } from "../src/fs-port.js"
import type { RefId, SnapshotId, TargetId } from "../src/ids.js"
import * as P from "../src/paths.js"
import { makePersistence } from "../src/persist.js"
import type { RefRecord, SnapshotNode } from "../src/value-objects.js"
import { STATE_ROOT, TestClock } from "./helpers.js"

const TID = "ios:DEVICE-1:com.example:8081" as TargetId

const targetRecord: TargetRecord = {
  targetId: TID,
  platform: "ios",
  device: { id: "DEVICE-1", name: "iPhone", state: "booted" },
  app: { bundleId: "com.example", processName: "Example", running: true },
  metro: {
    port: 8081,
    status: "running",
    targetId: "page-1",
    title: "Example",
    appId: "com.example",
    debuggerUrl: "ws://127.0.0.1:8081/x",
  },
  selected: true,
  stale: false,
}

const mkRef = (n: number): RefRecord => ({
  ref: `@e${n}` as RefId,
  snapshotId: "placeholder" as SnapshotId,
  targetId: TID,
  stale: true,
  role: "button",
  label: `Btn ${n}`,
  text: null,
  placeholder: null,
  testID: null,
  nativeID: null,
  component: null,
  box: { x: n, y: n, width: 10, height: 10 },
  actions: ["tap"],
})

const mkNode = (n: number): SnapshotNode => ({
  ref: `@e${n}` as RefId,
  role: "button",
  label: `Btn ${n}`,
  text: null,
  testID: null,
  source: "axe",
  box: { x: n, y: n, width: 10, height: 10 },
  actions: ["tap"],
})

const makeSnapshot = (sid: SnapshotId): SnapshotResult => ({
  snapshotId: sid,
  targetId: TID,
  routeHint: "/home",
  source: ["axe"],
  generatedAt: "2026-05-24T01:00:00.000Z",
  filters: {
    interactiveOnly: true,
    compact: false,
    depth: null,
    includeSource: true,
    includeBounds: true,
  },
  refs: [mkRef(7), mkRef(3)], // intentionally out of @e1..@eN order
  tree: [mkNode(7), mkNode(3)],
  artifacts: { json: null, screenshot: null, annotatedScreenshot: null },
  limitations: [],
})

describe("AC-026 snapshot persist + 3 Session pointer invariants", () => {
  it("renumberRefs rewrites to @e1..@eN with stale:false", () => {
    const sid = "snapshot-abc-aaaaaa" as SnapshotId
    const renumbered = renumberRefs(makeSnapshot(sid))
    expect(renumbered.refs.map((r) => r.ref)).toEqual(["@e1", "@e2"])
    expect(renumbered.refs.every((r) => r.stale === false)).toBe(true)
    expect(renumbered.refs.every((r) => r.snapshotId === sid)).toBe(true)
    expect(renumbered.tree.map((n) => n.ref)).toEqual(["@e1", "@e2"])
  })

  it("renumberRefs keeps tree nodes matched to their original RefRecord", () => {
    const sid = "snapshot-abc-aaaaaa" as SnapshotId
    const renumbered = renumberRefs({
      ...makeSnapshot(sid),
      refs: [mkRef(7), mkRef(3)],
      tree: [mkNode(3), mkNode(7)],
    })
    expect(renumbered.refs.map((r) => [r.label, r.ref])).toEqual([
      ["Btn 7", "@e1"],
      ["Btn 3", "@e2"],
    ])
    expect(renumbered.tree.map((n) => [n.label, n.ref])).toEqual([
      ["Btn 3", "@e2"],
      ["Btn 7", "@e1"],
    ])
  })

  it("path helpers reject traversal in persisted id segments", () => {
    const layout = P.makeLayout(STATE_ROOT)
    expect(() => P.sessionFile(layout, "../escape")).toThrow(/Invalid sessionId/)
    expect(() => P.snapshotFile(layout, "review-1", "../escape")).toThrow(/Invalid snapshotId/)
    expect(() => P.runRecordFile(STATE_ROOT, "../escape")).toThrow(/Invalid runId/)
  })

  it.effect("persist writes snapshot + refs, moves lastSnapshotId, invariants hold", () =>
    Effect.gen(function* () {
      const clock = new TestClock()
      const fs = yield* makeMemoryFs()
      const p = makePersistence(fs, clock)
      const layout = P.makeLayout(STATE_ROOT)

      const session = yield* p.sessionNew({ stateRoot: STATE_ROOT, name: "cap" })
      // Active target must exist for invariant 1 once we set activeTargetId.
      yield* p.targetSave(STATE_ROOT, session.sessionId, targetRecord)

      const sid = "snapshot-cap-aaaaaa" as SnapshotId
      const snap = renumberRefs(makeSnapshot(sid))
      const updated = yield* p.snapshotPersist(STATE_ROOT, session.sessionId, snap)

      // session pointer moved + updatedAt = generatedAt
      expect(updated.lastSnapshotId).toBe(sid)
      expect(updated.updatedAt).toBe(snap.generatedAt)

      // files exist on disk
      expect(yield* fs.exists(P.snapshotFile(layout, session.sessionId, sid))).toBe(true)
      expect(yield* fs.exists(P.refsFile(layout, session.sessionId))).toBe(true)
      expect(yield* fs.exists(P.targetFile(layout, session.sessionId))).toBe(true)

      // Invariant 3: refs.json mirrors lastSnapshotId, refs are @e1..@eN.
      const cache = yield* p.refCacheRead(STATE_ROOT, session.sessionId)
      expect(cache.snapshotId).toBe(sid)
      expect(cache.refs.map((r) => r.ref)).toEqual(["@e1", "@e2"])

      // All three invariants pass an explicit verification.
      yield* p.verifyInvariants(STATE_ROOT, session.sessionId)
    }),
  )

  it.effect("persist rejects a snapshot for a different active target before writing artifacts", () =>
    Effect.gen(function* () {
      const clock = new TestClock()
      const fs = yield* makeMemoryFs()
      const p = makePersistence(fs, clock)
      const layout = P.makeLayout(STATE_ROOT)

      const session = yield* p.sessionNew({ stateRoot: STATE_ROOT, name: "wrong-target" })
      yield* p.targetSave(STATE_ROOT, session.sessionId, targetRecord)

      const sid = "snapshot-cap-aaaaaa" as SnapshotId
      const snap = {
        ...renumberRefs(makeSnapshot(sid)),
        targetId: "ios:other:com.example:8081" as TargetId,
      }
      const result = yield* p.snapshotPersist(STATE_ROOT, session.sessionId, snap).pipe(Effect.either)

      expect(result._tag).toBe("Left")
      if (result._tag === "Left") {
        expect(result.left._tag).toBe("InvariantViolation")
        if (result.left._tag === "InvariantViolation") {
          expect(result.left.invariant).toBe("snapshot-target-matches-active-target")
        }
      }
      expect(yield* fs.exists(P.snapshotFile(layout, session.sessionId, sid))).toBe(false)
      expect(yield* fs.exists(P.refsFile(layout, session.sessionId))).toBe(false)
    }),
  )

  it.effect("verifyInvariants fails when lastSnapshotId points at a missing snapshot", () =>
    Effect.gen(function* () {
      const clock = new TestClock()
      const fs = yield* makeMemoryFs()
      const p = makePersistence(fs, clock)
      const layout = P.makeLayout(STATE_ROOT)

      const session = yield* p.sessionNew({ stateRoot: STATE_ROOT, name: "bad" })
      // Hand-corrupt the session pointer to a non-existent snapshot.
      yield* fs.writeFile(
        P.sessionFile(layout, session.sessionId),
        JSON.stringify({
          ...session,
          lastSnapshotId: "snapshot-ghost-aaaaaa",
        }),
      )

      const result = yield* p.verifyInvariants(STATE_ROOT, session.sessionId).pipe(Effect.either)
      expect(result._tag).toBe("Left")
      if (result._tag === "Left") {
        expect(result.left._tag).toBe("InvariantViolation")
        if (result.left._tag === "InvariantViolation") {
          expect(result.left.invariant).toBe("lastSnapshotId-points-at-snapshot")
        }
      }
    }),
  )

  it.effect("verifyInvariants fails when activeTargetId set but target.json missing", () =>
    Effect.gen(function* () {
      const clock = new TestClock()
      const fs = yield* makeMemoryFs()
      const p = makePersistence(fs, clock)
      const layout = P.makeLayout(STATE_ROOT)

      const session = yield* p.sessionNew({ stateRoot: STATE_ROOT, name: "bad2" })
      yield* fs.writeFile(P.sessionFile(layout, session.sessionId), JSON.stringify({ ...session, activeTargetId: TID }))

      const result = yield* p.verifyInvariants(STATE_ROOT, session.sessionId).pipe(Effect.either)
      expect(result._tag).toBe("Left")
      if (result._tag === "Left" && result.left._tag === "InvariantViolation") {
        expect(result.left.invariant).toBe("activeTargetId-points-at-target")
      }
    }),
  )

  it.skip("AC-026 semantic-bridge capture path — needs @expo98/protocols + bridge", () => {
    // The live semantic-bridge capture (CDP Runtime.evaluate -> bridge refs)
    // lands in @expo98/protocols + the C7 bridge handler. This package only
    // owns the persistence of an already-captured SnapshotResult.
  })
})
