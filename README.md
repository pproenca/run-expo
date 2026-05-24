# expo98

`expo98` is a modernized local evidence CLI for Expo and React Native iOS work. It ships as one bundled Node executable so the normal entrypoint is:

```bash
npx expo98 --version
npx expo98 --json doctor
npx expo98 --json project-info --cwd /path/to/expo-app
```

The npm package exposes `expo98` as the primary binary and keeps `expo-ios` as a compatibility alias.

## Requirements

- Node.js 20 or newer
- npm
- Optional local tools for device-specific commands: `xcrun`, iOS Simulator, Android tooling, Metro, and Expo project dependencies

## Common Commands

```bash
npx expo98 --help
npx expo98 --json doctor
npx expo98 --json project-info --cwd /path/to/expo-app
npx expo98 --json routes --cwd /path/to/expo-app
npx expo98 --json devices
npx expo98 --json policy show
```

State-changing commands are policy-gated. Provide `--action-policy <path>` for commands that mutate app, device, bridge, storage, or simulator state.

## Development

```bash
pnpm install --frozen-lockfile
pnpm expo98 --version
pnpm test
pnpm run build
pnpm pack --dry-run --json
```

`pnpm expo98 ...` runs the checked-in CLI directly for local development without going through `npx` or a packed install.

`pnpm run build` regenerates `cli/expo98.mjs` from `src/bundled-cli.ts`. The checked-in bundle is required so `npx expo98 ...` works from the packed package without rebuilding source.

## Repository Shape

- `src/bundled-cli.ts` contains the source entrypoint for the bundled CLI.
- `src/commands/` contains internal runtime source modules used only to build the bundle.
- `cli/expo98.mjs` is the generated executable used by `npx expo98`.
- `cli/expo-ios.mjs` is a compatibility wrapper.
- `tests/` verifies package entrypoints, direct CLI use, and packed npm contents.
- `docs/` contains curated modernization context carried forward from the rewrite.

## Publishing Check

`pnpm pack --dry-run --json` should include only the package files needed by users: license, README, package metadata, `cli/expo98.mjs`, and `cli/expo-ios.mjs`.
