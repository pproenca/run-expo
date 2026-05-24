# expo98

`expo98` is a local-first **evidence CLI for Expo / React Native iOS work**. It
inspects a running app over the Hermes Chrome DevTools Protocol, drives the iOS
simulator via `xcrun`/`simctl`, probes Metro, and captures **redacted,
reproducible evidence** — with every state-changing action behind an explicit,
**fail-closed** policy gate.

This repository is a from-scratch **Effect-TS** rebuild (reimagined from the
extracted behavior spec of the original CLI). Its defining property is that the
two load-bearing promises — _fail closed_ and _redact_ — are **structural**: a
command handler cannot reach a device, a runtime-eval, or a source-write
capability except through the dispatcher, which provides that capability into the
handler's effect environment **only after the policy gate passes**. A misrouted
handler is a compile error, not a runtime accident.

## Workspace

pnpm workspace. The publishable CLI is `packages/app`.

| Package                        | Responsibility                                                                                                                     |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| `@expo98/core`                 | Safety spine: 4-tier policy classifier, single redactor, **capability-injection dispatch**, subprocess, path confinement, clock/id |
| `@expo98/domain`               | Effect `Schema` model + persistence (sessions/targets/snapshots/refs/run-records) + lenient-read/strict-write migration            |
| `@expo98/protocols`            | Loopback-only Metro probe + Hermes CDP client (loopback + connect-time Origin + bounded open)                                      |
| `@expo98/app`                  | CLI shell (`@effect/cli`) + composition root: global flags, POSIX exit codes, `--json\|--plain\|--ndjson`, all commands wired      |
| `@expo98/handlers-devtools`    | trace / inspector / console / errors / navigation (runtime-eval gated)                                                             |
| `@expo98/handlers-interaction` | app+sim lifecycle + interaction/gestures + wait (device gated)                                                                     |
| `@expo98/handlers-snapshot`    | snapshot capture + accessibility + RN introspection                                                                                |
| `@expo98/handlers-net-perf`    | network evidence + performance                                                                                                     |
| `@expo98/expo-integration`     | dev bridge + Expo↔RN compat + Expo Router sitemap                                                                                  |
| `@expo98/handlers-artifacts`   | diff / ux-context / review / dashboard / live-backlog                                                                              |
| `@expo98/overlay-server`       | hardened loopback review-overlay ingest server                                                                                     |

## Develop

```bash
pnpm install
pnpm test            # full vitest acceptance suite
pnpm -r run typecheck
pnpm lint            # oxlint
pnpm format          # oxfmt --write
pnpm run check       # format:check + lint + typecheck + test
```

## Status

The reimagined surface is **scaffold-complete and green** (all acceptance tests
pass; safety gating proven end-to-end). Remaining productionization: the esbuild
step that bundles `packages/app` into the publishable `expo98`/`expo-ios` bins +
a source↔bundle parity check, and live UAT on a real simulator/Hermes for the
hardware-only paths.

## Docs

- `CLAUDE.md` — agent & engineer context (architecture, the one inviolable design
  rule, how to run tests, the legacy→modern traceability map).
- `AGENTS.md` — agent harness policy & routing; skills live in `.agents/skills/`.
- `docs/modernization/` — the design provenance: `AI_NATIVE_SPEC.md`,
  `REIMAGINED_ARCHITECTURE.md` (with the architecture-critic review),
  `ASSESSMENT.md`, `BUSINESS_RULES.md`, `DATA_OBJECTS.md`, `MODERNIZATION_BRIEF.md`,
  `reimagine/` (the 58 acceptance criteria), and the dependency/flow diagrams.

## License

MIT — see `LICENSE`.
