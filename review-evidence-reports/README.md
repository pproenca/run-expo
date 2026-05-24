# @expo98/review-evidence-reports

Modernized TypeScript transform for legacy `expo-ios` review report, review
matrix, and evidence diff commands.

## Scope

This package covers:

- `review report|matrix`
- `diff snapshot|screenshot|route`
- state-root normalization, latest-session lookup, latest-ref lookup, run-record
  listing, run summaries, and JSON artifact writes used by those commands

Route diffs keep route opening and screenshot capture injectable so this package
assembles evidence without owning simulator interaction adapters.

## Verification

```bash
npm test
```
