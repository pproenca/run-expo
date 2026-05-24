# snapshot-evidence characterization tests

These tests pin observable legacy behavior from
`legacy/expo98/dist/expo-ios.mjs:1557-1740`,
`legacy/expo98/dist/expo-ios.mjs:1742-1807`, and
`legacy/expo98/dist/expo-ios.mjs:2182-2331`.

Covered rules from `analysis/expo98/BUSINESS_RULES.md`:

- RULE-010: snapshot capture requires an existing session, an active target, and selected target metadata with a device ID.
- RULE-015: successful native and semantic snapshots write snapshot JSON, refresh `refs.json`, and update `lastSnapshotId`.
- RULE-018: snapshot IDs use a normalized UTC timestamp plus a six-character random suffix.

Run from this package:

```bash
npm test
```

The tests use injected clocks, random suffixes, and in-memory persistence.
They do not run `axe`, talk to Metro, or write real session artifacts.
