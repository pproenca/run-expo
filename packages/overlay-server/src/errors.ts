import { Data } from "effect"

/**
 * `@expo98/overlay-server` error taxonomy.
 *
 * These are the rejection causes the hardened request handler (AC-014) maps to
 * HTTP status codes. Each carries enough context to surface a stable, redacted
 * reason on the response without leaking the offending value.
 *
 * NOTE (parallel-safety): like the other packages, we DON'T import core's
 * `CliRuntimeError` family here — the handler returns a typed `Response` value
 * (never throws an HTTP error into `E`), and the lifecycle errors below adapt
 * cleanly onto core's exit-code classifier at the dispatch boundary (all of
 * them are runtime failures → exit 1, never usage errors).
 */

/** A POST arrived with a missing or wrong per-session token (AC-014). → 401. */
export class TokenRejected extends Data.TaggedError("TokenRejected")<{
  readonly reason: string
}> {}

/** A POST arrived with a missing, malformed, or non-loopback `Origin` (AC-014). → 403. */
export class OriginRejected extends Data.TaggedError("OriginRejected")<{
  readonly origin: string | null
  readonly reason: string
}> {}

/** A POST body exceeded the hard body-size cap (AC-014, CWE-400). → 413. */
export class BodyTooLarge extends Data.TaggedError("BodyTooLarge")<{
  readonly limitBytes: number
  readonly actualBytes: number
}> {}

/** A POST body was not JSON or failed the `comments[]` schema (AC-014). → 422. */
export class MalformedBody extends Data.TaggedError("MalformedBody")<{
  readonly reason: string
}> {}

/** A raw events-store filesystem operation failed (AC-032). */
export class EventsStoreFailure extends Data.TaggedError("EventsStoreFailure")<{
  readonly op: "read" | "write" | "exists" | "clear"
  readonly reason: string
}> {}

/** A persisted `events.json` failed strict schema decoding (corrupt / drifted). */
export class CorruptEventsFile extends Data.TaggedError("CorruptEventsFile")<{
  readonly reason: string
}> {}

/** The union of every typed failure the events-store / lifecycle can surface. */
export type EventsStoreError = EventsStoreFailure | CorruptEventsFile

/**
 * The union of every rejection the request handler distinguishes. The handler
 * itself never *fails* with these — it catches them internally and produces a
 * `Response` value — but they are exported so callers (and tests) can name the
 * exact cause classes.
 */
export type RequestRejection =
  | TokenRejected
  | OriginRejected
  | BodyTooLarge
  | MalformedBody
