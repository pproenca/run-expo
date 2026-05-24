# metro-target-list-adapter Transformation Notes

## Scope

Transformed the Metro target-list adapter used by target discovery from `legacy/expo98/dist/expo-ios.mjs` into a typed TypeScript module at `modernized/expo98/metro-target-list-adapter`.

Business rule coverage:

- `RULE-009`: Target discovery correlates simulator targets with Metro `/json/list` records when Metro is available.
- `RULE-024`: Metro discovery failure is non-fatal for target listing; native device targets are still returned.

## Mapping

| Legacy source | Target source | Behavior |
| --- | --- | --- |
| `legacy/expo98/dist/expo-ios.mjs:1449` | `src/main/index.ts:6-11` | Fetches `http://127.0.0.1:<metroPort>/json/list` through `fetchLocalJson` with `timeoutMs: 1000`. |
| `legacy/expo98/dist/expo-ios.mjs:1449` | `src/main/index.ts:13-18` | Target discovery catches Metro fetch failures and substitutes `[]`. |

## Characterization Tests

Tests live in `src/test/characterization.test.ts` and cover:

- Exact loopback URL and timeout.
- Raw payload preservation for the target-domain normalizer.
- Direct fetch error propagation.
- Synchronous and asynchronous discovery fallback to `[]`.

Current verification:

```bash
cd modernized/expo98/metro-target-list-adapter && npm test
```

## Deliberate Deviations

- Split direct fetch and discovery fallback into two exported functions. The legacy line embedded `.catch(() => [])` at the call site; the split makes the target-discovery policy explicit while preserving both observable behaviors.

## Not Migrated

- Metro payload normalization and simulator correlation are covered by `target-management`.
- Loopback host retry behavior is covered by `local-loopback-fetch`.

## Follow-Ups

- Wire this adapter into `target-management` when shared package dependencies are consolidated.

## Architecture Review

Self-review findings:

- High: keep Metro unavailability non-fatal for target discovery so target listing still works before Metro starts.
- Medium: preserve raw payload forwarding because the target-domain normalizer owns malformed payload handling.

Applied fixes:

- Added tests for direct propagation and discovery fallback paths.
