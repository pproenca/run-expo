# Interaction Trace Expression Transformation Notes

## Scope

This module modernizes the large interaction trace `Runtime.evaluate`
expression from `legacy/expo98/dist/expo-ios.mjs`.

| Legacy source | Modern source | Behavior |
| --- | --- | --- |
| `dist/expo-ios.mjs:9350-9377` | `src/main/index.ts:38` `traceInteraction` | Preserves the `trace` command boundary: clamps Metro port and event limits, handles missing Hermes targets, evaluates the trace expression with an 8000ms timeout, and returns target, trace, protocol error, and CDP diagnostics in the legacy tool envelope. |
| `dist/expo-ios.mjs:10029-10464` | `src/main/index.ts` `interactionTraceExpression` | Builds the trace expression for `start`, `read`, `clear`, and `stop`; maintains the `__EXPO_LOCAL_DEV_INTERACTION_TRACE__` global; patches React DevTools commit hooks and `requestAnimationFrame`; summarizes fiber props, active elements, layout changes, handler-bearing components, counts, recent events, and interpretation hints. |

## Deliberate Deviations

- The expression builder remains standalone and pure; `traceInteraction`
  restores the legacy command boundary over injected Metro target and Hermes
  evaluation adapters.
- Tests execute the generated expression in isolated VM contexts instead of
  requiring a live Hermes runtime.

## Not Migrated

- Concrete Metro target discovery and `Runtime.evaluate` transport remain
  injected dependencies so the command can be composed with the transformed
  transport adapters without opening sockets in unit tests.
- Gesture execution and screenshot evidence remain in `interaction-actions`.

## Proof

Characterization tests in `src/test/characterization.test.ts` cover:

- `traceInteraction` tool envelope helpers, clamping, optional string handling,
  no-target payloads, Metro fetch failures, expression evaluation, target
  summaries, protocol errors, and CDP diagnostics
- embedded action/maxEvents/filter/includeEvents and tracer global markers
- unknown action payload
- start/read behavior without React DevTools hook
- requestAnimationFrame patching, animation-frame events, and stop restoration
- clear behavior and `lastSnapshot` reset
- React commit tree walking, active elements, declared handlers, component
  counts, layout-change detection, and component filtering
- event inclusion only when `includeEvents` is true

## Follow-ups

- The final CLI composition should bind registry symbol `traceInteraction` to
  this package export with the concrete Metro target and Hermes evaluation
  adapters.
