import { describe, expect, it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { Fs, makeMemoryFs } from "../src/fs-port.js"
import * as P from "../src/paths.js"
import { makePersistence } from "../src/persist.js"
import { STATE_ROOT, TestClock } from "./helpers.js"

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

  it.effect("Fs tag is resolvable through the layer (smoke)", () =>
    Effect.gen(function* () {
      const fs = yield* Fs
      yield* fs.mkdirp(STATE_ROOT)
      expect(yield* fs.exists(STATE_ROOT)).toBe(true)
    }).pipe(Effect.provide(Layer.effect(Fs, makeMemoryFs()))),
  )
})
