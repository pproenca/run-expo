# AGENTS.md

Telegraph style. Root rules only. Skills own workflows; this file owns hard policy and routing.

## Start

- Repo: `https://github.com/pproenca/run-expo`
- Package: Effect-TS **pnpm workspace** — 11 packages under `packages/*`. The publishable CLI is the package `run-expo` (workspace dir `packages/app`); the other 10 are private `@expo98/*` packages inlined into its bundle.
- Executable: `run-expo` (single bin).
- Source entrypoint: `packages/app/src/main.ts`.
- Runnable artifact: the esbuild **bundle** `packages/app/cli/run-expo.mjs` — build with `pnpm build`. The `.ts` source uses `.js`→`.ts` specifiers that resolve only under a bundler, so the source cannot run un-bundled by design; the bundle is what runs. It is gitignored and shipped via `files`+`prepack`.
- Source-cited behavior context: `docs/modernization/BUSINESS_RULES.md`.
- Public contracts: `README.md`, `docs/modernization/` (spec), `package.json`, and packed package contents.
- Missing deps: `pnpm install --frozen-lockfile`, retry once, then report the first actionable error.
- Never print secrets. Redaction behavior is part of the product contract.

## Shape

- Keep the repo as a publishable workspace, not a modernization analysis tree.
- Per-package layout: runtime source under `packages/<pkg>/src/`, tests under `packages/<pkg>/test/`, repo docs under `docs/`, the bundled bins under `packages/app/cli/`.
- The M4 dependency DAG is law: `core` depends on nothing; `domain`/`protocols` depend only on `core`; handler/integration/overlay packages depend on `core`/`domain`/`protocols` but never on each other; `app` may depend on all. The whole `@expo98/*` graph stays acyclic (enforced by `packages/app/test/dependency-dag.test.ts`).
- Do not edit `packages/app/cli/*.mjs` directly; change source and run `pnpm build`.
- Do not add `package-lock.json`, `yarn.lock`, package tarballs, coverage, HAR files, caches, or `dist/` output.
- Do not commit the built bundle — it is gitignored and built fresh in CI/publish.

## Architecture

- The CLI is a local evidence tool for Expo and React Native iOS work.
- Read-only evidence commands work without policy.
- State-changing commands (`device` / `runtime-eval` / `source-write`) require an explicit grant and **fail closed** when policy is absent or denies the action.
- THE design rule (never break it): the dispatcher injects a dangerous capability tag into a handler's Effect `R` **only on the gate-pass branch** for that class; a `read`-classed handler's `R` cannot name those tags → calling them is a compile error. Never classify by action-name string; never let a handler import a protocol's eval/device surface directly. Proven in `packages/core/test/capability-injection.test.ts`.
- CLI output modes are contracts: `--json` machine-readable, `--plain` stable line-oriented, `--ndjson` streaming. Exit codes: `0` ok (a denial is data, still 0) · `1` runtime failure · `2` usage error.
- One redactor runs over the whole output value before stdout/stderr, persisted run records, HAR, and summaries. Every artifact write goes through `confinePath`. All network access is loopback-only.
- Prefer small explicit transformations over runtime magic. Dependency-backed behavior needs upstream docs/source/types or local proof before relying on defaults, errors, timing, or private surfaces.

## Code

- TypeScript ESM, Effect-TS. Keep code compatible with the declared Node engine (≥ 20.19).
- Avoid `any`; use `unknown`, discriminated unions, and narrow adapters.
- Prefer early returns over nested condition pyramids.
- Split logic into gather -> normalize -> decide -> act.
- Public errors and JSON payload fields should be stable and tested.
- Preserve output determinism where ordering affects JSON, text, snapshots, or package contents.
- Inline comments only for non-obvious invariants, security decisions, or previously bug-prone logic.
- Do not edit generated caches or `node_modules`.

## Docs

- Behavior/API/CLI changes need matching docs when user-visible.
- Use `docs/modernization/BUSINESS_RULES.md` before deciding a behavior is accidental.
- Keep docs direct and task-oriented. Prefer current behavior over legacy narrative unless compatibility depends on it.
- The spec lives under `docs/modernization/` (`AI_NATIVE_SPEC.md`, `REIMAGINED_ARCHITECTURE.md`, `reimagine/rules-gwt.md` = the 58 ACs). `docs/PRODUCTION_READINESS.md` owns the roadmap. There is no `SPEC.md` or `VISION.md`.
- Docs-only changes need `git diff --check`; run command examples when practical.

## Tests

- Tests use vitest (`@effect/vitest`); each test name carries its `AC-0NN` id.
- Default proof:
  - `pnpm test` (full suite) or `pnpm exec vitest run packages/<pkg>/test` (one package)
  - `pnpm -r run typecheck`
  - `pnpm build` after runtime/source changes (makes `bundle-parity.test.ts` run live)
  - `node packages/app/cli/run-expo.mjs --json doctor` for an executable smoke
  - `pnpm pack --dry-run --json --filter run-expo` after `bin`/`files`/README/package changes
- For narrow edits, run the smallest test that proves the touched surface first, then broaden only when the contract demands it.
- 29 live tests are `it.skip`'d (need a booted sim / Hermes / Metro / Expo project / socket); never un-skip them in CI.
- Do not run independent `pnpm test` commands concurrently in one worktree.
- Do not update baselines, generated output, or expected failures to silence checks without explicit approval.

## Package

- `pnpm-lock.yaml` is the only committed package-manager lockfile.
- `pnpm-workspace.yaml` defines the `packages/*` workspace + the `allowBuilds` gate; keep `esbuild: false` (or `pnpm install --frozen-lockfile` re-breaks).
- Only the package `run-expo` (`packages/app`) is publishable; the other 10 `@expo98/*` packages stay `private` and are inlined by the bundle (so `run-expo` ships with zero runtime deps — its workspace deps live under `devDependencies`). Keep `run-expo` `files` minimal (the bundle + README + LICENSE). Release via the `v*` tag → `.github/workflows/release.yml` (npm provenance).
- No release, version bump, or publish without explicit approval.

## Git

- You may be in a dirty tree. Never revert or overwrite changes you did not make.
- Stage and commit only intended files when asked to commit.
- No branch switches, rebases, stashes, resets, or destructive checkout commands unless requested.
- Conventional-ish concise commit messages are preferred.
- Never commit the built `packages/app/cli/` bundle.

## Security

- Never commit credentials, real tokens, local device secrets, recordings with private data, or live operator config.
- Treat `.scratch/`, HARs, recordings, screenshots, and run records as local evidence unless explicitly curated.
- Policy gates are security boundaries. Do not bypass them for convenience.
- Runtime evaluation and bridge installation/removal require explicit approval paths.
- Network, route, storage, and state evidence must redact secret-bearing fields and sensitive query values.
- Dependency and lockfile changes are security surface; review them deliberately.

## Skills

- **Published consumer skill** — `.agents/skills/run-expo/` (`$run-expo`): drive a real Expo/RN iOS app via the published `run-expo` npm bin. This is the **only** skill exposed by `npx skills add pproenca/run-expo`; keep it the sole entry under `.agents/skills/` so a consumer install lands exactly one skill.
- **Repo-development skills** — `docs/dev-skills/` (deliberately outside the skill-tool scan path):
  - `expo98-operator`: in-repo operator loop using the **locally built** bundle (`node packages/app/cli/run-expo.mjs`).
  - `expo98-testing`: choose the cheapest safe test/build/package proof.
  - `expo98-debugging`: debug CLI, policy gate, redaction, simulator, Metro, Hermes CDP, bridge, network/perf, and source↔bundle drift.
  - `expo98-docs`: write or review repo + agent docs.
  - `autoreview`: structured review closeout for non-trivial patches.
  - `crabbox`: optional remote proof guidance; unavailable unless a valid repo Crabbox config/tooling is present.
