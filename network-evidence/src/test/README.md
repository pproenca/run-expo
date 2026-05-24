# network-evidence Characterization Tests

These tests pin observable behavior for the legacy network evidence command before a TypeScript implementation is written.

Source citations:

- `legacy/expo98/dist/expo-ios.mjs:6227-6300` for `networkCommand`, action validation, Metro target selection, Hermes transport failure handling, HAR stop artifact writes, and command payload enrichment.
- `legacy/expo98/dist/expo-ios.mjs:6301-6441` for unavailable payloads and runtime expression generation.
- `legacy/expo98/dist/expo-ios.mjs:6443-6600` for evidence redaction, normalization, transport metadata, limitations, timing, HAR annotation, and HAR generation.
- `legacy/expo98/dist/expo-ios.mjs:6603-6625` for HAR generation from request evidence.
- `analysis/expo98/BUSINESS_RULES.md` `RULE-003`: network evidence must be observable, well-formed, and redacted.

Coverage:

- Network action and HAR action validation.
- Metro port and request limit clamping.
- Structured unavailable envelopes for absent runtime targets and Hermes transport failures.
- Runtime expression generation inputs for status, request, request list, clear, and HAR actions.
- Malformed payload normalization and no-observed-traffic handling for `requests` and `har-stop`.
- Request, URL, header, body, cookie, content, and HAR entry redaction.
- Network transport metadata and evidence limitations, including app-instrumentation and no-observed-traffic extras.
- Capture timing from request lists, single request evidence, and default clock fallback.
- HAR metadata annotation, HAR generation, and `har-stop` artifact path/write behavior through injected filesystem, clock, and path dependencies.

The package intentionally has only `src/main/index.d.ts`. `npm test` should type-check the tests, then fail at runtime with `ERR_MODULE_NOT_FOUND` for `dist/main/index.js` until the implementation step begins.
