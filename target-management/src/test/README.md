# target-management characterization tests

These tests pin the legacy target discovery and selection behavior from
`legacy/expo98/dist/expo-ios.mjs:1392-1555`.

Run from this package:

```bash
npm test
```

The tests inject devices, Metro targets, clock values, and session storage.
They do not shell out to `xcrun` or start Metro; adapter tests can cover those
transports separately.
