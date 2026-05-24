---
name: expo98-docs
description: "Write or review concise, accurate expo98 developer documentation."
---

# expo98 Docs

Use this skill when writing, editing, or reviewing expo98 docs for CLI usage, safety policy, package behavior, architecture, or modernization context.

## Core Model

- Lead with what the reader is trying to do.
- Give one recommended path before alternatives.
- Make commands runnable and realistic.
- Keep references precise and current.
- Put security and policy caveats exactly where the user can make a risky decision.
- Treat docs as part of the product contract.

## Source Of Truth

- `README.md`: user-facing install, common commands, development, and package shape.
- `SPEC.md`: package, output, command family, safety, build, and test contracts.
- `docs/business-rules.md`: source-cited behavior context from modernization.
- `docs/architecture.md`: architecture context.
- `VISION.md`: product direction and guardrails.
- `AGENTS.md`: agent operating rules.

## Writing Style

- Use direct, practical prose.
- Prefer present tense and active voice.
- Use concrete command and file names.
- Avoid marketing claims, vague benefits, and long conceptual lead-ins.
- Use `must` for required behavior and `can` for optional capability.
- Keep examples free of real secrets, real private app data, or unreleased package claims.

## Verification

- Docs-only: run `git diff --check`.
- CLI examples: run them when practical, usually with `pnpm expo98 ...` or `npx --no-install expo98 ...`.
- Behavior docs: compare against tests, source, `SPEC.md`, and `docs/business-rules.md`.
- Package docs: verify `package.json` and `pnpm pack --dry-run --json` when package inclusion is described.

## Review Checklist

- The first screen says what the reader can accomplish.
- The recommended path is obvious.
- Prerequisites are explicit.
- Commands match current package scripts and bins.
- Safety policy is not softened or bypassed.
- Generated bundle behavior is described accurately.
- No OpenClaw-only harness, plugin, channel, or release wording leaked into expo98 docs.
