# `@expo98/overlay-server`

The hardened, loopback-only **review-overlay INGEST server** of the Effect-TS
rebuild of `expo98`. It captures and serves review events. **Ingest-only.**

## What it does

- **Hardened request handler (AC-014, the FIX).** Routes `GET /events.json` and
  `POST <endpointPath>`; everything else is `404`. Every POST must pass, in
  order, four checks **before** anything is appended:
  1. an **unguessable per-session token** (header `x-expo98-overlay-token`, or
     `?token=` query) generated via `@expo98/core`'s `Id`,
  2. a **strict loopback-only `Origin`** check,
  3. a **hard body-size cap** (`413` when exceeded),
  4. **`comments[]` schema validation** via Effect `Schema` (`422` when malformed).
     Bind is `127.0.0.1` only; the default port search starts at `17655` and
     increments on `EADDRINUSE`.
- **Events-file lifecycle (AC-032).** `prepare` (create, or `reset`) → fresh
  `{ version:1, title, createdAt, events:[] }`; a valid POST appends to
  `events[]`, sets `updatedAt`, rewrites; `read` with no file → unavailable with
  the reason `"No review overlay events file exists."`; `clear` removes it. The
  action enum is `prepare | server | read | clear`.
- **Sidecar lifecycle (AC-033).** A real `running → stale → stopped` state
  machine over `@expo98/domain`'s `SidecarRecord` for the one long-lived sidecar.

## The HTML scaffold was intentionally DROPPED (Phase B)

The legacy in-app HTML/UI scaffold — `review-overlay scaffold`, which generated
the `CodexReviewOverlay.tsx` component (`scaffold-template.ts` /
`codexReviewOverlayComponentSource`) — is **not carried forward** and is **out of
scope** for this package. (User decision: "the review overlay is needed — not the
HTML part.") The action enum therefore has **no `scaffold`** verb; only the
evidence/ingest capability (`prepare | server | read | clear`) is kept.

## Design for testability

Routing + hardening live in a pure/Effect `handleRequest(req, config)` over a
**synthetic request model** (`OverlayRequest` / `OverlayResponse`) and an
**injected events-store port** (`EventsStoreTag`). Tests exercise
token / Origin / body-cap / schema / 404 / append logic with **no socket**. The
real `@effect/platform-node` `HttpServer` (`src/server.ts`) is a thin adapter
over the same handler; its live bind is `it.skip`'d. The filesystem is injected
via `@expo98/domain`'s `Fs` port — in-memory in tests, platform-node in the app.

## AC → test map

| AC     | What                                                         | Test file                              | Status   |
| ------ | ------------------------------------------------------------ | -------------------------------------- | -------- |
| AC-014 | path allowlist, Origin check, token compare (PURE)           | `test/ac-014-handler.test.ts`          | pass     |
| AC-014 | POST rejected: missing/wrong token → 401                     | `test/ac-014-handler.test.ts`          | pass     |
| AC-014 | POST rejected: cross/missing Origin → 403                    | `test/ac-014-handler.test.ts`          | pass     |
| AC-014 | POST rejected: oversized body → 413                          | `test/ac-014-handler.test.ts`          | pass     |
| AC-014 | POST rejected: malformed `comments[]` → 422                  | `test/ac-014-handler.test.ts`          | pass     |
| AC-014 | disallowed path → 404                                        | `test/ac-014-handler.test.ts`          | pass     |
| AC-014 | valid POST → appended (200) + GET `/events.json`             | `test/ac-014-handler.test.ts`          | pass     |
| AC-014 | live loopback bind + EADDRINUSE port-search round-trip       | `test/ac-014-handler.test.ts`          | **skip** |
| AC-032 | prepare creates/resets; no-reset leaves untouched            | `test/ac-032-events-lifecycle.test.ts` | pass     |
| AC-032 | append pushes + sets `updatedAt`                             | `test/ac-032-events-lifecycle.test.ts` | pass     |
| AC-032 | read-with-no-file → unavailable (exact reason)               | `test/ac-032-events-lifecycle.test.ts` | pass     |
| AC-032 | clear removes the file (idempotent)                          | `test/ac-032-events-lifecycle.test.ts` | pass     |
| AC-032 | fs-backed round-trip over the `Fs` port; corrupt-file decode | `test/ac-032-events-lifecycle.test.ts` | pass     |
| AC-032 | action enum has no `scaffold`                                | `test/ac-032-events-lifecycle.test.ts` | pass     |
| AC-033 | running → stale → stopped (+ all edges)                      | `test/ac-033-sidecar.test.ts`          | pass     |
| AC-033 | `refreshSidecar` drives the edge from a scripted probe       | `test/ac-033-sidecar.test.ts`          | pass     |

### Skipped (live, AC-tagged)

- **AC-014 live loopback bind + EADDRINUSE port search** — requires a real socket
  and a running event loop; the `findAvailablePort` search and the
  `HttpServerRequest → OverlayRequest → handleRequest → HttpServerResponse`
  adapter are implemented in `src/server.ts`, and all reachable-without-a-socket
  logic is covered by the `handleRequest` unit tests above.

## Public API

Exported from `src/index.ts`: the request model + PURE primitives
(`validateEndpointPath`, `checkOrigin`, `tokensMatch`, `resolvePort`, …), the
`handleRequest` handler + `HandlerConfig` + the inbound `OverlayPostBody`
schema, the `EventsStoreTag` port + lifecycle + in-memory and fs-backed layers,
the sidecar state machine, and the real-server seam (`overlayServerLayer`,
`findAvailablePort`).
