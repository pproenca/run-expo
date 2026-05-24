# bridge-install-status-adapter

Filesystem adapter for the legacy `bridgeInstallStatus(projectRoot)` helper in
`expo-ios.mjs`.

The adapter reads `package.json`, `.expo-ios/bridge.json`, and
`src/expo-ios-devtools-bridge.ts`, then returns the same status envelope as the
legacy CLI. Dependencies are injectable for characterization tests and default
to Node filesystem/path behavior.
