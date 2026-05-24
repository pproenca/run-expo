# network-evidence Transformation Notes

## Scope

Transformed the legacy network evidence command from `legacy/expo98/dist/expo-ios.mjs` into a typed TypeScript module at `modernized/expo98/network-evidence`.

Business rule coverage:

- `RULE-003`: Network evidence must be observable, well-formed, and redacted before stdout or HAR artifact writes.

## Mapping

| Legacy source | Target source | Behavior |
| --- | --- | --- |
| `legacy/expo98/dist/expo-ios.mjs:6227-6300` | `src/main/index.ts:157-245` | `networkCommand` validates actions, clamps ports/limits, selects a Hermes target, evaluates runtime evidence, normalizes/redacts payloads, enriches output, and writes HAR artifacts. |
| `legacy/expo98/dist/expo-ios.mjs:6302-6328` | `src/main/index.ts:247-277` | `networkUnavailable` emits stable unavailable envelopes and Hermes transport metadata. |
| `legacy/expo98/dist/expo-ios.mjs:6330-6441` | `src/main/index.ts:279-395` | `networkExpression` preserves bridge lookup order, plugin bridge compatibility checks, DevTools fallback, app instrumentation fallback, and HAR actions. |
| `legacy/expo98/dist/expo-ios.mjs:6443-6465` | `src/main/index.ts:397-439` | Runtime evidence is redacted first and malformed or empty traffic payloads are normalized to unavailable evidence. |
| `legacy/expo98/dist/expo-ios.mjs:6467-6522` | `src/main/index.ts:441-528` | Transport metadata, limitations, capture timing, HAR generation, and HAR annotation are preserved. |
| `legacy/expo98/dist/expo-ios.mjs:6524-6584` | `src/main/index.ts:560-624` | Requests, nested messages, headers, URLs, credentials, bodies, content, and HAR entries are redacted. |
| `legacy/expo98/dist/expo-ios.mjs:6603-6625` | `src/main/index.ts:480-505` | Observed requests are converted to HAR entries with legacy defaults. |

## Characterization Tests

Tests live in `src/test/characterization.test.ts` and cover:

- Action and HAR action validation.
- Metro port and request limit clamping.
- No-runtime-target and transport-failure unavailable envelopes.
- Runtime expression bridge lookup and action generation.
- Malformed payload and no-observed-traffic normalization.
- URL, header, cookie, body, content, request, response, and HAR redaction.
- HAR-standard header array redaction and top-level request body redaction.
- Explicit adapter boundary failures when Metro or Hermes adapters are not wired.
- Transport metadata, limitations, capture timing, HAR annotation, and HAR generation.
- HAR stop artifact path creation and injected filesystem writes.

Current verification:

```bash
cd modernized/expo98/network-evidence && npm test
```

Result: 22 tests passing.

## Deliberate Deviations

- Metro target discovery, Hermes evaluation, filesystem writes, path resolution, state root resolution, and clock access are dependency-injected. This preserves observable behavior while making the command deterministic and reusable across modernized modules.
- Metro and Hermes adapters are required explicitly. This avoids silently returning `no-runtime-target` from a partially wired module when a live Metro runtime may exist.
- HAR writing uses an injected `writeJsonFile` seam in tests; the default writes pretty JSON with a trailing newline, matching the legacy JSON artifact style.

## Not Migrated

- CLI parser wiring and top-level command registration.
- The underlying Hermes CDP client; this package consumes an evaluation adapter.
- State-root resolution beyond a conservative `.scratch/expo-ios` default for standalone use.

## Follow-Ups

- Wire this module to the modernized `metro-probes` target provider and runtime evaluation adapter.
- Share common redaction primitives with `policy-redaction` once package composition is introduced.

## Architecture Review

Architecture critic findings after first implementation:

- High: HAR-standard header arrays were not redacted because header redaction only handled object maps.
- High: top-level request body/cookie/content fields were preserved when a bridge emitted request fields at the root.
- High: default adapters could silently report `no-runtime-target`, making standalone `networkCommand()` non-equivalent to the legacy command.
- Medium: injected adapter exceptions are not normalized to unavailable envelopes.
- Medium: standalone state-root resolution does not preserve every legacy `root`/`cwd` and `stateDir` ending in `runs` case.
- Nit: expression tests are mostly regex checks rather than VM execution.

Applied fixes:

- Added array-header redaction and characterization coverage.
- Added top-level request body/cookie/content/postData redaction and characterization coverage.
- Removed silent default Metro/Hermes behavior; `networkCommand` now requires explicit adapters.

Remaining non-High items:

- Adapter exception normalization should be handled when the modernized composition layer defines common error envelopes.
- Full legacy state-root behavior should move into a shared session/state package rather than being duplicated here.
- Runtime-expression VM tests can be added when expression execution helpers are shared across bridge-backed modules.
