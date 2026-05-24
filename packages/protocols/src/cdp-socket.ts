/**
 * The CDP socket PORT — the dependency-agnostic seam the S9 service talks to.
 *
 * Per the SPIKE (resolves finding M1): `@effect/platform` Socket cannot set a connect-time `Origin`
 * header, so the real implementation is a thin `ws` adapter (`ws-adapter.ts`). That adapter is kept
 * BEHIND this `Context.Tag` so the rest of the system — and every test — is dependency-agnostic:
 * tests inject a fake socket factory, the Node runtime injects the `ws`-backed one.
 *
 * The factory is responsible for the connect-time concerns that only the transport can do:
 *   - setting the `Origin` request header on the handshake (AC-030);
 *   - bounding the open to `min(timeoutMs, 2500)`ms (AC-030);
 * The S9 service layered on top owns the protocol concerns (enable -> evaluate, id-correlation,
 * malformed-JSON handling).
 */
import { Context, Effect } from "effect";
import type { CdpSocketError } from "./errors.js";

/** A connected, frame-oriented CDP socket. Frames are JSON-encoded CDP messages (one per frame). */
export interface CdpSocket {
  /** Send one already-serialized CDP frame (JSON text). */
  readonly send: (frame: string) => Effect.Effect<void, CdpSocketError>;
  /**
   * Receive the next frame, or `null` if the socket closed cleanly with no further frames.
   * The S9 service loops this until it correlates the id it is waiting for.
   */
  readonly receive: Effect.Effect<string | null, CdpSocketError>;
  /** Close the socket. Best-effort; never fails the caller. */
  readonly close: Effect.Effect<void>;
}

/** Parameters for opening a CDP socket. */
export interface CdpConnectOptions {
  /** Already-loopback-validated `webSocketDebuggerUrl` (S9 enforces the allowlist BEFORE calling). */
  readonly url: string;
  /** Connect-time `Origin` request header value, e.g. `http://127.0.0.1:8081` (AC-030). */
  readonly origin: string;
  /** Open bound = `min(timeoutMs, 2500)`ms (AC-030). The factory MUST honor this. */
  readonly openTimeoutMs: number;
}

/**
 * Opens CDP sockets. Injected as a `Context.Tag` so the `ws` dependency stays behind the seam.
 * The returned socket is scoped: it is closed when the surrounding `Scope` closes.
 */
export interface CdpSocketFactory {
  readonly connect: (
    options: CdpConnectOptions,
  ) => Effect.Effect<CdpSocket, CdpSocketError>;
}

export const CdpSocketFactory = Context.GenericTag<CdpSocketFactory>(
  "@expo98/protocols/CdpSocketFactory",
);
