# navigation-deeplinks Characterization Tests

These tests pin observable behavior for the legacy navigation command before a TypeScript implementation is written.

Source citations:

- `legacy/expo98/dist/expo-ios.mjs:5976-6031` for `navigationCommand`, action validation, Metro port clamping, policy denial, Metro target selection, Hermes evaluation, and result enrichment.
- `legacy/expo98/dist/expo-ios.mjs:6033-6062` for `navigationDeepLink`, open-route delegation, fallback policy, selected target evidence, and session evidence.
- `legacy/expo98/dist/expo-ios.mjs:6064-6094` for unavailable envelopes, navigation policy decisions, and transport metadata.
- `legacy/expo98/dist/expo-ios.mjs:6096-6214` for runtime `navigationExpression` plugin bridge and app instrumentation branches.
- `legacy/expo98/dist/expo-ios.mjs:6215-6225` for selected target and latest session lookup.
- `legacy/expo98/tests/test_cli.mjs:1959-2109` for observed CLI expectations around policy, bridge state, runtime actions, version mismatch, and deep-link evidence.
- `analysis/expo98/BUSINESS_RULES.md` `RULE-026` and `RULE-030`.

Coverage:

- Navigation action defaults, validation failures, and Metro port default/clamp behavior.
- `navigation.state` as an ungated read that does not call the policy adapter.
- Policy-denied envelopes for `back`, `pop-to-root`, and `tab` before target or Hermes evaluation.
- Legacy deep-link fallback policy, open-route delegation, selected target evidence, latest session evidence, and route/url evidence.
- Unavailable payloads for missing Metro inspector targets and empty Hermes return values.
- Successful Hermes result enrichment with action, Metro port, target summary, CDP diagnostics, evidence source, and policy.
- Runtime expression branches for plugin bridge lookup, version mismatch, state/back/pop-to-root/tab actions, tab payloads, and app instrumentation fallback.

Run with:

```bash
npm test
```

This package intentionally provides only `src/main/index.d.ts` for the first test-first pass. `npm test` should type-check the tests, then fail at runtime with `ERR_MODULE_NOT_FOUND` for `dist/main/index.js` until the implementation step adds production code.
