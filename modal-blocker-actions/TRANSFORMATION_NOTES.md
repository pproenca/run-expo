# modal-blocker-actions Transformation Notes

## Scope

Transformed dialog and sheet modal blocker behavior from
`legacy/expo98/dist/expo-ios.mjs` into a typed TypeScript module at
`modernized/expo98/modal-blocker-actions`.

Business rule coverage:

- `RULE-001`: modal actions carry explicit policy metadata. The legacy command
  treats modal accept/dismiss as allowed non-destructive device actions.
- `RULE-021`: modal bridge output is redacted and bounded before returning tool
  JSON.
- `RULE-031`: the same Metro/Hermes bridge evidence envelope used by bridge
  domains is preserved for modal blocker evidence.

## Mapping

| Legacy source | Target source | Behavior |
| --- | --- | --- |
| `legacy/expo98/dist/expo-ios.mjs:7832-7834` | `src/main/index.ts:95-100` | `dialogCommand` delegates status/accept/dismiss to the modal bridge command. |
| `legacy/expo98/dist/expo-ios.mjs:7836-7838` | `src/main/index.ts:102-107` | `sheetCommand` delegates status/dismiss to the modal bridge command. |
| `legacy/expo98/dist/expo-ios.mjs:7840-7850` | `src/main/index.ts:109-135` | Shared action defaulting, unknown-action errors, legacy non-destructive policy payload, and bridge execution. |
| `legacy/expo98/dist/expo-ios.mjs:7852-7867` | `src/main/index.ts:233-246` | Modal runtime expression chooses the dialog/sheet global, reads status, accepts dialog text, or dismisses the modal. |
| `legacy/expo98/dist/expo-ios.mjs:7268-7321` | `src/main/index.ts:137-191` | Shared Metro target lookup, Hermes evaluation, unavailable states, transport metadata, and sanitized result envelope. |
| `legacy/expo98/dist/expo-ios.mjs:7323-7341` | `src/main/index.ts:193-230` | Shared unavailable and transport payload shapes. |
| `legacy/expo98/dist/expo-ios.mjs:12009-12056` | `src/main/index.ts:278-356` | Redaction, string/array bounding, and whole-output truncation for tool JSON. |
| `legacy/expo98/dist/expo-ios.mjs:12636-12647` | `src/test/characterization.test.ts:52-112` | CLI positional argument behavior for dialog text and sheet action defaults. |

## Characterization Tests

Tests live in `src/test/characterization.test.ts` and cover:

- Dialog and sheet default `status` actions.
- Dialog `accept` text from flags and positionals.
- Sheet `dismiss` behavior and sheet-specific bridge globals.
- Legacy policy metadata for modal actions.
- Unknown-action error messages.
- `no-runtime-target`, `transport-failure`, and missing bridge payloads.
- Stable transport/unavailable helpers, redacted metadata, and whole-output
  truncation.

Current verification:

```bash
cd modernized/expo98/modal-blocker-actions && npm test
```

Result: 6 tests passing.

## Deliberate Deviations

- Metro target discovery, Hermes evaluation, and optional redaction are
  dependency-injected. This keeps the package composable with `metro-probes`,
  `policy-redaction`, and the future modernized router.
- The raw modal expression and bridge execution primitive are internal. Public
  command handlers remain the supported execution path.
- Returned payloads are sanitized inside this package, including appended
  policy and transport metadata. This is stricter than the legacy helper, which
  relied on the outer CLI output boundary.
- Whole tool JSON output is bounded at the serialized payload boundary. Very
  large modal bridge objects return an `output-truncated` envelope with a
  sanitized preview instead of unbounded JSON.

## Legacy Behavior Preserved

- `dialog.accept`, `dialog.dismiss`, and `sheet.dismiss` use side effect
  `device` but are marked `allowed: true` with reason
  `Modal action is non-destructive.` without consulting an action policy file.
  This mirrors `legacy/expo98/dist/expo-ios.mjs:7846-7847`.

## Not Migrated

- Accessibility, debug inspect, review report/matrix, record/diff, React Native
  introspection, and performance commands remain separate slices.
- Final CLI router wiring is deferred until the command modules are transformed.

## Follow-Ups

- Wire these command handlers into the final modernized CLI router.
- Revisit modal action policy in the hardening/reimagined router if the product
  decision changes from legacy non-destructive behavior to strict action-policy
  approval for all device-side modal actions.
