# @expo98/mac-simulator-bridge-adapter

Modernized macOS Simulator bridge adapter extracted from
`legacy/expo98/dist/expo-ios.mjs`.

The package preserves the legacy helpers for:

- reading the macOS cursor through `cliclick p`
- writing the macOS clipboard through `pbcopy`
- reading and caching Simulator window bounds through `osascript`

Run:

```bash
npm test
```
