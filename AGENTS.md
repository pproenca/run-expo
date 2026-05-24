# Agent Instructions

This repository is the modernized source of truth for `expo98`. It is intentionally a clean single-package CLI repository, not a monorepo and not the modernization analysis workspace.

Follow these rules when changing the repo:

- Keep `expo98` as the primary executable. `expo-ios` remains only as a compatibility bin.
- Treat `cli/expo98.mjs` as generated package output built from `src/bundled-cli.ts`. Rebuild it with `npm run build` after runtime changes.
- Keep runtime dependencies in `dependencies` so `npx expo98 ...` works after publish.
- Do not add transformed-module workspace directories at the repo root. The root should stay limited to the publishable package surface.
- Do not commit generated caches or build output such as `node_modules/`, `.npm/`, `.tmp/`, `.scratch/`, package `dist/` directories, coverage, HAR files, or package tarballs.
- Use `docs/business-rules.md` for source-cited behavior context when deciding whether behavior is intentional.

Useful commands:

```bash
npm ci
npm test
npm run build
npm pack --dry-run --json
npx --no-install expo98 --json doctor
```
