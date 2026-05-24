# project-info-doctor

Transformed TypeScript package for the legacy `expo-ios` doctor and
project/tooling discovery behavior.

Source scope:

- `legacy/expo98/dist/expo-ios.mjs:815-1200`
- `legacy/expo98/dist/expo-ios.mjs:1383-1391`
- `legacy/expo98/dist/expo-ios.mjs:9685-9724`
- `legacy/expo98/dist/expo-ios.mjs:11782-12070`
- `legacy/expo98/tests/test_cli.mjs:830-997`
- `analysis/expo98/BUSINESS_RULES.md` RULE-011 and RULE-021

The implementation preserves the legacy project-info and doctor payloads,
including package manager detection, Expo config summaries, EAS summaries,
upstream dependency compatibility classification, command capability probing,
safe error sections, and bounded output formatting.

`doctor --fix` only creates the legacy local scratch directories under
`.scratch/expo-ios`.
