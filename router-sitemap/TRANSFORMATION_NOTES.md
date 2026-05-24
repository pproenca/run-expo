# router-sitemap Transformation Notes

## Scope

Transformed Expo Router sitemap and route-context behavior from `legacy/expo98/dist/expo-ios.mjs` into a typed TypeScript module at `modernized/expo98/router-sitemap`.

Business rule coverage:

- `RULE-025`: Expo Router files ignore `_layout`, classify `+` files as special, omit route groups and `index`, and map dynamic segments.

## Mapping

| Legacy source | Target source | Behavior |
| --- | --- | --- |
| `legacy/expo98/dist/expo-ios.mjs:1201-1229` | `src/main/index.ts:109-128` | `expoRouterSitemap` resolves cwd/appDir, returns the missing app-dir warning shape, walks files, filters route extensions, sorts routes and special files, and returns MCP text JSON. |
| `legacy/expo98/dist/expo-ios.mjs:11692-11718` | `src/main/index.ts:130-150` | `expoRouteContext` builds route metadata without evaluating route files and parses typed routes from `.expo/types/router.d.ts`. |
| `legacy/expo98/dist/expo-ios.mjs:11877-11890` | `src/main/index.ts:93-107` | `walkFiles` recursively collects ordinary files while skipping `node_modules` and dot directories. |
| `legacy/expo98/dist/expo-ios.mjs:11892-11919` | `src/main/index.ts:74-90`, `src/main/index.ts:174-179` | `routeFromFile` strips supported route extensions, classifies layout/special files, omits groups/index, and formats dynamic, optional, and rest segments. |

## Characterization Tests

Tests live in `src/test/characterization.test.ts` and cover:

- Root and nested `index` route mapping.
- Route group omission.
- `_layout` and `+` special-file classification.
- Dynamic `[id]`, optional `[[slug]]`, and rest `[...rest]` segment formatting.
- Supported extension stripping.
- Recursive file walking with `node_modules` and dot-directory skips.
- Sitemap route/special sorting and missing app-dir warning shape.
- Injected path/filesystem resolution and legacy cwd directory validation.
- Typed-route parsing with de-duplication and sorting.
- Proof that route modules are not read, imported, or evaluated.

Current verification:

```bash
cd modernized/expo98/router-sitemap && npm test
```

Result: 14 tests passing.

## Deliberate Deviations

- Filesystem and path access are dependency-injected for deterministic tests and future CLI composition.
- `cwd` is resolved through the path adapter and then validated with the filesystem stat adapter, matching the legacy `normalizeCwd` boundary.

## Not Migrated

- Top-level CLI command registration.
- Project package discovery beyond the explicit `allowMissingPackageJson: true` sitemap behavior.

## Follow-Ups

- Wire this module into the eventual modernized CLI router.
- Share cwd normalization with the future project-info/upstream-policy package once it is transformed.

## Architecture Review

Architecture critic findings after first implementation:

- High: `expoRouterSitemap` no longer validated that `cwd` exists and is a directory before returning app-dir warnings.
- Medium: sitemap payload typing permits invalid success/warning combinations.
- Medium: tests originally missed the cwd stat boundary.
- Nit: notes could imply package discovery was required by this command path.

Applied fixes:

- Restored cwd stat validation with the legacy `Directory does not exist: ...` error.
- Added characterization coverage for stat calls, missing cwd, and cwd-as-file.
- Tightened the sitemap payload type so success results require `routeCount` and warning results cannot include it.
- Clarified the package-discovery note.

Remaining non-High items:

- None for this module.
