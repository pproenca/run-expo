# @expo98/hermes-runtime-diagnostics

Modernized Hermes runtime diagnostics behavior extracted from
`legacy/expo98/dist/expo-ios.mjs`.

This package preserves:

- `inspectHermesRuntime` CDP call ordering and payload shaping
- `evaluateHermesExpression` runtime-enable and evaluation behavior
- protocol response/error diagnostics
- loaded app script summarization

Run:

```bash
npm test
```
