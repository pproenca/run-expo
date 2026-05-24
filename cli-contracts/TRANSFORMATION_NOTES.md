# cli-contracts Transformation Notes

## Scope

This slice modernizes the legacy CLI scaffold in `legacy/expo98/src/cli/` into
`modernized/expo98/cli-contracts/`.

## Mapping

| Legacy source | Modern target | Behavior |
| --- | --- | --- |
| `legacy/expo98/src/cli/interfaces.ts:8-13` | `src/main/index.ts:3`, `src/main/index.ts:75-80`, `src/main/index.ts:114-126` | Preserves `ParsedCli` fields and adds defensive construction for raw args and parsed args. |
| `legacy/expo98/src/cli/interfaces.ts:15-17` | `src/main/index.ts:1`, `src/main/index.ts:82-84` | Preserves the parser contract. |
| `legacy/expo98/src/cli/interfaces.ts:19-26` | `src/main/index.ts:1`, `src/main/index.ts:86-97` | Preserves success/failure output writer signatures. |
| `legacy/expo98/src/cli/interfaces.ts:28-31` | `src/main/index.ts:1`, `src/main/index.ts:99-154` | Preserves runtime context creation and execution contract; adds a dependency-injected implementation. |
| `legacy/expo98/src/contracts/commands.ts:127-139` | `src/main/index.ts:5-17`, `src/main/index.ts:29-41` | Preserves global option keys needed by parsed CLI records. |
| `legacy/expo98/src/cli/index.ts:1` | `src/main/index.ts:1-176` | Replaces re-export-only CLI index with a single package entry point. |
| `legacy/expo98/src/index.ts:1-5` | Package-level composition note | Top-level legacy package re-export is now represented by separate modernized packages instead of one umbrella index. |

## Deliberate Deviations

- The legacy `src/cli` module was type-only. The modern package adds small
  runtime helpers so downstream tests can compose a parser, dispatcher, context
  creator, and output writer without importing the bundled CLI.
- Full CLI argument parsing is intentionally not reimplemented here; the
  `command-arg-projection`, `command-dispatch-envelope`, `cli-help-surface`, and
  config packages own the executable CLI behavior extracted from `dist`.
- `CommandContext` keeps the legacy `cwd` and `globals` fields and permits
  additional subsystem fields through an index signature because session,
  target, policy, and artifact stores are composed by other packages.

## Not Migrated

- No process entrypoint, shebang, command alias table, help text, or output
  formatting implementation is included in this slice.
- No command handlers are imported or invoked directly; dispatch is injected.

## Review Notes

- Architecture review was performed locally. No high-severity issues were
  found; the package is deterministic and side-effect free.
- Future CLI facade work can use `createCliRuntime` as the thin composition
  boundary around the already transformed dispatch and argument projection
  packages.

