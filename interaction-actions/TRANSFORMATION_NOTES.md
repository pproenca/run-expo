# interaction-actions Transformation Notes

## Scope

Modernizes the legacy interaction execution cluster from `expo-ios` into `modernized/expo98/interaction-actions`.

Source references:

- `legacy/expo98/dist/expo-ios.mjs:2961-3128` - coordinate taps, ref action dispatch, ref points, and scroll planning integration.
- `legacy/expo98/dist/expo-ios.mjs:3130-3265` - clipboard, keyboard, key-code mapping, environment mutation planning, and policy integration.
- `legacy/expo98/dist/expo-ios.mjs:3267-3519` - gesture normalization, dry-run plans, execution, before/after screenshots, trace hooks, and repeated command evidence.
- `legacy/expo98/dist/expo-ios.mjs:7292-7369` - policy decision and denied payload shape.
- `legacy/expo98/dist/expo-ios.mjs:12038-12056` - numeric coercion and RULE-021 truncation.
- `legacy/expo98/tests/test_cli.mjs:1219-1295` - tap setup/fallback/dry-run behavior.
- `legacy/expo98/tests/test_cli.mjs:3518-3645` - gesture dry-run, axe fallback, and evidence intent fixtures.

Business rules:

- `RULE-020`: ref action points target element centers through the cached-ref planning layer.
- `RULE-021`: subprocess stdout/stderr is bounded and reports overflow characters.
- `RULE-022`: direct device/app mutations are policy-gated in the transformed module.
- `RULE-028`: gestures execute through platform tooling and can collect before/after screenshot and trace evidence.

## Input/Output Mapping

| Legacy behavior | Modernized implementation | Notes |
| --- | --- | --- |
| Coordinate `tap` dry-run and execution choose Android `adb`, iOS `idb`, then `axe`. | `src/main/index.ts:105` | Preserves dry-run command shapes, iOS missing-tool error text, x/y clamping, and output truncation. Adds RULE-022 policy gate. |
| Ref tap delegates to cached-ref planning and recurses to coordinate tap when executable. | `src/main/index.ts:105` | Ref planning remains injected from `ref-actions-wait`; this module owns device execution. |
| Ref action command dispatch for scroll-into-view, blur, focus/check/uncheck/select, fill, long-press, double-tap, drag, and scroll. | `src/main/index.ts:172` | Preserves nested payload shapes and targetRef error role. Ref mutations are policy-gated by exact `ref.*` action names before lower-level device execution. |
| Clipboard read/write/paste. | `src/main/index.ts:221` | Preserves `simctl pbpaste`, `simctl pbcopy` stdin, axe paste key combo, and unavailable paste reason. Write/paste are policy-gated. |
| Keyboard type/press and key code mapping. | `src/main/index.ts:246` | Preserves axe requirement, dry-run payload, alias/numeric/letter mapping, and unknown-key errors. Mutations are policy-gated. |
| Environment mutations. | `src/main/index.ts:284` | Preserves appearance, content-size, location, permissions, unsupported-domain unavailable payloads, and unknown-domain errors. |
| Gesture dry-run and execution. | `src/main/index.ts:346` | Preserves default durations, coordinate validation, review questions, evidence flags, trace hooks, and screenshot hooks. Adds RULE-022 policy gate. |
| Platform command planning. | `src/main/index.ts:448` | Preserves Android `adb input` and iOS `idb` plan shapes, duration formatting, and hold limitation notes. |
| iOS `axe` command conversion. | `src/main/index.ts:517` | Preserves tap, long-press/touch, drag, and swipe argument mapping. |
| Repeated command evidence. | `src/main/index.ts:587` | Preserves per-run command, exit code, stdout/stderr truncation, interval waits, tool basename fallback. Exported direct calls are policy-gated. |
| Gesture screenshots. | `src/main/index.ts:625` | Preserves default temp directory, timestamp filename normalization, and screenshot adapter delegation. |
| `ref-actions-wait` composition adapter. | `src/main/index.ts:652` | Binds the public `planRefAction`, `refPoint`, and `scrollPlan` functions and provides local latest-cache `readRefRecord` behavior without depending on private exports. |

## Deliberate Deviations

- The transformed package returns plain payload objects rather than legacy `toolJson(...)` envelopes for command functions. `toolJson` remains exported for compatibility tests and a CLI facade can wrap payloads at the boundary.
- Device, screenshot, trace, policy, ref planning, and filesystem/time operations are injected. This keeps the module focused on interaction semantics while allowing shared runtime adapters to own native I/O.
- RULE-022 is intentionally stronger than the legacy source: tap, exact ref mutations, clipboard writes/paste, keyboard, gesture mutations, and exported direct execution helpers are policy-gated even where the original direct-device commands were not. This also means dry-run plans require an allowed policy decision in this adapter.
- `refPoint`, `scrollPlan`, and `planRefAction` are injected instead of reimplemented here because `modernized/expo98/ref-actions-wait` already owns cached-ref planning behavior. `createRefActionAdapter` provides the composition glue for that package.

## Not Migrated

- CLI argv parsing and command alias mapping remain in the future CLI facade / batch orchestration boundary.
- Concrete native-tool discovery and `execFile` implementations are not duplicated here; consumers provide adapters.
- Real Metro trace transport and screenshot capture are not owned by this package; this module invokes injected trace and screenshot adapters.

## Verification

```bash
cd modernized/expo98/interaction-actions && npm test
```

Result:

```text
# tests 44
# suites 6
# pass 44
# fail 0
```

The tests cover helper validation, output truncation, coordinate and ref taps, ref action dispatch, clipboard, keyboard, environment planning/execution, policy-denied mutation paths, direct execution-helper policy denial, `ref-actions-wait` adapter composition, gesture normalization/planning/execution, axe command conversion, repeated command evidence, and gesture screenshots.

## Review Notes

- During implementation, two test expectations were corrected to match the cited legacy source: ref dry-run actions return the cached-ref plan directly, and dry-run ref gestures return the full gesture dry-run evidence payload.
- RULE-022 coverage was added for tap, clipboard write, keyboard press, set environment, gesture denied paths, and exported direct execution helper denied paths.
- Architecture review HIGH findings were applied:
  - Exported `executeGesturePlan` and `executeRepeatedCommand` now policy-gate direct calls before native-tool execution; internal already-authorized flows use private helpers.
  - Added `createRefActionAdapter` so this package composes with `ref-actions-wait` public exports without requiring its private `readRefRecord`.
- Medium review findings addressed or documented:
  - Ref mutations now policy-gate exact `ref.*` action names before lower-level tap/gesture execution.
  - Allowed environment execution and unavailable planned domains are covered by characterization tests.
  - Dry-run policy gating is documented as an intentional RULE-022 hardening deviation.
  - Removed the incomplete `defaultInteractionDependencies` helper.
