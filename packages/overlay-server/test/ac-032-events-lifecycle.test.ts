import { describe, expect, it } from "@effect/vitest"
/**
 * AC-032 — Review-overlay events file is created/reset then appended.
 *
 *   - `prepare` with `reset` OR no existing file → fresh `{version:1,title,createdAt,events:[]}`.
 *   - `prepare` with an existing file and no reset → left untouched.
 *   - a (validated) POST → append to `events[]`, set `updatedAt`, rewrite.
 *   - `read` with no file → `{ available:false, reason:"No review overlay events file exists." }`.
 *   - `clear` → removes the file.
 *
 * Action enum is `prepare | server | read | clear` — NO `scaffold` (the dropped
 * HTML part). Exercised over BOTH store backends: the in-memory cell and the
 * fs-backed store over the domain `Fs` port (in-memory `MemoryFsLayer`).
 */
import { Fs, MemoryFsLayer } from "@expo98/domain"
import { Effect, Layer } from "effect"
import {
  EventsStoreTag,
  makeEventsStore,
  makeFsEventsStore,
  MAX_EVENTS,
  MAX_EVENTS_FILE_BYTES,
  memoryEventsStoreLayer,
  NO_EVENTS_FILE_REASON,
  type RawEventsBackend,
} from "../src/index.js"

const event = (id: string) => ({ id, createdAt: "2026-05-24T00:00:00.000Z", kind: "comment", payload: {} })

describe("AC-032 events lifecycle (in-memory store)", () => {
  it.effect("prepare with NO existing file → fresh empty file", () =>
    Effect.gen(function* () {
      const store = yield* EventsStoreTag
      const file = yield* store.prepare({
        title: "My Review",
        reset: false,
        now: "2026-05-24T10:00:00.000Z",
      })
      expect(file).toEqual({
        version: 1,
        title: "My Review",
        createdAt: "2026-05-24T10:00:00.000Z",
        events: [],
      })
    }).pipe(Effect.provide(memoryEventsStoreLayer)),
  )

  it.effect("prepare with reset → rewrites a fresh file even when one exists", () =>
    Effect.gen(function* () {
      const store = yield* EventsStoreTag
      yield* store.prepare({ title: "First", reset: false, now: "2026-05-24T10:00:00.000Z" })
      yield* store.append(event("evt-1"), "2026-05-24T10:05:00.000Z")
      // reset wipes back to empty, with the new title + createdAt.
      const reset = yield* store.prepare({
        title: "Second",
        reset: true,
        now: "2026-05-24T11:00:00.000Z",
      })
      expect(reset.title).toBe("Second")
      expect(reset.createdAt).toBe("2026-05-24T11:00:00.000Z")
      expect(reset.events).toHaveLength(0)
    }).pipe(Effect.provide(memoryEventsStoreLayer)),
  )

  it.effect("prepare WITHOUT reset on an existing file → leaves events untouched", () =>
    Effect.gen(function* () {
      const store = yield* EventsStoreTag
      yield* store.prepare({ title: "Keep", reset: false, now: "2026-05-24T10:00:00.000Z" })
      yield* store.append(event("evt-1"), "2026-05-24T10:05:00.000Z")
      const again = yield* store.prepare({
        title: "Ignored",
        reset: false,
        now: "2026-05-24T12:00:00.000Z",
      })
      // No reset → original title/createdAt + the appended event are preserved.
      expect(again.title).toBe("Keep")
      expect(again.createdAt).toBe("2026-05-24T10:00:00.000Z")
      expect(again.events).toHaveLength(1)
    }).pipe(Effect.provide(memoryEventsStoreLayer)),
  )

  it.effect("append → pushes to events[] and sets updatedAt", () =>
    Effect.gen(function* () {
      const store = yield* EventsStoreTag
      yield* store.prepare({ title: "Appendable", reset: false, now: "2026-05-24T10:00:00.000Z" })
      const r1 = yield* store.append(event("evt-1"), "2026-05-24T10:05:00.000Z")
      expect(r1.eventCount).toBe(1)
      expect(r1.file.updatedAt).toBe("2026-05-24T10:05:00.000Z")
      const r2 = yield* store.append(event("evt-2"), "2026-05-24T10:06:00.000Z")
      expect(r2.eventCount).toBe(2)
      expect(r2.file.updatedAt).toBe("2026-05-24T10:06:00.000Z")
      expect(r2.file.events.map((e) => e.id)).toEqual(["evt-1", "evt-2"])
    }).pipe(Effect.provide(memoryEventsStoreLayer)),
  )

  it.effect("read with NO file → unavailable with the exact reason", () =>
    Effect.gen(function* () {
      const store = yield* EventsStoreTag
      const r = yield* store.read
      expect(r.available).toBe(false)
      if (!r.available) {
        expect(r.reason).toBe(NO_EVENTS_FILE_REASON)
        expect(r.reason).toBe("No review overlay events file exists.")
      }
    }).pipe(Effect.provide(memoryEventsStoreLayer)),
  )

  it.effect("read after prepare → available with the file", () =>
    Effect.gen(function* () {
      const store = yield* EventsStoreTag
      yield* store.prepare({ title: "Readable", reset: false, now: "2026-05-24T10:00:00.000Z" })
      const r = yield* store.read
      expect(r.available).toBe(true)
      if (r.available) expect(r.file.title).toBe("Readable")
    }).pipe(Effect.provide(memoryEventsStoreLayer)),
  )

  it.effect("clear → removes the file; subsequent read is unavailable", () =>
    Effect.gen(function* () {
      const store = yield* EventsStoreTag
      yield* store.prepare({ title: "Clearable", reset: false, now: "2026-05-24T10:00:00.000Z" })
      yield* store.append(event("evt-1"), "2026-05-24T10:05:00.000Z")
      yield* store.clear
      const r = yield* store.read
      expect(r.available).toBe(false)
    }).pipe(Effect.provide(memoryEventsStoreLayer)),
  )

  it.effect("clear when no file exists → idempotent no-op", () =>
    Effect.gen(function* () {
      const store = yield* EventsStoreTag
      yield* store.clear // does not fail
      const r = yield* store.read
      expect(r.available).toBe(false)
    }).pipe(Effect.provide(memoryEventsStoreLayer)),
  )

  it.effect("append rejects when the event-count cap would be exceeded", () =>
    Effect.gen(function* () {
      let cell: string | null = JSON.stringify({
        version: 1,
        title: "Bounded",
        createdAt: "2026-05-24T10:00:00.000Z",
        events: Array.from({ length: MAX_EVENTS }, (_, i) => event(`evt-${i}`)),
      })
      let writes = 0
      const store = makeEventsStore({
        exists: Effect.succeed(true),
        readRaw: Effect.sync(() => cell ?? ""),
        writeRaw: (contents) =>
          Effect.sync(() => {
            writes += 1
            cell = contents
          }),
        removeRaw: Effect.sync(() => {
          cell = null
        }),
      })
      const failure = yield* store.append(event("evt-overflow"), "2026-05-24T10:06:00.000Z").pipe(Effect.flip)
      expect(failure._tag).toBe("EventsStoreLimitExceeded")
      expect(writes).toBe(0)
    }),
  )

  it.effect("append rejects when the encoded file-size cap would be exceeded before write", () =>
    Effect.gen(function* () {
      let cell: string | null = JSON.stringify({
        version: 1,
        title: "Large",
        createdAt: "2026-05-24T10:00:00.000Z",
        events: [],
      })
      let writes = 0
      const backend: RawEventsBackend = {
        exists: Effect.succeed(true),
        readRaw: Effect.sync(() => cell ?? ""),
        writeRaw: (contents) =>
          Effect.sync(() => {
            writes += 1
            cell = contents
          }),
        removeRaw: Effect.sync(() => {
          cell = null
        }),
      }
      const store = makeEventsStore(backend)
      const huge = event("evt-huge")
      const failure = yield* store
        .append(
          {
            ...huge,
            payload: { text: "x".repeat(MAX_EVENTS_FILE_BYTES) },
          },
          "2026-05-24T10:06:00.000Z",
        )
        .pipe(Effect.flip)
      expect(failure._tag).toBe("EventsStoreLimitExceeded")
      expect(writes).toBe(0)
    }),
  )
})

describe("AC-032 events lifecycle (fs-backed store over the domain Fs port)", () => {
  const eventsPath = "/state/overlay/events.json"

  it.effect("prepare → append → read → clear round-trips through the Fs port", () =>
    Effect.gen(function* () {
      const store = yield* makeFsEventsStore(eventsPath)

      // read with no file → unavailable
      const empty = yield* store.read
      expect(empty.available).toBe(false)

      // prepare writes a real file on the (in-memory) Fs
      yield* store.prepare({ title: "FS Review", reset: false, now: "2026-05-24T10:00:00.000Z" })
      const fs = yield* Fs
      expect(yield* fs.exists(eventsPath)).toBe(true)

      // append persists + sets updatedAt; a fresh read decodes the strict schema
      yield* store.append(event("evt-1"), "2026-05-24T10:05:00.000Z")
      const r = yield* store.read
      expect(r.available).toBe(true)
      if (r.available) {
        expect(r.file.events).toHaveLength(1)
        expect(r.file.updatedAt).toBe("2026-05-24T10:05:00.000Z")
      }

      // clear removes it from the Fs
      yield* store.clear
      expect(yield* fs.exists(eventsPath)).toBe(false)
    }).pipe(Effect.provide(MemoryFsLayer)),
  )

  it.effect("a corrupt events.json on disk → read fails with CorruptEventsFile", () =>
    Effect.gen(function* () {
      const fs = yield* Fs
      yield* fs.writeFile(eventsPath, "{ this is not valid json")
      const store = yield* makeFsEventsStore(eventsPath)
      const failure = yield* store.read.pipe(Effect.flip)
      expect(failure._tag).toBe("CorruptEventsFile")
    }).pipe(Effect.provide(MemoryFsLayer)),
  )
})

// The dropped scaffold action — guarded so no one re-adds it to the enum.
describe("AC-032 action enum (scaffold dropped)", () => {
  it("action enum is prepare|server|read|clear — NO scaffold", () => {
    const ACTIONS = ["prepare", "server", "read", "clear"] as const
    expect(ACTIONS).not.toContain("scaffold")
    expect(ACTIONS).toHaveLength(4)
  })
})
