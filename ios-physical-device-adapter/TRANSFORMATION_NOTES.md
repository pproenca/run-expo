# ios-physical-device-adapter Transformation Notes

## Scope

Transformed iOS physical device listing from `legacy/expo98/dist/expo-ios.mjs` into a typed TypeScript module at `modernized/expo98/ios-physical-device-adapter`.

Business rule coverage:

- `RULE-024`: Device listing reads local developer-tool state without mutating devices.

## Mapping

| Legacy source | Target source | Behavior |
| --- | --- | --- |
| `legacy/expo98/dist/expo-ios.mjs:1275-1279` | `src/main/index.ts:28-35` | Runs `xcrun devicectl list devices --json-output -` with `20000ms` timeout and `4MiB` buffer. |
| `legacy/expo98/dist/expo-ios.mjs:1280-1281` | `src/main/index.ts:36-37` | Reads devices from `parsed.result.devices`, then `parsed.devices`, then `[]`. |
| `legacy/expo98/dist/expo-ios.mjs:1281-1288` | `src/main/index.ts:37-45` | Applies the limit and maps nested devicectl properties with flat-field fallbacks and `null` defaults. |

## Characterization Tests

Tests live in `src/test/characterization.test.ts` and cover:

- `xcrun devicectl` command, arguments, timeout, and buffer.
- Nested `result.devices` mapping.
- Flat `devices` fallback mapping.
- Missing-value null defaults.
- Limit application.
- Empty and invalid JSON payload behavior.

Current verification:

```bash
cd modernized/expo98/ios-physical-device-adapter && npm test
```

## Deliberate Deviations

- Added an injected `execFilePromise` dependency so tests do not depend on locally connected devices. The default path still shells to `xcrun`.

## Not Migrated

- Full `listDevices` command envelopes and safe sections are covered by `device-listing`.
- Simulator target adapters are covered by `ios-simulator-target-adapter`.

## Follow-Ups

- Wire this adapter into `device-listing` once shared package dependencies are consolidated.

## Architecture Review

Self-review findings:

- High: preserve both nested and flat payload shapes because `devicectl` output differs across Xcode versions.
- Medium: preserve null defaults to keep the legacy JSON shape stable for unavailable properties.

Applied fixes:

- Added tests for both payload shapes and missing values.
