# CLI Argv Parser Transformation Notes

## Scope

This module modernizes the raw CLI parser from `legacy/expo98/dist/expo-ios.mjs`
into a standalone reusable package.

| Legacy source | Modern source | Behavior |
| --- | --- | --- |
| `dist/expo-ios.mjs:12779-12856` | `src/main/index.ts` `parseCliArgs` | Parses global flags, command name, command-local flags, positional args, and `--` passthrough. |
| `dist/expo-ios.mjs:12858-12883` | `src/main/index.ts` `normalizeGlobalFlag`, `globalFlagTakesValue` | Preserves global flag names and value-bearing flag set. |
| `dist/expo-ios.mjs:12885-12889` | `src/main/index.ts` `coerceCliValue` | Coerces exact `true`/`false` and decimal numeric strings for command-local options. |
| `dist/expo-ios.mjs:12891-12897` | `src/main/index.ts` `parseJsonArgument` | Parses JSON step values and reports `flag must be valid JSON: ...`. |
| `dist/expo-ios.mjs:12899-12905` | `src/main/index.ts` `pickDefined`, `toCamel` | Filters only `undefined` values and converts dash-case command flags to camelCase. |

## Deliberate Deviations

- The parser is exposed independently from batch execution and process dispatch.
  The legacy parser was bundled inside the CLI entrypoint; this split lets the
  final modernized facade compose `cli-argv-parser`, `command-arg-projection`,
  and `command-dispatch-envelope`.
- `normalizeGlobalFlag`, `globalFlagTakesValue`, `defaultGlobals`, and
  `toCamel` are exported for focused equivalence tests. Legacy kept these as
  local helpers.

## Not Migrated

- Command-specific argument projection belongs to `command-arg-projection`.
- Handler invocation, output rendering, and run-record lifecycle belong to
  `command-dispatch-envelope`.
- Batch JSON step orchestration belongs to `batch-orchestration`.

## Proof

Characterization tests cover default globals, boolean and value-bearing global
flags, usage errors, command-local value coercion, `--` passthrough, help/version
flags, JSON parse errors, camelization, and undefined filtering.

## Follow-ups

- Wire this package into the final modernized CLI facade so the existing
  `batch-orchestration` local parser can be replaced by this shared parser.

