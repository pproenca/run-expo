# Device Listing

Transformed TypeScript package for legacy device listing behavior from
`legacy/expo98/dist/expo-ios.mjs`.

Covered source:

- `listDevices` and `listIosPhysicalDevices`: lines 1231-1290.
- `safeToolSection`, `clampNumber`, `formatError`, and truncation: lines 11993-12070.

The package is read-only. It lists visible simulators/devices through an
injected `execFile` dependency and preserves the legacy `toolJson` result
shape, safe-section error envelopes, limit clamping, simulator sorting,
physical-device normalization, and Android `adb devices -l` parsing.
