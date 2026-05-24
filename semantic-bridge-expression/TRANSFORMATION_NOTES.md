# Semantic Bridge Expression Transformation Notes

## Scope

This module modernizes the semantic bridge `Runtime.evaluate` expression from
`legacy/expo98/dist/expo-ios.mjs`.

| Legacy source | Modern source | Behavior |
| --- | --- | --- |
| `dist/expo-ios.mjs:1770-1807` | `src/main/index.ts` `semanticBridgeExpression` | Probes supported bridge globals, reads bridge metadata/version aliases, detects snapshot/semantics domains, validates bridge version, captures semantic refs, and returns the legacy semantic payload shape. |

## Deliberate Deviations

- The expression builder is a standalone package. The legacy code kept it next
  to snapshot transport; `snapshot-evidence` already owns normalization and
  persistence, while this package owns only the runtime expression contract.
- Tests execute the generated expression in isolated VM contexts instead of
  relying on Metro or Hermes. The observable expression result is the behavior
  under test.

## Not Migrated

- Metro target selection and Hermes CDP evaluation are covered by
  `modernized/expo98/semantic-bridge-snapshot-adapter`; semantic ref
  normalization and snapshot persistence remain in their owning modernized
  modules.

## Proof

Characterization tests in `src/test/characterization.test.ts` cover:

- no bridge global and missing semantic domain unavailable payloads
- bridge version mismatch payloads
- `snapshot.capture` with serialized filters
- `semantics`, `domains.snapshot`, and `domainRegistry.semantics` fallbacks
- `callTool("snapshot.capture")` fallback
- array domain registration for snapshot/semantics with empty refs
- array capture results and default `routeHint`/`limitations`

## Follow-ups

- Future cross-package composition should import this expression builder into
  `semantic-bridge-snapshot-adapter` rather than duplicating the expression
  text locally.
