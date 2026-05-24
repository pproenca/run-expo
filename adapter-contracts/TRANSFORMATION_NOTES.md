# adapter-contracts Transformation Notes

## Scope

This slice modernizes the legacy adapter contract scaffold from
`legacy/expo98/src/adapters/` into
`modernized/expo98/adapter-contracts/`.

## Mapping

| Legacy source | Modern target | Behavior |
| --- | --- | --- |
| `legacy/expo98/src/adapters/interfaces.ts:28-220` | `src/main/index.ts:1-13`, `src/main/index.ts:97-108`, `src/main/index.ts:190-386` | Preserves core adapter names and interface shapes for command runner, project, device, gesture, Metro, Hermes, snapshot, DevTools, runtime evidence, performance, and session store boundaries. |
| `legacy/expo98/src/adapters/interfaces.ts:73-102` | `src/main/index.ts:45-59`, `src/main/index.ts:230-264` | Preserves gesture action and ref-action vocabularies as runtime arrays plus TypeScript unions. |
| `legacy/expo98/src/adapters/domains.ts:13-269` | `src/main/index.ts:15-32`, `src/main/index.ts:109-124`, `src/main/index.ts:388-623` | Preserves domain adapter names and method contracts for navigation, network, storage, app state, controls, accessibility, dialogs, recording, diffs, dashboard, skills, setup, clipboard, environment, Expo introspection, and instrumentation. |
| `legacy/expo98/src/adapters/domains.ts:84` | `src/main/index.ts:61`, `src/main/index.ts:388` | Preserves storage-kind vocabulary as runtime data and a TypeScript union. |
| `legacy/expo98/src/adapters/domains.ts:245-254` | `src/main/index.ts:63-73`, `src/main/index.ts:595-608` | Preserves environment setting categories as runtime data and typed setting variants. |
| `legacy/expo98/src/adapters/native-profilers.ts:4-51` | `src/main/index.ts:34`, `src/main/index.ts:125`, `src/main/index.ts:625-666` | Preserves native profiler adapter method contracts and profile result shapes. |
| `legacy/expo98/src/adapters/review.ts:4-180` | `src/main/index.ts:36-43`, `src/main/index.ts:126-131`, `src/main/index.ts:668-824` | Preserves review adapter names and method contracts for inspector, trace, annotation, review overlay, next-step guidance, and reports. |
| `legacy/expo98/src/adapters/index.ts:1-4` | `src/main/index.ts:1-1044` | Replaces re-export-only index with a single package entry point. |
| Type-only legacy adapter module | `src/main/index.ts:141-214` | Adds `ADAPTER_IMPLEMENTATION_SOURCES`, a source map from each adapter contract to transformed package exports that can participate in final runtime composition. |
| Type-only legacy adapter module | `src/main/index.ts:908-1044` | Adds a small adapter registry, catalog lookup helpers, adapter implementation source filters, and coverage assertion helpers for runtime composition. |

## Deliberate Deviations

- The legacy adapter files were type-only and depended on other legacy contract
  modules. This package keeps the same top-level adapter boundaries but defines
  lightweight local payload types where dependent modules have not been migrated
  into this package.
- Result-specific types from `contracts/results.ts` are represented as
  `JsonValue` at this boundary for project, runtime evidence, DevTools
  capabilities, and performance reports. Concrete transformed modules can use
  narrower package-specific result types.
- Adapter names are expressed as lower-camel runtime contract names
  (`metro`, `reviewOverlay`, `nativeProfiler`) so a registry can wire concrete
  implementations without relying on TypeScript interface names at runtime.
- The implementation source map points at concrete transformed package exports,
  not concrete class instances. Several adapter contracts are composed from
  multiple command-boundary packages in the modernized workspace.

## Not Migrated

- No adapter instances are constructed here. Device, Metro, Hermes, filesystem,
  native profiler, and review server behavior remains in transformed domain
  packages; this package records the implementation sources and exposes the
  registry contract that a final runtime assembler can use.
- No subprocess or network side effects are performed by this package.

## Review Notes

- Architecture review was performed locally. No high-severity issues were
  found; the package is deterministic and side-effect free.
- Future CLI/router slices should use `ADAPTER_CATALOG` and
  `ADAPTER_IMPLEMENTATION_SOURCES` with `createAdapterRegistry` to wire
  modernized adapters rather than importing legacy `src/adapters` types.
