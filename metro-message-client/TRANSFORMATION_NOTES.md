# Metro Message Client Transformation Notes

## Scope

This module modernizes the Metro `/message` websocket client used by the
runtime inspector dev-menu path in `legacy/expo98/dist/expo-ios.mjs`.

| Legacy source | Modern source | Behavior |
| --- | --- | --- |
| `dist/expo-ios.mjs:9499-9505` | `src/main/index.ts` `openDevClientForMessageSocket`, `broadcastMetroMessage` | Preserves helper functions that create an `ExpoMessageClient` per call. |
| `dist/expo-ios.mjs:9507-9511` | `src/main/index.ts` `ExpoMessageClient` constructor | Stores `metroPort` and builds `ws://127.0.0.1:<port>/message`. |
| `dist/expo-ios.mjs:9513-9566` | `src/main/index.ts` `openDevClient` | Optional terminate, `simctl openurl`, reconnect timeout clamp, repeated peer discovery, availability classification, and crash-evidence merge. |
| `dist/expo-ios.mjs:9568-9570` | `src/main/index.ts` `discoverPeers` | Delegates to `broadcast(null)`. |
| `dist/expo-ios.mjs:9572-9636` | `src/main/index.ts` `broadcast` | Handles missing WebSocket, open failure, `getpeers`, getpeers timeout/error, no peers, optional method broadcast, wait, success payload, formatted errors, and socket close. |

## Deliberate Deviations

- WebSocket construction, subprocess execution, crash evidence, clock, wait,
  timeout, environment, and formatting are dependency-injected. The legacy
  implementation used ambient globals and process helpers.
- `openDevClientForMessageSocket` takes `metroPort` as its first argument rather
  than reading it from a loose object. This keeps the wrapper explicit while
  preserving the underlying payload behavior.

## Not Migrated

- `openIosDevMenu` remains in `runtime-inspector-actions`; this package only
  owns the Metro message client and dev-client repair helper it depends on.
- Real iOS crash log discovery is injected as `crashEvidence`; its lower-level
  implementation is covered by app lifecycle diagnostics.

## Proof

Characterization tests cover:

- no-WebSocket unavailable payload
- peer discovery and broadcast message JSON
- null-method discoverPeers behavior
- getpeers errors and empty-peer unavailable payloads
- websocket open failure and formatted reason
- getpeers timeout fallback
- dev-client terminate/openurl/reconnect loop
- reconnect timeout unavailability
- helper wrappers and shared formatting helpers

## Follow-ups

- Wire `runtime-inspector-actions` to this package in the final CLI composition
  layer.

