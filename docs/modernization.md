# Modernization Summary

This repository is the hard replacement for the previous `expo98` checkout at `/Users/pedroproenca/Documents/Projects/expo98`. The replacement preserves git history and replaces the legacy `expo-ios` monolith with the modernized `expo98` CLI workspace.

## What Changed

- Primary executable changed from `expo-ios` to `expo98`; `expo-ios` remains as a compatibility bin.
- Runtime ownership moved from a checked-in monolithic `dist/expo-ios.mjs` file to TypeScript source modules plus a generated bundle at `cli/expo98.mjs`.
- Runtime dependency `esbuild` is declared in `dependencies` so the package can build and pack in normal npm environments.
- The npm package is intentionally one executable CLI package, not a published monorepo.
- Legacy Clawpatch output, generated topology HTML/JSON, local caches, and per-package `dist` outputs were not carried into the final repo.

## Evidence Carried Forward

- Source-cited business rules are preserved in `docs/business-rules.md`.
- Architecture intent is preserved in `docs/architecture.md` and Mermaid diagrams under `docs/diagrams/`.
- Per-module `TRANSFORMATION_NOTES.md` files remain beside transformed modules.

## Validation Baseline

The modernization baseline before replacement was:

- 93 package manifests
- 950 passing module and root tests
- passing root package entrypoint tests
- passing build and dry-run pack checks
- `npx --no-install expo98 --version` returning `0.1.0`
- package dry run containing the executable bundle, compatibility wrapper, README, package metadata, and license
