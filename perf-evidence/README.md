# @expo98/perf-evidence

Modernized TypeScript transform for legacy `expo-ios perf` and `expo-ios
profiler`.

## Scope

This package covers:

- `perf summary`
- `perf startup|action`
- `perf mark|measure|js-thread|frames`
- `perf compare|budget`
- `perf memory`
- `perf ettrace|memgraph`
- `perf bundle`
- performance bridge expression generation and evidence artifact writes

Project, Metro, Hermes, and filesystem dependencies are injectable so the module
can be tested without live runtime tooling.

## Verification

```bash
npm test
```
