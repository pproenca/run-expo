# Transformation Notes: annotation-server-http

## Scope

Transformed the legacy annotation server HTTP request behavior:

- command startup for `annotation-server`
- `GET /` and `GET /annotate.html`
- `GET /screenshot.png`
- `GET /context.json`
- `GET /annotations.json`
- `POST /annotations`
- JSON `404` and `500` envelopes
- static file response headers
- JSON response headers and trailing newline
- request body size limit
- startup payload shape
- `requireString` and `clampNumber` helper behavior

## Rule Coverage

| Rule | Coverage |
| --- | --- |
| `RULE-012` | Preserves annotation sidecar path routing, `comments[]` validation, body limit rejection, local artifact writes, unsupported route behavior, and malformed request error responses. |

## Mapping

| Legacy source | Modern source | Behavior |
| --- | --- | --- |
| `legacy/expo98/dist/expo-ios.mjs:3758-3794` | `src/main/index.ts:45` | Resolves `dir`, clamps/listens on `127.0.0.1:<port>`, prints the startup payload, and can delegate the legacy forever wait after startup. |
| `legacy/expo98/dist/expo-ios.mjs:3758-3763` | `src/main/index.ts:27` | Builds request URL against `127.0.0.1:<port>` and routes `GET /` / `GET /annotate.html`. |
| `legacy/expo98/dist/expo-ios.mjs:3764-3774` | `src/main/index.ts:37` | Serves screenshot, context, and annotations files with legacy content types. |
| `legacy/expo98/dist/expo-ios.mjs:3775-3782` | `src/main/index.ts:46` | Reads bounded POST body, parses JSON, requires `comments[]`, stamps `savedAt`, writes `annotations.json`, and returns save metadata. |
| `legacy/expo98/dist/expo-ios.mjs:3783-3786` | `src/main/index.ts:55` | Returns JSON `404` for unsupported routes and JSON `500` for thrown errors. |
| `legacy/expo98/dist/expo-ios.mjs:3792-3794` | `src/main/index.ts:94` | Produces startup payload `{ ok, url, dir }`. |
| `legacy/expo98/dist/expo-ios.mjs:4152-4160` | `src/main/index.ts:61` | Preserves static file response headers and body. |
| `legacy/expo98/dist/expo-ios.mjs:4162-4168` | `src/main/index.ts:72` | Preserves JSON response headers and trailing newline. |
| `legacy/expo98/dist/expo-ios.mjs:4170-4182` | `src/main/index.ts:83` | Preserves request body aggregation and `request body too large` error. |
| `legacy/expo98/dist/expo-ios.mjs:12038-12051` | `src/main/index.ts:98` | Preserves required string validation and finite-number clamping. |

## Characterization Tests

`src/test/characterization.test.ts` covers:

- command startup on loopback, stdout startup JSON, port clamping, required
  directory validation, and the injected forever-wait hook
- all supported `GET` file routes and content types
- `POST /annotations` persistence with `savedAt`
- unsupported-route JSON `404`
- malformed JSON and malformed `comments` payload JSON `500`
- request body limit rejection
- startup payload, required string, clamp, and JSON formatting helpers

## Deliberate Deviations

- The modern package exposes a pure `handleAnnotationRequest` returning response data instead of directly mutating Node `ServerResponse`. This lets a later server adapter apply the response without duplicating routing behavior.
- `annotationServer` accepts injected `listen`, `stdout`, and optional
  `waitForever` dependencies instead of directly importing `http` and process
  globals. The final executable can pass real process/server adapters while
  tests avoid opening sockets or hanging forever.
- The transform preserves legacy unauthenticated localhost semantics for equivalence. Hardening remains a separate `RULE-012` follow-up: token-bound loopback routes and stricter origin checks.

## Architecture Review

Local review found no high-severity issues. The handler isolates filesystem,
time, server, and process-output dependencies and has focused coverage for every
legacy route and startup behavior. Medium follow-up: wire this handler into a
hardened server adapter alongside `annotate-screen-artifacts`.

## Representative Diff

Use this command from the modernization workspace:

```bash
diff -u <(sed -n '3758,3794p' legacy/expo98/dist/expo-ios.mjs) <(sed -n '27,58p' modernized/expo98/annotation-server-http/src/main/index.ts)
```
