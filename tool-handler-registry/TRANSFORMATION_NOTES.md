# Transformation Notes: tool-handler-registry

## Scope

Transformed the legacy runtime `handlers` object into an injectable TypeScript registry:

- ordered tool-name to implementation-symbol bindings
- tool-name and handler-symbol list helpers
- lookup from tool name to implementation symbol
- reverse lookup from implementation symbol to tool names
- implementation-symbol to transformed package/export source mapping
- `bindHandlers()` for composing concrete implementations into the tool-keyed registry consumed by dispatch

This package does not implement command handlers. It preserves the registry boundary that connects alias resolution to handler invocation and now records where each transformed handler implementation is exported.

## Rule Coverage

| Rule | Coverage |
| --- | --- |
| Assessment CLI surface | Extracts the runtime handler registry from the bundled file into a separately testable package. |
| Assessment command metadata duplication | Preserves the handler key surface so aliases, help, arg projection, and handler bindings can later be reconciled from one manifest. |
| RULE-007 / RULE-014 | Supports the dispatch envelope by preserving the handler lookup layer that runs after output-mode validation and before run-record completion. |

## Mapping

| Legacy source | Modern source | Behavior |
| --- | --- | --- |
| `legacy/expo98/dist/expo-ios.mjs:705-770` | `src/main/index.ts:4` | Preserves the ordered 64-entry tool handler registry as data. |
| `legacy/expo98/dist/expo-ios.mjs:705-770` | `src/main/index.ts:71` | Exposes tool names and handler implementation symbols as defensive copies. |
| `legacy/expo98/dist/expo-ios.mjs:705-770` | `src/main/index.ts:76` | Maps every handler symbol to the modern package/export that provides it. |
| `legacy/expo98/dist/expo-ios.mjs:705-770` | `src/main/index.ts:166` | Looks up the implementation symbol for a tool key. |
| `legacy/expo98/dist/expo-ios.mjs:705-770` | `src/main/index.ts:170` | Finds tool keys that point at a given implementation symbol. |
| `legacy/expo98/dist/expo-ios.mjs:705-770` | `src/main/index.ts:176` | Binds injected implementation functions into the legacy tool-keyed registry shape. |

## Characterization Tests

`src/test/characterization.test.ts` covers:

- registry size and first/last ordered bindings
- representative command-domain mappings such as `ref_action`, `runtime_inspector`, `review_overlay`, `annotation_server`, `debug_inspect`, `perf`, and `trace_interaction`
- defensive-copy behavior for lists
- reverse lookup by implementation symbol
- 64-entry implementation-source coverage, including package grouping lookups
- static verification that every implementation source points at a real
  `@expo98/*` package manifest and a public `src/main/index.ts` export
- binding injected implementations into a tool-keyed registry
- stable diagnostics when implementations are missing

## Deliberate Deviations

- Legacy stores direct function references. The modernization stores implementation symbol names and binds concrete functions through dependency injection. This preserves registry behavior while keeping the package independent from all command-domain modules.
- The implementation-source map records package/export names rather than
  importing each package directly. This avoids introducing circular local
  package dependencies while still making final runtime composition auditable.
- Missing implementation validation is stricter and earlier than the legacy object literal. It helps composition fail before dispatch receives a partial handler map.

## Architecture Review

Local review found no high-severity issues. The package is pure metadata plus deterministic binding logic, with no process or filesystem side effects.

Follow-up: `cli-runtime-composition` consumes this package's `bindHandlers()`
shape when assembling the modernized CLI boundary. The source map now proves
that every registry symbol has a transformed package/export; the final
executable wrapper still needs to instantiate those packages with real process,
filesystem, Metro, simulator, and Hermes adapters.

## Representative Diff

Use this command from the modernization workspace:

```bash
diff -u <(sed -n '705,770p' legacy/expo98/dist/expo-ios.mjs) <(sed -n '4,98p' modernized/expo98/tool-handler-registry/src/main/index.ts)
```
