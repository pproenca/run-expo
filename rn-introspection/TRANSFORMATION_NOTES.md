# rn-introspection Transformation Notes

## Scope

Transformed React Native introspection behavior from
`legacy/expo98/dist/expo-ios.mjs` into a typed TypeScript module at
`modernized/expo98/rn-introspection`.

Business rule coverage:

- `RULE-032`: React Native introspection returns caveated evidence when runtime
  hooks or private fiber fields are absent or incomplete.
- `RULE-015`: `rn inspect` reads the latest cached ref snapshot instead of live
  private runtime internals.
- `RULE-017`: bridge-based RN reads fail through the same runtime bridge
  unavailable states supplied by the injected bridge-domain adapter.

## Mapping

| Legacy source | Target source | Behavior |
| --- | --- | --- |
| `legacy/expo98/dist/expo-ios.mjs:8131-8151` | `src/main/index.ts:44-76` | `rnCommand` validates action, handles `inspect`, maps `renders` subactions to bridge actions, delegates read-only bridge evaluation, and appends RN limitations. |
| `legacy/expo98/dist/expo-ios.mjs:8153-8191` | `src/main/index.ts:78-120` | `rnInspectPayload` validates ref, reads latest ref cache, returns no-snapshot, missing-ref, or cached-record payloads with caveats. |
| `legacy/expo98/dist/expo-ios.mjs:8193-8207` | `src/main/index.ts:122-136` | `rnExpression` discovers RN bridge globals and preserves tree/fiber/renders fallback payloads. |
| `legacy/expo98/dist/expo-ios.mjs:8209-8214` | `src/main/index.ts:138-143` | `rnLimitations` appends the private hooks/fiber caveat. |
| `legacy/expo98/dist/expo-ios.mjs:2182-2187`, `1534-1545`, `1383-1390` | `src/main/index.ts:145-179` | Latest ref-cache, latest-session, session-directory, and state-root helpers used by `rn inspect`. |

## Characterization Tests

Tests live in `src/test/characterization.test.ts` and cover:

- `tree` bridge delegation with read-only RN policy and limitation merging.
- `renders start|stop|read` bridge action mapping and invalid subaction errors.
- `fiber` ref forwarding into the runtime expression and unknown action errors.
- successful `inspect` payloads from cached ref evidence.
- no-snapshot and missing-ref unavailable inspect payloads.
- runtime expression fallback contracts for missing bridge, tree, fiber, and
  renders evidence.
- tool JSON wrapping through `rnCommand`.

Current verification:

```bash
cd modernized/expo98/rn-introspection && npm test
```

Result: 7 tests passing.

## Deliberate Deviations

- Bridge execution is injected as `bridgeDomainCommand` instead of duplicating
  Metro/Hermes transport in this package. The generic bridge transport was
  already transformed in `bridge-domain-actions`; this module owns RN action
  semantics and runtime expression construction.
- Ref-cache reads are injectable for deterministic tests and future composition
  with the snapshot/ref-cache package.
- The module supports positional action/ref fallbacks for future CLI routing
  while preserving the named-argument behavior in the legacy source.

## Not Migrated

- Generic bridge transport, policy-file loading, and Metro target discovery are
  not duplicated here.
- DevTools console/error buffers and trace interaction flows are separate
  diagnostics slices.

## Follow-Ups

- Wire `rnCommand` into the final modernized CLI router.
- Compose it with `bridge-domain-actions` and shared ref-cache helpers once the
  router has a common runtime adapter package.
