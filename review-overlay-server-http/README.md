# @expo98/review-overlay-server-http

Modernized TypeScript transformation of the legacy review overlay server request handling from `legacy/expo98/dist/expo-ios.mjs`.

This package routes review-overlay HTTP requests as response data: health, pointer bridge, clipboard copy, event file reads, event endpoint read/append/clear, wildcard CORS, JSON response formatting, and request body limits.

## Commands

```bash
npm test
```

The tests are characterization tests derived from `legacy/expo98/dist/expo-ios.mjs:3902-4048` and `legacy/expo98/dist/expo-ios.mjs:4170-4182`.
