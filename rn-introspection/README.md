# @expo98/rn-introspection

Modernized TypeScript transform for legacy `expo-ios rn`.

## Scope

This package covers:

- `rn tree`
- `rn fiber`
- `rn renders start|stop|read`
- `rn inspect` over the latest cached ref snapshot
- React Native bridge runtime expression generation
- caveated limitation text for private React Native hooks and fiber fields

Runtime bridge execution and ref-cache reads are dependency-injected so this
module can compose with the transformed bridge and snapshot packages.

## Verification

```bash
npm test
```
