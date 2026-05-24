# @expo98/ios-native-context-probes

Modernized iOS native probes used by the expo98 UX context workflow.

This package covers:

- filtered `xcrun simctl spawn <udid> log show` collection
- installed app and data container lookup
- selected `Info.plist` field reads through `plutil`
- native helper functions for process names, predicate escaping, truncation, and safe sections

## Verification

```bash
npm test
```

