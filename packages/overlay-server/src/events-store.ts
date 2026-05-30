import { Fs, type OverlayEvent, OverlayEventsFile } from "@expo98/domain"
import { Context, Effect, Layer, Schema } from "effect"
import { CorruptEventsFile, EventsStoreFailure, type EventsStoreError } from "./errors.js"

/**
 * Events-file store PORT + lifecycle (AC-032).
 *
 * The store is the events.json aggregate's read/write seam. It is injected as a
 * `Context.Tag` so:
 *   - tests bind an in-memory store (no disk) and assert the lifecycle,
 *   - the real server (`server.ts`) binds the fs-backed store via `@expo98/domain`'s
 *     `Fs` port (itself injectable — in-memory for tests, platform-node in the app).
 *
 * Lifecycle (AC-032):
 *   - `prepare({ reset })`  → with `reset` OR no existing file, write a fresh
 *                             `{ version:1, title, createdAt, events:[] }`. With an
 *                             existing file and no reset, leave it untouched.
 *   - `append(event)`       → push `event` to `events[]`, set `updatedAt`, rewrite.
 *   - `read()`              → `{ available:true, file }` or, with no file,
 *                             `{ available:false, reason:"No review overlay events file exists." }`.
 *   - `clear()`             → remove the events file.
 *
 * Every event appended through `append` has ALREADY passed the AC-014 hardening
 * (token + Origin + body-cap + `comments[]` schema) in the request handler — the
 * store does not re-validate the request, only the persisted file shape.
 */

/** The "no events file" sentinel reason (AC-032, exact string). */
export const NO_EVENTS_FILE_REASON = "No review overlay events file exists." as const

/** Result of `read()` (AC-032). */
export type EventsReadResult =
  | { readonly available: true; readonly file: OverlayEventsFile }
  | { readonly available: false; readonly reason: typeof NO_EVENTS_FILE_REASON }

export interface PrepareOptions {
  /** Overlay title written into a fresh file. */
  readonly title: string
  /** Force-reset: rewrite a fresh empty file even if one already exists. */
  readonly reset: boolean
  /** Timestamp for `createdAt` on a fresh file (ISO-8601). */
  readonly now: string
}

export interface EventsStore {
  /** Create or reset the events file (AC-032). Returns the file as written/kept. */
  readonly prepare: (options: PrepareOptions) => Effect.Effect<OverlayEventsFile, EventsStoreError>
  /**
   * Append one validated event, set `updatedAt = now`, rewrite. Returns the new
   * total event count (AC-032). If no file exists yet, a fresh one is created
   * first (defensive — `prepare` should normally precede `server`).
   */
  readonly append: (
    event: OverlayEvent,
    now: string,
  ) => Effect.Effect<{ readonly eventCount: number; readonly file: OverlayEventsFile }, EventsStoreError>
  /** Read the events file or report unavailable (AC-032). */
  readonly read: Effect.Effect<EventsReadResult, EventsStoreError>
  /** Remove the events file (AC-032 `clear`). Idempotent. */
  readonly clear: Effect.Effect<void, EventsStoreError>
}

export class EventsStoreTag extends Context.Tag("@expo98/overlay-server/EventsStore")<EventsStoreTag, EventsStore>() {}

// ---------------------------------------------------------------------------
// Encode / decode helpers — strict schema in, strict schema out.
// ---------------------------------------------------------------------------

const decodeFile = (raw: string): Effect.Effect<OverlayEventsFile, EventsStoreError> =>
  Effect.try({
    try: () => JSON.parse(raw) as unknown,
    catch: () => new CorruptEventsFile({ reason: "events.json is not valid JSON." }),
  }).pipe(
    Effect.flatMap((parsed) =>
      Schema.decodeUnknown(OverlayEventsFile)(parsed).pipe(
        Effect.mapError((e) => new CorruptEventsFile({ reason: `events.json failed schema decode: ${e.message}` })),
      ),
    ),
  )

const encodeFile = (file: OverlayEventsFile): Effect.Effect<string, EventsStoreError> =>
  Schema.encode(OverlayEventsFile)(file).pipe(
    Effect.mapError((e) => new CorruptEventsFile({ reason: `events file failed schema encode: ${e.message}` })),
    Effect.map((encoded) => JSON.stringify(encoded, null, 2)),
  )

const freshFile = (title: string, now: string): OverlayEventsFile => ({
  version: 1,
  title,
  createdAt: now,
  events: [],
})

// ---------------------------------------------------------------------------
// Generic factory over a tiny raw-bytes seam (so the store works on ANY backend:
// the domain `Fs` port, or a pure in-memory cell for the lightest tests).
// ---------------------------------------------------------------------------

/** The minimal raw-bytes backend the store needs. */
export interface RawEventsBackend {
  readonly exists: Effect.Effect<boolean, EventsStoreError>
  readonly readRaw: Effect.Effect<string, EventsStoreError>
  readonly writeRaw: (contents: string) => Effect.Effect<void, EventsStoreError>
  readonly removeRaw: Effect.Effect<void, EventsStoreError>
}

/** Build an `EventsStore` from a raw-bytes backend. */
export const makeEventsStore = (backend: RawEventsBackend): EventsStore => {
  const appendSemaphore = Effect.unsafeMakeSemaphore(1)
  const read: Effect.Effect<EventsReadResult, EventsStoreError> = Effect.gen(function* () {
    const present = yield* backend.exists
    if (!present) {
      return { available: false, reason: NO_EVENTS_FILE_REASON } as const
    }
    const raw = yield* backend.readRaw
    const file = yield* decodeFile(raw)
    return { available: true, file } as const
  })

  const prepare = (options: PrepareOptions): Effect.Effect<OverlayEventsFile, EventsStoreError> =>
    Effect.gen(function* () {
      const present = yield* backend.exists
      if (options.reset || !present) {
        const fresh = freshFile(options.title, options.now)
        yield* backend.writeRaw(yield* encodeFile(fresh))
        return fresh
      }
      // Existing file, no reset: read it back (decoded) and leave it untouched.
      const raw = yield* backend.readRaw
      return yield* decodeFile(raw)
    })

  const append = (
    event: OverlayEvent,
    now: string,
  ): Effect.Effect<{ readonly eventCount: number; readonly file: OverlayEventsFile }, EventsStoreError> =>
    Effect.gen(function* () {
      const present = yield* backend.exists
      // Defensive: a POST before `prepare` still lands in a well-formed file.
      const base: OverlayEventsFile = present
        ? yield* decodeFile(yield* backend.readRaw)
        : freshFile("Review overlay", now)
      const next: OverlayEventsFile = {
        ...base,
        updatedAt: now,
        events: [...base.events, event],
      }
      yield* backend.writeRaw(yield* encodeFile(next))
      return { eventCount: next.events.length, file: next }
    }).pipe(appendSemaphore.withPermits(1))

  const clear: Effect.Effect<void, EventsStoreError> = backend.removeRaw

  return { prepare, append, read, clear }
}

// ---------------------------------------------------------------------------
// In-memory backend (the lightest test seam — a single mutable cell).
// ---------------------------------------------------------------------------

/** Build an in-memory `EventsStore` Layer (no disk). For lifecycle tests. */
export const memoryEventsStoreLayer: Layer.Layer<EventsStoreTag> = Layer.sync(EventsStoreTag, () => {
  let cell: string | null = null
  const backend: RawEventsBackend = {
    exists: Effect.sync(() => cell !== null),
    readRaw: Effect.suspend(() =>
      cell === null ? Effect.fail(new EventsStoreFailure({ op: "read", reason: "ENOENT" })) : Effect.succeed(cell),
    ),
    writeRaw: (contents) =>
      Effect.sync(() => {
        cell = contents
      }),
    removeRaw: Effect.sync(() => {
      cell = null
    }),
  }
  return makeEventsStore(backend)
})

// ---------------------------------------------------------------------------
// Filesystem backend — bridges `@expo98/domain`'s `Fs` port to `RawEventsBackend`.
// The `Fs` port is itself injectable (in-memory for tests, platform-node in the
// app), so this stays disk-agnostic. `events.json` lives at `<overlayDir>/events.json`.
// ---------------------------------------------------------------------------

/** Build an fs-backed `EventsStore` from the domain `Fs` port at a given path. */
export const makeFsEventsStore = (eventsPath: string): Effect.Effect<EventsStore, never, Fs> =>
  Effect.gen(function* () {
    const fs = yield* Fs
    const adaptErr = (op: "read" | "write" | "exists" | "clear", reason: string): EventsStoreFailure =>
      new EventsStoreFailure({ op, reason })
    const backend: RawEventsBackend = {
      exists: fs.exists(eventsPath).pipe(Effect.mapError((e) => adaptErr("exists", e.reason))),
      readRaw: fs.readFile(eventsPath).pipe(Effect.mapError((e) => adaptErr("read", e.reason))),
      writeRaw: (contents) =>
        fs.writeFile(eventsPath, contents).pipe(Effect.mapError((e) => adaptErr("write", e.reason))),
      removeRaw: fs.remove(eventsPath).pipe(Effect.mapError((e) => adaptErr("clear", e.reason))),
    }
    return makeEventsStore(backend)
  })

/** An fs-backed `EventsStore` Layer requiring the domain `Fs` port. */
export const fsEventsStoreLayer = (eventsPath: string): Layer.Layer<EventsStoreTag, never, Fs> =>
  Layer.effect(EventsStoreTag, makeFsEventsStore(eventsPath))
