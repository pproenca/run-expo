import { describe, expect, it } from "@effect/vitest"
import { Effect, Layer, Ref } from "effect"
import type { TargetRecord } from "../src/entities.js"
import { Fs, makeMemoryFs } from "../src/fs-port.js"
import type { TargetId } from "../src/ids.js"
import * as P from "../src/paths.js"
import { makePersistence } from "../src/persist.js"
import { STATE_ROOT, TestClock } from "./helpers.js"

const target = (suffix: string): TargetRecord => {
  const targetId = `ios:DEVICE-${suffix}:com.example:${suffix}` as TargetId
  return {
    targetId,
    platform: "ios",
    device: { id: `DEVICE-${suffix}`, name: "iPhone", state: "booted" },
    app: { bundleId: "com.example", processName: "Example", running: true },
    metro: {
      port: Number(suffix),
      status: "running",
      targetId: `page-${suffix}`,
      title: "Example",
      appId: "com.example",
      debuggerUrl: `ws://127.0.0.1:${suffix}/x`,
    },
    selected: true,
    stale: false,
  }
}

/**
 * AC-024 — Sessions own an artifact namespace and move new → close → clean.
 */
describe("AC-024 session lifecycle (new -> close -> clean)", () => {
  it.effect("new creates artifacts/ and a canonical session.json", () =>
    Effect.gen(function* () {
      const fs = yield* makeMemoryFs()
      const p = makePersistence(fs, new TestClock())
      const session = yield* p.sessionNew({ stateRoot: STATE_ROOT, name: "My Review!" })

      expect(session.schemaVersion).toBe(1)
      expect(session.name).toBe("my-review") // AC-043 normalised
      expect(session.activeTargetId).toBeNull()
      expect(session.lastSnapshotId).toBeNull()
      expect(session.sidecars).toEqual([])

      const layout = P.makeLayout(STATE_ROOT)
      expect(yield* fs.exists(P.artifactsDir(layout, session.sessionId))).toBe(true)
      expect(yield* fs.exists(P.sessionFile(layout, session.sessionId))).toBe(true)
    }),
  )

  it.effect("close sets closedAt = updatedAt and clears sidecars", () =>
    Effect.gen(function* () {
      const clock = new TestClock()
      const fs = yield* makeMemoryFs()
      const p = makePersistence(fs, clock)
      const created = yield* p.sessionNew({ stateRoot: STATE_ROOT })
      expect(created.name).toBe("review") // default name

      clock.advance(5_000)
      const closed = yield* p.sessionClose(STATE_ROOT, created.sessionId)
      expect(closed.closedAt).toBeDefined()
      expect(closed.closedAt).toBe(closed.updatedAt)
      expect(closed.sidecars).toEqual([])
      // record retained, not deleted
      const shown = yield* p.sessionShow(STATE_ROOT, created.sessionId)
      expect(shown.closedAt).toBe(closed.closedAt)
    }),
  )

  it.effect("clean deletes sessions older than olderThan, keeps fresh ones", () =>
    Effect.gen(function* () {
      const clock = new TestClock()
      const fs = yield* makeMemoryFs()
      const p = makePersistence(fs, clock)

      // Old session created at T0.
      const old = yield* p.sessionNew({ stateRoot: STATE_ROOT, name: "old" })
      // Advance 10 days; create a fresh session.
      clock.advance(10 * 86_400_000)
      const fresh = yield* p.sessionNew({ stateRoot: STATE_ROOT, name: "fresh" })

      // Clean anything older than 7d (now = T0 + 10d).
      const deleted = yield* p.sessionClean({ stateRoot: STATE_ROOT, olderThan: "7d" })
      expect(deleted).toContain(old.sessionId)
      expect(deleted).not.toContain(fresh.sessionId)

      const layout = P.makeLayout(STATE_ROOT)
      expect(yield* fs.exists(P.sessionDir(layout, old.sessionId))).toBe(false)
      expect(yield* fs.exists(P.sessionDir(layout, fresh.sessionId))).toBe(true)
    }),
  )

  it.effect("list skips a corrupt session.json instead of failing", () =>
    Effect.gen(function* () {
      const clock = new TestClock()
      const fs = yield* makeMemoryFs()
      const p = makePersistence(fs, clock)

      const good = yield* p.sessionNew({ stateRoot: STATE_ROOT, name: "good" })

      // Hand-write a corrupt session dir.
      const layout = P.makeLayout(STATE_ROOT)
      yield* fs.writeFile(P.sessionFile(layout, "broken"), "{ not json")

      const list = yield* p.sessionList(STATE_ROOT)
      const ids = list.map((e) => e.sessionId)
      expect(ids).toContain(good.sessionId)
      expect(ids).not.toContain("broken")
    }),
  )

  it.effect("clean does NOT delete a session with missing/invalid createdAt", () =>
    Effect.gen(function* () {
      const clock = new TestClock()
      const fs = yield* makeMemoryFs()
      const p = makePersistence(fs, clock)
      const layout = P.makeLayout(STATE_ROOT)

      // Write a session whose createdAt is not a valid date.
      const id = "no-created-at"
      yield* fs.writeFile(
        P.sessionFile(layout, id),
        JSON.stringify({
          schemaVersion: 1,
          sessionId: id,
          name: id,
          artifactDir: P.artifactsDir(layout, id),
          createdAt: "not-a-date",
          updatedAt: "not-a-date",
          activeTargetId: null,
          lastSnapshotId: null,
          sidecars: [],
        }),
      )

      clock.advance(100 * 86_400_000)
      const deleted = yield* p.sessionClean({ stateRoot: STATE_ROOT, olderThan: "1d" })
      expect(deleted).not.toContain(id)
      expect(yield* fs.exists(P.sessionDir(layout, id))).toBe(true)
    }),
  )

  it.effect("clean defaults to 7d when olderThan is omitted", () =>
    Effect.gen(function* () {
      const clock = new TestClock()
      const fs = yield* makeMemoryFs()
      const p = makePersistence(fs, clock)
      const old = yield* p.sessionNew({ stateRoot: STATE_ROOT, name: "old" })
      clock.advance(8 * 86_400_000)
      const deleted = yield* p.sessionClean({ stateRoot: STATE_ROOT })
      expect(deleted).toContain(old.sessionId)
    }),
  )

  it.effect("session aggregate writes are serialized per session", () =>
    Effect.gen(function* () {
      const base = yield* makeMemoryFs()
      const activeWrites = yield* Ref.make(0)
      const maxConcurrentWrites = yield* Ref.make(0)
      const trackedWrite = (path: string, contents: string) =>
        Effect.gen(function* () {
          const active = yield* Ref.updateAndGet(activeWrites, (n) => n + 1)
          yield* Ref.update(maxConcurrentWrites, (n) => Math.max(n, active))
          yield* Effect.yieldNow()
          yield* base.writeFile(path, contents)
        }).pipe(Effect.ensuring(Ref.update(activeWrites, (n) => n - 1)))
      const fs = { ...base, writeFile: trackedWrite, writeFileAtomic: trackedWrite }
      const p = makePersistence(fs, new TestClock())
      const session = yield* p.sessionNew({ stateRoot: STATE_ROOT, name: "serialized" })

      yield* Effect.all(
        [
          p.targetSave(STATE_ROOT, session.sessionId, target("8081")),
          p.targetSave(STATE_ROOT, session.sessionId, target("8082")),
        ],
        { concurrency: "unbounded" },
      )

      expect(yield* Ref.get(maxConcurrentWrites)).toBe(1)
    }),
  )

  it.effect("Fs tag is resolvable through the layer (smoke)", () =>
    Effect.gen(function* () {
      const fs = yield* Fs
      yield* fs.mkdirp(STATE_ROOT)
      expect(yield* fs.exists(STATE_ROOT)).toBe(true)
    }).pipe(Effect.provide(Layer.effect(Fs, makeMemoryFs()))),
  )
})
