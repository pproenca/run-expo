---
name: crabbox
description: "Optional remote validation guidance for expo98; unavailable unless Crabbox tooling and repo config are present."
---

# Crabbox

Use this skill only when remote proof is explicitly requested or local proof is insufficient and the required Crabbox tooling/configuration exists.

This repo does not currently carry an adapted `.crabbox.yaml`. Treat Crabbox as unavailable unless a valid config and wrapper are added or the user provides the exact remote command to run.

## Default Position

- Prefer local targeted proof for expo98 changes.
- Use `pnpm test`, `pnpm run build`, `pnpm pack --dry-run --json`, and `npx --no-install expo98 --json doctor` before considering remote validation.
- Do not copy OpenClaw's Crabbox config directly. It is tuned for a different monorepo, CI image, cache shape, and environment variable namespace.

## If Configured Later

An expo98 Crabbox config should:

- sync only this single-package checkout
- exclude `.scratch/`, `.agents` local installs, caches, `node_modules/`, package tarballs, and coverage
- allow only necessary environment variables
- report the actual provider and run id
- run commands that prove expo98 package behavior, not OpenClaw release or plugin behavior

## Report

When remote proof is used, report:

- provider/backend
- run or lease id
- exact command
- relevant output summary
- local proof already run
- gaps or unavailable tools
