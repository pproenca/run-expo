# Runtime Inspector Actions Transformation Notes

## Scope

This module modernizes the legacy runtime inspector and iOS dev-menu command
slice from `legacy/expo98/dist/expo-ios.mjs`.

| Legacy source | Modern source | Behavior |
| --- | --- | --- |
| `dist/expo-ios.mjs:9387-9420` | `src/main/index.ts` `runtimeInspector` | Normalizes action, clamps Metro port and max comments, dispatches `open-dev-menu`, probes Metro targets, evaluates Hermes expression, and returns the legacy inspector payload envelope. |
| `dist/expo-ios.mjs:9422-9428` | `src/main/index.ts` `normalizeRuntimeInspectorAction` | Preserves inspector action vocabulary and unknown-action error text. |
| `dist/expo-ios.mjs:9430-9497` | `src/main/index.ts` `openIosDevMenu` | Attempts Metro `/message` devMenu broadcast, optional dev-client repair, crash-report early return, retry broadcast, then simulator shake fallback. |
| `dist/expo-ios.mjs:10466-10778` | `src/main/index.ts` `runtimeInspectorExpression` | Generates the runtime-side review state, probe/comment branches, and comment summary envelope used by Hermes evaluation. |

## Deliberate Deviations

- Metro HTTP, Hermes CDP evaluation, Metro `/message` websocket broadcast,
  simulator resolution, dev-client repair, and process execution are dependency
  injected. The legacy command used ambient helpers directly.
- The runtime expression is reduced to the stable command/result branches this
  package owns. The legacy expression also searched Metro module internals for
  React Native DevSettings and Alert implementations; those live-runtime probes
  should move into an adapter that can evolve per React Native version.
- `runTool` output formatting is not duplicated here; this package returns the
  same `toolJson` envelope for command compatibility.

## Not Migrated

- The concrete `ExpoMessageClient` websocket implementation remains an adapter
  concern. This module preserves how its results are interpreted.
- iOS crash-report discovery for dev-client repair remains behind the injected
  `openDevClientForMessageSocket` dependency.

## Proof

Characterization tests cover:

- action validation and numeric clamping
- JSON tool envelope behavior
- no-target unavailable payload
- Hermes expression evaluation payload shape
- `protocolError` and `cdp` selection
- `open-dev-menu` delegation
- Metro message broadcast success
- dev-client crash early return
- dev-client repair plus rebroadcast success
- simulator shake fallback and output truncation
- runtime expression branch generation

## Follow-ups

- Build the concrete Metro message websocket and dev-client repair adapters
  against this package.
- Expand the runtime expression adapter when the final modernized CLI chooses a
  supported React Native/Expo compatibility target.

