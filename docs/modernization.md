# Modernization Summary

This repository is the hard replacement for the previous `expo98` checkout at `/Users/pedroproenca/Documents/Projects/expo98`. The replacement preserves git history and replaces the legacy `expo-ios` monolith with the modernized `expo98` CLI.

## What Changed

- Primary executable changed from `expo-ios` to `expo98`; `expo-ios` remains as a compatibility bin.
- Runtime ownership moved from a checked-in monolithic `dist/expo-ios.mjs` file to `src/bundled-cli.ts` plus a generated bundle at `cli/expo98.mjs`.
- Runtime dependency surface is limited to runtime code; `ws` ships in `dependencies`, while the `esbuild` bundler stays in `devDependencies`.
- The repo is now intentionally one clean executable CLI package, not a monorepo and not the modernization staging workspace.
- Package management is pnpm-only, with `pnpm-workspace.yaml` defining the workspace root and `pnpm-lock.yaml` as the committed lockfile.
- Legacy Clawpatch output, generated topology HTML/JSON, local caches, per-module workspaces, and per-package `dist` outputs are not part of this final repo.

## Evidence Carried Forward

- Source-cited business rules are preserved in `docs/business-rules.md`.
- Architecture intent is preserved in `docs/architecture.md` and Mermaid diagrams under `docs/diagrams/`.

## Validation Baseline

A valid publish candidate should pass:

- `pnpm install --frozen-lockfile`
- `pnpm test`
- `pnpm run build`
- `pnpm pack --dry-run --json`
- `npx --no-install expo98 --version`
- `npx --no-install expo98 --json doctor`
- `npx --no-install expo98 --json project-info --cwd .`
