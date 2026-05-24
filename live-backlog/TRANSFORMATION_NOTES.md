# live-backlog Transformation Notes

## Scope

Transformed live backlog matrix, execution, and classification behavior from
`legacy/expo98/dist/expo-ios.mjs` into a typed TypeScript module at
`modernized/expo98/live-backlog`.

Business rule coverage:

- `RULE-036`: live-backlog validation classifies captured command rows as
  `live-pass`, `static-pass`, `environment-blocked`, `designed-unavailable`,
  `expected-usage-error`, or `defect` from exit code, parsed payload, and row
  requirements.
- `RULE-014`: row execution captures stdout, stderr, exit code, and run-record
  artifact paths.
- `RULE-021`: row summaries keep payload summaries bounded to top-level keys
  rather than embedding full captured outputs in the report.

## Mapping

| Legacy source | Target source | Behavior |
| --- | --- | --- |
| `legacy/expo98/dist/expo-ios.mjs:8929-8972` | `src/main/index.ts:134-181` | `liveBacklogCommand` validates action, builds matrix/self-check payloads, runs rows, writes the report, and returns tool JSON. |
| `legacy/expo98/dist/expo-ios.mjs:8974-8979` | `src/main/index.ts:123-128` | Mutating command list used to flag runtime-manipulating rows. |
| `legacy/expo98/dist/expo-ios.mjs:8981-9033` | `src/main/index.ts:183-235` | Matrix construction, smoke/full row selection, terminal action ordering, row metadata, captures, and expected class derivation. |
| `legacy/expo98/dist/expo-ios.mjs:9035-9123` | `src/main/index.ts:237-325` | Per-command row templates, placeholders, requirements, setup files, and expected usage rows. |
| `legacy/expo98/dist/expo-ios.mjs:9125-9146` | `src/main/index.ts:327-348` | Requirement inference and help command parsing. |
| `legacy/expo98/dist/expo-ios.mjs:9148-9171` | `src/main/index.ts:350-372` | Self-check issue detection and hidden preflight policy statement. |
| `legacy/expo98/dist/expo-ios.mjs:9173-9245` | `src/main/index.ts:374-453` | Row execution, placeholder materialization, evidence artifact writes, action policy/app fixture creation, and run-record path discovery. |
| `legacy/expo98/dist/expo-ios.mjs:9247-9327` | `src/main/index.ts:455-535` | JSON parsing, `RULE-036` row classification, live-runtime evidence detection, payload summaries, JSON artifact listing, and report summary counts. |

## Characterization Tests

Tests live in `src/test/characterization.test.ts` and cover:

- smoke matrix generation from 79 dispatcher aliases and help command names.
- full matrix ordering with `terminate-app` last.
- row templates and requirements for runtime and expected-usage commands.
- help parser section boundaries.
- placeholder materialization for cwd, Metro, device, policy, row, output, and
  app-path tokens.
- `RULE-036` classification for static pass, live pass, environment blocked,
  expected usage, and defect rows.
- payload parsing/summarization and report summary counts.
- `matrix`, `self-check`, and `run` command tool JSON payloads.
- live runtime evidence detection by Metro, Hermes, Metro message, and app
  bridge requirements.

Current verification:

```bash
cd modernized/expo98/live-backlog && npm test
```

Result: 9 tests passing.

## Deliberate Deviations

- Process execution, file writes, directory reads, current time, executable
  path, and CLI wrapper path are injected dependencies. The legacy bundle used
  direct process/filesystem calls; injection keeps row execution deterministic
  and ready for final CLI composition.
- `cliHelpText` is represented as a generated command-section string from the
  modernized command alias table. The parser behavior is characterized
  separately; final CLI integration should pass the real facade help text.
- The command supports positional action fallback for future CLI routing while
  preserving the named-action behavior from the legacy source.

## Not Migrated

- Starting Metro, launching apps, connecting dev clients, or satisfying live
  runtime requirements outside row execution remains intentionally out of
  scope, matching the legacy command limitations.
- Final CLI router wiring is deferred until command modules are transformed.

## Follow-Ups

- Wire `liveBacklogCommand` into the final modernized CLI router.
- Pass the final CLI facade help text into matrix generation if command help is
  no longer generated from the same alias table.
