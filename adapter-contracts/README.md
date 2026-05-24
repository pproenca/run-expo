# @expo98/adapter-contracts

Modernized adapter boundary contracts for expo98.

This package turns the legacy type-only files in `src/adapters` into an
importable TypeScript package with:

- runtime adapter-name constants grouped by legacy source file
- a source-cited adapter catalog
- common adapter payload types and interface shapes
- a small registry for wiring concrete adapter implementations by contract name

## Verification

```bash
npm test
```

