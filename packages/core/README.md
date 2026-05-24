# @expo98/core — the safety spine

The P0 trunk of the Effect-TS rebuild of `expo98`. This package proves the
rewrite's core justification: **structural fail-closed safety via capability
injection**. The side-effect class is a _required typed field_ on each command;
the dispatcher constructs the dangerous capabilities (`runtime-eval`, `device`,
`source-write`) and provides them into a handler's Effect `R` **only after the
gate passes for that command's class**. A `read`-classed handler's `R` lacks
those tags, so calling one is a **compile error** — not a runtime convention.

The pure spine imports nothing platform-specific (no `@effect/platform-node`).

## Services

| #   | Service             | Module                | Notes                                                                                                                                                        |
| --- | ------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| S1  | Subprocess          | `src/subprocess.ts`   | `Context.Tag` over argv-only `Command` semantics; per-call timeout + maxBuffer; typed `ToolNotFound`. Fake impl included; real Node executor wired in `app`. |
| S2  | `confinePath`       | `src/confine-path.ts` | Pure function (not a Layer): resolves + asserts under the artifacts root; rejects `../`/absolute (AC-013).                                                   |
| S3  | Clock / Id          | `src/clock-id.ts`     | Thin Layer for collision-resistant ids + one unified timestamp; injectable clock/randomness for deterministic tests.                                         |
| S4  | Policy              | `src/policy.ts`       | ONE 4-tier classifier (`read`/`device`/`runtime-eval`/`source-write`, unknown ⇒ `device`) + ONE fail-closed gate. `Match.exhaustive`.                        |
| S5  | Redaction           | `src/redaction.ts`    | ONE strongest-superset redactor over whole values (never wire-chunks); URL/`key=value` substrings.                                                           |
| S6  | Dispatch            | `src/dispatch.ts`     | Capability-injection gate: classify → gate → provide-iff-allowed → run → redact+truncate → emit. Observational recorder; batch; NDJSON.                      |
| —   | Errors / exit codes | `src/errors.ts`       | `CliUsageError`→2, runtime→1, success→0.                                                                                                                     |
| —   | Truncation          | `src/truncate.ts`     | One 40,000-char budget + one marker; running-total truncator for streams.                                                                                    |
| —   | Capabilities        | `src/capabilities.ts` | The three dangerous `Context.Tag`s.                                                                                                                          |

## Acceptance criteria → test coverage

### Implemented (must pass)

| AC     | What                                                         | Test file · case                                                                 |
| ------ | ------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| AC-001 | Fail-closed policy gate; reads always pass                   | `test/policy.test.ts` (gate cases) · `test/dispatch.test.ts` (gate at execution) |
| AC-002 | ONE 4-tier classifier; unknown ⇒ device                      | `test/policy.test.ts` (classifier cases)                                         |
| AC-003 | ONE strongest-superset redactor, whole values                | `test/redaction.test.ts` · `test/dispatch.test.ts` (boundary redaction)          |
| AC-008 | source-write needs policy + confirmation token               | `test/policy.test.ts` (source-write tier)                                        |
| AC-012 | Network/URL/HAR redaction (folded into AC-003 superset)      | `test/redaction.test.ts` (URL/`key=value`/header substrings)                     |
| AC-013 | `--output-path` confined to artifacts root                   | `test/confine-path.test.ts`                                                      |
| AC-015 | `CliUsageError` → exit 2; runtime → exit 1                   | `test/errors.test.ts`                                                            |
| AC-016 | Missing flag value → exit 2                                  | `test/errors.test.ts`                                                            |
| AC-025 | Run-record write is observational (never alters exit code)   | `test/dispatch.test.ts` (observational recorder)                                 |
| AC-031 | Batch serial, bail-on-first-failure, exit-code-isolated      | `test/dispatch.test.ts` (batch)                                                  |
| AC-034 | ids = prefix-timestamp-suffix; one timestamp format          | `test/clock-id.test.ts`                                                          |
| AC-041 | One canonical budget + one marker; running-total for streams | `test/truncate.test.ts`                                                          |
| AC-053 | Subprocess fixed timeouts/buffers; maxBuffer > budget        | `test/subprocess.test.ts`                                                        |

### The crux — capability injection (compile-time proof)

`test/capability-injection.type-test.ts` uses `@ts-expect-error` to prove a
`read`-classed handler **cannot** reference the runtime-eval/device/source-write
capability, and that a `runtime-eval`/`device` handler can require **only** its
matching capability. These directives make `tsc --noEmit` pass _because_ the
withholding holds; a regression would make a directive unused and fail the
build. A runtime case also asserts the gate denies an un-allowed runtime-eval at
execution (defense in depth).

### Deferred (skipped here; mechanism proven in core)

Full handler behavior lives in the handler/integration packages; the gate
mechanism each depends on is proven in `core`. Tracked as `it.skip` in
`test/deferred.test.ts`:

- **AC-005** device/app lifecycle mutations gated → `packages/handlers-lifecycle`
- **AC-006** bridge storage/state/controls gated + bounded → `packages/handlers-bridge`
- **AC-007** navigation mutations gated (state ungated) → `packages/handlers-devtools`
- **AC-010** `trace` gated as runtime-eval → `packages/handlers-devtools` (mechanism proven by `capability-injection.type-test`)
- **AC-011** `inspector` mutations gated, reads classified read → `packages/handlers-devtools` (mechanism proven by `capability-injection.type-test`)

## How AC-010/AC-011 become a compile-time guarantee

`trace`/`inspector` mutations are classified `runtime-eval`, and the only way to
evaluate JS in the app is through the `RuntimeEvalCapability` tag — which the
dispatcher provides into a handler's `R` **only on the gate-pass branch for the
`runtime-eval` class**. Any handler that tries to evaluate JS therefore _must_
declare `RuntimeEvalCapability` in its `R`, which forces its `sideEffect` to be
`runtime-eval` (a `read` handler's `R` is `never`), so the ungated bypass the
legacy allowed is rejected by the type-checker before it can run.

## Verify

```
node ../../node_modules/typescript/bin/tsc --noEmit   # from this package dir
```
