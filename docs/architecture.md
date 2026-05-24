# Architecture

`expo98` is a local-first Node 20+ CLI for Expo and React Native evidence capture. The repository is intentionally shaped as one publishable npm package with one bundled executable.

## Runtime Shape

- `src/bundled-cli.ts` is the source entrypoint for the bundled executable.
- `src/commands/` contains internal runtime modules; they are source-only build inputs, not npm workspaces.
- `scripts/build-bundled-cli.mjs` uses `esbuild` to generate `cli/expo98.mjs`.
- `cli/expo-ios.mjs` preserves the old command name by delegating to `expo98`.
- `tests/` verifies the package entrypoints and packed npm contents.

## Core Concepts

- Commands produce bounded evidence for local app, simulator, Metro, bridge, and project state.
- State-changing actions are denied unless an explicit action policy allows them.
- Evidence output and persisted run records flow through redaction rules before leaving the process.
- Sessions create artifact namespaces for repeatable review, snapshot, and diagnostic workflows.
- The app bridge is development-only and must fail closed outside approved development contexts.

## Packaging Decision

The modernization workspace used many transformed packages while proving behavior. This final repository does not expose or carry those packages. Users and publishers interact with one npm package: `expo98`.

## Diagrams

Mermaid diagrams carried forward from modernization analysis live in `docs/diagrams/`:

- `architecture.mmd`
- `call-graph.mmd`
- `critical-path.mmd`
- `data-lineage.mmd`
