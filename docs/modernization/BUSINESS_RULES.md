# expo98 — Business Rules

*Extracted by `/code-modernization:modernize-extract-rules expo98` on 2026-05-24.*
*Source of truth: the maintained `legacy/expo98/src/**` tree (symlink → `/Users/pedroproenca/Documents/Projects/expo98`), HEAD `77fc1a6`. The committed bundle `cli/expo98.mjs` is a build artifact and is **not** cited.*
*Method: three parallel `business-rules-extractor` agents (Calculations / Validations & eligibility / State & lifecycle), merged and deduplicated. Every citation was re-verified against live source.*

> **Why this file exists.** The repo's own `docs/business-rules.md` catalogued 36 rules but **every citation points to `dist/expo-ios.mjs`, a file deleted in the prior modernization** — so not one rule could be traced back to live code (the #1 documentation gap in `ASSESSMENT.md`). This document re-derives the rules against `src/` with accurate `file:line` citations, corrects three rules that drifted, and adds rules the old catalog missed.

---

## What expo98 is (one paragraph)

A local-first **evidence CLI** for Expo / React Native iOS work. It inspects a running app over the Chrome DevTools Protocol (Hermes CDP over WebSocket), drives the iOS simulator via `xcrun`/`simctl`, probes Metro, and captures redacted, reproducible evidence (screenshots, HARs, semantic snapshots, run records). Its two load-bearing safety promises are **(1) fail closed** — state-changing actions are denied unless an explicit action policy allows them — and **(2) redact** — secret-bearing fields never leave the process in cleartext. Most P0 rules below are one of those two promises; the most important defects below are the places the code quietly breaks them.

---

## Summary

| ID | Name | Category | Priority | Source | Confidence |
|---|---|---|---|---|---|
| RULE-001 | State-changing actions fail closed without explicit policy | Policy | P0 | `policy-redaction/.../policy-service.ts:46-166` | High |
| RULE-002 | Action side-effect classification drives the gate | Policy | P0 | `policy-redaction/.../policy-service.ts:124-144` | High |
| RULE-003 | Secrets are redacted before output and persistence | Policy | P0 | `policy-redaction/.../redactor.ts:3-44` | High |
| RULE-004 | Runtime-eval (`wait --fn`) needs a flag or policy | Policy | P1 | `policy-service.ts:59-67`; `ref-actions-wait/.../wait.ts:37-58` | High |
| RULE-005 | App/device lifecycle mutations are policy-gated | Policy | P0 | `app-lifecycle-actions/.../index.ts:102-410` | High |
| RULE-006 | Bridge storage/state/controls writes gated + returns redacted | Policy | P0 | `bridge-domain-actions/.../index.ts:199-281,598-606` | High |
| RULE-007 | Navigation reads ungated; navigation mutations gated | Policy | P0 | `navigation-deeplinks/.../index.ts:182-246` | High |
| RULE-008 | Bridge install/remove require explicit confirmation token | Policy | P1 | `bridge-command-adapter/.../index.ts:116-156` | High |
| RULE-009 | Generated bridge is development-only | Policy | P1 | `bridge-command-adapter/.../index.ts:208-213,292-306` | Medium |
| RULE-010 | `trace` executes in-app JS with NO policy gate (defect) | Policy | P0 | `interaction-trace-expression/.../index.ts:91-93` | High |
| RULE-011 | `inspector` mutates app state with NO policy gate (defect) | Policy | P0 | `runtime-inspector-actions/.../index.ts:116-119` | High |
| RULE-012 | Network/route URLs and HAR are redacted before they leave | Policy | P0 | `network-evidence/.../index.ts:880-902`; `navigation-deeplinks/.../index.ts` | High |
| RULE-013 | `--output-path` is unconfined (path-traversal defect) | Policy | P0 | `network-evidence/.../index.ts:239`; `screenshot-capture/.../index.ts:194,366` | High |
| RULE-014 | Review-overlay server lacks auth, body cap, origin checks (defect) | Policy | P1 | `review-overlay-workflow/.../server.ts:18-73` | Medium |
| RULE-015 | `--json` and `--plain` are mutually exclusive → exit 2 | Validation | P2 | `command-dispatch-envelope/.../index.ts:102-104` | High |
| RULE-016 | Value flags require a value → exit 2 | Validation | P2 | `cli-argv-parser/.../index.ts:62-83` | High |
| RULE-017 | Refs must be current, valid, action-capable, and bounded | Validation | P1 | `ref-actions-wait/.../planning.ts:4-62` | High |
| RULE-018 | A selected target is valid only while rediscovered | Validation | P1 | `target-management/.../target-service.ts:38-118` | High |
| RULE-019 | Snapshot capture needs session + active target + device metadata | Validation | P1 | `snapshot-evidence/.../snapshot-command.ts:24-98` | High |
| RULE-020 | Upstream Expo↔RN compatibility is classified before use | Validation | P1 | `project-info-doctor/.../index.ts:59-65,382-439` | High |
| RULE-021 | Metro probes never auto-start Metro; loopback only; skip malformed | Validation | P1 | `metro-probes/.../index.ts:130-133,265-359,602-619` | High |
| RULE-022 | Network evidence requires a live target, well-formed shape, observed traffic | Validation | P1 | `network-evidence/.../index.ts:161-280,480-543` | High |
| RULE-023 | Accessibility audit flags interactive refs lacking a name | Validation | P2 | `accessibility-actions/.../index.ts:212-222` | High |
| RULE-024 | Sessions own an artifact namespace and move new→close→clean | Lifecycle | P1 | `session-run-records/.../session-service.ts:93-205` | High |
| RULE-025 | Run records go running→completed/failed (write must be best-effort) | Lifecycle | P1 | `run-recorder.ts:29-92`; `command-dispatch-envelope/.../index.ts:124-147` | High |
| RULE-026 | Each snapshot persists evidence and refreshes the ref cache | Lifecycle | P1 | `snapshot-evidence/.../persistence.ts:143-164` | High |
| RULE-027 | Bridge install state is absent/present/stale/incompatible | Lifecycle | P1 | `bridge-command-adapter/.../index.ts:158-234` | High |
| RULE-028 | Bridge runtime health fails closed (live payload missing in src) | Lifecycle | P1 | `bridge-command-adapter/.../index.ts:386-392` | Medium |
| RULE-029 | App launch/reload attaches crash evidence and fails closed on crash | Lifecycle | P1 | `app-lifecycle-actions/.../index.ts:257-294` | High |
| RULE-030 | CDP/WebSocket connections are loopback, id-correlated, time-bounded | Lifecycle | P1 | `hermes-cdp-client/.../index.ts:28-176` | High |
| RULE-031 | Batch steps run serially and bail on first failure | Lifecycle | P2 | `batch-orchestration/.../batch.ts:16-49` | High |
| RULE-032 | Review-overlay events file is created/reset then appended | Lifecycle | P2 | `review-overlay-workflow/.../events.ts:4-51` | High |
| RULE-033 | Session sidecar status is declared but never populated (dead) | Lifecycle | P2 | `session-run-records/.../domain.ts:19-26` | Medium |
| RULE-034 | Evidence IDs = prefix + timestamp + 6-char base36 random | Calculation | P2 | `session-run-records/.../ids.ts:5-35` | High |
| RULE-035 | Wait polls on a bounded cadence until match or timeout | Calculation | P2 | `ref-actions-wait/.../wait.ts:16-83` | High |
| RULE-036 | Ref point actions target the element center | Calculation | P2 | `ref-actions-wait/.../planning.ts:144-149` | High |
| RULE-037 | Scroll/gesture plans use signed deltas and clamped defaults | Calculation | P2 | `ref-actions-wait/.../planning.ts:64-103`; `interaction-actions/.../gestures.ts:42-194` | High |
| RULE-038 | Metro port defaults to 8081 and clamps to 1..65535 | Calculation | P2 | `target-management/.../target-record.ts:34-36` | High |
| RULE-039 | Request/console limit defaults to 100 and clamps to 1..1000 | Calculation | P2 | `network-evidence/.../index.ts:176` | High |
| RULE-040 | Snapshot filter depth clamps to 1..100 | Calculation | P2 | `snapshot-evidence/.../filters.ts:11` | High |
| RULE-041 | Output is truncated with explicit overflow markers (inconsistent) | Calculation | P2 | `policy-redaction/.../redactor.ts:80-84`, `output-boundary.ts:18-32` | High |
| RULE-042 | Run/backlog payload summaries cap the key list (40 / 20) | Calculation | P2 | `run-recorder.ts:74-92`; `live-backlog/.../index.ts:1006` | High |
| RULE-043 | Session names are normalized & capped; durations parse s/m/h/d | Calculation | P2 | `session-run-records/.../session-service.ts:68-87` | High |
| RULE-044 | Expo Router file paths normalize groups/dynamic/special/index | Calculation | P2 | `router-sitemap/.../index.ts:75-92,184-189` | High |
| RULE-045 | Network waterfall, duplicates, HAR, and `ok` are derived | Calculation | P2 | `network-evidence/.../index.ts:578-782` | High |
| RULE-046 | Performance findings use fixed network/render/frame thresholds | Calculation | P1 | `perf-evidence/.../model.ts:79-121` | High |
| RULE-047 | Performance frame/FPS metrics are computed in injected JS | Calculation | P1 | `perf-evidence/.../runtime-bridge.ts:235-256` | Medium |
| RULE-048 | Performance confidence is the highest present, else low | Calculation | P1 | `perf-evidence/.../model.ts:29-34,310-321` | High |
| RULE-049 | Performance comparison assumes lower-is-better (defect) | Calculation | P1 | `perf-evidence/.../actions.ts:241-254` | High |
| RULE-050 | Performance budget fails closed on a missing metric | Calculation | P1 | `perf-evidence/.../actions.ts:285-300` | High |
| RULE-051 | A memory-leak claim needs ≥2 samples or a native artifact | Calculation | P1 | `perf-evidence/.../actions.ts:325-337` | High |
| RULE-052 | Native perf-sample text is parsed into footprint/symbol buckets | Calculation | P2 | `perf-evidence/.../artifacts.ts:24-81` | Medium |
| RULE-053 | Subprocess calls carry fixed timeouts and I/O buffers | Calculation | P2 | many (see card) | High |
| RULE-054 | Full screenshots scroll/stitch a fixed segment geometry | Calculation | P2 | `screenshot-capture/.../index.ts:198,214-219` | High |
| RULE-055 | RN introspection caps traversal depth/nodes and rounds | Calculation | P2 | `rn-introspection/.../index.ts:179-180,820-822` | High |
| RULE-056 | Post-launch crash check window clamps 0..30000 (defaults to 0) | Calculation | P1 | `app-lifecycle-actions/.../index.ts:275-289` | Medium |
| RULE-057 | Live-backlog classifies each command row from its evidence | Calculation | P1 | `live-backlog/.../index.ts:928-994` | High |
| RULE-058 | Live-backlog substitutes hardcoded developer fixtures (defect) | Calculation | P2 | `live-backlog/.../index.ts:897-909` | High |

**Totals:** 58 rules — Policy 14, Validation 9, Lifecycle 10, Calculation 25. **P0: 10. Needing SME confirmation: 16** (see final section).

*All paths below are relative to `legacy/expo98/`. The repeated `src/main/` segment is the project's "simulated monorepo" scaffolding; `commands/X/src/main/index.ts` is the implementation of command family X.*

---

## Policy

### RULE-001: State-changing actions fail closed without explicit policy
**Category:** Policy
**Priority:** P0
**Source:** `src/core/policy-redaction/src/main/policy-service.ts:46-110,146-166`; reasons frozen at `.../domain.ts:3-8`
**Plain English:** Any operation that mutates app, device, storage, state, controls, or runtime behaviour is denied unless an explicit action policy allows that exact action; pure reads always pass.
**Specification:**
  Given a command whose side-effect is `read`
  When the policy engine evaluates it
  Then it is allowed with no policy file required
  And the decision records `read → allow` by default

  Given a command with a `write`/`device`/`runtime-eval` side-effect
  When no policy file allows the exact action
  Then the command returns a policy-denied payload and performs no mutation
  And the payload is `{ available:false, source:"policy", code:"policy-denied", denied:true, reason:"Policy denied action.", policy }`

  Given a policy file where `allow[]` includes the action OR `actions[action] === "allow" | true`
  When the state-changing command runs
  Then the operation proceeds
**Parameters:** Default policy summary `read:"allow", write:"deny", device:"deny"`; `POLICY_REASONS.MISSING_POLICY = "No action policy allowed this state-changing operation."`; match keys `allow[]`, `actions[action]`.
**Edge cases handled:** Missing policy denies mutations; reads bypass policy entirely; policy path resolved before load; denied actions never reach the bridge/subprocess.
**Confidence:** High — central, and exercised by storage/state/controls tests.

### RULE-002: Action side-effect classification drives the gate
**Category:** Policy
**Priority:** P0
**Source:** `src/core/policy-redaction/src/main/policy-service.ts:124-144`
**Plain English:** Each action name maps to a side-effect class (`read` / `device` / `runtime-eval`) and that class — not the command — decides whether the policy gate applies.
**Specification:**
  Given an action name
  When `actionSideEffect(action)` runs
  Then `wait.fn` → `runtime-eval`; names matching the read prefix set → `read`; names matching the device prefix set → `device`; everything else → `device` (fail-closed default)
**Parameters:** read regex `^(doctor|project-info|routes|devices|target.list|target.current|snapshot|refs|get|find|wait|console|errors|logs|metro.status|policy|redact|review)`; device regex `^(storage.set|storage.clear|state.save|state.load|state.clear|install-app|uninstall-app|set.)`.
**Edge cases handled:** Unknown action defaults to `device` (safe). 
**Suspected defect:** The classifier is re-implemented divergently in `bridge-domain-actions` (`index.ts:598-606`) and `navigation-deeplinks` (`index.ts:187`); three sources of truth can drift. Consolidate to one.
**Confidence:** High.

### RULE-003: Secrets are redacted before output and persistence
**Category:** Policy
**Priority:** P0
**Source:** `src/core/policy-redaction/src/main/redactor.ts:3-44,86-88`; applied at `src/core/command-dispatch-envelope/src/main/index.ts:164`; run records at `src/state/session-run-records/src/main/run-recorder.ts:47,68`
**Plain English:** Every payload printed to stdout or written to a run record is passed through redaction first; matching keys and URL/free-form secret patterns become `[redacted]`.
**Specification:**
  Given a handler payload (or run-record args/error)
  When it is emitted or persisted
  Then objects/arrays are recursively redacted; keys matching the secret pattern → `[redacted]`; secret-shaped URL query and `key=value` substrings → `[redacted]`
**Parameters:** `REDACTED = "[redacted]"`; `SECRET_KEY_PATTERN = /token|authorization|cookie|password|secret|apikey|apiKey/i`; `URL_QUERY_SECRET_PATTERN`, `FREEFORM_SECRET_PATTERN`, `BEARER_SECRET_PATTERN`.
**Edge cases handled:** Nested recursion; free text without a secret key is not exhaustively scrubbed (documented limitation).
**Suspected defect:** The generic `SECRET_KEY_PATTERN` **misses** `set-cookie`, `auth`, `bearer`, `session`, hyphenated `api-key`/`x-api-key`, `client_secret`, `refresh`, `credential`, `pwd`. `network-evidence` uses a *stronger* regex (`index.ts:880,890,902`) and `bridge-domain-actions` a weaker one (`index.ts:651`) — three divergent redactors. Any non-network payload with those keys persists to `runs/*.json` and stdout **in cleartext**. (CWE-532.)
**Confidence:** High — the divergence is explicit; the fix (unify to the strongest superset at the single output boundary) is an SME decision.

### RULE-004: Runtime-eval (`wait --fn`) needs a flag or policy
**Category:** Policy
**Priority:** P1
**Source:** `src/core/policy-redaction/src/main/policy-service.ts:59-67`; `src/commands/ref-actions-wait/src/main/wait.ts:37-58,85-100`
**Plain English:** A user-supplied runtime predicate (`wait --fn`) is executed only when `--allow-runtime-eval` is set or policy allows `wait.fn`.
**Specification:**
  Given `wait` with a function predicate and `--allow-runtime-eval` true
  Then runtime evaluation is allowed (`source:"--allow-runtime-eval"`)

  Given `wait --fn` without the flag
  Then `wait.fn` must be allowed by policy before Hermes evaluation; otherwise it is treated as denied
  And runtime predicates with no runtime adapter return `{ matched:false, available:false, reason:"Runtime wait predicates require a runtime adapter." }`
**Parameters:** Action `wait.fn`; side-effect `runtime-eval`; timeout supplied by `WaitTiming`.
**Edge cases handled:** Non-function predicates are reads; no adapter → unavailable, not crash.
**Confidence:** High.

### RULE-005: App/device lifecycle mutations are policy-gated
**Category:** Policy
**Priority:** P0
**Source:** `src/commands/app-lifecycle-actions/src/main/index.ts:102-103,129-130,188-189,238-239,354-357,406-410`
**Plain English:** Every simulator/app mutation — boot, launch, terminate, reload, install, uninstall — is denied unless policy allows it.
**Specification:**
  Given a device action (`boot-simulator`/`launch-app`/`terminate-app`/`reload-app`/`install-app`/`uninstall-app`)
  When `policyDecision(args, action, "device")` is not allowed
  Then the command returns `policyDeniedPayload(...)` and performs no `xcrun`/`simctl` call
  And `install-app`/`uninstall-app` support `--dry-run` returning a plan with the policy attached
**Parameters:** Side-effect `device`; local `defaultPolicyDecision` at `:617-645`.
**Edge cases handled:** Dry-run returns the plan without mutating; this is the reference implementation other commands should mirror.
**Confidence:** High.

### RULE-006: Bridge storage/state/controls writes gated; returned payload redacted
**Category:** Policy
**Priority:** P0
**Source:** `src/commands/bridge-domain-actions/src/main/index.ts:199-281,323-370,598-652`
**Plain English:** Reads of app storage/state/controls are allowed; writes and control presses require policy, and whatever the bridge returns is redacted and size-bounded before it leaves.
**Specification:**
  Given a domain action whose side-effect is not `read`
  When `policy.allowed !== true`
  Then return `policyDeniedPayload` without calling the bridge

  Given an allowed (or read) domain action
  When the bridge responds
  Then the value is redacted + bounded and tagged with `domain/action/metroPort/target/transport/evidenceSource/policy`
  And a second defense-in-depth check re-denies any non-read whose policy is not allowed
**Parameters:** Side-effects: storage `list/get`=read else write; state `list`=read else write; controls `press`=device else read. `EXPO98_BRIDGE_VERSION="1.0.0"`, `MAX_OUTPUT=40000`, `MAX_ARRAY_ITEMS=1000`. Unavailable codes: `no-runtime-target`, `transport-failure`, `version-mismatch`, `missing-domain`, `unavailable-bridge`.
**Edge cases handled:** Non-object CDP result → `transport-failure`; version skew → `version-mismatch`.
**Confidence:** High.

### RULE-007: Navigation reads ungated; navigation mutations gated
**Category:** Policy
**Priority:** P0
**Source:** `src/commands/navigation-deeplinks/src/main/index.ts:182-246,302-307`
**Plain English:** Reading navigation `state` is always allowed; `back`, `pop-to-root`, `tab`, and `deep-link` are state-changing and require policy.
**Specification:**
  Given navigation action `state`
  Then it is read-only and ungated

  Given `back`/`pop-to-root`/`tab` (gated as `navigation.<action>`) or `deep-link` (gated as `open-route`)
  When policy does not allow it
  Then return `{ available:false, source:"policy", reason, policy, transport }`
**Parameters:** Mutation actions are side-effect `device`.
**Confidence:** High.

### RULE-008: Bridge install/remove require an explicit confirmation token
**Category:** Policy
**Priority:** P1
**Source:** `src/commands/bridge-command-adapter/src/main/index.ts:116-156,319-327`; tokens at `src/core/policy-redaction/src/main/domain.ts:10-13`
**Plain English:** Writing or deleting the in-app bridge files requires the matching `--confirm-actions` token; without it nothing on disk changes.
**Specification:**
  Given bridge `install` without `--confirm-actions bridge-install` (or `remove` without `bridge-remove`)
  Then no files are created/deleted and the response includes `requiredConfirmation`, the current `status`, and the `plan`

  Given the matching token is present
  Then `install` writes `.expo98/bridge.json` + `src/expo98-devtools-bridge.ts`; `remove` deletes both (and legacy `.expo-ios` fallbacks), then recomputes status
**Parameters:** Tokens `bridge-install` / `bridge-remove` (comma-split, trimmed, exact); files `.expo98/bridge.json`, `src/expo98-devtools-bridge.ts`; `EXPO98_BRIDGE_VERSION="1.0.0"`, schema `1`.
**Edge cases handled:** `status`/`plan`/`health`/`domains` are read-only (no token).
**Suspected defect:** `review-overlay scaffold` writes source files guarded only by `--force`, not by a confirmation token — inconsistent mutation-gating with this rule (`review-overlay-workflow/.../index.ts:208-217`).
**Confidence:** High. *(Drift fixed: prior catalog cited `.expo-ios`; live primary path is `.expo98`.)*

### RULE-009: The generated bridge is development-only
**Category:** Policy
**Priority:** P1
**Source:** `src/commands/bridge-command-adapter/src/main/index.ts:208-213` (metadata), `:292-306` (generated runtime guard)
**Plain English:** The bridge is valid only in development; its install metadata must declare `developmentOnly:true` and its runtime registration refuses to run outside dev mode.
**Specification:**
  Given installed bridge metadata where `developmentOnly !== true`
  Then install status is `incompatible` (issue `not-development-only`)

  Given the generated bridge registers at runtime
  When `typeof __DEV__ === "undefined"` → refuse with `development-mode-required`
  And when `__DEV__ === false` → refuse with `production-build`
  Otherwise register and set `globalThis.__EXPO98_DEVTOOLS_BRIDGE__`
**Parameters:** `developmentOnly:true`; reasons `development-mode-required`, `production-build`.
**Edge cases handled:** Undefined `__DEV__` now **fails closed** (refused).
**Confidence:** Medium — the live source already fails closed (the prior catalog's "undefined `__DEV__` is allowed" defect no longer applies to `src/`). **SME question:** confirm no registration path other than `registerExpo98DevtoolsBridge` exists in the shipped bridge, and that the deployed artifact matches this generator.

### RULE-010: `trace` executes in-app JS with NO policy gate — *suspected defect*
**Category:** Policy
**Priority:** P0
**Source:** `src/commands/interaction-trace-expression/src/main/index.ts:91-93` (ungated eval), `:115-578` (injected program)
**Plain English:** The `trace` command should be policy-gated like any runtime-eval, but it injects and runs arbitrary in-app JavaScript with no gate at all.
**Specification (intended):**
  Given any `trace` action (`start`/`read`/`clear`/`stop`)
  When it runs
  Then it should be classified `runtime-eval` and require policy or `--allow-runtime-eval`
**Parameters:** Eval timeout `8000ms`; `maxEvents` clamp 1..2000; `metroPort` clamp 1..65535.
**Suspected defect:** `traceInteraction` calls `evaluateHermesExpression(...)` with no `policyDecision`/`policyDeniedPayload` anywhere in the module; the injected expression patches `requestAnimationFrame` and the React DevTools `onCommitFiberRoot` hook and mutates global tracer state — clearly state-changing. Breaks the documented fail-closed guarantee (CWE-862/CWE-94). **Decide preserve-vs-fix during transform.**
**Confidence:** High that it is ungated. **SME question:** should `trace.*` be gated behind policy / `--allow-runtime-eval`?

### RULE-011: `inspector` mutates app state with NO policy gate — *suspected defect*
**Category:** Policy
**Priority:** P0
**Source:** `src/commands/runtime-inspector-actions/src/main/index.ts:116-119` (ungated eval) vs `:168-171` (the one gated action)
**Plain English:** Only `inspector open-dev-menu` is policy-gated; the other inspector actions execute injected JS — some of it mutating — without a gate.
**Specification (intended):**
  Given `inspector` actions that execute or mutate via `Runtime.evaluate` (`probe`, `toggle`, `install-comment-menu`, `read-comments`, `clear-comments`)
  Then mutating actions (`install-comment-menu`, `clear-comments`, `toggle`) should be policy-gated; reads classified `read`
**Parameters:** Eval timeout `8000ms`; mutating expression at `:339-368` writes runtime global `__CODEX_SIMULATOR_REVIEW__`.
**Suspected defect:** ungated runtime eval (CWE-862/CWE-94), same class as RULE-010; root cause is that the gate is per-handler rather than centralized in dispatch.
**Confidence:** High. **SME question:** classify each inspector action read vs runtime-eval and gate the mutating ones.

### RULE-012: Network/route URLs and HAR are redacted before they leave
**Category:** Policy
**Priority:** P0
**Source:** `src/commands/network-evidence/src/main/index.ts:880-902` (header/URL regexes), HAR build `:754-782`; deep-link/route URL redaction in `src/commands/navigation-deeplinks/src/main/index.ts`
**Plain English:** Before network evidence is printed or a HAR is written — and before route/deep-link URLs appear in output — auth headers, cookies, and secret query values are stripped.
**Specification:**
  Given network evidence is printed or written as HAR
  Then auth headers / cookies / credentials / bodies / HAR content are redacted, and query/cookie material is emptied in HAR entries

  Given a route/deep-link URL is reported
  Then sensitive query/cookie values are redacted
**Parameters:** Header regex `/authorization|cookie|token|secret|api[-_]?key|password|set-cookie/i`; URL regex `/token|secret|key|password|auth|session|cookie/i`; HAR `version "1.2"`.
**Edge cases handled:** Invalid URLs fall back to regex query redaction.
**Suspected defect:** this path is stronger than the generic redactor (RULE-003) — the inconsistency is the defect; unify upward.
**Confidence:** High.

### RULE-013: `--output-path` is unconfined — *suspected defect*
**Category:** Policy
**Priority:** P0
**Source:** `src/commands/network-evidence/src/main/index.ts:239`; `src/commands/screenshot-capture/src/main/index.ts:194,366`; `src/commands/record-artifacts/src/main/index.ts:35`
**Plain English:** HAR / screenshot / recording writers resolve `--output-path` with no confinement, so an absolute or `../` path writes outside the workspace.
**Specification (intended):**
  Given a user-supplied `--output-path`
  When the artifact is written
  Then the resolved path must be asserted to live under the allowed artifacts root, else rejected
**Parameters:** Current behaviour: `path.resolve(outputPath ?? <default under state root>)` then recursive `mkdir` + write.
**Suspected defect:** Path traversal (CWE-22); a crafted `batch-orchestration` step can escape the workspace. **Decide preserve-vs-fix.**
**Confidence:** High. **SME question:** confirm artifacts must be confined to a resolved root (`resolved.startsWith(artifactsRoot)`).

### RULE-014: Review-overlay local server lacks auth, body cap, and origin checks — *suspected defect*
**Category:** Policy
**Priority:** P1
**Source:** `src/commands/review-overlay-workflow/src/main/server.ts:18-65` (handler), `:67-73` (path allowlist), `:55` (loopback bind)
**Plain English:** The local overlay HTTP server binds loopback and allowlists paths, but accepts unbounded, unauthenticated, unvalidated POST bodies that any local process can send.
**Specification:**
  Given a request to the overlay server
  When the path is not `GET /events.json` or `POST <endpointPath>` (validated by `^\/[A-Za-z0-9_./-]+$`)
  Then respond 404

  Given an accepted POST
  Then `JSON.parse(body)` is appended verbatim to `events.json`
**Parameters:** Bind `127.0.0.1`; default port search from `17655` incrementing on `EADDRINUSE`.
**Suspected defect:** no body-size cap (memory exhaustion, CWE-400), no per-session token / auth, no `Origin`/CORS validation, no `comments[]` schema check. **Decide preserve-vs-fix.**
**Confidence:** Medium — gaps are explicit; the hardening contract is an SME decision (loopback + unguessable token + strict origin + body cap).

---

## Validation

### RULE-015: `--json` and `--plain` are mutually exclusive → exit 2
**Category:** Validation
**Priority:** P2
**Source:** `src/core/command-dispatch-envelope/src/main/index.ts:102-104`; classification at `src/core/cli-error-classification/src/main/index.ts:1-37`
**Plain English:** A single invocation cannot request both machine-JSON and plain output.
**Specification:**
  Given global flags include both `--json` and `--plain`
  Then throw `CliUsageError("--json and --plain are mutually exclusive.")` → exit code `2`, error code `invalid_usage`
**Parameters:** `EXIT_INVALID_USAGE=2`, `EXIT_RUNTIME_FAILURE=1`, `EXIT_SUCCESS=0`.
**Edge cases handled:** Unknown commands / malformed values also classify as `invalid_usage` by message pattern.
**Confidence:** High.

### RULE-016: Value flags require a value → exit 2
**Category:** Validation
**Priority:** P2
**Source:** `src/core/cli-argv-parser/src/main/index.ts:62-83,174-183`
**Plain English:** Global value flags must be followed by a non-flag value.
**Specification:**
  Given a value flag (`--root`/`--state-dir`/`--action-policy`/`--max-output`/`--allow-runtime-eval`/`--confirm-actions`) with no following value
  Then throw `CliUsageError("--<key> requires a value.")` → exit 2
**Confidence:** High.

### RULE-017: Refs must be current, valid, action-capable, and bounded
**Category:** Validation
**Priority:** P1
**Source:** `src/commands/ref-actions-wait/src/main/planning.ts:4-62`; `get` path at `src/commands/snapshot-evidence/src/main/ref-commands.ts:17-53`
**Plain English:** A cached UI ref can be acted on only if it matches `@eN`, exists in the latest snapshot, is not stale, advertises the action, and (for point actions) has bounds.
**Specification:**
  Given a ref action
  When there is no ref cache / the ref is missing / stale / lacks the action / lacks bounds for a point action
  Then return `{ available:false, reason }` (with `availableActions` when applicable) and do not act

  Given a valid, action-capable ref
  Then return a dry-run plan `{ action, ref, targetId, box, point }`
**Parameters:** Ref format `^@e\d+$`; reasons include "Ref is stale. Capture a new snapshot before acting."
**Edge cases handled:** `get` is more permissive — it returns a stale ref with a `stale` field rather than blocking.
**Confidence:** High.

### RULE-018: A selected target is valid only while rediscovered
**Category:** Validation
**Priority:** P1
**Source:** `src/state/target-management/src/main/target-service.ts:38-118`; identity at `target-record.ts:50-58`
**Plain English:** The session's active target is "current" only while it is rediscovered among live simulator devices and Metro targets; otherwise it is stale.
**Specification:**
  Given a session with `activeTargetId`
  When `target current` rediscovers it
  Then `{ available:true, target:{ ...current, selected:true, stale:false } }`

  When it is not rediscovered
  Then `{ available:false, reason:"Selected target is stale.", target:{ ...persisted, stale:true } }`

  Given `target select <id>` for an id not in rediscovery
  Then `{ available:false, reason:"Target not found.", targetId, targets }`
**Parameters:** `targetId = [platform, device.id, appId||metroId||metroTitle||"no-runtime", metroPort||"no-metro"].join(":")`; Metro port clamp 1..65535; simctl list timeout 20000ms.
**Edge cases handled:** No session / no selected target → distinct unavailable reasons; unreadable `target.json` → synthetic stale record.
**Confidence:** High.

### RULE-019: Snapshot capture needs session + active target + device metadata
**Category:** Validation
**Priority:** P1
**Source:** `src/commands/snapshot-evidence/src/main/snapshot-command.ts:24-98`
**Plain English:** A snapshot is captured only for an existing session whose active target's selected metadata includes a device id; otherwise nothing is written.
**Specification:**
  Given no session / no active target / missing `device.id`
  Then return unavailable with the matching reason and write no artifacts

  Given valid session + target metadata
  When semantic-bridge capture succeeds → persist via the semantic path; else if `axe` CLI present → native describe → persist; else unavailable
**Parameters:** Semantic eval timeout `5000ms`; native `axe describe-ui` timeout `12000ms`, `maxBuffer 4 MiB`; unavailable codes include `transport-failure`.
**Edge cases handled:** Semantic transport failure is represented as unavailable evidence; native fallback requires `axe` on PATH.
**Confidence:** High.

### RULE-020: Upstream Expo↔RN compatibility is classified before use
**Category:** Validation
**Priority:** P1
**Source:** `src/commands/project-info-doctor/src/main/index.ts:59-65` (table), `:382-439` (classify), `:192-361` (surface policy)
**Plain English:** Expo/React-Native/Metro/DevTools surfaces are classified so handlers don't blindly rely on private or mismatched upstream internals.
**Specification:**
  Given Expo and RN versions are declared
  When either is missing → `missing`; either is unresolved (`catalog:|workspace:|file:|link:|portal:`) → `declared-unresolved`; Expo major not in the table → `unknown`; else `compatible` iff RN major.minor matches, else `mismatched`

  Given an upstream API surface
  Then `public-api` may be imported directly; `documented-unstable-api` / `internal-reference-only` / `optional-compatibility-shim` require shims + runtime checks
**Parameters:** Table: Expo 54→RN 0.81, 53→0.79, 52→0.76, 51→0.74, 50→0.73.
**Edge cases handled:** Version parse takes the first `\d+\.\d+(\.\d+)?` run; range specifiers like `^53.0.0` parse to `53.0.0`.
**Suspected defect:** the table is hardcoded and stops at Expo 54 — newer SDKs silently classify `unknown`. 
**Confidence:** High. **SME question:** where should the SDK→RN map live so it updates without a code release?

### RULE-021: Metro probes never auto-start Metro; loopback only; skip malformed
**Category:** Validation
**Priority:** P1
**Source:** `src/commands/metro-probes/src/main/index.ts:130-133,265-359,602-619`
**Plain English:** Metro probes only read status/targets over loopback and never implicitly start Metro; a malformed target list or rows without identifying metadata are reported as unavailable/skipped, not crashed on.
**Specification:**
  Given a Metro probe
  When `/json/list` is not an array → `{ available:false, malformedTargets:[{index:null, reason:"Metro target list was not an array."}] }`
  And per-target rows without identifying metadata are skipped into `malformedTargets`
  And all fetches use `http://127.0.0.1:<port>` (loopback host allowlist `127.0.0.1|localhost|[::1]|::1`)

  When Metro is unreachable
  Then `{ available:false, status:"unavailable", reason:"Metro is not reachable on the requested port." }`
**Parameters:** Probed endpoints `/status`, `/json/list`, `/json/version`, `/symbolicate`; port clamp 1..65535.
**Confidence:** High.

### RULE-022: Network evidence requires a live target, well-formed shape, observed traffic
**Category:** Validation
**Priority:** P1
**Source:** `src/commands/network-evidence/src/main/index.ts:161-280,480-543`
**Plain English:** Network evidence is usable only when it comes from a live Hermes runtime, has the expected object/array shape, and (for request/HAR-stop actions) actually observed traffic.
**Specification:**
  Given no Hermes target / no evaluator → `no-runtime-target` (or `transport-failure`)
  Given a non-object payload or non-array `requests` → `malformed-payload`
  Given empty observed traffic for `requests`/`waterfall`/`har-stop` → `no-observed-traffic`
  Otherwise return validated, redacted evidence
**Parameters:** `metroPort` clamp 1..65535; `limit` clamp 1..1000.
**Confidence:** High.

### RULE-023: Accessibility audit flags interactive refs lacking a name
**Category:** Validation
**Priority:** P2
**Source:** `src/commands/accessibility-actions/src/main/index.ts:96-114,212-222`
**Plain English:** Any cached ref that supports actions but has neither a label nor text is reported as an accessibility issue.
**Specification:**
  Given a cached ref with `actions.length > 0` and no `label` and no `text`
  Then emit `{ ref, rule:"interactive-name", message:"Interactive ref has no label or text." }`
**Edge cases handled:** Requires a snapshot/ref cache, else `available:false`.
**Confidence:** High.

---

## Lifecycle

### RULE-024: Sessions own an artifact namespace and move new→close→clean
**Category:** Lifecycle
**Priority:** P1
**Source:** `src/state/session-run-records/src/main/session-service.ts:93-205`; state-dir resolution at `paths.ts:13-20`
**Plain English:** An evidence session owns a directory + artifact namespace and progresses through create, list/show, close, and clean.
**Specification:**
  Given `session new`
  Then create `<stateRoot>/sessions/<sessionId>/artifacts/` and write `session.json` (`schemaVersion:1`, id, name, artifactDir, timestamps, `activeTargetId:null`, `lastSnapshotId:null`, `sidecars:[]`)

  Given `session close`
  Then set `closedAt`, `updatedAt=closedAt`, clear `sidecars:[]` (record retained)

  Given `session clean`
  Then delete the directories of sessions whose `createdAt < now − olderThan`
**Parameters:** Default name `review`; default clean age `7d`; state root default `<cwd>/.scratch/expo98`; `--state-dir` whose basename is `runs` resolves to its parent.
**Edge cases handled:** Corrupt `session.json` skipped on list; missing `createdAt` → not deleted by clean.
**Confidence:** High. *(Drift fixed: state root is `.scratch/expo98`, not `expo-ios`.)*

### RULE-025: Run records go running→completed/failed (write must be best-effort)
**Category:** Lifecycle
**Priority:** P1
**Source:** `src/state/session-run-records/src/main/run-recorder.ts:29-92`; transitions at `src/core/command-dispatch-envelope/src/main/index.ts:124-147`; write at `src/state/session-run-records/src/main/json-store.ts:8-11`
**Plain English:** When recording is on, each run starts `running` and finishes `completed` (exit 0) or `failed` (classified exit code, sanitized error).
**Specification:**
  Given `--record` or `--state-dir`
  Then write `<stateDir>/<runId>.json` as `running` (args redacted)

  Given the handler returns
  Then finish `completed`, exit 0, with a summarized payload

  Given the handler throws
  Then finish `failed` with `exitCodeForError(error)` and a sanitized error
**Parameters:** Without recording flags the recorder is a no-op; summary = `Object.keys(payload).slice(0,40)` + `available`/`routeCount`/`eventCount`.
**Suspected defect:** `startRunRecord`/`finish` writes are **unguarded** and sit inside the dispatch `try`; a failed record write (read-only/full `--state-dir`, EACCES) is caught and flips an already-emitted, successful command to `failed`/exit 1 (`command-dispatch-envelope/.../index.ts:135,142`). **Decide preserve-vs-fix:** recording should be observational only.
**Confidence:** High. **SME question:** can a failure to persist a run record ever change a command's exit code?

### RULE-026: Each snapshot persists evidence and refreshes the ref cache
**Category:** Lifecycle
**Priority:** P1
**Source:** `src/commands/snapshot-evidence/src/main/persistence.ts:33-95,143-164`
**Plain English:** A successful snapshot (native or semantic-bridge) writes durable snapshot JSON, rewrites `refs.json`, and stamps the session's latest snapshot id.
**Specification:**
  Given a successful capture
  Then write `sessions/<id>/snapshots/<snapshotId>.json` (full `SnapshotResult`) and `sessions/<id>/refs.json` (`{ snapshotId, targetId, source, semanticBridge, refs }`)
  And set session `lastSnapshotId = snapshotId`, `updatedAt = generatedAt`
**Parameters:** Snapshot id `snapshot-<timestamp>-<6-char>`; semantic refs are rewritten to `@e1..@eN` with `stale:false`.
**Confidence:** High.

### RULE-027: Bridge install state is absent/present/stale/incompatible
**Category:** Lifecycle
**Priority:** P1
**Source:** `src/commands/bridge-command-adapter/src/main/index.ts:158-234`
**Plain English:** Bridge install status is derived from the Expo dependency, the two bridge files, version/schema, and the dev-only flag.
**Specification:**
  Given no `expo` dep → `incompatible` (`missing-expo`)
  Given metadata XOR source present → `stale` (`partial-install`)
  Given both present but version `!= 1.0.0` or schema `!= 1` → `stale` (`version-mismatch`)
  Given both present, versions match, but `developmentOnly !== true` → `incompatible` (`not-development-only`)
  Given both present, versions match, dev-only → `present`
  Given Expo present but neither file → `absent`
**Parameters:** Files `.expo98/bridge.json` + `src/expo98-devtools-bridge.ts` (legacy `.expo-ios` as fallback); `EXPO98_BRIDGE_VERSION="1.0.0"`, schema `1`; metadata domains `[navigation,network,storage,controls,performance,snapshot]`.
**Confidence:** High. *(Drift fixed: prior catalog cited only `.expo-ios`.)*

### RULE-028: Bridge runtime health fails closed (live payload missing in src)
**Category:** Lifecycle
**Priority:** P1
**Source:** `src/commands/bridge-command-adapter/src/main/index.ts:112-113,386-392`
**Plain English:** Bridge `health`/`domains` should report live domains only after install-state → transport → registration → version checks pass; in the current source the real payload builder is not wired.
**Specification (intended):**
  Given install status is stale/incompatible → health is unavailable before probing
  Given probing is permitted but no Hermes target / missing bridge / missing registration / version mismatch → a stable unavailable code (`stale-bridge`/`incompatible-project`/`transport-failure`/`missing-bridge`)
  Given all checks pass → report read/write domains, redaction boundaries, policy requirements
**Suspected defect / regression:** `health`/`domains` delegate to `io.bridgeHealthPayload`, whose only live implementation is `defaultBridgeHealthPayload` — a stub returning `{ available:false, health:"unavailable", reason:"Bridge health payload dependency was not provided." }` — and `bundled-cli.ts:161` registers the command **without** providing a real one. The full ordered state machine the prior catalog described (dead `dist:6852-6989`) has no live backing code.
**Confidence:** Medium. **SME question:** is the runtime bridge-health state machine intentionally deferred, or must production wiring inject a real `bridgeHealthPayload`? The rewrite needs the full code set + ordering.

### RULE-029: App launch/reload attaches crash evidence and fails closed on crash
**Category:** Lifecycle
**Priority:** P1
**Source:** `src/commands/app-lifecycle-actions/src/main/index.ts:257-294`
**Plain English:** After an iOS launch or reload, the command scans for crash reports created since it started and, if any match, flips the result to unavailable with the crash evidence attached.
**Specification:**
  Given launch/reload completes
  When ≥1 matching `.ips`/`.crash` report appeared after `startedAt`
  Then set `available:false`, reason "The app generated N matching iOS crash report(s) after <action>.", attach `crashCheck` + `crashReports`
  Else attach `crashCheck` and leave the payload unchanged
**Parameters:** `crashCheck = { action, bundleId, processName, since, waitedMs, reportCount }`; only `.ips`/`.crash` files matched.
**Confidence:** High. (See RULE-056 for the crash-check timing window.)

### RULE-030: CDP/WebSocket connections are loopback, id-correlated, time-bounded
**Category:** Lifecycle
**Priority:** P1
**Source:** `src/platform/hermes-cdp-client/src/main/index.ts:10-26,28-176`
**Plain English:** The Hermes CDP client connects over loopback with an `Origin` header, correlates each request/response by incrementing id, and bounds the open with a short timeout.
**Specification:**
  Given a CDP evaluation
  Then open the WS with `Origin: http://127.0.0.1[:port]`, `waitForOpen` ≤ `min(timeoutMs, 2500)`, send `Runtime.enable` then `Runtime.evaluate {returnByValue:true, awaitPromise:true}`, matching responses by `id`
  And on all-attempts-fail return `{ error, diagnostics:{ attemptedUrls } }`
**Parameters:** Loopback candidates `127.0.0.1`, `localhost`, `[::1]`; malformed JSON → reject with raw truncated to 1000 chars.
**Suspected defect:** unlike `metro-probes`, this client connects a non-loopback `webSocketDebuggerUrl` unchanged (CWE-918, low likelihood — URL comes from trusted local Metro). Mirror the metro-probes allowlist.
**Confidence:** High.

### RULE-031: Batch steps run serially and bail on first failure
**Category:** Lifecycle
**Priority:** P2
**Source:** `src/commands/batch-orchestration/src/main/batch.ts:16-49`
**Plain English:** A batch runs its steps one at a time as quiet JSON and, when `bail` is set, stops after the first failure.
**Specification:**
  Given a list of steps
  Then run serially (each forced `json:true, plain:false, quiet:true`, inheriting `root`/`stateDir`, data redacted); record `failureIndex` on first failure; if `bail` true, break
  And return `{ ok: failureIndex===null, bail, failureIndex, steps }`
**Parameters:** Subprocess fallback timeout `120000ms`.
**Confidence:** High.

### RULE-032: Review-overlay events file is created/reset then appended
**Category:** Lifecycle
**Priority:** P2
**Source:** `src/commands/review-overlay-workflow/src/main/events.ts:4-51`; `server.ts:36-50`
**Plain English:** The overlay events file is `{version:1, title, createdAt, events:[]}`, created fresh on reset/absence and appended to per POST.
**Specification:**
  Given `prepare` with `reset` or no existing file → write a fresh events file
  Given a server POST → append the parsed body to `events[]`, set `updatedAt`, rewrite
  Given `read` with no file → `{ available:false, reason:"No review overlay events file exists." }`
**Parameters:** Action enum `prepare|scaffold|server|read|clear`; default port search from 17655; bind 127.0.0.1.
**Confidence:** High. (Input-hardening gaps in RULE-014.)

### RULE-033: Session sidecar status is declared but never populated
**Category:** Lifecycle
**Priority:** P2
**Source:** `src/state/session-run-records/src/main/domain.ts:19-26`
**Plain English:** The schema defines a sidecar lifecycle (`running`/`stale`/`stopped`/`unknown`) but no code ever writes a non-empty `sidecars` array.
**Specification:**
  Given any session operation
  Then `sidecars` is created `[]` and cleared `[]` on close; the review-overlay server tracks its pid only in its own payload, never as a session sidecar
**Suspected defect:** a forward-declared, dead state machine.
**Confidence:** Medium. **SME question:** should long-lived servers register as session sidecars with a real `running→stale→stopped` lifecycle, or is `sidecars` deprecated and safe to drop?

---

## Calculation

### RULE-034: Evidence IDs = prefix + timestamp + 6-char base36 random
**Category:** Calculation
**Priority:** P2
**Source:** `src/state/session-run-records/src/main/ids.ts:5-35`; `src/commands/snapshot-evidence/src/main/ids.ts:1-9`
**Plain English:** Session, run, and snapshot ids combine a prefix, a normalized ISO timestamp, and a 6-character base36 random suffix.
**Specification:**
  Given a new session/run/snapshot
  Then id = `<prefix>-<timestamp>-<suffix>`, suffix = `Math.random().toString(36).slice(2,8)`
**Parameters:** Session: name-prefixed, timestamp lowercased with trailing `Z` **stripped**. Run: timestamp keeps `Z`, original case. Snapshot: `snapshot-` prefix, keeps `Z`, lowercased.
**Edge cases handled:** Empty normalized session name throws.
**Suspected defect:** `Math.random()` is not collision-resistant and `slice(2,8)` can yield <6 chars; the three timestamp variants diverge (Z/case). 
**Confidence:** High. **SME question:** are ids ever assumed globally unique (cross-machine artifact merge)? If so, replace the RNG.

### RULE-035: Wait polls on a bounded cadence until match or timeout
**Category:** Calculation
**Priority:** P2
**Source:** `src/commands/ref-actions-wait/src/main/wait.ts:16-83`
**Plain English:** Wait re-evaluates its predicate on a clamped interval until it matches, becomes final, or times out; with no predicate it sleeps a clamped duration.
**Specification:**
  Given a predicate
  Then poll every `intervalMs` until matched/final/timeout, sleeping `min(intervalMs, timeoutMs − elapsed)` each tick, returning last evidence on timeout

  Given no predicate and `ms > 0`
  Then sleep the clamped duration and report `matched:true`
**Parameters:** `timeoutMs = clamp(args.timeoutMs ?? 5000, 0, 60000)`; `intervalMs = min(max(floor(timeoutMs/10), 25), 250)`; sleep `ms = clamp(args.ms ?? 0, 0, 60000)`.
**Edge cases handled:** invalid `@eN` / not-found / stale refs are final-unmatched; timeout payload samples 5 refs.
**Confidence:** High. *(Correction: the prior catalog's 2000ms runtime-eval timeout does not exist in live source; the only ~2000 value is the WS open cap `min(timeoutMs,2500)`.)*

### RULE-036: Ref point actions target the element center
**Category:** Calculation
**Priority:** P2
**Source:** `src/commands/ref-actions-wait/src/main/planning.ts:144-149`
**Plain English:** A ref point action aims at the center of the cached bounds.
**Specification:**
  Given a ref with `box`
  Then `point = { x: box.x + box.width/2, y: box.y + box.height/2 }`; missing box → unavailable (no coordinates computed)
**Confidence:** High.

### RULE-037: Scroll/gesture plans use signed deltas and clamped defaults
**Category:** Calculation
**Priority:** P2
**Source:** `src/commands/ref-actions-wait/src/main/planning.ts:64-103`; `src/commands/interaction-actions/src/main/gestures.ts:42-47,172-194`
**Plain English:** Scroll and gesture plans derive start/end points from clamped amounts and per-gesture default durations.
**Specification:**
  Given a scroll
  Then `amount = clamp(args.amount ?? args.text ?? 600, 1, 5000)`, default origin `{x:200,y:700}`, deltas: down `{0,−amount}`, up `{0,+amount}`, left `{+amount,0}`, right `{−amount,0}`

  Given a gesture
  Then `repeat=clamp(…?? 1,1,20)`, `intervalMs=clamp(…?? 250,0,10000)`, `durationMs=clamp(…?? default,1,30000)`, `maxEvents=clamp(…?? 200,1,2000)`
**Parameters:** Default gesture durations: long-press 900, drag 900, swipe 250, tap 80 ms.
**Suspected defect:** scroll "down" subtracts from Y (swipe-up → content-down); confirm the swipe→content mapping is intentional.
**Confidence:** High (math); Medium on directional intent.

### RULE-038: Metro port defaults to 8081 and clamps to 1..65535
**Category:** Calculation
**Priority:** P2
**Source:** `src/state/target-management/src/main/target-record.ts:34-36` (+8 other call-sites)
**Plain English:** The Metro port is `clamp(metroPort ?? 8081, 1, 65535)` everywhere it is read.
**Suspected defect:** the default and range are duplicated at 9+ sites; hoist to one constant.
**Confidence:** High.

### RULE-039: Request/console limit defaults to 100 and clamps to 1..1000
**Category:** Calculation
**Priority:** P2
**Source:** `src/commands/network-evidence/src/main/index.ts:176`; `src/commands/devtools-diagnostics/src/main/index.ts:590,647`
**Plain English:** Request/console/error list limits are `clamp(args.limit ?? 100, 1, 1000)`, taking the last N entries.
**Confidence:** High.

### RULE-040: Snapshot filter depth clamps to 1..100
**Category:** Calculation
**Priority:** P2
**Source:** `src/commands/snapshot-evidence/src/main/filters.ts:11`
**Plain English:** Snapshot tree depth is `null` (unbounded) or `clamp(args.depth, 1, 100)`; deeper nodes are pruned (root depth 0).
**Confidence:** High.

### RULE-041: Output is truncated with explicit overflow markers
**Category:** Calculation
**Priority:** P2
**Source:** `src/core/policy-redaction/src/main/redactor.ts:80-84` and `output-boundary.ts:18-32`; `src/core/command-dispatch-envelope/src/main/index.ts:198-211,276-278`
**Plain English:** Large output is bounded and the truncation is made visible to the caller.
**Specification:**
  Given output over the limit
  Then return the leading content and append a marker stating how much was dropped
**Parameters:** `truncateOutput` default `40_000` (marker `[truncated N characters]`); `truncateSubprocessOutput` `100_000`; `boundOutput`/`--max-output` clamp `1..10_000_000` (marker `[expo98 output truncated by --max-output]`); CDP error preview `1_000`; `MAX_OUTPUT=40_000` used as subprocess `maxBuffer`.
**Suspected defect:** ≥4 limits and 2 markers coexist; only `boundOutput` reserves room for its suffix (others can exceed `limit`); `MAX_OUTPUT` as `maxBuffer` can clip legitimate tool output.
**Confidence:** High. **SME question:** what is the canonical output budget + marker, and should the subprocess buffer be larger than the truncation limit?

### RULE-042: Run/backlog payload summaries cap the key list
**Category:** Calculation
**Priority:** P2
**Source:** `src/state/session-run-records/src/main/run-recorder.ts:74-92`; `src/commands/live-backlog/src/main/index.ts:1006`
**Plain English:** Persisted/displayed payload summaries list only the first N top-level keys (run records 40, live-backlog 20) plus a few rollups.
**Parameters:** Run summary: `keys.slice(0,40)` + `available`/`routeCount`/`eventCount`. Backlog summary: `keys.slice(0,20)`.
**Confidence:** High.

### RULE-043: Session names are normalized & capped; durations parse s/m/h/d
**Category:** Calculation
**Priority:** P2
**Source:** `src/state/session-run-records/src/main/session-service.ts:68-87`
**Plain English:** Session names are slugified and capped at 48 chars; durations are `<int><unit>` over s/m/h/d.
**Specification:**
  Given a session name → lowercase → `[^a-z0-9_.-]+ → "-"` → trim `-` → throw if empty → `slice(0,48)` (default `review`)
  Given a duration → `^(\d+)([smhd])$` × `{s:1000, m:60000, h:3600000, d:86400000}`, else throw
**Confidence:** High.

### RULE-044: Expo Router file paths normalize groups/dynamic/special/index
**Category:** Calculation
**Priority:** P2
**Source:** `src/commands/router-sitemap/src/main/index.ts:75-92,184-189`
**Plain English:** App-directory files are mapped to routes: `_layout` → layout, `+`-prefixed → special, `index`/group `(...)` segments dropped, dynamic segments converted.
**Specification:**
  Given a file path
  Then strip the extension; if any segment is `_layout` → layout; if any starts with `+` → special; else drop `index` + group segments, format the rest, join → `/...`
**Parameters:** Segment formatting: `[...rest]` → `*rest`; `[[opt]]` → `:opt?`; `[param]` → `:param`; else literal.
**Confidence:** High.

### RULE-045: Network waterfall, duplicates, HAR, and `ok` are derived
**Category:** Calculation
**Priority:** P2
**Source:** `src/commands/network-evidence/src/main/index.ts:578-782,948-953`
**Plain English:** Network evidence computes a ranked waterfall, duplicate-request groups, a HAR, and per-request `ok`/status.
**Specification:**
  Waterfall: keep numeric `durationMs`, sort desc, top 50; `slowThresholdMs=500`; `slowRequestCount` = ranked ≥ 500
  Duplicates: group by `<method> <origin><path|url>`, keep groups >1, report `count`/`requestIds`/`totalDurationMs`
  HAR: `version "1.2"`, `time=durationMs ?? 0`, query/cookies emptied; infer `endedAt = Date.parse(startedAt)+durationMs` when absent
  Request: `status = numberOrNull(request.status) ?? numberOrNull(response.status)`; `ok = explicit boolean ?? (200 ≤ status < 400)`; `responseBytes` falls back through several fields; `retryCount ?? 0`
**Confidence:** High.

### RULE-046: Performance findings use fixed network/render/frame thresholds
**Category:** Calculation
**Priority:** P1
**Source:** `src/commands/perf-evidence/src/main/model.ts:79-121`
**Plain English:** Performance findings are flagged against fixed latency/render/frame thresholds with high/medium severity bands.
**Specification:**
  Network: slow if `durationMs ≥ 500` (high ≥ 1000, else medium)
  Render: worst commit `≥ 16.7ms` flagged (high ≥ 50, else medium)
  Frames: `droppedFrames = frames.droppedFrameCount ?? count(deltaMs > 33.4)`; flagged if > 0 (high ≥ 5, else medium)
**Parameters:** 500/1000 ms; 16.7/50 ms; 33.4 ms / ≥5.
**Confidence:** High.

### RULE-047: Performance frame/FPS metrics are computed in injected JS
**Category:** Calculation
**Priority:** P1
**Source:** `src/commands/perf-evidence/src/main/runtime-bridge.ts:235-256`
**Plain English:** The in-app frame sampler computes average FPS, dropped/long frames, and worst frame from per-frame deltas.
**Specification:**
  `avgFps = round((1000 / mean(deltaMs)) * 10)/10`; `droppedFrameCount = count(delta > 33.4)`; `longFrameCount = count(delta > 16.7)`; `worstFrameMs = max(deltas)`; stats over last 300 samples; retain newest 1000; `deltaMs = round((ts−lastTs)*10)/10`
**Suspected defect:** `33.4`/`16.7` are not exact 60fps multiples (should be 33.33/16.67); the stats window (300) and retention (1000) differ.
**Confidence:** Medium — injected string, not unit-tested in-process. **SME question:** are 33.4/16.7 intended as exact 2-frame/1-frame budgets at 60fps, and is the 300-vs-1000 split intentional?

### RULE-048: Performance confidence is the highest present, else low
**Category:** Calculation
**Priority:** P1
**Source:** `src/commands/perf-evidence/src/main/model.ts:29-34,310-321`
**Plain English:** Overall perf confidence is `high` if any signal is high, else `medium` if any is medium, else `low`; per-metric confidence is `medium` only when rows exist.
**Specification:**
  Given a set of signals → empty/none → `low`; any `high` → `high`; else any `medium` → `medium`; else `low`
  And `lowerConfidence(a,b)` returns the weaker of two
**Confidence:** High.

### RULE-049: Performance comparison assumes lower-is-better
**Category:** Calculation
**Priority:** P1
**Source:** `src/commands/perf-evidence/src/main/actions.ts:241-254`
**Plain English:** When comparing two perf runs, a metric is "improved" iff the candidate value is ≤ the baseline.
**Specification:**
  Given matching numeric metrics
  Then `delta = candidate − baseline`, `improved = candidate ≤ baseline`, `confidence = lowerConfidence(baseline, candidate)`
**Suspected defect:** "lower is better" is wrong for throughput metrics (e.g. `avgFps`, counts) — an FPS increase is marked NOT improved. **Decide preserve-vs-fix.**
**Confidence:** High (logic); the semantic assumption is the defect. **SME question:** which metric names are higher-is-better?

### RULE-050: Performance budget fails closed on a missing metric
**Category:** Calculation
**Priority:** P1
**Source:** `src/commands/perf-evidence/src/main/actions.ts:285-300`
**Plain English:** A budget check passes only when the metric is numeric and within min/max; a missing metric fails.
**Specification:**
  Given a budget rule → `passed = value is number && (max===undefined || value≤max) && (min===undefined || value≥min)`; missing metric → `value=null` → fail; overall `passed = checks.every(passed)`
**Confidence:** High.

### RULE-051: A memory-leak claim needs ≥2 samples or a native artifact
**Category:** Calculation
**Priority:** P1
**Source:** `src/commands/perf-evidence/src/main/actions.ts:325-337`
**Plain English:** The tool refuses to claim a memory leak from a single sample.
**Specification:**
  Given memory evidence with `samples = clamp(args.samples ?? 1, 1, 100)`
  Then metric confidence is `medium` iff `samples ≥ 2` or a native artifact exists, else `low`; `leakClaim.allowed = samples ≥ 2 || Boolean(nativeArtifact)`
**Confidence:** High.

### RULE-052: Native perf-sample text is parsed into footprint/symbol buckets
**Category:** Calculation
**Priority:** P2
**Source:** `src/commands/perf-evidence/src/main/artifacts.ts:24-81`
**Plain English:** A macOS `sample`/Instruments text artifact is regex-parsed into memory footprints, idle vs busy main-thread samples, and per-subsystem symbol buckets.
**Specification:**
  Extract `physicalFootprintMb`/`peakFootprintMb`/`mainThreadSamples`; `idleSamples` = Σ counts on `mach_msg|CFRunLoopServiceMachPort` lines; bucket counts (hermes/yoga/mounting/coreAnimation/uiKit); `estimatedMainThreadBusySamples = max(0, mainThreadSamples − idleSamples)`; top 30 symbols; `available` if any footprint/symbols found
**Suspected defect:** brittle regex parsing of a CLI text format.
**Confidence:** Medium. **SME question:** which `sample`/Instruments output version is assumed?

### RULE-053: Subprocess calls carry fixed timeouts and I/O buffers
**Category:** Calculation
**Priority:** P2
**Source:** many — e.g. `snapshot-command.ts:138,461` (axe 12000ms / 4 MiB); `app-lifecycle-actions/.../index.ts:107,139,…` (boot/install 120000ms, launch 60000ms); `gestures.ts:442` (35000ms); `live-backlog/.../index.ts:859-860` (60000ms / 8 MiB); `hermes-cdp-client/.../index.ts:40` (WS open `min(timeoutMs,2500)`); `perf-evidence/.../actions.ts:386-393` (ettrace `seconds=clamp(…,1,30)`, timeout `(seconds+20)*1000`)
**Plain English:** Every subprocess/CDP call bounds how long evidence collection may run and how much output it will buffer.
**Parameters:** Buffers 4/5/8 MiB; timeouts 2500/3000/5000/10000–20000/12000/30000/35000/60000/120000 ms; ettrace seconds clamp 1..30.
**Suspected defect:** seven hand-rolled `execFile` wrappers with inconsistent timeout/error semantics (see ASSESSMENT debt #7); centralize.
**Confidence:** High (literal).

### RULE-054: Full screenshots scroll/stitch a fixed segment geometry
**Category:** Calculation
**Priority:** P2
**Source:** `src/commands/screenshot-capture/src/main/index.ts:198,214-219,533-556`
**Plain English:** A full-page screenshot scrolls a clamped number of segments using screen-relative swipe coordinates, then stitches them.
**Specification:**
  `segmentCount = clamp(args.fullSegments ?? args.segments ?? 3, 1, 12)`; fallback `390×844`; swipe `startX=round(width/2)`, `startY=round(height*0.82)`, `endY=round(height*0.28)` (≈54% per segment)
**Confidence:** High.

### RULE-055: RN introspection caps traversal depth/nodes and rounds
**Category:** Calculation
**Priority:** P2
**Source:** `src/commands/rn-introspection/src/main/index.ts:179-180,820-822` (+ slices)
**Plain English:** Component-tree introspection bounds depth and node counts and rounds measured values to keep evidence finite.
**Specification:**
  `maxDepth = max(1, min(depth ?? 30, 80))`; `maxNodes = max(1, min(limit ?? 500, 2000))`; ancestor path capped at depth 40 / slice 16–24; control/record lists `slice(0,80)`/`slice(0,60)`; element actions `slice(0,10)`; `round(v) = Math.round(v*100)/100`
**Confidence:** High.

### RULE-056: Post-launch crash check window clamps 0..30000 (defaults to 0)
**Category:** Calculation
**Priority:** P1
**Source:** `src/commands/app-lifecycle-actions/src/main/index.ts:275-289`
**Plain English:** The crash-evidence scan (RULE-029) waits a clamped grace period and only counts reports newer than a baseline time.
**Specification:**
  `delay = clamp(args.waitMs ?? 0, 0, 30000)`; `sinceMs = finiteNumber(args.sinceMs ?? now())`; `launch-app` passes `waitMs: args.crashCheckMs`
**Suspected defect:** `crashCheckMs` has **no default** — omitting it gives a 0 ms grace, so a crash a moment after launch is missed (the live-backlog template explicitly passes `--crash-check-ms 1000`).
**Confidence:** Medium. **SME question:** should `crashCheckMs` default to a non-zero grace (e.g. 1000–3000 ms)?

### RULE-057: Live-backlog classifies each command row from its evidence
**Category:** Calculation
**Priority:** P1
**Source:** `src/commands/live-backlog/src/main/index.ts:928-994,1021-1035`
**Plain English:** The backlog runner classifies each command's outcome from its exit code, declared requirements, and observed live evidence.
**Specification:**
  exit 2 → `expected-usage-error`; non-zero → `environment-blocked` (if requirements) else `expected-usage-error`/`defect`; exit 0 with runtime requirement (`metro|metro-message|hermes-target|app-bridge`) but no live evidence → `environment-blocked`; `available:false` → `expected-usage-error`/`environment-blocked`/`designed-unavailable`; else `live-pass` / `static-pass`
**Parameters:** Live-evidence detection requires WS URLs / CDP calls / running packager / non-empty targets.
**Confidence:** High.

### RULE-058: Live-backlog substitutes hardcoded developer fixtures
**Category:** Calculation
**Priority:** P2
**Source:** `src/commands/live-backlog/src/main/index.ts:897-909`
**Plain English:** The backlog matrix fills placeholders with baked-in defaults, including a developer-specific bundle id and deep-link scheme.
**Specification:**
  `__METRO_PORT__ → metroPort ?? 8081`; `__BUNDLE_ID__ → "com.maddie.console"`; `__DEVICE__ → "booted"`; `__DEV_CLIENT_URL__ → "exp+maddie://…127.0.0.1%3A8081"`
**Suspected defect:** developer-specific fixtures (`com.maddie.console`, `exp+maddie://`) leak into the runner.
**Confidence:** High. **SME question:** should these become required inputs / project config rather than baked-in defaults?

---

## Rules requiring SME confirmation

Every Medium-confidence rule plus each P0/P1 **suspected defect** that needs a human "preserve vs fix" decision before transformation. The behavior contract built by `/modernize-brief` is assembled from the P0 rules — resolve these first.

| ID | Conf. | Question for the SME |
|---|---|---|
| RULE-002 | High* | The read/device/runtime-eval classifier is duplicated in `bridge-domain-actions` and `navigation-deeplinks`. Confirm it should be unified to one source of truth (and the read/device prefix lists are complete). |
| RULE-003 | High* | Should redaction be unified to the strongest superset key set (`authorization|bearer|cookie|set-cookie|token|secret|password|pwd|api[-_]?key|apikey|x-api-key|client_secret|refresh|credential|session|auth`) at the single output boundary, removing the two weaker copies? |
| RULE-009 | Medium | The generated bridge now fails closed on undefined `__DEV__`. Confirm no other registration path bypasses `registerExpo98DevtoolsBridge`, and the shipped bridge matches this generator. |
| RULE-010 | High* | Should `trace.*` (which injects JS, patches RAF + the DevTools commit hook) be classified `runtime-eval` and gated behind policy / `--allow-runtime-eval`? **(P0 — fix expected.)** |
| RULE-011 | High* | Classify each `inspector` action read vs runtime-eval and gate the mutating ones (`install-comment-menu`, `clear-comments`, `toggle`). **(P0 — fix expected.)** |
| RULE-013 | High* | Confirm `--output-path` must be confined to a resolved artifacts root (reject paths outside it). **(P0 — fix expected.)** |
| RULE-014 | Medium | Confirm the overlay server's target contract: loopback bind + unguessable per-session token + strict `Origin` check + hard body-size cap + `comments[]` schema validation. |
| RULE-020 | High* | Where should the Expo→RN compatibility table live so it can be updated without a code release (it currently stops at Expo 54 and silently classifies newer SDKs `unknown`)? |
| RULE-025 | High* | Can a failure to persist a run record ever change a command's exit code, or must recording be strictly observational (best-effort, never re-raise)? **(integrity — fix expected.)** |
| RULE-028 | Medium | Is the runtime bridge-`health`/`domains` state machine intentionally deferred, or must production wiring inject a real `bridgeHealthPayload`? The full code set + ordering is needed for the rewrite. |
| RULE-030 | High* | Should the Hermes CDP client enforce a loopback allowlist on `webSocketDebuggerUrl` (mirroring metro-probes), rather than connecting it unchanged? |
| RULE-033 | Medium | Should long-lived servers register as session sidecars with a real `running→stale→stopped` lifecycle, or is `sidecars` deprecated and removable from the schema? |
| RULE-034 | High* | Are session/run/snapshot ids ever assumed globally unique (cross-machine artifact merge)? If so, replace `Math.random()` with a collision-resistant id and unify the timestamp variants. |
| RULE-037 | Medium | Confirm the scroll swipe-direction → content-direction mapping (e.g. "down" subtracts from Y) matches intended device behaviour. |
| RULE-041 | High* | Define the canonical output budget and overflow marker (≥4 limits / 2 markers exist today), and decide whether the subprocess `maxBuffer` should exceed the truncation limit. |
| RULE-047 | Medium | Are `33.4`/`16.7` intended as exact 2-frame/1-frame budgets at 60fps (should be 33.33/16.67), and is the 300-sample stats window vs 1000-sample retention split intentional? |
| RULE-049 | High* | Which perf metric names are higher-is-better? The current `improved = candidate ≤ baseline` marks an FPS gain as not improved. |
| RULE-052 | Medium | Which macOS `sample`/Instruments output version does the native-artifact parser assume (the regex parsing is brittle to format changes)? |
| RULE-056 | Medium | Should `crashCheckMs` default to a non-zero grace period (e.g. 1000–3000 ms) so a crash shortly after launch is still caught? |
| RULE-058 | High* | Should the live-backlog substitution defaults (`com.maddie.console`, `exp+maddie://…`) become required inputs / project config rather than baked-in developer fixtures? |

\* "High" confidence in *what the code does*; the open question is the **engineering decision** (preserve vs fix / where to put config) the SME must make before transform.

---

*Companion: `analysis/expo98/DATA_OBJECTS.md` (DTO catalog). Suggested next step: `/code-modernization:modernize-brief expo98 <stack>` — its behavior contract is built from the P0 rules above (RULE-001/002/003/005/006/007/010/011/012/013).*
