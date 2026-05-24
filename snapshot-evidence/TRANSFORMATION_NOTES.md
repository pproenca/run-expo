# snapshot-evidence transformation notes

## Scope

Transformed the snapshot/ref evidence behavior from the legacy Expo iOS CLI into
a TypeScript module under `modernized/expo98/snapshot-evidence`.

In scope:

- Snapshot precondition validation for session, selected target, and target
  metadata.
- Snapshot filter construction and snapshot ID formatting.
- Native accessibility tree normalization, filtering, ref projection, and
  snapshot-node projection.
- Semantic bridge ref normalization, redaction, filtering, and semantic
  snapshot persistence.
- Durable snapshot/ref-cache write contract through injected persistence.
- `refs` and `get ref` command envelopes and field lookup behavior.

Out of scope:

- Real Metro/Hermes semantic bridge transport is covered by
  `modernized/expo98/semantic-bridge-snapshot-adapter`; this package consumes
  that adapter through `captureSemanticBridge`.
- Real `axe describe-ui` process execution is covered by
  `modernized/expo98/snapshot-native-accessibility-adapter`; this package
  consumes that adapter through `findAxeCli` and `describeNativeUi`.
- Real filesystem-backed state store.

Those runtime integrations are represented as injected dependencies so this
slice preserves the command semantics while staying testable and reusable.

## Mapping

| Behavior | Legacy source | Modern source | Rule |
| --- | --- | --- | --- |
| Snapshot preconditions and semantic/native fallback | `legacy/expo98/dist/expo-ios.mjs:1557` | `src/main/snapshot-command.ts:5` | RULE-010 |
| Filter construction and depth clamp | `legacy/expo98/dist/expo-ios.mjs:1570` | `src/main/filters.ts:7` | RULE-010 |
| Snapshot ID timestamp/random format | `legacy/expo98/dist/expo-ios.mjs:1600`, `legacy/expo98/dist/expo-ios.mjs:1688` | `src/main/ids.ts:1` | RULE-018 |
| Native snapshot persistence and latest refs cache | `legacy/expo98/dist/expo-ios.mjs:1598` | `src/main/persistence.ts:16` | RULE-015 |
| Semantic snapshot ref rewrite and persistence | `legacy/expo98/dist/expo-ios.mjs:1688` | `src/main/persistence.ts:51` | RULE-015 |
| Accessibility tree flattening and filters | `legacy/expo98/dist/expo-ios.mjs:2193` | `src/main/accessibility.ts:13` | RULE-010 |
| Role, frame, source, and action normalization | `legacy/expo98/dist/expo-ios.mjs:2211` | `src/main/accessibility.ts:43` | RULE-010 |
| Ref and snapshot-node projection | `legacy/expo98/dist/expo-ios.mjs:2257` | `src/main/accessibility.ts:87` | RULE-015 |
| Semantic bridge ref normalization and redaction | `legacy/expo98/dist/expo-ios.mjs:1674` | `src/main/accessibility.ts:129` | RULE-015 |
| Latest ref cache and `get ref` field lookup | `legacy/expo98/dist/expo-ios.mjs:1809`, `legacy/expo98/dist/expo-ios.mjs:2182`, `legacy/expo98/dist/expo-ios.mjs:2298` | `src/main/ref-commands.ts:3` | RULE-017 |

## Characterization

The characterization suite is in `src/test/characterization.test.ts`.

It pins concrete input/output behavior for:

- Missing session, missing active target, and missing selected target metadata.
- Filter boolean flags, depth clamping to `1..100`, and invalid-depth errors.
- Snapshot ID format `snapshot-<yyyymmdd-hhmmssz>-<suffix>`.
- Role/frame/action/source normalization.
- Native accessibility preorder flattening with `depth`, `interactiveOnly`, and
  `compact` filters.
- Ref and snapshot node projection with `source` and `bounds` flags.
- Semantic bridge field fallbacks and secret redaction.
- Native and semantic snapshot persistence shapes, including snapshot JSON,
  `refs.json`, and session `lastSnapshotId` updates.
- `refsCommand`, `getRefCommand`, and `refFieldValue` envelopes.

## Deliberate deviations

- The legacy command resolves state roots, invokes Metro/Hermes, finds the
  `axe` binary, shells out, and writes files directly. The transformed module
  receives those operations as explicit dependencies. This is intentional:
  behavior is preserved at the module boundary, while I/O is isolated for
  characterization tests and future adapters.
- The semantic bridge transport expression and Metro/Hermes adapter are covered
  by `semantic-bridge-expression` and `semantic-bridge-snapshot-adapter`. This
  slice consumes already-captured semantic bridge results and
  normalizes/persists them.
- `SnapshotResult.source` remains `string[]` rather than the legacy contract's
  narrower union because the semantic bridge source is runtime-provided in the
  legacy implementation.

## Not Migrated

- `findCommand` and action planning/wait helpers that consume the latest ref
  cache remain outside this slice. They should be transformed in a follow-up
  ref-action/wait module that depends on `RefRecord` and `refFieldValue`.
- CLI JSON wrapping via `toolJson` is not included; this module returns the
  payloads that the CLI wrapper serializes.

## Follow-Ups

- Compose `semantic-bridge-snapshot-adapter` and
  `snapshot-native-accessibility-adapter` into `SnapshotCommandDependencies`
  from the transformed session and target modules.
- Transform ref action planning and wait predicates against this module's
  `RefRecord` contract.
- Add integration tests once the modern CLI composition layer exists.

## Verification

```bash
cd modernized/expo98/snapshot-evidence && npm test
```

Result: 15 tests passing.

## Architecture Review

The architecture-critic reported two HIGH findings, both fixed:

- Semantic snapshot persistence now preserves extra normalized semantic ref
  evidence such as `disabled` and redacted `raw` before rewriting `ref`,
  `snapshotId`, `targetId`, and `stale`.
- `getRefCommand` now performs runtime non-empty string validation for `ref`
  and `field` before ref-shape and field lookup behavior.

Remaining MEDIUM follow-up:

- Path construction currently matches POSIX-style test fixtures. The future
  filesystem/process adapter should centralize `path.join` behavior when this
  module is wired to real disk I/O.
