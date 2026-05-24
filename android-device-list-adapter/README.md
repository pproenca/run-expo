# @expo98/android-device-list-adapter

Typed transformation of Android device listing behavior from `legacy/expo98/dist/expo-ios.mjs`.

The module runs `adb devices -l`, skips the header, parses serial/state/details rows, and applies the requested limit.

