# @expo98/app-instrumentation-contracts

Modernized dev-only app instrumentation bridge contracts for expo98.

This package exposes the generated legacy app bridge surface as an importable,
runtime-checkable TypeScript module:

- schema version, domain, side-effect, interface, and console-level constants
- manifest, domain, tool, bridge, and domain instrumentation types
- helpers for manifest construction, domain lookup, and domain-name validation

## Verification

```bash
npm test
```

