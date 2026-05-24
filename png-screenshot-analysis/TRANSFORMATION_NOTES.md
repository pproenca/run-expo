# PNG Screenshot Analysis Transformation Notes

## Scope

This module modernizes the PNG screenshot analysis helpers used by the legacy UX
context command in `legacy/expo98/dist/expo-ios.mjs`.

| Legacy source | Modern source | Behavior |
| --- | --- | --- |
| `dist/expo-ios.mjs:11332-11348` | `src/main/index.ts` `analyzePngScreenshot`, `analyzePngBuffer` | Decodes PNG pixels, samples colors, computes palette/luminance/composition, appearance guess, and designer guidance. |
| `dist/expo-ios.mjs:11350-11354` | `src/main/index.ts` `pngDimensions`, `pngDimensionsFromBuffer` | Reads PNG dimensions from the IHDR header or returns `null`. |
| `dist/expo-ios.mjs:11356-11422` | `src/main/index.ts` `parsePng` | Parses PNG chunks, validates signature/bit-depth/interlace/color-type, inflates IDAT data, unfilters scanlines, and normalizes pixels to RGBA. |
| `dist/expo-ios.mjs:11424-11443` | `src/main/index.ts` `unfilterScanline`, `paeth` | Preserves PNG filter algorithms and unsupported-filter errors. |
| `dist/expo-ios.mjs:11446-11568` | `src/main/index.ts` visual helpers | Preserves sampling, palette bucketing, luminance percentiles, composition regions, background estimation, color distance, and hex formatting. |

## Deliberate Deviations

- `analyzePngBuffer` and `pngDimensionsFromBuffer` are exported in addition to
  file-based helpers so tests and future adapters can avoid filesystem setup
  when a screenshot buffer is already available.
- CRC values are not inspected, matching the legacy parser, which skipped PNG
  CRC validation.

## Not Migrated

- Native screenshot capture remains in `screenshot-capture`.
- UX context assembly remains in `ux-context-capture`.

## Proof

Characterization tests cover full analysis output, dimension reads, all legacy
supported color types, transparent sample skipping, palette/luminance math,
scanline filter algorithms, unsupported encodings, empty composition summaries,
and helper color math.

## Follow-ups

- Wire `ux-context-capture` to this package in the final CLI composition layer.

