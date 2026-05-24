---
name: expo98-debugging
description: "Debug expo98 CLI, policy, simulator, Metro, bridge, network, performance, and generated bundle drift before changing code."
---

# expo98 Debugging

Use this skill when expo98 behavior differs between source, generated bundle, tests, local tools, simulator/device state, Metro, or a target Expo app.

## Default Loop

1. State the suspected boundary: CLI parsing, output envelope, policy gate, redaction, simulator tooling, Metro, runtime bridge, app state, network evidence, performance evidence, package contents, or generated bundle.
2. Add or enable the narrowest signal that proves that boundary.
3. Reproduce with the same command, cwd, target, policy file, and output mode.
4. Compare source behavior with generated `cli/expo98.mjs` when runtime source changed.
5. Patch the root cause.
6. Rerun the failing probe, then broaden only if the contract requires it.

## Common Boundaries

- **CLI parsing:** verify `--json`, `--plain`, command family, cwd, policy path, and invalid-usage exit behavior.
- **Policy gates:** confirm read actions pass without policy and write/device/runtime actions fail closed without explicit allow.
- **Redaction:** check URLs, headers, cookies, tokens, auth fields, run records, HAR output, and nested payloads.
- **Generated bundle:** after editing `src/bundled-cli.ts` or runtime modules, run `pnpm run build` and inspect the diff.
- **Simulator/device:** verify `xcrun`, simulator boot state, target IDs, app install state, and stale selected targets.
- **Metro/Expo:** confirm port, project cwd, malformed target handling, and whether commands should observe rather than start Metro.
- **Runtime bridge:** distinguish absent, stale, incompatible, production-disabled, and unhealthy bridge states.
- **Network/performance evidence:** validate payload shape, confidence levels, missing metrics, malformed data, and redaction before output.

## Useful Commands

```bash
pnpm expo98 --help
pnpm expo98 --json doctor
pnpm expo98 --json project-info --cwd /path/to/expo-app
pnpm expo98 --json policy show
pnpm test
pnpm run build
npx --no-install expo98 --json doctor
```

## Debugging Rules

- Do not guess dependency behavior when local source, docs, or a small probe can prove it.
- Do not use a state-changing command without an explicit action policy.
- Do not print secrets while debugging.
- Prefer persisted evidence under ignored scratch/artifact paths; do not commit it.
- Keep fixes bounded to the owner boundary: source logic, docs, tests, or generated bundle.

## Output Habit

Report:

- boundary tested
- exact command shape, with secrets redacted
- observed signal
- fix location
- proof run and remaining risk
