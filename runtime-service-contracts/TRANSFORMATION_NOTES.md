# runtime-service-contracts Transformation Notes

## Scope

This slice modernizes the legacy shared DTO and runtime service contracts from
`legacy/expo98/src/contracts/shared.ts` and
`legacy/expo98/src/contracts/services.ts` into
`modernized/expo98/runtime-service-contracts/`.

## Mapping

| Legacy source | Modern target | Behavior |
| --- | --- | --- |
| `legacy/expo98/src/contracts/shared.ts:3-13` | `src/main/index.ts:1-7`, `src/main/index.ts:54-64` | Preserves route record and segment shape plus segment-kind vocabulary. |
| `legacy/expo98/src/contracts/shared.ts:15-20` | `src/main/index.ts:66-71` | Preserves command plan DTO shape. |
| `legacy/expo98/src/contracts/shared.ts:22-27` | `src/main/index.ts:73-78` | Preserves action evidence DTO shape. |
| `legacy/expo98/src/contracts/services.ts:12-18` | `src/main/index.ts:9-10`, `src/main/index.ts:130-136`, `src/main/index.ts:201-240` | Preserves schema validator and validation result contract; adds deterministic validator helpers for tests. |
| `legacy/expo98/src/contracts/services.ts:20-24` | `src/main/index.ts:9-12`, `src/main/index.ts:138-142` | Preserves redactor service method contract. |
| `legacy/expo98/src/contracts/services.ts:26-33` | `src/main/index.ts:9-13`, `src/main/index.ts:144-151` | Preserves artifact store method contract. |
| `legacy/expo98/src/contracts/services.ts:35-55` | `src/main/index.ts:9-15`, `src/main/index.ts:153-173` | Preserves run record, snapshot, and session store contracts. |
| `legacy/expo98/src/contracts/services.ts:57-67` | `src/main/index.ts:9-16`, `src/main/index.ts:175-185`, `src/main/index.ts:253-266` | Preserves event stream and handle contracts. |
| `legacy/expo98/src/contracts/services.ts:69-81` | `src/main/index.ts:9-19`, `src/main/index.ts:187-199`, `src/main/index.ts:242-250` | Preserves policy, output boundary, and config service contracts. |
| `legacy/expo98/src/contracts/policy.ts:3-32` | `src/main/index.ts:96-125` | Preserves policy request, decision, and action policy shapes needed by `PolicyService`. |
| `legacy/expo98/src/contracts/config.ts:53-57` | `src/main/index.ts:127-128`, `src/main/index.ts:197-199` | Preserves config resolver dependency shape at the service boundary. |

## Deliberate Deviations

- The legacy files were type-only. The modern package adds runtime method-name
  constants plus small deterministic helpers so downstream slices can test
  service composition without importing the legacy scaffold.
- `createSimpleSchemaValidator` is intentionally narrow. It preserves the
  `ValidationResult` contract for characterization tests; it is not a complete
  JSON Schema engine.
- `createTruncatingOutputBoundary` is a testable service implementation of the
  output-boundary contract. Full CLI output formatting and redaction remain in
  the dispatch and policy packages.
- Dependent record/config types are represented locally with lightweight
  compatible shapes to keep this package independent from unrelated modules.

## Not Migrated

- No filesystem-backed artifact store, session store, snapshot store, or run
  record store is implemented here.
- No real redaction engine, policy engine, or config resolver is implemented in
  this slice.

## Review Notes

- Architecture review was performed locally. No high-severity issues were
  found; the package is deterministic and side-effect free.
- Future CLI facade work can use these service contracts to wire transformed
  store, redaction, policy, and output-boundary implementations.

