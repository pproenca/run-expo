# @expo98/metro-message-client

Modernized Metro `/message` websocket client for expo98.

This package covers:

- `ExpoMessageClient.broadcast`
- `ExpoMessageClient.discoverPeers`
- `ExpoMessageClient.openDevClient`
- helper wrappers for `broadcastMetroMessage` and
  `openDevClientForMessageSocket`

The implementation keeps websocket creation, process execution, crash evidence,
clock, wait, environment, and timeout behavior injectable so tests can prove the
legacy protocol without a live Metro server or simulator.

## Verification

```bash
npm test
```

