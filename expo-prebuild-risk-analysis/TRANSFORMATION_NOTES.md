# Expo Prebuild Risk Analysis Transformation Notes

## Scope

This module modernizes the Expo module discovery and prebuild risk helper slice
from `legacy/expo98/dist/expo-ios.mjs`.

| Legacy source | Modern source | Behavior |
| --- | --- | --- |
| `dist/expo-ios.mjs:8045-8057` | `src/main/index.ts` `expoModuleRecords` | Reads the nearest `package.json`, merges dependencies and devDependencies, filters Expo-related packages, sorts by package name, and assigns categories. |
| `dist/expo-ios.mjs:8059-8071` | `src/main/index.ts` `isExpoRelatedPackage`, `expoModuleCategory` | Preserves the exact legacy `expo`, `expo-*`, `@expo/*`, `@config-plugins/*`, and `config-plugin` substring checks. |
| `dist/expo-ios.mjs:8073-8102` | `src/main/index.ts` `expoPrebuildRisks`, `expoPrebuildRiskLevel` | Reports native project, config-plugin dependency, and app config plugin risks in legacy order with legacy messages. |
| `dist/expo-ios.mjs:8104-8117` | `src/main/index.ts` `readExpoAppConfigPlugins` | Reads plugin arrays from `app.json` or conservatively extracts quoted plugin names from dynamic app config files. |
| `dist/expo-ios.mjs:8119-8123` | `src/main/index.ts` `formatExpoPluginEntry` | Formats string, tuple, empty tuple, and object plugin entries like the legacy code. |
| `dist/expo-ios.mjs:8125-8129` | `src/main/index.ts` `expoConfigLimitations` | Returns the dynamic-vs-static Expo config limitation messages verbatim. |
| `dist/expo-ios.mjs:11835-11841`, `11846-11871` | `src/main/index.ts` `findUp`, `readJsonFile`, `firstExisting`, `pathExists` | Preserves nearest-file lookup, JSON parse propagation, and first-existing file priority helpers used by this slice. |

## Deliberate Deviations

- Filesystem helpers are exported and also exposed as dependency interfaces.
  The legacy implementation used ambient helpers directly; the modern module
  keeps default filesystem behavior while allowing isolated characterization
  tests and future composition.
- `expoPrebuildRiskLevel` is exported as a named helper. The legacy command
  computed this inline before returning the `prebuild-plan` payload; the rule is
  unchanged.

## Not Migrated

- The outer `expoCommand` action dispatcher remains in
  `expo-introspection-actions`. This package only extracts the reusable
  analysis helpers needed by that command.

## Proof

Characterization tests in `src/test/characterization.test.ts` cover:

- nearest `package.json` lookup, dependency merge precedence, Expo filtering,
  sorting, and package categorization
- `app.json` plugin precedence and dynamic `app.config.*` regex extraction
- string, tuple, empty tuple, and object plugin entry formatting
- native project, config-plugin dependency, and app config plugin risk ordering
- high, medium, and low risk-level derivation
- dynamic and static config limitation messages
- helper behavior for first-existing file lookup and invalid JSON propagation

## Follow-ups

- Rewire `expo-introspection-actions` to import this package once the workspace
  has a package-level dependency strategy for modernized modules.
