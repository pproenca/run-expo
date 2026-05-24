# batch-orchestration transformation notes

## Scope

Transformed the legacy batch command orchestration into a TypeScript module under
`modernized/expo98/batch-orchestration`.

In scope:

- Batch step normalization and JSON argv parsing.
- Minimal CLI argument parsing needed by batch steps.
- Representative command-to-tool aliases and command argument mapping for
  session, target, snapshot, refs, get, find, wait, and batch.
- Serial batch execution, shared root/state directory behavior, forced quiet
  JSON step execution, optional bail, and stable success/failure envelopes.
- Batch step error classification, formatting, truncation, and redaction.

Out of scope:

- The full expo-ios command catalog. Only commands needed by current transformed
  slices and legacy batch coverage are included.
- Actual tool handlers. `runTool` is injected so the composition layer can wire
  transformed modules or adapters.
- Run recording and process-level CLI output. Those remain in the
  session/run-records and future CLI composition slices.

## Mapping

| Behavior | Legacy source | Modern source | Rule |
| --- | --- | --- | --- |
| Batch command serial execution and bail | `legacy/expo98/dist/expo-ios.mjs:2092` | `src/main/batch.ts:11` | RULE-023 |
| Batch step normalization and JSON parsing | `legacy/expo98/dist/expo-ios.mjs:2121`, `legacy/expo98/dist/expo-ios.mjs:12902` | `src/main/batch.ts:44`, `src/main/cli.ts:65` | RULE-023 |
| Per-step CLI parsing and global flags | `legacy/expo98/dist/expo-ios.mjs:12779` | `src/main/cli.ts:5` | RULE-023 |
| Command aliases | `legacy/expo98/dist/expo-ios.mjs:12071` | `src/main/command-map.ts:3` | RULE-023 |
| Batch step root/stateDir merging and silent tool execution | `legacy/expo98/dist/expo-ios.mjs:2134` | `src/main/batch.ts:57` | RULE-023 |
| Representative command argument mapping | `legacy/expo98/dist/expo-ios.mjs:12215` | `src/main/command-map.ts:18` | RULE-023 |
| Error classification and error code mapping | `legacy/expo98/dist/expo-ios.mjs:13073` | `src/main/errors.ts:18` | RULE-007 |
| Error formatting and truncation | `legacy/expo98/dist/expo-ios.mjs:12059` | `src/main/errors.ts:35` | RULE-021 |
| Tool JSON wrapping/unwrapping | `legacy/expo98/dist/expo-ios.mjs:797` | `src/main/tool-json.ts:3` | RULE-023 |

## Characterization

The characterization suite is in `src/test/characterization.test.ts`.

It pins concrete input/output behavior for:

- `CliUsageError` shape and exit code.
- `toolJson` and `unwrapToolJson`.
- Batch step normalization, JSON parse failures, and stringification.
- CLI parsing for globals, positional args, `--`, `--flag=value`, booleans, and
  numbers.
- Command aliases and representative `commandArgs` mappings.
- `runBatchStep` forced globals: `json: true`, `plain: false`, `quiet: true`,
  inherited root/stateDir, and silent tool execution.
- Serial batch execution, no-bail continuation, bail stopping, first
  `failureIndex`, and unknown command errors.
- Error formatting, truncation, and redaction.

## Deliberate Deviations

- Free-form `token=`, `password=`, `secret=`, and `authorization=` fragments in
  error text are redacted in addition to legacy URL-query redaction. This is a
  deliberate hardening aligned with the workspace security posture: batch
  aggregates arbitrary tool errors, so leaking free-form secrets in a later step
  would be higher risk than preserving the exact legacy string.
- The command alias table is intentionally scoped to commands this slice can
  validate and current transformed slices can use. The full CLI catalog should
  be expanded in the future CLI composition slice.

## Not Migrated

- Full CLI help, plain output rendering, and process exit handling.
- Run-record lifecycle wrapping around batch invocations.
- Non-representative command argument mappings for modules not yet transformed.

## Follow-Ups

- Expand `commandAliases` and `commandArgs` as additional modules are
  transformed.
- Compose this module with transformed session, target, snapshot, refs, and wait
  modules through a modern `runTool` registry.
- Add integration tests once the modern CLI entrypoint exists.

## Verification

```bash
cd modernized/expo98/batch-orchestration && npm test
```

Result: 21 tests passing.

## Architecture Review

The architecture-critic reported two HIGH findings, both fixed:

- `tap`, `fill`, and `scroll-into-view` now have representative `commandArgs`
  mappings before dispatch through batch.
- `runBatchStep` now redacts unwrapped tool payloads before adding them to batch
  step data, matching the legacy `runTool` redaction boundary.

Remaining MEDIUM follow-up:

- The command alias table is still intentionally scoped to transformed and
  representative commands, not the full legacy catalog.
