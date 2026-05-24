# @expo98/package-entrypoints

Modernized package manifest, CLI wrapper, and local install contract for expo98.

This package preserves the legacy install/run boundary as runtime-checkable
TypeScript data:

- package identity, bin, scripts, engine, and published file list
- Makefile target names and local symlink install plan
- CLI wrapper shebang and bundled dist import delegation

## Verification

```bash
npm test
```

