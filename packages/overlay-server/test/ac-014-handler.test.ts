import { Readable } from "node:stream"
import { describe, expect, it } from "@effect/vitest"
/**
 * AC-014 — Review-overlay local server is hardened (the FIX).
 *
 * These tests exercise the PURE/Effect `handleRequest` over the synthetic request
 * model with an injected in-memory events store and core's `Id` — NO socket is
 * bound. They prove every required hardening:
 *   - POST rejected with missing / wrong token            → 401
 *   - POST rejected with bad / cross / missing Origin      → 403
 *   - oversized body                                       → 413
 *   - malformed `comments[]`                               → 422
 *   - disallowed path                                      → 404
 *   - valid POST                                           → appended (200)
 *
 * The PURE primitives (path allowlist, Origin check, token compare) are also
 * asserted directly. The live loopback bind + EADDRINUSE port search round-trip
 * is `it.skip`'d (needs a real socket).
 */
import { IdDefault, REDACTED } from "@expo98/core"
import { Effect, Layer } from "effect"
import {
  checkOrigin,
  EventsStoreTag,
  findAvailablePort,
  handleRequest,
  type HandlerConfig,
  launchOverlayServerLayer,
  isLoopbackHost,
  makeHandlerConfig,
  memoryEventsStoreLayer,
  type OverlayRequest,
  readCappedText,
  TOKEN_HEADER,
  tokensMatch,
  validateEndpointPath,
} from "../src/index.js"

const TOKEN = "session-token-abc123-unguessable"
const config: HandlerConfig = makeHandlerConfig(TOKEN)

// The full environment a handler needs: an in-memory store + the Id service.
const testLayer = Layer.merge(memoryEventsStoreLayer, IdDefault)

const baseHeaders = {
  origin: "http://127.0.0.1:17655",
  [TOKEN_HEADER]: TOKEN,
}

const post = (over: Partial<OverlayRequest> = {}): OverlayRequest => ({
  method: "POST",
  url: "/events",
  headers: baseHeaders,
  body: JSON.stringify({ comments: [{ kind: "comment", payload: { text: "hi" } }] }),
  ...over,
})

// ---------------------------------------------------------------------------
// PURE primitives (the core of the FIX, tested directly)
// ---------------------------------------------------------------------------

describe("AC-014 PURE hardening primitives", () => {
  it("validateEndpointPath: allowlist ^/[A-Za-z0-9_./-]+$", () => {
    expect(validateEndpointPath("/events")).toBe(true)
    expect(validateEndpointPath("/a/b-c_d.json")).toBe(true)
    expect(validateEndpointPath("/")).toBe(false) // needs at least one path char
    expect(validateEndpointPath("events")).toBe(false) // no leading slash
    expect(validateEndpointPath("/events?x=1")).toBe(false) // query char rejected
    expect(validateEndpointPath("/ev ents")).toBe(false) // space rejected
    expect(validateEndpointPath("/%2e%2e")).toBe(false) // percent rejected
  })

  it("checkOrigin: loopback only; missing/non-loopback/unparsable rejected", () => {
    expect(checkOrigin("http://127.0.0.1:17655").ok).toBe(true)
    expect(checkOrigin("http://localhost:17655").ok).toBe(true)
    expect(checkOrigin("http://[::1]:17655").ok).toBe(true)
    expect(checkOrigin(null).ok).toBe(false)
    expect(checkOrigin("").ok).toBe(false)
    expect(checkOrigin("http://evil.com").ok).toBe(false)
    expect(checkOrigin("not a url").ok).toBe(false)
    expect(isLoopbackHost("evil.com")).toBe(false)
  })

  it("tokensMatch: exact, non-empty, length-aware", () => {
    expect(tokensMatch(TOKEN, TOKEN)).toBe(true)
    expect(tokensMatch(TOKEN, "wrong")).toBe(false)
    expect(tokensMatch(TOKEN, null)).toBe(false)
    expect(tokensMatch(TOKEN, undefined)).toBe(false)
    expect(tokensMatch("", "")).toBe(false) // empty expected is never a match
  })

  it.effect("findAvailablePort skips busy ports through the injected probe", () =>
    Effect.gen(function* () {
      const seen: Array<number> = []
      const port = yield* findAvailablePort(17655, (candidate) =>
        Effect.sync(() => {
          seen.push(candidate)
          return candidate === 17657
        }),
      )
      expect(port).toBe(17657)
      expect(seen).toEqual([17655, 17656, 17657])
    }),
  )

  it.effect("launchOverlayServerLayer resolves the free port before building the layer", () =>
    Effect.gen(function* () {
      const seen: Array<number> = []
      const layer = yield* launchOverlayServerLayer(
        { token: TOKEN, eventsPath: "/events.json", port: 17655 },
        (candidate) =>
          Effect.sync(() => {
            seen.push(candidate)
            return candidate === 17656
          }),
      )
      expect(layer).toBeDefined()
      expect(seen).toEqual([17655, 17656])
    }),
  )

  it.effect("readCappedText returns text while total chunks stay within the cap", () =>
    Effect.gen(function* () {
      const read = yield* readCappedText(Readable.from([Buffer.from("hello"), Buffer.from(" world")]), 16)
      expect(read).toEqual({ _tag: "Body", body: "hello world" })
    }),
  )

  it.effect("readCappedText stops accumulating once the cap is crossed", () =>
    Effect.gen(function* () {
      const read = yield* readCappedText(Readable.from([Buffer.from("hello"), Buffer.from(" world")]), 8)
      expect(read).toEqual({ _tag: "TooLarge", limitBytes: 8, actualBytes: 11 })
    }),
  )
})

// ---------------------------------------------------------------------------
// POST hardening — each rejection maps to its status
// ---------------------------------------------------------------------------

describe("AC-014 POST hardening (handleRequest, in-memory store)", () => {
  it.effect("POST rejected with MISSING token → 401", () =>
    Effect.gen(function* () {
      const req = post({ headers: { origin: "http://127.0.0.1:17655" } })
      const res = yield* handleRequest(req, config)
      expect(res.status).toBe(401)
    }).pipe(Effect.provide(testLayer)),
  )

  it.effect("POST rejected with WRONG token → 401", () =>
    Effect.gen(function* () {
      const req = post({
        headers: { origin: "http://127.0.0.1:17655", [TOKEN_HEADER]: "guessed-wrong" },
      })
      const res = yield* handleRequest(req, config)
      expect(res.status).toBe(401)
    }).pipe(Effect.provide(testLayer)),
  )

  it.effect("POST rejected with CROSS / non-loopback Origin → 403", () =>
    Effect.gen(function* () {
      const req = post({
        headers: { origin: "http://evil.example.com", [TOKEN_HEADER]: TOKEN },
      })
      const res = yield* handleRequest(req, config)
      expect(res.status).toBe(403)
    }).pipe(Effect.provide(testLayer)),
  )

  it.effect("POST rejected with MISSING Origin → 403", () =>
    Effect.gen(function* () {
      const req = post({ headers: { [TOKEN_HEADER]: TOKEN } })
      const res = yield* handleRequest(req, config)
      expect(res.status).toBe(403)
    }).pipe(Effect.provide(testLayer)),
  )

  it.effect("POST with OVERSIZED body → 413", () =>
    Effect.gen(function* () {
      const tiny = makeHandlerConfig(TOKEN, { maxBodyBytes: 32 })
      const big = JSON.stringify({
        comments: [{ kind: "comment", payload: { text: "x".repeat(200) } }],
      })
      const res = yield* handleRequest(post({ body: big }), tiny)
      expect(res.status).toBe(413)
    }).pipe(Effect.provide(testLayer)),
  )

  it.effect("POST with MALFORMED comments[] (not JSON) → 422", () =>
    Effect.gen(function* () {
      const res = yield* handleRequest(post({ body: "}{ not json" }), config)
      expect(res.status).toBe(422)
    }).pipe(Effect.provide(testLayer)),
  )

  it.effect("POST with MALFORMED comments[] (empty array) → 422", () =>
    Effect.gen(function* () {
      const res = yield* handleRequest(post({ body: JSON.stringify({ comments: [] }) }), config)
      expect(res.status).toBe(422)
    }).pipe(Effect.provide(testLayer)),
  )

  it.effect("POST with MALFORMED comments[] (wrong element shape) → 422", () =>
    Effect.gen(function* () {
      const bad = JSON.stringify({ comments: [{ kind: 123 }] }) // kind must be string
      const res = yield* handleRequest(post({ body: bad }), config)
      expect(res.status).toBe(422)
    }).pipe(Effect.provide(testLayer)),
  )

  it.effect("POST to a DISALLOWED path → 404", () =>
    Effect.gen(function* () {
      const res = yield* handleRequest(post({ url: "/not-the-endpoint" }), config)
      expect(res.status).toBe(404)
    }).pipe(Effect.provide(testLayer)),
  )

  it.effect("POST to a path failing the allowlist regex → 404", () =>
    Effect.gen(function* () {
      const res = yield* handleRequest(post({ url: "/ev ents" }), config)
      expect(res.status).toBe(404)
    }).pipe(Effect.provide(testLayer)),
  )

  it.effect("VALID POST → 200 and event appended", () =>
    Effect.gen(function* () {
      const store = yield* EventsStoreTag
      const res = yield* handleRequest(post(), config)
      expect(res.status).toBe(200)
      expect(res.body).toMatchObject({ ok: true, eventCount: 1 })

      // The event is actually persisted, with provenance stamped on it.
      const read = yield* store.read
      expect(read.available).toBe(true)
      if (read.available) {
        expect(read.file.events).toHaveLength(1)
        expect(read.file.events[0]!.kind).toBe("comment")
        expect(read.file.events[0]!.payload).toMatchObject({ text: "hi" })
        expect(read.file.updatedAt).toBeDefined()
      }
    }).pipe(Effect.provide(testLayer)),
  )

  it.effect("VALID POST redacts free-form payload before persistence", () =>
    Effect.gen(function* () {
      const store = yield* EventsStoreTag
      const body = JSON.stringify({
        comments: [{ kind: "comment", payload: { text: "hi", note: "Bearer sk-overlay-secret-token" } }],
      })
      const res = yield* handleRequest(post({ body }), config)
      expect(res.status).toBe(200)
      const read = yield* store.read
      expect(read.available).toBe(true)
      if (read.available) {
        expect(read.file.events[0]!.payload).toMatchObject({ text: "hi", note: `Bearer ${REDACTED}` })
      }
    }).pipe(Effect.provide(testLayer)),
  )

  it.effect("VALID POST accepts token via ?token= query param too", () =>
    Effect.gen(function* () {
      const req = post({
        url: `/events?token=${TOKEN}`,
        headers: { origin: "http://127.0.0.1:17655" }, // no header token
      })
      const res = yield* handleRequest(req, config)
      expect(res.status).toBe(200)
    }).pipe(Effect.provide(testLayer)),
  )

  it.effect("VALID multi-comment POST appends every comment", () =>
    Effect.gen(function* () {
      const store = yield* EventsStoreTag
      const body = JSON.stringify({
        comments: [{ kind: "comment" }, { kind: "issue" }, { kind: "note" }],
      })
      const res = yield* handleRequest(post({ body }), config)
      expect(res.status).toBe(200)
      expect(res.body).toMatchObject({ eventCount: 3 })
      const read = yield* store.read
      if (read.available) expect(read.file.events).toHaveLength(3)
    }).pipe(Effect.provide(testLayer)),
  )
})

// ---------------------------------------------------------------------------
// GET /events.json routing + 404 default
// ---------------------------------------------------------------------------

describe("AC-014 routing — GET /events.json + 404 default", () => {
  it.effect('GET /events.json with NO file → 200 {"events":[]}', () =>
    Effect.gen(function* () {
      const res = yield* handleRequest({ method: "GET", url: "/events.json", headers: {}, body: "" }, config)
      expect(res.status).toBe(200)
      expect(res.body).toEqual({ events: [] })
    }).pipe(Effect.provide(testLayer)),
  )

  it.effect("GET /events.json after a POST → 200 with the events file", () =>
    Effect.gen(function* () {
      yield* handleRequest(post(), config)
      const res = yield* handleRequest({ method: "GET", url: "/events.json", headers: {}, body: "" }, config)
      expect(res.status).toBe(200)
      expect(res.body).toMatchObject({ version: 1 })
    }).pipe(Effect.provide(testLayer)),
  )

  it.effect("GET an unknown path → 404", () =>
    Effect.gen(function* () {
      const res = yield* handleRequest({ method: "GET", url: "/whatever", headers: {}, body: "" }, config)
      expect(res.status).toBe(404)
    }).pipe(Effect.provide(testLayer)),
  )

  it.effect("an unsupported method on the endpoint → 404", () =>
    Effect.gen(function* () {
      const res = yield* handleRequest({ method: "DELETE", url: "/events", headers: baseHeaders, body: "" }, config)
      expect(res.status).toBe(404)
    }).pipe(Effect.provide(testLayer)),
  )
})

// ---------------------------------------------------------------------------
// Live-only path — needs a real socket (skipped, AC-tagged)
// ---------------------------------------------------------------------------

describe("AC-014 live HTTP bind (skipped — needs a real socket)", () => {
  it.skip("AC-014 live loopback bind + EADDRINUSE port search round-trip (127.0.0.1, from 17655)", () => {})
})
