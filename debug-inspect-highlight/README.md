# @expo98/debug-inspect-highlight

Modernized TypeScript transform for legacy `expo-ios inspect` and
`expo-ios highlight`.

## Scope

This package covers:

- cached ref debug inspection
- latest session and selected target context in inspect payloads
- Metro status summary projection in inspect payloads
- highlight SVG evidence artifact generation from cached bounds
- stale, missing, and no-snapshot ref failure payloads

The command preserves legacy tool JSON envelopes while keeping Metro and
filesystem adapters injectable for deterministic tests and later router
composition.

## Verification

```bash
npm test
```
