# @expo98/ios-simulator-device-list-adapter

Typed transformation of the raw iOS simulator device listing behavior from `legacy/expo98/dist/expo-ios.mjs`.

The module runs `xcrun simctl list devices available --json`, preserves raw simulator fields, sorts booted devices first, and applies the requested limit.

