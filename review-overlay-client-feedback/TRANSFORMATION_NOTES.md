# Review Overlay Client Feedback Transformation Notes

## Scope

This module modernizes pure client-side review overlay feedback helpers from
`legacy/expo98/dist/expo-ios.mjs`.

| Legacy source | Modern source | Behavior |
| --- | --- | --- |
| `dist/expo-ios.mjs:4814-4831` | `src/main/index.ts` `pointFromNativeEvent`, `pointFromPointerEvent`, `pointFromCoordinates` | Clamps event coordinates to viewport bounds and derives normalized `nx`/`ny` values. |
| `dist/expo-ios.mjs:4833-4855` | `src/main/index.ts` `pointerEndpointFrom`, `copyEndpointFrom` | Rewrites a configured endpoint to `/pointer` or `/copy`, clearing query/hash, with legacy localhost fallback URLs for invalid endpoints. |
| `dist/expo-ios.mjs:4857-4867` | `src/main/index.ts` `copyFeedbackToClipboard` | POSTs JSON `{ text }` to the copy endpoint and returns `response.ok`, or `false` on fetch failure. |
| `dist/expo-ios.mjs:4870-4903` | `src/main/index.ts` `inspectElementAtPoint`, `normalizeInspectorData`, `primitiveString` | Handles missing inspector globals, catches inspector errors, normalizes selected hierarchy props, labels, roles, test IDs, component stack, and selected hierarchy marks. |
| `dist/expo-ios.mjs:4910-4925` | `src/main/index.ts` `parseSourceFromComponentStack` | Extracts the first non-`node_modules` file/line/column from supported React component stack formats. |
| `dist/expo-ios.mjs:4927-4989` | `src/main/index.ts` `formatElementLink`, `formatFeedbackMarkdown`, `formatElementLocation`, `formatElementSource`, `formatSource`, `firstComponentStackSource`, `isNoisyHierarchyName`, `escapeMarkdown` | Preserves feedback markdown, source formatting, hierarchy noise filtering, URL stack fallback, and quote escaping behavior. |

## Deliberate Deviations

- Viewport dimensions are explicit arguments instead of coming from React
  Native `Dimensions.get("window")`.
- Fetch and inspector lookup are explicit adapters. The legacy implementation
  closed over ambient `fetch`, `getInspectorDataForViewAtPoint`, and
  `findNodeHandle` from generated React Native component code.

## Not Migrated

- The generated React Native review overlay component source remains in the
  legacy bundle and in existing workflow packages. This module owns only the
  pure feedback and formatting behavior.

## Proof

Characterization tests in `src/test/characterization.test.ts` cover:

- native/pointer coordinate precedence, clamping, and normalized values
- pointer/copy endpoint rewriting and invalid URL fallbacks
- clipboard POST request shape and failure handling
- inspector data selection, props fallback, source parsing, and error guards
- component stack parsing, noisy hierarchy filtering, source/link formatting,
  markdown formatting, primitive string conversion, and quote escaping

## Follow-ups

- Wire these helpers into the generated overlay component source when the
  modernized review overlay app package is composed.
