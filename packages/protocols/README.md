# `@expo98/protocols`

The **device-protocol** services of the Effect-TS expo98 rebuild (architecture S8 + S9):

- **S8 — Metro Probe** — loopback-only HTTP probes of a running Metro bundler. Never auto-starts
  Metro. (AC-021, AC-038)
- **S9 — Hermes CDP** — Chrome DevTools Protocol over WebSocket: `Runtime.enable` →
  `Runtime.evaluate`, id-correlated, connect-time `Origin` header, bounded open, and
  **loopback-enforced on the `webSocketDebuggerUrl` before connecting** (the AC-030 FIX). (AC-030,
  AC-022)

It also owns the pure **network-evidence shape validation** (AC-022) that gates harvested CDP
network traffic before it is handed to core's redactor.

## The SPIKE decision (resolves architecture finding M1)

> `@effect/platform` Socket Origin-header supported? **NO → `ws`-adapter.**

`@effect/platform`'s `Socket` cannot set a connect-time `Origin` request header (its
`WebSocketConstructor` seam is typed `(url, protocols?) => globalThis.WebSocket`; `makeWebSocket`
options expose only `closeCodeIsError | openTimeout | protocols`). AC-030 requires `Origin` at
connect, so the S9 transport is a thin **`ws` adapter** (`new WebSocket(url, { headers: { Origin } })`)
kept **behind** the `CdpSocketFactory` `Context.Tag` so the rest of the system stays
dependency-agnostic. Full evidence + signatures in [`SPIKE.md`](./SPIKE.md).

```
S9 service (cdp.ts)  ──talks to──▶  CdpSocketFactory  ◀──implemented by──  ws-adapter.ts  (the only `ws` importer)
                                    (Context.Tag seam)                      tests inject a fake instead
```

## The `@expo98/core` capability seam (the runtime-eval gate)

> **INTEGRATION SEAM (`@expo98/core`)** — runtime-eval is gated by core's dispatcher via _capability
> injection_. This package only **documents** the seam; it does **not** implement the gate.

The CDP eval surface is **split into two capabilities** so the dispatcher can withhold the dangerous
one (architecture finding C1):

| Capability tag      | Surface                                                                                                                     | Who may depend on it                                            |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `HermesEvidence`    | `evaluateReadOnly(expr, opts)` — evidence harvest via a **fixed, package-controlled** read-only expression (e.g. `network`) | `read`-classed handlers (legitimate, see legacy `network`)      |
| `HermesRuntimeEval` | `evaluate(expr, opts)` — **arbitrary caller-supplied JS** (the `wait --fn` / `trace` / `inspector` mutation class)          | only `runtime-eval`-classed handlers, **after the gate passes** |

In the real system, `@expo98/core`'s Dispatch Runtime (S6) constructs `HermesRuntimeEval` and provides
it into a handler's Effect `R` **only after** the fail-closed policy gate passes for a
`runtime-eval`-classed command. A `read`-classed handler's `R` simply _lacks_ `HermesRuntimeEval`, so
calling it is a **compile error** — the gate is a type fact, not a runtime convention. This package
ships both tags + layers; the _withholding_ is core's job.

To keep typecheck independent of the concurrently-built `@expo98/core`, all cross-package types are
defined locally and marked `// INTEGRATION SEAM (@expo98/core): ...` — there are **no hard imports**
from `@expo98/core`.

## Public API (`src/index.ts`)

- Pure primitives: `isLoopbackHost`, `checkLoopbackUrl`, `resolveMetroPort`, `loopbackMetroBaseUrl`,
  `clamp`, `LOOPBACK_HOSTS`, `DEFAULT_METRO_PORT`, `MIN_PORT`, `MAX_PORT`.
- Errors: `LoopbackViolation`, `HttpTransportError`, `CdpSocketError`, `CdpMalformedFrame`,
  `CdpProtocolError`.
- S8: `MetroProbe` (tag) + `MetroProbeLayer`; the injected `MetroHttpClient` port; result DTOs.
- S9: `HermesEvidence` / `HermesRuntimeEval` (split tags) + their layers; `CdpSocketFactory` port;
  `WsCdpSocketFactoryLayer` (the `ws` adapter); `assertLoopbackUrl`, `boundedOpenMs`, `originForPort`.
- Network: `validateNetworkEvidence`, `resolveLimit`.

### Injected ports (the test seams)

Both services take their transport as a `Context.Tag` so tests pass fakes and never open a socket:

- **S8** injects `MetroHttpClient` — a minimal `{ request(req): Effect<{status,text}, HttpTransportError> }`
  port. The real Node layer (deferred `packages/app`) backs it with `@effect/platform` `HttpClient`.
- **S9** injects `CdpSocketFactory` — `{ connect(opts): Effect<CdpSocket, CdpSocketError> }`. The real
  impl is `WsCdpSocketFactoryLayer` (the `ws` adapter); tests provide a scripted fake.

## AC → test map

| AC         | What                                                                                                                                                                                                                                                                  | Test file                              | Status                 |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- | ---------------------- |
| **AC-021** | Metro loopback-only; never auto-start; non-array `/json/list` → `malformedTargets`; per-row skip-malformed; unreachable → unavailable                                                                                                                                 | `test/ac-021-metro.test.ts`            | **implemented (pass)** |
| **AC-038** | Metro port default 8081, clamp 1..65535                                                                                                                                                                                                                               | `test/ac-038-metro-port.test.ts`       | **implemented (pass)** |
| **AC-030** | CDP loopback enforcement on `webSocketDebuggerUrl` (PURE allowlist — reject non-loopback BEFORE connect); `Origin` value; bounded open `min(timeoutMs,2500)`; id-correlation; non-loopback candidates never connected; malformed-JSON / all-attempts-fail diagnostics | `test/ac-030-cdp.test.ts`              | **implemented (pass)** |
| **AC-022** | Network evidence shape: `no-runtime-target` / `transport-failure` / `malformed-payload` / `no-observed-traffic` / validated; `metroPort` clamp; `limit` clamp + take-last                                                                                             | `test/ac-022-network-evidence.test.ts` | **implemented (pass)** |

### Skipped (live-only — need a running Metro/Hermes target)

| Skip id                                                                                            | Why                                                  | Where                     |
| -------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | ------------------------- |
| `AC-030 live Runtime.evaluate round-trip — needs running Hermes target`                            | requires a real Hermes CDP endpoint                  | `test/ac-030-cdp.test.ts` |
| `AC-030 live malformed-frame truncation to 1000 chars (raw preview) — needs running Hermes target` | requires a real Hermes endpoint emitting a bad frame | `test/ac-030-cdp.test.ts` |
| `AC-021 live Metro fetch against a running packager` / `live POST /symbolicate`                    | requires a running Metro bundler on loopback         | `test/live-skips.test.ts` |
| `AC-030 live CDP round-trip via WsCdpSocketFactoryLayer`                                           | exercises the real `ws` adapter end-to-end           | `test/live-skips.test.ts` |

> The non-live equivalents (loopback enforcement, Origin/bounded-open computation, id-correlation,
> malformed-JSON handling, all-attempts-fail diagnostics) are all covered by fake-socket tests so the
> behavior is verified without a device.

## Loopback allowlist (the network-confinement floor)

`127.0.0.1 | localhost | [::1] | ::1` — a **pure** predicate (`isLoopbackHost`) tested exhaustively.
A non-loopback host is **never expanded** into loopback candidates; it is **rejected** (this is the
AC-030 FIX that closes the legacy CWE-918 gap on `webSocketDebuggerUrl`). Metro fetches are even
stronger: the base URL is _constructed_ as `http://127.0.0.1:<clamped-port>`, never taken from the
caller, so a non-loopback Metro host is structurally unreachable.

## Typecheck

```sh
pnpm exec tsc --noEmit
```

> Note: in this sandbox `pnpm exec` triggers a deps-status check that tries to run `pnpm install`
> (it fails on the workspace's placeholder `allowBuilds` entries in `pnpm-workspace.yaml`). The
> typecheck itself is clean — verified via `pnpm --config.verify-deps-before-run=false exec tsc
--noEmit` and directly via the local `tsc` binary. Once the workspace `allowBuilds` placeholders
> are resolved at the root, the plain `pnpm exec` form works as-is.
