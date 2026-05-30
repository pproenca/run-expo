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
import { Effect, Layer } from "effect"
import WebSocket from "ws"
import { CdpSocketFactory, type CdpSocket } from "./cdp-socket.js"
import { CdpSocketError } from "./errors.js"

export const MAX_INBOUND_FRAMES = 1_000 as const
export const MAX_FRAME_BYTES = 1_048_576 as const

const connect: CdpSocketFactory["connect"] = (options) =>
  Effect.async<CdpSocket, CdpSocketError>((resume) => {
    let settled = false
    let closed = false
    // Connect-time Origin header (AC-030) — the reason we use `ws` over @effect/platform Socket.
    const ws = new WebSocket(options.url, { headers: { Origin: options.origin }, maxPayload: MAX_FRAME_BYTES })

    // Buffer inbound frames with explicit containment. A noisy local peer cannot
    // grow memory without bound while the CDP layer waits for a correlated id.
    const inbox: Array<string | null | CdpSocketError> = []
    let waiting: ((effect: Effect.Effect<string | null | CdpSocketError>) => void) | undefined

    const deliver = (item: string | null | CdpSocketError): void => {
      const resumeReceive = waiting
      if (resumeReceive !== undefined) {
        waiting = undefined
        resumeReceive(Effect.succeed(item))
        return
      }
      inbox.push(item)
    }

    const failRead = (cause: string): void => {
      if (closed) return
      closed = true
      try {
        ws.terminate()
      } catch {
        /* ignore */
      }
      deliver(new CdpSocketError({ url: options.url, reason: "Read", cause }))
    }

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

    const rawDataByteLength = (data: WebSocket.RawData): number => {
      if (Array.isArray(data)) {
        return data.reduce((total, chunk) => total + chunk.byteLength, 0)
      }
      return data.byteLength
    }

    const rawDataToString = (data: WebSocket.RawData): string =>
      Array.isArray(data)
        ? Buffer.concat(data).toString("utf8")
        : Buffer.isBuffer(data)
          ? data.toString("utf8")
          : Buffer.from(new Uint8Array(data)).toString("utf8")

    ws.on("message", (data: WebSocket.RawData) => {
      if (rawDataByteLength(data) > MAX_FRAME_BYTES) {
        failRead(`frame exceeded ${MAX_FRAME_BYTES} bytes`)
        return
      }
      const text = rawDataToString(data)
      if (inbox.length >= MAX_INBOUND_FRAMES) {
        failRead(`inbound frame queue exceeded ${MAX_INBOUND_FRAMES}`)
        return
      }
      deliver(text)
    })
    ws.on("close", () => {
      // Signal end-of-stream so a pending `receive` resolves to null.
      if (!closed) {
        closed = true
        deliver(null)
      }
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
        receive: Effect.async<string | null, CdpSocketError>((res) => {
          const next = inbox.shift()
          if (next !== undefined) {
            res(next instanceof CdpSocketError ? Effect.fail(next) : Effect.succeed(next))
            return
          }
          waiting = (effect) =>
            res(
              effect.pipe(
                Effect.flatMap((frame) =>
                  frame instanceof CdpSocketError ? Effect.fail(frame) : Effect.succeed(frame),
                ),
              ),
            )
          return Effect.sync(() => {
            waiting = undefined
          })
        }),
        close: Effect.sync(() => {
          try {
            ws.close()
          } catch {
            /* ignore */
          }
        }),
      }
      ws.on("error", (err: Error) => {
        failRead(String(err))
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
