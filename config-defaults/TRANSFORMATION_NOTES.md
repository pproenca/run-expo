# Transformation Notes: config-defaults

## Scope

Transformed the central config/default surface into TypeScript runtime data and helpers:

- CLI identity and version constants
- default output and subprocess limits
- default Metro port
- parse global defaults
- state-root, run-record, and artifact directory resolution
- `ExpoIosConfig`, `ConfigSource`, `ResolvedConfig`, environment keys, and default config shape
- source marker for default-only config resolution

This package does not load config files yet. The legacy runtime also lacks a central config resolver, so this slice intentionally preserves and centralizes the defaults currently scattered through the bundle and type contract.

## Rule Coverage

| Rule | Coverage |
| --- | --- |
| Assessment config debt | Creates a central module for defaults that were previously hardcoded in `dist` and only described in `src/contracts/config.ts`. |
| RULE-002 | Preserves redaction key defaults used by output/run-record redaction policy. |
| RULE-014 / RULE-018 | Preserves state/run path defaults under `.scratch/expo-ios`. |
| RULE-021 | Preserves `MAX_OUTPUT = 40000` and subprocess timeout `60000ms`. |
| RULE-024 / RULE-030 / RULE-031 | Preserves the common default Metro port `8081` used across runtime bridge and evidence domains. |

## Mapping

| Legacy source | Modern source | Behavior |
| --- | --- | --- |
| `legacy/expo98/dist/expo-ios.mjs:12-18` | `src/main/index.ts:3` | CLI identity, version, max output, exit-adjacent constants, and redaction marker context. |
| `legacy/expo98/dist/expo-ios.mjs:12012-12014` | `src/main/index.ts:6` | Subprocess default timeout and max buffer. |
| `legacy/expo98/dist/expo-ios.mjs:12780-12799` | `src/main/index.ts:93` | Parsed CLI global defaults. |
| `legacy/expo98/dist/expo-ios.mjs:12996-13004` | `src/main/index.ts:163` | Run-record directory defaults under `<root>/.scratch/expo-ios/runs`. |
| duplicated `resolveExpoStateRoot` helpers in transformed packages | `src/main/index.ts:154` | State root semantics: explicit `stateDir`, parent of `.../runs`, or `<root>/.scratch/expo-ios`. |
| `legacy/expo98/src/contracts/config.ts:4-57` | `src/main/index.ts:21` | Config, source, resolved config, environment, and resolve option types. |
| `analysis/expo98/BUSINESS_RULES.md:78-82` | `src/main/index.ts:118` | Redaction query/header/body key defaults. |

## Characterization Tests

`src/test/characterization.test.ts` covers:

- CLI/runtime constants
- parse global defaults and defensive-copy behavior
- state-root resolution with `cwd`, `root`, direct `stateDir`, and `.../runs` stateDir
- run-record and artifact directory resolution
- environment key names and default config shape
- default config resolution and defensive-copy behavior

## Deliberate Deviations

- `defaultConfig()` resolves `artifactDir` to an absolute path for a given project root. The type contract only says `artifactDir: string`, while runtime artifact paths are resolved against state roots.
- `resolveExpoStateRoot()` defaults to `"."` instead of reading `process.cwd()` directly. Callers pass `cwd` explicitly for deterministic behavior; existing transformed packages can keep process-bound wrappers at their outer boundary.
- File-based config discovery is not implemented in this slice because there is no equivalent central runtime behavior in legacy `dist`.

## Architecture Review

Local review found no high-severity issues. The package is pure except for Node path normalization and has no filesystem side effects.

Follow-up: replace duplicated `resolveExpoStateRoot` helpers across transformed packages with this package when package dependencies are consolidated.

## Representative Diff

Use this command from the modernization workspace:

```bash
diff -u <(sed -n '12780,12799p' legacy/expo98/dist/expo-ios.mjs) <(sed -n '93,140p' modernized/expo98/config-defaults/src/main/index.ts)
```
