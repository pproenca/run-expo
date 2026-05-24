# navigation-deeplinks Transformation Notes

## Scope

Transformed navigation runtime and deep-link wrapper behavior from `legacy/expo98/dist/expo-ios.mjs` into a typed TypeScript module at `modernized/expo98/navigation-deeplinks`.

Business rule coverage:

- `RULE-030`: Navigation `state` is read-only; `back`, `pop-to-root`, and `tab` require action-policy approval before runtime evaluation. Source-cited legacy behavior keeps `deep-link` on the open-route fallback policy path.
- `RULE-026`: Deep-link navigation carries redacted open-route URL evidence through its returned payload. This module now re-sanitizes adapter output at the wrapper boundary; full URL construction remains in the future open-route slice.

## Mapping

| Legacy source | Target source | Behavior |
| --- | --- | --- |
| `legacy/expo98/dist/expo-ios.mjs:5976-6024` | `src/main/index.ts:205-263` | `navigationCommand` validates actions, clamps Metro ports, checks policy before mutation actions, reads Metro targets, evaluates Hermes, and enriches payloads with target, transport, evidence source, and policy. |
| `legacy/expo98/dist/expo-ios.mjs:6026-6050` | `src/main/index.ts:265-305` | `navigationDeepLink` delegates to open-route behavior, preserves the fallback policy decision, and assembles deep-link evidence with selected target and session IDs. |
| `legacy/expo98/dist/expo-ios.mjs:6052-6074` | `src/main/index.ts:147-166` | `navigationUnavailable` returns the legacy app-instrumentation unavailable envelope and limitations. |
| `legacy/expo98/dist/expo-ios.mjs:6076-6097` | `src/main/index.ts:168-203` | `navigationPolicyDecision` allows `state` as read, allows `deep-link` via open-route fallback policy, and delegates other actions to the central policy adapter. |
| `legacy/expo98/dist/expo-ios.mjs:6099-6107`, `5803-5820` | `src/main/index.ts:114-145` | `targetSummary` and `navigationTransport` preserve the Metro Hermes transport and fallback capability summary shapes. |
| `legacy/expo98/dist/expo-ios.mjs:6109-6213` | `src/main/index.ts:307-411` | `navigationExpression` preserves plugin-bridge lookup, version mismatch handling, navigation action dispatch, tab payloads, and app-instrumentation fallback. |
| `legacy/expo98/dist/expo-ios.mjs:6215-6225` | `src/main/index.ts:413-425` | `selectedTargetId` and `latestSessionId` are adapter-backed helpers for deep-link evidence. |
| `legacy/expo98/dist/expo-ios.mjs:3538`, `11792-11800` | `src/main/index.ts:454-474` | Deep-link wrapper sanitizes open-route URL-bearing strings before returning evidence. |

## Characterization Tests

Tests live in `src/test/characterization.test.ts` and cover:

- Action defaulting to `state`, unknown action rejection, and blank action rejection.
- Metro port defaulting to `8081` and clamping to `1..65535`.
- `navigation.state` read behavior without central policy adapter calls.
- Policy-denied envelopes for `back`, `pop-to-root`, and `tab` before Metro or Hermes calls.
- Deep-link fallback policy, open-route delegation, and selected target/session evidence.
- Boundary redaction for raw `token`, `cookie`, and `authorization` query values returned by the open-route adapter.
- Fail-closed malformed open-route adapter output.
- No-inspector-target and no-Hermes-value unavailable envelopes.
- Successful Hermes value enrichment with action, port, target summary, diagnostics transport, evidence source, and policy.
- Runtime expression behavior for plugin bridge, bridge version mismatch, `state`, `back`, `pop-to-root`, `tab`, `callTool`, and app instrumentation fallback.

Current verification:

```bash
cd modernized/expo98/navigation-deeplinks && npm test
```

Result: 13 tests passing.

## Deliberate Deviations

- Metro target discovery, Hermes evaluation, open-route execution, and session lookup are dependency-injected instead of imported from the monolithic CLI. This keeps the transformed module deterministic and ready for composition into the modernized CLI.
- When no mutation policy adapter is injected, mutation actions return the same denied policy shape the legacy central policy function returns for missing policy. The legacy command reaches that shape through global CLI policy loading.
- `deep-link` deliberately preserves the legacy fallback policy branch at `legacy/expo98/dist/expo-ios.mjs:6087-6094` rather than treating it as a central `navigation.deep-link` policy decision in this slice. The open-route adapter remains the enforcement point for actual simulator URL mutation.
- The wrapper re-sanitizes open-route payload strings to avoid trusting adapter output for RULE-026 redaction.
- Default `selectedTargetId` and `latestSessionId` return `null` until the modernized session package is wired in.

## Not Migrated

- Top-level CLI command registration.
- Concrete `open-route` implementation, device resolution, URL building, and simulator execution; those remain a separate interaction-adapter slice.
- Central action-policy file loading; this package consumes a policy adapter so it can share the modernized policy implementation.
- Direct Metro/Hermes network client implementation; this package consumes runtime adapters shared with the Metro probes package.

## Follow-Ups

- Wire `navigation-deeplinks` to the modernized policy, Metro probes, session-run-records, and future open-route packages in the CLI router.
- Transform the adjacent open-route/app-action interaction slice so RULE-026 can be proven end to end for URL construction and redaction, not only wrapper evidence propagation.

## Architecture Review

Architecture critic findings:

- Blocker: `deep-link` bypasses central navigation mutation policy despite the extracted RULE-030 backlog wording.
- High: RULE-026 redaction was trusted across the open-route adapter boundary.
- Medium: Mutating navigation success paths should get additional allowed-policy coverage.
- Medium: Malformed open-route adapter results should fail closed.
- Nit: Notes overstated full RULE-026 coverage before open-route is transformed.

Applied fixes:

- Resolved the blocker as a source-cited legacy exception in this transformation: `deep-link` stays on the open-route fallback policy path, matching `legacy/expo98/dist/expo-ios.mjs:6087-6094` and `legacy/expo98/SPEC.md:407-411`.
- Added wrapper-level sanitization for raw open-route URL strings and characterization coverage for raw `token`, `cookie`, and `authorization` query values.
- Added typed `OpenRouteResult` adapter shape and a malformed-result unavailable path.
- Clarified RULE-026 coverage as wrapper-level until the open-route slice is transformed.

Remaining non-High items:

- Add successful allowed-policy mutation tests for `back`, `pop-to-root`, and `tab`, including positional tab fallback, when wiring this package into the modernized CLI.
