# Expo Introspection Actions Transformation Notes

## Scope

This module modernizes the Expo introspection command slice from
`legacy/expo98/dist/expo-ios.mjs`.

| Legacy source | Modern source | Behavior |
| --- | --- | --- |
| `dist/expo-ios.mjs:7974-8043` | `src/main/index.ts` `expoCommand` | Dispatches `modules`, `config`, `doctor`, `upstream-policy`, and `prebuild-plan` actions with the legacy JSON text envelope. |
| `dist/expo-ios.mjs:8045-8057` | `src/main/index.ts` `expoModuleRecords` | Reads nearest `package.json`, merges dependencies and devDependencies, filters Expo-related packages, sorts by name, and assigns categories. |
| `dist/expo-ios.mjs:8059-8071` | `src/main/index.ts` `isExpoRelatedPackage`, `expoModuleCategory` | Preserves the exact legacy prefix and `config-plugin` substring classification. |
| `dist/expo-ios.mjs:8073-8102` | `src/main/index.ts` `expoPrebuildRisks`, `expoPrebuildRiskLevel` | Reports native project, config-plugin dependency, and app-config plugin risks in legacy order. |
| `dist/expo-ios.mjs:8104-8117` | `src/main/index.ts` `readExpoAppConfigPlugins` | Reads `app.json` plugin arrays or conservatively extracts quoted plugin names from dynamic app config files. |
| `dist/expo-ios.mjs:8119-8123` | `src/main/index.ts` `formatExpoPluginEntry` | Formats string, tuple, empty tuple, and object plugin entries the same way as legacy code. |
| `dist/expo-ios.mjs:8125-8129` | `src/main/index.ts` `expoConfigLimitations` | Returns the dynamic-vs-static Expo config limitation messages verbatim. |

## Deliberate Deviations

- Filesystem access, path resolution, project summaries, doctor output, and
  project-info output are dependency-injected. The legacy command used ambient
  module-level helpers directly; injection keeps the transformed package
  testable and avoids writes or reads through `legacy/expo98`.
- `expoPrebuildRiskLevel` is exported as a named helper. The legacy code
  computed this inline inside `expoCommand`; the behavior is unchanged and is
  covered independently in tests.

## Not Migrated

- `expoProjectRuntimeSummary`, `doctor`, `projectInfo`, and
  `buildUpstreamDependencyReport` are upstream dependencies of this command
  slice. Existing transformed packages already cover those concerns, so this
  module accepts them as injected dependencies instead of duplicating them.

## Proof

Characterization tests in `src/test/characterization.test.ts` cover:

- default and invalid action handling
- JSON tool envelope behavior
- dependency filtering, sorting, and module categorization
- app config plugin extraction from `app.json` and dynamic config text
- prebuild risk ordering and risk-level calculation
- command payloads for `config`, `modules`, `prebuild-plan`, `doctor`, and
  `upstream-policy`

## Follow-ups

- Wire this package into a future modernized command-dispatch composition layer
  once all command actions have transformed equivalents.

