/**
 * Synthetic request / response model + the PURE hardening primitives (AC-014).
 *
 * The handler is written against THIS model — a plain `OverlayRequest` value and
 * a plain `OverlayResponse` value — NOT against `@effect/platform`'s
 * `HttpServerRequest` Context machinery. That is the testability seam: tests
 * exercise token / Origin / body-cap / schema / 404 logic by constructing an
 * `OverlayRequest` literal, with no socket and no Effect environment for the I/O
 * transport. The real `@effect/platform-node` server (see `server.ts`) adapts an
 * incoming `HttpServerRequest` into an `OverlayRequest`, calls the same handler,
 * and renders the `OverlayResponse` back out.
 *
 * Every primitive here is pure and exhaustively testable:
 *   - `validateEndpointPath` — the `^\/[A-Za-z0-9_./-]+$` allowlist (404 floor).
 *   - `checkOrigin` — strict loopback-only Origin check.
 *   - `tokensMatch` — constant-time-ish token comparison.
 *   - `findAvailablePort` (in `server.ts`) builds on `BIND_HOST`/`DEFAULT_PORT`.
 */

// ===========================================================================
// Network constants (AC-014)
// ===========================================================================

/** The handler binds loopback only. Hard-coded; never widened. */
export const BIND_HOST = "127.0.0.1" as const

/** Default port; the search increments from here on `EADDRINUSE` (AC-014). */
export const DEFAULT_PORT = 17655 as const

/** Port range bounds (all ports clamp 1..65535). */
export const MIN_PORT = 1 as const
export const MAX_PORT = 65535 as const

/** Default POST endpoint path (AC-014). */
export const DEFAULT_ENDPOINT_PATH = "/events" as const

/** The fixed read path. */
export const EVENTS_JSON_PATH = "/events.json" as const

/**
 * Hard body-size cap in bytes (AC-014, CWE-400). 256 KiB is generous for a batch
 * of review comments yet bounded so a malicious/runaway client cannot exhaust
 * memory. The legacy server had NO cap at all.
 */
export const MAX_BODY_BYTES = 256 * 1024

/** Header carrying the per-session token (AC-014). Query param `token` also accepted. */
export const TOKEN_HEADER = "x-expo98-overlay-token" as const

/** The endpoint-path allowlist pattern (AC-014). */
export const ENDPOINT_PATH_PATTERN = /^\/[A-Za-z0-9_./-]+$/

/** The four canonical loopback host spellings (mirrors `@expo98/protocols`). */
export const LOOPBACK_HOSTS: ReadonlySet<string> = new Set([
  "127.0.0.1",
  "localhost",
  "[::1]",
  "::1"
])

// ===========================================================================
// Request / Response value model
// ===========================================================================

/** HTTP methods the handler distinguishes. Anything else → 404. */
export type OverlayMethod = "GET" | "POST" | "PUT" | "DELETE" | "HEAD" | "OPTIONS" | "PATCH"

/**
 * A synthetic inbound request. Headers are lower-cased by convention (the real
 * adapter lower-cases on the way in); `body` is the already-buffered raw text
 * (the adapter enforces the cap while buffering AND the handler re-checks the
 * byte length defensively).
 */
export interface OverlayRequest {
  readonly method: OverlayMethod
  /** Full request target, e.g. `/events?token=abc` (path + optional query). */
  readonly url: string
  /** Lower-cased header name → value. */
  readonly headers: Readonly<Record<string, string>>
  /** Raw request body text (may be empty). */
  readonly body: string
}

/** A synthetic response the handler renders. The adapter turns it into the real one. */
export interface OverlayResponse {
  readonly status: number
  /** Always JSON (`application/json`). */
  readonly body: unknown
}

// ===========================================================================
// PURE primitives
// ===========================================================================

/** Split a request target into its path and (raw, undecoded) query string. */
export const splitUrl = (url: string): { readonly path: string; readonly query: string } => {
  const q = url.indexOf("?")
  if (q < 0) return { path: url, query: "" }
  return { path: url.slice(0, q), query: url.slice(q + 1) }
}

/** Parse a single query-param value out of a raw query string. */
export const queryParam = (query: string, name: string): string | null => {
  if (query.length === 0) return null
  for (const pair of query.split("&")) {
    const eq = pair.indexOf("=")
    const key = eq < 0 ? pair : pair.slice(0, eq)
    if (decodeURIComponent(key) === name) {
      return eq < 0 ? "" : decodeURIComponent(pair.slice(eq + 1))
    }
  }
  return null
}

/**
 * Is `path` an acceptable POST endpoint path? (AC-014). PURE.
 * Accepts only `^\/[A-Za-z0-9_./-]+$`; everything else means 404.
 */
export const validateEndpointPath = (path: string): boolean => ENDPOINT_PATH_PATTERN.test(path)

/**
 * Is `host` an allowlisted loopback spelling? Mirrors the protocols allowlist.
 * `localhost` is case-folded; IP-literals compared verbatim.
 */
export const isLoopbackHost = (host: string): boolean =>
  LOOPBACK_HOSTS.has(host) || host.toLowerCase() === "localhost"

/** Result of the strict Origin check (AC-014). */
export interface OriginCheck {
  readonly ok: boolean
  readonly host: string | null
  readonly reason?: string
}

/**
 * Strict loopback-only `Origin` check (AC-014). PURE.
 *
 * A POST MUST carry an `Origin` header whose host is loopback. A missing,
 * unparsable, or non-loopback Origin is rejected (→ 403). This closes the
 * legacy gap (no Origin/CORS check) and blocks DNS-rebinding / cross-site POSTs
 * from a browser page to the loopback server.
 */
export const checkOrigin = (origin: string | null | undefined): OriginCheck => {
  if (origin === null || origin === undefined || origin.length === 0) {
    return { ok: false, host: null, reason: "Missing Origin header." }
  }
  let parsed: URL
  try {
    parsed = new URL(origin)
  } catch {
    return { ok: false, host: null, reason: "Origin header is not a valid URL." }
  }
  const host = parsed.hostname
  if (isLoopbackHost(host)) {
    return { ok: true, host }
  }
  return {
    ok: false,
    host,
    reason: `Refusing cross-origin POST from non-loopback Origin '${host}'.`
  }
}

/**
 * Constant-time-ish token comparison (AC-014). PURE.
 *
 * Both must be non-empty and equal. We compare every char of equal-length
 * strings to avoid the most naive early-exit timing leak; length mismatch
 * short-circuits (length is not itself a secret here — the token is).
 */
export const tokensMatch = (expected: string, received: string | null | undefined): boolean => {
  if (received === null || received === undefined) return false
  if (expected.length === 0 || received.length === 0) return false
  if (expected.length !== received.length) return false
  let diff = 0
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ received.charCodeAt(i)
  }
  return diff === 0
}

/** Byte length (UTF-8) of a string — used for the body-size cap (AC-014). */
export const byteLength = (s: string): number => Buffer.byteLength(s, "utf8")

/** Clamp a value into [lo, hi]. PURE. */
export const clamp = (value: number, lo: number, hi: number): number =>
  Math.min(Math.max(value, lo), hi)

/**
 * Resolve a server port: `clamp(port ?? DEFAULT_PORT, 1, 65535)`.
 * Non-finite / non-integer inputs fall back to the default before clamping.
 */
export const resolvePort = (port: number | undefined | null): number => {
  if (port === undefined || port === null || !Number.isFinite(port)) {
    return DEFAULT_PORT
  }
  return clamp(Math.trunc(port), MIN_PORT, MAX_PORT)
}
