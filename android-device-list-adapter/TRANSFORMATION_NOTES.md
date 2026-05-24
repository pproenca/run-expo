# android-device-list-adapter Transformation Notes

## Scope

Transformed the Android `adb devices -l` listing branch from `legacy/expo98/dist/expo-ios.mjs` into a typed TypeScript module at `modernized/expo98/android-device-list-adapter`.

Business rule coverage:

- `RULE-024`: Device listing reads local Android bridge state without mutating devices.

## Mapping

| Legacy source | Target source | Behavior |
| --- | --- | --- |
| `legacy/expo98/dist/expo-ios.mjs:1257-1258` | `src/main/index.ts:22-29` | Runs `adb devices -l` with `20000ms` timeout. |
| `legacy/expo98/dist/expo-ios.mjs:1259-1269` | `src/main/index.ts:31-42` | Splits CRLF/LF output, skips header, trims and filters blank lines, parses serial/state/details, and joins remaining detail tokens with spaces. |
| `legacy/expo98/dist/expo-ios.mjs:1269-1270` | `src/main/index.ts:28` | Applies the requested limit after parsing rows. |

## Characterization Tests

Tests live in `src/test/characterization.test.ts` and cover:

- `adb devices -l` command and timeout.
- Header skip, blank-line filtering, serial/state/details parsing.
- CRLF support and limit behavior.
- Header-only output.
- Sparse malformed row behavior.

Current verification:

```bash
cd modernized/expo98/android-device-list-adapter && npm test
```

## Deliberate Deviations

- Added an injected `execFilePromise` dependency so tests do not depend on attached Android devices. The default path still shells to `adb`.

## Not Migrated

- Combined list-device tool envelopes are covered by `device-listing`.
- Android action command argument projection is covered by `mobile-device-selection` and action packages.

## Follow-Ups

- Wire this adapter into `device-listing` when shared package dependencies are consolidated.

## Architecture Review

Self-review findings:

- High: preserve row parsing even for sparse nonblank rows because the legacy code did not validate row completeness.
- Medium: keep parser exported so caller tests can pin parsing without shelling out to `adb`.

Applied fixes:

- Added tests for CRLF output and sparse row behavior.
