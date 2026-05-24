# Transformation Notes: command-dispatch-envelope

## Scope

Transformed the shell-facing command dispatch envelope from the legacy bundled CLI into an injectable TypeScript module:

- runtime command alias lookup
- parsed-command dispatch and run-record finish hooks
- handler invocation and tool JSON unwrapping
- payload redaction before output/record summaries
- JSON, plain, default JSON, quiet, and content-boundary output
- output truncation with the legacy suffix
- sanitized error envelopes and invalid-usage classification

This package intentionally does not duplicate `parseCliArgs` or the full per-command argument projection already transformed in `batch-orchestration`; dispatch accepts a `projectArgs` dependency for that boundary.

## Rule Coverage

| Rule | Coverage |
| --- | --- |
| CLI command alias dispatch | Preserves the 79 runtime command aliases and unknown-command usage error. |
| Run-record lifecycle | Starts a record after argument projection, finishes completed/failed records, and emits debug record paths. |
| Tool output envelope | Preserves tool JSON unwrapping, secret redaction, JSON/plain/default output, quiet handling, content boundaries, and max-output truncation. |
| Error envelope | Preserves JSON/default error envelope, plain errors, quiet behavior, debug error names, and invalid-usage exit-code mapping. |

## Mapping

| Legacy source | Modern source | Behavior |
| --- | --- | --- |
| `legacy/expo98/dist/expo-ios.mjs:12071-12150` | `src/main/index.ts:61` | Runtime command alias table. |
| `legacy/expo98/dist/expo-ios.mjs:12164-12203` | `src/main/index.ts:147` | Parsed-command dispatch, output-mode validation, version/help exits, run-record finish hooks, debug run-record path. |
| `legacy/expo98/dist/expo-ios.mjs:12205-12213` | `src/main/index.ts:198` | Handler lookup, tool JSON unwrapping, redaction, output write. |
| `legacy/expo98/dist/expo-ios.mjs:12918-12931` | `src/main/index.ts:236` | JSON/plain/default payload formatting and content boundaries. |
| `legacy/expo98/dist/expo-ios.mjs:12934-12940` | `src/main/index.ts:253` | `--max-output` truncation. |
| `legacy/expo98/dist/expo-ios.mjs:12942-12960` | `src/main/index.ts:265` | Sanitized CLI error envelopes. |
| `legacy/expo98/dist/expo-ios.mjs:12963-12994` | `src/main/index.ts:295` | Plain output special cases. |
| `legacy/expo98/dist/expo-ios.mjs:12045-12050` | `src/main/index.ts:395` | Finite-number clamp used by output bounding. |

## Characterization Tests

`src/test/characterization.test.ts` covers:

- alias exposure for key commands and unknown-command rejection
- successful dispatch through argument projection, tool alias lookup, run-record completion, redaction, and debug stderr
- failed dispatch and invalid-usage run-record exit code
- JSON, default JSON, quiet, and content-boundary payload output
- plain output for `doctor`, `routes`, `review-next`, and unavailable payloads
- `--max-output` truncation suffix behavior
- tool JSON unwrapping, secret redaction, missing-tool errors
- JSON/default, plain, debug, and quiet error envelopes

## Deliberate Deviations

- `dispatchCommand` accepts parsed argv and injectable dependencies instead of reading process globals directly. This keeps parsing, argument projection, handlers, IO, and run-record persistence independently testable while preserving the legacy observable envelope.
- The dispatcher exposes `projectArgs` as a dependency rather than copying the entire legacy `commandArgs` switch. The already-modernized `command-arg-projection` package owns the complete projection behavior, and `cli-runtime-composition` now models the composition boundary between them.

## Architecture Review

Local review found no high-severity issues. The module is deterministic, dependency-injected, and keeps side effects at the boundary through supplied `stdout`, `stderr`, handlers, and recorders.

Follow-up: when the final executable wrapper is assembled, consume the command
alias table from a shared contract package to avoid drift between
`typed-contract-surface` and this dispatcher.

## Representative Diff

Use this command from the modernization workspace:

```bash
diff -u <(sed -n '12164,12213p' legacy/expo98/dist/expo-ios.mjs) <(sed -n '147,217p' modernized/expo98/command-dispatch-envelope/src/main/index.ts)
```
