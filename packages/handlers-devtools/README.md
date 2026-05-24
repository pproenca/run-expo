# `@expo98/handlers-devtools`

D10 runtime/devtools command handlers for the Effect-TS rebuild of `expo98`:
`trace`, `inspector`, `navigation`, and `console`/`errors`. Each command is a
`@expo98/core` `CommandDescriptor` carrying its **required** typed `sideEffect`,
paired with a handler `Effect` whose `R` environment is bounded to exactly the
capability that class entitles it to (`CapabilityFor<S>`).

## How the gate makes AC-010/011 BOTH structural and behavioural

Running every handler **through core's `dispatch`** means the dangerous
`RuntimeEvalCapability` / `DeviceCapability` is provided into a handler's `R`
**only on the gate-pass branch** for its declared class, so a denied `trace`/
`inspector` mutation never even builds the handler and the eval capability is
never invoked — the *behavioural* proof, asserted as zero capability calls in the
denial tests. The *structural* proof is the type system: a `read`-classed handler
has `R = never` and literally cannot name the eval capability, verified by the
`@ts-expect-error` lines in `test/devtools-capability.type-test.ts` (if the
withholding regressed, those lines would compile and `tsc --noEmit` would fail).

## Side-effect classification

| Command | Verb(s) | Class | AC |
|---|---|---|---|
| `trace` | `start` · `read` · `clear` · `stop` | `runtime-eval` | AC-010 |
| `inspector` | `probe` · `read-comments` | `read` | AC-011 |
| `inspector` | `install-comment-menu` · `clear-comments` · `toggle` | `runtime-eval` | AC-011 |
| `inspector` | `open-dev-menu` | `device` | AC-011 |
| `navigation` | `state` | `read` | AC-007 |
| `navigation` | `back` · `pop-to-root` · `tab` · `deep-link` | `device` | AC-007 |
| `console` / `errors` | — | `read` | AC-039 |

The per-verb → class maps (`traceSideEffect`, `inspectorSideEffect`,
`navigationSideEffect`) use `Match.exhaustive`, so adding a verb without assigning
a class is a **compile error** — a verb can never silently go ungated.

## Parameters (canonical bounds)

- `trace`: eval timeout `8000ms`; `maxEvents` clamp `1..2000` (default 200);
  `metroPort` clamp `1..65535` (default 8081).
- `console` / `errors`: `limit = clamp(args.limit ?? 100, 1, 1000)`, returns the
  **last N** entries (AC-039).

## AC → test map

| AC | Test file | What it proves |
|---|---|---|
| **AC-010** | `test/trace.test.ts` | every `trace` verb is `runtime-eval`; **denied with no policy / no `--allow-runtime-eval`, and the fake eval capability is invoked ZERO times**; allowed via flag or `trace.*` policy runs and invokes eval once; `maxEvents`/`metroPort` clamps. |
| **AC-011** | `test/inspector.test.ts` | mutating verbs `runtime-eval` → **denied without policy, eval invoked ZERO times**; `probe`/`read-comments` `read` → run ungated; `open-dev-menu` `device`-gated (zero device work on denial). |
| **AC-007** | `test/navigation.test.ts` | `state` read runs ungated; `back`/`pop-to-root`/`tab`/`deep-link` device-gated, denied without policy (zero device work). |
| **AC-039** | `test/logs.test.ts` | `console`/`errors` limit defaults 100, clamps `1..1000`, returns last N. |
| AC-010 / AC-011 (structural) | `test/devtools-capability.type-test.ts` | a devtools handler cannot name the runtime-eval/device capability unless its descriptor class entitles it (`@ts-expect-error`). |

### Skipped (require a live device)

- `test/trace.test.ts` — `it.skip("AC-010 live trace against a running Hermes …")`.
- `test/inspector.test.ts` — `it.skip("AC-011 live inspector install-comment-menu …")`.

## Boundary rule

Handlers depend ONLY on core's capability tags (`RuntimeEvalCapability`,
`DeviceCapability`). They **never** import `@expo98/protocols`' CDP eval surface
(`HermesRuntimeEval`) directly — that surface arrives via `R` from the dispatcher,
which is what makes the legacy ungated-runtime-eval defect impossible to
re-introduce here.
