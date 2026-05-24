# Hermes Runtime Diagnostics Transformation Notes

## Scope

This module modernizes Hermes runtime diagnostics and CDP helper behavior from
`legacy/expo98/dist/expo-ios.mjs`.

| Legacy source | Modern source | Behavior |
| --- | --- | --- |
| `dist/expo-ios.mjs:9753-9804` | `src/main/index.ts` `inspectHermesRuntime` | Handles missing targets/WebSocket support, connects to Hermes CDP, enables Runtime/Debugger, waits `350ms`, gathers heap/globals/component hierarchy, summarizes app scripts, returns diagnostics, and closes the client. |
| `dist/expo-ios.mjs:9806-9830` | `src/main/index.ts` `evaluateHermesExpression` | Connects, enables Runtime, returns enable errors with diagnostics, evaluates expressions with `returnByValue` and `awaitPromise`, and closes the client. |
| `dist/expo-ios.mjs:9974-9983` | `src/main/index.ts` `responseShape` | Produces bounded primitive, array, object, result-type, and nested result shapes. |
| `dist/expo-ios.mjs:9985-9998` | `src/main/index.ts` `normalizeProtocolError`, `protocolErrorMessage`, `shortDiagnostic` | Preserves bounded CDP error messages, code defaults, optional data truncation, and short diagnostic truncation. |
| `dist/expo-ios.mjs:10005-10027` | `src/main/index.ts` `summarizeScripts` | Counts observed/app scripts, keeps first 40 app scripts, decodes source owners, strips query strings and localhost hosts, and keeps owners under `/apps/mobile/app/`. |

## Deliberate Deviations

- The concrete WebSocket CDP client is dependency-injected. The legacy bundle
  constructed `HermesCdpClient` directly; injection keeps the transform
  deterministic and allows future composition with a shared transport package.
- The React component hierarchy expression is injected. A separate transform
  owns that large runtime probe expression.

## Not Migrated

- `HermesCdpClient` socket internals and the React component hierarchy runtime
  probe expression remain separate follow-up slices.

## Proof

Characterization tests in `src/test/characterization.test.ts` cover:

- unavailable target/WebSocket payloads
- inspect call ordering, timeout values, wait duration, skipped component mode,
  diagnostics, script summaries, error handling, and close behavior
- expression evaluation runtime-enable behavior, enable errors, evaluate params,
  timeout propagation, diagnostics, and close behavior
- response shape, protocol error/message normalization, diagnostic truncation,
  runtime globals expression markers, and script owner summarization

## Follow-ups

- Transform the concrete `HermesCdpClient` transport and
  `reactComponentHierarchyProbeExpression` as standalone packages.
