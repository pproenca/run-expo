# iOS Native Context Probes Transformation Notes

## Scope

This module modernizes native iOS probes used by the legacy UX context command
from `legacy/expo98/dist/expo-ios.mjs`.

| Legacy source | Modern source | Behavior |
| --- | --- | --- |
| `dist/expo-ios.mjs:11638-11663` | `src/main/index.ts` `collectFilteredIosLogs` | Builds optional process/bundle predicates, runs compact `simctl log show`, filters important lines, truncates fallback stdout/stderr, and returns line counts and errors. |
| `dist/expo-ios.mjs:11665-11681` | `src/main/index.ts` `iosInstalledAppInfo` | Reads app/data containers, builds `Info.plist` path, wraps plist reads with `safeToolSection`, and returns bundle/app/data/plist payload. |
| `dist/expo-ios.mjs:11683-11693` | `src/main/index.ts` `readInfoPlistFields` | Extracts selected plist fields with `plutil`, ignoring missing/error/blank values. |
| `dist/expo-ios.mjs:11786-11789`, `11993-11999`, `12053-12065` | `src/main/index.ts` helper functions | Preserves process-name derivation, predicate escaping, safe-section formatting, truncation, and error formatting. |

## Deliberate Deviations

- Command execution and path joining are dependency-injected. The legacy code
  closed over `execFilePromise` and `path.join`; this package keeps the same
  command payloads while allowing deterministic tests and later adapter wiring.

## Not Migrated

- Screenshot capture, PNG analysis, and hierarchy summaries are separate UX
  context helpers and remain covered by their existing packages or future
  focused transforms.

## Proof

Characterization tests cover explicit process predicates, bundle-derived
predicates, no-predicate log collection, important-line filtering, stdout/stderr
truncation, app/data container lookup, plist field extraction, plist safe errors,
and all helper functions.

## Follow-ups

- Wire `ux-context-capture` to this package in the final CLI composition layer.

