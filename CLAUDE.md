# expo98-reimagined — agent & engineer context

> This file IS the knowledge graph for the greenfield Effect-TS rebuild of `expo98`.
> Load it before working here. It tells you what exists, where the spec lives, the
> one design rule you must never break, and the legacy→modern traceability map.

## What this is

A from-scratch **Effect-TS** rebuild of `expo98` — a local-first evidence CLI for
Expo / React Native iOS work (inspect a running app over Hermes CDP, drive the iOS
simulator via `xcrun`/`simctl`, probe Metro, capture **redacted, reproducible
evidence** with state-changing actions behind a **fail-closed** policy gate).

It was reimagined _from the extracted spec_, not ported. The legacy at
`/Users/pedroproenca/Documents/Projects/expo98` (symlinked at `../../legacy/expo98`,
**READ-ONLY**) is the _specification source_. Do not copy its structure — it carries
the debt this rebuild exists to delete (a 51-dir pseudo-monorepo, 26× duplicated
helpers, three divergent redactors, a per-handler gate three commands bypass).

## Status (scaffold complete — Phase E of `/modernize-reimagine`)

**All 11 packages built, wired, validated, and green.** `pnpm test` →
**518 passing / 29 skipped / 0 failing**; `pnpm -r run typecheck` clean.
**80 commands registered** through the CLI shell (5 read + 75 handler), all dispatching through the safety spine.

| Package                        | Built? | Responsibility                                                                                                                                                               |
| ------------------------------ | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@expo98/core`                 | ✅     | Safety spine: 4-tier policy classifier, single redactor, **capability-injection dispatch**, subprocess + `confinePath` + clock/id                                            |
| `@expo98/domain`               | ✅     | Effect `Schema` model + persistence (sessions/targets/snapshots/refs/run-records) + lenient-read/strict-write migration                                                      |
| `@expo98/protocols`            | ✅     | Loopback-only Metro probe + Hermes CDP client (loopback + connect-time Origin + bounded open; `ws` adapter)                                                                  |
| `@expo98/app`                  | ✅     | CLI Shell (`@effect/cli`) + composition root + `--json\|--plain\|--ndjson` envelope + POSIX exit + **all 80 commands wired** + concrete capability layers + the M4 DAG guard |
| `@expo98/handlers-devtools`    | ✅     | D10 (trace/inspector/console/errors/navigation) — **AC-010/011 end-to-end** through the capability gate                                                                      |
| `@expo98/handlers-interaction` | ✅     | D6/D7 app+sim lifecycle + interaction/gestures + wait (AC-004/005/029/035/036/037/054/056; screenshot confinement AC-013)                                                    |
| `@expo98/handlers-snapshot`    | ✅     | D8 snapshot capture orchestration + accessibility + RN introspection (AC-019/023/026/040/055)                                                                                |
| `@expo98/handlers-net-perf`    | ✅     | D11 network evidence + perf calc (AC-045–052; HAR confinement AC-013; AC-022)                                                                                                |
| `@expo98/expo-integration`     | ✅     | D9 bridge (install/health/domains, AC-006/008/009/027/028) + D5 Expo↔RN compat (data-file map, AC-020) + sitemap (AC-044)                                                    |
| `@expo98/handlers-artifacts`   | ✅     | D12 diff/ux-context/review/dashboard + live-backlog (AC-042/057/058); `batch` reuses core `runBatch` (AC-031)                                                                |
| `@expo98/overlay-server`       | ✅     | Hardened loopback review-overlay ingest (token + Origin + body-cap + `comments[]` schema, AC-014/032) + sidecar lifecycle (AC-033)                                           |

## Where the spec lives (source of truth — read before designing)

All under `../../analysis/expo98/`:

- `AI_NATIVE_SPEC.md` — capabilities, domain model, interface contracts, NFRs, P0 behavior contract, **and the Phase B scope decisions**.
- `REIMAGINED_ARCHITECTURE.md` — C4 diagram, service boundaries, tech choices, data migration, **and the architecture-critic review + resolutions** (§7).
- `reimagine/rules-gwt.md` — **the 58 acceptance criteria (Given/When/Then) = the test contract.**
- `reimagine/interfaces.md` — full inbound/outbound interface catalog.
- `reimagine/entities.md` — full entity/aggregate model.
- `MODERNIZATION_BRIEF.md` — the approved 5-phase plan + 18 resolved open questions.

## THE design rule you must never break (capability injection)

The whole rewrite is justified by making fail-closed **structural**, not conventional.
The mechanism, implemented in `@expo98/core` `dispatch.ts` + `capabilities.ts`:

> A command declares a **required `sideEffect` field** (`read` | `device` | `runtime-eval` | `source-write`). The dispatcher **provides the dangerous capability tags (`RuntimeEvalCapability`, `DeviceCapability`, `SourceWriteCapability`) into a handler's Effect `R` environment ONLY on the gate-pass branch for that class.** A `read`-classed handler's `R` cannot name those tags → calling them is a **compile error**.

This is why the legacy `trace`/`inspector` ungated-runtime-eval bug (AC-010/011) is
_impossible to reintroduce_: it's proven at the type level in
`core/test/capability-injection.test.ts` (the `@ts-expect-error` lines).
**When you build handler packages: never let a handler import a protocol's eval/device
surface directly — receive it from the dispatcher via `R`.** Do not classify by
action-name string.

Companion invariants (also in `core`): ONE redactor over whole values (never
wire-chunks), `confinePath` on every artifact write, run-record writes are
observational (never alter exit code), loopback enforced before any CDP/Metro connect.

## How to run things

```bash
# from this directory (modernized/expo98-reimagined/)
pnpm install            # already done; restores node_modules if needed
pnpm test               # full vitest acceptance suite (all packages)
pnpm -r run typecheck   # tsc --noEmit per package
pnpm exec vitest run packages/core/test   # one package's suite
```

Tests import `it`/`expect` from `@effect/vitest`. Each test name carries its `AC-0NN`
id; `it.skip(...)` marks a pending AC with its rule id and the package that will own it.

**Note (pnpm 11 quirk):** `pnpm-workspace.yaml` pins `allowBuilds:` for vitest's
optional native deps to `false` — needed so `pnpm exec`/`pnpm test` don't abort on an
ignored-build-scripts gate. Leave it.

## Resolved spike (architecture finding M1)

`@effect/platform` `Socket` **cannot** set a connect-time `Origin` header (its
`WebSocketConstructor` is `globalThis.WebSocket`, no header option). So `@expo98/protocols`
implements the Hermes CDP transport with a **thin `ws` adapter** (`src/ws-adapter.ts`,
`new WebSocket(url, { headers: { Origin } })`) kept **behind the `CdpSocketFactory`
`Context.Tag`** — the rest of the system stays dep-agnostic. See `packages/protocols/SPIKE.md`.
The "zero non-Effect runtime deps" goal was correctly dropped as cosmetic; the real,
met requirement is loopback + Origin + bounded-open.

## Legacy → modern traceability map

| Legacy (domain · `src/...`)                                                                                                            | Modern                                                                                             | Key ACs                                                                 |
| -------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| D1 CLI framework (`cli-argv-parser`, `command-dispatch-envelope`, `command-surface`, `tool-json-envelope`, `cli-error-classification`) | `core` dispatch + errors/truncate **+ `app` (`@effect/cli`) ✅**                                   | AC-015/016/025/031/041                                                  |
| D2 Policy & Redaction (`policy-redaction`)                                                                                             | `core` `policy.ts` (4-tier classifier + gate) + `redaction.ts` (single superset)                   | **AC-001/002/003/008/012**                                              |
| D3 Persistence (`session-run-records`, `target-management`)                                                                            | `domain` `persist.ts` + `entities.ts` + `migration.ts`                                             | AC-017/018/019/024/025/026/043                                          |
| D4 Device protocol (`hermes-cdp-client`, `metro-probes`)                                                                               | `protocols` `cdp.ts`/`ws-adapter.ts` + `metro.ts` (loopback)                                       | **AC-021/030**/022/038                                                  |
| Artifact/path writes (`--output-path` unconfined, CWE-22)                                                                              | `core` `confine-path.ts`                                                                           | **AC-013**                                                              |
| Subprocess (7 `execFile` wrappers + 2 `sh -lc`)                                                                                        | `core` `subprocess.ts` (argv-only, typed)                                                          | AC-053                                                                  |
| Id/timestamp (`Math.random().slice(2,8)`, 3 timestamp variants)                                                                        | `core` `clock-id.ts` (collision-resistant, one basic-ISO format)                                   | AC-034                                                                  |
| D5 Discovery/Doctor (`project-info-doctor`, `router-sitemap`, `rn-introspection`)                                                      | **`expo-integration` ✅** (compat/sitemap) + **`handlers-snapshot` ✅** (rn) + `app` read cmds     | AC-020/044/055                                                          |
| D6 App/sim lifecycle + D7 interaction/gestures/wait                                                                                    | **`handlers-interaction` ✅** — all gated via capability injection                                 | AC-004/005/029/035/036/037/054/056; AC-013 (screenshot)                 |
| D8 Snapshot & accessibility                                                                                                            | **`handlers-snapshot` ✅** — capture orchestration + persistence (domain)                          | AC-019/023/026/040                                                      |
| D9 Bridge (`bridge-command-adapter`, `bridge-domain-actions`)                                                                          | **`expo-integration` ✅** (Expo SDK = documented seam)                                             | AC-006/008/009/027/028                                                  |
| D10 Runtime/DevTools (`trace`/`inspector` **ungated defect**)                                                                          | **`handlers-devtools` ✅** — gated via core's capability injection                                 | **AC-010/011** end-to-end (denial asserts eval invoked 0×) + AC-007/039 |
| D11 Network & Perf (`network-evidence`, `perf-evidence`)                                                                               | `protocols` shape-validation ✅ + **`handlers-net-perf` ✅** (calc)                                | AC-022/045–052; AC-013 (HAR)                                            |
| D12 Artifacts/review/orchestration                                                                                                     | **`overlay-server` ✅** (ingest, hardened) + **`handlers-artifacts` ✅**; `batch` fibers in `core` | AC-014/032/033/042/057/058; AC-031                                      |

## Design decisions made during scaffolding (read before changing core)

- **N2 — `@effect/cli` does NOT yield exit 2** for the two usage ACs: it treats `--json`/`--plain` as independent booleans (both-present raises nothing) and maps every parse failure to exit 1 via `@effect/platform`'s default teardown. So `@expo98/app` runs a **thin pre-parse usage guard** (`globals.ts` `assertUsage`) ahead of `@effect/cli` that fails with core's `CliUsageError` → exit 2 (AC-015/016). `@effect/cli` is kept for declarative parsing/help/version; the guard is the authority for those two ACs. **Don't delete the guard expecting `@effect/cli` to cover it.**
- **Truncation lives at the serialisation boundary, not in dispatch.** Core's `dispatch` `finaliseBoundary` **redacts only** and returns the structured payload; **truncation (AC-041) is applied once, in `app/envelope.ts`** (and `ndjsonStream`'s running total). Earlier, dispatch collapsed any >40 K payload into a `{_truncated}` marker — that destroyed `--json` data for legitimately large reads (e.g. 1000 console lines) and broke `batch` composition (AC-031) + run-record summaries (AC-042). **Do not re-add truncation to dispatch.** `truncate`/`RunningTruncator`/`OUTPUT_BUDGET` remain in `core` for the shell to use.
- **Redactor key quantifiers are length-bounded (`{1,256}`) — a real ReDoS fix.** `core/redaction.ts` `redactSecretsInString` had unbounded greedy `+` on the `key=value`/`key: value` patterns → **O(n²)** backtracking on a long delimiter-free string (a big evidence field, a base64 blob). Since the redactor runs on ALL output, that was a DoS. Bounding the key to `{1,256}` makes it linear (lossless — no real key is that long) and cut the whole suite's test phase ~9.8 s → ~3.8 s. **Keep the bounds.**
- **M4 DAG guard is enforced** by `app/test/dependency-dag.test.ts`: `core`→nothing; `domain`/`protocols`→`core`; handler/integration/overlay→`core`/`domain`/`protocols` (never each other); `app`→all; whole `@expo98/*` graph acyclic. A new cross-edge that reintroduces the legacy D1↔D2 cycle fails this test.

## Pending ACs (29 skips — ALL live-environment-only)

Every AC's **pure logic + the gating/redaction/confinement enforcement is implemented and PASSING**. The 29 skips are exclusively paths that need real hardware/processes and cannot run in CI:

- **Live device** (real booted simulator): `launch-app`/`boot`/interaction execution (AC-005 live), screenshot stitch (AC-054 live).
- **Live Hermes** (running app + CDP): `trace`/`inspector` eval (AC-010/011 live), CDP round-trip / malformed-frame / `Runtime.evaluate` (AC-030 live), snapshot semantic capture (AC-019/026 live), network/perf harvest (AC-022/045–052 live), bridge runtime registration (AC-028 live).
- **Live Metro**: fetch + `/symbolicate` (AC-021 live).
- **Live Expo project**: `expo config` introspection + in-app bridge delivery (AC-008/020 live).
- **Live socket bind**: overlay loopback bind + EADDRINUSE search (AC-014 live).

The corresponding **gating is already proven** by passing tests (denial → concrete capability invoked 0×; allow → reached), so these skips are about transport, not safety.

## Scope decisions carried forward (do NOT re-add)

From Phase B (HITL #1): **dropped** — video recording (the `record` command), the
review-overlay **in-app HTML/UI scaffold** (`CodexReviewOverlay.tsx` generation; keep
the evidence/server capability), the legacy `--state-dir` `runs`-parent quirk, baked
live-backlog fixtures, the dead `annotation-server` tombstone, and any **direct** `ws`
dependency in app code (it lives only behind `protocols`' `CdpSocketFactory`). Both
`expo98` and `expo-ios` bins are preserved; `sidecars` is implemented (real lifecycle),
not dropped.

## Suggested next steps (the scaffold is feature-complete; these are productionization)

1. **Build step → publishable binary.** Add esbuild (or tsup) to bundle `@expo98/app`'s
   `main.ts` → `cli/expo98.mjs` (+ the `expo-ios` re-export wrapper), set the `bin` field,
   and a **source↔bundle parity** CI test (the legacy's missing safeguard, ASSESSMENT
   debt #8). The source uses `.js` specifiers resolving to `.ts` (bundler/vitest only) —
   so `node main.ts` won't run un-bundled by design; the bundle is the runnable artifact.
2. **Live UAT** on a real booted simulator + running Expo/Hermes to exercise the 29
   live-skipped paths (flip the `it.skip`s to gated UAT). Safety/gating already proven;
   this validates the transports.
3. **Discharge the Expo SDK seam** in `expo-integration` (live `expo config` parsing +
   in-app bridge delivery via the official Expo DevTools Plugins SDK) — needs the TARGET
   project's Expo install, so it's an integration test, not a unit one.
4. Wire `oxlint`/`oxfmt` + the `pnpm minimumReleaseAge` supply-chain delay to match the
   legacy toolchain before any publish.
