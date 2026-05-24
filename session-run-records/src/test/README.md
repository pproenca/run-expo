# session-run-records characterization tests

These tests pin the legacy behavior from `legacy/expo98/dist/expo-ios.mjs`
before the TypeScript rewrite is implemented.

Run from this package:

```bash
npm test
```

The tests use deterministic clocks and random suffixes so ID, timestamp, and
filesystem expectations stay literal. When adding a case, cite the rule in the
test name and prefer a concrete persisted JSON assertion over an internal-only
assertion.
