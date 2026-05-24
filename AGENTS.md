# AGENTS.md

Telegraph style. Root rules only. Skills own workflows; this file owns hard policy and routing.

## Start

- Repo: `https://github.com/pproenca/expo98`
- Package: pnpm-managed single-package CLI workspace.
- Primary executable: `expo98`. `expo-ios` is a compatibility bin only.
- Source entrypoint: `src/bundled-cli.ts`.
- Generated package output: `cli/expo98.mjs`; rebuild with `pnpm run build` after runtime changes.
- Source-cited behavior context: `docs/business-rules.md`.
- Public contracts: `README.md`, `SPEC.md`, `package.json`, and packed package contents.
- Missing deps: `pnpm install --frozen-lockfile`, retry once, then report the first actionable error.
- Never print secrets. Redaction behavior is part of the product contract.

## Shape

- Keep the repo as a publishable package surface, not a modernization analysis workspace.
- Root package stays single-package: no transformed-module workspaces, app projects, or generated analysis trees at repo root.
- Runtime source belongs under `src/`; tests under `tests/`; docs under `docs/`; bundled executable output under `cli/`.
- Do not edit `cli/expo98.mjs` directly. Change source and run `pnpm run build`.
- Do not add `package-lock.json`, `yarn.lock`, package tarballs, coverage, HAR files, caches, or package `dist/` output.
- Keep runtime dependencies in `dependencies` when the packed CLI needs them through `npx expo98 ...`.
- Do not add dev-only tooling that changes package install behavior unless the task explicitly asks for it.

## Architecture

- The CLI is a local evidence tool for Expo and React Native work.
- Read-only evidence commands should work without policy.
- State-changing commands require an explicit action policy and fail closed when policy is absent or denies the action.
- CLI output modes are contracts: `--json` is machine-readable, `--plain` is stable line-oriented output, human output is best-effort.
- Secrets must be redacted before stdout, stderr, persisted run records, HAR output, and summaries.
- Local runtime bridges, storage/state writes, app/device mutations, and runtime evaluation are high-risk surfaces; preserve policy gates.
- Prefer small, explicit data transformations over broad runtime magic.
- Dependency-backed behavior needs upstream docs/source/types or current local proof before relying on defaults, errors, timing, or private surfaces.
- Handle real production states, shipped upgrade paths, and security boundaries. Do not add defensive branches for unrealistic malformed input.

## Code

- TypeScript ESM. Keep code compatible with the package's declared Node engine.
- Avoid `any`; use `unknown`, discriminated unions, and narrow adapters.
- Prefer early returns over nested condition pyramids.
- Split logic into gather -> normalize -> decide -> act.
- Public errors and JSON payload fields should be stable and tested.
- Preserve generated-output determinism where ordering affects JSON, text, snapshots, or package contents.
- Inline comments only for non-obvious invariants, security decisions, or previously bug-prone logic.
- Do not edit generated caches or `node_modules`.

## Docs

- Behavior/API/CLI changes need matching docs when user-visible.
- Use `docs/business-rules.md` before deciding a behavior is accidental.
- Keep docs direct and task-oriented. Prefer current behavior over legacy narrative unless compatibility depends on it.
- `VISION.md` owns product direction. `SPEC.md` owns package, CLI, safety, build, and test contracts.
- Docs-only changes need `git diff --check`; run command examples when practical.

## Tests

- Default proof:
  - `pnpm test`
  - `pnpm run build` after runtime/source changes
  - `pnpm pack --dry-run --json` after package, README, bin, files, or generated bundle changes
  - `npx --no-install expo98 --json doctor` for executable smoke when runtime behavior changes
- For narrow edits, run the smallest test that proves the touched surface first, then broaden only when the contract demands it.
- Do not run independent `pnpm test` commands concurrently in one worktree.
- If tests are blocked, report the exact missing tool, failing command, and first actionable error.
- Do not update baselines, generated output, or expected failures just to silence checks without explicit approval.

## Package

- `pnpm-lock.yaml` is the only committed package-manager lockfile.
- `pnpm-workspace.yaml` should remain a single-package workspace unless the package shape intentionally changes.
- `package.json` `files` should keep the npm tarball minimal.
- Before publish-oriented handoff, verify `pnpm pack --dry-run --json` includes only intended package files.
- No release, version bump, or publish without explicit approval.

## Git

- You may be in a dirty tree. Never revert or overwrite changes you did not make.
- Stage and commit only intended files when asked to commit.
- No branch switches, rebases, stashes, resets, or destructive checkout commands unless requested.
- Conventional-ish concise commit messages are preferred.
- If a change touches generated runtime output, include both source and generated bundle in the same commit.

## Security

- Never commit credentials, real tokens, local device secrets, videos with private data, or live operator config.
- Treat `.scratch/`, HARs, recordings, screenshots, and run records as local evidence unless explicitly curated.
- Policy gates are security boundaries. Do not bypass them for convenience.
- Runtime evaluation and bridge installation/removal require explicit approval paths.
- Network, route, storage, and state evidence must redact secret-bearing fields and sensitive query values.
- Dependency and lockfile changes are security surface; review them deliberately.

## Skills

- `$autoreview`: structured review closeout for non-trivial patches.
- `$expo98-testing`: choose the cheapest safe test/build/package proof.
- `$expo98-debugging`: debug CLI, policy, simulator, Metro, bridge, network, performance, and bundle drift.
- `$expo98-docs`: write or review repo docs.
- `$crabbox`: optional remote proof guidance; unavailable unless a valid repo Crabbox config/tooling is present.
