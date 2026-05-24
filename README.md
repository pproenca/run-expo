# expo98

`expo98` is a modernized local evidence CLI for Expo and React Native iOS work. It ships as one bundled Node executable so the normal entrypoint is:

```bash
npx expo98 --version
npx expo98 --json doctor
npx expo98 --json project-info --cwd /path/to/expo-app
```

The npm package exposes `expo98` as the primary binary and keeps `expo-ios` as a compatibility alias. The transformed modules in this repository are source and test inputs; they are not exposed as separate npm workspace packages.

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
npm ci
npm test
npm run build
npm pack --dry-run --json
```

`npm run build` regenerates `cli/expo98.mjs` from `src/bundled-cli.ts`. The packed CLI intentionally contains the executable bundle, compatibility wrapper, package metadata, README, and license rather than publishing every transformed source module.

## Repository Shape

- `src/bundled-cli.ts` contains the bundled CLI source entrypoint.
- `cli/expo98.mjs` is the generated executable used by `npx expo98`.
- `cli/expo-ios.mjs` is a compatibility wrapper.
- Module directories such as `project-info-doctor/`, `policy-redaction/`, and `runtime-service-contracts/` contain transformed TypeScript packages with focused tests and transformation notes.
- `docs/` contains curated modernization context carried forward from the rewrite.

## Modernization Notes

This repo replaced a legacy monolithic `dist/expo-ios.mjs` runtime with tested, source-owned modules and a generated single executable. See `docs/modernization.md`, `docs/architecture.md`, and `docs/business-rules.md` for the behavior and architecture record.
