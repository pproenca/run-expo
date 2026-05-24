# @expo98/app — the CLI shell + composition root

The S12 **CLI Shell** of the Effect-TS rebuild of `expo98`: argv parsing + global
flags, POSIX exit codes (0/1/2), the `--json | --plain | --ndjson` output
envelope, the command registry, and the **node-backed Layer stack** (the
composition root) that discharges the pure spine (`@expo98/core`) and the
platform-agnostic ports (`@expo98/domain` `Fs`, `@expo98/protocols` Metro/CDP)
against the REAL `@effect/platform-node` implementations.

This is the **only** package that names `@effect/platform-node`. The pure spine
stays platform-free and property-testable.

## What's wired this round

- **Global flags → `CliGlobals`** (`src/globals.ts`): `--json`, `--plain`,
  `--ndjson`, `--quiet`, `--root`, `--state-dir` (treated **literally** — the
  legacy `runs`-parent quirk is dropped), `--action-policy`, `--max-output`,
  `--allow-runtime-eval`, `--confirm-actions`, `--record`, `--content-boundaries`,
  `--debug`, `--no-color`, `--no-input`, `--version`, `--help/-h`.
- **POSIX exit codes** (`src/main.ts`): `0` success / `1` runtime_failure / `2`
  invalid_usage — reusing core's `exitCodeForError`. A custom `NodeRuntime`
  teardown applies the resolved code (NOT `defaultTeardown`, the N2 root cause).
- **Output envelope** (`src/envelope.ts`): `--json` → `{ ok, data }` / `{ ok,
error }`; `--plain` → stable sorted `key=value` lines; `--ndjson` → a
  `Stream<string>` of one redacted JSON event per line. Redaction + the canonical
  40,000-char truncation (running-total for streams) applied at THIS boundary via
  core (AC-003/012/041).
- **Command registry + composition root** (`src/registry.ts`, `src/all-commands.ts`,
  `src/layers.ts`): `registerCommands(descriptors)` plus the node-backed `AppLayer`
  (capabilities, `Fs`, Metro probe, Hermes CDP, Id). The FULL command surface
  (**80 commands** = 5 core READ + 75 handler/integration) is now wired:
  `all-commands.ts` wraps every package's command builder in a `CommandRegistration`
  and registers it, so `expo98 <name> [verbs/flags]` dispatches through the safety
  spine. Verb FAMILIES (`trace`/`inspector`/`navigation`/lifecycle/…) collapse into
  one `@effect/cli` subcommand each, routing on the sub-verb. The three dangerous
  capabilities are backed by CONCRETE node layers:
  - `DeviceCapability` → core `Subprocess` over `@effect/platform-node` `Command`
    (argv-only, no shell).
  - `RuntimeEvalCapability` → protocols' Hermes CDP (`ws`-adapter, loopback-enforced).
  - `SourceWriteCapability` → `@effect/platform-node` `FileSystem` (confined writes).
    The live device / Hermes / Metro transport is the documented seam (skipped UAT).
- **Both bin names preserved conceptually** (`expo98` + `expo-ios`, identical
  impl). The bundle/bin step (esbuild → committed `cli/*.mjs`) is **deferred**;
  no `bin` is declared in `package.json` yet.

## Architecture finding N2 — the decision

> N2: `@effect/cli`'s flag-parsing/exit semantics may differ from the contractual
> AC-015/016 (mutual-exclusion → exit 2; value-required → exit 2).

**Determined empirically by reading the installed sources** (effect 3.21.2,
`@effect/cli` 0.75.1, `@effect/platform(-node)` 0.96.1/0.106.0):

| Contract                                     | What `@effect/cli` does natively                                                                                                                                                           | Verdict         |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------- |
| **AC-015** `--json` + `--plain` → exit 2     | Models the two as INDEPENDENT booleans — both individually valid, the conflict raises **no error at all**.                                                                                 | NOT enforced    |
| **AC-016** value flag with no value → exit 2 | Raises `ValidationError.MissingValue` — but `@effect/platform`'s `defaultTeardown` maps EVERY failure cause to exit **1** (`Exit.isFailure(exit) && !isInterruptedOnly ? 1 : 0`), never 2. | Wrong exit code |

So `@effect/cli` does **NOT** give exit 2 for either AC.

**Decision: a thin pre-parse guard + a custom teardown.**

1. `assertUsage(argv)` (`src/globals.ts`) — a PURE function over the user-facing
   argv slice — runs FIRST, detecting both AC-015 and AC-016 and failing with
   core's `CliUsageError`, which `exitCodeForError` maps to **exit 2**. It runs
   before `@effect/cli` parses, so the conflict/missing-value never reaches the
   wrong-exit-code path.
2. A custom `NodeRuntime.runMain` teardown applies the resolved POSIX code, and
   `runProgram` also maps any residual `@effect/cli` `ValidationError` (unknown
   command, etc.) to exit 2 — so usage errors are exit 2 from every path.

`@effect/cli` is retained for declarative parsing, `--help`/`--version`, and
shell completion; the guard is the AUTHORITY for the two validation ACs and is
fully unit-testable without booting the CLI.

## Acceptance criteria → test map

### Implemented (pass)

| AC         | What                                                                               | Test file · case                                                                 |
| ---------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| **AC-015** | `--json` + `--plain` → exit 2                                                      | `test/usage-guard.test.ts` · "AC-015 …" · `test/program.test.ts` (integration)   |
| **AC-016** | value flag without value → exit 2                                                  | `test/usage-guard.test.ts` · "AC-016 …" · `test/program.test.ts` (integration)   |
| exit 0/1/2 | mapping via core's `exitCodeForError`                                              | `test/usage-guard.test.ts` (mapping) · `test/program.test.ts` (0/1/2 end-to-end) |
| envelope   | `{ ok, data }` / `{ ok, error }`                                                   | `test/envelope.test.ts` (json) · `test/commands.test.ts` (through dispatch)      |
| `--plain`  | stable sorted line output                                                          | `test/envelope.test.ts` (plain)                                                  |
| **AC-041** | `--ndjson` per-event redaction + running-total truncation                          | `test/envelope.test.ts` (ndjson)                                                 |
| AC-003/012 | redaction at the boundary (json/plain/ndjson)                                      | `test/envelope.test.ts` · `test/commands.test.ts` (redact)                       |
| AC-001     | `policy`/`redact`/`doctor` read commands return correct envelopes through dispatch | `test/commands.test.ts`                                                          |

### Final integration + DAG guard

- `test/integration.test.ts` — the full surface is registered (80 commands), a
  read command (`doctor`) returns an `ok` envelope at exit 0, and gated `device`
  (`launch-app`) / `runtime-eval` (`trace start`) commands WITHOUT policy are
  denied (`policy-denied`, exit 0) with the concrete capability invoked **0×**
  (proven via a counting fake). With policy, the same command reaches the (fake)
  capability — confirming the dispatch path is real.
- `test/dependency-dag.test.ts` — **architecture finding M4**: reads every
  workspace `package.json` and asserts the layering DAG (core → nothing; domain /
  protocols → only core; handlers / integration / overlay → only core/domain/
  protocols, never each other; app → all) and that the whole `@expo98/*` graph is
  ACYCLIC (topological sort succeeds). The legacy D1↔D2 cycle cannot reappear.

### Skipped (live UAT — with AC id + owner)

Only the LIVE device / Hermes / Metro transport for the gated commands remains
deferred (CI cannot provide a simulator). Tracked as `it.skip` in
`test/deferred.test.ts`: AC-005 (lifecycle), AC-008 (bridge writes), AC-010/011
(trace/inspector eval), AC-019/026 (snapshot capture), AC-022/045-052 (network/
perf harvest), AC-014 (overlay server bind). The wiring + gating are proven above;
only the live transport is the seam.

## Public API

`src/index.ts` exports: the global-flag parsing + `assertUsage` guard, the
envelope formatters, the registry (`registerCommands`/`runRegistered`), the proof
read commands (`coreReadCommands`), `resolvePolicy`, the node Layer stack
(`AppLayer` + the individual adapter layers), and the runnable program
(`runProgram` for tests, `main` for the bins). The runnable entry lives in
`src/main.ts`.

## Verify

```
cd packages/app && pnpm exec tsc --noEmit
# if a pnpm deps-gate aborts:
pnpm --config.verify-deps-before-run=false exec tsc --noEmit
```

Tests (run from the workspace root): `pnpm exec vitest run packages/app/test`.
