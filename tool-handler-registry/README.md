# @expo98/tool-handler-registry

Modernized TypeScript transformation of the legacy expo98 runtime tool handler registry.

This package exposes the bundled `handlers` object as ordered metadata and provides an injectable `bindHandlers()` boundary that turns implementation functions into the tool-keyed registry expected by command dispatch.

## Commands

```bash
npm test
```

The tests are characterization tests derived from `legacy/expo98/dist/expo-ios.mjs:705-770`.
