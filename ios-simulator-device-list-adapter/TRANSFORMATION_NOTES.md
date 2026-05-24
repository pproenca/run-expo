# ios-simulator-device-list-adapter Transformation Notes

## Scope

Transformed the raw simulator device-listing branch from `legacy/expo98/dist/expo-ios.mjs` into a typed TypeScript module at `modernized/expo98/ios-simulator-device-list-adapter`.

Business rule coverage:

- `RULE-024`: Device listing reads local simulator state without mutating simulators.

## Mapping

| Legacy source | Target source | Behavior |
| --- | --- | --- |
| `legacy/expo98/dist/expo-ios.mjs:1236-1239` | `src/main/index.ts:28-35` | Runs `xcrun simctl list devices available --json` with `20000ms` timeout and `4MiB` buffer. |
| `legacy/expo98/dist/expo-ios.mjs:1240-1250` | `src/main/index.ts:36-48` | Flattens runtime buckets and preserves raw `name`, `udid`, `state`, and `isAvailable` fields. |
| `legacy/expo98/dist/expo-ios.mjs:1251-1252` | `src/main/index.ts:48-53` | Sorts booted devices first, then by name, then applies the limit. |

## Characterization Tests

Tests live in `src/test/characterization.test.ts` and cover:

- Command arguments and execution options.
- Runtime bucket flattening and raw field preservation.
- Booted-first/name sort order before limit.
- Missing device object and invalid JSON behavior.

Current verification:

```bash
cd modernized/expo98/ios-simulator-device-list-adapter && npm test
```

## Deliberate Deviations

- Added injected `execFilePromise` for deterministic tests. The default adapter still shells to `xcrun`.

## Not Migrated

- Target-specific normalized simulator records are covered by `ios-simulator-target-adapter`.
- Combined tool envelopes are covered by `device-listing`.

## Follow-Ups

- Wire this adapter into `device-listing` when shared package dependencies are consolidated.

## Architecture Review

Self-review findings:

- High: preserve raw simulator fields because the list-devices command exposes tool output rather than target-selection state.
- Medium: preserve limit after sort to match user-visible ordering.

Applied fixes:

- Added tests for sort/limit and missing payload behavior.
