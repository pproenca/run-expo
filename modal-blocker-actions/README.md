# @expo98/modal-blocker-actions

Modernized TypeScript transform for the legacy `expo-ios` dialog and sheet
modal blocker commands.

## Scope

This package covers:

- `dialog status|accept|dismiss`
- `sheet status|dismiss`
- shared Metro/Hermes `Runtime.evaluate` transport envelopes for those modal
  bridge domains
- redacted and bounded output payloads for modal bridge evidence

The exported execution surface is the command handlers. Raw modal runtime
expressions are internal so future router integration can keep policy and output
boundaries centralized.

## Verification

```bash
npm test
```
