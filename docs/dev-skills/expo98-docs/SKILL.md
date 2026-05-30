---
name: expo98-docs
description: "Write or review concise, accurate expo98 developer + agent documentation for the Effect-TS rebuild."
---

# expo98 Docs

Use this skill when writing, editing, or reviewing expo98 docs for CLI usage,
the safety/policy model, package behavior, architecture, or modernization
context. expo98 is an Effect-TS pnpm workspace; the publishable CLI is
the package `expo98` (workspace dir `packages/app`; bin `expo98`, emitted to
`packages/app/cli/run-expo.mjs` by `pnpm build`).

## Core Model

- Lead with what the reader is trying to do.
- Give one recommended path before alternatives.
- Make commands runnable and real — they must match the actual bin/scripts.
- Put security and policy caveats exactly where the user makes a risky decision.
- Treat docs as part of the product contract.

## Source Of Truth

- `README.md` — user-facing install, usage, safety model, development.
- `docs/PRODUCTION_READINESS.md` — the sequenced plan, readiness scorecard, open risks.
- `docs/modernization/` — the extracted spec: `AI_NATIVE_SPEC.md`, `REIMAGINED_ARCHITECTURE.md`, `MODERNIZATION_BRIEF.md`, `ASSESSMENT.md`, `BUSINESS_RULES.md`, `DATA_OBJECTS.md`, and `reimagine/{rules-gwt.md (58 ACs),interfaces.md,entities.md}`.
- `CLAUDE.md` / `AGENTS.md` — agent operating rules + the one design rule (capability injection) you must never break.
- The code: `packages/core` (policy/redaction/dispatch/confinePath), `packages/app` (CLI shell), the handler packages.

There is **no** top-level `src/`, no `SPEC.md`, and no `VISION.md` — the spec
lives under `docs/modernization/`. Do not reference paths that do not exist.

## Writing Style

- Direct, practical prose; present tense; active voice.
- Concrete command and file names; `must` for required behavior, `can` for optional.
- No marketing claims, no real secrets, no real private app data, no unreleased-package claims.

## Verification

- Docs-only: `git diff --check`.
- CLI examples: run them — `node packages/app/cli/run-expo.mjs --json <cmd>` (after `pnpm build`).
- Behavior docs: check against the tests, the source, and `docs/modernization/reimagine/rules-gwt.md`.
- Package/tarball docs: verify `packages/app/package.json` (`bin`/`files`) and `pnpm pack --dry-run --json --filter @expo98/app`.

## Review Checklist

- The first screen says what the reader can accomplish.
- The recommended path is obvious and every command is real (the built bundle path or the installed bin — never a deleted single-package `cli/expo98.mjs` at repo root, `node --test`, or `npx --no-install` form).
- Prerequisites (Node ≥ 20.19, pnpm 11, macOS + Xcode for device work) are explicit.
- The safety/policy model is described, never softened: read passes; device/runtime-eval/source-write fail closed without a grant.
- Source↔bundle behavior is accurate (the bundle is the runnable artifact; `pnpm build` emits it; it is gitignored, shipped via `files`+`prepack`).
- No legacy-repo or unrelated-harness wording leaked in.
