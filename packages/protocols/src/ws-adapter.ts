/**
 * The `ws`-backed implementation of {@link CdpSocketFactory} — the SPIKE decision.
 *
 * Per SPIKE.md: `@effect/platform`'s Socket cannot set a connect-time `Origin` header (its
 * `WebSocketConstructor` seam is `(url, protocols?) => globalThis.WebSocket`, and `makeWebSocket`
 * options expose only `closeCodeIsError | openTimeout | protocols`). AC-030 requires `Origin` at
 * connect, so we use `ws` directly — `new WebSocket(url, { headers: { Origin } })` — kept BEHIND
 * the `CdpSocketFactory` `Context.Tag` so the rest of the system stays dependency-agnostic.
 *
 * This module is the ONLY place that imports `ws`. It owns the two connect-time concerns the
 * transport must do: the `Origin` header and the `min(timeoutMs, 2500)` bounded open (AC-030).
 *
 * NOTE: this is platform-coupled (`ws`), so it lives in `protocols` but is wired by the deferred
 * `packages/app` composition root, never by the pure spine. Tests use a fake factory instead.
 */
import { Effect, Layer, Queue } from "effect"
import WebSocket from "ws"
import { CdpSocketFactory, type CdpSocket } from "./cdp-socket.js"
import { CdpSocketError } from "./errors.js"

const connect: CdpSocketFactory["connect"] = (options) =>
  Effect.async<CdpSocket, CdpSocketError>((resume) => {
    let settled = false
    // Connect-time Origin header (AC-030) — the reason we use `ws` over @effect/platform Socket.
    const ws = new WebSocket(options.url, { headers: { Origin: options.origin } })

    // Buffer inbound frames so a `receive` that runs after a frame arrived still gets it.
    // The Queue is created synchronously via runSync so the message handler can offer into it.
    const inbound = Effect.runSync(Queue.unbounded<string | null | CdpSocketError>())

    const openTimer = setTimeout(() => {
      if (settled) return
      settled = true
      try {
        ws.terminate()
      } catch {
        /* ignore */
      }
      resume(
        Effect.fail(
          new CdpSocketError({
            url: options.url,
            reason: "OpenTimeout",
            cause: `open exceeded ${options.openTimeoutMs}ms`,
          }),
        ),
      )
    }, options.openTimeoutMs)

    ws.on("message", (data: WebSocket.RawData) => {
      Effect.runSync(Queue.offer(inbound, data.toString()))
    })
    ws.on("close", () => {
      // Signal end-of-stream so a pending `receive` resolves to null.
      Effect.runSync(Queue.offer(inbound, null))
    })
    ws.on("error", (err: Error) => {
      if (settled) return
      settled = true
      clearTimeout(openTimer)
      resume(Effect.fail(new CdpSocketError({ url: options.url, reason: "Open", cause: err })))
    })
    ws.on("open", () => {
      if (settled) return
      settled = true
      clearTimeout(openTimer)

      const socket: CdpSocket = {
        send: (frame) =>
          Effect.async<void, CdpSocketError>((res) => {
            ws.send(frame, (err) => {
              if (err) {
                res(Effect.fail(new CdpSocketError({ url: options.url, reason: "Write", cause: err })))
              } else {
                res(Effect.void)
              }
            })
          }),
        receive: Queue.take(inbound).pipe(
          Effect.flatMap((frame) => (frame instanceof CdpSocketError ? Effect.fail(frame) : Effect.succeed(frame))),
        ),
        close: Effect.sync(() => {
          try {
            ws.close()
          } catch {
            /* ignore */
          }
        }),
      }
      ws.on("error", (err: Error) => {
        Effect.runSync(
          Queue.offer(inbound, new CdpSocketError({ url: options.url, reason: "Read", cause: err })),
        )
      })
      resume(Effect.succeed(socket))
    })

    // Effect.async finalizer: ensure the socket is torn down if the fiber is interrupted.
    return Effect.sync(() => {
      clearTimeout(openTimer)
      try {
        ws.terminate()
      } catch {
        /* ignore */
      }
    })
  })

/**
 * Live `ws`-backed S9 socket factory (the SPIKE decision). Provide this in the Node composition
 * root; tests provide a fake `CdpSocketFactory` layer instead.
 */
export const WsCdpSocketFactoryLayer = Layer.succeed(CdpSocketFactory, { connect })
