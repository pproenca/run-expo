# Transformation Notes: command-arg-projection

## Scope

Transformed the legacy `commandArgs(command, args, globals)` switch into a dedicated TypeScript package for all runtime commands:

- project/tooling discovery commands
- session, target, snapshot, refs, get/find/wait/batch commands
- app/device lifecycle commands
- ref, keyboard, clipboard, set, screenshot, tap, gesture, and route commands
- UX/review/annotation/trace commands
- DevTools, Metro, navigation, network, storage, state, controls, bridge commands
- accessibility, dialog, sheet, record, diff, Expo/RN/perf/dashboard/review/policy/redact/skills commands
- install, upgrade, release, and live-backlog commands

This package intentionally owns projection only. It does not parse argv, validate command support, invoke handlers, write output, or persist run records.

## Rule Coverage

| Rule | Coverage |
| --- | --- |
| Assessment command metadata duplication | Extracts the runtime argument projection table from the monolithic bundled CLI into a reusable source module. |
| RULE-001 / RULE-004 / RULE-030 / RULE-031 | Preserves propagation of `actionPolicy`, `allowRuntimeEval`, and `confirmActions` into policy-sensitive command domains. |
| RULE-014 | Preserves `root` and `stateDir` propagation for commands that participate in run/session/snapshot evidence. |
| RULE-026 / RULE-028 | Preserves route auth-cookie projection and gesture evidence flags. |

## Mapping

| Legacy source | Modern source | Behavior |
| --- | --- | --- |
| `legacy/expo98/dist/expo-ios.mjs:12215-12227` | `src/main/index.ts:15` | Computes `cwd` from command args or global root and builds common app/device args. |
| `legacy/expo98/dist/expo-ios.mjs:12229-12318` | `src/main/index.ts:29` | Projects project, session, target, snapshot, ref, wait, and batch commands. |
| `legacy/expo98/dist/expo-ios.mjs:12319-12337` | `src/main/index.ts:119` | Projects simulator/app lifecycle commands. |
| `legacy/expo98/dist/expo-ios.mjs:12338-12455` | `src/main/index.ts:138` | Projects ref actions, keyboard/clipboard/set/logs/screenshot/tap/gesture/open-route commands. |
| `legacy/expo98/dist/expo-ios.mjs:12456-12536` | `src/main/index.ts:255` | Projects UX context, annotation, review overlay, review-next, trace, and annotation server commands. |
| `legacy/expo98/dist/expo-ios.mjs:12537-12624` | `src/main/index.ts:336` | Projects DevTools, console/errors, Metro, navigation, network, storage/state/controls, and bridge commands. |
| `legacy/expo98/dist/expo-ios.mjs:12625-12714` | `src/main/index.ts:424` | Projects accessibility, dialog/sheet, record, diff, Expo/RN, perf/profiler, and dashboard commands. |
| `legacy/expo98/dist/expo-ios.mjs:12715-12777` | `src/main/index.ts:514` | Projects inspect/highlight, review, policy, redact, skills, install/upgrade, release, live-backlog, and default fallback. |

## Characterization Tests

`src/test/characterization.test.ts` covers:

- `cwd` precedence and project/tooling commands
- session/target/snapshot/ref/wait/batch state propagation
- app/device lifecycle and common args
- ref actions, keyboard/clipboard/set/screenshot/tap/gesture/open-route
- review, trace, annotation, DevTools, Metro, navigation, network, storage/state/controls/bridge
- accessibility, dialog/sheet, record, diff, Expo/RN, perf/profiler, dashboard, review/policy/redact/skills/install/upgrade/release/live-backlog
- default fallback and `pickDefined` undefined filtering

## Deliberate Deviations

- TypeScript uses `unknown` for raw parsed CLI values because `parseCliArgs` can produce strings, numbers, booleans, arrays, or JSON-derived values. The projection preserves legacy pass-through behavior rather than over-validating here.
- `Array.includes` comparisons convert positional values to strings in two places. Legacy parsed argv values are normally strings; this keeps the type-safe implementation equivalent for parsed CLI input while avoiding runtime behavior changes for ordinary use.
- The existing `batch-orchestration` package keeps its small internal projection subset for now. This package is the complete projection source for future dispatcher wiring.

## Architecture Review

Local review found no high-severity issues. The package is pure, deterministic, and side-effect free. `cli-runtime-composition` now models the wiring from `command-dispatch-envelope` to this argument projection boundary; the final executable wrapper still needs to pass the concrete export.

## Representative Diff

Use this command from the modernization workspace:

```bash
diff -u <(sed -n '12215,12777p' legacy/expo98/dist/expo-ios.mjs) <(sed -n '15,580p' modernized/expo98/command-arg-projection/src/main/index.ts)
```
