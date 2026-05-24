# accessibility-actions Transformation Notes

## Scope

Transformed accessibility command behavior from
`legacy/expo98/dist/expo-ios.mjs` into a typed TypeScript module at
`modernized/expo98/accessibility-actions`.

Business rule coverage:

- `RULE-010`: accessibility tree capture returns semantic bridge evidence and
  native fallback details with explicit unavailable states.
- `RULE-015`: inspect and audit read the latest persisted ref cache for the
  current session.
- `RULE-021`: native command stderr is truncated with an explicit overflow
  marker.
- `RULE-034`: accessibility audit emits `interactive-name` issues for
  interactive cached refs without label or text.

## Mapping

| Legacy source | Target source | Behavior |
| --- | --- | --- |
| `legacy/expo98/dist/expo-ios.mjs:7511-7513` | `src/main/index.ts:40-46` | `accessibilityCommand` selects the default `tree` action and rejects unknown actions. |
| `legacy/expo98/dist/expo-ios.mjs:7514-7524` | `src/main/index.ts:47-56` | `focus` validates a ref, delegates through the ref-action focus path, preserves result fields, and appends the native-focus limitation. |
| `legacy/expo98/dist/expo-ios.mjs:7525-7534` | `src/main/index.ts:58-65` | `inspect` reads the latest ref cache and returns found, missing-ref, or no-snapshot tool payloads. |
| `legacy/expo98/dist/expo-ios.mjs:7535-7542` | `src/main/index.ts:67-71`, `105-109` | `audit` emits `interactive-name` issues when interactive records lack label and text. |
| `legacy/expo98/dist/expo-ios.mjs:7543-7562` | `src/main/index.ts:76-103`, `122-136` | `tree` combines semantic bridge evidence, `axe describe-ui`, booted-device resolution, native failure payloads, and native tree JSON parsing. |
| `legacy/expo98/dist/expo-ios.mjs:2182-2187`, `1534-1545`, `1383-1390` | `src/main/index.ts:111-120`, `138-158` | Latest ref-cache, latest-session, and Expo state-root resolution helpers. |
| `legacy/expo98/dist/expo-ios.mjs:12045-12056` | `src/main/index.ts:173-183` | Finite-number clamping and truncation helper contracts used by command payloads. |

## Characterization Tests

Tests live in `src/test/characterization.test.ts` and cover:

- `inspect` found-ref, missing-ref, and no-snapshot payloads.
- `audit` `RULE-034` issue filtering and no-snapshot payloads.
- `focus` delegation to ref-action focus with source and limitation payloads.
- `tree` native `axe` capture with semantic bridge context and device
  resolution.
- unavailable tree payloads for semantic bridge errors, missing `axe`, and
  native command failures with truncated stderr.
- unknown-action rejection and helper contracts for clamping and truncation.

Current verification:

```bash
cd modernized/expo98/accessibility-actions && npm test
```

Result: 6 tests passing.

## Deliberate Deviations

- Simulator, `axe`, semantic bridge, and ref-action integrations are injected
  dependencies. The legacy module used file-local functions; injection keeps
  the transformed module deterministic and ready for final router composition.
- `focus` throws when no ref-action adapter is supplied. In the legacy CLI this
  dependency was always in the same bundle; the modern module makes that
  composition requirement explicit.
- The module supports positional action/ref fallbacks for future CLI routing
  while preserving the named-argument behavior covered by the legacy source.

## Not Migrated

- Debug inspect/highlight behavior, React Native introspection, performance
  tooling, live backlog handling, and final CLI router wiring are outside this
  accessibility-actions slice.

## Follow-Ups

- Wire `accessibilityCommand` into the final modernized CLI router.
- Share state-root/session helpers once the modernized router has a common
  platform package.
- Compose the injected simulator, semantic bridge, and ref-action adapters at
  the router boundary.
