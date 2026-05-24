# perf-evidence Transformation Notes

## Scope

Transformed performance evidence behavior from
`legacy/expo98/dist/expo-ios.mjs` into a typed TypeScript module at
`modernized/expo98/perf-evidence`.

Business rule coverage:

- `RULE-033`: performance evidence lowers confidence when metrics are absent,
  malformed, development-mode, or too sparse.
- `RULE-021`: performance payloads are written through the standard tool JSON
  envelope and persisted as bounded evidence artifacts.
- `RULE-011`: runtime performance evidence is caveated because it depends on
  private/optional Expo, React Native, Rozenite, and app instrumentation
  surfaces.

## Mapping

| Legacy source | Target source | Behavior |
| --- | --- | --- |
| `legacy/expo98/dist/expo-ios.mjs:8216-8228` | `src/main/index.ts:38-49` | `perfCommand` validates actions and dispatches summary, runtime, artifact, memory, native profiler, and bundle handlers. |
| `legacy/expo98/dist/expo-ios.mjs:8230-8285` | `src/main/index.ts:51-103` | `perfSummaryPayload` combines project dependency count, Metro target count, capability records, confidence, context, unavailable sources, and development caveats. |
| `legacy/expo98/dist/expo-ios.mjs:8287-8326` | `src/main/index.ts:105-139` | `perfRuntimePayload` probes Metro/Hermes performance bridge evidence, handles no-runtime and malformed-payload states, normalizes metrics, adds transport/context/confidence, and writes artifacts. |
| `legacy/expo98/dist/expo-ios.mjs:8328-8376` | `src/main/index.ts:141-184` | `perfInstrumentedPayload` and `perfBridgeAction` map mark/measure subactions to bridge actions and preserve runtime unavailable handling. |
| `legacy/expo98/dist/expo-ios.mjs:8378-8408` | `src/main/index.ts:186-216` | `perfComparePayload` compares matching numeric metric names and lowers confidence across baseline/candidate metrics. |
| `legacy/expo98/dist/expo-ios.mjs:8410-8444` | `src/main/index.ts:218-245` | `perfBudgetPayload` performs numeric min/max budget checks and rejects unknown budget subactions. |
| `legacy/expo98/dist/expo-ios.mjs:8446-8476` | `src/main/index.ts:247-276` | `perfMemoryPayload` records sample count, native artifact source, leak-claim permission, confidence, and caveats. |
| `legacy/expo98/dist/expo-ios.mjs:8478-8506` | `src/main/index.ts:278-305` | `perfNativeProfilerPayload` records `ettrace`/`memgraph` metadata, placeholder artifact behavior, confidence, and limitations. |
| `legacy/expo98/dist/expo-ios.mjs:8508-8549` | `src/main/index.ts:307-338` | `perfBundlePayload` measures supplied bundle byte artifacts or reports unavailable bundle evidence. |
| `legacy/expo98/dist/expo-ios.mjs:8551-8612` | `src/main/index.ts:340-376` | Metric maps, confidence lowering, bridge payload normalization, evidence source selection, and Hermes transport records. |
| `legacy/expo98/dist/expo-ios.mjs:8614-8671` | `src/main/index.ts:378-435` | `perfExpression` discovers plugin bridge, Expo DevTools, and app instrumentation performance surfaces and returns stable unavailable states. |
| `legacy/expo98/dist/expo-ios.mjs:8673-8735` | `src/main/index.ts:437-483` | Performance context, build-kind validation, metric/confidence helpers, development limitations, and artifact writing. |

## Characterization Tests

Tests live in `src/test/characterization.test.ts` and cover:

- summary metrics, capabilities, context, unavailable sources, and confidence.
- runtime bridge payload normalization, artifact writing, no-runtime target,
  malformed payload, and required action labels.
- mark/measure bridge-action mapping.
- artifact comparison and budget checks.
- memory sample confidence and leak-claim caveats.
- `ettrace` and `memgraph` native profiler metadata and subaction validation.
- bundle byte metrics and missing artifact unavailable payloads.
- helper contracts for bridge normalization, confidence, context, transport,
  expression generation, tool JSON, and unknown action errors.

Current verification:

```bash
cd modernized/expo98/perf-evidence && npm test
```

Result: 8 tests passing.

## Deliberate Deviations

- Project discovery, Metro status/targets, Hermes evaluation, file stats, file
  writes, path existence, and time are injected dependencies. The legacy bundle
  used direct globals; injection preserves payload behavior while enabling
  deterministic equivalence tests.
- Returned bridge payloads are redacted before metric normalization inside this
  package. Legacy redaction happened at the CLI output boundary; doing it here
  keeps package-level consumers from bypassing the safety invariant.
- The module supports positional action fallback for future CLI routing while
  preserving named-argument legacy behavior.

## Not Migrated

- Final CLI alias wiring for `perf`/`profiler`.
- Real Metro client implementation, project summary implementation, and Hermes
  transport implementation; those are composed from already transformed
  diagnostics/project packages at the router boundary.
- Native profiler collection/symbolication beyond legacy metadata and
  placeholder artifact behavior.

## Follow-Ups

- Wire `perfCommand` into the final modernized CLI router.
- Compose the injected adapters with `metro-probes`, `project-info-doctor`, and
  shared artifact helpers.
