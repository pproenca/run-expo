# ref-actions-wait Characterization Tests

These tests pin observable behavior from the legacy `expo-ios` bundle before any
modern implementation exists.

Source-cited legacy behavior:

- `legacy/expo98/dist/expo-ios.mjs:1839-1885` covers `findCommand`,
  `finderActionResult`, and `findMatches`.
- `legacy/expo98/dist/expo-ios.mjs:1887-2090` covers `waitCommand`,
  `waitPredicate`, `evaluateWaitPredicate`, timeout payloads, wait evidence,
  and visible-ref evidence.
- `legacy/expo98/dist/expo-ios.mjs:2323-2359` covers `planRefAction`.
- `legacy/expo98/dist/expo-ios.mjs:3085-3120` covers `refPoint` and
  `scrollPlan`.
- `analysis/expo98/BUSINESS_RULES.md` rules `RULE-008`, `RULE-019`, and
  `RULE-020` describe the validation and coordinate-calculation invariants.

This package intentionally contains only `src/main/index.d.ts` for the future
public API. `npm test` should type-check these characterization tests, then fail
at runtime with `ERR_MODULE_NOT_FOUND` for `dist/main/index.js` until the
implementation is written.
