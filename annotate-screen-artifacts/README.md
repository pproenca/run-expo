# @expo98/annotate-screen-artifacts

Modernized TypeScript transformation of the legacy `annotateScreen` artifact orchestration from `legacy/expo98/dist/expo-ios.mjs`.

This package prepares screenshot annotation workspaces: it captures or copies a screenshot, writes `context.json`, initializes `annotations.json`, writes `annotate.html`, and optionally returns a detached local annotation-server descriptor.

## Commands

```bash
npm test
```

The tests are characterization tests derived from `legacy/expo98/dist/expo-ios.mjs:3658-3756`.
