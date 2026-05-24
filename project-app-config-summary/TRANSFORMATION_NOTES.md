# project-app-config-summary Transformation Notes

## Scope

Transformed Expo app config summary projection from `legacy/expo98/dist/expo-ios.mjs` into a typed TypeScript module at `modernized/expo98/project-app-config-summary`.

Business rule coverage:

- `RULE-024`: Project info reports static app config metadata without executing dynamic config files.

## Mapping

| Legacy source | Target source | Behavior |
| --- | --- | --- |
| `legacy/expo98/dist/expo-ios.mjs:1186-1199` | `src/main/index.ts:13-27` | `projectInfoAppConfigSummary` emits basename source, known config fields with null defaults, optional `userInterfaceStyle`, and exact-true `dynamic`. |
| `legacy/expo98/dist/expo-ios.mjs:8104-8117` equivalent static extraction helpers | `src/main/index.ts:29-35` | Static app config regex helpers extract simple quoted or template-literal values without executing config code. |

## Characterization Tests

Tests live in `src/test/characterization.test.ts` and cover:

- Field projection and null defaults.
- Basename source projection.
- Optional `userInterfaceStyle`.
- Exact-true `dynamic` behavior.
- Single/double/template quote regex extraction.

Current verification:

```bash
cd modernized/expo98/project-app-config-summary && npm test
```

## Deliberate Deviations

- This package only owns pure projection and regex extraction. Filesystem discovery remains in `project-info-doctor` and `project-filesystem-helpers`.

## Not Migrated

- `app.json` file reading and `app.config.*` selection.
- Dynamic Expo config execution, which the legacy code intentionally does not do.

## Follow-Ups

- Replace the embedded helpers in `project-info-doctor` when shared package dependencies are consolidated.

## Architecture Review

Self-review findings:

- High: preserve static regex extraction to avoid executing arbitrary config code during project info reads.
- Medium: preserve null defaults so the project-info payload shape remains stable.

Applied fixes:

- Added tests for optional-field inclusion rules and quote variants.
