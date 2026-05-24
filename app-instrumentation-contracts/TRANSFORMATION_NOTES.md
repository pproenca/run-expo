# app-instrumentation-contracts Transformation Notes

## Scope

This slice modernizes the generated dev-only app instrumentation contracts from
`legacy/expo98/src/generated/app-instrumentation/` into
`modernized/expo98/app-instrumentation-contracts/`.

## Mapping

| Legacy source | Modern target | Behavior |
| --- | --- | --- |
| `legacy/expo98/src/generated/app-instrumentation/contracts.ts:12-17` | `src/main/index.ts:1`, `src/main/index.ts:89-94`, `src/main/index.ts:205-219` | Preserves schema version `1`, enabled flag, `developmentOnly: true`, and manifest domain list. |
| `legacy/expo98/src/generated/app-instrumentation/contracts.ts:19-32` | `src/main/index.ts:3-13`, `src/main/index.ts:96-100`, `src/main/index.ts:199-203`, `src/main/index.ts:221-234` | Preserves app instrumentation domain names, domain shape, validation, and lookup. |
| `legacy/expo98/src/generated/app-instrumentation/contracts.ts:34-39` | `src/main/index.ts:15-21`, `src/main/index.ts:102-107` | Preserves tool shape and side-effect vocabulary. |
| `legacy/expo98/src/generated/app-instrumentation/contracts.ts:41-49` | `src/main/index.ts:109-117` | Preserves app bridge manifest and generic tool-call contract. |
| `legacy/expo98/src/generated/app-instrumentation/contracts.ts:51-78` | `src/main/index.ts:119-146` | Preserves snapshot, navigation, performance, and app-readiness instrumentation contracts. |
| `legacy/expo98/src/generated/app-instrumentation/contracts.ts:80-105` | `src/main/index.ts:36`, `src/main/index.ts:148-173` | Preserves console and runtime-error read contracts and console level vocabulary. |
| `legacy/expo98/src/generated/app-instrumentation/contracts.ts:107-129` | `src/main/index.ts:175-197` | Preserves network, storage, controls, and read-option contracts. |
| `legacy/expo98/src/generated/app-instrumentation/index.ts:1` | `src/main/index.ts:1-234` | Replaces re-export-only generated index with a single package entry point. |

## Deliberate Deviations

- The legacy generated file was type-only. The modern package adds runtime
  constants and manifest helpers so bridge compatibility tests can inspect
  domains and side effects without TypeScript compiler introspection.
- Dependent legacy result/record types are represented locally with lightweight
  compatible shapes. Concrete transformed runtime modules can narrow these
  types when composing real device and bridge adapters.
- Manifest construction defensively clones domains, capabilities, and tools to
  keep tests deterministic when callers mutate their input arrays.

## Not Migrated

- No app-side bridge implementation or global injection code is included here.
- No Metro/Hermes runtime evaluation behavior is included in this slice.

## Review Notes

- Architecture review was performed locally. No high-severity issues were
  found; the module is deterministic and side-effect free.
- Future bridge SDK work should use these constants when validating app-side
  manifests and reconciling supported instrumentation domains.

