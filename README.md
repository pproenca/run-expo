# run-expo

`run-expo` is a local-first **evidence CLI for Expo / React Native iOS work**. It
inspects a running app over the Hermes Chrome DevTools Protocol, drives the iOS
simulator via `xcrun`/`simctl`, probes Metro, and captures **redacted,
reproducible evidence** — with every state-changing action behind an explicit,
**fail-closed** policy gate.

This repository is a from-scratch **Effect-TS** rebuild (reimagined from the
extracted behavior spec of the original CLI). Its defining property is that the
two load-bearing promises — _fail closed_ and _redact_ — are **structural**: a
command handler cannot reach a device, a runtime-eval, or a source-write
capability except through the dispatcher, which provides that capability into the
handler's effect environment **only after the policy gate passes**. A misrouted
handler is a compile error, not a runtime accident.

## Requirements

- **Node ≥ 20.19**, **pnpm 11**.
- **macOS + Xcode** for any device work (the CLI shells out to `xcrun`/`simctl`;
  read-only commands like `doctor`/`redact`/`version` run anywhere).

## Install

The runnable artifact is an esbuild **bundle** built from the workspace — the
`.ts` source uses `.js`→`.ts` specifiers that resolve only under a bundler, so
the bundle (not the source) is what runs.

```bash
pnpm install
pnpm build        # emits packages/app/cli/run-expo.mjs
node packages/app/cli/run-expo.mjs --json doctor
```

Once published, `npx run-expo --json doctor` (or a global `run-expo` bin) runs the
same self-contained bundle. The published package is `run-expo` (unscoped); the
bin it installs is `run-expo`. The bundle is gitignored and shipped in the npm
tarball via `files` + a `prepack` build hook, with **zero runtime dependencies**
(everything is inlined).

## Usage

Every command takes a global output mode and prints a single envelope.

```bash
BIN="node packages/app/cli/run-expo.mjs"

# Reads — always allowed, no policy needed:
$BIN --json doctor                         # tool/capability readiness
$BIN --json sitemap --root ./apps/mobile   # Expo Router sitemap
$BIN --json expo-compat 54 0.81            # Expo ⇄ React Native compatibility
$BIN --json policy show                     # the effective policy decision
$BIN --json snapshot                        # accessibility + RN tree (live app)

# State-changing actions — denied by default (reported as data at exit 0):
$BIN --json boot-simulator                  # → {"ok":true,"data":{"denied":true,"code":"policy-denied"}}
$BIN --json --action-policy ./policy.json boot-simulator
$BIN --json --allow-runtime-eval trace start  # runtime-eval escape hatch
```

A bare unknown verb (e.g. `boot`) is a usage error (exit 2), not a denial — use
the real verb names (`$BIN --help`).

### Output envelope

`--json` (machine output), `--plain` (human), `--ndjson` (streaming). Success is
`{"ok":true,"data":{…}}`; failure is `{"ok":false,"error":"…"}`. **One redactor
runs over the whole payload** before it is printed (URLs, headers, cookies,
`token`/`auth`/`secret` keys, HAR, run-records), and output is length-bounded
(override with `--max-output`).

### Exit codes (POSIX)

| Code | Meaning                                                                                                                                                           |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0`  | success — including a **policy denial**, reported as data (`data.denied: true`, `code: "policy-denied"`). Branch on `data.denied`, not the exit code, for gating. |
| `1`  | runtime failure (e.g. a read of a missing file, a transport error)                                                                                                |
| `2`  | usage error (`--json --plain` together, a value flag with no value, unknown command/sub-verb)                                                                     |

### Safety / policy model

Four side-effect classes: `read` · `device` · `runtime-eval` · `source-write`.
Reads always pass. The other three **fail closed** — the dispatcher injects the
dangerous capability into a handler's environment **only on the gate-pass
branch**, so a read-classed handler cannot even reference it (a compile error).
Grant via a `--action-policy <file>` JSON document — `allow` (a list of exact
action names), `actions` (`{ "<action>": "allow" }`), and `allowRuntimeEval`;
`source-write` actions additionally require a matching `--confirm-actions` token.
The convenience flag `--allow-runtime-eval` opens runtime-eval. Use `policy show`
to confirm a file actually grants the action before relying on it. Every artifact
write is path-confined; all network access is loopback-only.

## Agent efficiency

run-expo exists to end the ad-hoc mess of agent-driven Expo testing — raw
`xcrun simctl`, hand-written Hermes CDP frames, Metro pokes — by giving an AI
agent **one CLI with a stable, redacted, fail-closed contract**:

- one parseable envelope per command (branch on the exit code, not scraped text);
- redacted by default, so evidence is safe to put in a transcript;
- dangerous actions refused unless explicitly granted — structurally, not by convention;
- a read-first `doctor → inspect → act (gated) → capture evidence` loop.

### Install the agent skill

Drop the operator skill into any repo so Claude (and 50+ other agents) can drive
`run-expo` against the Expo app in that repo:

```bash
npx skills add pproenca/run-expo      # installs the single `run-expo` operator skill
```

It teaches the agent the safe `doctor → inspect → act (gated) → capture evidence`
loop over the published `run-expo` bin — point it at the app with
`--root <expo-project-dir>` (e.g. `--root apps/mobile` in a monorepo). The skill
source lives at `.agents/skills/run-expo/`.

## Workspace

pnpm workspace. The publishable CLI is `packages/app`.

| Package                        | Responsibility                                                                                                                     |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| `@expo98/core`                 | Safety spine: 4-tier policy classifier, single redactor, **capability-injection dispatch**, subprocess, path confinement, clock/id |
| `@expo98/domain`               | Effect `Schema` model + persistence (sessions/targets/snapshots/refs/run-records) + lenient-read/strict-write migration            |
| `@expo98/protocols`            | Loopback-only Metro probe + Hermes CDP client (loopback + connect-time Origin + bounded open)                                      |
| `@expo98/app`                  | CLI shell (`@effect/cli`) + composition root: global flags, POSIX exit codes, `--json\|--plain\|--ndjson`, all commands wired      |
| `@expo98/handlers-devtools`    | trace / inspector / console / errors / navigation (runtime-eval gated)                                                             |
| `@expo98/handlers-interaction` | app+sim lifecycle + interaction/gestures + wait (device gated)                                                                     |
| `@expo98/handlers-snapshot`    | snapshot capture + accessibility + RN introspection                                                                                |
| `@expo98/handlers-net-perf`    | network evidence + performance                                                                                                     |
| `@expo98/expo-integration`     | dev bridge + Expo↔RN compat + Expo Router sitemap                                                                                  |
| `@expo98/handlers-artifacts`   | diff / ux-context / review / dashboard / live-backlog                                                                              |
| `@expo98/overlay-server`       | hardened loopback review-overlay ingest server                                                                                     |

## Develop

```bash
pnpm install
pnpm test            # full vitest acceptance suite
pnpm -r run typecheck
pnpm build           # esbuild → the runnable bins
pnpm run check       # format:check + lint + typecheck + build + test
```

The repo enforces a strict toolchain: `oxfmt` formatting, `oxlint` linting, and
per-package `tsc --noEmit`. CI (`.github/workflows/ci.yml`) runs the full gate on
Node 20.19 + 24.

## Docs

- `CLAUDE.md` — agent & engineer context (architecture, the one inviolable design
  rule, how to run tests, the legacy→modern traceability map).
- `AGENTS.md` — agent harness policy & routing; skills live in `.agents/skills/`.
- `docs/PRODUCTION_READINESS.md` — the readiness scorecard + remaining roadmap.
- `docs/modernization/` — the design provenance: `AI_NATIVE_SPEC.md`,
  `REIMAGINED_ARCHITECTURE.md`, `ASSESSMENT.md`, `BUSINESS_RULES.md`,
  `DATA_OBJECTS.md`, `MODERNIZATION_BRIEF.md`, and `reimagine/` (the 58 ACs).

## License

MIT — see `LICENSE`.
