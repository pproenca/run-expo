# mobile-device-selection Transformation Notes

## Scope

Transformed the legacy iOS/Android device-selection helper cluster from `legacy/expo98/dist/expo-ios.mjs` into a typed TypeScript module at `modernized/expo98/mobile-device-selection`.

Business rule coverage:

- `RULE-024`: Device probes inspect existing simulator/device state without starting or mutating devices.
- `RULE-025`: Mobile command adapters preserve platform-specific target selection behavior.

## Mapping

| Legacy source | Target source | Behavior |
| --- | --- | --- |
| `legacy/expo98/dist/expo-ios.mjs:11923-11927` | `src/main/index.ts:29-36` | Long UDID-like requests are accepted directly without invoking `simctl`. |
| `legacy/expo98/dist/expo-ios.mjs:11928-11935` | `src/main/index.ts:38-47` | `resolveIosDevice` runs `xcrun simctl list devices available --json` with legacy timeout/buffer and flattens runtime device groups. |
| `legacy/expo98/dist/expo-ios.mjs:11936-11942` | `src/main/index.ts:49-55` | Requested device matching tries exact UDID/name, then case-insensitive partial name, then throws the legacy no-match error. |
| `legacy/expo98/dist/expo-ios.mjs:11943-11954` | `src/main/index.ts:57-70` | Unrequested selection prefers booted devices when asked, otherwise the last iPhone, then first device, then throws no-simulators error. |
| `legacy/expo98/dist/expo-ios.mjs:11957-11959` | `src/main/index.ts:73-75` | `androidDeviceArgs` prepends `-s <device>` only for truthy device values. |
| `legacy/expo98/dist/expo-ios.mjs:11961-11969` | `src/main/index.ts:77-88` | `iosLogPredicate` prefers explicit process name, derives bundle-id tail with `String(...).split(".").at(-1)`, and escapes predicate strings. |

## Characterization Tests

Tests live in `src/test/characterization.test.ts` and cover:

- UDID shortcut without `simctl`.
- `simctl` command arguments, timeout, and buffer options.
- Exact UDID/name matching and runtime preservation.
- Case-insensitive partial name matching.
- Booted, last-iPhone, first-device, no-match, and no-device selection paths.
- Android `-s` argument projection for truthy and falsey device values.
- iOS log predicate precedence and escaping.

Current verification:

```bash
cd modernized/expo98/mobile-device-selection && npm test
```

## Deliberate Deviations

- Added dependency injection for `execFilePromise` so tests can characterize selection behavior without requiring local simulator state.
- `androidDeviceArgs` accepts `unknown` values to mirror the legacy truthiness behavior before command adapters coerce their inputs.

## Not Migrated

- App lifecycle and interaction command orchestration remains in their owning modules.

## Follow-Ups

- Replace private resolver copies in platform command packages with this package when shared internal dependencies are wired.

## Architecture Review

Self-review findings:

- High: preserve the long-UDID shortcut because it allows physical/specific devices to be targeted even when `simctl` discovery is unavailable.
- Medium: preserve last-iPhone fallback order because simulator lists are returned oldest-to-newest in many local setups.

Applied fixes:

- Added characterization tests for every selection fallback and predicate escaping path.
