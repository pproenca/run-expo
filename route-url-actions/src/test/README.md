# route-url-actions Characterization Tests

These tests pin the legacy behavior from:

- `legacy/expo98/dist/expo-ios.mjs:2381-2398`
- `legacy/expo98/dist/expo-ios.mjs:3526-3543`
- `legacy/expo98/dist/expo-ios.mjs:9639-9680`
- `legacy/expo98/dist/expo-ios.mjs:11782-11800`
- `legacy/expo98/dist/expo-ios.mjs:11816-11832`
- `legacy/expo98/dist/expo-ios.mjs:11923-11969`

They also cover the related CLI fixtures in `legacy/expo98/tests/test_cli.mjs`
and the RULE-022/RULE-026 context in `analysis/expo98/BUSINESS_RULES.md`.

Run them with:

```bash
cd modernized/expo98/route-url-actions
npm test
```

The package intentionally contains only a declaration placeholder right now.
Until `src/main/index.ts` exists, `npm test` should build the tests and then
fail at runtime because `dist/main/index.js` is missing. After implementation,
keep each test case concrete: add literal inputs and literal expected outputs
from the legacy branch being transformed.
