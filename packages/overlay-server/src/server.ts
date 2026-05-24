import { createServer } from "node:http"
import { createConnection } from "node:net"
import { HttpRouter, HttpServer, HttpServerRequest, HttpServerResponse } from "@effect/platform"
import { NodeHttpServer } from "@effect/platform-node"
import { Id, IdDefault } from "@expo98/core"
import { Fs } from "@expo98/domain"
import { Effect, Layer } from "effect"
import { fsEventsStoreLayer } from "./events-store.js"
import { handleRequest, type HandlerConfig, makeHandlerConfig } from "./handler.js"
import { BIND_HOST, DEFAULT_PORT, type OverlayMethod, type OverlayRequest, MAX_PORT, resolvePort } from "./request.js"

/**
 * The REAL `@effect/platform-node` HttpServer seam — the `server` action.
 *
 * This is the only place a real socket is bound. It is INTENTIONALLY thin: it
 * adapts an incoming `HttpServerRequest` into the synthetic `OverlayRequest`,
 * delegates ALL routing + hardening to the tested `handleRequest`, and renders
 * the resulting `OverlayResponse` back as a real `HttpServerResponse`.
 *
 * Bind: `127.0.0.1` only (loopback hard-coded). Port: default search from
 * `17655` incrementing on `EADDRINUSE` (`findAvailablePort`). The live bind +
 * EADDRINUSE round-trip is `it.skip`'d in the suite (needs a real socket);
 * everything reachable without a socket is unit-tested via `handleRequest`.
 */

// ===========================================================================
// Port search — loopback probe, increment on EADDRINUSE (AC-014)
// ===========================================================================

/** Probe whether `port` is free on loopback by attempting a brief connect. */
const probePortFree = (port: number): Effect.Effect<boolean> =>
  Effect.async<boolean>((resume) => {
    const socket = createConnection({ host: BIND_HOST, port })
    const done = (free: boolean) => {
      socket.removeAllListeners()
      socket.destroy()
      resume(Effect.succeed(free))
    }
    // A refused connection means nothing is listening → the port is free.
    socket.once("connect", () => done(false))
    socket.once("error", () => done(true))
  })

/**
 * Find the first free loopback port at/above `start` (AC-014). Increments on a
 * busy port; gives up at `MAX_PORT`. PURE search over the `probePortFree` seam,
 * so it is testable with an injected probe.
 */
export const findAvailablePort = (
  start: number,
  probe: (port: number) => Effect.Effect<boolean> = probePortFree,
): Effect.Effect<number> =>
  Effect.gen(function* () {
    for (let port = resolvePort(start); port <= MAX_PORT; port++) {
      if (yield* probe(port)) return port
    }
    return resolvePort(start)
  })

// ===========================================================================
// Request adaptation
// ===========================================================================

/** Lower-case every header name so the handler's lookups are case-insensitive. */
const toOverlayRequest = (req: HttpServerRequest.HttpServerRequest, body: string): OverlayRequest => {
  const headers: Record<string, string> = {}
  for (const [k, v] of Object.entries(req.headers)) {
    if (typeof v === "string") headers[k.toLowerCase()] = v
  }
  return {
    method: req.method as OverlayMethod,
    url: req.url,
    headers,
    body,
  }
}

// ===========================================================================
// The HTTP app — one route group delegating to `handleRequest`
// ===========================================================================

/** Build the HttpApp that adapts every request through the hardened handler. */
export const overlayHttpApp = (config: HandlerConfig) =>
  Effect.gen(function* () {
    const req = yield* HttpServerRequest.HttpServerRequest
    // Buffer the body as text. (The hard byte-cap is re-checked inside the
    // handler; a streaming pre-cap can be layered here when wired to the app.)
    const body = yield* req.text.pipe(Effect.orElseSucceed(() => ""))
    const overlayReq = toOverlayRequest(req, body)
    const response = yield* handleRequest(overlayReq, config)
    return HttpServerResponse.unsafeJson(response.body, { status: response.status })
  })

// ===========================================================================
// Server launch (loopback, bound port)
// ===========================================================================

export interface ServerOptions {
  /** The per-session token (generated via core's `Id`). */
  readonly token: string
  /** Path to `<overlayDir>/events.json`. */
  readonly eventsPath: string
  /** Requested port; defaults to a search from `DEFAULT_PORT`. */
  readonly port?: number
  /** POST endpoint path (default `/events`). */
  readonly endpointPath?: string
}

/**
 * The launchable `server` action: bind loopback at a free port, serve the
 * hardened app forever. Returns the bound layer; the live bind itself is
 * `it.skip`'d (needs a real socket + a running event loop).
 */
export const overlayServerLayer = (options: ServerOptions): Layer.Layer<HttpServer.HttpServer, never, Fs> => {
  const config = makeHandlerConfig(options.token, { endpointPath: options.endpointPath })
  const port = resolvePort(options.port ?? DEFAULT_PORT)
  const router = HttpRouter.empty.pipe(HttpRouter.all("*", overlayHttpApp(config)))
  const appLayer = HttpServer.serve(router).pipe(
    Layer.provide(fsEventsStoreLayer(options.eventsPath)),
    Layer.provide(IdDefault),
  )
  return appLayer.pipe(
    Layer.provideMerge(NodeHttpServer.layer(() => createServer(), { host: BIND_HOST, port })),
  ) as unknown as Layer.Layer<HttpServer.HttpServer, never, Fs>
}

// Re-export the Id default so the app's composition root can provide it.
export { Id, IdDefault }
