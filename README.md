# expo98

Standalone project for the `expo-ios` CLI.

`expo-ios` is a local evidence CLI for Expo React Native iOS work. It inspects
Expo projects, discovers simulators/devices and Metro targets, opens deep
links, captures screenshots and semantic snapshots, collects logs, and writes
redacted review/session records under `.scratch`.

## Usage

Run directly from this checkout:

```bash
node cli/expo-ios.mjs --json doctor
node cli/expo-ios.mjs --plain project-info --cwd /path/to/expo-app
```

Install the executable locally:

```bash
make install-local
expo-ios --json doctor
```

Or use the package bin from this repo:

```bash
npm link
expo-ios --version
```

## Development

```bash
npm test
npm run doctor
```

The CLI contract is documented in [SPEC.md](./SPEC.md).
