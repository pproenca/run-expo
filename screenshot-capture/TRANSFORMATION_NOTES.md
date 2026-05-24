# screenshot-capture Transformation Notes

## Scope

Modernizes the legacy screenshot command cluster from `expo-ios` into `modernized/expo98/screenshot-capture`.

Source references:

- `legacy/expo98/dist/expo-ios.mjs:2634-2960` - `automationTakeScreenshot`, plain screenshots, full screenshots, annotation artifacts, SVG overlays.
- `legacy/expo98/dist/expo-ios.mjs:5071-5078` - `escapeHtml`.
- `legacy/expo98/dist/expo-ios.mjs:11873` - `pathExists`.
- `legacy/expo98/dist/expo-ios.mjs:12038-12056` - `clampNumber` and RULE-021 truncation.
- `legacy/expo98/tests/test_cli.mjs:770-824` - annotated screenshot fixtures.
- `legacy/expo98/tests/test_cli.mjs:1067-1217` - screenshot and full screenshot fixtures.

Business rules:

- `RULE-010`: snapshot/ref metadata must match the active target before annotations are trusted.
- `RULE-015`: annotation uses the latest persisted ref cache and does not invent bounds.
- `RULE-021`: subprocess stdout/stderr is bounded and reports overflow characters.
- `RULE-029`: full screenshots disclose unsupported tooling/platforms and stitching limitations.

## Input/Output Mapping

| Legacy behavior | Modernized implementation | Notes |
| --- | --- | --- |
| `automationTakeScreenshot(args)` routes `full`, then `annotate`, then plain capture and wraps JSON text. | `src/main/index.ts:110` | Keeps the legacy tool text envelope. |
| iOS screenshot uses `xcrun simctl io <udid> screenshot <path>`. | `src/main/index.ts:297` | Returns the same unavailable shape when the command errors or the artifact is missing. |
| Android screenshot delegates to `adbScreenshot`. | `src/main/index.ts:291` | Injection keeps tests deterministic while default behavior shells to `adb exec-out screencap -p`. |
| Full screenshot checks iOS-only, `axe`, `magick`, captures viewport segments, scrolls, restores, stitches. | `src/main/index.ts:121` | Preserves segment naming, coordinate math, tool metadata, and limitation text. |
| `imageDimensions` parses `magick identify -format "%w %h"`. | `src/main/index.ts:271` | Returns `null` for errors or malformed dimensions. |
| Annotated screenshot reads latest ref cache, validates refs/bounds, writes `.labels.json` and `.annotated.svg`. | `src/main/index.ts:338` | Calls the plain screenshot implementation like legacy, then writes artifacts. Default lookup reads the latest session's `refs.json`. |
| Label map filters stale refs and falls back `label -> text -> role -> ref`. | `src/main/index.ts:381` | Mismatched snapshot/target refs fail closed. |
| SVG overlays escape screenshot basenames and ref labels. | `src/main/index.ts:445` | Minimum overlay remains `390x844`, growing to cover boxes plus 24px padding. |

## Deliberate Deviations

- The modernized module exposes dependencies for command execution, device resolution, filesystem writes, and waits so tests can characterize native-tool behavior without requiring simulators or Android devices.
- The default Android implementation buffers the spawned `adb exec-out screencap -p` stdout chunks and writes binary bytes after process close. This avoids the legacy string-conversion/capping hazard while preserving the streaming process boundary.
- `readLatestRefCache` accepts an injected adapter, but also includes the legacy default `.scratch/expo-ios/sessions/<latest>/refs.json` lookup for composition with the transformed snapshot/session packages.

## Verification

- `npm test` in `modernized/expo98/screenshot-capture`: 27 tests passing.
- The tests cover routing, iOS/Android capture, default binary Android streaming, full screenshot unavailability and happy path, image dimension parsing, default persisted ref-cache lookup, annotation cache failure modes, label fallback order, artifact path derivation, SVG escaping, overlay sizing, `clampNumber`, `pathExists`, and RULE-021 truncation.

## Review Notes

- During test integration, two test fixture issues were corrected to match cited legacy source: explicit `refCache: null` now means no cache, and the “current” ref in the mismatch test now carries current snapshot/target IDs.
- The annotation implementation intentionally calls the plain capture path directly, matching `legacy/expo98/dist/expo-ios.mjs:2715`, rather than honoring a dependency override.
- Architecture review HIGH findings were applied: Android capture no longer uses capped/string `execFile` output for default PNG capture, and annotated screenshots no longer require a caller-supplied ref-cache adapter to use persisted latest refs.
- The ref-cache `source` type was widened to `unknown` to compose with `snapshot-evidence`'s persisted `RefRecord` contract.
