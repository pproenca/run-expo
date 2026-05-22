---
name: expo-ios-cli
description: Use when running expo-ios.
---

# Expo iOS CLI

Use `expo-ios --json ...` for local evidence. Read `../../SPEC.md` only when changing the CLI.

## Contract

- Success: `{ "ok": true, "data": ... }`
- Invalid usage exits `2`; runtime failures exit `1`
- Errors are machine-readable and redact secrets
- Prefer `--json`; use `--record` or `--state-dir` for resumable evidence
- The CLI never prompts

## Start

```bash
command -v expo-ios || (cd /path/to/expo98 && make install-local)
expo-ios --json doctor
expo-ios --json project-info --cwd /path/to/expo-app
expo-ios --json routes --cwd /path/to/expo-app
```

Use:

```bash
expo-ios --json devices --platform ios
expo-ios --json ux-context --cwd /path/to/expo-app --bundle-id com.example.app --metro-port 8081
expo-ios --json screenshot --cwd /path/to/expo-app
expo-ios --json review-next --surface calendar --stage pre-patch --issue "drag regression"
```

Use `review-next` when the next evidence step is unclear.

- `gesture`: tap, long-press, drag, swipe; dry-run risky coordinates.
- `trace start/read/stop`: concrete reproductions.
- `inspector probe/toggle/install-comment-menu/read-comments`: simulator hit boxes or human notes.
- `annotate-screen --serve true`: screenshot-level fallback comments.
- `review-overlay scaffold/prepare --serve true`: in-app element targeting, boxes, owner hierarchy, source hints, clipboard feedback.

Read commands are safe for evidence. Simulator launch/tap/gesture, inspector toggles, overlay scaffold/prepare/clear, annotation serve, and trace start/stop change state.
