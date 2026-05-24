# @expo98/typed-contract-surface

Modernized TypeScript transformation of the legacy typed command, record, adapter, and runtime alias contract surface.

This package exposes runtime constants for the command-name union, command effects, runtime alias table, known contract/runtime mismatches, selected arg action sets, record statuses, and adapter method contracts.

## Commands

```bash
npm test
```

The tests are characterization tests derived from `legacy/expo98/src/contracts/commands.ts`, `legacy/expo98/src/contracts/args.ts`, `legacy/expo98/src/contracts/records.ts`, `legacy/expo98/src/adapters/interfaces.ts`, and `legacy/expo98/dist/expo-ios.mjs:12071-12148`.
