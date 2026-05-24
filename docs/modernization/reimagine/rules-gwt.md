# expo98 — Acceptance-Test List (rules-gwt)

_Consolidated from `analysis/expo98/BUSINESS_RULES.md` (RULE-001..058) and `DATA_OBJECTS.md` on 2026-05-24._
_Purpose: the executable behavior contract a greenfield Effect-TS rewrite implements against. The legacy `src/**` is the **specification source**, not a port target. Citations spot-checked; the four FIX-driving defects (AC-010/011/013/025) were re-verified against live source._

**Counts: 58 acceptance criteria.** P0: 10 · P1: 26 · P2: 22. By category — Policy 14, Validation 9, Lifecycle 10, Calculation 25.

Conventions used below:

- `legacy:` is the stable cross-reference back to the rule catalog.
- `Preserve-vs-fix:` appears only on rules the catalog flagged as suspected defects. **PRESERVE** = greenfield must reproduce the legacy behavior exactly. **FIX** = greenfield should correct it (no back-compat constraint exists for a from-scratch build).
- `clamp(v, lo, hi)` means bound v to [lo, hi]. All ports clamp 1..65535. Loopback allowlist = `127.0.0.1 | localhost | [::1] | ::1`.

---

## P0 behavior contract (must never regress)

These ten are the non-negotiable invariants. Every one is a manifestation of the two load-bearing promises — **fail closed** and **redact** — plus loopback-only networking. If any regress, the build is unsafe regardless of feature completeness.

| AC     | Invariant                         | One-line contract                                                                                                              |
| ------ | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| AC-001 | Fail-closed policy gate           | State-changing actions are DENIED unless an explicit policy allows the exact action; pure reads always pass.                   |
| AC-002 | Single side-effect classifier     | One authoritative `read / device / runtime-eval` classifier decides the gate; unknown action ⇒ `device` (fail-closed).         |
| AC-003 | Redact at the output boundary     | Every payload to stdout or disk passes through ONE redactor (strongest key superset) before it leaves the process.             |
| AC-005 | Device/app mutations gated        | boot/launch/terminate/reload/install/uninstall denied unless policy allows; denial performs zero `xcrun`/`simctl`.             |
| AC-006 | Bridge writes gated + bounded     | storage/state/controls writes require policy; returned value is redacted + size-bounded; defense-in-depth re-check.            |
| AC-007 | Navigation mutations gated        | nav `state` is ungated read; back/pop-to-root/tab/deep-link are gated.                                                         |
| AC-010 | `trace` is runtime-eval (FIX)     | Injecting in-app JS via `trace` MUST be gated as `runtime-eval`. Legacy is ungated — defect, fix it.                           |
| AC-011 | `inspector` mutations gated (FIX) | Mutating inspector actions MUST be gated; legacy gates only `open-dev-menu` — defect, fix it.                                  |
| AC-012 | Network/URL/HAR redaction         | auth headers, cookies, secret query values stripped before any network evidence / HAR / route URL leaves.                      |
| AC-013 | Artifact path confinement (FIX)   | `--output-path` MUST resolve under the artifacts root; reject `../` / absolute escapes. Legacy is unconfined — defect, fix it. |

Supporting invariant from Lifecycle: **AC-030 (loopback-only CDP)** and **AC-021 (loopback-only Metro probes)** are the network-confinement floor. **AC-025 (run-record write is observational)** is an integrity invariant — recording must never change a command's exit code (FIX).

---

## FIX recommendations (vs preserve)

| AC     | legacy   | Sev  | Decision               | One-line reason                                                                                                                                                                                                                                                             |
| ------ | -------- | ---- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC-010 | RULE-010 | High | **FIX**                | `trace` injects JS (patches RAF + DevTools commit hook, mutates global tracer) with zero policy gate — breaks fail-closed (CWE-862/94). Greenfield: classify `runtime-eval`, gate it.                                                                                       |
| AC-011 | RULE-011 | High | **FIX**                | `inspector` gates only `open-dev-menu`; `install-comment-menu`/`clear-comments`/`toggle`/`probe` run injected JS ungated (CWE-862/94). Greenfield: gate the mutating ones, classify reads as `read`.                                                                        |
| AC-013 | RULE-013 | High | **FIX**                | HAR/screenshot/recording resolve `--output-path` with no confinement — `../`/absolute escapes the workspace (CWE-22), reachable via batch. Greenfield: assert resolved path under artifacts root.                                                                           |
| AC-025 | RULE-025 | High | **FIX**                | A failed run-record write flips an already-succeeded command to failed/exit 1 — recording is leaking into control flow. Greenfield: recording is observational only, never re-raise / never alter exit code.                                                                |
| AC-003 | RULE-003 | High | **FIX**                | Three divergent redactors; the generic one misses `set-cookie/auth/bearer/session/x-api-key/client_secret/refresh/credential/pwd` — those persist to `runs/*.json` and stdout in cleartext (CWE-532). Greenfield: ONE redactor, strongest superset, at the single boundary. |
| AC-002 | RULE-002 | Med  | **FIX**                | Side-effect classifier re-implemented divergently in 3 modules — they can drift and silently un-gate an action. Greenfield: one source of truth.                                                                                                                            |
| AC-030 | RULE-030 | Med  | **FIX**                | CDP client connects `webSocketDebuggerUrl` unchanged (no loopback allowlist, unlike metro-probes) — SSRF-ish (CWE-918, low likelihood). Greenfield: mirror the metro-probes loopback allowlist.                                                                             |
| AC-014 | RULE-014 | Med  | **FIX**                | Overlay server has no body cap / auth token / Origin check / schema validation (CWE-400). Greenfield: loopback + unguessable per-session token + strict Origin + hard body cap + `comments[]` schema.                                                                       |
| AC-049 | RULE-049 | Med  | **FIX**                | Perf comparison assumes lower-is-better, so an FPS gain is marked NOT improved. Greenfield: direction-aware per metric (higher-is-better set: `avgFps`, throughput, counts-of-good).                                                                                        |
| AC-056 | RULE-056 | Med  | **FIX**                | `crashCheckMs` has no default ⇒ 0 ms grace ⇒ a crash a moment after launch is missed. Greenfield: default a non-zero grace (1000–3000 ms).                                                                                                                                  |
| AC-058 | RULE-058 | Low  | **FIX**                | Developer fixtures (`com.maddie.console`, `exp+maddie://`) baked into the live-backlog runner. Greenfield: required inputs / project config.                                                                                                                                |
| AC-009 | RULE-009 | Low  | **PRESERVE**           | Live source already fails closed on undefined `__DEV__`. Preserve fail-closed; SME only confirms no alternate registration path.                                                                                                                                            |
| AC-034 | RULE-034 | —    | **FIX (if global)**    | `Math.random().toString(36).slice(2,8)` is not collision-resistant and can yield <6 chars; 3 timestamp variants diverge. FIX only if ids must be globally unique (SME).                                                                                                     |
| AC-037 | RULE-037 | —    | **PRESERVE**           | Scroll "down" subtracts from Y (swipe-up ⇒ content-down). Math is correct; preserve unless SME says the swipe→content mapping is wrong.                                                                                                                                     |
| AC-047 | RULE-047 | —    | **PRESERVE-with-note** | Frame budgets `33.4/16.7` aren't exact 60fps multiples (33.33/16.67). Preserve numeric behavior; note for SME — likely a rounding typo, low impact.                                                                                                                         |
| AC-052 | RULE-052 | —    | **PRESERVE**           | Brittle regex parse of macOS `sample` text. Preserve behavior; SME pins the assumed Instruments version.                                                                                                                                                                    |

Everything not listed above is **PRESERVE** (faithful re-spec). The line items below carry the same `Preserve-vs-fix:` verdicts inline.

---

## Policy

### AC-001: State-changing actions fail closed without explicit policy

legacy: RULE-001 · Priority: P0 · Category: Policy

- Given a command whose side-effect is `read`, When the policy engine evaluates it, Then it is allowed with no policy file required (decision records `read → allow`).
- Given a command with a `write`/`device`/`runtime-eval` side-effect, When no policy file allows the exact action, Then return `{ available:false, source:"policy", evidenceSource:"policy", code:"policy-denied", denied:true, reason:"Policy denied action.", policy }` and perform NO mutation (the denial never reaches the bridge/subprocess).
- Given a policy file where `allow[]` includes the action OR `actions[action] === "allow" | true`, When the state-changing command runs, Then the operation proceeds.
- Parameters: default summary `{ read:"allow", write:"deny", device:"deny", runtimeEval:"deny unless --allow-runtime-eval or policy" }`; match keys `allow[]`, `actions[action]`.

### AC-002: Action side-effect classification drives the gate

legacy: RULE-002 · Priority: P0 · Category: Policy

- Given an action name, When `actionSideEffect(action)` runs, Then `wait.fn` → `runtime-eval`; read-prefix match → `read`; device-prefix match → `device`; everything else → `device` (fail-closed default).
- Parameters: read regex `^(doctor|project-info|routes|devices|target\.list|target\.current|snapshot|refs|get|find|wait|console|errors|logs|metro\.status|policy|redact|review)`; device regex `^(storage\.set|storage\.clear|state\.save|state\.load|state\.clear|install-app|uninstall-app|set\.)`.
- Preserve-vs-fix: **FIX** — classifier is re-implemented in `bridge-domain-actions` and `navigation-deeplinks`; consolidate to one source of truth so it cannot drift and silently un-gate an action.

### AC-003: Secrets are redacted before output and persistence

legacy: RULE-003 · Priority: P0 · Category: Policy

- Given any handler payload (or run-record args/error), When it is emitted to stdout or persisted to a run record, Then objects/arrays are recursively redacted; keys matching the secret pattern → `[redacted]`; secret-shaped URL query and `key=value` substrings → `[redacted]`.
- Parameters: `REDACTED="[redacted]"`; legacy generic `SECRET_KEY_PATTERN=/token|authorization|cookie|password|secret|apikey|apiKey/i`.
- Preserve-vs-fix: **FIX** — three divergent redactors (generic / network-stronger / bridge-weaker). The generic one misses `set-cookie|auth|bearer|session|x-api-key|api-key|client_secret|refresh|credential|pwd`, so non-network payloads with those keys persist in cleartext (CWE-532). Greenfield: ONE redactor using the strongest superset `authorization|bearer|cookie|set-cookie|token|secret|password|pwd|api[-_]?key|apikey|x-api-key|client_secret|refresh|credential|session|auth`, applied at the single output boundary.

### AC-004: Runtime-eval (`wait --fn`) needs a flag or policy

legacy: RULE-004 · Priority: P1 · Category: Policy

- Given `wait` with a function predicate and `--allow-runtime-eval` true, Then runtime evaluation is allowed (`source:"--allow-runtime-eval"`).
- Given `wait --fn` without the flag, Then `wait.fn` must be allowed by policy before Hermes evaluation; otherwise treated as denied.
- Given a runtime predicate with no runtime adapter, Then `{ matched:false, available:false, reason:"Runtime wait predicates require a runtime adapter." }` (unavailable, not a crash).
- Parameters: action `wait.fn`; side-effect `runtime-eval`.

### AC-005: App/device lifecycle mutations are policy-gated

legacy: RULE-005 · Priority: P0 · Category: Policy

- Given a device action (`boot-simulator`/`launch-app`/`terminate-app`/`reload-app`/`install-app`/`uninstall-app`), When policy is not allowed, Then return `policyDeniedPayload(...)` and perform NO `xcrun`/`simctl` call.
- Given `install-app`/`uninstall-app` with `--dry-run`, Then return a plan with the policy attached and mutate nothing.
- Parameters: side-effect `device`. This is the reference gating pattern other commands mirror.

### AC-006: Bridge storage/state/controls writes gated; returned payload redacted + bounded

legacy: RULE-006 · Priority: P0 · Category: Policy

- Given a domain action whose side-effect is not `read`, When `policy.allowed !== true`, Then return `policyDeniedPayload` without calling the bridge.
- Given an allowed (or read) action, When the bridge responds, Then the value is redacted + size-bounded and tagged `domain/action/metroPort/target/transport/evidenceSource/policy`; a second defense-in-depth check re-denies any non-read whose policy is not allowed.
- Parameters: storage `list/get`=read else write; state `list`=read else write; controls `press`=device else read. `EXPO98_BRIDGE_VERSION="1.0.0"`, `MAX_OUTPUT=40000`, `MAX_ARRAY_ITEMS=1000`. Unavailable codes: `no-runtime-target|transport-failure|version-mismatch|missing-domain|unavailable-bridge`.

### AC-007: Navigation reads ungated; navigation mutations gated

legacy: RULE-007 · Priority: P0 · Category: Policy

- Given navigation action `state`, Then it is read-only and ungated.
- Given `back`/`pop-to-root`/`tab` (gated as `navigation.<action>`) or `deep-link` (gated as `open-route`), When policy does not allow it, Then return `{ available:false, source:"policy", reason, policy, transport }`.
- Parameters: mutation actions are side-effect `device`.

### AC-008: Bridge install/remove require an explicit confirmation token

legacy: RULE-008 · Priority: P1 · Category: Policy

- Given bridge `install` without `--confirm-actions bridge-install` (or `remove` without `bridge-remove`), Then create/delete no files; respond with `requiredConfirmation`, current `status`, and `plan`.
- Given the matching token, Then `install` writes `.expo98/bridge.json` + `src/expo98-devtools-bridge.ts`; `remove` deletes both (plus legacy `.expo-ios` fallbacks) and recomputes status.
- Parameters: tokens `bridge-install`/`bridge-remove` (comma-split, trimmed, exact); `EXPO98_BRIDGE_VERSION="1.0.0"`, schema `1`. `status`/`plan`/`health`/`domains` are read-only.
- Preserve-vs-fix: **FIX (consistency)** — `review-overlay scaffold` writes source guarded only by `--force`, not a confirmation token. Greenfield: gate all source-mutating scaffolds behind a confirmation token consistently.

### AC-009: The generated bridge is development-only

legacy: RULE-009 · Priority: P1 · Category: Policy

- Given installed bridge metadata where `developmentOnly !== true`, Then install status is `incompatible` (issue `not-development-only`).
- Given the generated bridge registers at runtime, When `typeof __DEV__ === "undefined"` Then refuse (`development-mode-required`); When `__DEV__ === false` Then refuse (`production-build`); Otherwise register and set `globalThis.__EXPO98_DEVTOOLS_BRIDGE__`.
- Preserve-vs-fix: **PRESERVE** — live source already fails closed on undefined `__DEV__`. SME confirms no registration path other than `registerExpo98DevtoolsBridge`.

### AC-010: `trace` must be policy-gated runtime-eval

legacy: RULE-010 · Priority: P0 · Category: Policy

- Given any `trace` action (`start`/`read`/`clear`/`stop`), When it runs, Then it MUST be classified `runtime-eval` and require policy or `--allow-runtime-eval`; otherwise return `policyDeniedPayload`.
- Parameters: eval timeout `8000ms`; `maxEvents` clamp 1..2000; `metroPort` clamp 1..65535.
- Preserve-vs-fix: **FIX (High)** — verified: the trace module imports/calls NO policy at all (`index.ts:91-93` calls `evaluateHermesExpression` directly); the injected program patches `requestAnimationFrame` + the DevTools `onCommitFiberRoot` hook and mutates global tracer state (CWE-862/94). A from-scratch build has no back-compat reason to leave it ungated.

### AC-011: `inspector` mutating actions must be policy-gated

legacy: RULE-011 · Priority: P0 · Category: Policy

- Given `inspector` mutating actions (`install-comment-menu`, `clear-comments`, `toggle`), Then they MUST be policy-gated; reads (`probe`, `read-comments`) classified `read`.
- Parameters: eval timeout `8000ms`; mutating expression writes runtime global `__CODEX_SIMULATOR_REVIEW__`.
- Preserve-vs-fix: **FIX (High)** — verified: only `open-dev-menu` is gated (`index.ts:170`); the shared `evaluateHermesExpression` path (`:117`) runs injected JS ungated for all other actions. Root cause is per-handler gating; greenfield should centralize the gate in dispatch so this class of bug is structurally impossible.

### AC-012: Network/route URLs and HAR are redacted before they leave

legacy: RULE-012 · Priority: P0 · Category: Policy

- Given network evidence is printed or written as HAR, Then auth headers / cookies / credentials / bodies / HAR content are redacted and query/cookie material is emptied in HAR entries.
- Given a route/deep-link URL is reported, Then sensitive query/cookie values are redacted.
- Parameters: header regex `/authorization|cookie|token|secret|api[-_]?key|password|set-cookie/i`; URL regex `/token|secret|key|password|auth|session|cookie/i`; HAR `version "1.2"`; invalid URL → regex query fallback.
- Preserve-vs-fix: this path is the _stronger_ redactor; folding it into the unified AC-003 superset IS the fix.

### AC-013: `--output-path` must be confined to the artifacts root

legacy: RULE-013 · Priority: P0 · Category: Policy

- Given a user-supplied `--output-path` (HAR/screenshot/recording), When the artifact is written, Then the resolved path MUST be asserted to live under the allowed artifacts root, else rejected before any `mkdir`/write.
- Parameters: legacy default is `path.resolve(outputPath ?? <default under state/tmp root>)` then recursive `mkdir` + write.
- Preserve-vs-fix: **FIX (High)** — verified: both `network-evidence:239` and `screenshot-capture:194,366` are bare `path.resolve(args.outputPath ?? ...)` with no confinement check; `../`/absolute escapes the workspace and is reachable from a crafted batch step (CWE-22).

### AC-014: Review-overlay local server is hardened

legacy: RULE-014 · Priority: P1 · Category: Policy

- Given a request to the overlay server, When the path is not `GET /events.json` or `POST <endpointPath>` (validated by `^\/[A-Za-z0-9_./-]+$`), Then respond 404.
- Given an accepted POST, Then it MUST require an unguessable per-session token, pass an `Origin` check, be under a hard body-size cap, and validate the `comments[]` schema before appending to `events.json`.
- Parameters: bind `127.0.0.1`; default port search from `17655`, incrementing on `EADDRINUSE`.
- Preserve-vs-fix: **FIX** — legacy binds loopback + allowlists paths but `JSON.parse(body)` is appended verbatim with no body cap (CWE-400), no token/auth, no Origin/CORS, no schema check.

---

## Validation

### AC-015: `--json` and `--plain` are mutually exclusive → exit 2

legacy: RULE-015 · Priority: P2 · Category: Validation

- Given global flags include both `--json` and `--plain`, Then throw `CliUsageError("--json and --plain are mutually exclusive.")` → exit code 2, error code `invalid_usage`.
- Parameters: `EXIT_SUCCESS=0`, `EXIT_RUNTIME_FAILURE=1`, `EXIT_INVALID_USAGE=2`. Unknown commands / malformed values also classify `invalid_usage`.

### AC-016: Value flags require a value → exit 2

legacy: RULE-016 · Priority: P2 · Category: Validation

- Given a value flag (`--root`/`--state-dir`/`--action-policy`/`--max-output`/`--allow-runtime-eval`/`--confirm-actions`) with no following non-flag value, Then throw `CliUsageError("--<key> requires a value.")` → exit 2.

### AC-017: Refs must be current, valid, action-capable, and bounded

legacy: RULE-017 · Priority: P1 · Category: Validation

- Given a ref action, When there is no ref cache / ref missing / stale / lacks the action / lacks bounds for a point action, Then return `{ available:false, reason }` (with `availableActions` when applicable) and do not act.
- Given a valid, action-capable ref, Then return a dry-run plan `{ action, ref, targetId, box, point }`.
- Parameters: ref format `^@e\d+$`; stale reason `"Ref is stale. Capture a new snapshot before acting."`. `get` is more permissive: returns a stale ref with a `stale` field rather than blocking.

### AC-018: A selected target is valid only while rediscovered

legacy: RULE-018 · Priority: P1 · Category: Validation

- Given a session with `activeTargetId`, When `target current` rediscovers it, Then `{ available:true, target:{ ...current, selected:true, stale:false } }`.
- When it is not rediscovered, Then `{ available:false, reason:"Selected target is stale.", target:{ ...persisted, stale:true } }`.
- Given `target select <id>` for an id not in rediscovery, Then `{ available:false, reason:"Target not found.", targetId, targets }`.
- Parameters: `targetId = [platform, device.id, appId||metroId||metroTitle||"no-runtime", metroPort||"no-metro"].join(":")`; simctl list timeout 20000ms; unreadable `target.json` → synthetic stale record.

### AC-019: Snapshot capture needs session + active target + device metadata

legacy: RULE-019 · Priority: P1 · Category: Validation

- Given no session / no active target / missing `device.id`, Then return unavailable with the matching reason and write no artifacts.
- Given valid session + target metadata, When semantic-bridge capture succeeds Then persist via the semantic path; else if `axe` CLI present Then native describe → persist; else unavailable.
- Parameters: semantic eval timeout `5000ms`; native `axe describe-ui` timeout `12000ms`, `maxBuffer 4 MiB`; codes include `transport-failure`.

### AC-020: Upstream Expo↔RN compatibility is classified before use

legacy: RULE-020 · Priority: P1 · Category: Validation

- Given Expo and RN versions declared, When either missing → `missing`; either unresolved (`catalog:|workspace:|file:|link:|portal:`) → `declared-unresolved`; Expo major not in table → `unknown`; else `compatible` iff RN major.minor matches expected, else `mismatched`.
- Given an upstream API surface, Then `public-api` may be imported directly; `documented-unstable-api`/`internal-reference-only`/`optional-compatibility-shim` require shims + runtime checks.
- Parameters: table Expo 54→RN 0.81, 53→0.79, 52→0.76, 51→0.74, 50→0.73; version parse takes first `\d+\.\d+(\.\d+)?` run.
- Preserve-vs-fix: **FIX (config-location)** — the table is hardcoded and stops at Expo 54; newer SDKs silently classify `unknown`. SME: where should the SDK→RN map live so it updates without a code release (data file / fetched manifest)?

### AC-021: Metro probes never auto-start Metro; loopback only; skip malformed

legacy: RULE-021 · Priority: P1 · Category: Validation

- Given a Metro probe, When `/json/list` is not an array → `{ available:false, malformedTargets:[{index:null, reason:"Metro target list was not an array."}] }`; per-target rows without identifying metadata are skipped into `malformedTargets`; all fetches use `http://127.0.0.1:<port>` (loopback allowlist).
- When Metro is unreachable, Then `{ available:false, status:"unavailable", reason:"Metro is not reachable on the requested port." }`.
- Parameters: endpoints `/status`, `/json/list`, `/json/version`, `/symbolicate`; never implicitly starts Metro; port clamp 1..65535.

### AC-022: Network evidence requires a live target, well-formed shape, observed traffic

legacy: RULE-022 · Priority: P1 · Category: Validation

- Given no Hermes target / no evaluator → `no-runtime-target` (or `transport-failure`).
- Given a non-object payload or non-array `requests` → `malformed-payload`.
- Given empty observed traffic for `requests`/`waterfall`/`har-stop` → `no-observed-traffic`.
- Otherwise return validated, redacted evidence. Parameters: `metroPort` clamp 1..65535; `limit` clamp 1..1000.

### AC-023: Accessibility audit flags interactive refs lacking a name

legacy: RULE-023 · Priority: P2 · Category: Validation

- Given a cached ref with `actions.length > 0` and no `label` and no `text`, Then emit `{ ref, rule:"interactive-name", message:"Interactive ref has no label or text." }`.
- Edge: requires a snapshot/ref cache, else `available:false`.

---

## Lifecycle

### AC-024: Sessions own an artifact namespace and move new→close→clean

legacy: RULE-024 · Priority: P1 · Category: Lifecycle

- Given `session new`, Then create `<stateRoot>/sessions/<sessionId>/artifacts/` and write `session.json` (`schemaVersion:1`, id, name, artifactDir, timestamps, `activeTargetId:null`, `lastSnapshotId:null`, `sidecars:[]`).
- Given `session close`, Then set `closedAt`, `updatedAt=closedAt`, clear `sidecars:[]` (record retained).
- Given `session clean`, Then delete directories of sessions whose `createdAt < now − olderThan`.
- Parameters: default name `review`; default clean age `7d`; state root default `<cwd>/.scratch/expo98`; `--state-dir` whose basename is `runs` resolves to its parent. Corrupt `session.json` skipped on list; missing `createdAt` not deleted by clean.

### AC-025: Run records go running→completed/failed (write must be observational)

legacy: RULE-025 · Priority: P1 · Category: Lifecycle

- Given `--record` or `--state-dir`, Then write `<stateDir>/<runId>.json` as `running` (args redacted per AC-003).
- Given the handler returns, Then finish `completed`, exit 0, with a summarized payload.
- Given the handler throws, Then finish `failed` with `exitCodeForError(error)` and a sanitized error.
- Parameters: without recording flags the recorder is a no-op; summary = `Object.keys(payload).slice(0,40)` + `available`/`routeCount`/`eventCount`.
- Preserve-vs-fix: **FIX (High, integrity)** — verified: `recorder.finish` is `await`ed inside the dispatch flow; a failed record write (read-only/full `--state-dir`, EACCES) flips an already-emitted successful command to failed/exit 1. Greenfield: recording is strictly observational — persist failures are caught and logged, NEVER re-raised and NEVER alter the exit code.

### AC-026: Each snapshot persists evidence and refreshes the ref cache

legacy: RULE-026 · Priority: P1 · Category: Lifecycle

- Given a successful capture (native or semantic-bridge), Then write `sessions/<id>/snapshots/<snapshotId>.json` (full `SnapshotResult`) and `sessions/<id>/refs.json` (`{ snapshotId, targetId, source, semanticBridge, refs }`); set session `lastSnapshotId = snapshotId`, `updatedAt = generatedAt`.
- Parameters: snapshot id `snapshot-<timestamp>-<6char>`; semantic refs rewritten to `@e1..@eN` with `stale:false`.

### AC-027: Bridge install state is absent/present/stale/incompatible

legacy: RULE-027 · Priority: P1 · Category: Lifecycle

- Given no `expo` dep → `incompatible` (`missing-expo`).
- Given metadata XOR source present → `stale` (`partial-install`).
- Given both present but version `!= 1.0.0` or schema `!= 1` → `stale` (`version-mismatch`).
- Given both present, versions match, but `developmentOnly !== true` → `incompatible` (`not-development-only`).
- Given both present, versions match, dev-only → `present`. Given Expo present but neither file → `absent`.
- Parameters: files `.expo98/bridge.json` + `src/expo98-devtools-bridge.ts` (legacy `.expo-ios` fallback); version `1.0.0`, schema `1`; metadata domains `[navigation,network,storage,controls,performance,snapshot]`.

### AC-028: Bridge runtime health fails closed

legacy: RULE-028 · Priority: P1 · Category: Lifecycle

- Given install status is stale/incompatible, Then health is unavailable before probing.
- Given probing permitted but no Hermes target / missing bridge / missing registration / version mismatch, Then a stable unavailable code (`stale-bridge`/`incompatible-project`/`transport-failure`/`missing-bridge`).
- Given all checks pass, Then report read/write domains, redaction boundaries, policy requirements.
- Preserve-vs-fix: **FIX/build-out** — in live source the real payload builder is not wired (`defaultBridgeHealthPayload` is a stub returning `available:false`). SME must supply the full ordered state machine + a real `bridgeHealthPayload`; the rewrite implements it for real (do not preserve the stub).

### AC-029: App launch/reload attaches crash evidence and fails closed on crash

legacy: RULE-029 · Priority: P1 · Category: Lifecycle

- Given launch/reload completes, When ≥1 matching `.ips`/`.crash` report appeared after `startedAt`, Then set `available:false`, reason `"The app generated N matching iOS crash report(s) after <action>."`, attach `crashCheck` + `crashReports`; else attach `crashCheck` and leave payload unchanged.
- Parameters: `crashCheck = { action, bundleId, processName, since, waitedMs, reportCount }`; only `.ips`/`.crash` matched. (Timing window: AC-056.)

### AC-030: CDP/WebSocket connections are loopback, id-correlated, time-bounded

legacy: RULE-030 · Priority: P1 · Category: Lifecycle

- Given a CDP evaluation, Then open WS with `Origin: http://127.0.0.1[:port]`, `waitForOpen ≤ min(timeoutMs, 2500)`, send `Runtime.enable` then `Runtime.evaluate {returnByValue:true, awaitPromise:true}`, match responses by incrementing `id`; on all-attempts-fail return `{ error, diagnostics:{ attemptedUrls } }`.
- Parameters: loopback candidates `127.0.0.1`, `localhost`, `[::1]`; malformed JSON → reject with raw truncated to 1000 chars.
- Preserve-vs-fix: **FIX** — legacy connects a non-loopback `webSocketDebuggerUrl` unchanged (CWE-918, low likelihood). Greenfield: enforce the metro-probes loopback allowlist on `webSocketDebuggerUrl` before connecting.

### AC-031: Batch steps run serially and bail on first failure

legacy: RULE-031 · Priority: P2 · Category: Lifecycle

- Given a list of steps, Then run serially (each forced `json:true, plain:false, quiet:true`, inheriting `root`/`stateDir`, data redacted); record `failureIndex` on first failure; if `bail` true, break.
- Then return `{ ok: failureIndex===null, bail, failureIndex, steps }`. Parameters: subprocess fallback timeout 120000ms.

### AC-032: Review-overlay events file is created/reset then appended

legacy: RULE-032 · Priority: P2 · Category: Lifecycle

- Given `prepare` with `reset` or no existing file, Then write a fresh `{version:1, title, createdAt, events:[]}`.
- Given a server POST, Then append the parsed body to `events[]`, set `updatedAt`, rewrite (input hardening per AC-014).
- Given `read` with no file, Then `{ available:false, reason:"No review overlay events file exists." }`.
- Parameters: action enum `prepare|scaffold|server|read|clear`; default port search from 17655; bind 127.0.0.1.

### AC-033: Session sidecar lifecycle (decision pending)

legacy: RULE-033 · Priority: P2 · Category: Lifecycle

- Given any session operation, Then `sidecars` is created `[]` and cleared `[]` on close; the review-overlay server tracks its pid only in its own payload, never as a session sidecar.
- Preserve-vs-fix: **DROP-or-implement (SME)** — the schema declares `running/stale/stopped/unknown` but no code ever populates a non-empty `sidecars`. Greenfield either implements a real `running→stale→stopped` sidecar lifecycle for long-lived servers OR drops the field. Do not preserve the dead forward-declaration.

---

## Calculation

### AC-034: Evidence IDs = prefix + timestamp + random suffix

legacy: RULE-034 · Priority: P2 · Category: Calculation

- Given a new session/run/snapshot, Then id = `<prefix>-<timestamp>-<suffix>`.
- Parameters (legacy): suffix = `Math.random().toString(36).slice(2,8)`; session prefix=name, timestamp lowercased with trailing `Z` stripped; run timestamp keeps `Z`, original case; snapshot prefix `snapshot-`, keeps `Z`, lowercased. Empty normalized session name throws.
- Preserve-vs-fix: **FIX if global** — `Math.random()` is not collision-resistant and `slice(2,8)` can yield <6 chars; 3 timestamp variants diverge. If ids are ever assumed globally unique (cross-machine merge), replace with a collision-resistant id and unify the timestamp format. SME confirms uniqueness scope.

### AC-035: Wait polls on a bounded cadence until match or timeout

legacy: RULE-035 · Priority: P2 · Category: Calculation

- Given a predicate, Then poll every `intervalMs` until matched/final/timeout, sleeping `min(intervalMs, timeoutMs − elapsed)` each tick, returning last evidence on timeout.
- Given no predicate and `ms > 0`, Then sleep the clamped duration and report `matched:true`.
- Parameters: `timeoutMs = clamp(args.timeoutMs ?? 5000, 0, 60000)`; `intervalMs = min(max(floor(timeoutMs/10), 25), 250)`; sleep `ms = clamp(args.ms ?? 0, 0, 60000)`. Invalid/missing/stale refs are final-unmatched; timeout payload samples 5 refs.

### AC-036: Ref point actions target the element center

legacy: RULE-036 · Priority: P2 · Category: Calculation

- Given a ref with `box`, Then `point = { x: box.x + box.width/2, y: box.y + box.height/2 }`; missing box → unavailable (no coordinates computed).

### AC-037: Scroll/gesture plans use signed deltas and clamped defaults

legacy: RULE-037 · Priority: P2 · Category: Calculation

- Given a scroll, Then `amount = clamp(args.amount ?? args.text ?? 600, 1, 5000)`, default origin `{x:200,y:700}`, deltas: down `{0,−amount}`, up `{0,+amount}`, left `{+amount,0}`, right `{−amount,0}`.
- Given a gesture, Then `repeat=clamp(…?? 1,1,20)`, `intervalMs=clamp(…?? 250,0,10000)`, `durationMs=clamp(…?? default,1,30000)`, `maxEvents=clamp(…?? 200,1,2000)`.
- Parameters: default gesture durations long-press 900, drag 900, swipe 250, tap 80 ms.
- Preserve-vs-fix: **PRESERVE** — "down" subtracts from Y (swipe-up ⇒ content-down). Math is consistent; preserve unless SME confirms the swipe→content mapping is unintended.

### AC-038: Metro port defaults to 8081 and clamps to 1..65535

legacy: RULE-038 · Priority: P2 · Category: Calculation

- Given any read of the Metro port, Then value = `clamp(metroPort ?? 8081, 1, 65535)`.
- Preserve-vs-fix: **PRESERVE behavior, FIX duplication** — the default/range appear at 9+ sites; greenfield hoists to one constant.

### AC-039: Request/console limit defaults to 100 and clamps to 1..1000

legacy: RULE-039 · Priority: P2 · Category: Calculation

- Given a request/console/error list, Then limit = `clamp(args.limit ?? 100, 1, 1000)`, taking the last N entries.

### AC-040: Snapshot filter depth clamps to 1..100

legacy: RULE-040 · Priority: P2 · Category: Calculation

- Given a snapshot tree, Then depth is `null` (unbounded) or `clamp(args.depth, 1, 100)`; deeper nodes pruned (root depth 0).

### AC-041: Output is truncated with explicit overflow markers

legacy: RULE-041 · Priority: P1 · Category: Calculation

- Given output over the limit, Then return the leading content and append a marker stating how much was dropped.
- Parameters (legacy): `truncateOutput` default 40_000 (marker `[truncated N characters]`); `truncateSubprocessOutput` 100_000; `boundOutput`/`--max-output` clamp 1..10_000_000 (marker `[expo98 output truncated by --max-output]`); CDP error preview 1_000; `MAX_OUTPUT=40_000` reused as subprocess `maxBuffer`.
- Preserve-vs-fix: **FIX** — ≥4 limits and 2 markers coexist; only `boundOutput` reserves room for its suffix; `MAX_OUTPUT` as `maxBuffer` can clip legitimate tool output. SME defines ONE canonical budget + marker; greenfield: subprocess `maxBuffer` ≥ truncation limit.

### AC-042: Run/backlog payload summaries cap the key list

legacy: RULE-042 · Priority: P2 · Category: Calculation

- Given a persisted/displayed payload summary, Then list only the first N top-level keys (run records 40, live-backlog 20) plus rollups.
- Parameters: run summary `keys.slice(0,40)` + `available`/`routeCount`/`eventCount`; backlog summary `keys.slice(0,20)`.

### AC-043: Session names are normalized & capped; durations parse s/m/h/d

legacy: RULE-043 · Priority: P2 · Category: Calculation

- Given a session name, Then lowercase → `[^a-z0-9_.-]+ → "-"` → trim `-` → throw if empty → `slice(0,48)` (default `review`).
- Given a duration, Then `^(\d+)([smhd])$` × `{s:1000, m:60000, h:3600000, d:86400000}`, else throw.

### AC-044: Expo Router file paths normalize groups/dynamic/special/index

legacy: RULE-044 · Priority: P2 · Category: Calculation

- Given a file path, Then strip the extension; if any segment is `_layout` → layout; if any starts with `+` → special; else drop `index` + group `(...)` segments, format the rest, join → `/...`.
- Parameters: `[...rest]` → `*rest`; `[[opt]]` → `:opt?`; `[param]` → `:param`; else literal.

### AC-045: Network waterfall, duplicates, HAR, and `ok` are derived

legacy: RULE-045 · Priority: P2 · Category: Calculation

- Waterfall: keep numeric `durationMs`, sort desc, top 50; `slowThresholdMs=500`; `slowRequestCount` = ranked ≥ 500.
- Duplicates: group by `<method> <origin><path|url>`, keep groups >1, report `count`/`requestIds`/`totalDurationMs`.
- HAR: `version "1.2"`, `time=durationMs ?? 0`, query/cookies emptied; infer `endedAt = Date.parse(startedAt)+durationMs` when absent.
- Request: `status = numberOrNull(request.status) ?? numberOrNull(response.status)`; `ok = explicit boolean ?? (200 ≤ status < 400)`; `responseBytes` fallback chain; `retryCount ?? 0`.

### AC-046: Performance findings use fixed network/render/frame thresholds

legacy: RULE-046 · Priority: P1 · Category: Calculation

- Network: slow if `durationMs ≥ 500` (high ≥ 1000, else medium).
- Render: worst commit `≥ 16.7ms` flagged (high ≥ 50, else medium).
- Frames: `droppedFrames = frames.droppedFrameCount ?? count(deltaMs > 33.4)`; flagged if > 0 (high ≥ 5, else medium).
- Parameters: 500/1000 ms; 16.7/50 ms; 33.4 ms / ≥5.

### AC-047: Performance frame/FPS metrics are computed in injected JS

legacy: RULE-047 · Priority: P1 · Category: Calculation

- Given per-frame deltas, Then `avgFps = round((1000 / mean(deltaMs)) * 10)/10`; `droppedFrameCount = count(delta > 33.4)`; `longFrameCount = count(delta > 16.7)`; `worstFrameMs = max(deltas)`; stats over last 300 samples; retain newest 1000; `deltaMs = round((ts−lastTs)*10)/10`.
- Preserve-vs-fix: **PRESERVE-with-note** — `33.4`/`16.7` aren't exact 60fps multiples (33.33/16.67); 300-stats vs 1000-retention split is asymmetric. SME confirms intent; greenfield may correct to exact budgets (low impact).

### AC-048: Performance confidence is the highest present, else low

legacy: RULE-048 · Priority: P1 · Category: Calculation

- Given a set of signals, Then empty/none → `low`; any `high` → `high`; else any `medium` → `medium`; else `low`. `lowerConfidence(a,b)` returns the weaker of two.

### AC-049: Performance comparison must be direction-aware

legacy: RULE-049 · Priority: P1 · Category: Calculation

- Given matching numeric metrics, Then `delta = candidate − baseline`, `confidence = lowerConfidence(baseline, candidate)`, and `improved` is computed per metric direction (lower-is-better for latency/dropped/long-frame/footprint; higher-is-better for `avgFps`/throughput/good-counts).
- Preserve-vs-fix: **FIX** — legacy hardcodes `improved = candidate ≤ baseline`, marking an FPS gain as NOT improved. SME supplies the higher-is-better metric-name set; greenfield branches on it.

### AC-050: Performance budget fails closed on a missing metric

legacy: RULE-050 · Priority: P1 · Category: Calculation

- Given a budget rule, Then `passed = value is number && (max===undefined || value≤max) && (min===undefined || value≥min)`; missing metric → `value=null` → fail; overall `passed = checks.every(passed)`.

### AC-051: A memory-leak claim needs ≥2 samples or a native artifact

legacy: RULE-051 · Priority: P1 · Category: Calculation

- Given memory evidence with `samples = clamp(args.samples ?? 1, 1, 100)`, Then metric confidence is `medium` iff `samples ≥ 2` or a native artifact exists, else `low`; `leakClaim.allowed = samples ≥ 2 || Boolean(nativeArtifact)`.

### AC-052: Native perf-sample text is parsed into footprint/symbol buckets

legacy: RULE-052 · Priority: P2 · Category: Calculation

- Given a macOS `sample`/Instruments text artifact, Then extract `physicalFootprintMb`/`peakFootprintMb`/`mainThreadSamples`; `idleSamples` = Σ counts on `mach_msg|CFRunLoopServiceMachPort` lines; bucket counts (hermes/yoga/mounting/coreAnimation/uiKit); `estimatedMainThreadBusySamples = max(0, mainThreadSamples − idleSamples)`; top 30 symbols; `available` if any footprint/symbols found.
- Preserve-vs-fix: **PRESERVE** — brittle regex parse; preserve behavior. SME pins the assumed Instruments/`sample` output version.

### AC-053: Subprocess calls carry fixed timeouts and I/O buffers

legacy: RULE-053 · Priority: P2 · Category: Calculation

- Given any subprocess/CDP call, Then it bounds duration and output buffer.
- Parameters: buffers 4/5/8 MiB; timeouts 2500/3000/5000/10000–20000/12000/30000/35000/60000/120000 ms; ettrace `seconds=clamp(…,1,30)`, timeout `(seconds+20)*1000`; WS open `min(timeoutMs,2500)`.
- Preserve-vs-fix: **PRESERVE values, FIX structure** — seven hand-rolled `execFile` wrappers with inconsistent semantics; greenfield centralizes one timeout/buffer-aware subprocess service (Effect).

### AC-054: Full screenshots scroll/stitch a fixed segment geometry

legacy: RULE-054 · Priority: P2 · Category: Calculation

- Given a full-page screenshot, Then `segmentCount = clamp(args.fullSegments ?? args.segments ?? 3, 1, 12)`; fallback `390×844`; swipe `startX=round(width/2)`, `startY=round(height*0.82)`, `endY=round(height*0.28)` (≈54% per segment); stitch segments.

### AC-055: RN introspection caps traversal depth/nodes and rounds

legacy: RULE-055 · Priority: P2 · Category: Calculation

- Given component-tree introspection, Then `maxDepth = max(1, min(depth ?? 30, 80))`; `maxNodes = max(1, min(limit ?? 500, 2000))`; ancestor path capped at depth 40 / slice 16–24; control/record lists `slice(0,80)`/`slice(0,60)`; element actions `slice(0,10)`; `round(v)=Math.round(v*100)/100`.

### AC-056: Post-launch crash check window

legacy: RULE-056 · Priority: P1 · Category: Calculation

- Given a crash-evidence scan, Then `delay = clamp(args.waitMs ?? <non-zero default>, 0, 30000)`; `sinceMs = finiteNumber(args.sinceMs ?? now())`; `launch-app` passes `waitMs: args.crashCheckMs`.
- Preserve-vs-fix: **FIX** — legacy `crashCheckMs` has no default ⇒ 0 ms grace ⇒ a crash a moment after launch is missed (the backlog template explicitly passes `--crash-check-ms 1000`). Greenfield defaults a non-zero grace (1000–3000 ms; SME picks the value).

### AC-057: Live-backlog classifies each command row from its evidence

legacy: RULE-057 · Priority: P1 · Category: Calculation

- Given a backlog row, Then: exit 2 → `expected-usage-error`; non-zero → `environment-blocked` (if requirements) else `expected-usage-error`/`defect`; exit 0 with runtime requirement (`metro|metro-message|hermes-target|app-bridge`) but no live evidence → `environment-blocked`; `available:false` → `expected-usage-error`/`environment-blocked`/`designed-unavailable`; else `live-pass`/`static-pass`.
- Parameters: live-evidence detection requires WS URLs / CDP calls / running packager / non-empty targets.

### AC-058: Live-backlog substitutions must be project inputs

legacy: RULE-058 · Priority: P2 · Category: Calculation

- Given the backlog matrix placeholders, Then `__METRO_PORT__ → metroPort ?? 8081`; `__BUNDLE_ID__`, `__DEVICE__`, `__DEV_CLIENT_URL__` resolve from required inputs / project config.
- Preserve-vs-fix: **FIX** — legacy bakes developer-specific fixtures (`__BUNDLE_ID__ → "com.maddie.console"`, `__DEV_CLIENT_URL__ → "exp+maddie://…127.0.0.1%3A8081"`, `__DEVICE__ → "booted"`). Greenfield: these become required inputs / project config, never baked-in defaults.

---

## SME questions (resolve before/at transform)

P0 / High-severity — resolve first:

1. **AC-010 trace gating (FIX expected):** confirm `trace.*` is classified `runtime-eval` and gated by policy / `--allow-runtime-eval`.
2. **AC-011 inspector gating (FIX expected):** classify each inspector action read vs runtime-eval; gate `install-comment-menu`/`clear-comments`/`toggle`.
3. **AC-013 path confinement (FIX expected):** confirm artifacts must be confined to a resolved root (`resolved.startsWith(artifactsRoot)`).
4. **AC-025 run-record integrity (FIX expected):** confirm a failure to persist a run record may NEVER change a command's exit code — recording is strictly observational.
5. **AC-003 unified redactor:** approve the strongest-superset key set at the single output boundary, removing the two weaker copies.
6. **AC-002 single classifier:** approve unifying the read/device/runtime-eval classifier to one source of truth; confirm the prefix lists are complete.
7. **AC-030 CDP loopback allowlist:** confirm the CDP client must enforce a loopback allowlist on `webSocketDebuggerUrl` (mirror metro-probes).
8. **AC-041 output budget:** define the canonical output budget + overflow marker; decide whether subprocess `maxBuffer` must exceed the truncation limit.

Config-location / data-freshness: 9. **AC-020 SDK→RN table location:** where should the Expo→RN compatibility map live so it updates without a code release (it stops at Expo 54, classifying newer SDKs `unknown`)? 10. **AC-058 backlog fixtures:** confirm `com.maddie.console` / `exp+maddie://` become required inputs / project config.

Semantics / numerics: 11. **AC-049 metric direction:** which perf metric names are higher-is-better (so an FPS gain is "improved")? 12. **AC-047 frame budgets:** are `33.4`/`16.7` intended as exact 2-frame/1-frame budgets at 60fps (33.33/16.67), and is the 300-vs-1000 sample split intentional? 13. **AC-056 crash grace:** what non-zero default for `crashCheckMs` (1000–3000 ms)? 14. **AC-037 scroll mapping:** confirm the swipe-direction → content-direction mapping ("down" subtracts from Y) matches intended device behaviour. 15. **AC-052 sample format:** which macOS `sample`/Instruments output version does the native-artifact parser assume?

Lifecycle / identity: 16. **AC-034 id uniqueness:** are session/run/snapshot ids ever assumed globally unique (cross-machine artifact merge)? If so, replace `Math.random()` and unify timestamp variants. 17. **AC-033 sidecar lifecycle:** should long-lived servers register as session sidecars with a real `running→stale→stopped` lifecycle, or is `sidecars` deprecated and removable from the schema? 18. **AC-028 bridge-health wiring:** is the runtime bridge-health/domains state machine intentionally deferred, or must production wiring inject a real `bridgeHealthPayload`? The rewrite needs the full ordered check set. 19. **AC-014 overlay contract:** confirm the overlay server target: loopback + unguessable per-session token + strict Origin + hard body cap + `comments[]` schema validation. 20. **AC-009 bridge registration:** confirm no registration path other than `registerExpo98DevtoolsBridge` exists in the shipped bridge. 21. **AC-008 scaffold gating:** confirm `review-overlay scaffold` should also require a confirmation token (not just `--force`), consistent with bridge install/remove.
