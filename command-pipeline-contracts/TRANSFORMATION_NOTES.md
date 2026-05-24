# command-pipeline-contracts Transformation Notes

## Scope

This slice modernizes the legacy command facade and pipeline scaffold from
`legacy/expo98/src/commands/` into runtime-checkable TypeScript in
`modernized/expo98/command-pipeline-contracts/`.

## Mapping

| Legacy source | Modern target | Behavior |
| --- | --- | --- |
| `legacy/expo98/src/commands/interfaces.ts:7-16` | `src/main/index.ts:1-25` | Preserves the command family vocabulary and exposes it as both runtime data and a TypeScript union. |
| `legacy/expo98/src/commands/interfaces.ts:18-37` | `src/main/index.ts:76-153` | Preserves `CommandModule`, `CommandRegistry`, `CommandFacade`, and `CommandFactory`; adds an in-memory registry implementation for deterministic module lookup and registration. |
| `legacy/expo98/src/commands/pipeline.ts:9-24` | `src/main/index.ts:97-113` | Preserves invocation, next-function, and middleware contracts. |
| `legacy/expo98/src/commands/pipeline.ts:27-33` | `src/main/index.ts:115-195` | Preserves pipeline `use` and `build` concepts; implements middleware composition around a command handler. |
| `legacy/expo98/src/commands/pipeline.ts:35-43` | `src/main/index.ts:13-25` | Preserves built-in middleware names and exposes them as runtime data and a TypeScript union. |
| `legacy/expo98/src/commands/index.ts:1-2` | `src/main/index.ts:1-227` | Replaces re-export-only scaffold with a single package entry point. |
| `legacy/expo98/src/contracts/commands.ts:104-125` | `src/main/index.ts:54-74` | Preserves the command definition, handler, and context shape needed by the command facade. |
| `legacy/expo98/src/contracts/primitives.ts:47-55` | `src/main/index.ts:36-52` | Preserves command outcome and warning shapes. |

## Deliberate Deviations

- The legacy module was type-only. The modern package exposes runtime constants,
  a registry implementation, outcome helpers, and a pipeline builder so consumers
  can validate behavior without importing the legacy source.
- Duplicate command registration is specified here as replacement by command
  name while retaining the original insertion position. The legacy interface did
  not define duplicate behavior; deterministic replacement keeps registry output
  stable for callers.
- `CommandDefinition` omits the legacy `createHandler` factory requirement. This
  package models command contracts and pipeline execution; concrete command
  factories remain the responsibility of command modules.
- `CommandContext` keeps strongly named top-level fields from the legacy
  contract, but uses `unknown`/record types for subsystem-specific payloads to
  avoid importing non-migrated session, policy, target, and artifact modules.

## Not Migrated

- No concrete expo98 command handlers were migrated in this slice.
- No built-in middleware implementations were migrated here; this package only
  preserves their names and composition contract.

## Review Notes

- Architecture review was performed locally against the transformed TypeScript
  surface. No high-severity issues were found.
- Follow-up modules can depend on `createCommandPipeline`,
  `InMemoryCommandRegistry`, and the `CommandOutcome` helpers instead of
  recreating command scaffold types.

