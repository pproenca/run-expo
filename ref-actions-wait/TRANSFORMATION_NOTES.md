# ref-actions-wait transformation notes

## Scope

Transformed cached-ref finder behavior, wait predicate evaluation, and ref
action planning from the legacy Expo iOS CLI into a TypeScript module under
`modernized/expo98/ref-actions-wait`.

In scope:

- `find` matching for role, text, label, placeholder, test ID, source, first,
  and nth selectors.
- Optional finder action planning through an injected action planner.
- Wait predicate parsing, sleep waits, cached-ref polling, final validation
  failures, timeout evidence, and visibility evidence.
- Ref action planning for current/action-capable refs.
- Ref center-point calculation and scroll planning.

Out of scope:

- Real Metro/app-ready/runtime-function wait execution.
- Real tap/fill/focus/inspect device automation.
- CLI argument parsing and batch command orchestration.

Those runtime integrations are represented as injected dependencies so this
module preserves the behavior boundaries without owning process or device I/O.

## Mapping

| Behavior | Legacy source | Modern source | Rule |
| --- | --- | --- | --- |
| Tool JSON payload wrapping and unwrapping | `legacy/expo98/dist/expo-ios.mjs:797` | `src/main/common.ts:3` | RULE-008 |
| String and numeric validation | `legacy/expo98/dist/expo-ios.mjs:12038` | `src/main/common.ts:19` | RULE-008, RULE-019 |
| Finder command and optional action result | `legacy/expo98/dist/expo-ios.mjs:1839` | `src/main/find.ts:8` | RULE-008 |
| Finder matching semantics | `legacy/expo98/dist/expo-ios.mjs:1873`, `legacy/expo98/dist/expo-ios.mjs:2162` | `src/main/find.ts:55` | RULE-008 |
| Wait command polling and sleep waits | `legacy/expo98/dist/expo-ios.mjs:1887` | `src/main/wait.ts:8` | RULE-019 |
| Wait predicate priority and defaults | `legacy/expo98/dist/expo-ios.mjs:1924` | `src/main/wait.ts:57` | RULE-019 |
| Cached wait predicate evaluation | `legacy/expo98/dist/expo-ios.mjs:1972` | `src/main/wait.ts:74` | RULE-019 |
| Timeout and sample evidence payloads | `legacy/expo98/dist/expo-ios.mjs:2050` | `src/main/wait.ts:156` | RULE-019 |
| Ref action preconditions and dry-run plan | `legacy/expo98/dist/expo-ios.mjs:2323` | `src/main/ref-actions.ts:8` | RULE-008, RULE-020 |
| Ref center point | `legacy/expo98/dist/expo-ios.mjs:3085` | `src/main/ref-actions.ts:47` | RULE-020 |
| Scroll planning | `legacy/expo98/dist/expo-ios.mjs:3098` | `src/main/ref-actions.ts:65` | RULE-020 |

## Characterization

The characterization suite is in `src/test/characterization.test.ts`.

It pins concrete input/output behavior for:

- `requireString` trimming and error messages.
- Finder matching for role/text/label/source/first/nth selectors.
- Finder unavailable cache output and optional dry-run action output.
- Wait predicate priority, defaults, and invalid string arguments.
- Sleep waits with clamped milliseconds.
- Cached wait polling interval behavior and no-cache output.
- Text, route, no-spinner, visible, hidden, invalid-ref, missing-ref, and stale-ref wait evaluation.
- Timeout payloads and sampled wait evidence.
- Ref action unavailable envelopes and success center-point plan.
- `refPoint` missing-bounds behavior.
- Scroll plans from ref origins and default origin with clamped amounts.

## Deliberate Deviations

- Runtime predicates (`metro-ready`, `app-ready`, and `fn`) are delegated to an
  optional `waitRuntimePredicate` dependency. The legacy implementation talks to
  Metro/Hermes and policy checks directly; those integrations belong in a
  runtime adapter slice.
- Finder action execution delegates to `planFinderAction`. This keeps this slice
  focused on cached-ref semantics and avoids coupling it to device automation.
- Batch command orchestration is not included even though it calls `wait`; it is
  a separate CLI workflow and should be transformed independently.

## Not Migrated

- Device-level tap/fill/focus/inspect execution.
- Metro/Hermes runtime readiness polling.
- Batch command parsing/execution.

## Follow-Ups

- Wire this module to the transformed snapshot ref cache through a filesystem
  adapter.
- Transform the device automation module so finder actions can delegate to real
  tap/fill/focus implementations.
- Transform batch orchestration against the modern command modules.

## Verification

```bash
cd modernized/expo98/ref-actions-wait && npm test
```

Result: 15 tests passing.

## Architecture Review

The architecture-critic reported two HIGH findings, both fixed:

- Finder action results now reject unsupported actions before invoking an
  injected planner, matching the legacy allowlist.
- Runtime waits no longer return an immediate fake timeout when no runtime
  adapter is provided. They require an explicit `waitRuntimePredicate`
  dependency so the adapter owns Metro/Hermes polling behavior.

Medium findings addressed or tracked:

- Ref-cache reads now receive command args/context where the public command has
  it available, making alternate state roots easier to wire in the adapter.
- Timeout text preserves the legacy `undefined to become undefined` wording for
  non-text/non-ref predicates such as `no-spinner`.
