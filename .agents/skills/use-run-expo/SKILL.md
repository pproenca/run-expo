---
name: use-run-expo
description: "Drive a real Expo / React Native iOS app from an AI agent using the run-expo CLI — the efficient, safe boot→inspect→act→evidence loop. Use when an agent must test, inspect, or capture evidence from a running Expo app instead of hand-rolling xcrun/simctl/Hermes CDP/Metro calls."
---

# run-expo Agent Operator

Use this skill when an **AI agent** must inspect or test a running Expo / React
Native iOS app. `run-expo` replaces the ad-hoc mess of raw `xcrun simctl`,
hand-written Hermes CDP frames, and Metro pokes with **one CLI that emits stable,
redacted JSON at POSIX exit codes and refuses every state-changing action unless
you grant it**. Dangerous actions are **fail-closed and structural**, not
convention — that is what makes it safe to hand to an agent.

## Why this beats raw tooling

- **One parseable contract.** Every command supports `--json` → `{"ok":true,"data":{…}}` or `{"ok":false,"error":"…"}`. No screen-scraping `simctl`.
- **Redacted by default.** One redactor runs over the whole output — URLs, headers, cookies, `token`/`auth`/`secret` keys, HAR, run-records — so evidence is safe to paste into a transcript.
- **Fail-closed.** Reads need no policy. `device`, `runtime-eval`, and `source-write` actions are denied unless granted. A read-classed handler _cannot even reach_ a device/eval capability — a compile-time guarantee.
- **Deterministic exits.** `0` ok · `1` runtime failure · `2` usage error. A _policy denial is reported as data at exit 0_ (`{"ok":true,"data":{"denied":true,"code":"policy-denied"}}`), so branch on `data.denied`, and on the exit code for real failures.

## The runnable bin

`run-expo` is published to npm. No build, no clone — run it straight from npm, or
install the bin once:

```bash
BIN="npx -y run-expo"          # zero-install; add @<version> to pin (e.g. run-expo@0.1.1)
# or, once globally: npm i -g run-expo   →   BIN="run-expo"
```

Requirements: **macOS + Xcode** for any device work (it shells out to
`xcrun`/`simctl`); **Node ≥ 20.19**. Read-only commands (`doctor`, `redact`,
`version`, `expo-compat`) run anywhere.

## Point it at the app

`run-expo` is project-relative. Pass `--root` so the run is reproducible — point
it at the **Expo project root** (the dir with `app.json` / `app.config.*` and the
Expo Router `app/` folder), which in a monorepo is a subdir:

```bash
$BIN --json --root ./apps/mobile sitemap      # e.g. a pnpm/turbo monorepo
$BIN --json --root . doctor                    # single-app repo
```

## The loop: boot → inspect → act → evidence

**1. Readiness (always first, always safe).**

```bash
$BIN --json doctor          # node / platform / xcrun / simctl / axe / idb readiness
```

`data.available` and the `capabilities` map tell you what is possible before you
do anything. `run-expo` is macOS-only.

**2. Discover the project + app (read, no policy).**

```bash
$BIN --json --root ./apps/mobile sitemap     # Expo Router sitemap
$BIN --json expo-compat 54 0.81              # Expo ⇄ React Native compatibility
```

**3. Bring up the environment (you, not run-expo, start Metro + the dev app).**
Boot a simulator and start the Expo dev client / Metro yourself, then re-run
`doctor` until it reports ready. `run-expo` **observes** Metro; it does not start
it.

**4. Act — but only behind a policy.** State-changing verbs (`boot-simulator`,
`launch-app`, `reload-app`, `open-url`, `tap`, `gesture *`, `navigation *`,
`trace *`, `inspector *`, `bridge install`, `screenshot`, …) are denied by
default:

```bash
$BIN --json boot-simulator      # → {"ok":true,"data":{"denied":true,"code":"policy-denied"}}
$BIN --json policy show         # preview the effective policy decision; runs nothing
$BIN --json --action-policy ./policy.json boot-simulator   # grant via a policy file
$BIN --json --allow-runtime-eval trace start               # runtime-eval escape hatch
$BIN --json --confirm-actions bridge-install bridge install # source-write confirmation token
```

The `--action-policy <file>` JSON carries `allow` (a list of exact action names),
`actions` (`{ "<action>": "allow" }`), and `allowRuntimeEval`; `source-write`
actions additionally require a matching `--confirm-actions` token. Use
`policy show` to confirm a given file actually grants the action you want before
relying on it.

**5. Capture evidence (reads + confined writes).**

```bash
$BIN --json --root ./apps/mobile snapshot      # accessibility + RN tree
$BIN --json accessibility audit                # accessibility evidence
$BIN --json rn inspect                         # RN introspection
$BIN --json network                            # redacted network evidence
$BIN --json perf                               # performance metrics
$BIN --json --confirm-actions screenshot screenshot   # device action → confined path
$BIN --json ux-context                         # synthesized UX context
$BIN --json review-next                        # next review item
```

Every artifact write is **path-confined** — a write cannot escape the artifact
root. All network access is loopback-only.

## Command families (first-token surface)

`doctor` `version` `policy` `redact` · `sitemap` `expo-compat` `bridge` ·
`boot-simulator` `launch-app` `reload-app` `terminate-app` `install-app`
`uninstall-app` `open-url` `open-route` · `tap` `gesture` `ref` `set` `type`
`press` `keyboard` `clipboard` `navigation` `wait` · `screenshot` `snapshot`
`accessibility` `rn` · `trace` `inspector` `console` `errors` · `network` `perf`
· `diff` `ux-context` `review` `review-next` `review-overlay` `dashboard`
`live-backlog`.

Run `$BIN --help` (or `$BIN <family> --help`) for sub-verbs and args. A bare,
non-existent verb (e.g. `boot`) is a usage error (exit 2), not a denial — use the
real names above.

## Operator rules

- **Always `--json`.** Parse the envelope; check `data.denied` for gating, the exit code for real failure.
- **Always `--root <expo-project-dir>`.** Don't rely on ambient cwd; in a monorepo the app is a subdir (e.g. `apps/mobile`).
- **Least privilege.** Grant only the class the step needs; prefer reads, which need no policy. Confirm with `policy show` before trusting a policy file.
- **Idempotent first.** Run `doctor` / `sitemap` / `snapshot` (reads) before any device or runtime-eval action.
- **Never bypass the gate.** A denial is the safety contract working — add the policy deliberately or stop; do not hunt for an ungated path.
- **Evidence is for the transcript.** It is already redacted; still avoid pasting raw target file contents the redactor cannot classify.
- **Live transports need hardware.** Without a booted sim + running Hermes/Metro, device/runtime commands cannot complete; `doctor` tells you the truth.

## Report

Per operation: the command (with any grant flag named); `ok` / `data.denied` /
exit code; the evidence summary (counts, not raw dumps); and the next safe step.
