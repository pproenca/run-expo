# debug-inspect-highlight Transformation Notes

## Scope

Transformed debug inspect and highlight behavior from
`legacy/expo98/dist/expo-ios.mjs` into a typed TypeScript module at
`modernized/expo98/debug-inspect-highlight`.

Business rule coverage:

- `RULE-010`: inspect returns semantic/native ref evidence and Metro target
  context when available.
- `RULE-013`: highlight writes evidence artifacts under the Expo state root.
- `RULE-015`: inspect and highlight consume the latest persisted ref cache.
- `RULE-021`: command outputs keep the legacy tool JSON boundary for router
  wrapping and output limiting.

## Mapping

| Legacy source | Target source | Behavior |
| --- | --- | --- |
| `legacy/expo98/dist/expo-ios.mjs:7565-7567` | `src/main/index.ts:35-40` | `debugInspectCommand` wraps the inspect payload in the tool JSON envelope. |
| `legacy/expo98/dist/expo-ios.mjs:7569-7621` | `src/main/index.ts:42-99` | `debugInspectPayload` validates ref, reads cached ref evidence, includes session/target/Metro context, projects element fields, and returns legacy limitation text. |
| `legacy/expo98/dist/expo-ios.mjs:7623-7652` | `src/main/index.ts:101-136` | `highlightCommand` validates ref evidence, requires bounds, writes a timestamped SVG artifact, and returns the highlight evidence payload. |
| `legacy/expo98/dist/expo-ios.mjs:7654-7665` | `src/main/index.ts:138-154` | `highlightSvg` computes canvas dimensions from cached bounds, draws the overlay, and escapes visible label text. |
| `legacy/expo98/dist/expo-ios.mjs:3076-3083` | `src/main/index.ts:156-167` | `readRefRecord` returns no-snapshot, missing-ref, stale-ref, or found cached ref results. |
| `legacy/expo98/dist/expo-ios.mjs:2182-2187`, `1534-1545`, `1383-1390` | `src/main/index.ts:169-207` | Latest ref-cache, latest-session, selected-target, session-directory, and state-root helpers. |

## Characterization Tests

Tests live in `src/test/characterization.test.ts` and cover:

- successful inspect payloads assembled from ref cache, session, selected
  target, and Metro status.
- unavailable inspect payloads for missing refs, stale refs, and no snapshot.
- tool JSON wrapping for inspect and highlight commands.
- highlight failures when cached refs lack bounds.
- timestamped SVG artifact path generation and SVG content from cached bounds.
- state-root normalization, ref validation, and SVG escaping helpers.

Current verification:

```bash
cd modernized/expo98/debug-inspect-highlight && npm test
```

Result: 6 tests passing.

## Deliberate Deviations

- Metro status, filesystem writes, current time, session reads, target reads,
  and ref-cache reads are injectable dependencies. The legacy bundle used
  file-local functions directly; injection keeps the transformed module
  deterministic and ready for final router composition.
- `highlightSvg` validates finite box coordinates when called directly. The
  command path still preserves the legacy precondition that highlighting only
  proceeds when a cached `box` exists.
- The module supports positional ref fallback for future CLI routing while
  preserving the named-argument behavior from the legacy source.

## Not Migrated

- Final CLI argument parsing and command alias wiring are deferred to the CLI
  facade.
- Live React Native runtime inspection is not part of this slice; this module
  assembles evidence from cached ref snapshots and Metro target status.

## Follow-Ups

- Wire `debugInspectCommand` and `highlightCommand` into the final modernized
  CLI router.
- Share session/ref-cache helpers with the accessibility and ref-action modules
  once the router has a common platform package.
