# ios-crash-evidence Transformation Notes

## Scope

Transformed iOS crash evidence helpers from `legacy/expo98/dist/expo-ios.mjs` into a typed TypeScript module at `modernized/expo98/ios-crash-evidence`.

Business rule coverage:

- `RULE-021`: App lifecycle actions attach bounded diagnostic evidence rather than silently ignoring post-action crashes.
- `RULE-024`: Crash evidence scans local DiagnosticReports without mutating the project or device.

## Mapping

| Legacy source | Target source | Behavior |
| --- | --- | --- |
| `legacy/expo98/dist/expo-ios.mjs:2470-2480` | `src/main/index.ts:57-73` | `attachIosCrashEvidence` is a no-op for non-iOS payloads, merges no-crash evidence, and marks payloads unavailable when reports match. |
| `legacy/expo98/dist/expo-ios.mjs:2482-2497` | `src/main/index.ts:75-96` | `iosCrashEvidence` clamps wait time to `0..30000`, optionally waits, and returns crash-check metadata plus matching reports. |
| `legacy/expo98/dist/expo-ios.mjs:2499-2530` | `src/main/index.ts:98-141` | `matchingIosCrashReports` scans `.ips`/`.crash` files, filters by mtime, matches bundle id or process name, projects metadata, and sorts by path. |
| `legacy/expo98/dist/expo-ios.mjs:2532-2541` | `src/main/index.ts:143-157` | `readCrashReportMetadata` parses only first-line JSON and returns `null` for non-JSON, invalid JSON, or unreadable files. |

## Characterization Tests

Tests live in `src/test/characterization.test.ts` and cover:

- Non-iOS no-op attachment.
- Wait clamping and crash-check payloads.
- Bundle-id, filename process-name, and metadata process-name matching.
- Extension, mtime, directory, and missing-selector filters.
- No-crash merge behavior.
- Crash-match unavailable payload and reason text.
- First-line crash metadata parsing failure modes.

Current verification:

```bash
cd modernized/expo98/ios-crash-evidence && npm test
```

## Deliberate Deviations

- Added filesystem and wait dependency injection. Defaults preserve legacy DiagnosticReports scanning, while tests avoid touching host crash logs.

## Not Migrated

- App launch/terminate/reload/install/uninstall command orchestration remains in `app-lifecycle-actions`.
- Subprocess execution and redaction are covered by command adapter packages.

## Follow-Ups

- Wire this package into `app-lifecycle-actions` when shared dependencies are consolidated.

## Architecture Review

Self-review findings:

- High: preserve first-line-only metadata parsing because `.ips` reports often contain header JSON followed by non-JSON content.
- Medium: preserve filename process matching because metadata can be absent or malformed.

Applied fixes:

- Added tests for metadata, filename, extension, mtime, no-op, and unavailable evidence paths.
