# @expo98/review-next-guidance

Modernized TypeScript transformation of the legacy `review-next` guidance logic from `legacy/expo98/dist/expo-ios.mjs`.

This package is a pure module: it classifies the next review constraint, returns surface-specific evidence flows, emits ambiguity questions, suggests legacy-compatible commands, and exposes stop conditions. It intentionally does not start annotation or review-overlay HTTP servers.

## Commands

```bash
npm test
```

The tests are characterization tests derived from the legacy implementation at `legacy/expo98/dist/expo-ios.mjs:5079-5319`.
