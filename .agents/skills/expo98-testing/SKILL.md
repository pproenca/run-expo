---
name: expo98-testing
description: "Choose, run, rerun, or debug the cheapest safe expo98 validation path."
---

# expo98 Testing

Use this skill when deciding what to test, debugging failures, or validating an expo98 change without wasting time.

## Default Rule

Prove the touched surface first. Do not reflexively run every command.

1. Inspect the diff and classify the touched surface.
2. Reproduce narrowly before fixing, when there is a reported failure.
3. Fix the root cause.
4. Rerun the same narrow proof.
5. Broaden only when package, generated output, or user-visible behavior requires it.

## Test Routing

- Docs or agent-harness only: `git diff --check`.
- Runtime source under `src/`: targeted `node --test tests/*.mjs` when useful, then `pnpm test`, then `pnpm run build`.
- Generated bundle/package surface: `pnpm run build`, `pnpm test`, and `pnpm pack --dry-run --json`.
- Package metadata, bins, README, or `files`: `pnpm test` and `pnpm pack --dry-run --json`.
- CLI behavior: add or update Node tests when practical, then smoke with `npx --no-install expo98 --json doctor`.
- Lockfile or dependency changes: `pnpm install --frozen-lockfile`, `pnpm test`, and package dry run.

## Commands

```bash
pnpm install --frozen-lockfile
pnpm test
pnpm run build
pnpm pack --dry-run --json
npx --no-install expo98 --json doctor
```

## Guardrails

- Do not run independent `pnpm test` commands concurrently in one worktree.
- Do not rebuild `cli/expo98.mjs` for docs-only or agent-harness-only changes.
- Do not update generated output without the source change that requires it.
- If a command fans out unexpectedly or starts touching unrelated state, stop and reassess.
- If proof is blocked, report the exact command and first actionable error.

## Output Habit

Report:

- touched surface
- commands run
- pass/fail result
- package dry-run inclusion check when package surface might change
- untested risk, if any
