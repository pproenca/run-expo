# interaction-actions

Modernized TypeScript adapter for expo98 device interaction actions.

Current status: transformed with characterization coverage.

Legacy sources:

- `legacy/expo98/dist/expo-ios.mjs:2961-3519`
- `legacy/expo98/dist/expo-ios.mjs:7292-7369`
- `legacy/expo98/dist/expo-ios.mjs:12038-12056`
- `legacy/expo98/tests/test_cli.mjs:1219-1295`
- `legacy/expo98/tests/test_cli.mjs:3518-3645`

Covered behavior:

- coordinate and ref-based tap dispatch
- ref action orchestration for focus, blur, fill, long-press, double-tap, drag, scroll, and scroll-into-view
- clipboard and keyboard commands
- simulator environment mutation planning
- raw gesture planning, execution, repeated command capture, screenshots, and trace hooks
- `ref-actions-wait` adapter composition
- RULE-021 output truncation
- RULE-022 policy-denied mutation paths
