# App Lifecycle Actions Transformation Notes

## Scope

Transformed app/device lifecycle behavior from `legacy/expo98/dist/expo-ios.mjs` into the TypeScript package `modernized/expo98/app-lifecycle-actions`.

Rules covered:

- `RULE-021`: bounded subprocess output uses the legacy overflow marker.
- `RULE-022`: direct app/device mutation actions are policy-gated in the transformed module, including legacy direct-device gaps.
- `RULE-027`: iOS launches attach post-launch crash evidence and mark the action unavailable when matching crash reports appear.

## Legacy To Modern Mapping

| Behavior | Legacy source | Modern target | Notes |
| --- | --- | --- | --- |
| Boot iOS simulator and optionally open Simulator.app | `legacy/expo98/dist/expo-ios.mjs:2362-2379` | `src/main/index.ts:77-99` | Preserves `xcrun simctl boot`, `open -a Simulator`, timeout values, and requested-device echo; adds RULE-022 policy gate. |
| Launch Android app by package/activity or monkey fallback | `legacy/expo98/dist/expo-ios.mjs:2400-2414` | `src/main/index.ts:101-123` | Preserves `adb shell am start -n` when activity is supplied and `adb shell monkey -p` otherwise; adds RULE-022 policy gate. |
| Launch iOS app and attach crash evidence | `legacy/expo98/dist/expo-ios.mjs:2416-2436` | `src/main/index.ts:125-153` | Preserves `xcrun simctl launch`, exec-error availability, and crash evidence hook; adds RULE-022 policy gate. |
| Terminate app | `legacy/expo98/dist/expo-ios.mjs:2438-2468` | `src/main/index.ts:155-196` | Preserves dry-run payloads, Android force-stop, iOS simctl terminate, and unavailable exec errors; adds RULE-022 policy gate. |
| Reload app | `legacy/expo98/dist/expo-ios.mjs:2470-2483` | `src/main/index.ts:198-217` | Preserves terminate-and-launch strategy and nested payloads; adds RULE-022 policy gate before nested mutations. |
| iOS crash evidence, matching reports, metadata parsing | `legacy/expo98/dist/expo-ios.mjs:2485-2548` | `src/main/index.ts:219-303` | Preserves wait clamping, numeric coercion, report extension/type/mtime filtering, bundle/process matching, first-line JSON parsing, and crash report sorting. |
| Install app | `legacy/expo98/dist/expo-ios.mjs:2550-2583` | `src/main/index.ts:305-347` | Preserves policy gate, dry-run payload, Android `adb install -r`, iOS `simctl install`, app-path resolution, and timeouts. |
| Uninstall app | `legacy/expo98/dist/expo-ios.mjs:2585-2615` | `src/main/index.ts:349-391` | Preserves policy gate, dry-run payload, Android `adb uninstall`, iOS `simctl uninstall`, bundle resolution, and timeouts. |
| Bundle id inference | `legacy/expo98/dist/expo-ios.mjs:2617-2625` | `src/main/index.ts:393-402` | Preserves explicit `bundleId`/`packageName` precedence and runtime summary fallback order. |
| App log collection and iOS predicate builder | `legacy/expo98/dist/expo-ios.mjs:2627-2633`, `legacy/expo98/dist/expo-ios.mjs:11923-11969` | `src/main/index.ts:404-451` | Preserves Android line clamp, legacy numeric coercion, iOS `last` validation, log predicate generation, escaping, command args, and buffers. |
| Subprocess truncation | `legacy/expo98/dist/expo-ios.mjs:12038-12056` | `src/main/index.ts:453-457` | Preserves 40,000 character limit and `[truncated N characters]` marker. |
| Policy denied payload shape | `legacy/expo98/dist/expo-ios.mjs:7292-7359` | `src/main/index.ts:488-499` | Preserves app-domain policy denied JSON shape. |

## Proof

Characterization tests were written first in `src/test/characterization.test.ts`.

Latest package result:

```text
npm test
# tests 38
# suites 10
# pass 38
# fail 0
```

After architecture HIGH fixes:

```text
npm test
# tests 44
# suites 10
# pass 44
# fail 0
```

The tests cover Android and iOS launch/terminate/reload flows, policy-denied no-subprocess paths for all mutating lifecycle actions, install/uninstall policy gates, crash report evidence, legacy numeric coercion, bundle id inference, app log collection, booting simulators, predicate escaping, and subprocess output truncation.

## Deliberate Deviations

- The transformed module returns plain typed payload objects instead of legacy `toolJson(...)` envelopes. This keeps the package reusable as an adapter library; the CLI compatibility facade can wrap results at the boundary.
- Filesystem and process-global behavior is injected through `AppLifecycleDependencies` where practical. This makes crash reports, simulator resolution, runtime summaries, delays, and subprocess calls deterministic under characterization tests.
- `boot-simulator`, `launch-app`, `terminate-app`, and `reload-app` now apply the RULE-022 policy gate even though the legacy source executed these commands directly. This is an intentional modernization hardening required by the extracted business rule.

## Not Migrated

- The generic CLI command dispatcher and `toolJson` wrapping were not migrated into this module.
- The concrete legacy filesystem implementation for listing DiagnosticReports was replaced by an injected dependency. This package owns matching logic, not host filesystem traversal.
- The concrete legacy `execFilePromise` implementation is covered by `modernized/expo98/app-lifecycle-process-adapter`. This package accepts that adapter through `AppLifecycleDependencies.execFile`.

## Architecture Review

Architecture critic HIGH findings applied:

- Added policy gates and policy-denied tests for `bootSimulator`, `launchApp`, `terminateApp`, and `reloadApp`.
- Restored legacy finite-number coercion for crash waits, report cutoffs, and Android log line counts; added numeric string and invalid-value tests.

Remaining non-HIGH findings:

- `resolveBundleId` defaults missing `cwd` to `"."` for adapter determinism rather than process-global `process.cwd()`. A CLI facade should pass the actual process cwd explicitly.
- Invalid platform values normalize to iOS because the transformed package exposes a narrow `Platform` union. A CLI facade should validate raw argv before calling this adapter.
- Crash report metadata parsing now avoids the N+1 dependency call inside `matchingIosCrashReports`; `readCrashReportMetadata` remains available for direct read-by-path behavior.

## Follow-Ups

- Connect the eventual CLI facade to wrap these payloads in the legacy JSON/text envelope and pass `app-lifecycle-process-adapter` as the process dependency.
- Decide whether `collect-app-logs` should remain a read-style diagnostic adapter or join the app lifecycle mutation policy surface in the CLI facade.
- Add consumer-level redaction for subprocess stderr/stdout if app commands can expose sensitive values in future integrations.
