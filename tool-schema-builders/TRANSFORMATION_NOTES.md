# Transformation Notes: tool-schema-builders

## Scope

Transformed the legacy helper layer below the tool catalog:

- `stringSchema`
- `numberSchema`
- `booleanSchema`
- `enumSchema`
- `objectSchema`
- `toolText`
- `toolJson`
- `unwrapToolJson`

This package intentionally does not include the full `tools` catalog. It provides the canonical builders that the catalog and command modules can share as the monolith is split further.

## Rule Coverage

| Rule | Coverage |
| --- | --- |
| Assessment command metadata duplication | Extracts the shared schema/result helper layer used by the bundled tool catalog. |
| RULE-002 | Preserves tool JSON wrapping/unwrapping used before output redaction in dispatch modules. |
| RULE-007 | Preserves machine-readable tool result shapes used by command output envelopes. |

## Mapping

| Legacy source | Modern source | Behavior |
| --- | --- | --- |
| `legacy/expo98/dist/expo-ios.mjs:772-774` | `src/main/index.ts:42` | String schema helper. |
| `legacy/expo98/dist/expo-ios.mjs:776-778` | `src/main/index.ts:46` | Number schema helper with spread extras. |
| `legacy/expo98/dist/expo-ios.mjs:780-782` | `src/main/index.ts:50` | Boolean schema helper. |
| `legacy/expo98/dist/expo-ios.mjs:784-786` | `src/main/index.ts:54` | Enum schema helper. |
| `legacy/expo98/dist/expo-ios.mjs:788-795` | `src/main/index.ts:58` | Object schema helper with default required array and `additionalProperties: false`. |
| `legacy/expo98/dist/expo-ios.mjs:797-803` | `src/main/index.ts:70` | Tool text and pretty JSON result wrappers. |
| `legacy/expo98/dist/expo-ios.mjs:805-813` | `src/main/index.ts:78` | Tool result JSON unwrapping and text fallback. |

## Characterization Tests

`src/test/characterization.test.ts` covers:

- primitive schema shapes
- `numberSchema` extra-field override behavior from object spread
- enum and object schemas, including required/default behavior and property reference preservation
- `toolText` and `toolJson` text envelope shapes
- `unwrapToolJson` JSON parsing, text fallback, non-text passthrough, and null passthrough

## Deliberate Deviations

- The modern code adds TypeScript interfaces for schema/result shapes. Runtime output remains equivalent to legacy helper output.
- `NumberSchema.type` is typed as `string` because legacy object spread allows an `extra.type` override.

## Architecture Review

Local review found no high-severity issues. The module is pure, deterministic, and side-effect free.

Follow-up: migrate duplicated local `toolJson`/`unwrapToolJson` helpers in existing transformed packages to this package when a package-composition layer is introduced.

## Representative Diff

Use this command from the modernization workspace:

```bash
diff -u <(sed -n '772,813p' legacy/expo98/dist/expo-ios.mjs) <(sed -n '42,86p' modernized/expo98/tool-schema-builders/src/main/index.ts)
```
