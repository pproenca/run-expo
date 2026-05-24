# bridge-health-payload-adapter

Transport orchestration for the legacy `bridgeHealthPayload(args, context)`
helper in `expo-ios.mjs`.

The adapter composes bridge install status, Metro target evidence, Hermes
`Runtime.evaluate` results, runtime domain normalization, policy preview, and
stable unavailable envelopes.
