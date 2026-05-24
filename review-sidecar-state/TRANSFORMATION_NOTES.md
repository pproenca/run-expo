# Transformation Notes: review-sidecar-state

## Scope

Transformed the durable state layer for the legacy annotation and review-overlay sidecars:

- `normalizeEndpointPath`
- `createReviewOverlayEventsFile`
- `readReviewOverlayEvents`
- `symbolicateReviewOverlayEvents`
- `parseComponentStackFrames`
- `appendReviewOverlayEvent`
- annotation `comments[]` payload persistence
- JSON response formatting

The HTTP server wrappers and browser UI assets are intentionally left for a follow-up transform. This package gives those wrappers a typed, testable state layer.

## Rule Coverage

| Rule | Coverage |
| --- | --- |
| `RULE-012` | Preserves local sidecar artifact behavior: simple endpoint path validation, `comments[]` validation for annotations, overlay event file creation/read/append, JSON response envelopes, and missing-file behavior. |

## Mapping

| Legacy source | Modern source | Behavior |
| --- | --- | --- |
| `legacy/expo98/dist/expo-ios.mjs:4044-4049` | `src/main/index.ts:58` | Normalizes overlay endpoint paths with default `/events`, slash prefixing, and simple path regex validation. |
| `legacy/expo98/dist/expo-ios.mjs:4051-4065` | `src/main/index.ts:65` | Creates `events.json`, preserves existing event files unless reset, defaults title, and stamps `createdAt`. |
| `legacy/expo98/dist/expo-ios.mjs:4067-4079` | `src/main/index.ts:85` | Reads missing or existing overlay events and attaches optional symbolication. |
| `legacy/expo98/dist/expo-ios.mjs:4081-4121` | `src/main/index.ts:157` | Parses component stacks, calls Metro symbolication, filters `node_modules`, and enriches events with source links. |
| `legacy/expo98/dist/expo-ios.mjs:4123-4135` | `src/main/index.ts:193` | Parses React component stack lines in the legacy `at Name (http...:line:column)` format. |
| `legacy/expo98/dist/expo-ios.mjs:4137-4154` | `src/main/index.ts:108` | Appends single or batched overlay events, skips non-object entries, generates fallback IDs, and writes `savedAt`. |
| `legacy/expo98/dist/expo-ios.mjs:3776-3782` | `src/main/index.ts:130` | Validates annotation payloads contain `comments[]`, adds `savedAt`, and writes `annotations.json`. |
| `legacy/expo98/dist/expo-ios.mjs:4162-4168` | `src/main/index.ts:146` | Formats JSON response status, headers, no-store cache policy, and trailing newline body. |

## Characterization Tests

`src/test/characterization.test.ts` covers:

- endpoint defaults, slash prefixing, empty optional strings, and invalid path rejection
- create/read/reset behavior for `events.json`
- missing overlay events shape
- component stack parsing and symbolication enrichment
- append behavior for batched events, skipped invalid entries, generated IDs, explicit override fields, and `savedAt`
- annotation `comments[]` validation and persistence
- JSON response formatting

## Deliberate Deviations

- The transformed package injects filesystem, time, random, and symbolication dependencies. Legacy code closed over globals and the Metro client directly.
- HTTP request/response objects are not exposed here. `sendJsonPayload` returns the same response shape as data so server adapters can apply it without duplicating formatting behavior.
- This transform preserves the weak legacy artifact contract for equivalence. Hardening remains a required follow-up for the server wrapper: loopback-only bind plus unguessable per-session token and strict origin checks, as described in `analysis/expo98/BUSINESS_RULES.md` `RULE-012`.

## Architecture Review

Local review found no high-severity issues. The state layer is side-effect isolated behind dependencies and has deterministic tests for filesystem and symbolication paths. Medium follow-up: the next HTTP wrapper transform must not reintroduce wildcard CORS or unauthenticated mutation endpoints from the legacy server.

## Representative Diff

Use this command from the modernization workspace:

```bash
diff -u <(sed -n '4051,4079p' legacy/expo98/dist/expo-ios.mjs) <(sed -n '65,106p' modernized/expo98/review-sidecar-state/src/main/index.ts)
```
