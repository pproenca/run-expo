# review-evidence-reports Transformation Notes

## Scope

Transformed review report, review matrix, and diff evidence assembly from
`legacy/expo98/dist/expo-ios.mjs` into a typed TypeScript module at
`modernized/expo98/review-evidence-reports`.

Business rule coverage:

- `RULE-013`: report/diff commands read the latest session from the Expo state
  root and preserve session artifact namespaces.
- `RULE-014`: review reports summarize persisted run records without executing
  additional commands.
- `RULE-015`: review and snapshot diff commands consume the latest ref cache and
  snapshot artifacts.
- `RULE-035`: review/report/diff assemble existing evidence and avoid
  unsupported visual-quality judgment.

## Mapping

| Legacy source | Target source | Behavior |
| --- | --- | --- |
| `legacy/expo98/dist/expo-ios.mjs:7668-7682` | `src/main/index.ts:39-57` | `reviewCommand` defaults to `report`, validates action, resolves state root/output path, reads session/runs/refs, writes report/matrix JSON, and returns tool JSON. |
| `legacy/expo98/dist/expo-ios.mjs:7684-7700` | `src/main/index.ts:94-117` | `reviewReportPayload` assembles session IDs, run count, last 25 run summaries, ref count, artifact roots, and limitation text. |
| `legacy/expo98/dist/expo-ios.mjs:7702-7723` | `src/main/index.ts:119-147` | `reviewMatrixPayload` builds session/target/snapshot/screenshot/runtime/diagnostics/interaction checks from existing run evidence. |
| `legacy/expo98/dist/expo-ios.mjs:7905-7926` | `src/main/index.ts:59-92` | `diffCommand` validates kind, resolves output, selects snapshot/route/screenshot diff payloads, adds session/target metadata, writes JSON, and returns tool JSON. |
| `legacy/expo98/dist/expo-ios.mjs:7928-7945` | `src/main/index.ts:149-174` | Route diff opens route A/B, optionally captures screenshots, and discloses that semantic visual comparison is caller-owned. |
| `legacy/expo98/dist/expo-ios.mjs:7947-7965` | `src/main/index.ts:176-193` | Snapshot diff compares baseline/current ref IDs and reports added/removed refs and counts. |
| `legacy/expo98/dist/expo-ios.mjs:7967-7972` | `src/main/index.ts:208-216` | Latest snapshot fallback reads latest refs, then snapshot JSON, falling back to the ref cache. |
| `legacy/expo98/dist/expo-ios.mjs:9337-9347` | `src/main/index.ts:195-206` | Screenshot diff compares file sizes and reports byte delta and changed flag. |
| `legacy/expo98/dist/expo-ios.mjs:1534-1545`, `2182-2187` | `src/main/index.ts:218-236` | Latest-session and latest-ref-cache discovery. |
| `legacy/expo98/dist/expo-ios.mjs:7798-7829` | `src/main/index.ts:238-270` | Run-record listing, run summaries, and artifact root paths. |
| `legacy/expo98/dist/expo-ios.mjs:1383-1390`, `1553-1555`, `11846-11848`, `13045-13047` | `src/main/index.ts:272-290` | State-root normalization, session directory path, JSON reads, and pretty JSON writes with trailing newline. |
| `legacy/expo98/dist/expo-ios.mjs:12649-12666`, `12725-12731` | `src/main/index.ts:63-72` | CLI positional mapping for diff and review actions. |

## Characterization Tests

Tests live in `src/test/characterization.test.ts` and cover:

- Review report assembly from latest session, run records, latest refs, artifact
  roots, and persisted JSON output.
- Matrix check derivation from captured command evidence.
- Snapshot diff with explicit current snapshot and latest-ref fallback.
- Screenshot byte-size diff.
- Route diff route-opening order, optional screenshot artifact paths, and
  limitation text.
- Unknown action/kind errors, state-root normalization, and run summary shape.

Current verification:

```bash
cd modernized/expo98/review-evidence-reports && npm test
```

Result: 5 tests passing.

## Deliberate Deviations

- Route opening and screenshot capture are dependency-injected. The legacy code
  called `openExpoRoute` and `captureScreenshot` directly; the transformed
  package keeps evidence assembly separate from simulator interaction adapters.
- The package exposes pure payload builders and state readers for router-level
  composition and focused tests.

## Not Migrated

- `record start|stop` is a separate artifact lifecycle slice.
- `debug inspect`, `highlight`, React Native introspection, performance,
  dashboard, and live-backlog commands remain separate slices.
- Final CLI router wiring is deferred until command modules are transformed.

## Follow-Ups

- Wire `reviewCommand` and `diffCommand` into the final modernized CLI router.
- Use the injected route/screenshot adapters from `route-url-actions` and
  `screenshot-capture` when composing the router.
