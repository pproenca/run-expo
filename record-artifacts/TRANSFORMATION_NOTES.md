# record-artifacts Transformation Notes

## Scope

Transformed recording artifact metadata behavior from
`legacy/expo98/dist/expo-ios.mjs` into a typed TypeScript module at
`modernized/expo98/record-artifacts`.

Business rule coverage:

- `RULE-013`: recording artifacts live under the active Expo state root and
  include latest session/target metadata when available.
- `RULE-035`: record artifacts provide captured evidence metadata without making
  unsupported claims about native video capture.

## Mapping

| Legacy source | Target source | Behavior |
| --- | --- | --- |
| `legacy/expo98/dist/expo-ios.mjs:7867-7871` | `src/main/index.ts:25-35` | `recordCommand` defaults to `start`, rejects unknown actions, resolves state root, latest session, and recording directory. |
| `legacy/expo98/dist/expo-ios.mjs:7872-7884` | `src/main/index.ts:36-49` | `start` writes `recording.json` metadata and returns metadata plus `metadataPath`. |
| `legacy/expo98/dist/expo-ios.mjs:7885-7902` | `src/main/index.ts:50-64` | `stop` resolves output path, creates a placeholder only when missing, writes stopped metadata, and returns it. |
| `legacy/expo98/dist/expo-ios.mjs:1534-1545` | `src/main/index.ts:71-82` | Latest-session lookup sorted by `updatedAt ?? createdAt`. |
| `legacy/expo98/dist/expo-ios.mjs:1383-1390`, `1553-1555`, `11846-11848`, `13045-13047` | `src/main/index.ts:84-103` | State-root normalization, session directory path, JSON reads, and pretty JSON writes with trailing newline. |
| `legacy/expo98/dist/expo-ios.mjs:12500-12506` | `src/main/index.ts:29-30`, `src/test/characterization.test.ts:81-90` | CLI positional action and output path behavior. |

## Characterization Tests

Tests live in `src/test/characterization.test.ts` and cover:

- Start metadata for the latest session target.
- Persisted start metadata excludes the response-only `metadataPath`.
- Stop metadata and placeholder output creation.
- Existing output files are not overwritten.
- Default stop output filename timestamps.
- No-session `sessionId`/`targetId` null behavior.
- `--state-dir .../runs` parent normalization.
- Unknown-action error messages.

Current verification:

```bash
cd modernized/expo98/record-artifacts && npm test
```

Result: 5 tests passing.

## Deliberate Deviations

- The clock is injectable for deterministic tests and router composition.
- The package exposes small state helpers used by tests and future composition;
  behavior remains filesystem-backed like the legacy command.

## Legacy Behavior Preserved

- `record stop` writes `recording placeholder\n` only if the requested output
  file does not already exist.
- `record start` persists metadata without `metadataPath`, then returns a
  response object that includes `metadataPath`.
- Native video capture is not implemented by this command; it only records
  tracer-bullet metadata.

## Not Migrated

- Native video capture adapters are not part of the legacy `record` behavior.
- Review/diff evidence assembly is covered by `review-evidence-reports`.
- Final CLI router wiring is deferred until command modules are transformed.

## Follow-Ups

- Wire `recordCommand` into the final modernized CLI router.
- If native recording is added later, keep this metadata path as the evidence
  envelope and replace only the placeholder writer with a real capture adapter.
