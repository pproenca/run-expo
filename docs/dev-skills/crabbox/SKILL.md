---
name: crabbox
description: "Optional remote validation guidance for expo98; unavailable unless Crabbox tooling and repo config are present."
---

# Crabbox

Use this skill only when remote proof is explicitly requested, or local proof is
insufficient and the required Crabbox tooling/configuration exists.

This repo does not currently carry an adapted `.crabbox.yaml`. Treat Crabbox as
unavailable unless a valid config and wrapper are added, or the user provides the
exact remote command to run.

## Default Position

- Prefer local targeted proof for expo98 changes.
- Use `pnpm install --frozen-lockfile`, `pnpm test`, `pnpm -r run typecheck`, `pnpm build`, and `node packages/app/cli/run-expo.mjs --json doctor` before considering remote validation.
- Do not copy another project's Crabbox config directly. It is tuned for a different monorepo, CI image, cache shape, and environment-variable namespace.

## If Configured Later

An expo98 Crabbox config should:

- sync this pnpm **workspace** checkout (all `packages/*`), not a single package;
- exclude `.scratch/`, `.artifacts/`, local `.agents` skill installs, caches, `node_modules/`, `packages/app/cli/` (the built bundle), package tarballs, and coverage;
- allow only the necessary environment variables;
- run the real workspace proof — `pnpm install --frozen-lockfile && pnpm -r run typecheck && pnpm build && pnpm test` — and prove expo98 behavior, not any unrelated release/plugin behavior.

## Report

When remote proof is used, report: the provider/backend; the run or lease id; the
exact command; a relevant output summary; the local proof already run; and any
gaps or unavailable tools.
