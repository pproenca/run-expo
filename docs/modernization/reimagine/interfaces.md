# expo98 — External Interface Catalog (for from-scratch rewrite)

*Generated 2026-05-24 against the maintained `legacy/expo98/src/**` tree (HEAD `77fc1a6`).*
*Cross-refs: `analysis/expo98/ASSESSMENT.md` (domains), `analysis/expo98/DATA_OBJECTS.md` (DTOs + persistence map), `analysis/expo98/BUSINESS_RULES.md` (behavior).*
*Authoritative inbound surface: `legacy/expo98/src/core/command-surface/src/main/index.ts`; global flags: `legacy/expo98/src/core/cli-argv-parser/src/main/index.ts`.*

This is the **boundary contract** the Effect-TS rewrite must preserve. expo98 is an interactive, local-first developer/agent CLI — **no batch SLA, no hosted service**. "Frequency" below means per-invocation; latency is bounded by simulator/Metro/Hermes round-trips, not throughput. The two load-bearing cross-cutting contracts every interface inherits:

1. **Output envelope** — `--json` → `{ ok:true, data }` or `{ ok:false, error }`; `available:false` + `code` + `reason` for designed-unavailable evidence (`src/core/tool-json-envelope`, `command-dispatch-envelope`). Redaction (RULE-003) and truncation (RULE-041) are applied at this boundary.
2. **Fail-closed safety** — state-changing actions denied unless policy/flag/token allows (RULE-001/005/006/007/008). The rewrite **must** make this a centralized chokepoint (today it is per-handler; `trace`/`inspector` bypass it — RULE-010/011).

---

## 1. INBOUND interfaces (things that drive expo98)

### 1.1 The two executables (bins)

| Bin | Source | Role | Contract to preserve |
|---|---|---|---|
| `expo98` | `package.json:bin` → `cli/expo98.mjs` (esbuild bundle of `src/bundled-cli.ts`) | Primary CLI for new usage | Node ≥20.19.0 ESM, shebang `#!/usr/bin/env node`, single committed bundle so `npx expo98` works unbuilt |
| `expo-ios` | `cli/expo-ios.mjs` (3-line wrapper: `import "./expo98.mjs"`) | Back-compat alias; delegates to identical impl | Must remain a pure re-export of the same handler set; no behavioral fork |

**Published surface:** `files: ["cli/", "README.md"]`; sole runtime dep `ws ^8.21.0`. Rewrite must keep both bin names and the compat-delegation guarantee.

### 1.2 Global flags (apply to every command)

Parsed in `src/core/cli-argv-parser/src/main/index.ts`. Value flags require a following non-flag value or exit 2 (RULE-016); `--json`+`--plain` together → exit 2 (RULE-015).

| Flag | Type | Effect | Rewrite note |
|---|---|---|---|
| `--json` | bool | `{ ok, data }` machine envelope on stdout | POSIX/agent contract — primary structured channel |
| `--plain` | bool | stable line-oriented output (mutually exclusive w/ `--json`) | preserve stability; keep mutual-exclusion → exit 2 |
| `--quiet` | bool | suppress non-essential human output | |
| `--root <dir>` | value | default project root (for `--cwd`-aware cmds) + state-root base | drives state-root resolution (`paths.ts:18-19`) |
| `--state-dir <dir>` | value | persist run-record JSON here; basename `runs` resolves to parent (RULE-024/025) | preserve the `runs`-parent quirk or migrate explicitly |
| `--action-policy <path>` | value | JSON policy file permitting gated write/device actions | central to fail-closed gate |
| `--max-output <chars>` | value | truncate stdout payloads (RULE-041) | streaming-progress rewrite must still cap final payload |
| `--allow-runtime-eval <true\|false>` | value | permit gated Hermes `Runtime.evaluate` predicates (RULE-004) | runtime-eval side-effect class gate |
| `--confirm-actions <list>` | value | comma-split confirmation tokens (e.g. `bridge-install`/`bridge-remove`, RULE-008); noninteractive runs deny | preserve token names + exact-match semantics |
| `--record` | bool | persist run record under `<root>/.scratch/expo98/runs` (RULE-025) | must be observational only — never change exit code |
| `--content-boundaries` | bool | wrap stdout data in untrusted-output boundary | agent-output safety |
| `--debug` / `--no-color` / `--no-input` / `--version` / `--help` / `-h` | bool | debug fields / color off / never-prompt / version / help | `--no-input` = the never-prompt guarantee |

Exit codes (`cli-error-classification`): `0` success, `1` runtime_failure, `2` invalid_usage.

### 1.3 The CLI command surface (inbound application API)

Every row is `COMMAND_SURFACE` from `command-surface/src/main/index.ts`. **Side-effect class** is the policy classifier's view (RULE-002), not the registry's coarse `mutatesRuntime` boolean — `read` = ungated; `device` = simulator/app/native mutation gate; `runtime-eval` = injected-JS gate. Output DTOs are from `DATA_OBJECTS.md`.

#### D5 Discovery / Doctor (read-only)
| Command | Tool | Side-effect | Key args/flags | Output DTO |
|---|---|---|---|---|
| `doctor` | `doctor` | read | `--cwd` | doctor capability record (`project-info-doctor`) |
| `project-info` | `project_info` | read | `--cwd` | `DependencyInfo` / `CompatibilityClassification` (RULE-020) |
| `routes` | `expo_router_sitemap` | read | `--cwd` | `RouteEntry[]` / `SpecialFileEntry` (RULE-044) |
| `devices` | `list_devices` | read | — | device list (`device-listing`) |
| `expo` | `expo` | read | `modules`/`config`/`doctor`/`upstream-policy`/`prebuild`, `--cwd` | expo introspection payload |
| `rn` | `rn` | read | `tree`/`refs`/`renders`/`inspect`, `--metro-port`, `@eN` | RN tree/fiber evidence (RULE-055) |
| `skills` | `skills` | read | `list`/`get <id>` | bundled skill guidance |
| `install` | `install` | read | — | install-target paths |
| `upgrade` | `upgrade` | read | — | upgrade status |
| `release` | `release` | read | `check` | release packaging checks |

#### D5/D3 Session, target, ref, snapshot, wait, find (read-only)
| Command | Tool | Side-effect | Key args/flags | Output DTO |
|---|---|---|---|---|
| `session` | `session` | read | `new [name]`/`list`/`show`/`close`/`clean`, `--older-than` | `SessionRecord` (RULE-024) |
| `target` | `target` | read | `list`/`select <id>`/`current`, `--metro-port` | `TargetRecord`/`TargetCurrentResult`/`TargetListResult` (RULE-018) |
| `snapshot` | `snapshot` | read | `--interactive`/`--source`/`--bounds`/`--depth` | `SnapshotResult` + `RefCache` (RULE-019/026) |
| `refs` | `refs` | read | — | `RefRecord[]` from latest snapshot |
| `get` | `get_ref` | read | `<field> <ref>` | one `RefRecord` field (RULE-017) |
| `find` | `find` | read | `<kind> <value>` `[action]`, `--name` | matched refs + optional plan |
| `wait` | `wait` | read (`wait.fn` → **runtime-eval**) | `--text`/`@eN --state`/`--ms`/`--timeout-ms`/`--fn` | `WaitEvaluation` (RULE-004/035) |
| `accessibility` | `accessibility` | read | `tree`/`audit` | a11y tree/audit (RULE-023) |
| `inspect` | `debug_inspect` | read | `<ref>`, `--metro-port` | cached source/props/bounds + Metro status |

#### D6 App & simulator lifecycle (device — policy-gated, RULE-005)
| Command | Tool | Side-effect | Key args/flags | Output DTO |
|---|---|---|---|---|
| `boot-simulator` | `boot_simulator` | device | `--device` | boot result |
| `open-url` | `open_url` | device | `<url>`, `--device` | open result |
| `launch-app` | `launch_app` | device | `--bundle-id`, `--device` | launch result + `crashCheck` (RULE-029/056) |
| `terminate-app` | `terminate_app` | device | `--bundle-id` | terminate result |
| `reload-app` | `reload_app` | device | `--bundle-id` | reload result + `crashCheck` |
| `install-app` | `install_app` | device | `--app-path`, `--dry-run` | install plan/result |
| `uninstall-app` | `uninstall_app` | device | `--bundle-id`, `--dry-run` | uninstall plan/result |
| `open-route` | `open_expo_route` | device | `[route]`, `--cwd`/`--scheme` | route-open result |
| `set` | `set_environment` | device | `<setting> <value>` (appearance/content-size/location/privacy) | env-mutation result |

#### D7 Interaction / gestures (device — policy-gated)
| Command | Tool | Side-effect | Key args/flags | Output DTO |
|---|---|---|---|---|
| `tap` | `automation_tap` | device | `--x --y` | tap result |
| `gesture` | `automation_gesture` | device | `long-press`/`drag`/`swipe`/`tap`, `--x/--y/--duration-ms/--dry-run` | `GesturePlan` (RULE-037) |
| `long-press`,`dbltap`,`fill`,`focus`,`blur`,`select`,`check`,`uncheck`,`drag`,`scroll`,`scroll-into-view` | `ref_action` | device | `<@eN>` `[value]` | ref-action plan/result (RULE-017/036/037) |
| `type`,`press`,`keyboard` | `keyboard` | device | text / key | keyboard result |
| `clipboard` | `clipboard` | device | `read`/`write`/`paste` | clipboard result |
| `screenshot` | `automation_take_screenshot` | read* | `--annotate`/`--full`/`--output-path` | screenshot artifact ref (RULE-054) |

\* `screenshot` is registry `mutatesRuntime:false`/read-classed but writes a file artifact and shells out to `xcrun simctl io` (see outbound).

#### D9 Bridge (dev-only; token + policy gated)
| Command | Tool | Side-effect | Key args/flags | Output DTO |
|---|---|---|---|---|
| `bridge` | `bridge` | read (install/remove via token RULE-008) | `plan`/`status`/`health`/`domains`/`install`/`remove`, `--cwd`/`--metro-port`/`--confirm-actions` | `BridgeInstallStatus`/`BridgeMetadata`/`BridgeInstallPlan` (RULE-027/028); writes bridge files |
| `storage` | `storage` | read (`set`/`clear` → device) | `<engine> <op>`, `--metro-port` | redacted domain payload (RULE-006) |
| `state` | `state` | read (`save`/`load`/`clear` → device) | `list`/`save`/`load`/`clear` | redacted state payload |
| `controls` | `controls` | read (`press` → device) | `list`/`inspect`/`press` | redacted controls payload |

#### D10 Runtime & DevTools evidence
| Command | Tool | Side-effect | Key args/flags | Output DTO |
|---|---|---|---|---|
| `devtools` | `devtools` | read | `capabilities`, `--metro-port` | DevTools capability records |
| `console` | `console` | read | `--limit`, `--metro-port` | bounded console (RULE-039) |
| `errors` | `errors` | read | `--limit`, `--metro-port` | bounded errors |
| `navigation` | `navigation` | read (`back`/`pop-to-root`/`tab`/`deep-link` → device) | `state`/`deep-link <route>`, `--scheme`/`--metro-port` | redacted nav state (RULE-007/012) |
| `open-dev-menu` | `runtime_inspector` | device (gated) | — | dev-menu result |
| `inspector` | `runtime_inspector` | **runtime-eval (UNGATED defect, RULE-011)** | `probe`/`toggle`/`install-comment-menu`/`read-comments`/`clear-comments`/`open-dev-menu`, `--metro-port` | inspector payload; **rewrite MUST gate mutating actions** |
| `trace` | `trace_interaction` | **runtime-eval (UNGATED defect, RULE-010)** | `--action start/read/stop/clear`, `--metro-port`, `--max-events` | trace payload; **rewrite MUST gate** |
| `highlight` | `highlight` | read | `<ref>` | highlight overlay artifact |

#### D11 Network & performance
| Command | Tool | Side-effect | Key args/flags | Output DTO |
|---|---|---|---|---|
| `network` | `network` | read | `requests`/`waterfall`/`har stop <file>`, `--limit`/`--metro-port`/`--output-path` | `NetworkEvidencePayload` + redacted HAR (RULE-012/022/045) |
| `perf` | `perf` | read | `summary`/`interaction`/`report`/`action`/`bundle`/`compare`/`budget`/`memgraph`, `--metro-port`/`--baseline`/`--candidate`/`--file`/`--native-artifact` | `PerfReport` (RULE-046–052) |
| `profiler` | `perf` | read | `start`/`stop` (alias for perf ettrace) | perf native boundary |
| `metro` | `metro` | read | `status`, `--metro-port` | `MetroStatusPayload`/`MetroTargetsResult` (RULE-021) |
| `logs` | `collect_app_logs` | read | `--device`/`--bundle-id` | app/device logs |

#### D12 Artifacts / review / observability / orchestration
| Command | Tool | Side-effect | Key args/flags | Output DTO |
|---|---|---|---|---|
| `record` | `record` | read* | `--device`/`--output-path` | recording artifact ref (RULE-013; spawns `xcrun simctl io recordVideo`) |
| `diff` | `diff` | read | `snapshot`/`screenshot`, `--baseline` | diff artifact |
| `ux-context` | `capture_ux_context` | read | `--include-screenshot/-runtime/-hierarchy/-logs` | UX-context bundle |
| `annotate-screen` | `annotate_screen` | read (scaffold writes files, confirm-gated) | `prepare`/`read`/`scaffold`, `--cwd`/`--serve` | annotation overlay payload |
| `review-overlay` | `review_overlay` | read (scaffold writes files; `server` opens HTTP) | `prepare`/`scaffold`/`server`/`read`/`clear`, `--cwd`/`--serve`/`--port` | `OverlayEventsFile` (RULE-014/032) |
| `review-overlay-server` | `review_overlay` | read (opens HTTP server) | same | server payload (see §1.4) |
| `review-next` | `review_next_step` | read | `--surface`/`--stage`/`--issue` | next-step guidance |
| `review` | `review` | read | `report`/`matrix` | review artifacts |
| `dashboard` | `dashboard` | read | `start`/`stop`/`report` | session observability (file/state only — **no network listener**) |
| `live-backlog` | `live_backlog` | read (fan-out — see §1.5) | `generate`/`matrix`/`run`, `--cwd` | `LiveBacklogSummary`/`BacklogRowResult` (RULE-057/058) |
| `batch` | `batch` | read (fan-out — see §1.5) | `<argv-json-steps...>`, `--bail` | `{ ok, bail, failureIndex, steps }` (RULE-031) |

#### D1/D2 Meta (read-only)
| Command | Tool | Side-effect | Key args/flags | Output DTO |
|---|---|---|---|---|
| `policy` | `policy` | read | `show`/`check action <name>`, `--action-policy` | `PolicyDecision` (RULE-001) |
| `redact` | `redact` | read | `<file>`, `--output-path` | redacted file (RULE-003) |
| `dialog` | `dialog` | device (act) / read (status) | `status`/`dismiss`, `--metro-port` | dialog-blocker payload |
| `sheet` | `sheet` | device (act) / read (status) | `status`/`dismiss`, `--metro-port` | sheet-blocker payload |
| `annotation-server` | `annotation_server` | read (**dead tombstone**) | — | hard-returns `{ available:false, code:"external-annotation-server-removed" }` |

**Inbound command count by domain** (75 registered command entries; several share a tool, e.g. 11 share `ref_action`):

| Domain | Commands | Count |
|---|---|---:|
| D5 Discovery/Doctor + Session/Target/Ref/Snapshot | doctor, project-info, routes, devices, expo, rn, skills, install, upgrade, release, session, target, snapshot, refs, get, find, wait, accessibility, inspect | 19 |
| D6 App & simulator lifecycle | boot-simulator, open-url, launch-app, terminate-app, reload-app, install-app, uninstall-app, open-route, set | 9 |
| D7 Interaction / gestures | tap, gesture, long-press, dbltap, fill, focus, blur, select, check, uncheck, drag, scroll, scroll-into-view, type, press, keyboard, clipboard, screenshot | 18 |
| D9 Bridge | bridge, storage, state, controls | 4 |
| D10 Runtime & DevTools | devtools, console, errors, navigation, open-dev-menu, inspector, trace, highlight | 8 |
| D11 Network & performance | network, perf, profiler, metro, logs | 5 |
| D12 Artifacts/review/orchestration | record, diff, ux-context, annotate-screen, review-overlay, review-overlay-server, review-next, review, dashboard, live-backlog, batch | 11 |
| D1/D2 Meta | policy, redact, dialog, sheet, annotation-server | 5 |
| **Total** | | **79** |

> Reconciliation: `COMMAND_SURFACE` has 75 array entries; the table above expands `bridge`/`storage`/`state`/`controls`/`navigation`/`dialog`/`sheet` sub-verb groupings consistently. The canonical machine count is the 75-entry registry array; group `ref_action` (11 commands) and the `runtime_inspector`/`review_overlay`/`perf` tool-sharing when sizing handlers (~46 distinct tool handlers).

### 1.4 Inbound network surface — localhost overlay/annotation HTTP server

`src/commands/review-overlay-workflow/src/main/server.ts` (`reviewOverlayServer`). Reached via `review-overlay server` / `review-overlay-server`. **The only inbound network listener in the system** (the `annotation-server` command is a dead tombstone; `dashboard` does NOT listen).

- **Bind:** `127.0.0.1` only (`server.ts:55`) — loopback hard-coded.
- **Port:** `--port` (clamped 1..65535) else `findAvailablePort(17655)` incrementing on `EADDRINUSE` (`server.ts:14,83-95`).
- **Routes:** `GET /events.json` (returns events file or `{"events":[]}`); `POST <endpointPath>` (default `/events`, validated `^\/[A-Za-z0-9_./-]+$`); everything else → `404`.
- **Body:** `POST` body is `JSON.parse`'d and appended verbatim to `OverlayEventsFile.events[]`, then `events.json` rewritten with `updatedAt`.
- **Process model:** blocks forever (`return new Promise<never>(() => {})`) after emitting `{ url, endpoint, eventsUrl, dir }` JSON.
- **Hardening gaps (RULE-014, preserve loopback but fix):** no body-size cap (memory exhaustion), no auth/per-session token, no `Origin`/CORS check, no `comments[]` schema validation.

```yaml
# AsyncAPI/OpenAPI-style fragment — overlay server (inbound)
servers: { local: { url: http://127.0.0.1:{port}, default-port: 17655 (search up), bind: loopback-only } }
paths:
  /events.json:
    get: { 200: application/json -> OverlayEventsFile }   # {version:1,title,createdAt,updatedAt?,events[]}
  "{endpointPath}":        # default /events, pattern ^/[A-Za-z0-9_./-]+$
    post:
      requestBody: application/json (any JSON; appended verbatim — NO schema/size cap today)
      responses: { 200: { ok:true, eventsPath, eventCount }, 404: { ok:false, error:"not found" } }
# Rewrite contract: keep loopback bind + port-search + the two routes;
# ADD body-size cap + unguessable session token + strict Origin check (security uplift).
```

### 1.5 `batch-orchestration` / `live-backlog` — internal fan-out triggers (inbound→self)

- **`batch`** (`batch.ts`): normalizes each step (argv-JSON array), runs **serially**, each step forced `json:true, plain:false, quiet:true`, inheriting `--root`/`--state-dir`. In bundled mode steps run in-process via the injected handler registry; the fallback adapter re-invokes the CLI as a subprocess (`execFile(process.execPath, [cliPath, ...argv], {timeout:120_000})`, `batch.ts:108`). `--bail` stops on first failure; per-step data is redacted (`redactValue(unwrapToolJson(...))`). **Contract:** every command is a composable, side-effect-free-to-recompose unit; the rewrite's fan-out should run in-process (Effect fibers) and never let a sub-step's record write change the parent exit code.
- **`live-backlog`** (`live-backlog/index.ts`): source-derived backlog that executes a matrix of commands and classifies each row (`live-pass`/`static-pass`/`environment-blocked`/`defect`...). RULE-058 flags that it substitutes hardcoded developer fixtures — the rewrite must drive real commands, not fixtures.

---

## 2. OUTBOUND interfaces (things expo98 calls / writes)

### 2.1 Hermes via CDP over WebSocket

`src/platform/hermes-cdp-client/src/main/index.ts` (sole runtime dep `ws`). RULE-030.

- **Connection model:** open WS to `webSocketDebuggerUrl` (from Metro `/json/list`), header `Origin: http://127.0.0.1[:port]`, open bounded by `min(timeoutMs, 2500)`ms, then `Runtime.enable` → `Runtime.evaluate {returnByValue:true, awaitPromise:true}`, responses correlated by incrementing `id`.
- **Loopback enforcement:** if host is loopback, expands to candidates `127.0.0.1`, `localhost`, `[::1]` and tries each (`loopbackWebSocketCandidates`, `:85-109`). **Gap (RULE-030 / CWE-918):** a *non*-loopback debugger URL is connected unchanged — rewrite must mirror Metro's allowlist and reject non-loopback.
- **Errors/timeouts:** per-message timeout `timeoutMs`; malformed JSON → reject with raw truncated to 1000 chars; all-attempts-fail → `{ error, diagnostics:{ attemptedUrls } }`.
- **Frequency/SLA:** per evidence command (console/errors/network/perf/snapshot/bridge/inspector/trace/navigation); interactive, tail latency = app+Metro state.
- **Rewrite contract:** preserve `Runtime.enable`+`Runtime.evaluate` sequence, id-correlation, Origin header, bounded open; **enforce loopback on the WS target** (close the CWE-918 gap); route ALL runtime-eval through the centralized policy gate.

### 2.2 Metro HTTP probes

`src/commands/metro-probes/src/main/index.ts`. RULE-021.

- **Endpoints (GET):** `/status`, `/json/list`, `/json/version`, `/symbolicate` (POST for symbolicate).
- **Loopback only:** host allowlist `127.0.0.1|localhost|[::1]|::1`; non-loopback URLs are NOT expanded (`loopbackUrlCandidates`, `:602-619`); all fetches use `http://127.0.0.1:<port>`. `AbortController` timeout per fetch.
- **Never auto-starts Metro;** malformed `/json/list` (non-array) → `{ available:false, malformedTargets:[...] }`; unreachable → `{ available:false, status:"unavailable" }`.
- **Frequency/SLA:** per target-discovery / metro-status / network call; interactive.
- **Rewrite contract:** loopback-only, never spawn Metro, skip-don't-crash on malformed rows, same four endpoints, port clamp 1..65535.

### 2.3 iOS simulator / device subprocesses

All via `execFile` with **argv arrays — no shell** (verified, no CWE-78), except the two `command -v` probes which use `sh -lc` over a fixed/allowlisted arg (`shellArg`). Outbound process integrations:

| Binary | Invoked by (module) | Representative argv | Shell? |
|---|---|---|---|
| `xcrun` / `simctl` | app-lifecycle, device-listing, route-url, interaction (env/clipboard), runtime-inspector, record-artifacts, screenshot-capture, ux-context, snapshot-command, target-service | `xcrun simctl boot\|launch\|terminate\|install\|uninstall\|list\|openurl\|io screenshot\|io recordVideo\|pbpaste\|pbcopy\|ui\|location\|privacy\|get_app_container` | no (argv) |
| `open` | app-lifecycle (`open -a Simulator`), devtools-diagnostics, runtime-inspector | `open -a Simulator` / `open <url>` | no (argv) |
| `axe` | accessibility, interaction (tap/gesture/keyboard), screenshot, snapshot, ux-context | `axe describe-ui\|tap\|...` | no (argv) |
| `idb` | interaction (tap/gesture), shared tool-resolution | `idb ui tap ...` | no (argv) |
| `adb` | app-lifecycle (android), device-listing, interaction, route-url, screenshot | `adb devices -l` / `adb shell input ...` | no (argv) |
| `node`/`npx`/`plutil` | project-info-doctor (capability detection only) | — | no (argv) |
| `sh -lc` | **project-info-doctor:585** (`command -v <allowlisted>`), **screenshot-capture:629** (`command -v <command>`) | `sh -lc "command -v <arg>"` | **yes** (lone shell use; arg via `shellArg`/fixed allowlist) |

- **Frequency/SLA:** per device/lifecycle command; fixed per-call timeouts (RULE-053): boot/launch/list `10_000–20_000`ms, axe describe `12_000`ms, `maxBuffer` 4 MiB on listings.
- **Rewrite contract:** keep **execFile argv-array (never shell-interpolate)**; replace the two `sh -lc` probes with a shell-free `which`/PATH lookup; one uniform subprocess wrapper with typed tool-not-found + consistent timeout/exit semantics (ASSESSMENT debt #7).

### 2.4 Filesystem writes (state-root JSON persistence + artifacts)

**State root** (`paths.ts:13-20`): `--state-dir` if given (basename `runs` → its parent), else `<--root|cwd>/.scratch/expo98`.

| Path under state root / project | DTO | Written by | Rewrite contract |
|---|---|---|---|
| `sessions/<sessionId>/session.json` | `SessionRecord` | RULE-024 | schema v1; lifecycle new→close→clean |
| `sessions/<sessionId>/target.json` | `TargetRecord` | RULE-018 | stable `targetId` identity |
| `sessions/<sessionId>/snapshots/<snapshotId>.json` | `SnapshotResult` | RULE-026 | full snapshot incl. refs/tree |
| `sessions/<sessionId>/refs.json` | `RefCache` | RULE-026 | rewritten each snapshot; `@e1..@eN` |
| `<stateDir>\|<root>/.scratch/expo98/runs/<runId>.json` | `RunningRunRecord`→`FinishedRunRecord` | RULE-025 (`run-recorder.ts:39-62`) | **best-effort** — write failure must NOT change exit code; args+error redacted |
| `<projectRoot>/.expo98/bridge.json` | `BridgeMetadata` | RULE-008 (`bridge-command-adapter:132`) | confirm-token gated; dev-only flag |
| `<projectRoot>/src/expo98-devtools-bridge.ts` | bridge runtime source | RULE-008 (`BRIDGE_SOURCE_FILE`) | confirm-token gated; legacy `.expo-ios` fallback on remove |
| `<overlayDir>/events.json` | `OverlayEventsFile` | RULE-032 (server + `events.ts`) | create/reset then append |
| `<outputPath>` (HAR / screenshot / recording / memgraph / redact-out) | artifact blobs | RULE-013 | **CONFINE to artifacts root** — today `--output-path` is unconfined (CWE-22, must fix) |

- **Frequency/SLA:** per command (records every recorded run; session/snapshot/target on demand). No batch SLA.
- **Rewrite contract:** preserve the directory layout + DTO schemas so existing artifacts remain readable; make record-writes observational (RULE-025) and confine `--output-path` (RULE-013).

```yaml
# CLI output contract (every command, both fan-out and direct)
Success(--json):  { ok: true,  data: <PayloadDTO> }    # data passed through redaction + max-output truncation
Failure(--json):  { ok: false, error: <string> }       # exit 1 (runtime) | 2 (usage)
DesignedUnavailable: <Payload with { available:false, code, reason }>   # exit 0; stable "couldn't, here's why"
Plain(--plain):   stable line-oriented; mutually exclusive with --json (else exit 2)
```

---

## 3. Loopback / safety constraints by outbound integration (summary)

| Outbound | Loopback enforced? | Other safety constraints | Rewrite must |
|---|---|---|---|
| Hermes CDP (WS) | partial — loopback expanded, but non-loopback URL connected unchanged (gap) | Origin header, id-correlation, bounded open (2500ms), runtime-eval = gated class | **enforce loopback**; centralize runtime-eval gate (fixes RULE-010/011) |
| Metro HTTP probes | yes — strict `127.0.0.1\|localhost\|[::1]\|::1` | never auto-start, skip malformed, per-fetch timeout | keep strict allowlist + 4 endpoints |
| Simulator/device subprocs | n/a (local exec) | execFile argv arrays (no shell); fixed timeouts/maxBuffer; policy-gated for device class | keep argv-only; remove the 2 `sh -lc` probes; one uniform wrapper |
| FS state/artifacts | n/a | redaction before write; record writes inside dispatch try (defect) | best-effort records; confine `--output-path` to artifacts root |
| Overlay HTTP server (inbound) | yes — `127.0.0.1` bind | path allowlist + 404 default | keep loopback; add body cap + token + Origin check |

---

## Confidence & Gaps

- **High confidence:** the full inbound command→tool→handler table (read directly from `COMMAND_SURFACE`), the 10 global flags + exit codes, both bins, the overlay server method/paths/bind/port-search/payload, the 4 Metro endpoints + loopback gate, the Hermes CDP connection model, the subprocess binary inventory (execFile argv vs the 2 `sh -lc` sites), and the persistence-map file paths (cross-checked against `paths.ts`/`run-recorder.ts`/`bridge-command-adapter`).
- **Inferred (flagged):** per-command "key args/flags" are reconstructed from `SPEC.md`/`EXAMPLES`/`DATA_OBJECTS.md` and the boolean-flag set in the argv parser, not from a per-command arg-schema (the CLI has no central declarative arg schema; each handler reads `args` ad hoc). The side-effect classification per sub-verb (e.g. which `storage`/`navigation`/`controls` sub-actions are device vs read) is from RULE-002/006/007, not re-derived line-by-line for every sub-action.
- **Command count nuance:** 75 registry entries vs 79 in the expanded domain table — the delta is sub-verb expansion of `bridge`/`storage`/`state`/`controls`/`navigation`/`dialog`/`sheet`. Use **75** as the canonical machine count, **~46** distinct tool handlers (after `ref_action`/`runtime_inspector`/`review_overlay`/`perf` sharing).
- **Could not determine (ask SME):**
  1. Is the `--state-dir` basename-`runs`→parent quirk load-bearing for any external consumer, or safe to drop in the rewrite?
  2. Should `trace`/`inspector` runtime-eval be gated behind `--allow-runtime-eval`/policy (assumed yes — RULE-010/011)? Confirm before preserving today's ungated behavior.
  3. Confirm artifacts must be confined to a resolved root (`resolved.startsWith(artifactsRoot)`) — RULE-013.
  4. Should the overlay server gain a per-session token + body cap (assumed yes — RULE-014), and does any existing in-app overlay client depend on the unauthenticated `POST <endpointPath>` shape?
  5. Is `bridgeHealthPayload` (RULE-028) intentionally a stub, or does production wiring inject a real implementation the rewrite must reproduce?
