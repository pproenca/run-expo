# project-filesystem-helpers Transformation Notes

## Scope

Transformed the legacy project filesystem helper cluster from `legacy/expo98/dist/expo-ios.mjs` into a typed TypeScript module at `modernized/expo98/project-filesystem-helpers`.

Business rule coverage:

- `RULE-022`: Project-scoped commands normalize user cwd values to existing directories and, unless explicitly allowed, anchor behavior at the nearest Expo project `package.json`.
- `RULE-024`: Project probes inspect local files deterministically without starting tools or mutating the source tree.

## Mapping

| Legacy source | Target source | Behavior |
| --- | --- | --- |
| `legacy/expo98/dist/expo-ios.mjs:11816-11824` | `src/main/index.ts:10-20` | `normalizeProjectCwd` resolves an existing cwd, optionally allows a missing `package.json`, otherwise returns the ancestor project root. |
| `legacy/expo98/dist/expo-ios.mjs:11826-11833` | `src/main/index.ts:22-29` | `normalizeCwd` resolves cwd/default process cwd and throws `Directory does not exist: <path>` for non-directories. |
| `legacy/expo98/dist/expo-ios.mjs:11835-11844` | `src/main/index.ts:31-40` | `findUp` checks the start directory before walking parent directories to the filesystem root. |
| `legacy/expo98/dist/expo-ios.mjs:11846-11848` | `src/main/index.ts:42-44` | `readJsonFile` reads UTF-8 JSON and propagates `JSON.parse` errors. |
| `legacy/expo98/dist/expo-ios.mjs:11850-11863` | `src/main/index.ts:46-59` | `detectPackageManager` searches upward for lockfiles in `pnpm`, `yarn`, `bun`, `npm` priority per directory. |
| `legacy/expo98/dist/expo-ios.mjs:11865-11871` | `src/main/index.ts:61-67` | `firstExisting` returns the first candidate name that exists under a root. |
| `legacy/expo98/dist/expo-ios.mjs:11873-11875` | `src/main/index.ts:69-71` | `pathExists` resolves to `true` or `false` from filesystem access. |
| `legacy/expo98/dist/expo-ios.mjs:11877-11890` | `src/main/index.ts:73-86` | `walkFiles` recursively collects files and skips `node_modules` plus dot-prefixed entries. |

## Characterization Tests

Tests live in `src/test/characterization.test.ts` and cover:

- Directory normalization and legacy error messages.
- Project-root normalization with and without `allowMissingPackageJson`.
- Upward filename search and no-match behavior.
- JSON parsing success and syntax-error propagation.
- Package-manager lockfile priority and ancestor walking.
- First existing candidate order.
- `fs.access`-style path existence.
- Recursive file walking with skipped `node_modules` and dot directories.

Current verification:

```bash
cd modernized/expo98/project-filesystem-helpers && npm test
```

## Deliberate Deviations

- Kept these helpers as focused functions rather than tying them to a command object. The legacy behavior was already function-oriented, and the target shape makes reuse explicit for modules that currently carry private copies.

## Not Migrated

- Route parsing remains in `router-sitemap`.
- Command-level use of these helpers remains in each owning modernized package until a shared package graph is wired.

## Follow-Ups

- Replace duplicated helper copies in `project-info-doctor`, `route-url-actions`, and future project-scoped modules with this package when cross-package dependencies are introduced.

## Architecture Review

Self-review findings:

- High: preserve exact package-manager detection order because reports use this value as user-facing project evidence.
- Medium: keep `walkFiles` skip rules narrow to match legacy behavior and avoid accidentally hiding route files.

Applied fixes:

- Added characterization tests for lockfile priority, ancestor walking, and `walkFiles` skip behavior.
