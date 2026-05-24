# @expo98/record-artifacts

Modernized TypeScript transform for legacy `expo-ios record start|stop`.

## Scope

This package covers:

- `record start`
- `record stop`
- recording metadata artifact writes under `.scratch/expo-ios/artifacts/recordings`
- latest-session lookup for `sessionId` and `targetId`

The legacy command is a tracer-bullet metadata recorder. It writes placeholder
video output on stop when no output file exists; it does not perform native
video capture.

## Verification

```bash
npm test
```
