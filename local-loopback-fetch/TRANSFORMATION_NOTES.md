# local-loopback-fetch Transformation Notes

## Scope

Transformed the legacy local HTTP helpers from `legacy/expo98/dist/expo-ios.mjs` into a typed TypeScript module at `modernized/expo98/local-loopback-fetch`.

Business rule coverage:

- `RULE-024`: Local Metro and runtime probes use bounded loopback HTTP calls and preserve loopback host fallback without starting external services.

## Mapping

| Legacy source | Target source | Behavior |
| --- | --- | --- |
| `legacy/expo98/dist/expo-ios.mjs:11722-11726` | `src/main/index.ts:17-25` | `fetchLocalText` uses loopback fallback and throws `HTTP <status>` for non-OK responses before returning response text. |
| `legacy/expo98/dist/expo-ios.mjs:11728-11744` | `src/main/index.ts:27-44`, `src/main/index.ts:85-100` | `fetchLocalLoopback` removes `timeoutMs` from request options, applies a default `1500ms` timeout, retries candidates, and throws the last fetch error. |
| `legacy/expo98/dist/expo-ios.mjs:11746-11762` | `src/main/index.ts:46-65` | `loopbackUrlCandidates` expands loopback hosts in `127.0.0.1`, `localhost`, `[::1]` order and returns non-loopback or invalid URLs untouched. |
| `legacy/expo98/dist/expo-ios.mjs:11764-11773` | `src/main/index.ts:67-75` | `fetchLocalTextDirect` fetches only the original URL, applies timeout, and throws `HTTP <status>` for non-OK responses. |
| `legacy/expo98/dist/expo-ios.mjs:11775-11777` | `src/main/index.ts:77-83` | `fetchLocalJson` parses JSON from `fetchLocalText`. |

## Characterization Tests

Tests live in `src/test/characterization.test.ts` and cover:

- Loopback candidate generation for `127.0.0.1`, `localhost`, and `[::1]`.
- Non-loopback and invalid URL passthrough.
- Retry order, request option forwarding, and `timeoutMs` removal.
- Last-error behavior when every candidate fails.
- Abort-timeout behavior for a hanging request.
- Text/JSON conversion and `HTTP <status>` errors.
- Direct text fetch without loopback fallback.

Current verification:

```bash
cd modernized/expo98/local-loopback-fetch && npm test
```

## Deliberate Deviations

- Added an optional injected `fetch` dependency. The default path still uses global `fetch`, while tests can prove retry and timeout behavior without network access.
- Exposed `loopbackUrlCandidates` as a public pure function so dependent modernized modules can share the exact legacy fallback policy.

## Not Migrated

- Call-site wiring inside Metro and runtime probes remains in their owning modules.

## Follow-Ups

- Replace duplicated private loopback helpers in `metro-probes` with this package once the modernized workspace grows a shared package graph.

## Architecture Review

Self-review findings:

- High: preserve the exact loopback retry order and last-error semantics because this behavior affects local Metro reliability.
- Medium: keep fetch dependency injection narrow so application code still uses the platform fetch implementation by default.

Applied fixes:

- Added characterization tests for fallback order, last-error throwing, and direct-fetch non-fallback behavior.
