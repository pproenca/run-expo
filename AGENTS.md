# Agent Instructions

This repository is the modernized source of truth for `expo98`. It is intentionally a clean pnpm-managed single-package CLI workspace, not the modernization analysis workspace.

Follow these rules when changing the repo:

- Keep `expo98` as the primary executable. `expo-ios` remains only as a compatibility bin.
- Treat `cli/expo98.mjs` as generated package output built from `src/bundled-cli.ts`. Rebuild it with `pnpm run build` after runtime changes.
- Keep runtime dependencies in `dependencies` so `npx expo98 ...` works after publish.
- Keep `pnpm-lock.yaml` as the only committed package-manager lockfile. Do not add `package-lock.json` or `yarn.lock`.
- Do not add transformed-module workspace directories at the repo root. The root should stay limited to the publishable package surface.
- Do not commit generated caches or build output such as `node_modules/`, `.npm/`, `.tmp/`, `.scratch/`, package `dist/` directories, coverage, HAR files, or package tarballs.
- Use `docs/business-rules.md` for source-cited behavior context when deciding whether behavior is intentional.

Useful commands:

```bash
pnpm install --frozen-lockfile
pnpm test
pnpm run build
pnpm pack --dry-run --json
npx --no-install expo98 --json doctor
```
