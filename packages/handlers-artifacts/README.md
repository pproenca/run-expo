# `@expo98/handlers-artifacts`

D12 artifacts / review / observability / orchestration command handlers for the
Effect-TS rebuild of `expo98`: **`live-backlog`** (`generate`/`matrix`/`run`),
**`diff`**, **`ux-context`**, **`review-next`**, **`review`** (`report`/`matrix`),
**`dashboard`** (`start`/`stop`/`report`), plus the **run-record payload-summary
helper** (AC-042).

Every command is a `@expo98/core` `CommandDescriptor` carrying its **required**
typed `sideEffect`. All D12 commands here are `read` — their handler `R` is
`never`, so they structurally cannot name a dangerous capability
(`RuntimeEvalCapability` / `DeviceCapability` / `SourceWriteCapability`). They
read source-derived backlogs, captured evidence, files, and observability state;
they never inject JS, drive the device, write source, or open a network port.

## What this package lands

| AC         | What                                                                                                                                                                                                                                                                      |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC-057** | live-backlog row classification from evidence (exit code + runtime requirements + an injected **live-evidence signal**).                                                                                                                                                  |
| **AC-058** | live-backlog substitutions are **project inputs**, never baked fixtures. `__METRO_PORT__ → clamp(metroPort ?? 8081, 1, 65535)`; `__BUNDLE_ID__`/`__DEVICE__`/`__DEV_CLIENT_URL__` resolve from required inputs; a missing required input → a clear `MissingBacklogInput`. |
| **AC-042** | backlog summary `keys.slice(0,20)` + classification rollups; run-record summary `keys.slice(0,40)` + `available`/`routeCount`/`eventCount`.                                                                                                                               |

The other commands (`diff`, `ux-context`, `review-next`, `review`, `dashboard`)
have **no AC that pins their calculation**, so they are implemented as faithful,
small `read` command descriptors with their documented result shapes and tested
for the envelope/shape.

## AC → test map

| AC                  | Test file                            | What it proves                                                                                                                                                                                                                                                                                                                                              |
| ------------------- | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC-057**          | `test/ac-057-classification.test.ts` | the FULL classification matrix — one case per branch (`expected-usage-error` / `environment-blocked` / `defect` / `live-pass` / `static-pass` / `designed-unavailable`), with a **fake `LiveEvidenceSignal`**; the live-evidence detector fires on each facet; `live-backlog run` classifies each substituted row end-to-end + rolls up the AC-042 summary. |
| **AC-058**          | `test/ac-058-substitutions.test.ts`  | `__METRO_PORT__` default 8081 + clamp; the other three resolve from provided inputs; a **missing required input → a clear error, NOT a default**; and an explicit assertion that **no `com.maddie.console` / `exp+maddie://` / `booted`** appears in the template, the resolver, the errors, or the matrix output.                                          |
| **AC-042**          | `test/ac-042-summary.test.ts`        | backlog `keys.slice(0,20)` + classification rollups; run-record `keys.slice(0,40)` + `available`/`routeCount`/`eventCount` rollups (emitted only when present); the run-record summary decodes as a valid domain `RunPayloadSummary`.                                                                                                                       |
| smoke (no-listener) | `test/dashboard-no-listener.test.ts` | `dashboard start/stop/report` reports `networkListener:false` and the dashboard **source imports no `http`/`net`/`ws`/`createServer`/`.listen(`** — it is file/state only.                                                                                                                                                                                  |
| smoke (shape)       | `test/read-commands.test.ts`         | `diff`/`ux-context`/`review-next`/`review` run ungated (exit 0, `read`) and return their documented shapes.                                                                                                                                                                                                                                                 |

### Skipped (require a live environment)

- `test/ac-057-classification.test.ts` —
  `it.skip("AC-057 live-backlog run against a REAL environment …")`: needs a
  running Metro/Hermes/simulator to produce real per-row evidence through the
  live-evidence probe. The pure classification + summary are fully covered with
  the injected fake `LiveEvidenceSignal`.

## The live-evidence detection seam (AC-057)

Live-evidence detection requires WS URLs / CDP calls / a running packager /
non-empty targets. Rather than re-implement that probe inline (it needs a live
environment), this package exposes it as a **documented seam**: `LiveEvidenceSignal`
is a pure signal the runner injects, and `classifyRow` is pure over it. The real
probe lives behind `@expo98/protocols` (Metro `/json/list` non-empty, CDP
`webSocketDebuggerUrl`, a Hermes evaluate round-trip) and is wired only on the
live (skipped) `run` path.

## Dropped commands (Phase B — intentionally NOT built here)

- **Video `record`** (`xcrun simctl io recordVideo`) — dropped in Phase B.
- **The in-app HTML overlay scaffold** (`CodexReviewOverlay.tsx` generation) —
  dropped in Phase B. The hardened review-overlay **ingest server** is a separate
  package (`@expo98/overlay-server`); it is not re-built here.

## Reuse (no re-implementation)

- **`batch` (AC-031)** is NOT in this package — it is `@expo98/core`'s `runBatch`,
  reused as-is.
- The **run-record summary shape** is the domain `RunPayloadSummary` schema type
  (`@expo98/domain`), reused; this package only adds the calculation that builds
  it (there is no behavioural builder in core/domain — only the persistence
  `Schema.Struct`).
- `__METRO_PORT__` clamp reuses `@expo98/protocols`' `clamp` + `DEFAULT_METRO_PORT`
  - `MIN_PORT`/`MAX_PORT` (the single AC-038 source).
