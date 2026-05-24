# batch-orchestration characterization tests

These tests pin the legacy `expo-ios` batch orchestration behavior before a TypeScript implementation exists.

Source evidence:

- `legacy/expo98/dist/expo-ios.mjs:2092-2159` for `batchCommand`, `normalizeBatchSteps`, `runBatchStep`, and `batchStepError`.
- `legacy/expo98/dist/expo-ios.mjs:12059-12064` and `legacy/expo98/dist/expo-ios.mjs:13069-13090` for formatted/redacted error envelopes and exit-code classification.
- `legacy/expo98/dist/expo-ios.mjs:12071-12213` for `commandAliases` and `runTool` behavior.
- `legacy/expo98/dist/expo-ios.mjs:12215-12318` for representative `commandArgs` mappings used by batch-supported commands.
- `legacy/expo98/dist/expo-ios.mjs:12779-12908` for `parseCliArgs`, `coerceCliValue`, and `parseJsonArgument`.
- `analysis/expo98/BUSINESS_RULES.md` RULE-023 for serial batch execution and optional bail, RULE-007 for invalid-usage envelopes, and RULE-021 for formatted output truncation/redaction.

The test package intentionally provides only `src/main/index.d.ts`. `npm test` should type-check this contract and then fail at runtime with `ERR_MODULE_NOT_FOUND` for `dist/main/index.js` until the implementation step is approved.
