# @expo98/devtools-diagnostics

Modernized TypeScript transform for the legacy `expo-ios` DevTools capability
and runtime diagnostics commands.

## Scope

This package covers the legacy behavior for:

- `devtools capabilities`, `devtools status`, `devtools panels`
- `devtools open`
- `devtools events`
- `console`
- `errors`

It keeps Metro probing and Hermes evaluation behind dependency interfaces so the
module can compose with `@expo98/metro-probes`; standalone defaults still use
local Metro endpoints, Node filesystem writes, and macOS `open` where the legacy
command did.

## Verification

```bash
npm test
```
