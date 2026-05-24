# Transformation Notes: typed-contract-surface

## Scope

Transformed the legacy type-only contract surface into runtime-inspectable TypeScript constants:

- `CommandName` union values
- `CommandEffect` union values
- runtime `commandAliases`
- known contract/runtime command mismatches
- selected domain arg action sets and runtime action mismatches
- run/device/Metro/sidecar record status values
- core adapter method contracts

This package does not replace command dispatch. It records the authoritative contract surface and the known mismatches that later dispatch modernization must reconcile.

## Rule Coverage

| Rule | Coverage |
| --- | --- |
| Assessment typed contract surface | Converts the type-level command, result, record, adapter, and app bridge contracts into runtime-verifiable constants. |
| Dangling/mismatched references | Preserves the known mismatch evidence for `instrumentation`, `review-overlay-server`, `annotation-server`, `release`, `live-backlog`, `controls.set`, `storage.trace`, and `record.status`. |

## Mapping

| Legacy source | Modern source | Behavior |
| --- | --- | --- |
| `legacy/expo98/src/contracts/commands.ts:24-82` | `src/main/index.ts:6` | Preserves `CommandName` union values and ordering. |
| `legacy/expo98/src/contracts/commands.ts:84` | `src/main/index.ts:85` | Preserves `CommandEffect` values. |
| `legacy/expo98/dist/expo-ios.mjs:12071-12148` | `src/main/index.ts:87` | Preserves runtime command alias exposure. |
| `legacy/expo98/src/contracts/args.ts:307-349` | `src/main/index.ts:169` | Preserves selected domain action sets for `storage`, `controls`, and `record`, including contract-only actions. |
| `legacy/expo98/src/contracts/args.ts:381-385` | `src/main/index.ts:174` | Preserves `instrumentation` action contract even though runtime has no alias. |
| `legacy/expo98/src/contracts/records.ts:11-59` | `src/main/index.ts:183` | Preserves run/device/Metro/sidecar status enumerations. |
| `legacy/expo98/src/adapters/interfaces.ts:28-120` | `src/main/index.ts:191` | Preserves core adapter method names for command runner, project, device, gesture, Metro, Hermes, and snapshot adapters. |
| `analysis/expo98/ASSESSMENT.md:83-90` | `src/main/index.ts:216` | Preserves mismatch calculation for contract-only/runtime-only commands and action mismatches. |

## Characterization Tests

`src/test/characterization.test.ts` covers:

- command union ordering and absence/presence of known command names
- runtime alias exposure
- computed command mismatch sets
- contract-only domain actions
- record status enumerations
- adapter registry method contracts
- JSON tool output shape

## Deliberate Deviations

- Legacy files are mostly type-only. The modernization intentionally emits runtime constants so downstream modules and tests can inspect the contract surface without TypeScript compiler introspection.
- Only selected arg domains are represented where the assessment identified mismatches. Additional arg unions can be promoted into this package as their command domains are transformed.

## Architecture Review

Local review found no high-severity issues. The package is read-only data plus deterministic mismatch helpers. Medium follow-up: the future command dispatch module should consume `commandSurfaceMismatches()` as an explicit reconciliation checklist.

## Representative Diff

Use this command from the modernization workspace:

```bash
diff -u <(sed -n '24,84p' legacy/expo98/src/contracts/commands.ts) <(sed -n '6,85p' modernized/expo98/typed-contract-surface/src/main/index.ts)
```
