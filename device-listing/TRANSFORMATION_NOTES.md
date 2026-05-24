# Device Listing Transformation Notes

## Scope

Transformed read-only device listing behavior from `legacy/expo98/dist/expo-ios.mjs` into `modernized/expo98/device-listing`.

Rules covered:

- `RULE-009`: device discovery contributes to target freshness and availability decisions.
- `RULE-021`: bounded error output uses the legacy truncation marker when formatted by safe sections.

## Legacy To Modern Mapping

| Behavior | Legacy source | Modern target | Notes |
| --- | --- | --- | --- |
| `devices` platform selection, default platform, and limit clamp | `legacy/expo98/dist/expo-ios.mjs:1231-1273` | `src/main/index.ts:89-108` | Preserves default `all`, platform-specific sections, and 1..200 finite-number clamp. |
| iOS simulator listing | `legacy/expo98/dist/expo-ios.mjs:1235-1255` | `src/main/index.ts:126-150` | Preserves `xcrun simctl list devices available --json`, runtime flattening, Booted-first/name sort, limit, and malformed-bucket failure. |
| iOS physical device listing | `legacy/expo98/dist/expo-ios.mjs:1275-1290` | `src/main/index.ts:82-87`, `src/main/index.ts:171-180` | Preserves `devicectl` command, `result.devices` or root `devices`, field fallbacks, limit-before-map behavior, and malformed payload failure. |
| Android device listing | `legacy/expo98/dist/expo-ios.mjs:1258-1270` | `src/main/index.ts:110-124` | Preserves `adb devices -l`, header skip, serial/state/details parsing, and limit. |
| Safe section error boundary | `legacy/expo98/dist/expo-ios.mjs:11993-11999` | `src/main/index.ts:78-84` | Preserves `{ ok: true, value }` and `{ ok: false, error }` instead of failing the whole command. |
| Error formatting and truncation | `legacy/expo98/dist/expo-ios.mjs:12038-12067` | `src/main/index.ts:158-166`, `src/main/index.ts:189-193` | Preserves message plus optional stdout/stderr blocks and truncation marker. |
| Tool JSON envelope | `legacy/expo98/dist/expo-ios.mjs:801-803` | `src/main/index.ts:182-187` | Preserves one text content item and pretty JSON with trailing newline. |

## Proof

Characterization tests were written first in `src/test/characterization.test.ts`.

Latest package result:

```text
npm test
# tests 14
# suites 7
# pass 14
# fail 0
```

After architecture HIGH fixes:

```text
npm test
# tests 17
# suites 7
# pass 17
# fail 0
```

The tests cover platform selection, legacy numeric coercion, malformed JSON and malformed tool-payload safe-section behavior, command failure formatting, RULE-021 truncation markers, simulator flatten/sort/limit behavior, physical device normalization, Android `adb devices -l` parsing, and the legacy tool JSON text envelope.

## Deliberate Deviations

- The transformed module requires an injected `execFile` dependency rather than importing `node:child_process`. The module owns parsing and legacy payload shape; callers own process execution policy and environment.
- The module does not add action-policy enforcement. Device listing is read-only in the legacy CLI and the reimagined policy rule targets state-changing simulator/device operations.

## Not Migrated

- Top-level CLI alias registration and argv parsing.
- Device booting, target selection, app lifecycle control, and simulator resolution for action commands. Those are covered by separate transformed packages.

## Architecture Review

Architecture critic HIGH finding applied:

- Malformed simulator runtime buckets and physical `devicectl` payloads now fail into safe error sections instead of returning false successful empty data.

Additional applied feedback:

- Added a RULE-021 overflow-marker test for formatted safe-section stdout/stderr.
- Updated README after implementation.

Remaining non-HIGH note:

- Incomplete simulator device records preserve legacy raw property assignment rather than broad validation. This keeps the JSON omission behavior for `undefined` values when wrapped by `toolJson`.

## Follow-Ups

- Wire this package into the eventual CLI compatibility facade for the `devices` command.
- Share common `toolJson`, `safeToolSection`, `clampNumber`, and error formatting utilities from a runtime-core package when packages are integrated.
