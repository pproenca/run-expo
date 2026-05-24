# @expo98/cli-contracts

Modernized CLI parser, output writer, and runtime contracts for expo98.

This package keeps the legacy `src/cli` scaffold as a small runtime-testable
surface:

- `ParsedCli`, `CliParser`, `CliOutputWriter`, and `CliRuntime` contracts
- runtime constants for parsed fields, global option keys, and interface names
- `createParsedCli` for defensive record construction
- `createCliRuntime` for composing context creation, dispatch, and output writing

## Verification

```bash
npm test
```

