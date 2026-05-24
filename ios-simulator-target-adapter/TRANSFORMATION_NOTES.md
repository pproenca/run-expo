# ios-simulator-target-adapter Transformation Notes

## Scope

Transformed the native iOS simulator target-list adapter from `legacy/expo98/dist/expo-ios.mjs` into a typed TypeScript module at `modernized/expo98/ios-simulator-target-adapter`.

Business rule coverage:

- `RULE-009`: Target discovery uses currently available simulator records and sorts booted devices ahead of other candidates.
- `RULE-024`: Device discovery reads local simulator state without starting or mutating simulators.

## Mapping

| Legacy source | Target source | Behavior |
| --- | --- | --- |
| `legacy/expo98/dist/expo-ios.mjs:1471-1475` | `src/main/index.ts:27-35` | Runs `xcrun simctl list devices available --json` with `20000ms` timeout and `4MiB` buffer. |
| `legacy/expo98/dist/expo-ios.mjs:1476-1484` | `src/main/index.ts:36-45` | Flattens `devices` runtime groups and emits `{ runtime, id, name, state }`, falling back from missing `name` to `udid`. |
| `legacy/expo98/dist/expo-ios.mjs:1485-1487` | `src/main/index.ts:45-49` | Sorts booted devices first, then by `name.localeCompare`. |
| `legacy/expo98/dist/expo-ios.mjs:1523-1528` | `src/main/index.ts:52-57` | Normalizes `Booted`, `Shutdown`, and `connected`; all other states become `unknown`. |

## Characterization Tests

Tests live in `src/test/characterization.test.ts` and cover:

- `xcrun` command, arguments, timeout, and buffer options.
- Runtime group flattening.
- ID/name fallback and state normalization.
- Booted-first/name sort order.
- Missing devices object.
- Invalid JSON propagation.

Current verification:

```bash
cd modernized/expo98/ios-simulator-target-adapter && npm test
```

## Deliberate Deviations

- Added an injected `execFilePromise` dependency. Production defaults still shell to `xcrun`; tests can prove behavior without relying on installed simulator state.

## Not Migrated

- Target composition and Metro correlation are covered by `target-management`.
- Device selection by requested simulator name/UDID is covered by `mobile-device-selection`.

## Follow-Ups

- Wire this adapter into `target-management` when shared package dependencies are consolidated.

## Architecture Review

Self-review findings:

- High: preserve `name ?? udid` fallback because stable target IDs depend on a usable display name.
- Medium: preserve `connected` as a recognized state even though it is not a simulator boot state.

Applied fixes:

- Added characterization tests for sort order, missing names, and unknown states.
