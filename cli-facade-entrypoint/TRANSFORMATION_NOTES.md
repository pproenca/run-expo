# CLI Facade Entrypoint Transformation Notes

## Scope

This module modernizes the process-level CLI entrypoint from
`legacy/expo98/dist/expo-ios.mjs`.

| Legacy source | Modern source | Behavior |
| --- | --- | --- |
| `dist/expo-ios.mjs:12152-12203` | `src/main/index.ts` `createCliFacade().main` | Parses argv, stores `lastCliOptions`, and delegates parsed command execution to dispatch. |
| `dist/expo-ios.mjs:13251-13257` | `src/main/index.ts` `createCliFacade().run` | Catches process-level errors, writes the CLI error envelope using the last known options, and returns the classified exit code. |
| `dist/expo-ios.mjs:12152-12161` | `src/main/index.ts` `defaultLastCliOptions` | Preserves the legacy fallback options used when parsing fails before globals are available. |

## Deliberate Deviations

- The modern facade is injectable and returns an exit code from `run(argv)`
  instead of mutating `process.exitCode` directly. A final executable wrapper can
  assign that returned code to `process.exitCode`.
- `main(argv)` delegates validation, version/help handling, run records, output
  rendering, and command execution to an injected dispatcher. Those behaviors
  are already transformed in `command-dispatch-envelope`.
- `run(argv)` models the legacy process `.catch(...)` boundary in a testable
  function. This preserves the observable error option behavior without requiring
  tests to patch global process streams.

## Not Migrated

- Raw argv parsing belongs to `cli-argv-parser`.
- Command argument projection belongs to `command-arg-projection`.
- Runtime command dispatch and output/error envelope formatting belong to
  `command-dispatch-envelope`.
- Tool handler binding belongs to `tool-handler-registry` and future composition
  code.

## Proof

Characterization tests cover:

- parser-to-dispatch delegation
- updating `lastCliOptions` from parsed globals
- successful process-level exit code returns
- command dispatch failures written with parsed options
- parser failures written with prior or default options
- `main(argv)` preserving thrown errors for process-level callers

## Follow-ups

- `cli-runtime-composition` now provides the injectable composition boundary
  that wires `cli-argv-parser`, `command-arg-projection`,
  `command-dispatch-envelope`, and transformed tool handlers into this facade.
  `cli-executable-wrapper` now provides the process-globals tail; final
  integration still needs to provide concrete command-domain implementations.
