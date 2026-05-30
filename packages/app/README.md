# run-expo

`run-expo` is a local-first **evidence CLI for Expo / React Native iOS work**. It
inspects a running app over the Hermes Chrome DevTools Protocol, drives the iOS
simulator via `xcrun`/`simctl`, probes Metro, and captures **redacted,
reproducible evidence** — with every state-changing action behind an explicit,
**fail-closed** policy gate.

Built on Effect-TS. Its defining property is that _fail closed_ and _redact_ are
**structural**: a command handler can reach a device, a runtime-eval, or a
source-write capability only through the dispatcher, which provides it **after
the policy gate passes** — a misrouted handler is a compile error, not a runtime
accident.

## Requirements

- **Node ≥ 20.19**
- **macOS + Xcode** for device work (read-only commands like `doctor` run anywhere).

## Install

```bash
npx run-expo --json doctor
# or: npm i -g run-expo && run-expo --json doctor
```

The package is a single self-contained bundle with **zero runtime dependencies**.

## Usage

```bash
# Reads — always allowed, no policy needed:
run-expo --json doctor                         # tool/capability readiness
run-expo --json sitemap --root ./my-app        # Expo Router sitemap
run-expo --json policy show                     # the effective policy decision

# State-changing actions — denied by default (reported as data at exit 0):
run-expo --json boot-simulator                  # → {"ok":true,"data":{"denied":true,"code":"policy-denied"}}
run-expo --json --action-policy ./policy.json boot-simulator
run-expo --json --allow-runtime-eval trace start
```

**Output:** `--json` (machine), `--plain` (human), `--ndjson` (streaming). One
redactor runs over the whole payload before printing. **Exit codes:** `0` success
(a policy denial is data: `data.denied`), `1` runtime failure, `2` usage error.

**Safety model:** four side-effect classes — `read` · `device` · `runtime-eval` ·
`source-write`. Reads pass; the other three fail closed unless granted via
`--action-policy <file>` (`allow` / `actions` / `allowRuntimeEval`), with
`source-write` also requiring a `--confirm-actions` token. Every artifact write
is path-confined; all network access is loopback-only.

## Links

Full docs, architecture, and the agent-operator workflow:
<https://github.com/pproenca/expo98>.

MIT licensed.
