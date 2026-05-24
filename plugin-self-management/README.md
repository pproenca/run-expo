# @expo98/plugin-self-management

Modernized TypeScript transform for legacy `expo-ios` plugin self-management
commands.

## Scope

This package covers:

- `skills list|get`
- `install check`
- `upgrade check`
- `release check`

Release checks create the same local routes fixture as legacy and run CLI
packaging probes through an injected process executor.

## Verification

```bash
npm test
```
