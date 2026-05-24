# @expo98/runtime-service-contracts

Modernized runtime service and shared DTO contracts for expo98.

This package turns the legacy service boundary files into a small importable
TypeScript surface:

- route records, route segment kinds, command plans, and action evidence DTOs
- schema validator, redactor, artifact, run-record, snapshot, session, event,
  policy, output-boundary, and config service contracts
- deterministic helpers for validation outcomes, output bounding, and event
  stream handles used by characterization tests

## Verification

```bash
npm test
```

