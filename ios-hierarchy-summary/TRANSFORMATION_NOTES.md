# ios-hierarchy-summary Transformation Notes

## Scope

Transformed the legacy iOS hierarchy summarization behavior from `legacy/expo98/dist/expo-ios.mjs` into a typed TypeScript module at `modernized/expo98/ios-hierarchy-summary`.

Business rule coverage:

- `RULE-021`: Command output captured from external tools is truncated before being returned as diagnostic evidence.
- `RULE-024`: UX context probes report unavailable evidence instead of failing when optional local tooling is absent.

## Mapping

| Legacy source | Target source | Behavior |
| --- | --- | --- |
| `legacy/expo98/dist/expo-ios.mjs:11572-11588` | `src/main/index.ts:49-82` | `describeIosHierarchy` locates `axe`, runs `axe describe-ui --udid <udid>` with the legacy timeout and buffer, returns unavailable envelopes on missing CLI or process error, and parses stdout JSON. |
| `legacy/expo98/dist/expo-ios.mjs:11590-11636` | `src/main/index.ts:84-143` | `summarizeHierarchy` walks array or single roots, counts elements, roles, depth, labels, non-zero frames, content bounds, and empty app-shell insight. |
| `legacy/expo98/dist/expo-ios.mjs:12045-12049` | `src/main/index.ts:145-150` | `truncate` converts nullish values to an empty string and appends the legacy truncation marker after `MAX_OUTPUT`. |

## Characterization Tests

Tests live in `src/test/characterization.test.ts` and cover:

- Role/depth/frame/label aggregation and content bounds.
- Empty `AXApplication` shell detection and insight text.
- Primitive root handling.
- Sample label cap at 80 entries.
- Missing `axe` unavailable envelope.
- `axe describe-ui` command arguments, timeout, and buffer options.
- Truncated stdout/stderr on `axe` process errors.
- Invalid JSON propagation from stdout.

Current verification:

```bash
cd modernized/expo98/ios-hierarchy-summary && npm test
```

## Deliberate Deviations

- Added dependency injection for command lookup and execution. The default path preserves legacy subprocess behavior; tests can characterize the wrapper without requiring `axe` or a simulator.

## Not Migrated

- Higher-level UX context aggregation remains in `ux-context-capture`.
- iOS log collection and plist probing are covered by `ios-native-context-probes`.

## Follow-Ups

- Wire this package into `ux-context-capture` when shared package dependencies are introduced.

## Architecture Review

Self-review findings:

- High: preserve missing-tool unavailable behavior because `axe` is optional in local developer environments.
- Medium: preserve sample label truncation at 80 entries to keep context payloads bounded.

Applied fixes:

- Added tests for unavailable, error, malformed output, and successful summary paths.
