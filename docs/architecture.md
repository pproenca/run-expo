# Architecture

`expo98` is a local-first Node 20+ CLI for Expo and React Native evidence capture. It is packaged as one executable bundle, but the repository keeps transformed modules split by behavior so tests and ownership stay focused.

## Runtime Shape

- `src/bundled-cli.ts` is the source entrypoint for the bundled executable.
- `scripts/build-bundled-cli.mjs` uses `esbuild` to generate `cli/expo98.mjs`.
- `cli/expo-ios.mjs` preserves the old command name by delegating to `expo98`.
- Module directories contain isolated TypeScript packages with `src/main`, `src/test`, package metadata, and transformation notes.

## Core Concepts

- Commands produce bounded evidence for local app, simulator, Metro, bridge, and project state.
- State-changing actions are denied unless an explicit action policy allows them.
- Evidence output and persisted run records flow through redaction rules before leaving the process.
- Sessions create artifact namespaces for repeatable review, snapshot, and diagnostic workflows.
- The app bridge is development-only and must fail closed outside approved development contexts.

## Packaging Decision

The repo keeps many transformed packages for maintainability, but npm consumers receive one CLI package. This avoids a monorepo install surface while preserving module-level tests and notes for maintainers.

## Diagrams

Mermaid diagrams carried forward from modernization analysis live in `docs/diagrams/`:

- `architecture.mmd`
- `call-graph.mmd`
- `critical-path.mmd`
- `data-lineage.mmd`
