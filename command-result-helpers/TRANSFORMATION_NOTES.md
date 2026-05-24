# command-result-helpers Transformation Notes

## Scope

Transformed common command validation and result-formatting helpers from `legacy/expo98/dist/expo-ios.mjs` into a typed TypeScript module at `modernized/expo98/command-result-helpers`.

Business rule coverage:

- `RULE-021`: Large command stdout/stderr payloads are bounded with a truncation marker.
- `RULE-022`: Command arguments use consistent required-string and numeric-clamping validation.
- `RULE-024`: Optional probe sections return structured `{ ok, value/error }` envelopes instead of aborting the whole command.

## Mapping

| Legacy source | Target source | Behavior |
| --- | --- | --- |
| `legacy/expo98/dist/expo-ios.mjs:11994-11999` | `src/main/index.ts:5-11` | `safeToolSection` wraps successful values and catches failures into `{ ok: false, error: formatError(error) }`. |
| `legacy/expo98/dist/expo-ios.mjs:12036-12041` | `src/main/index.ts:13-18` | `requireString` trims non-empty strings and throws `<field> must be a non-empty string.` otherwise. |
| `legacy/expo98/dist/expo-ios.mjs:12043-12049` | `src/main/index.ts:20-27` | `clampNumber` coerces finite numbers and clamps to inclusive min/max bounds. |
| `legacy/expo98/dist/expo-ios.mjs:12051-12055` | `src/main/index.ts:29-33` | `truncate` stringifies nullish values to `""` and appends `[truncated N characters]` after `MAX_OUTPUT`. |
| `legacy/expo98/dist/expo-ios.mjs:12057-12064` | `src/main/index.ts:35-43` | `formatError` handles missing errors, primitive values, message values, and stdout/stderr sections. |

## Characterization Tests

Tests live in `src/test/characterization.test.ts` and cover:

- `safeToolSection` success and formatted failure envelopes.
- Required string trimming and legacy validation errors.
- Numeric coercion, clamping, and non-finite errors.
- Nullish and long-output truncation behavior.
- Error formatting across primitive, message, stdout, stderr, and truncation cases.

Current verification:

```bash
cd modernized/expo98/command-result-helpers && npm test
```

## Deliberate Deviations

- Exported helpers as named functions so packages with duplicated local copies can converge on one shared implementation later.

## Not Migrated

- Subprocess execution helpers are covered by `command-runner-adapter`.
- Optional-string and timeout helpers are covered by `shared-runtime-helpers`.

## Follow-Ups

- Replace duplicated local `requireString`, `clampNumber`, `truncate`, `formatError`, and `safeToolSection` implementations when shared package wiring is added.

## Architecture Review

Self-review findings:

- High: preserve exact validation messages because tests and callers use them as command-facing errors.
- Medium: preserve the `MAX_OUTPUT` value for this helper cluster even though some command packages intentionally use larger domain-specific limits.

Applied fixes:

- Added characterization tests for truncation through both direct `truncate` and nested `formatError` paths.
