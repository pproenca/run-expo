# metro-probes Characterization Tests

These tests pin observable behavior for the legacy Metro diagnostics surface before a TypeScript implementation is written.

Source citations:

- `legacy/expo98/dist/expo-ios.mjs:5758-5968` for `metroCommand`, `metroStatusPayload`, `metroTargets`, `targetSummary`, `probeMetroSymbolication`, and `MetroInspectorClient`.
- `legacy/expo98/dist/expo-ios.mjs:12045-12064` for `clampNumber` and `formatError`.
- `analysis/expo98/BUSINESS_RULES.md` `RULE-024`: Metro probes return unavailable or skip malformed targets without implicitly starting Metro.

Coverage:

- Metro port finite-number validation and clamping.
- `metroCommand` default action, unknown action error, and `reload` / `symbolicate` delegation.
- Target summary null handling and capability fallback calculation.
- Target normalization rejection, optional string normalization, React Native metadata, and capability flags.
- `/json/list` unavailable, malformed, partially malformed, and valid target responses.
- `/status` and `/json/version` available and unavailable envelopes with formatted errors.
- `/symbolicate` POST body/options and OK, non-OK, JSON parse failure, and thrown-fetch envelopes.
- `probeSymbolication` envelope projection.
- `statusPayload` short-circuit behavior when Metro status is unavailable and full evidence shape when available.

The package intentionally has only `src/main/index.d.ts`. `npm test` should type-check the tests, then fail at runtime with `ERR_MODULE_NOT_FOUND` for `dist/main/index.js` until the implementation step begins.
