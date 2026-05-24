# shared-runtime-helpers Transformation Notes

## Scope

Transformed a small shared runtime helper cluster from `legacy/expo98/dist/expo-ios.mjs` into a typed TypeScript module at `modernized/expo98/shared-runtime-helpers`.

Business rule coverage:

- `RULE-022`: Command arguments normalize optional string inputs consistently before command-specific defaults are applied.
- `RULE-026`: User-facing URL output must not expose authentication cookies.

## Mapping

| Legacy source | Target source | Behavior |
| --- | --- | --- |
| `legacy/expo98/dist/expo-ios.mjs:11782-11784` | `src/main/index.ts:1-3` | `requireOptionalString` trims non-empty strings and returns `null` for blank or non-string values. |
| `legacy/expo98/dist/expo-ios.mjs:11786-11790` | `src/main/index.ts:5-9` | `processNameFromBundleId` selects the last non-empty bundle-id segment and removes characters outside `[a-zA-Z0-9_-]`. |
| `legacy/expo98/dist/expo-ios.mjs:11792-11799` | `src/main/index.ts:11-19` | `redactUrlAuthCookie` redacts only the `cookie` query parameter, using URL parsing when possible and a case-insensitive regex fallback otherwise. |
| `legacy/expo98/dist/expo-ios.mjs:11801-11814` | `src/main/index.ts:21-33` | `withTimeout` races a promise against a timeout fallback and clears the timer afterward. |

## Characterization Tests

Tests live in `src/test/characterization.test.ts` and cover:

- Optional string trimming and null handling.
- Bundle-id segment selection and process-name sanitization.
- URL parser redaction, encoded bracket output, and non-cookie query preservation.
- Regex fallback redaction for invalid URLs.
- Promise win, fallback win, and rejection propagation for timeout races.

Current verification:

```bash
cd modernized/expo98/shared-runtime-helpers && npm test
```

## Deliberate Deviations

- The helpers are exported as named pure functions. This keeps behavior equivalent while allowing later packages to replace local copies without pulling in command-specific code.

## Not Migrated

- Call-site-specific default values remain in each command module.

## Follow-Ups

- Replace duplicated local implementations in command/action packages once the workspace introduces shared internal dependencies.

## Architecture Review

Self-review findings:

- High: preserve narrow cookie-only redaction in this equivalence package, even though some command packages intentionally harden broader URL secrets.
- Medium: keep `withTimeout` generic so fallback values preserve caller DTO types.

Applied fixes:

- Added characterization tests for URL-parser encoding and invalid-URL regex fallback.
