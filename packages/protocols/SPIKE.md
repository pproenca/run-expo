# SPIKE — Origin-header on the outbound WebSocket handshake (resolves architecture finding M1)

**Question (from REIMAGINED_ARCHITECTURE.md §4 / S9):** can `@effect/platform`'s `Socket`
(its WebSocket client) set a **connect-time `Origin` request header** on the outbound
handshake? AC-030 requires the CDP client to send `Origin: http://127.0.0.1[:port]` _at connect_.

## Method

Inspected the installed `*.d.ts` under the workspace pnpm store (versions: `@effect/platform@0.96.1`,
`@effect/platform-node@0.106.0`, `@effect/platform-node-shared@0.59.0`, `@types/ws@8.18.1`).
Searched for `Origin`, `headers`, `makeWebSocket`, `fromWebSocket`, `WebSocketConstructor`.

## Evidence

### 1. `@effect/platform` Socket — no header surface

File: `node_modules/.pnpm/@effect+platform@0.96.1_effect@3.21.2/node_modules/@effect/platform/dist/dts/Socket.d.ts`

```ts
// The injectable constructor tag — url + protocols ONLY, no options/headers object:
export declare const WebSocketConstructor: Context.Tag<
  WebSocketConstructor,
  (url: string, protocols?: string | Array<string> | undefined) => globalThis.WebSocket
>

// The high-level constructor — options have NO headers/Origin field:
export declare const makeWebSocket: (
  url: string | Effect.Effect<string>,
  options?: {
    readonly closeCodeIsError?: ((code: number) => boolean) | undefined
    readonly openTimeout?: DurationInput | undefined // <-- bounded-open lives here
    readonly protocols?: string | Array<string> | undefined
  },
) => Effect.Effect<Socket, never, WebSocketConstructor>

// The escape hatch still yields a globalThis.WebSocket (browser WebSocket API — no header ctor):
export declare const fromWebSocket: <RO>(
  acquire: Effect.Effect<globalThis.WebSocket, SocketError, RO>,
  options?: { readonly closeCodeIsError?: (code: number) => boolean; readonly openTimeout?: DurationInput },
) => Effect.Effect<Socket, never, Exclude<RO, Scope.Scope>>
```

`grep -ni "origin\|header" Socket.d.ts` → **zero matches.**

The `WebSocketConstructor` tag's value type is `(url, protocols?) => globalThis.WebSocket`. The
standard `globalThis.WebSocket` (WHATWG/browser API) has **no constructor mechanism for arbitrary
connect-time request headers** — `Origin` is forbidden to set on the browser API and is not a ctor
parameter. So even though you can swap the constructor, the _type contract_ of the seam can't carry
an `Origin` header.

### 2. `@effect/platform-node` — same surface, no header escape

File: `node_modules/.pnpm/@effect+platform-node@0.106.0_.../@effect/platform-node/dist/dts/NodeSocket.d.ts`

```ts
export declare const layerWebSocket: (
  url: string,
  options?: {
    readonly closeCodeIsError?: (code: number) => boolean
  },
) => Layer.Layer<Socket.Socket>
export declare const layerWebSocketConstructor: Layer.Layer<Socket.WebSocketConstructor>
```

`platform-node-shared/NodeSocket.d.ts` adds `makeNet` / `fromDuplex` (raw TCP sockets) — these speak
raw bytes, not the WS handshake, so they can't help with an HTTP `Origin` request header either.
No `headers`/`origin` option anywhere in the node socket layers.

### 3. `ws@8` — DOES expose connect-time `headers` / `origin`

File: `node_modules/.pnpm/@types+ws@8.18.1/node_modules/@types/ws/index.d.ts`

```ts
constructor(address: string | URL, options?: WebSocket.ClientOptions | ClientRequestArgs);
// ...
interface ClientOptions extends SecureContextOptions {
  headers?: { [key: string]: string } | undefined;   // <-- arbitrary connect-time request headers
  origin?: string | undefined;                        // <-- explicit Origin
  // ...
}
```

`new WebSocket(url, { headers: { Origin } })` is exactly the legacy behavior
(`hermes-cdp-client/index.ts:38`) and is supported at the type level.

## Decision

**Use a thin direct-`ws` adapter, kept BEHIND the S9 `Context.Tag` interface — NOT `@effect/platform` Socket.**

Rationale: `@effect/platform`'s Socket cannot set a connect-time `Origin` header (the
`WebSocketConstructor` seam is typed `(url, protocols?) => globalThis.WebSocket`; `makeWebSocket`
options expose only `closeCodeIsError | openTimeout | protocols`; `fromWebSocket` still demands a
`globalThis.WebSocket`). AC-030 requires `Origin` at connect, so the honest implementation is a
direct `ws` adapter (`new WebSocket(url, { headers: { Origin } })`) — the `ws` dependency is
installed for exactly this. Per finding M1, the dep count is cosmetic; **the interface boundary is
what matters**: the adapter is a single `Context.Tag` (`CdpSocketFactory` / `CdpSocket`) so the rest
of the system stays dependency-agnostic and tests inject a fake socket. `min(timeoutMs, 2500)`
bounded-open and id-correlation are implemented in the adapter (legacy `ws`-specific behaviors that
`@effect/platform`'s `openTimeout` could have covered, but the `Origin` requirement forces the
adapter regardless).

**One-liner:** `@effect/platform` Socket Origin-header supported? **NO → ws-adapter**
(evidence: `Socket.d.ts` `WebSocketConstructor: Context.Tag<…, (url, protocols?) => globalThis.WebSocket>`
and `makeWebSocket` options `{closeCodeIsError|openTimeout|protocols}` — no headers; vs `@types/ws`
`ClientOptions.headers` / `ClientOptions.origin`).
