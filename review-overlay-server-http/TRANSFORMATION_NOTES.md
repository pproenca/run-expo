# Transformation Notes: review-overlay-server-http

## Scope

Transformed the legacy review overlay HTTP server request behavior:

- wildcard CORS headers
- `OPTIONS` preflight
- `GET /health`
- `GET /pointer`
- `POST /copy`
- `GET /events.json`
- configured event endpoint `GET`
- configured event endpoint `POST`
- configured event endpoint `DELETE`
- JSON `404` and `500` envelopes
- request body size limit
- simulator pointer coordinate mapping
- startup payload shape
- endpoint path normalization

## Rule Coverage

| Rule | Coverage |
| --- | --- |
| `RULE-012` | Preserves review-overlay local HTTP behavior: path routing, body limit rejection, event artifact reads/writes, malformed request handling, broad CORS, and lack of authentication as a documented legacy risk. |

## Mapping

| Legacy source | Modern source | Behavior |
| --- | --- | --- |
| `legacy/expo98/dist/expo-ios.mjs:3902-3916` | `src/main/index.ts:40` | Builds request URL, sets CORS headers, handles `OPTIONS`, and serves `/health`. |
| `legacy/expo98/dist/expo-ios.mjs:3917-3923` | `src/main/index.ts:54` | Handles `/pointer`, defaulting malformed viewport dimensions to `393x852`. |
| `legacy/expo98/dist/expo-ios.mjs:3924-3929` | `src/main/index.ts:62` | Handles `/copy`, parses bounded body JSON, writes clipboard text, and returns copy status. |
| `legacy/expo98/dist/expo-ios.mjs:3930-3932` | `src/main/index.ts:68` | Serves `events.json` with JSON content type. |
| `legacy/expo98/dist/expo-ios.mjs:3933-3945` | `src/main/index.ts:71` | Handles configured event endpoint `GET`, `POST`, and `DELETE`. |
| `legacy/expo98/dist/expo-ios.mjs:3946-3949` | `src/main/index.ts:85` | Returns JSON `404` for unsupported paths and JSON `500` for thrown errors. |
| `legacy/expo98/dist/expo-ios.mjs:3955-3961` | `src/main/index.ts:158` | Produces startup payload `{ ok, url, endpoint, eventsPath }`. |
| `legacy/expo98/dist/expo-ios.mjs:3966-3987` | `src/main/index.ts:135` | Maps macOS cursor and Simulator window bounds into viewport coordinates. |
| `legacy/expo98/dist/expo-ios.mjs:4038-4042` | `src/main/index.ts:115` | Preserves wildcard CORS headers and methods. |
| `legacy/expo98/dist/expo-ios.mjs:4044-4049` | `src/main/index.ts:171` | Preserves endpoint path defaulting and simple path validation. |
| `legacy/expo98/dist/expo-ios.mjs:4170-4182` | `src/main/index.ts:124` | Preserves request body aggregation and `request body too large` error. |

## Characterization Tests

`src/test/characterization.test.ts` covers:

- CORS headers and `OPTIONS`
- `/health`
- `/pointer` viewport defaults
- `/copy` clipboard behavior
- `/events.json`
- configured event endpoint read, append, and clear
- unsupported route `404`
- malformed JSON and oversized body `500`
- pointer coordinate mapping and macOS-unavailable response
- startup payload and endpoint path helper behavior

## Deliberate Deviations

- The modern package exposes a pure `handleReviewOverlayRequest` returning response data instead of directly mutating Node `ServerResponse`. A later server adapter can apply this data to an actual HTTP response.
- This transform intentionally preserves legacy wildcard CORS and unauthenticated mutation semantics for equivalence. The required security hardening remains a follow-up under `RULE-012`: token-bound loopback access and strict origin checks.

## Architecture Review

Local review found no high-severity issues. The request layer isolates event state, clipboard, pointer, and file dependencies behind adapters. Medium follow-up: wire this handler into a hardened server adapter and use `review-sidecar-state` for event persistence.

## Representative Diff

Use this command from the modernization workspace:

```bash
diff -u <(sed -n '3902,3949p' legacy/expo98/dist/expo-ios.mjs) <(sed -n '40,88p' modernized/expo98/review-overlay-server-http/src/main/index.ts)
```
