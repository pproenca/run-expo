# @expo98/bridge-domain-actions

Modernized TypeScript transform for the legacy `expo-ios` storage, state, and
controls bridge-domain commands.

## Scope

This package covers:

- `storage list|get|set|clear`
- `state list|save|load|clear`
- `controls list|get|press`
- shared bridge-domain runtime transport, policy, unavailable, and redaction
  helpers used by those commands

The module keeps Metro target discovery, Hermes `Runtime.evaluate`, policy-file
reads, and redaction injectable so it can compose with the modernized policy,
Metro, and CLI/router packages.

The exported execution surface is the command handlers. Raw bridge execution and
runtime expression builders are internal so storage/state mutations and control
presses always pass through policy checks before `Runtime.evaluate`.

## Verification

```bash
npm test
```
