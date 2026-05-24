# @expo98/command-runner-adapter

Modernized subprocess command runner adapter for expo98.

This package covers the shared legacy helpers:

- `execFilePromise`
- `commandPath`
- normalized subprocess error objects

The actual Node `execFile`, cwd, and env sources are injected so command behavior
can be tested without spawning processes.

## Verification

```bash
npm test
```

