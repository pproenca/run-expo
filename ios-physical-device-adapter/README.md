# @expo98/ios-physical-device-adapter

Typed transformation of the iOS physical device listing adapter from `legacy/expo98/dist/expo-ios.mjs`.

The module runs `xcrun devicectl list devices --json-output -` and maps both modern nested and older flat payload shapes into the legacy physical-device summary.

