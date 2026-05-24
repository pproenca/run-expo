# semantic-bridge-snapshot-adapter

Transport adapter for the legacy `semanticBridgeSnapshot(args, context)` helper.

It selects a Metro/Hermes target, evaluates the semantic snapshot expression,
normalizes raw bridge refs, adds transport diagnostics, and returns the same
semantic bridge payload shape consumed by snapshot and accessibility commands.
