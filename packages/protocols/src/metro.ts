/**
 * S8 — Metro Probe service (AC-021, AC-038).
 *
 * Loopback-only HTTP probes of a running Metro bundler. The four endpoints:
 *   GET  /status        -> packager liveness ("packager-status:running")
 *   GET  /json/list     -> debug-target list (Hermes webSocketDebuggerUrls)
 *   GET  /json/version  -> CDP version metadata
 *   POST /symbolicate   -> stack symbolication
 *
 * Hard invariants:
 *   - NEVER auto-starts Metro (probe-only).
 *   - LOOPBACK-ONLY: every fetch goes to http://127.0.0.1:<clamped-port>; non-loopback hosts are
 *     never reachable (the base URL is constructed, not taken from the caller).
 *   - Non-array /json/list  -> { available:false, malformedTargets:[{index:null, reason:"..."}] }.
 *   - Per-row skip-malformed: rows without identifying metadata are skipped INTO malformedTargets,
 *     the rest are still returned (skip-don't-crash).
 *   - Unreachable -> { available:false, status:"unavailable", reason:"..." }.
 *   - Port clamp 1..65535, default 8081 (AC-038).
 *
 * The HTTP transport is injected as a `Context.Tag` PORT (`MetroHttpClient`) so tests pass a fake
 * and never touch a real socket. We deliberately define a minimal port interface here rather than
 * depend on `@effect/platform`'s HttpClient, to keep the seam small and test-trivial — the Node
 * layer (deferred `packages/app`) supplies the real `@effect/platform` HttpClient-backed impl.
 */
import { Context, Effect, Layer } from "effect"
import { HttpTransportError } from "./errors.js"
import { loopbackMetroBaseUrl, resolveMetroPort } from "./loopback.js"

// ----------------------------------------------------------------------------------------------
// Injected HTTP transport port (the test seam)
// ----------------------------------------------------------------------------------------------

/** A minimal HTTP response the probe needs: a status code + a text body. */
export interface MetroHttpResponse {
  readonly status: number
  readonly text: string
}

/** One loopback HTTP request issued by the probe. */
export interface MetroHttpRequest {
  readonly method: "GET" | "POST"
  /** Always a loopback URL (`http://127.0.0.1:<port><path>`); constructed by the service. */
  readonly url: string
  readonly body?: string
  /** Per-fetch timeout in ms (the service applies its own AbortController upstream of this port). */
  readonly timeoutMs: number
}

/**
 * The injected transport. Implementations MUST fail with {@link HttpTransportError} on a transport
 * fault (refused connection, abort, DNS) — that is how the probe distinguishes "Metro unreachable"
 * (transport failure) from "Metro answered with malformed data" (a 200 with a bad body).
 */
export interface MetroHttpClient {
  readonly request: (req: MetroHttpRequest) => Effect.Effect<MetroHttpResponse, HttpTransportError>
}

export const MetroHttpClient = Context.GenericTag<MetroHttpClient>("@expo98/protocols/MetroHttpClient")

// ----------------------------------------------------------------------------------------------
// Payload DTOs (the designed-unavailable evidence shapes)
// ----------------------------------------------------------------------------------------------

export interface MalformedTarget {
  /** Row index in /json/list, or null when the whole list shape was wrong. */
  readonly index: number | null
  readonly reason: string
}

/** A normalized Hermes debug target extracted from a /json/list row. */
export interface MetroTarget {
  readonly id: string
  readonly title: string
  readonly description: string | null
  readonly webSocketDebuggerUrl: string
  readonly devtoolsFrontendUrl: string | null
}

export type MetroTargetsResult =
  | {
      readonly available: true
      readonly metroPort: number
      readonly targets: ReadonlyArray<MetroTarget>
      readonly malformedTargets: ReadonlyArray<MalformedTarget>
    }
  | {
      readonly available: false
      readonly metroPort: number
      readonly status?: "unavailable"
      readonly reason?: string
      readonly targets: ReadonlyArray<MetroTarget>
      readonly malformedTargets: ReadonlyArray<MalformedTarget>
    }

export type MetroStatusResult =
  | { readonly available: true; readonly metroPort: number; readonly status: string }
  | {
      readonly available: false
      readonly metroPort: number
      readonly status: "unavailable"
      readonly reason: string
    }

export type MetroVersionResult =
  | { readonly available: true; readonly metroPort: number; readonly version: unknown }
  | {
      readonly available: false
      readonly metroPort: number
      readonly status: "unavailable"
      readonly reason: string
    }

export type MetroSymbolicateResult =
  | { readonly available: true; readonly metroPort: number; readonly payload: unknown }
  | {
      readonly available: false
      readonly metroPort: number
      readonly status: "unavailable"
      readonly reason: string
    }

// ----------------------------------------------------------------------------------------------
// The S8 service
// ----------------------------------------------------------------------------------------------

export interface MetroProbe {
  readonly status: (options?: { readonly metroPort?: number }) => Effect.Effect<MetroStatusResult>
  readonly listTargets: (options?: { readonly metroPort?: number }) => Effect.Effect<MetroTargetsResult>
  readonly version: (options?: { readonly metroPort?: number }) => Effect.Effect<MetroVersionResult>
  readonly symbolicate: (options: {
    readonly metroPort?: number
    readonly stack: unknown
  }) => Effect.Effect<MetroSymbolicateResult>
}

export const MetroProbe = Context.GenericTag<MetroProbe>("@expo98/protocols/MetroProbe")

/** Per-fetch timeout the probe asks the transport to honor (AC-053 ballpark). */
const METRO_FETCH_TIMEOUT_MS = 3_000

const UNREACHABLE_REASON = "Metro is not reachable on the requested port."
const NON_ARRAY_LIST_REASON = "Metro target list was not an array."

/** Pull a non-empty string field from an object, else null. */
const str = (obj: Record<string, unknown>, key: string): string | null => {
  const v = obj[key]
  return typeof v === "string" && v.length > 0 ? v : null
}

/**
 * Normalize one /json/list row. A row needs identifying metadata to be usable: at minimum a
 * `webSocketDebuggerUrl` AND an identity (`id` | `title`). Rows missing these are SKIPPED into
 * malformedTargets (skip-don't-crash) rather than aborting the whole probe.
 */
const normalizeRow = (row: unknown, index: number): { target: MetroTarget } | { malformed: MalformedTarget } => {
  if (typeof row !== "object" || row === null || Array.isArray(row)) {
    return { malformed: { index, reason: "Metro target row was not an object." } }
  }
  const obj = row as Record<string, unknown>
  const webSocketDebuggerUrl = str(obj, "webSocketDebuggerUrl")
  if (webSocketDebuggerUrl === null) {
    return {
      malformed: { index, reason: "Metro target row is missing webSocketDebuggerUrl." },
    }
  }
  const id = str(obj, "id") ?? str(obj, "title")
  if (id === null) {
    return { malformed: { index, reason: "Metro target row is missing an id/title." } }
  }
  return {
    target: {
      id,
      title: str(obj, "title") ?? id,
      description: str(obj, "description"),
      webSocketDebuggerUrl,
      devtoolsFrontendUrl: str(obj, "devtoolsFrontendUrl"),
    },
  }
}

const make = Effect.gen(function* () {
  const http = yield* MetroHttpClient

  const get = (path: string, port: number) =>
    http.request({
      method: "GET",
      url: `${loopbackMetroBaseUrl(port)}${path}`,
      timeoutMs: METRO_FETCH_TIMEOUT_MS,
    })

  const status: MetroProbe["status"] = (options) =>
    Effect.gen(function* () {
      const metroPort = resolveMetroPort(options?.metroPort)
      const res = yield* get("/status", metroPort).pipe(Effect.either)
      if (res._tag === "Left") {
        return {
          available: false,
          metroPort,
          status: "unavailable",
          reason: UNREACHABLE_REASON,
        } satisfies MetroStatusResult
      }
      if (res.right.status < 200 || res.right.status >= 400) {
        return {
          available: false,
          metroPort,
          status: "unavailable",
          reason: UNREACHABLE_REASON,
        } satisfies MetroStatusResult
      }
      return {
        available: true,
        metroPort,
        status: res.right.text.trim(),
      } satisfies MetroStatusResult
    })

  const listTargets: MetroProbe["listTargets"] = (options) =>
    Effect.gen(function* () {
      const metroPort = resolveMetroPort(options?.metroPort)
      const res = yield* get("/json/list", metroPort).pipe(Effect.either)
      if (res._tag === "Left") {
        return {
          available: false,
          metroPort,
          status: "unavailable",
          reason: UNREACHABLE_REASON,
          targets: [],
          malformedTargets: [],
        } satisfies MetroTargetsResult
      }
      if (res.right.status < 200 || res.right.status >= 400) {
        return {
          available: false,
          metroPort,
          status: "unavailable",
          reason: UNREACHABLE_REASON,
          targets: [],
          malformedTargets: [],
        } satisfies MetroTargetsResult
      }

      let parsed: unknown
      try {
        parsed = JSON.parse(res.right.text)
      } catch {
        // A non-JSON body is treated as a non-array list (malformed shape), not unreachable.
        return {
          available: false,
          metroPort,
          targets: [],
          malformedTargets: [{ index: null, reason: NON_ARRAY_LIST_REASON }],
        } satisfies MetroTargetsResult
      }

      if (!Array.isArray(parsed)) {
        return {
          available: false,
          metroPort,
          targets: [],
          malformedTargets: [{ index: null, reason: NON_ARRAY_LIST_REASON }],
        } satisfies MetroTargetsResult
      }

      const targets: MetroTarget[] = []
      const malformedTargets: MalformedTarget[] = []
      parsed.forEach((row, index) => {
        const result = normalizeRow(row, index)
        if ("target" in result) targets.push(result.target)
        else malformedTargets.push(result.malformed)
      })

      return {
        available: true,
        metroPort,
        targets,
        malformedTargets,
      } satisfies MetroTargetsResult
    })

  const version: MetroProbe["version"] = (options) =>
    Effect.gen(function* () {
      const metroPort = resolveMetroPort(options?.metroPort)
      const res = yield* get("/json/version", metroPort).pipe(Effect.either)
      if (res._tag === "Left" || res.right.status < 200 || res.right.status >= 400) {
        return {
          available: false,
          metroPort,
          status: "unavailable",
          reason: UNREACHABLE_REASON,
        } satisfies MetroVersionResult
      }
      let payload: unknown
      try {
        payload = JSON.parse(res.right.text)
      } catch {
        payload = res.right.text
      }
      return { available: true, metroPort, version: payload } satisfies MetroVersionResult
    })

  const symbolicate: MetroProbe["symbolicate"] = (options) =>
    Effect.gen(function* () {
      const metroPort = resolveMetroPort(options.metroPort)
      const res = yield* http
        .request({
          method: "POST",
          url: `${loopbackMetroBaseUrl(metroPort)}/symbolicate`,
          body: JSON.stringify(options.stack),
          timeoutMs: METRO_FETCH_TIMEOUT_MS,
        })
        .pipe(Effect.either)
      if (res._tag === "Left" || res.right.status < 200 || res.right.status >= 400) {
        return {
          available: false,
          metroPort,
          status: "unavailable",
          reason: UNREACHABLE_REASON,
        } satisfies MetroSymbolicateResult
      }
      let payload: unknown
      try {
        payload = JSON.parse(res.right.text)
      } catch {
        payload = res.right.text
      }
      return { available: true, metroPort, payload } satisfies MetroSymbolicateResult
    })

  return { status, listTargets, version, symbolicate } satisfies MetroProbe
})

/** Live S8 layer. Requires a {@link MetroHttpClient} (the Node HttpClient adapter or a fake). */
export const MetroProbeLayer = Layer.effect(MetroProbe, make)
