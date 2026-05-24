# Project Info Doctor Transformation Notes

## Scope

Transformed read-oriented project/tooling discovery behavior from `legacy/expo98/dist/expo-ios.mjs` into `modernized/expo98/project-info-doctor`.

Rules covered:

- `RULE-011`: upstream dependency compatibility is classified before relying on private or unstable upstream surfaces.
- `RULE-021`: formatted command output is bounded with explicit overflow markers.

## Legacy To Modern Mapping

| Behavior | Legacy source | Modern target | Notes |
| --- | --- | --- | --- |
| Doctor command capabilities and project section | `legacy/expo98/dist/expo-ios.mjs:815-842`, `legacy/expo98/dist/expo-ios.mjs:12001-12007` | `src/main/index.ts:68-94`, `src/main/index.ts:533-566` | Preserves command list, default `command -v` lookup, capability booleans, auth shape, project-info safe section, and no-repair default. |
| Doctor repair directories | `legacy/expo98/dist/expo-ios.mjs:844-851`, `legacy/expo98/dist/expo-ios.mjs:1383-1391` | `src/main/index.ts:96-106`, `src/main/index.ts:483-490` | Preserves `.scratch/expo-ios/runs` and `sessions` creation. `doctor --fix` intentionally ignores arbitrary stateDir input and repairs only under the normalized cwd scratch root. |
| Project root discovery and non-project result | `legacy/expo98/dist/expo-ios.mjs:854-865`, `legacy/expo98/dist/expo-ios.mjs:11826-11844` | `src/main/index.ts:107-165`, `src/main/index.ts:386-405` | Preserves cwd normalization, upward `package.json` lookup, and stable non-project payload. |
| Package manager detection | `legacy/expo98/dist/expo-ios.mjs:11850-11863` | `src/main/index.ts:408-421` | Preserves per-directory precedence `pnpm`, `yarn`, `bun.lockb`, `bun.lock`, `npm`, then parent walk. |
| App config summary | `legacy/expo98/dist/expo-ios.mjs:9685-9724`, `legacy/expo98/dist/expo-ios.mjs:1186-1199` | `src/main/index.ts:435-480` | Preserves `app.json` extraction, dynamic app.config regex extraction, basename source, optional `userInterfaceStyle`, and dynamic marker. |
| EAS summary | `legacy/expo98/dist/expo-ios.mjs:876-918` | `src/main/index.ts:129-163` | Preserves build/submit profile names and raw `cli` field. |
| Upstream dependency report | `legacy/expo98/dist/expo-ios.mjs:923-1184` | `src/main/index.ts:167-384`, `src/main/index.ts:570-584` | Preserves stable dependency IDs, statuses, categories, Expo/RN compatibility table, unresolved dependency markers, and summary counts. |
| Tool JSON and safe error output | `legacy/expo98/dist/expo-ios.mjs:801-813`, `legacy/expo98/dist/expo-ios.mjs:11993-12067` | `src/main/index.ts:491-530`, `src/main/index.ts:501-518` | Preserves MCP text envelope, unwrap fallback, safe sections, stdout/stderr error formatting, and truncation marker. |

## Proof

Characterization tests were written first in `src/test/characterization.test.ts`.

Latest package result:

```text
npm test
# tests 13
# suites 6
# pass 13
# fail 0
```

After architecture HIGH fixes:

```text
npm test
# tests 14
# suites 6
# pass 14
# fail 0
```

The tests cover tool envelopes, safe sections, bounded errors, non-project payloads, nested project root discovery, package manager precedence, static and dynamic app config summaries, EAS summaries, dependency parsing, Expo/RN compatibility states, upstream dependency report summaries, injected and default doctor capabilities, and repair directory creation.

## Deliberate Deviations

- `doctor` accepts an injected `commandPath` function and explicit `hasFetch`/`hasWebSocket` booleans for deterministic tests, while the exported command also includes a legacy-compatible default `command -v` adapter.
- The module keeps Node filesystem access because project discovery and `doctor --fix` are filesystem behaviors in the legacy command. It writes only the local scratch directories represented by repair records.

## Not Migrated

- Top-level CLI alias registration, global argv parsing, and JSON/plain CLI wrappers.
- Expo CLI dynamic config evaluation. The legacy behavior uses static regex extraction for app.config files, and this transform preserves that behavior.

## Architecture Review

Architecture critic HIGH findings applied:

- Added a legacy-compatible default `doctor()` command-path adapter using `command -v`; tests now cover default `doctor({ cwd })` without injected probes.
- Removed arbitrary `stateDir` repair routing from `doctor --fix`; tests verify an attempted external stateDir is ignored and repairs stay under `cwd/.scratch/expo-ios`.

Remaining non-HIGH follow-up:

- Public report types remain broad in this equivalence slice. Tight union types for dependency classification/status/report DTOs should be introduced when the shared CLI facade/runtime-core package integrates these outputs.

## Follow-Ups

- Wire this package into the eventual CLI compatibility facade for `doctor` and `project-info`.
- Share common `toolJson`, `safeToolSection`, `truncate`, and filesystem helpers from a runtime-core package when transformed modules are integrated.
