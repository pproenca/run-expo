# @expo98/dashboard-observability

Modernized TypeScript transform for legacy `expo-ios dashboard start|status|stop`.

## Scope

This package covers:

- dashboard state transitions
- static dashboard JSON artifact writes
- static dashboard HTML artifact writes
- session summary projection from the Expo state root

The dashboard command records local static observability artifacts. It does not
start a network server.

## Verification

```bash
npm test
```
