# Transformation Notes: ux-context-capture

## Scope

Transformed the legacy `captureUxContext` evidence assembly flow:

- project runtime summary
- Metro/runtime inspection
- component hierarchy extraction and runtime cleanup
- bundle/process inference
- installed app info lookup
- screenshot and image analysis capture
- Expo Router route context
- iOS hierarchy capture
- optional filtered iOS logs
- safe section error wrapping

The `annotateScreen` file generation and local HTTP sidecar server wrappers remain separate transforms.

## Rule Coverage

| Rule | Coverage |
| --- | --- |
| `RULE-035` | Preserves evidence aggregation without making unsupported visual-quality judgments. |
| `RULE-012` | Indirectly supports annotation workflows by producing the context artifact consumed by annotation boards; server mutation behavior is covered by `review-sidecar-state`. |

## Mapping

| Legacy source | Modern source | Behavior |
| --- | --- | --- |
| `legacy/expo98/dist/expo-ios.mjs:3545-3574` | `src/main/index.ts:56` | Initializes timing, cwd, device, Metro port, default context fields, and review questions. |
| `legacy/expo98/dist/expo-ios.mjs:3576-3581` | `src/main/index.ts:81` | Wraps project runtime summary with safe section behavior. |
| `legacy/expo98/dist/expo-ios.mjs:3583-3600` | `src/main/index.ts:84` | Handles runtime inclusion, Metro inspection, component hierarchy fallback, and deletes `componentHierarchy` from runtime. |
| `legacy/expo98/dist/expo-ios.mjs:3602-3614` | `src/main/index.ts:108` | Infers bundle ID from explicit args, Metro targets, or project config; derives process name; wraps installed app info lookup. |
| `legacy/expo98/dist/expo-ios.mjs:3616-3627` | `src/main/index.ts:121` | Captures screenshots unless skipped and runs image analysis only after a successful screenshot. |
| `legacy/expo98/dist/expo-ios.mjs:3629-3631` | `src/main/index.ts:134` | Wraps route context and unwraps successful results. |
| `legacy/expo98/dist/expo-ios.mjs:3633-3639` | `src/main/index.ts:137` | Captures or skips iOS hierarchy. |
| `legacy/expo98/dist/expo-ios.mjs:3641-3654` | `src/main/index.ts:144` | Validates log time windows, wraps filtered iOS logs, or returns skipped logs with a suggested process filter. |
| `legacy/expo98/dist/expo-ios.mjs:3656` | `src/main/index.ts:161` | Computes elapsed milliseconds and returns pretty JSON tool text. |
| `legacy/expo98/dist/expo-ios.mjs:11782-11790`, `11993-11999`, `12045-12051` | `src/main/index.ts:165` | Preserves optional string, bundle process-name, safe-section, and numeric clamp helper behavior. |

## Characterization Tests

`src/test/characterization.test.ts` covers:

- full UX context assembly and runtime `componentHierarchy` deletion
- `includeRuntime`, `includeScreenshot`, and `includeHierarchy` skip branches
- missing component hierarchy fallback
- app lookup safe failure shape
- explicit bundle/process log filtering
- invalid `logsLast` validation
- safe wrapping for project, Metro, screenshot, route, hierarchy, and log failures
- helper contracts for optional strings, process names, clamping, safe sections, and tool JSON

## Deliberate Deviations

- External probes are injected through `UxContextDependencies` instead of closed over global functions. This keeps characterization tests deterministic and lets later CLI adapters wire simulator/Metro implementations explicitly.
- Time is injected for tests but defaults to real `Date`/`Date.now` when adapters omit it.
- The package does not generate annotation HTML or serve local HTTP. Those concerns are separate from evidence assembly and have different hardening requirements.

## Architecture Review

Local review found no high-severity issues. The implementation preserves legacy behavior while isolating side effects behind dependencies and keeping the output contract compatible with the legacy JSON envelope. Low-severity follow-up: the future `annotate-screen` transform should consume this package instead of reimplementing context capture.

## Representative Diff

Use this command from the modernization workspace:

```bash
diff -u <(sed -n '3545,3656p' legacy/expo98/dist/expo-ios.mjs) <(sed -n '56,162p' modernized/expo98/ux-context-capture/src/main/index.ts)
```
