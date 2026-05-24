/**
 * AC-019 — snapshot capture prerequisites + semantic→native fallback.
 * AC-026 — capture persists `snapshots/<id>.json` + `refs.json`, sets
 *          `lastSnapshotId`/`updatedAt`, renumbers refs `@e1..@eN` (stale:false),
 *          and the THREE Session pointer invariants hold end-to-end.
 *
 * The capture orchestration is driven for real against domain's IN-MEMORY fs +
 * the real `PersistenceService`. The two capture I/O surfaces (semantic bridge /
 * native `axe`) are injected as documented SEAM fakes. We assert that on each
 * prerequisite miss NO artifacts are written, that the semantic path persists,
 * that the native fallback persists when the bridge is absent, and — for AC-026 —
 * that `verifyInvariants` succeeds (the 3 pointers hold) after a capture.
 */
import { describe, expect, it } from "@effect/vitest"
import {
  type DeviceState,
  Fs,
  makeMemoryFs,
  type PersistenceClock,
  PersistenceService,
  persistenceLayer,
  type TargetRecord
} from "@expo98/domain"
import {
  captureSnapshot,
  NativeAxe,
  type NativeAxeResult,
  type SnapshotCaptured,
  SemanticCapture,
  type SemanticCapturePayload
} from "@expo98/handlers-snapshot"
import { Effect, Layer } from "effect"

// ── Deterministic clock (domain id/timestamp seam) ──────────────────────────
let tick = 0
const makeClock = (): PersistenceClock => {
  tick = 0
  return {
    nowIso: () => `2026-05-24T00:00:0${tick % 10}.000Z`,
    suffix: () => {
      tick += 1
      return `s${tick.toString().padStart(4, "0")}`
    }
  }
}

// ── Test layers ─────────────────────────────────────────────────────────────
// ONE shared in-memory fs, exposed as BOTH `Fs` (so tests can assert artifacts)
// and as the dependency of the real `PersistenceService`. `provideMerge` keeps
// `Fs` in the output context alongside `PersistenceService` so both come from the
// same filesystem instance.
const persistence = (clock: PersistenceClock) =>
  persistenceLayer(clock).pipe(
    Layer.provideMerge(Layer.effect(Fs, makeMemoryFs()))
  )

const semanticLayer = (payload: SemanticCapturePayload | null) =>
  Layer.succeed(
    SemanticCapture,
    SemanticCapture.of({ capture: () => Effect.succeed(payload) })
  )

const nativeLayer = (result: NativeAxeResult) =>
  Layer.succeed(NativeAxe, NativeAxe.of({ describeUi: () => Effect.succeed(result) }))

// ── Fixtures ─────────────────────────────────────────────────────────────────
const STATE_ROOT = "/state"

const target = (deviceId: string): TargetRecord => ({
  targetId: "ios:dev-1:app:8081" as TargetRecord["targetId"],
  platform: "ios",
  device: { id: deviceId, name: "iPhone 15", state: "booted" as DeviceState },
  app: { bundleId: "com.example", processName: "example", running: true },
  metro: {
    port: 8081,
    status: "running",
    targetId: null,
    title: null,
    appId: null,
    debuggerUrl: null
  },
  selected: true,
  stale: false
})

const semanticPayload: SemanticCapturePayload = {
  routeHint: "/home",
  refs: [
    {
      role: "button",
      label: "Submit",
      text: null,
      testID: "submit",
      box: { x: 10, y: 20, width: 100, height: 40 },
      actions: ["press"]
    },
    {
      role: "text",
      label: null,
      text: "Welcome",
      testID: null,
      box: { x: 0, y: 0, width: 200, height: 30 },
      actions: []
    }
  ],
  limitations: ["bridge-partial"]
}

const nativeOk: NativeAxeResult = {
  _tag: "ok",
  elements: [
    {
      role: "button",
      label: "Native",
      text: null,
      testID: "n1",
      box: { x: 1, y: 2, width: 3, height: 4 },
      actions: ["press", "long-press"]
    }
  ]
}

// A session created on the in-memory fs so persistence can move its pointers.
const newSession = Effect.gen(function* () {
  const p = yield* PersistenceService
  const session = yield* p.sessionNew({ stateRoot: STATE_ROOT, name: "review" })
  return session
})

describe("AC-019 snapshot capture prerequisites", () => {
  for (const miss of [
    { name: "no session", hasSession: false, activeTarget: null, code: "no-session" },
    {
      name: "no active target",
      hasSession: true,
      activeTarget: null,
      code: "no-active-target"
    },
    {
      name: "missing device.id",
      hasSession: true,
      activeTarget: target(""),
      code: "missing-device-id"
    }
  ] as const) {
    it.effect(
      `AC-019 ${miss.name} → unavailable with the matching reason and NO artifacts written`,
      () =>
        Effect.gen(function* () {
          const clock = makeClock()
          const result = yield* captureSnapshot({
            stateRoot: STATE_ROOT,
            sessionId: "review-x",
            hasSession: miss.hasSession,
            activeTarget: miss.activeTarget,
            clock
          })
          expect(result.available).toBe(false)
          if (result.available === false) {
            expect(result.code).toBe(miss.code)
          }
          // NO artifacts: the memory fs has no snapshots/refs for this session.
          const fs = yield* Fs
          const snapDir = yield* fs.exists(`${STATE_ROOT}/sessions/review-x/snapshots`)
          const refs = yield* fs.exists(`${STATE_ROOT}/sessions/review-x/refs.json`)
          expect(snapDir).toBe(false)
          expect(refs).toBe(false)
        }).pipe(
          Effect.provide(
            Layer.mergeAll(
              persistence(makeClock()),
              semanticLayer(semanticPayload),
              nativeLayer(nativeOk)
            )
          )
        )
    )
  }
})

describe("AC-019 / AC-026 semantic-bridge capture path", () => {
  it.effect(
    "AC-026 semantic capture persists the snapshot + refs.json, sets lastSnapshotId, refs @e1..@eN, and the 3 invariants hold",
    () => {
      const clock = makeClock()
      return Effect.gen(function* () {
        const p = yield* PersistenceService
        const session = yield* newSession
        // Persist a target so the session is a valid capture context.
        yield* p.targetSave(STATE_ROOT, session.sessionId, target("dev-1"))

        const result = yield* captureSnapshot({
          stateRoot: STATE_ROOT,
          sessionId: session.sessionId,
          hasSession: true,
          activeTarget: target("dev-1"),
          depth: null,
          clock
        })

        expect(result.available).toBe(true)
        const ok = result as SnapshotCaptured
        expect(ok.source).toEqual(["semantic-bridge"])
        expect(ok.refCount).toBe(2)

        // lastSnapshotId set on the returned session.
        expect(ok.session.lastSnapshotId).toBe(ok.snapshotId)
        expect(ok.session.updatedAt).toBeDefined()

        // The snapshot file + refs.json exist on disk.
        const snapshot = yield* p.snapshotShow(STATE_ROOT, session.sessionId, ok.snapshotId)
        const cache = yield* p.refCacheRead(STATE_ROOT, session.sessionId)

        // Refs renumbered @e1..@eN with stale:false (AC-026).
        expect(snapshot.refs.map((r) => r.ref)).toEqual(["@e1", "@e2"])
        expect(snapshot.refs.every((r) => r.stale === false)).toBe(true)
        expect(cache.refs.map((r) => r.ref)).toEqual(["@e1", "@e2"])
        expect(cache.snapshotId).toBe(ok.snapshotId)
        expect(snapshot.semanticBridge).toBeDefined()

        // THE AC-026 assertion: the three Session pointer invariants hold.
        // (1) activeTargetId→target.json, (2) lastSnapshotId→snapshot file,
        // (3) refs.json mirrors lastSnapshotId. verifyInvariants fails the
        // effect with InvariantViolation if ANY is broken — so reaching here
        // means all three hold end-to-end.
        yield* p.verifyInvariants(STATE_ROOT, session.sessionId)
        // Re-load the session to confirm the persisted pointer (not just the
        // returned value) points at the snapshot file.
        const reloaded = yield* p.sessionShow(STATE_ROOT, session.sessionId)
        expect(reloaded.lastSnapshotId).toBe(ok.snapshotId)
        expect(reloaded.activeTargetId).toBe(target("dev-1").targetId)
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            persistence(clock),
            semanticLayer(semanticPayload),
            nativeLayer(nativeOk)
          )
        )
      )
    }
  )
})

describe("AC-040 depth filter wired into capture", () => {
  const threeRefs: SemanticCapturePayload = {
    routeHint: null,
    refs: [
      { role: "view", label: "Root", text: null, testID: null, box: null, actions: [] },
      { role: "button", label: "A", text: null, testID: null, box: null, actions: ["press"] },
      { role: "button", label: "B", text: null, testID: null, box: null, actions: ["press"] }
    ],
    limitations: []
  }

  it.effect(
    "AC-040 a depth arg below 1 is CLAMPED to 1 (never reaches the 1..100 schema as 0) and persisted refs/tree stay @eN-aligned",
    () => {
      const clock = makeClock()
      return Effect.gen(function* () {
        const p = yield* PersistenceService
        const session = yield* newSession
        yield* p.targetSave(STATE_ROOT, session.sessionId, target("dev-1"))

        const result = yield* captureSnapshot({
          stateRoot: STATE_ROOT,
          sessionId: session.sessionId,
          hasSession: true,
          activeTarget: target("dev-1"),
          depth: 0, // clamps to 1 (AC-040); 0 would also be rejected by the schema
          clock
        })
        const ok = result as SnapshotCaptured
        const snapshot = yield* p.snapshotShow(STATE_ROOT, session.sessionId, ok.snapshotId)

        // Clamp wired in: 0 → 1 (the schema only accepts null or 1..100).
        expect(snapshot.filters.depth).toBe(1)
        // Full refs set persisted + numbered @e1..@e3.
        expect(snapshot.refs.map((r) => r.ref)).toEqual(["@e1", "@e2", "@e3"])
        // depth 1 keeps root + immediate children (the flat tree is 2 levels).
        expect(snapshot.tree.map((n) => n.ref)).toEqual(["@e1", "@e2", "@e3"])
      }).pipe(
        Effect.provide(
          Layer.mergeAll(persistence(clock), semanticLayer(threeRefs), nativeLayer(nativeOk))
        )
      )
    }
  )

  it.effect("AC-040 depth null (unbounded) persists every tree node + the schema accepts null", () => {
    const clock = makeClock()
    return Effect.gen(function* () {
      const p = yield* PersistenceService
      const session = yield* newSession
      yield* p.targetSave(STATE_ROOT, session.sessionId, target("dev-1"))

      const result = yield* captureSnapshot({
        stateRoot: STATE_ROOT,
        sessionId: session.sessionId,
        hasSession: true,
        activeTarget: target("dev-1"),
        depth: null,
        clock
      })
      const ok = result as SnapshotCaptured
      const snapshot = yield* p.snapshotShow(STATE_ROOT, session.sessionId, ok.snapshotId)
      expect(snapshot.filters.depth).toBe(null)
      expect(snapshot.tree.map((n) => n.ref)).toEqual(["@e1", "@e2", "@e3"])
    }).pipe(
      Effect.provide(
        Layer.mergeAll(persistence(clock), semanticLayer(threeRefs), nativeLayer(nativeOk))
      )
    )
  })
})

describe("AC-019 native axe fallback path", () => {
  it.effect(
    "AC-019 when the semantic bridge is absent and `axe` is present, native describe persists the snapshot",
    () => {
      const clock = makeClock()
      return Effect.gen(function* () {
        const p = yield* PersistenceService
        const session = yield* newSession
        yield* p.targetSave(STATE_ROOT, session.sessionId, target("dev-1"))

        const result = yield* captureSnapshot({
          stateRoot: STATE_ROOT,
          sessionId: session.sessionId,
          hasSession: true,
          activeTarget: target("dev-1"),
          clock
        })

        expect(result.available).toBe(true)
        const ok = result as SnapshotCaptured
        expect(ok.source).toEqual(["native-axe"])
        expect(ok.refCount).toBe(1)

        const snapshot = yield* p.snapshotShow(STATE_ROOT, session.sessionId, ok.snapshotId)
        expect(snapshot.source).toEqual(["native-axe"])
        expect(snapshot.refs[0]?.ref).toBe("@e1")
        // Invariants hold for the native path too.
        yield* p.verifyInvariants(STATE_ROOT, session.sessionId)
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            persistence(clock),
            // Semantic bridge unavailable → fall back to native.
            semanticLayer(null),
            nativeLayer(nativeOk)
          )
        )
      )
    }
  )

  it.effect(
    "AC-019 no semantic bridge and `axe` absent → unavailable (no-axe), NO artifacts",
    () => {
      const clock = makeClock()
      return Effect.gen(function* () {
        const p = yield* PersistenceService
        const session = yield* newSession
        yield* p.targetSave(STATE_ROOT, session.sessionId, target("dev-1"))

        const result = yield* captureSnapshot({
          stateRoot: STATE_ROOT,
          sessionId: session.sessionId,
          hasSession: true,
          activeTarget: target("dev-1"),
          clock
        })
        expect(result.available).toBe(false)
        if (result.available === false) expect(result.code).toBe("no-axe")

        const fs = yield* Fs
        const refs = yield* fs.exists(`${STATE_ROOT}/sessions/${session.sessionId}/refs.json`)
        expect(refs).toBe(false)
        const reloaded = yield* p.sessionShow(STATE_ROOT, session.sessionId)
        expect(reloaded.lastSnapshotId).toBe(null)
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            persistence(clock),
            semanticLayer(null),
            nativeLayer({ _tag: "absent" })
          )
        )
      )
    }
  )

  it.effect("AC-019 native axe transport-failure → unavailable (transport-failure)", () => {
    const clock = makeClock()
    return Effect.gen(function* () {
      const p = yield* PersistenceService
      const session = yield* newSession
      yield* p.targetSave(STATE_ROOT, session.sessionId, target("dev-1"))

      const result = yield* captureSnapshot({
        stateRoot: STATE_ROOT,
        sessionId: session.sessionId,
        hasSession: true,
        activeTarget: target("dev-1"),
        clock
      })
      expect(result.available).toBe(false)
      if (result.available === false) expect(result.code).toBe("transport-failure")
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          persistence(clock),
          semanticLayer(null),
          nativeLayer({ _tag: "transport-failure", reason: "axe crashed" })
        )
      )
    )
  })
})

it.skip("AC-019 live capture against a running app / Hermes / axe", () => {
  // Requires a running Metro + Hermes target OR an installed `axe` CLI against a
  // booted simulator. All pure orchestration + persistence is covered above with
  // the in-memory fs and the injected semantic/native SEAM fakes.
})
