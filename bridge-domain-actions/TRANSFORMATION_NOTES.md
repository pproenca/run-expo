# bridge-domain-actions Transformation Notes

## Scope

Transformed storage, state, and controls bridge-domain command behavior from
`legacy/expo98/dist/expo-ios.mjs` into a typed TypeScript module at
`modernized/expo98/bridge-domain-actions`.

Business rule coverage:

- `RULE-001`: state-changing bridge actions require explicit action policy.
- `RULE-021`: returned bridge output is bounded and secret values are redacted.
- `RULE-031`: storage, state, and controls bridge reads are allowed while
  writes/presses require policy and redacted returned payloads.

## Mapping

| Legacy source | Target source | Behavior |
| --- | --- | --- |
| `legacy/expo98/dist/expo-ios.mjs:6630-6649` | `src/main/index.ts:98-124` | `storageCommand` validates action, gates writes, parses set JSON after policy approval, and evaluates the storage bridge expression. |
| `legacy/expo98/dist/expo-ios.mjs:6651-6664` | `src/main/index.ts:126-143` | `stateCommand` treats `list`/`save` as reads and `load`/`clear` as writes. |
| `legacy/expo98/dist/expo-ios.mjs:6666-6680` | `src/main/index.ts:145-162` | `controlsCommand` treats `list`/`get` as reads and `press` as a device-side mutation. |
| `legacy/expo98/dist/expo-ios.mjs:7268-7321` | `src/main/index.ts:164-229` | Internal `bridgeDomainCommand` resolves Metro/Hermes target, enforces policy on mutating actions, evaluates runtime expression, returns unavailable transport states, and adds sanitized target/transport/policy evidence. |
| `legacy/expo98/dist/expo-ios.mjs:7323-7372` | `src/main/index.ts:231-332` | Shared unavailable, transport, policy-denied, policy-decision, policy-allow, and storage-value helpers. |
| `legacy/expo98/dist/expo-ios.mjs:7374-7442` | `src/main/index.ts:333-402` | Internal storage runtime expression for plugin bridge/app instrumentation storage adapters. |
| `legacy/expo98/dist/expo-ios.mjs:7444-7457` | `src/main/index.ts:404-417` | Internal state runtime expression for app instrumentation state bridge. |
| `legacy/expo98/dist/expo-ios.mjs:7459-7509` | `src/main/index.ts:419-469` | Internal controls runtime expression for plugin bridge/app instrumentation controls adapters. |
| `legacy/expo98/dist/expo-ios.mjs:7277-7289` | `src/main/index.ts:505-540` | Redaction, whole-output bounding, and bridge side-effect classification used by the tool output boundary. |

## Characterization Tests

Tests live in `src/test/characterization.test.ts` and cover:

- Read policy allowance and write/device policy denial.
- Policy allow lists and `actions[action]` forms.
- Policy-denied payload shape and no bridge evaluation before approval.
- Storage list/get/set behavior, JSON parsing order, limit clamping, redaction,
  missing-domain, no-runtime-target, and transport-failure states.
- State read/write side-effect classification.
- Controls list/get/press behavior with policy-approved press.
- Shared transport, unavailable, policy-denied, parse, expression, and exported
  redaction contracts.
- Internal execution primitive policy enforcement, sanitized appended metadata,
  and whole-output truncation for oversized bridge payloads.

Current verification:

```bash
cd modernized/expo98/bridge-domain-actions && npm test
```

Result: 13 tests passing.

## Deliberate Deviations

- Metro target discovery, Hermes evaluation, policy-file reads, path resolution,
  and redaction are dependency-injected. This preserves observable command
  payloads while allowing composition with `metro-probes` and
  `policy-redaction`.
- `bridgeDomainCommand` and the raw runtime expression builders are internal.
  Public command handlers remain the supported execution path so mutating
  storage/state actions and device controls cannot bypass policy gates through
  package exports.
- Returned payloads are sanitized inside this package, not only at the CLI
  output boundary. This preserves `RULE-031` for package-level consumers and
  avoids accidental bypass when the future router calls exported helpers
  directly.
- Tool JSON output is bounded at the full serialized payload boundary. Very
  large bridge objects return an `output-truncated` envelope with a sanitized
  preview instead of emitting unbounded JSON.
- Missing `storage set --value` now reports `storage set requires a JSON value.`
  instead of the legacy generic JSON parser wording. The new message identifies
  the domain-specific missing argument while preserving the legacy policy order:
  invalid or missing values are parsed only after the write policy is approved.

## Not Migrated

- `bridge status|plan|health|domains|install|remove`; those are already covered
  by `modernized/expo98/bridge-installation`.
- `navigation` and `network` bridge domains; those are covered by
  `navigation-deeplinks` and `network-evidence`.
- `dialog`, `sheet`, performance, React Native introspection, and review/report
  commands; those remain separate slices.

## Follow-Ups

- Wire these command handlers into the final modernized CLI router.
- Reuse `bridgeDomainCommand` for `dialog`, `sheet`, and performance-domain
  transforms where the same transport envelope applies.
