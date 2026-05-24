# @expo98/expo-introspection-actions

Modernized Expo introspection actions for the expo98 CLI.

This package covers the legacy `expo` command actions:

- `modules`
- `config`
- `doctor`
- `upstream-policy`
- `prebuild-plan`

The implementation is dependency-injected so characterization tests can prove the
legacy filesystem and project-summary behavior without mutating the legacy
checkout.

## Verification

```bash
npm test
```

