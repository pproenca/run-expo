# static-expo-config-reader Transformation Notes

## Scope

Transformed static Expo config reading from `legacy/expo98/dist/expo-ios.mjs` into a typed TypeScript module at `modernized/expo98/static-expo-config-reader`.

Business rule coverage:

- `RULE-024`: Project introspection reads local config files without executing dynamic app config code.

## Mapping

| Legacy source | Target source | Behavior |
| --- | --- | --- |
| `legacy/expo98/dist/expo-ios.mjs:9685-9701` | `src/main/index.ts:15-32` | `app.json` is preferred, accepts either `expo` wrapper or bare root config, and extracts app identifiers plus EAS project id. |
| `legacy/expo98/dist/expo-ios.mjs:9703-9717` | `src/main/index.ts:34-48` | Falls back to first `app.config.ts/js/mjs/cjs`, extracts simple static values with regex, and marks the result as dynamic. |
| `legacy/expo98/dist/expo-ios.mjs:9719-9724` | `src/main/index.ts:64-70` | Regex helpers extract quoted or template-literal values by key without evaluating JavaScript. |
| `legacy/expo98/dist/expo-ios.mjs:11865-11871` | `src/main/index.ts:50-56` | `firstExisting` returns the first existing config candidate in order. |

## Characterization Tests

Tests live in `src/test/characterization.test.ts` and cover:

- `app.json` precedence over `app.config.*`.
- Wrapped and bare app JSON forms.
- Null defaults for missing config fields.
- `app.config.*` priority, static extraction, and `dynamic: true`.
- No-config null result and invalid JSON propagation.
- First-existing candidate order and regex helper behavior.

Current verification:

```bash
cd modernized/expo98/static-expo-config-reader && npm test
```

## Deliberate Deviations

- The package focuses on reading config summaries only. Projection into the project-info payload remains in `project-app-config-summary`.

## Not Migrated

- Dynamic config execution. The legacy code uses static string extraction and this transform preserves that behavior.
- Package dependency and upstream policy analysis.

## Follow-Ups

- Replace the embedded reader in `project-info-doctor` when shared package dependencies are consolidated.

## Architecture Review

Self-review findings:

- High: preserve `app.json` precedence because static JSON should beat dynamic config candidates.
- Medium: preserve non-execution of `app.config.*` files to avoid side effects during read-only project info.

Applied fixes:

- Added tests for precedence, priority, null defaults, and invalid JSON.
