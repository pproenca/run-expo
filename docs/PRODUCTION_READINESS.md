# expo98 — Production Readiness

> Synthesized from the `expo98-production-readiness` multi-agent workflow (8 gap
> dimensions, each adversarially verified, + synthesis + a completeness critic).
> This is the sequenced plan to take the green Effect-TS scaffold to a trusted,
> runnable, publishable CLI + agent skill. **Status reflects what is actually on
> disk and verified, not what was proposed.**

## Verified state (2026-05-30)

`pnpm test` → **525 passing / 29 skipped / 0 failing** · `pnpm -r run typecheck`
clean · `pnpm build` 0 warnings · both bins exit 0 · bundle↔source parity test
live · `cli/` untracked + gitignored.

## Golden-standard definition (the bar)

A single trusted, fast, agent-efficient CLI that ends the tooling mess of
agent-driven Expo/RN iOS testing. Eight properties must all hold:

1. **Runnable & installable** — the `expo98` bin runs from one
   self-contained esbuild bundle (the `.js`→`.ts` source design means un-bundled
   source cannot run, by design); each self-executes exactly once at the correct
   POSIX exit code; `@expo98/app` is publishable.
2. **Trusted (the spine never bends)** — capability-injection holds at the type
   level (a `read` handler's `R` cannot name a dangerous capability → compile
   error); the fail-closed gate has no bypass and never classifies by
   action-name string; ONE redactor over whole values (incl. free-form secret
   literals); `confinePath` on EVERY artifact write incl. `SourceWriteCapability`;
   loopback before any CDP/Metro connect; run-records observational on all branches.
3. **Deterministic & self-proving** — source↔bundle parity test with a negative
   control; stable `--json` key order; `--max-output`/`--record`/`--state-dir`
   actually function.
4. **Fast** — bundle cold-start measured against a committed CI baseline.
5. **CI-gated** — install(frozen)+format+lint+typecheck+build+parity+bin-smoke+test
   on Node 20.19 & 24.
6. **Supply-chain hardened & publishable** — `minimumReleaseAge` wired;
   tag-triggered publish of `@expo98/app` only, with npm provenance.
7. **Agent-authoritative docs & skills** — every onboarding artifact describes
   THIS 11-package workspace; an agent-operator skill encodes the safe loop.
8. **Live-proven transports** — the genuine live seams env-gated and driven
   against a real simulator/Metro/Hermes/Expo target via a runbook.

## Readiness scorecard

| Dimension                           | Status                                                                                    | Blocks release?           |
| ----------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------- |
| Build & packaging (runnable binary) | ✅ **done + verified**                                                                    | was the blocker — cleared |
| Toolchain / CI / supply chain       | ✅ CI + `minimumReleaseAge` + `cli/` untracked; **publish (W25) + LICENSE field pending** | publish path: yes         |
| Agent skills                        | ✅ 3 rewritten + new operator skill                                                       | no                        |
| Docs & agent DX                     | 🟡 skills + this doc done; **README Install/Usage (W20) pending**                         | no                        |
| Security & safety hardening         | ⬜ **NOT started** — W8–W13 open (real findings below)                                    | yes (trust)               |
| Reliability / determinism / speed   | ⬜ **NOT started** — W14–W18 open                                                         | partial                   |
| Live transport UAT (29 skips)       | ⬜ pending — **needs hardware**                                                           | no (safety proven)        |
| Expo SDK seam discharge             | ⬜ pending — **needs a target Expo project**                                              | no                        |

## Done this session (verified on disk)

- **Build wiring → runnable, publishable bins.** `@expo98/app` declares `bin`
  (`expo98`), `build`, `prepack`, and `files`; root `pnpm build` +
  `check` build before test. `scripts/build.mjs` emits two self-contained ESM
  bins (`createRequire` shim for the bundled `yaml` CJS dep; single shebang;
  `import.meta.main` entry detection). `bundle-parity.test.ts` guards drift.
  `main.ts` entry-detection fix landed. _(The build.mjs/bundles/parity/main.ts
  work was produced by the workflow's build agent; the package.json/root wiring
  and the gitignore change this session.)_
- **`cli/` no longer tracked in git.** `git rm --cached` + `.gitignore`
  `packages/app/cli/` + a `prepack` hook. The published tarball still ships the
  bundle (via `files` + `prepack`); CI builds it; the parity test skips when
  absent. **This dissolves the W2 "committed bundle drift / double-fire" risk
  entirely** — the bundle is always built fresh, never committed.
- **CI + supply chain.** `.github/workflows/ci.yml` (install-frozen → format →
  lint → typecheck → build → test → assert `cli/` not stale → smoke both bins, on
  Node 20.19 + 24). `minimumReleaseAge: 10080` (7-day delay) + `esbuild: false`
  in `pnpm-workspace.yaml` (the latter unblocks `pnpm install --frozen-lockfile`).
- **Skills.** Rewrote `expo98-testing` / `expo98-debugging` / `expo98-docs` for
  the Effect-TS monorepo + the real command surface; added a new
  **`expo98-operator`** skill (the boot→inspect→act→evidence agent loop).

## NOT done — corrections to earlier claims

An unstable tool channel caused edits to be attempted against hallucinated file
contents. These **did not land** and are still open:

- The **`confinePath` "CWE-22 prefix" fix was unnecessary** — the real
  `packages/core/src/confine-path.ts` already does separator-boundary containment
  (`isContained` with `rootWithSep`); `/a/artifacts-evil` is already rejected for
  `/a/artifacts`. The real confinement gaps are **W9** (SourceWriteCapability
  writes/deletes bypass `confinePath`) and **W10** (lexical-only; no symlink/
  realpath gate).
- The **`ws-adapter` "namespace-import crash" fix was a non-issue** — the real
  adapter already uses `import WebSocket from "ws"` and is already an interruptible
  `Effect.async` with a terminate-on-interrupt finalizer. No FD-leak fix was
  needed there.
- No redactor, overlay-token, or reliability change landed. Suite is 525, not 530.

## Remaining work (ordered; from the verified workflow plan)

**Security & safety (W8–W13, W24)** — the real, confirmed findings:

- **W9** Confine `SourceWriteCapability` writes/deletes; drop recursive delete.
- **W10** Symlink-aware (realpath) second gate for FS artifact writes.
- **W8** Harden the single redactor for free-form literal secrets (PEM incl.
  PKCS#8 via `[A-Z ]*`, JWT, bearer, `ghp_`/`sk-`/`xox*`, joined-env, >256-char
  prefix) + extra key words; keep patterns linear (ReDoS guard).
- **W11** Redact the deny-branch run-record summary (uniform redact-before-disk).
- **W12** CSPRNG overlay session token + wire its generation.
- **W13** Argv option-smuggling guard for `xcrun`/`simctl`/`idb` inputs.
- **W24** `SECURITY.md` threat model (state `confinePath` is lexical until W10).

**Reliability / determinism (W14–W18)**:

- **W14** Make `--max-output` actually apply. **W15** Wire `RunRecorder` for
  `--record`/`--state-dir` (observational, via core's Id). **W16** Stable `--json`
  key order. **W17** Route lifecycle crash-window clock through core's Id
  (TestClock-drivable). **W18** Startup-latency budget on the bundle in CI.

**Docs / release / governance**:

- **W20** README Install + Usage + envelope + exit-codes + safety + agent loop.
- **W19** Update `AGENTS.md` to the 11-package workspace. **W23** Skill-rot lint test.
- **W25** Tag-triggered `release.yml` publishing `@expo98/app` with provenance.
- **LICENSE/metadata** (completeness critic): root `LICENSE` exists (MIT), but add
  `"license": "MIT"` + `repository`/`keywords` to `@expo98/app`, set `os: ["darwin"]`
  (the CLI is macOS-only via `xcrun`), and a `CHANGELOG.md` + stability contract
  for the `--json` envelope / exit-codes / command names / policy schema.

**Hardware / target-project (need a booted sim + Hermes + Metro + an Expo app)**:

- **W26** Real Metro HTTP adapter + runtime-eval target-URL resolution.
- **W27** Env-gated live harness (`EXPO98_LIVE=1`) + author the ~18 real transport
  bodies (11 of the "29 skips" are empty placeholder markers); update the skip count.
- **W28** Live-UAT runbook + fixtures + non-blocking macOS live CI job.
- **W29/W30/W31** Discharge the Expo SDK seam (BridgeTransport Layer + bridge
  commands; project-real compat/sitemap with `--root` threaded into CommandContext;
  compat JSON loads from the bundle).

## Critical path

W-build (done) → **W8–W13 security** → **W20 README** → **W25 release** ·
hardware track (W26→W27→W28) and Expo-seam track (W29→W30→W31) run independently
once a sim + target Expo project are available.

## Remaining risks

- Security hardening (W8–W13) is the highest-value remaining work and touches the
  core safety spine; it must be done with the full suite green at each step and
  the capability-injection + M4-DAG invariants untouched.
- Live transports (W26–W28) and the Expo seam (W29–W31) cannot be proven in CI —
  they need real hardware / a target Expo project. Safety/gating is already proven.
- `minimumReleaseAge: 10080` delays adopting <7-day-old dep releases (intended).

## How to verify the current state

```bash
pnpm install --frozen-lockfile
pnpm run check        # format:check + lint + typecheck + build + test
node packages/app/cli/expo98.mjs --json doctor
node packages/app/cli/expo98.mjs --json boot   # observe the fail-closed denial
```
