import { Id } from "@expo98/core"
import { type OverlayEvent } from "@expo98/domain"
import { Effect, Schema } from "effect"
import { type EventsStore, EventsStoreTag } from "./events-store.js"
import {
  BodyTooLarge,
  MalformedBody,
  OriginRejected,
  type RequestRejection,
  TokenRejected
} from "./errors.js"
import {
  byteLength,
  checkOrigin,
  DEFAULT_ENDPOINT_PATH,
  EVENTS_JSON_PATH,
  MAX_BODY_BYTES,
  type OverlayRequest,
  type OverlayResponse,
  queryParam,
  splitUrl,
  TOKEN_HEADER,
  tokensMatch,
  validateEndpointPath
} from "./request.js"

/**
 * The hardened request handler — the AC-014 FIX, as a PURE/Effect function over
 * the synthetic request model.
 *
 * Routing:
 *   - `GET /events.json`        → the events file, or `{"events":[]}` when none.
 *   - `POST <endpointPath>`     → ingest (hardened — see below).
 *   - everything else           → 404.
 *
 * POST hardening — ALL enforced BEFORE any append (each failure short-circuits):
 *   (a) unguessable per-session token (header `x-expo98-overlay-token` or `?token=`),
 *   (b) strict loopback-only `Origin` check,
 *   (c) hard body-size cap → 413 when exceeded,
 *   (d) `comments[]` schema validation (Effect `Schema`) → reject malformed.
 *
 * The handler NEVER fails into `E` for an HTTP-level rejection — it returns an
 * `OverlayResponse` value with the right status. Its only `E` channel is the
 * events-store I/O fault (a genuine infrastructure failure), surfaced so the
 * dispatcher can map it to exit 1.
 */

// ===========================================================================
// Inbound POST body schema — `comments[]` (AC-014 schema validation)
// ===========================================================================

/**
 * One inbound review comment. Permissive but TYPED (the legacy appended any JSON
 * verbatim). `kind` defaults to `"comment"`; `payload` is a free-form record
 * that is redacted at the output boundary by `@expo98/core` before it ever
 * leaves the process.
 */
export const OverlayComment = Schema.Struct({
  kind: Schema.optional(Schema.String),
  payload: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.Unknown }))
})
export type OverlayComment = Schema.Schema.Type<typeof OverlayComment>

/** The accepted POST body shape: a non-empty `comments[]` array (AC-014). */
export const OverlayPostBody = Schema.Struct({
  comments: Schema.Array(OverlayComment).pipe(Schema.minItems(1))
})
export type OverlayPostBody = Schema.Schema.Type<typeof OverlayPostBody>

// ===========================================================================
// Handler configuration (per-session)
// ===========================================================================

export interface HandlerConfig {
  /** The unguessable per-session token (generated via core's `Id`). REQUIRED. */
  readonly token: string
  /** The accepted POST endpoint path (default `/events`). Must pass the allowlist. */
  readonly endpointPath: string
  /** Hard body-size cap in bytes (default `MAX_BODY_BYTES`). */
  readonly maxBodyBytes: number
}

/** Build a `HandlerConfig` with the per-session token, applying defaults. */
export const makeHandlerConfig = (
  token: string,
  options?: { readonly endpointPath?: string; readonly maxBodyBytes?: number }
): HandlerConfig => ({
  token,
  endpointPath: options?.endpointPath ?? DEFAULT_ENDPOINT_PATH,
  maxBodyBytes: options?.maxBodyBytes ?? MAX_BODY_BYTES
})

// ===========================================================================
// Response constructors
// ===========================================================================

const json = (status: number, body: unknown): OverlayResponse => ({ status, body })

const notFound = (): OverlayResponse => json(404, { ok: false, error: "not found" })

const rejectionToResponse = (rejection: RequestRejection): OverlayResponse => {
  switch (rejection._tag) {
    case "TokenRejected":
      return json(401, { ok: false, error: rejection.reason })
    case "OriginRejected":
      return json(403, { ok: false, error: rejection.reason })
    case "BodyTooLarge":
      return json(413, {
        ok: false,
        error: "request body too large",
        limitBytes: rejection.limitBytes
      })
    case "MalformedBody":
      return json(422, { ok: false, error: rejection.reason })
  }
}

// ===========================================================================
// The hardening pipeline (PURE checks, in order)
// ===========================================================================

/** Read the token from the header or the `?token=` query param. */
const extractToken = (req: OverlayRequest): string | null => {
  const header = req.headers[TOKEN_HEADER]
  if (header !== undefined && header.length > 0) return header
  const { query } = splitUrl(req.url)
  return queryParam(query, "token")
}

/**
 * Run the four AC-014 checks in order, short-circuiting on the first failure.
 * Returns the parsed body on success. NEVER mutates the store.
 */
const hardenPost = (
  req: OverlayRequest,
  config: HandlerConfig
): Effect.Effect<OverlayPostBody, RequestRejection> =>
  Effect.gen(function* () {
    // (a) token
    const received = extractToken(req)
    if (!tokensMatch(config.token, received)) {
      return yield* Effect.fail(
        new TokenRejected({
          reason: received === null ? "Missing session token." : "Invalid session token."
        })
      )
    }

    // (b) strict loopback Origin
    const origin = req.headers["origin"] ?? null
    const originCheck = checkOrigin(origin)
    if (!originCheck.ok) {
      return yield* Effect.fail(
        new OriginRejected({ origin, reason: originCheck.reason ?? "Origin rejected." })
      )
    }

    // (c) hard body-size cap
    const actualBytes = byteLength(req.body)
    if (actualBytes > config.maxBodyBytes) {
      return yield* Effect.fail(
        new BodyTooLarge({ limitBytes: config.maxBodyBytes, actualBytes })
      )
    }

    // (d) JSON parse + comments[] schema validation
    const parsed = yield* Effect.try({
      try: () => JSON.parse(req.body) as unknown,
      catch: () => new MalformedBody({ reason: "Request body is not valid JSON." })
    })
    const body = yield* Schema.decodeUnknown(OverlayPostBody)(parsed).pipe(
      Effect.mapError(
        (e) => new MalformedBody({ reason: `comments[] schema validation failed: ${e.message}` })
      )
    )
    return body
  })

/** Map one validated inbound comment to a persisted, provenance-stamped event. */
const commentToEvent = (
  comment: OverlayComment,
  id: string,
  now: string
): OverlayEvent => ({
  id,
  createdAt: now,
  kind: comment.kind ?? "comment",
  payload: comment.payload ?? {}
})

// ===========================================================================
// The handler
// ===========================================================================

/**
 * Handle one synthetic request against the injected `EventsStore`. The result is
 * ALWAYS an `OverlayResponse` for routing/hardening outcomes; the `E` channel
 * carries only a genuine events-store I/O fault.
 */
export const handleRequest = (
  req: OverlayRequest,
  config: HandlerConfig
): Effect.Effect<OverlayResponse, never, EventsStoreTag | Id> =>
  Effect.gen(function* () {
    const store: EventsStore = yield* EventsStoreTag
    const id = yield* Id
    const { path } = splitUrl(req.url)

    // -- GET /events.json --------------------------------------------------
    if (req.method === "GET" && path === EVENTS_JSON_PATH) {
      const result = yield* store.read
      const file = result.available ? result.file : { events: [] }
      return json(200, file)
    }

    // -- POST <endpointPath> ----------------------------------------------
    if (req.method === "POST") {
      // Path allowlist FIRST: a disallowed path is a 404 regardless of method.
      if (!validateEndpointPath(path) || path !== config.endpointPath) {
        return notFound()
      }
      // Run the four hardening checks; a rejection becomes the right status.
      const decision = yield* hardenPost(req, config).pipe(Effect.either)
      if (decision._tag === "Left") {
        return rejectionToResponse(decision.left)
      }
      const postBody = decision.right
      // Append each validated comment as a provenance-stamped event.
      let count = 0
      for (const comment of postBody.comments) {
        const now = yield* id.now
        const eventId = yield* id.generateId("evt")
        const result = yield* store.append(commentToEvent(comment, eventId, now), now)
        count = result.eventCount
      }
      return json(200, { ok: true, endpoint: config.endpointPath, eventCount: count })
    }

    // -- everything else ---------------------------------------------------
    return notFound()
  }).pipe(
    // An events-store I/O fault is a genuine infra failure → surface as a 500
    // value rather than crashing the listener. The dispatcher classifies the
    // overall command's exit code; the listener itself never dies on one request.
    Effect.catchAll((e) =>
      Effect.succeed(
        json(500, { ok: false, error: "events store failure", reason: e.reason })
      )
    )
  )
