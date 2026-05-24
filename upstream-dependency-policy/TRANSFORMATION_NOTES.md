# upstream-dependency-policy Transformation Notes

## Scope

Transformed upstream dependency policy helpers from `legacy/expo98/dist/expo-ios.mjs` into a typed TypeScript module at `modernized/expo98/upstream-dependency-policy`.

Business rule coverage:

- `RULE-024`: Project introspection reports missing or optional upstream packages as structured data rather than command failures.

## Mapping

| Legacy source | Target source | Behavior |
| --- | --- | --- |
| `legacy/expo98/dist/expo-ios.mjs:915-921` | `src/main/index.ts:26-32` | Expo SDK to React Native compatibility table. |
| `legacy/expo98/dist/expo-ios.mjs:923-1093` | `src/main/index.ts:121-321` | `buildUpstreamDependencyReport` emits seven dependency policy records, category rules, summary, and compatibility details. |
| `legacy/expo98/dist/expo-ios.mjs:1095-1104` | `src/main/index.ts:34-45` | `dependencyInfo` detects presence, loose resolved version, and unresolved workspace/catalog/file/link/portal specs. |
| `legacy/expo98/dist/expo-ios.mjs:1106-1109` | `src/main/index.ts:47-51` | `dependencyStatus` returns missing, declared-unresolved, or present. |
| `legacy/expo98/dist/expo-ios.mjs:1112-1129` | `src/main/index.ts:53-73` | Loose version parsing plus major and major/minor helpers. |
| `legacy/expo98/dist/expo-ios.mjs:1131-1168` | `src/main/index.ts:75-119` | Expo/RN compatibility classification for missing, unresolved, unknown, compatible, and mismatched versions. |
| `legacy/expo98/dist/expo-ios.mjs:1170-1184` | `src/main/index.ts:323-339` | Upstream dependency summary counts, mismatched IDs, and missing IDs. |

## Characterization Tests

Tests live in `src/test/characterization.test.ts` and cover:

- Dependency presence, unresolved specs, and loose version extraction.
- Status and Expo/RN compatibility classifications.
- Seven-entry report shape and notable status rules.
- Summary counts, mismatched IDs, and missing IDs.

Current verification:

```bash
cd modernized/expo98/upstream-dependency-policy && npm test
```

## Deliberate Deviations

- The helper accepts a plain dependency map rather than reading `package.json`. Filesystem discovery remains in `project-info-doctor` and `project-filesystem-helpers`.

## Not Migrated

- Static Expo app-config summarization remains in `project-info-doctor`.
- Runtime package-manager and file discovery helpers are covered by `project-filesystem-helpers`.

## Follow-Ups

- Replace the embedded copy in `project-info-doctor` when shared package dependencies are consolidated.

## Architecture Review

Self-review findings:

- High: preserve the compatibility table exactly because it drives user-facing mismatch evidence.
- Medium: preserve unresolved workspace/catalog detection before claiming compatibility.

Applied fixes:

- Added tests for compatible, mismatched, unknown, missing, and unresolved compatibility states.
