# Bridge Runtime Contracts Transformation Notes

## Scope

This module modernizes the runtime bridge health expression and generated
bridge source contract from `legacy/expo98/dist/expo-ios.mjs`.

| Legacy source | Modern source | Behavior |
| --- | --- | --- |
| `dist/expo-ios.mjs:6683-6729` | `src/main/index.ts` `EXPO_IOS_BRIDGE_VERSION`, `BRIDGE_DOMAIN_CATALOG` | Preserves bridge version and the eight-domain catalog, including read/write commands and redaction boundaries. |
| `dist/expo-ios.mjs:7160-7168` | `src/main/index.ts` `bridgeMetadata` | Preserves bridge metadata fields, generated-by value, and six generated-source domains. |
| `dist/expo-ios.mjs:7076-7078` | `src/main/index.ts` `bridgeDomainsFromCatalog` | Provides a catalog-domain projection for callers that need runtime-health defaults. |
| `dist/expo-ios.mjs:7170-7241` | `src/main/index.ts` `bridgeHealthExpression` | Preserves the `Runtime.evaluate` expression that probes bridge globals, detects registration, derives bridge version, computes runtime domains, applies catalog defaults, and returns health payloads. |
| `dist/expo-ios.mjs:7243-7259` | `src/main/index.ts` `bridgeSource` | Preserves the legacy generated source text and its permissive undefined-`__DEV__` registration behavior. |

## Deliberate Deviations

- Runtime behavior is tested by executing the generated expression in isolated
  VM contexts instead of requiring Metro/Hermes.
- This package intentionally preserves legacy generated source text. The
  existing `bridge-installation` package owns the hardened installable source
  variant and documents that deliberate security deviation separately.

## Not Migrated

- `bridgeHealthPayload` transport orchestration is covered by
  `modernized/expo98/bridge-health-payload-adapter`; this package owns only
  the runtime expression and bridge contract text.

## Proof

Characterization tests in `src/test/characterization.test.ts` cover:

- metadata and catalog shape
- missing bridge and missing app registration health payloads
- registered runtime domains, command overrides, unknown domains, and invalid
  domain filtering
- metadata domains, domain registry, and full catalog fallbacks
- app instrumentation domain detection and inferred bridge version
- legacy generated source markers and permissive undefined-`__DEV__` guard
- health expression markers for bridge version, instrumentation global, and
  fallback domain redaction

## Follow-ups

- Future cross-package composition should replace duplicated bridge constants
  with imports from this contract package.
