# metro-probes Transformation Notes

## Scope

Transformed the legacy Metro probe behavior from `legacy/expo98/dist/expo-ios.mjs` into a typed TypeScript module at `modernized/expo98/metro-probes`.

Business rule coverage:

- `RULE-024`: Metro status and target probes return unavailable envelopes or skip malformed targets without implicitly starting Metro.

## Mapping

| Legacy source | Target source | Behavior |
| --- | --- | --- |
| `legacy/expo98/dist/expo-ios.mjs:5758-5764` | `src/main/index.ts:181-192` | `metroCommand` defaults to `status`, delegates `reload` and `symbolicate`, and rejects unknown actions. |
| `legacy/expo98/dist/expo-ios.mjs:5766-5794` | `src/main/index.ts:437-468` | Default reload and symbolicate payloads use normalized targets, runtime evaluation, stack-file parsing, path resolution, frame counts, and Metro symbolication results. |
| `legacy/expo98/dist/expo-ios.mjs:5796-5801` | `src/main/index.ts:194-207` | `metroStatusPayload` clamps the port and `metroTargets` unwraps normalized targets. |
| `legacy/expo98/dist/expo-ios.mjs:5803-5823` | `src/main/index.ts:162-179` | `targetSummary` normalizes missing fields to `null` and derives fallback capability flags. |
| `legacy/expo98/dist/expo-ios.mjs:5825-5861` | `src/main/index.ts:217-287` | `MetroInspectorClient.status`, `version`, and `targets` probe Metro loopback endpoints and wrap errors as data. |
| `legacy/expo98/dist/expo-ios.mjs:5863-5897` | `src/main/index.ts:289-325` | Target normalization skips non-object, array, and metadata-free target entries with shape evidence. |
| `legacy/expo98/dist/expo-ios.mjs:5899-5933` | `src/main/index.ts:327-362` | Symbolication probe posts an empty or provided component stack and converts HTTP/fetch failures to unavailable envelopes. |
| `legacy/expo98/dist/expo-ios.mjs:5935-5968` | `src/main/index.ts:364-402` | `statusPayload` short-circuits when `/status` is unavailable and composes version, target, symbolication, and limitation evidence when reachable. |
| `legacy/expo98/dist/expo-ios.mjs:5972-5974` | `src/main/index.ts:405-407` | Optional string normalization treats blank strings and non-strings as `null`. |
| `legacy/expo98/dist/expo-ios.mjs:9974-9983` | `src/main/index.ts:416-425` | Response shape evidence records arrays, primitive types, object keys, result types, and nested result shapes. |
| `legacy/expo98/dist/expo-ios.mjs:11722-11762` | `src/main/index.ts:603-648` | Default local fetches use loopback host fallback across `127.0.0.1`, `localhost`, and `[::1]`. |
| `legacy/expo98/dist/expo-ios.mjs:12045-12064` | `src/main/index.ts:144-159` | Finite-number clamping and formatted error messages, including stdout and stderr sections. |

## Characterization Tests

Tests live in `src/test/characterization.test.ts` and cover:

- Metro port clamping and invalid number errors.
- Command dispatch and unknown action errors.
- Default reload runtime-evaluation dispatch.
- Default symbolicate stack-file requirement, positional fallback, frame parsing, and POST body.
- Target summary and normalization behavior.
- Target discovery unavailable, malformed, and partial-success envelopes.
- Status and version endpoint envelopes, including loopback host fallback.
- Symbolication OK, non-OK, JSON-parse failure, and fetch-failure envelopes.
- Full `statusPayload` composition and unavailable short-circuiting.

Current verification:

```bash
cd modernized/expo98/metro-probes && npm test
```

Result: 22 tests passing.

## Deliberate Deviations

- The module exposes dependency-injected fetch, filesystem, path, and Hermes-evaluation functions instead of hard-wiring all process-level helpers. This preserves observable behavior while making Metro endpoint probing deterministic in tests and reusable from other modernized packages.
- The default HTTP adapters use `fetch` with `AbortController` timeouts and preserve legacy loopback host fallback. The observable endpoint URLs, methods, request bodies, timeout values, and fallback order match the characterized legacy behavior.
- `MetroStatusPayload` is exported as a typed interface rather than returning `unknown` from status APIs.

## Not Migrated

- CLI wiring and argument parsing outside the `metroCommand` payload boundary.

## Follow-Ups

- Consider replacing the lightweight local Hermes CDP client with a shared runtime-evaluation package if later modules need the same protocol behavior.
- Wire this package into the eventual modernized CLI command router after the remaining command modules are transformed.

## Architecture Review

Architecture critic findings after first implementation:

- High: default `reload` and `symbolicate` handlers were placeholders despite being reachable through `metroCommand`.
- High: default local fetches only tried `127.0.0.1` and missed the legacy `localhost` / `[::1]` fallback behavior.
- Medium: status payload APIs returned `unknown`.
- Medium: `formatError` did not stringify non-string `message` values exactly like legacy.
- Nit: package description still described only characterization tests.

Applied fixes:

- Implemented default reload/symbolicate behavior with injected seams and added characterization tests.
- Restored loopback host fallback and added characterization coverage.
- Added `MetroStatusPayload`.
- Adjusted `formatError`.
- Updated package metadata.
