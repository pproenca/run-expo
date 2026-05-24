# Agent Instructions

This repository is the modernized source of truth for `expo98`. It replaces the legacy `expo-ios` monolith with a Node 20+ TypeScript module workspace and a single bundled CLI package.

Follow these rules when changing the repo:

- Treat `cli/expo98.mjs` as generated package output built from `src/bundled-cli.ts` and the transformed modules. Rebuild it with `npm run build` after runtime changes.
- Keep `expo98` as the primary executable. `expo-ios` remains only as a compatibility bin.
- Keep runtime dependencies in `dependencies` so `npx expo98 ...` works without local setup.
- Do not commit generated caches or build output such as `node_modules/`, `.npm/`, `.tmp/`, `.scratch/`, package `dist/` directories, coverage, HAR files, or package tarballs.
- Update tests and the relevant module `TRANSFORMATION_NOTES.md` when behavior changes.
- Prefer source-cited behavior rules in `docs/business-rules.md` when deciding whether a behavior is intentional.

Useful commands:

```bash
npm ci
npm test
npm run build
npx --no-install expo98 --json doctor
```
