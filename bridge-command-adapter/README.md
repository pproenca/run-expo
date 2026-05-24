# bridge-command-adapter

Filesystem-backed adapter for the legacy `bridgeCommand(args)` boundary in
`expo-ios.mjs`.

It preserves legacy status and plan envelopes, delegates bridge health/domain
probing through an injected dependency, and performs confirmation-gated bridge
install/remove mutations against project files.
