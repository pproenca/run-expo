---
name: autoreview
description: "Structured review closeout for expo98 patches. Use after non-trivial edits before final, commit, or ship."
---

# Auto Review

Use this skill to run the bundled structured review helper as a closeout check for expo98 changes.

This is code review, not approval routing. Treat results as advisory and verify every accepted finding against the real code.

## Use When

- The user asks for autoreview, Codex review, Claude review, or second-model review.
- A patch changes runtime behavior, policy gates, redaction, package metadata, build output, or tests.
- A branch or commit needs a focused review before handoff.

## Contract

- Do not blindly apply review output.
- Verify each finding by reading the actual path and adjacent code.
- Read dependency docs/source/types when a finding depends on external behavior.
- Reject speculative risks, unrealistic edge cases, broad rewrites, and fixes that over-complicate the package.
- Prefer fixes at the right boundary: source first, generated bundle only through `pnpm run build`.
- If a review-triggered fix changes code, rerun focused tests and review again.
- Stop when the helper exits cleanly with no accepted/actionable findings.
- Do not push just to review.

## Commands

Dirty local patch:

```bash
.agents/skills/autoreview/scripts/autoreview --mode local
```

Branch review:

```bash
.agents/skills/autoreview/scripts/autoreview --mode branch --base origin/master
```

Single commit review:

```bash
.agents/skills/autoreview/scripts/autoreview --mode commit --commit HEAD
```

Add context when the risk is specific:

```bash
.agents/skills/autoreview/scripts/autoreview \
  --mode local \
  --prompt "Focus on policy gates, secret redaction, generated bundle drift, and npm package contents."
```

## expo98 Review Priorities

- `expo98` remains the primary executable; `expo-ios` remains compatibility only.
- Runtime changes are made in `src/bundled-cli.ts` and rebuilt into `cli/expo98.mjs`.
- State-changing commands remain policy-gated.
- JSON/plain output contracts stay stable.
- Secret-bearing values are redacted before output or persistence.
- `pnpm-lock.yaml` remains the only package-manager lockfile.
- `pnpm pack --dry-run --json` includes only intended package files.
