# command-args-contracts Transformation Notes

## Scope

This slice modernizes the type-only command argument surface from
`legacy/expo98/src/contracts/args.ts` into
`modernized/expo98/command-args-contracts/`.

## Mapping

| Legacy source | Modern target | Behavior |
| --- | --- | --- |
| `legacy/expo98/src/contracts/args.ts:392-469` | `src/main/index.ts:1-78`, `src/main/index.ts:218-282` | Preserves `CommandArgsByName` command ordering and command-to-argument-type mapping as runtime data. |
| `legacy/expo98/src/contracts/args.ts:59-64` | `src/main/index.ts:141-142`, `src/main/index.ts:229-233` | Preserves app lifecycle action vocabulary and associated command mappings. |
| `legacy/expo98/src/contracts/args.ts:83-105` | `src/main/index.ts:143`, `src/main/index.ts:237` | Preserves gesture kinds. |
| `legacy/expo98/src/contracts/args.ts:123-137` | `src/main/index.ts:144-145`, `src/main/index.ts:240-241` | Preserves inspector and trace action vocabularies. |
| `legacy/expo98/src/contracts/args.ts:151-189` | `src/main/index.ts:110-127`, `src/main/index.ts:146-149`, `src/main/index.ts:243-247` | Preserves review overlay actions, review-next surface/stage values, review actions, session actions, and target actions. |
| `legacy/expo98/src/contracts/args.ts:207-239` | `src/main/index.ts:80-108`, `src/main/index.ts:150-167`, `src/main/index.ts:236`, `src/main/index.ts:250-252` | Preserves ref fields, find kinds, ref-action vocabularies, positional ref-action command names, and wait kinds. |
| `legacy/expo98/src/contracts/args.ts:258-282` | `src/main/index.ts:168-190`, `src/main/index.ts:254-260` | Preserves DevTools, perf, skills, and clipboard action vocabularies. |
| `legacy/expo98/src/contracts/args.ts:284-323` | `src/main/index.ts:129-139`, `src/main/index.ts:191-195`, `src/main/index.ts:261-266` | Preserves environment categories and network/navigation/storage/state/control actions. |
| `legacy/expo98/src/contracts/args.ts:325-390` | `src/main/index.ts:196-207`, `src/main/index.ts:267-281` | Preserves bridge, RN, Expo, diff, record, accessibility, dialog, sheet, dashboard, profiler, instrumentation, and policy actions. |
| Type-only command arg map | `src/main/index.ts:284-305` | Adds defensive list, lookup, and action-support helpers for runtime composition. |

## Deliberate Deviations

- The legacy file was purely a TypeScript type map. The modern package exposes
  the contract as runtime constants so dispatch, help generation, and validation
  slices can reconcile supported actions without compiler introspection.
- This package stores argument type names and action vocabularies, not complete
  JSON schemas. Field-level validation remains with command-specific transforms
  and the dispatch/schema layers.
- `redact` is represented as the `PolicyArgs` `redact` action, matching the
  legacy `Extract<PolicyArgs, { action: "redact" }>` mapping.

## Not Migrated

- No CLI argument parser or command argument projector is implemented here.
  Runtime projection is already represented by `command-arg-projection`.
- No command execution behavior is included in this slice.

## Review Notes

- Architecture review was performed locally. No high-severity issues were
  found; the module is deterministic and side-effect free.
- Future command schema generation can use `COMMAND_ARG_CONTRACTS` as the
  source-cited checklist for command/action coverage.

