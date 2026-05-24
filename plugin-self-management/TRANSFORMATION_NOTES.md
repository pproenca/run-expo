# plugin-self-management Transformation Notes

## Scope

Transformed bundled skill listing and local plugin self-management checks from
`legacy/expo98/dist/expo-ios.mjs` into a typed TypeScript module at
`modernized/expo98/plugin-self-management`.

This slice has no dedicated extracted business rule in
`analysis/expo98/BUSINESS_RULES.md`; it covers user-visible dispatcher commands
that report local plugin state and packaging checks.

## Mapping

| Legacy source | Target source | Behavior |
| --- | --- | --- |
| `legacy/expo98/dist/expo-ios.mjs:8803-8819` | `src/main/index.ts:40-60` | `skillsCommand` validates `list|get`, lists skills without content, returns a selected skill with content, and returns the stable not-found payload. |
| `legacy/expo98/dist/expo-ios.mjs:8821-8839` | `src/main/index.ts:62-80` | `listBundledSkills` reads `skills/*/SKILL.md`, skips unreadable/missing files, derives metadata defaults, and sorts by skill name. |
| `legacy/expo98/dist/expo-ios.mjs:8841-8849` | `src/main/index.ts:82-91` | `parseSkillFrontmatter` extracts simple YAML-like metadata and strips wrapping quotes. |
| `legacy/expo98/dist/expo-ios.mjs:8852-8867` | `src/main/index.ts:93-112` | `installCommand` reports prefix, bin path, installed state, Make install command, CLI path, and version. |
| `legacy/expo98/dist/expo-ios.mjs:8869-8882` | `src/main/index.ts:114-131` | `upgradeCommand` reports local authoritative version and no remote upgrade source. |
| `legacy/expo98/dist/expo-ios.mjs:8884-8906` | `src/main/index.ts:133-160` | `releaseCommand` creates a routes fixture and runs version/help/doctor/routes checks. |
| `legacy/expo98/dist/expo-ios.mjs:8909-8925` | `src/main/index.ts:162-187` | `releaseCheck` executes the CLI wrapper, applies a predicate, truncates stdout/stderr to 1000 chars, and converts thrown errors into failed checks. |
| `legacy/expo98/dist/expo-ios.mjs:9329-9335` | `src/main/index.ts:189-195` | CLI wrapper and plugin-root path helpers. |
| `legacy/expo98/dist/expo-ios.mjs:12741-12758` | `src/main/index.ts:44-45`, `97-99`, `118-120`, `137-139` | CLI positional/default action behavior for skills/install/upgrade/release. |

## Characterization Tests

Tests live in `src/test/characterization.test.ts` and cover:

- Skill listing without content and skill get with content.
- Frontmatter parsing, quote stripping, default metadata, unreadable/missing
  skill skipping, and sorting.
- Unknown action errors.
- Install check path construction and installed-state detection.
- Upgrade check local authoritative version payload.
- Release check fixture creation, check ordering, CLI wrapper argv, limitations,
  failure handling, and output truncation.

Current verification:

```bash
cd modernized/expo98/plugin-self-management && npm test
```

Result: 6 tests passing.

## Deliberate Deviations

- `releaseCheck` requires an injected `execFile` dependency. The legacy command
  directly invokes `process.execPath`; injection keeps characterization tests
  deterministic and avoids running the legacy CLI while preserving call shape.
- `pluginRoot`, `homeDir`, and `tmpDir` are injectable for composition and tests.
  Defaults preserve the legacy path derivation.

## Not Migrated

- `live-backlog` is a separate source-derived validation matrix slice.
- Final CLI router wiring is deferred until command modules are transformed.

## Follow-Ups

- Wire these command handlers into the final modernized CLI router.
- Final CLI composition should pass
  `plugin-self-management-process-adapter.createPluginSelfManagementRuntimeDependencies(...)`
  into these handlers for release subprocess execution.
