# Mac Simulator Bridge Adapter Transformation Notes

## Scope

This module modernizes the concrete macOS helpers used by review overlay pointer
mapping and clipboard copy behavior in `legacy/expo98/dist/expo-ios.mjs`.

| Legacy source | Modern source | Behavior |
| --- | --- | --- |
| `dist/expo-ios.mjs:3997-4004` | `src/main/index.ts` `readMacCursorPosition` | Resolves `cliclick`, runs `cliclick p` with `1500ms` timeout and `rejectOnError: false`, parses decimal or negative coordinates, and returns `null` on missing command or malformed stdout. |
| `dist/expo-ios.mjs:4006-4012` | `src/main/index.ts` `writeMacClipboard` | Refuses non-macOS and empty text, resolves `pbcopy`, writes text to stdin with `1500ms` timeout and `rejectOnError: false`, and returns success from the absence of an exec error. |
| `dist/expo-ios.mjs:4014-4035` | `src/main/index.ts` `readSimulatorWindowBounds`, `simulatorWindowBoundsAppleScript` | Reads Simulator window position/size through the legacy AppleScript, parses four numeric values, and caches a valid result for less than `500ms`. |

## Deliberate Deviations

- Command lookup, command execution, current platform, and time are dependency
  injected. Defaults still call local commands, while tests can prove behavior
  without requiring macOS, Simulator, `cliclick`, or `pbcopy`.
- `resetSimulatorWindowBoundsCache` is exported for deterministic tests. The
  legacy implementation used module-level cache state with the same lifetime.

## Not Migrated

- Pointer viewport mapping remains in `review-overlay-server-http` as
  `readSimulatorPointer`.
- Generic `commandPath` and `execFilePromise` remain in
  `command-runner-adapter`; this package only owns the macOS Simulator-specific
  call patterns and parsing rules.

## Proof

Characterization tests in `src/test/characterization.test.ts` cover:

- `cliclick` lookup, command arguments, timeout, coordinate parsing, and null
  paths
- macOS/empty clipboard guards, `pbcopy` lookup, stdin input, timeout, and error
  handling
- exact Simulator AppleScript, output parsing, malformed output, and the
  `<500ms` cache rule

## Follow-ups

- Wire this adapter into the eventual review overlay server composition layer
  together with `review-overlay-server-http` and `command-runner-adapter`.
