---
name: expo98-debugging
description: "Debug expo98 CLI, policy gate, redaction, simulator, Metro, Hermes CDP, bridge, network/perf, and source↔bundle drift in the Effect-TS workspace."
---

# expo98 Debugging

Use this skill when expo98 behavior differs between source, the built bundle,
tests, local tools, simulator/device state, Metro, or a target Expo app. The
runnable artifact is `packages/app/cli/expo98.mjs` (esbuild bundle, `pnpm build`);
the source only runs under vitest.

## Default Loop

1. Name the suspected boundary: CLI parsing/usage, output envelope, policy gate, redaction, path confinement, simulator tooling, Metro probe, Hermes CDP transport, runtime bridge, app state, network/perf evidence, or source↔bundle drift.
2. Add or enable the narrowest signal that proves that boundary.
3. Reproduce with the same command, root (`--root`), policy (`--action-policy`), and output mode (`--json`).
4. When runtime source changed, compare source behavior with the rebuilt bundle (`pnpm build`).
5. Patch the root cause in the owning package.
6. Rerun the failing probe; broaden only if the contract requires it.

## Common Boundaries

- **CLI parsing / usage:** `--json` vs `--plain` vs `--ndjson`; an invalid usage (`--json --plain`, or a value flag with no value) exits **2**; an unknown subcommand exits 2; a known family with an unknown sub-verb exits 2.
- **Policy gate (fail-closed):** read actions pass with no policy; `device` / `runtime-eval` / `source-write` actions fail closed without an explicit grant — e.g. `node cli/expo98.mjs --json boot` is denied. Grant via `--action-policy <file>`, or the convenience flags `--allow-runtime-eval` / `--confirm-actions`. `policy show` reports the effective decision.
- **Capability injection:** a read-classed handler that touches a device/eval/source-write capability is a **compile error**, not a runtime check — confirm in `packages/core/test/capability-injection.test.ts`. Never classify by action-name string.
- **Redaction:** one redactor runs over the whole output — URLs, query strings, headers, cookies, `token`/`auth`/`secret` keys, nested payloads, HAR, run-records. The key-match regex is length-bounded (`{1,256}`) to stay linear; keep the bound.
- **Path confinement:** every artifact write (screenshot, HAR, overlay, run-record) goes through `confinePath` (`packages/core/src/confine-path.ts`), which uses separator-boundary containment (a sibling like `/a/artifacts-evil` is rejected for root `/a/artifacts`).
- **Source↔bundle drift:** after editing `packages/app/src/**` or any runtime module, `pnpm build` and check esbuild output for warnings; `packages/app/test/bundle-parity.test.ts` asserts the bin's command surface equals the source registry.
- **Simulator/device:** `xcrun`/`simctl` reachability, booted state, target ids, app install state. `--json doctor` reports node/platform + xcrun/simctl/axe/idb readiness.
- **Metro / Hermes:** loopback is enforced before any connect (`packages/protocols/src/loopback.ts`); the CDP transport is the `ws` adapter behind `CdpSocketFactory`.

## Useful Commands

```bash
pnpm build
node packages/app/cli/expo98.mjs --help
node packages/app/cli/expo98.mjs --json doctor
node packages/app/cli/expo98.mjs --json sitemap --root /path/to/expo-app
node packages/app/cli/expo98.mjs --json policy show
node packages/app/cli/expo98.mjs --json boot          # observe a fail-closed denial
pnpm exec vitest run packages/core/test
pnpm test
```

## Debugging Rules

- Do not guess dependency behavior when local source, a test, or a small probe can prove it.
- Do not run a state-changing command without an explicit `--action-policy` (or `--allow-runtime-eval`/`--confirm-actions`).
- Do not print secrets while debugging; rely on the redactor and verify it covers the field.
- Prefer persisted evidence under ignored scratch/artifact paths; do not commit it.
- Keep fixes bounded to the owning package; respect the M4 dependency DAG (`core` → nothing; handlers → `core`/`domain`/`protocols`, never each other).

## Output Habit

Report: boundary tested; exact command shape (secrets redacted); observed
signal; fix location (file:line); proof run; remaining risk.
