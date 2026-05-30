/**
 * `@expo98/overlay-server` — the hardened loopback review-overlay INGEST server.
 *
 * INGEST-ONLY. This package captures and serves review events behind the AC-014
 * hardening (loopback bind + unguessable per-session token + strict Origin +
 * hard body-size cap + `comments[]` schema validation), owns the events-file
 * lifecycle (AC-032), and the long-lived sidecar state machine (AC-033).
 *
 * The legacy in-app HTML/UI scaffold (`CodexReviewOverlay.tsx` generation) is
 * intentionally DROPPED (Phase B scope decision) and out of scope here — this
 * package does NOT recreate it. The action enum is `prepare | server | read |
 * clear` (NO `scaffold`).
 *
 * Design for testability: routing + hardening live in a PURE/Effect
 * `handleRequest(req, config)` over a synthetic request model and an injected
 * events-store port, so tests exercise token / Origin / body-cap / schema / 404
 * logic with NO socket. The real `@effect/platform-node` server (`server.ts`) is
 * a thin adapter over the same handler; its live bind is `it.skip`'d.
 */

// Errors / rejection taxonomy (AC-014 / AC-032)
export {
  BodyTooLarge,
  CorruptEventsFile,
  EventsStoreFailure,
  EventsStoreLimitExceeded,
  type EventsStoreError,
  MalformedBody,
  OriginRejected,
  type RequestRejection,
  TokenRejected,
} from "./errors.js"

// Synthetic request/response model + PURE hardening primitives (AC-014)
export {
  BIND_HOST,
  byteLength,
  checkOrigin,
  clamp,
  DEFAULT_ENDPOINT_PATH,
  DEFAULT_PORT,
  ENDPOINT_PATH_PATTERN,
  EVENTS_JSON_PATH,
  isLoopbackHost,
  LOOPBACK_HOSTS,
  MAX_BODY_BYTES,
  MAX_PORT,
  MIN_PORT,
  type OriginCheck,
  type OverlayMethod,
  type OverlayRequest,
  type OverlayResponse,
  queryParam,
  resolvePort,
  splitUrl,
  TOKEN_HEADER,
  tokensMatch,
  validateEndpointPath,
} from "./request.js"

// The hardened request handler + config + inbound `comments[]` schema (AC-014)
export { handleRequest, type HandlerConfig, makeHandlerConfig, OverlayComment, OverlayPostBody } from "./handler.js"

// Events-file store port + lifecycle (AC-032)
export {
  type EventsReadResult,
  EventsStoreTag,
  type EventsStore,
  fsEventsStoreLayer,
  makeEventsStore,
  makeFsEventsStore,
  MAX_EVENTS,
  MAX_EVENTS_FILE_BYTES,
  memoryEventsStoreLayer,
  NO_EVENTS_FILE_REASON,
  type PrepareOptions,
  type RawEventsBackend,
} from "./events-store.js"

// Sidecar lifecycle state machine (AC-033)
export {
  isReapable,
  observeLiveness,
  refreshSidecar,
  registerSidecar,
  SIDECAR_NAME,
  type SidecarProbe,
  stopSidecar,
} from "./sidecar.js"

// Real-server seam (the `server` action) — live bind is it.skip'd
export {
  type CappedBodyRead,
  findAvailablePort,
  launchOverlayServerLayer,
  overlayHttpApp,
  overlayServerLayer,
  PROBE_PORT_TIMEOUT_MS,
  readCappedText,
  type ServerOptions,
} from "./server.js"
