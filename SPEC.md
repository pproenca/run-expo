# expo98 CLI Specification

## Package Contract

`expo98` is a Node 20+ ESM npm package. The public executable contract is:

```json
{
  "bin": {
    "expo98": "./cli/expo98.mjs",
    "expo-ios": "./cli/expo-ios.mjs"
  }
}
```

`expo98` is the supported command for new usage. `expo-ios` exists for compatibility and delegates to the same bundled implementation.

## Output Contract

- `--json` writes stable machine-readable `{ ok, data }` or `{ ok: false, error }` envelopes.
- `--plain` writes stable line-oriented output.
- Human output is best-effort and should not be parsed.
- Secret-bearing fields must be redacted in CLI output and persisted run records.

## Command Families

- Discovery: `doctor`, `project-info`, `routes`, `devices`, `target`, `session`, `snapshot`, `refs`, `find`, `get`, `wait`, `batch`.
- Simulator and app actions: `boot-simulator`, `open-url`, `launch-app`, `terminate-app`, `reload-app`, `install-app`, `uninstall-app`, `open-route`, `screenshot`, gestures, keyboard, clipboard, and explicit simulator settings.
- Evidence and runtime: logs, UX context, review overlay, DevTools, console/errors, Metro, navigation, network, storage, state, controls, bridge, accessibility, dialogs, recording, diffs, Expo/RN inspection, performance, dashboard, policy, redaction, and live backlog commands.

## Safety Contract

State-changing commands require an explicit action policy. Runtime evaluation, bridge installation/removal, storage mutation, app/device mutation, and similar actions must fail closed unless policy allows them. Noninteractive runs never prompt.

## Build Contract

`npm run build` bundles `src/bundled-cli.ts` into `cli/expo98.mjs`. The checked-in bundle is required so `npx expo98 ...` works from the packed package without rebuilding source modules.

## Test Contract

Root tests verify package entrypoints and packed CLI behavior. Module tests verify transformed behavior at package boundaries. A valid release candidate must pass root tests, rebuild the bundle, pass the full module sweep, and satisfy `npm pack --dry-run --json`.
