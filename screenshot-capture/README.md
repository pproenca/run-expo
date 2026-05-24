# screenshot-capture

Modernization workspace for the legacy `expo-ios` screenshot capture behavior.

Current status: transformed with characterization coverage. The package contains a TypeScript implementation derived from:

- `legacy/expo98/dist/expo-ios.mjs:2634-2960`
- `legacy/expo98/dist/expo-ios.mjs:5071`
- `legacy/expo98/dist/expo-ios.mjs:11873`
- `legacy/expo98/dist/expo-ios.mjs:12038-12056`
- `legacy/expo98/tests/test_cli.mjs:770-824`
- `legacy/expo98/tests/test_cli.mjs:1067-1217`

Covered behavior:

- plain iOS and Android screenshot capture payloads
- full-page segmented iOS screenshots with `axe` gestures and `magick` stitching
- annotated screenshot label-map and SVG artifacts
- default persisted latest-ref cache lookup from `.scratch/expo-ios`
- stale/mismatched/missing-bounds ref cache handling
- binary Android screenshot streaming through `adb exec-out screencap -p`
- RULE-021 bounded stdout/stderr truncation
