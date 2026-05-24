# `@expo98/handlers-interaction`

D6 (app/sim lifecycle) + D7 (interaction / gestures / wait) command handlers for
the Effect-TS rebuild of `expo98`. Every command is a `@expo98/core`
`CommandDescriptor` carrying its **required** typed `sideEffect`, paired with a
handler `Effect` whose `R` is bounded to exactly the capability that class
entitles it to (`CapabilityFor<S>`).

## How the gate makes AC-005 / AC-004 structural AND behavioural

Running every handler **through core's `dispatch`** means the dangerous
`DeviceCapability` / `RuntimeEvalCapability` is provided into a handler's `R`
**only on the gate-pass branch** for its declared class. So a denied lifecycle /
interaction command never even builds the handler and the device capability is
**never invoked** — the *behavioural* proof, asserted as zero capability calls in
the denial tests (AC-005). `wait --fn` is the only `runtime-eval`-classed verb,
so it is gated identically (AC-004: denial invokes eval 0×). The *structural*
proof is the type system: a `device`-classed handler cannot name the eval
capability, and a `read`-classed handler (`wait` without `--fn`) cannot name
either — verified by the `@ts-expect-error` lines in
`test/interaction-capability.type-test.ts` (if the withholding regressed, those
lines would compile and `tsc --noEmit` would fail).

Handlers depend ONLY on core's capability tags + the pure domain/geometry
helpers. They **never** import `@expo98/protocols`' CDP eval surface or any
subprocess module directly — that is what makes the legacy ungated path
impossible to re-introduce here.

## Side-effect classification

| Command(s) | Class | AC |
|---|---|---|
| `boot-simulator` · `open-url` · `launch-app` · `terminate-app` · `reload-app` · `install-app` · `uninstall-app` · `open-route` · `set` | `device` | AC-005 |
| `tap` · `gesture` · the 11 ref-actions · `type`/`press`/`keyboard` · `clipboard` · `screenshot` | `device` | AC-005/013/036/037/054 |
| `wait` (no `--fn`: `--ms` / predicate) | `read` | AC-035 |
| `wait --fn` | `runtime-eval` | AC-004 |

The per-verb → class maps (`lifecycleSideEffect`, `waitSideEffect`) and the
verb→argv mappings use `Match.exhaustive`, so adding a verb without a class is a
**compile error** — a verb can never silently go ungated.

## Parameters (canonical bounds)

- **Crash grace (AC-056):** `clamp(args.waitMs ?? 1000, 0, 30000)` — DEFAULT
  **1000ms** (the legacy 0ms-grace defect is fixed). `launch-app` passes
  `waitMs: args.crashCheckMs`.
- **Ref point (AC-036):** `point = { x: box.x + box.width/2, y: box.y + box.height/2 }`;
  a missing box → `null` (unavailable).
- **Scroll (AC-037):** `amount = clamp(args.amount ?? args.text ?? 600, 1, 5000)`;
  signed deltas down `{0,-a}` / up `{0,+a}` / left `{+a,0}` / right `{-a,0}`
  (**PRESERVE** the swipe→content mapping); default origin `{200,700}`.
- **Gesture (AC-037):** `repeat` 1..20 (default 1), `intervalMs` 0..10000
  (default 250), `durationMs` 1..30000 (defaults long-press 900 / drag 900 /
  swipe 250 / tap 80), `maxEvents` 1..2000 (default 200).
- **Full screenshot (AC-054):** `segmentCount = clamp(args.fullSegments ?? args.segments ?? 3, 1, 12)`;
  fallback `390×844`; `startX=round(w/2)`, `startY=round(h*0.82)`, `endY=round(h*0.28)`.
- **Wait cadence (AC-035):** `timeoutMs = clamp(args.timeoutMs ?? 5000, 0, 60000)`;
  `intervalMs = min(max(floor(timeoutMs/10), 25), 250)`; each tick sleeps
  `min(intervalMs, timeoutMs − elapsed)`; `--ms` path sleeps `clamp(args.ms ?? 0, 0, 60000)`.
- **Path confinement (AC-013):** `screenshot --output-path` is resolved through
  core's `confinePath(artifactsRoot, …)` BEFORE any device work / write; a `../`
  or absolute escape fails with `PathEscape`.

## AC → test map

| AC | Test file | What it proves |
|---|---|---|
| **AC-005** | `test/lifecycle.test.ts`, `test/interaction.test.ts`, `test/screenshot.test.ts` | every lifecycle verb is `device`; **denied without policy → fake `DeviceCapability` invoked ZERO times**; allowed → invoked with the planned argv; `install-app`/`uninstall-app` `--dry-run` returns a plan and invokes the device **0×** (mutates nothing). |
| **AC-029** | `test/lifecycle.test.ts`, `test/crash.test.ts` | `launch-app`/`reload-app` attach a `crashCheck`; a post-launch `.ips`/`.crash` report (mtime > `startedAt`) → `available:false` + verbatim reason + attached reports; pre-existing / non-crash reports ignored; a denied launch does zero device work (no scan). |
| **AC-056** | `test/crash.test.ts` | crash grace defaults to **1000ms** and clamps to `0..30000`. |
| **AC-036** | `test/gesture-plan.test.ts`, `test/interaction.test.ts` | `point = box centre`; missing box → `null`; ref-actions surface the point. |
| **AC-037** | `test/gesture-plan.test.ts`, `test/interaction.test.ts` | scroll signed deltas + clamped `amount`; gesture clamps (repeat/interval/duration/maxEvents) + per-kind default durations (**PRESERVE** swipe→content). |
| **AC-054** | `test/screenshot.test.ts` | `segmentCount` clamp; `390×844` fallback; `startX/startY/endY` swipe geometry. |
| **AC-035** | `test/wait.test.ts` | cadence math (`timeoutMs`/`intervalMs`/`ms`/tick sleep) + TestClock-driven `--ms`, already-true, flips-true, and timeout cadence loops. |
| **AC-004** | `test/wait.test.ts` | `wait --fn` is `runtime-eval`; **denied with no flag/policy → fake eval invoked ZERO times**; `--allow-runtime-eval` or `wait.fn` policy → runs + invokes eval once; **no runtime adapter → the unavailable shape, eval invoked 0×**. |
| **AC-013** | `test/screenshot.test.ts` | in-root path accepted + resolved; `../` and absolute escapes rejected via `confinePath` BEFORE any device work (zero device calls, exit 1). |
| AC-004/AC-005 (structural) | `test/interaction-capability.type-test.ts` | a `device`-classed handler cannot name the runtime-eval capability; a `read`-classed `wait` cannot name eval or device (`@ts-expect-error`). |

## Skipped (require a live device — AC ids preserved)

- `test/lifecycle.test.ts` — `it.skip("AC-005 live boot/launch on a real simulator …")` and `it.skip("AC-029 live crash scan against a real DiagnosticReports directory")`.
- `test/screenshot.test.ts` — `it.skip("AC-054 live stitch: scroll + capture + stitch on a real simulator")`.

All pure logic (gating, crash matching, gesture/scroll/screenshot geometry, wait
cadence) is fully covered with injected fakes + `TestClock`; only the live
simulator/Hermes round-trips are deferred.

## Boundary rule

Handlers reach the simulator/runtime ONLY via the `DeviceCapability` /
`RuntimeEvalCapability` tags the dispatcher injects on the gate-pass branch. They
never construct a subprocess or open a CDP socket themselves.
