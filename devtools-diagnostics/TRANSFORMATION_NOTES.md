# devtools-diagnostics Transformation Notes

## Scope

Transformed the DevTools capability and runtime diagnostics behavior from
`legacy/expo98/dist/expo-ios.mjs` into a typed TypeScript module at
`modernized/expo98/devtools-diagnostics`.

Business rule coverage:

- `RULE-021`: command output is bounded before returning shell diagnostics.
- `RULE-024`: DevTools diagnostics depend on existing Metro targets and do not
  implicitly start Metro.
- `RULE-032`: runtime diagnostics and React Native DevTools evidence are
  caveated when hooks, targets, or private runtime buffers are absent.

## Mapping

| Legacy source | Target source | Behavior |
| --- | --- | --- |
| `legacy/expo98/dist/expo-ios.mjs:5330-5475` | `src/main/index.ts:176-307` | `devtoolsCommand` dispatches `capabilities`, `status`, `panels`, `open`, and `events`; unknown actions preserve legacy errors. |
| `legacy/expo98/dist/expo-ios.mjs:5477-5494` | `src/main/index.ts:309-333` | `devtoolsStatusPayload` groups machine-readable domains and human-visible panels. |
| `legacy/expo98/dist/expo-ios.mjs:5477-5560` | `src/main/index.ts:336-418` | React Native DevTools frontend, panel, network-panel, and attachment-risk normalization. |
| `legacy/expo98/dist/expo-ios.mjs:5562-5580` | `src/main/index.ts:629-655` | DevTools panel record shape and machine-readable/human-visible flags. |
| `legacy/expo98/dist/expo-ios.mjs:5582-5600` | `src/main/index.ts:609-626` | Attachment-state aliases and DevTools network-panel URL detection. |
| `legacy/expo98/dist/expo-ios.mjs:5595-5615` | `src/main/index.ts:420-443` | `devtools open` launches the frontend URL through `open` and reports stdout/stderr/error evidence. |
| `legacy/expo98/dist/expo-ios.mjs:5617-5641` | `src/main/index.ts:445-479` | `devtools events` appends or resets event artifacts under the Expo state root. |
| `legacy/expo98/dist/expo-ios.mjs:5655-5748` | `src/main/index.ts:481-553` | `console` and `errors` read/clear bounded runtime diagnostics through Hermes `Runtime.evaluate`. |
| `legacy/expo98/dist/expo-ios.mjs:5750-5756` | `src/main/index.ts:555-579` | Runtime diagnostics expression reads legacy buffer globals and normalizes message records. |

## Characterization Tests

Tests live in `src/test/characterization.test.ts` and cover:

- DevTools frontend URL normalization, panel groups, attachment state, and
  network-panel detection.
- Capability payloads for Metro, symbolication, Hermes runtime, DevTools,
  console, and errors.
- DevTools status/panels grouping, open launch diagnostics, and no-frontend
  unavailable payloads.
- DevTools events artifact pathing, append behavior, start reset behavior, and
  redaction before persistence.
- Console/errors unavailable payloads, read/clear Hermes evaluation, message
  limit clamping, output redaction/bounding, and diagnostics-expression
  generation.

Current verification:

```bash
cd modernized/expo98/devtools-diagnostics && npm test
```

Result: 18 tests passing.

## Deliberate Deviations

- Metro probing, Hermes evaluation, filesystem writes, and `open` execution are
  dependency-injected, with Node/Metro defaults for standalone use. This
  preserves the observable payload contract while letting the modernized module
  compose with `metro-probes` and remain deterministic under test.
- This slice does not duplicate the full Metro inspector client already
  transformed in `modernized/expo98/metro-probes`; its default Metro probe is a
  lightweight compatibility path, and composition should consume a Metro status
  or target-discovery adapter instead.
- Returned and persisted diagnostic evidence is redacted and bounded inside this
  package. Legacy CLI redaction happened closer to the output boundary; the
  transformed slice applies the same safety invariant earlier so package-level
  consumers cannot accidentally bypass it.

## Not Migrated

- CLI argument parsing and alias wiring outside this command payload boundary.
- React Native component tree inspection, `rn`, and `trace` commands. Those are
  separate `RULE-032` slices.

## Follow-Ups

- Wire this package into the eventual modernized CLI command router with
  adapters from `metro-probes`.
- Reuse the diagnostics message normalization in later `rn` and
  `trace-interaction` transforms.

## Architecture Review

Architecture critic HIGH findings were applied:

- Corrected overstated legacy line mapping so this package scopes the DevTools
  diagnostics slice starting at `devtoolsCommand`.
- Replaced silent no-op defaults for filesystem writes and `open` execution with
  real Node defaults; default Metro probing now checks local Metro endpoints.
- Added redaction and output bounding for returned diagnostic payloads and
  persisted DevTools event artifacts.
- Sanitized exported payload helpers as well as `toolJson` output, capped large
  arrays, and added tests for redaction, bounded diagnostic strings, and bounded
  event histories.

Remaining lower-severity note:

- Package-level composition with `metro-probes` is still adapter-based rather
  than a package dependency. This avoids coupling transformed vertical slices
  before the final CLI/router integration pass.
