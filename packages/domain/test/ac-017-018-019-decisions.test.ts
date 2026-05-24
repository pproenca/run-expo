import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import {
  checkSnapshotPrereqs,
  planRefAction,
  REF_FORMAT,
  resolveTargetCurrent,
  resolveTargetSelect,
  STALE_REASON,
} from "../src/decisions.js"
import type { RefCache, TargetRecord } from "../src/entities.js"
import { makeMemoryFs } from "../src/fs-port.js"
import type { RefId, SnapshotId, TargetId } from "../src/ids.js"
import { composeTargetId } from "../src/naming.js"
import * as P from "../src/paths.js"
import { makePersistence } from "../src/persist.js"
import type { RefRecord } from "../src/value-objects.js"
import { STATE_ROOT, TestClock } from "./helpers.js"

const TID = "ios:DEVICE-1:com.example:8081" as TargetId
const SID = "snapshot-x-aaaaaa" as SnapshotId

const ref = (over: Partial<RefRecord>): RefRecord => ({
  ref: "@e1" as RefId,
  snapshotId: SID,
  targetId: TID,
  stale: false,
  role: "button",
  label: "Submit",
  text: null,
  placeholder: null,
  testID: null,
  nativeID: null,
  component: null,
  box: { x: 10, y: 20, width: 100, height: 40 },
  actions: ["tap"],
  ...over,
})

const cache = (refs: ReadonlyArray<RefRecord>): RefCache => ({
  snapshotId: SID,
  targetId: TID,
  source: ["axe"],
  refs,
})

// ===========================================================================
// AC-017 — ref validity
// ===========================================================================
describe("AC-017 ref validity", () => {
  it("ref format regex matches @eN only", () => {
    expect(REF_FORMAT.test("@e1")).toBe(true)
    expect(REF_FORMAT.test("@e42")).toBe(true)
    expect(REF_FORMAT.test("@x1")).toBe(false)
    expect(REF_FORMAT.test("e1")).toBe(false)
    expect(REF_FORMAT.test("@e")).toBe(false)
  })

  it("no cache -> unavailable", () => {
    const d = planRefAction({ cache: null, ref: "@e1", action: "tap", pointAction: true })
    expect(d.available).toBe(false)
    if (!d.available) expect(d.code).toBe("no-ref-cache")
  })

  it("missing ref -> unavailable", () => {
    const d = planRefAction({
      cache: cache([ref({ ref: "@e1" as RefId })]),
      ref: "@e9",
      action: "tap",
      pointAction: true,
    })
    expect(d.available).toBe(false)
    if (!d.available) expect(d.code).toBe("ref-missing")
  })

  it("stale ref -> unavailable with the stale reason", () => {
    const d = planRefAction({
      cache: cache([ref({ stale: true })]),
      ref: "@e1",
      action: "tap",
      pointAction: true,
    })
    expect(d.available).toBe(false)
    if (!d.available) {
      expect(d.code).toBe("ref-stale")
      expect(d.reason).toBe(STALE_REASON)
    }
  })

  it("ref lacks the action -> unavailable + availableActions", () => {
    const d = planRefAction({
      cache: cache([ref({ actions: ["longpress"] })]),
      ref: "@e1",
      action: "tap",
      pointAction: true,
    })
    expect(d.available).toBe(false)
    if (!d.available) {
      expect(d.code).toBe("ref-lacks-action")
      expect(d.availableActions).toEqual(["longpress"])
    }
  })

  it("ref lacks bounds for a point action -> unavailable", () => {
    const d = planRefAction({
      cache: cache([ref({ box: null })]),
      ref: "@e1",
      action: "tap",
      pointAction: true,
    })
    expect(d.available).toBe(false)
    if (!d.available) expect(d.code).toBe("ref-lacks-bounds")
  })

  it("invalid ref format -> unavailable", () => {
    const d = planRefAction({ cache: cache([]), ref: "nope", action: "tap", pointAction: true })
    expect(d.available).toBe(false)
    if (!d.available) expect(d.code).toBe("invalid-ref-format")
  })

  it("valid + action-capable + bounded -> dry-run plan with centred point", () => {
    const d = planRefAction({
      cache: cache([ref({})]),
      ref: "@e1",
      action: "tap",
      pointAction: true,
    })
    expect(d.available).toBe(true)
    if (d.available) {
      expect(d.ref).toBe("@e1")
      expect(d.targetId).toBe(TID)
      expect(d.point).toEqual({ x: 60, y: 40 }) // 10+100/2, 20+40/2
    }
  })
})

// ===========================================================================
// AC-018 — target staleness
// ===========================================================================
const target = (over: Partial<TargetRecord> = {}): TargetRecord => ({
  targetId: TID,
  platform: "ios",
  device: { id: "DEVICE-1", name: "iPhone 15", state: "booted" },
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
  ...over,
})

describe("AC-018 target staleness", () => {
  it("targetId composition matches the documented join", () => {
    expect(
      composeTargetId({
        platform: "ios",
        deviceId: "DEVICE-1",
        appId: "com.example",
        metroPort: 8081,
      }),
    ).toBe("ios:DEVICE-1:com.example:8081")
  })

  it("targetId falls back metroId -> metroTitle -> no-runtime / no-metro", () => {
    expect(composeTargetId({ platform: "ios", deviceId: "D", metroId: "page-2", metroPort: null })).toBe(
      "ios:D:page-2:no-metro",
    )
    expect(composeTargetId({ platform: "ios", deviceId: "D", metroTitle: "App" })).toBe("ios:D:App:no-metro")
    expect(composeTargetId({ platform: "ios", deviceId: "D" })).toBe("ios:D:no-runtime:no-metro")
  })

  it("rediscovered -> selected:true, stale:false", () => {
    const d = resolveTargetCurrent({
      persisted: target({ stale: true, selected: false }),
      rediscovered: target(),
    })
    expect(d.available).toBe(true)
    if (d.available) {
      expect(d.target.selected).toBe(true)
      expect(d.target.stale).toBe(false)
    }
  })

  it("not rediscovered -> stale:true with the stale reason", () => {
    const d = resolveTargetCurrent({ persisted: target(), rediscovered: null })
    expect(d.available).toBe(false)
    if (!d.available) {
      expect(d.reason).toBe("Selected target is stale.")
      expect(d.target?.stale).toBe(true)
    }
  })

  it("select an id not in rediscovery -> Target not found", () => {
    const d = resolveTargetSelect({ id: "ios:other:app:8081", discovered: [target()] })
    expect(d.available).toBe(false)
    if (!d.available) {
      expect(d.reason).toBe("Target not found.")
      expect(d.targetId).toBe("ios:other:app:8081")
    }
  })

  it("select an id in rediscovery -> selected target", () => {
    const d = resolveTargetSelect({ id: TID, discovered: [target()] })
    expect(d.available).toBe(true)
    if (d.available) expect(d.target.stale).toBe(false)
  })
})

// ===========================================================================
// AC-019 — snapshot prerequisites (and: no artifacts written)
// ===========================================================================
describe("AC-019 snapshot prerequisites", () => {
  it("no session -> unavailable(no-session)", () => {
    const d = checkSnapshotPrereqs({ hasSession: false, activeTarget: null })
    expect(d.available).toBe(false)
    if (!d.available) expect(d.code).toBe("no-session")
  })

  it("no active target -> unavailable(no-active-target)", () => {
    const d = checkSnapshotPrereqs({ hasSession: true, activeTarget: null })
    expect(d.available).toBe(false)
    if (!d.available) expect(d.code).toBe("no-active-target")
  })

  it("missing device.id -> unavailable(missing-device-id)", () => {
    const d = checkSnapshotPrereqs({
      hasSession: true,
      activeTarget: target({ device: { id: "", name: null, state: "unknown" } }),
    })
    expect(d.available).toBe(false)
    if (!d.available) expect(d.code).toBe("missing-device-id")
  })

  it("valid session + target -> available", () => {
    const d = checkSnapshotPrereqs({ hasSession: true, activeTarget: target() })
    expect(d.available).toBe(true)
  })

  it.effect("unavailable prereqs write NO snapshot artifacts to disk", () =>
    Effect.gen(function* () {
      const fs = yield* makeMemoryFs()
      const p = makePersistence(fs, new TestClock())
      const session = yield* p.sessionNew({ stateRoot: STATE_ROOT, name: "s" })

      // Prereq check fails (no active target) -> caller must not persist.
      const d = checkSnapshotPrereqs({ hasSession: true, activeTarget: null })
      expect(d.available).toBe(false)

      // By contract, no snapshot/refs files were written.
      const layout = P.makeLayout(STATE_ROOT)
      expect(yield* fs.exists(P.snapshotsDir(layout, session.sessionId))).toBe(false)
      expect(yield* fs.exists(P.refsFile(layout, session.sessionId))).toBe(false)
    }),
  )
})
