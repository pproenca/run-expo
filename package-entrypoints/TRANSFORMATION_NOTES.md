# package-entrypoints Transformation Notes

## Scope

This slice modernizes the package entrypoint and local install boundary from:

- `legacy/expo98/package.json`
- `legacy/expo98/Makefile`
- `legacy/expo98/cli/expo-ios.mjs`

Output lives in `modernized/expo98/package-entrypoints/`.

## Mapping

| Legacy source | Modern target | Behavior |
| --- | --- | --- |
| `legacy/expo98/package.json:2-6` | `src/main/index.ts:17-34` | Preserves legacy package name, version, private flag, description, and ESM type as source-cited characterization data. |
| `legacy/expo98/package.json:7-13` | `src/main/index.ts:23-29`, `src/main/index.ts:83-87` | Preserves legacy `expo-ios` bin path and npm scripts, with script lookup helper. |
| `legacy/expo98/package.json:14-25` | `src/main/index.ts:1-9`, `src/main/index.ts:30-33` | Preserves legacy Node engine and package file inclusion list. |
| `legacy/expo98/Makefile:1-4` | `src/main/index.ts:70-112` | Preserves default prefix, bin dir, Makefile-relative CLI path, and install-plan input shape. |
| `legacy/expo98/Makefile:6-17` | `src/main/index.ts:55`, `src/main/index.ts:95-112` | Preserves phony targets and `install-local` command sequence. |
| `legacy/expo98/cli/expo-ios.mjs:1-3` | `src/main/index.ts:57-65`, `src/main/index.ts:115-120` | Preserves Node shebang and compatibility-wrapper import shape. |
| npx-facing modernization requirement | `src/main/index.ts:11-15`, `src/main/index.ts:36-57`, `modernized/expo98/package.json`, `modernized/expo98/src/bundled-cli.ts`, `modernized/expo98/cli/expo98.mjs` | Adds a materialized modern package root with `bin.expo98`, compatibility `bin.expo-ios`, and a generated single-file Node 20 ESM executable bundle. |

## Deliberate Deviations

- The modern package does not mutate the filesystem. `createLocalInstallPlan`
  returns the equivalent install command plan so tests and future installers can
  inspect or execute it explicitly.
- The default prefix is represented as `~/.local` instead of expanding `$HOME`;
  callers that execute the plan should resolve it in their environment.
- The materialized modern package is npx-facing and therefore is not marked
  `private`. The legacy manifest remains captured separately with its original
  private flag.
- `expo98` is the primary bin name. `expo-ios` remains as a compatibility bin
  that delegates to `expo98`.
- The modern package uses transformed modules as build inputs, then publishes a
  generated `cli/expo98.mjs` bundle. `npm pack --dry-run` verifies that
  internal package source directories are not included in the npx-facing package.

## Not Migrated

- No `make` process execution, symlink creation, chmod, npm script execution, or
  CLI process spawning is performed here.
- The source workspace remains split across transformed modules for
  characterization and maintainability. The published package shape is not a
  monorepo: it contains the generated executable, package metadata, compatibility
  bin, and README.
- Some side-effecting commands still depend on the host project, native tools,
  Metro, Hermes, or explicit action policy. They are bundled into the executable
  but may return structured unavailable/error payloads when those runtime
  prerequisites are absent.

## Review Notes

- Architecture review was performed locally. No high-severity issues were
  found; the package is deterministic and side-effect free.
- `cli-executable-wrapper` now preserves the process-level wrapper behavior
  that the generated `cli/expo98.mjs` file uses after composing the bundled
  runtime. This package remains the package/install metadata boundary.
