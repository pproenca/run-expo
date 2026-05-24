# @expo98/command-pipeline-contracts

Modernized command registry and middleware pipeline contracts for expo98.

This package turns the legacy type-only command scaffold into a small runtime
surface that downstream modules can use in characterization tests and future
command composition:

- immutable command-family and built-in middleware name arrays
- command definition, handler, outcome, registry, and pipeline contracts
- an in-memory registry with deterministic replacement by command name
- a composable middleware pipeline that freezes the chain at build time

## Verification

```bash
npm test
```

