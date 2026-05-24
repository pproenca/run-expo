# Transformation Notes: cli-help-surface

## Scope

Transformed the legacy static CLI help surface into a TypeScript package:

- version banner and usage line
- global flags
- discovery command help
- simulator and app action help
- evidence and runtime command help
- example command list
- `printHelp` writer boundary

This package does not parse argv, dispatch commands, or validate command availability. It only owns the help/usage catalog that legacy `printHelp()` wrote to stdout.

## Rule Coverage

| Rule | Coverage |
| --- | --- |
| Assessment command metadata duplication | Extracts help text from the bundled runtime into structured arrays that can later be generated or compared against aliases/spec. |
| RULE-007 | Preserves the global output-mode flags documented in the help surface. |
| RULE-014 | Preserves `--state-dir`, `--record`, and debug help lines for run-record operators. |
| RULE-021 | Preserves `--max-output` and `--content-boundaries` help lines for bounded/untrusted output. |

## Mapping

| Legacy source | Modern source | Behavior |
| --- | --- | --- |
| `legacy/expo98/dist/expo-ios.mjs:13093-13098` | `src/main/index.ts:183` | Version banner and usage line. |
| `legacy/expo98/dist/expo-ios.mjs:13099-13117` | `src/main/index.ts:3` | Global flag help lines. |
| `legacy/expo98/dist/expo-ios.mjs:13118-13133` | `src/main/index.ts:23` | Discovery command group. |
| `legacy/expo98/dist/expo-ios.mjs:13134-13153` | `src/main/index.ts:40` | Simulator and app action command group. |
| `legacy/expo98/dist/expo-ios.mjs:13154-13192` | `src/main/index.ts:61` | Evidence/runtime command group. |
| `legacy/expo98/dist/expo-ios.mjs:13193-13253` | `src/main/index.ts:101` | Example commands. |
| `legacy/expo98/dist/expo-ios.mjs:13256-13258` | `src/main/index.ts:207` | `printHelp` writes one complete help payload. |

## Characterization Tests

`src/test/characterization.test.ts` covers:

- version banner, usage line, section headers, and trailing newline
- injectable version while preserving the rest of the help body
- exact global flag lines
- command group counts and representative runtime-only command help lines
- absence of runtime-only server commands from visible help
- exact example count and ordering for representative examples
- `printHelp` writer behavior

## Deliberate Deviations

- The legacy template literal is represented as structured arrays plus a renderer. This preserves output while making duplication with aliases/spec visible to later modules.
- `cliHelpText(version)` supports explicit version injection. Legacy closed over `CLI_VERSION`; the default remains `0.1.0`.

## Architecture Review

Local review found no high-severity issues. The package is pure data plus formatting and has no filesystem, process, or terminal side effects except through an injected writer.

Follow-up: compare these command groups against `typed-contract-surface` and `command-dispatch-envelope` to identify help/alias drift.

## Representative Diff

Use this command from the modernization workspace:

```bash
diff -u <(sed -n '13093,13258p' legacy/expo98/dist/expo-ios.mjs) <(sed -n '183,208p' modernized/expo98/cli-help-surface/src/main/index.ts)
```
