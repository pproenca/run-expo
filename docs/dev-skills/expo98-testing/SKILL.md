---
name: expo98-testing
description: "Choose, run, rerun, or debug the cheapest safe expo98 validation path in the Effect-TS pnpm workspace."
---

# expo98 Testing

Use this skill when deciding what to test, debugging a failure, or validating an
expo98 change without wasting time. This repo is an **Effect-TS pnpm workspace**
(11 packages under `packages/*`), tested with **vitest** (`@effect/vitest`). The
runnable CLI is the **esbuild bundle** at `packages/app/cli/run-expo.mjs`, built by
`pnpm build` — not the `.ts` source (whose `.js`→`.ts` specifiers resolve only
under a bundler/vitest, so `node packages/app/src/main.ts` cannot run by design).

## Default Rule

Prove the touched surface first. Do not reflexively run every command.

1. Inspect the diff and classify the touched package(s).
2. Reproduce narrowly before fixing, when there is a reported failure.
3. Fix the root cause.
4. Rerun the same narrow proof.
5. Broaden only when the package boundary, the bundle, or user-visible behavior requires it.

## Test Routing

- **Docs / agent-harness only:** `git diff --check`.
- **One package's logic:** `pnpm exec vitest run packages/<pkg>/test`, then `pnpm test`.
- **`packages/core` (safety spine):** also run `packages/core/test/capability-injection.test.ts` and `packages/core/test/confine-path.test.ts` — they pin the fail-closed + confinement invariants.
- **CLI shell / command surface (`packages/app`, any handler):** `pnpm build` then `pnpm test` (the build makes `bundle-parity.test.ts` run live), then smoke `node packages/app/cli/run-expo.mjs --json doctor`.
- **`packages/protocols` (CDP/Metro transport):** `pnpm exec vitest run packages/protocols/test` and `pnpm build` (esbuild surfaces bundle-only defects).
- **Cross-package wiring:** `packages/app/test/dependency-dag.test.ts` (the M4 acyclic guard) + `pnpm -r run typecheck`.
- **Lockfile / dependency changes:** `pnpm install --frozen-lockfile`, `pnpm test`, `pnpm pack --dry-run --json --filter @expo98/app`.

## Commands

```bash
pnpm install --frozen-lockfile
pnpm test                      # full vitest acceptance suite (all packages)
pnpm -r run typecheck          # tsc --noEmit per package
pnpm build                     # esbuild → packages/app/cli/run-expo.mjs
pnpm run check                 # format:check + lint + typecheck + build + test
pnpm exec vitest run packages/<pkg>/test
node packages/app/cli/run-expo.mjs --json doctor   # smoke the shipped bin
```

## Live (hardware) tests

29 acceptance tests are `it.skip`'d because they need a **booted simulator /
running Hermes app / Metro / Expo project / socket bind**. Their gating,
redaction, and confinement are already proven by passing tests — the skips are
about transports, not safety. Run them only via the live UAT lane (see the
`expo98-operator` skill); never convert a skip to a live test in CI.

## Guardrails

- Do not run independent `pnpm test` invocations concurrently in one worktree.
- Do not rebuild the bundle for docs-only changes.
- A green `pnpm test` on a **stale** bundle is a false pass — run `pnpm build` first when the command surface changed; CI enforces this via the parity test.
- Never weaken the capability-injection or confinePath tests to make a change pass.
- If proof is blocked, report the exact command and the first actionable error.

## Output Habit

Report: touched package(s); commands run; pass/fail with the suite's
`N passed | M skipped`; whether the bundle was rebuilt; untested risk, if any.
