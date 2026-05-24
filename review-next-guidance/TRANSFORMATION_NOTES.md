# Transformation Notes: review-next-guidance

## Scope

Transformed the pure review guidance slice of the legacy Review and UX Evidence workflows:

- `reviewNextStep`
- `chooseReviewConstraint`
- `reviewFlowsForSurface`
- `reviewQuestionTriggers`
- `reviewCommandSuggestions`
- `reviewStopConditions`
- `verifierRuleMatchesChangedWorkflow`
- shell quoting and small argument normalization helpers used by this command

The local annotation and review-overlay HTTP servers remain for a later `RULE-012` transform because they have separate filesystem, process, CORS, and hardening concerns.

## Rule Coverage

| Rule | Coverage |
| --- | --- |
| `RULE-035` | Preserved review guidance behavior that assembles evidence requirements, suggested commands, and stop conditions without making UI-quality judgments. |
| `RULE-012` | Not migrated here. Server-backed annotation/overlay behavior is called out as a follow-up because it needs hardened loopback and token/origin handling. |

## Mapping

| Legacy source | Modern source | Behavior |
| --- | --- | --- |
| `legacy/expo98/dist/expo-ios.mjs:5079-5121` | `src/main/index.ts:64` | Builds the `review-next` JSON payload with defaults, constraints, required flows, question triggers, suggested commands, stop conditions, and acceptance contract template. |
| `legacy/expo98/dist/expo-ios.mjs:5123-5187` | `src/main/index.ts:100` | Preserves constraint priority order: decision clarity, baseline evidence, workflow verifier, interaction proof, chrome/navigation proof, affordance validation, static pattern gate, handoff proof. |
| `legacy/expo98/dist/expo-ios.mjs:5189-5254` | `src/main/index.ts:170` | Preserves surface-specific flows for calendar/timeline, navigation, form, list, editor, and generic surfaces. |
| `legacy/expo98/dist/expo-ios.mjs:5256-5271` | `src/main/index.ts:237` | Preserves ambiguity question triggers for chrome/navigation, gestures, visible controls, and verifier rules. |
| `legacy/expo98/dist/expo-ios.mjs:5273-5303` | `src/main/index.ts:254` | Preserves command suggestions for `ux-context`, inspector, review overlay, trace, gesture replay, and static verifier commands. |
| `legacy/expo98/dist/expo-ios.mjs:5305-5314` | `src/main/index.ts:292` | Preserves stop conditions for missing acceptance contracts, gesture proof, chrome proof, and mapped verifier rules. |
| `legacy/expo98/dist/expo-ios.mjs:5316-5322` | `src/main/index.ts:303` | Preserves verifier-rule matching regexes for gesture, navigation/chrome, and visible text/control workflows. |
| `legacy/expo98/dist/expo-ios.mjs:5324-5329` | `src/main/index.ts:324` | Preserves shell argument quoting used in suggested commands. |

## Characterization Tests

`src/test/characterization.test.ts` covers:

- default generic intake payload and missing-acceptance stop condition
- baseline evidence after acceptance exists
- constraint priority order
- calendar, navigation, form, list, editor, and generic flow payloads
- question trigger ordering
- command suggestion construction and shell quoting
- stop conditions and verifier workflow matching
- `toolJson` response shape

## Deliberate Deviations

- The modernized module is pure TypeScript with exported typed interfaces instead of a single bundled CLI function. This keeps the behavior reusable by later CLI and overlay adapters.
- `requireOptionalString` and `clampNumber` are local typed helpers for this package. They preserve the observed command behavior needed by `reviewNextStep` without importing unrelated legacy validation code.
- The package does not include the local HTTP annotation/review-overlay servers. Those are intentionally deferred to a dedicated server transform with `RULE-012` hardening.

## Architecture Review

Local review found no high-severity issues. The module has no side effects, no filesystem or process access, explicit exported types, and focused characterization coverage. Remaining low-severity follow-up: when the overlay server transform lands, import these pure helpers instead of re-copying any review guidance strings.

## Representative Diff

Use this command from the modernization workspace:

```bash
diff -u <(sed -n '5079,5121p' legacy/expo98/dist/expo-ios.mjs) <(sed -n '64,98p' modernized/expo98/review-next-guidance/src/main/index.ts)
```
