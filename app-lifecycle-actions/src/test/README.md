# app-lifecycle-actions characterization tests

These tests pin legacy behavior from:

- `legacy/expo98/dist/expo-ios.mjs:2362-2379`
- `legacy/expo98/dist/expo-ios.mjs:2400-2633`
- `legacy/expo98/dist/expo-ios.mjs:11782-11790`
- `legacy/expo98/dist/expo-ios.mjs:11923-11969`
- `legacy/expo98/dist/expo-ios.mjs:12038-12056`
- `legacy/expo98/dist/expo-ios.mjs:7292-7359`
- `analysis/expo98/BUSINESS_RULES.md` RULE-001, RULE-021, RULE-022, RULE-027

Run from this package:

```bash
npm test
```

The tests use injected adapters for subprocess execution, iOS device
resolution, crash-report files, the clock/wait boundary, action policy, and
Expo runtime summary. They do not mutate `legacy/expo98` and do not call real
`adb`, `xcrun`, or `open`.

To add a case, copy an existing test, keep the input values literal, and assert
the exact payload or command arguments observed in the legacy source. If a
modern implementation intentionally differs, keep the legacy assertion and add
transformation notes that cite the deliberate deviation.
