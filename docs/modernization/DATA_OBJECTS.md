# expo98 — Data Objects (DTO Catalog)

_Companion to `BUSINESS_RULES.md`, extracted on 2026-05-24 from the live `legacy/expo98/src/**` tree._
_Paths are relative to `legacy/expo98/`. These are the core records/envelopes the business rules consume and produce — the "nouns" the strangler-fig / rebuild must preserve at the package boundary._

The system has **no database**. All durable state is JSON files under a per-invocation **state root** (default `<cwd>/.scratch/expo98`). The persisted records are marked **[on disk]** with their file path; the rest are in-memory envelopes / inputs.

---

## Persistence map (what lands on disk)

| File (under state root)                            | DTO                                      | Written by |
| -------------------------------------------------- | ---------------------------------------- | ---------- |
| `sessions/<sessionId>/session.json`                | `SessionRecord`                          | RULE-024   |
| `sessions/<sessionId>/target.json`                 | `TargetRecord`                           | RULE-018   |
| `sessions/<sessionId>/snapshots/<snapshotId>.json` | `SnapshotResult`                         | RULE-026   |
| `sessions/<sessionId>/refs.json`                   | `RefCache`                               | RULE-026   |
| `<stateDir>/<runId>.json`                          | `RunningRunRecord` → `FinishedRunRecord` | RULE-025   |
| `<projectRoot>/.expo98/bridge.json`                | `BridgeMetadata`                         | RULE-008   |
| `<overlayDir>/events.json`                         | `OverlayEventsFile`                      | RULE-032   |
| `<outputPath>` (HAR / screenshot / recording)      | artifact blobs                           | RULE-013   |

---

## Core persisted records

### SessionRecord _[on disk: `session.json`]_

**Source:** `src/state/session-run-records/src/main/domain.ts:28-39`
| Field | Type | Notes |
|---|---|---|
| `schemaVersion` | `1` | literal |
| `sessionId` | `string` | `<name>-<timestamp>-<suffix>` (RULE-034) |
| `name` | `string` | normalized, ≤48 chars (RULE-043) |
| `artifactDir` | `string` | `sessions/<id>/artifacts/` |
| `createdAt` / `updatedAt` | `string` (ISO) | equal at creation |
| `closedAt?` | `string` (ISO) | set by `session close` |
| `activeTargetId` | `string \| null` | drives RULE-018 |
| `lastSnapshotId` | `string \| null` | drives ref-cache reads (RULE-017/026) |
| `sidecars` | `SidecarRecord[]` | always `[]` in practice (RULE-033) |

**Consumed/produced by:** RULE-024 (lifecycle), RULE-018, RULE-026, RULE-034, RULE-043.
**Note:** two consumers redeclare a looser local copy (`sidecars:unknown[]`, no `closedAt`) at `target-management/.../domain.ts:40-50` and `snapshot-evidence/.../domain.ts:19-29` — unify in the rewrite.

### SidecarRecord / SidecarStatus

**Source:** `src/state/session-run-records/src/main/domain.ts:19-26`
`{ name:string, pid:number|null, port:number|null, status:"running"|"stale"|"stopped"|"unknown" }`. **Declared but never populated** (RULE-033).

### RunningRunRecord → FinishedRunRecord _[on disk: `<runId>.json`]_

**Source:** `src/state/session-run-records/src/main/domain.ts:67-87`
| Field | Type | Notes |
|---|---|---|
| `schemaVersion` | `1` | |
| `runId` | `string` | `<timestamp>-<suffix>` |
| `cli` | `{ name, version }` | |
| `command` | `string` | |
| `args` | `Record<string, JsonValue>` | **redacted** (RULE-003) |
| `root` / `stateDir` | `string` | |
| `startedAt` | `string` (ISO) | |
| `finishedAt` | `string \| null` | null while `running` |
| `status` | `"running" \| "completed" \| "failed"` | RULE-025 |
| `exitCode` | `number \| null` | classified on failure |
| `summary` | `RunPayloadSummary \| null` | finished only |
| `error` | `string \| null` | **sanitized** on failure |

**Consumed/produced by:** RULE-025, RULE-003, RULE-034, RULE-042.

### RunPayloadSummary

**Source:** `src/state/session-run-records/src/main/domain.ts:60-65`
`{ keys:string[] /* first 40 */, available?:boolean, routeCount?:unknown, eventCount?:number }` — RULE-042.

### TargetRecord _[on disk: `target.json`]_

**Source:** `src/state/target-management/src/main/domain.ts:19-38`
| Field | Type | Notes |
|---|---|---|
| `targetId` | `string` | `[platform, device.id, app/metro id, metroPort].join(":")` |
| `platform` | `string` | |
| `device` | `DeviceSummary` | |
| `app` | `{ bundleId, processName, running }` | |
| `metro` | `{ port, status, targetId, title, appId, debuggerUrl }` | |
| `selected` | `boolean` | |
| `stale` | `boolean` | recomputed by rediscovery (RULE-018) |

**Consumed/produced by:** RULE-018, RULE-019, RULE-038. Related: `DeviceSummary` with `state:"booted"|"shutdown"|"connected"|"unknown"` (`target-record.ts:4-15`); result envelopes `TargetCurrentResult` / `TargetUnavailableResult` / `TargetListResult` (`domain.ts:89-106`).

### SnapshotResult _[on disk: `snapshots/<snapshotId>.json`]_

**Source:** `src/commands/snapshot-evidence/src/main/domain.ts:116-132`
| Field | Type | Notes |
|---|---|---|
| `snapshotId` | `string` | `snapshot-<timestamp>-<suffix>` |
| `targetId` | `string` | |
| `routeHint` | `string` | |
| `source` | `string[]` | capture provenance |
| `semanticBridge?` | `SemanticBridgeSnapshot` | |
| `generatedAt` | `string` (ISO) | |
| `filters` | `SnapshotFilters` | RULE-040 |
| `refs` | `RefRecord[]` | `@e1..@eN` (RULE-017) |
| `tree` | `SnapshotNode[]` | |
| `artifacts` | `{ json, screenshot:null, annotatedScreenshot:null }` | |
| `limitations` | `string[]` | |

**Consumed/produced by:** RULE-019, RULE-026, RULE-040.

### RefCache _[on disk: `refs.json`]_

**Source:** `src/commands/snapshot-evidence/src/main/domain.ts:134-140`
`{ snapshotId, targetId, source:string[], semanticBridge?, refs:RefRecord[] }` — the actionable subset of `SnapshotResult`. **Consumed by:** RULE-017, RULE-023, RULE-036.

### RefRecord / SnapshotNode / RefBox

**Source:** `src/commands/snapshot-evidence/src/main/domain.ts:74-102`; `RefBox` mirrored in `ref-actions-wait/.../domain.ts`
`RefRecord = { ref:"@eN", role?, label?, text?, actions:string[], box?:RefBox, stale:boolean, snapshotId, targetId, props? }`; `RefBox = { x, y, width, height }`. **Consumed by:** RULE-017 (validity), RULE-023 (audit), RULE-036 (center point).

### SnapshotFilters / SemanticBridgeSnapshot

**Source:** `src/commands/snapshot-evidence/src/main/domain.ts:1-7,104-114`
`SnapshotFilters = { depth:number|null /* 1..100 */, ... }` (RULE-040). `SemanticBridgeSnapshot` carries bridge route hints + limitations.

### BridgeMetadata _[on disk: `.expo98/bridge.json`]_

**Source:** `src/commands/bridge-command-adapter/src/main/index.ts:85-91`
`{ schemaVersion:1, bridgeVersion:"1.0.0", developmentOnly:true, generatedBy:"expo98", domains:string[] }` — domains `[navigation, network, storage, controls, performance, snapshot]`. **Consumed/produced by:** RULE-008, RULE-009, RULE-027.

### BridgeInstallStatus / BridgeIssue / BridgeInstallPlan

**Source:** `src/commands/bridge-command-adapter/src/main/index.ts:19-83`
`BridgeInstallStatus = { state:"absent"|"present"|"stale"|"incompatible", issues:BridgeIssue[], ... }`; `BridgeIssue = { code, message }` (`missing-expo`/`partial-install`/`version-mismatch`/`not-development-only`); `BridgeInstallPlan` describes files to write. **Consumed/produced by:** RULE-027, RULE-008.

### OverlayEventsFile _[on disk: `events.json`]_

**Source:** `src/commands/review-overlay-workflow/src/main/events.ts:12-21`
`{ version:1, title:string, createdAt:string, updatedAt?:string, events:any[] }` — RULE-032 / RULE-014.

---

## Policy & dispatch envelopes (in-memory)

### PolicyDocument

**Source:** `src/core/policy-redaction/src/main/policy-service.ts:3-18`
`{ allow?:string[], actions?:Record<string, "allow"|"deny"|boolean> }` — the user-supplied `--action-policy` file. **Consumed by:** RULE-001, RULE-005, RULE-006, RULE-007.

### PolicyDecision

**Source:** `src/core/policy-redaction/src/main/policy-service.ts` (`checkedPolicyDecision`)
`{ checked:boolean, allowed:boolean, reason:string, source?:string, policy? }`. **Produced by:** RULE-001/002/004.

### PolicyDeniedPayload

**Source:** `src/core/policy-redaction/src/main/policy-service.ts:19-30,146-166`
`{ available:false, domain, action, source:"policy", evidenceSource:"policy", code:"policy-denied", denied:true, reason:"Policy denied action.", policy }` — the canonical fail-closed shape. **Produced by:** RULE-001, RULE-005, RULE-006, RULE-007.

### DefaultPolicySummary

**Source:** `src/core/policy-redaction/src/main/policy-service.ts:112-122`
`{ read:"allow", write:"deny", device:"deny" }` — RULE-001.

### CliGlobals / CliUsageError

**Source:** `src/core/cli-argv-parser/src/main/index.ts`; `src/core/cli-error-classification/src/main/index.ts:1-37`
`CliGlobals = { json, plain, root?, stateDir?, actionPolicy?, maxOutput?, allowRuntimeEval?, confirmActions?, record?, quiet? }`. Exit-code map `2 → invalid_usage`, `1 → runtime_failure`, `0 → success`. **Consumed by:** RULE-015, RULE-016, RULE-025.

---

## Command result envelopes (in-memory)

### WaitPredicate / WaitTiming / WaitEvaluation

**Source:** `src/commands/ref-actions-wait/src/main/domain.ts:47-66`
`WaitTiming = { timeoutMs /* clamp 0..60000 */, intervalMs /* min(max(floor(t/10),25),250) */ }`; `WaitEvaluation = { matched, final, payload }`. **Consumed/produced by:** RULE-035, RULE-004.

### NetworkEvidencePayload / NetworkRequest / NetworkTransport / NetworkCaptureTiming

**Source:** `src/commands/network-evidence/src/main/index.ts:55-117`
`NetworkRequest = { id, method, url, origin?, path?, status?, ok?, durationMs?, responseBytes?, retryCount?, startedAt?, endedAt?, headers? /* redacted */ }`; `NetworkEvidencePayload = { available, transport, requests, waterfall, duplicates, har?, ... }`. **Consumed/produced by:** RULE-022, RULE-012, RULE-045, RULE-039.

### MetroTarget / MetroTargetsResult / MetroStatusPayload / TargetNormalizationError

**Source:** `src/commands/metro-probes/src/main/index.ts:9-118`
`MetroTarget = { id, title, appId, webSocketDebuggerUrl, ... }`; `TargetNormalizationError = { index:number|null, reason:string }`. **Consumed/produced by:** RULE-021, RULE-018.

### DependencyInfo / CompatibilityClassification

**Source:** `src/commands/project-info-doctor/src/main/index.ts`
`CompatibilityClassification = { state:"compatible"|"mismatched"|"unknown"|"declared-unresolved"|"missing", expoMajor?, reactNativeMajorMinor?, expected? }`. **Produced by:** RULE-020.

### RouteEntry / SpecialFileEntry / ExpoRouteContext

**Source:** `src/commands/router-sitemap/src/main/index.ts`
`RouteEntry = { route:string, file:string, segments:string[] }`. **Produced by:** RULE-044.

### PerfReport (+ findings/metrics)

**Source:** `src/commands/perf-evidence/src/main/model.ts:168-200`, `types.ts`
`PerfReport = { available, confidence:"low"|"medium"|"high", metrics:PerfMetric[], findings:PerfFinding[], native?:PerfNativeSummary, limitations:string[] }`; supporting `PerfFinding`, `PerfMetric`, `PerfRenderCommit`, `PerfFrameSample`, `PerfNetworkRequest`, `PerfComparisonDelta`, `PerfBudgetArtifact`/`PerfBudgetCheck`, `PerfNativeSummary`. **Consumed/produced by:** RULE-046–RULE-052.

### GesturePlan / InteractionArgs / InteractionPayload

**Source:** `src/commands/interaction-actions/src/main/types.ts`, `gestures.ts:42-194`
`GesturePlan = { gesture, start:{x,y}, end:{x,y}, durationMs, repeat, intervalMs, maxEvents }`. **Produced by:** RULE-037.

### crashCheck

**Source:** `src/commands/app-lifecycle-actions/src/main/index.ts:287-294`
`{ action, bundleId, processName, since:string, waitedMs:number, reportCount:number }` (+ `crashReports[]`). **Produced by:** RULE-029, RULE-056.

### BridgeDomainCommandInput / DomainUnavailable / BridgeRuntimeTransport / TargetSummary

**Source:** `src/commands/bridge-domain-actions/src/main/index.ts:35-93`
`DomainUnavailable = { available:false, domain, action, code:"no-runtime-target"|"transport-failure"|"version-mismatch"|"missing-domain"|"unavailable-bridge", reason }`; `BridgeRuntimeTransport = { name:"metro-inspector-hermes-cdp", metroPort, protocol:"Runtime.evaluate", target, cdp }`. **Consumed/produced by:** RULE-006.

### LiveBacklogRow / BacklogRowResult / LiveBacklogSummary / BacklogPayloadSummary

**Source:** `src/commands/live-backlog/src/main/index.ts`
`BacklogRowResult = { classification:"live-pass"|"static-pass"|"environment-blocked"|"expected-usage-error"|"designed-unavailable"|"defect", exitCode, evidence }`; `LiveBacklogSummary = { ...counts, defectCount, environmentBlockedCount, unexplainedPartialCount }`; `BacklogPayloadSummary = { keys:string[] /* first 20 */ }`. **Consumed/produced by:** RULE-057, RULE-058, RULE-042.

---

## Shared envelope conventions (cross-cutting)

Every command returns one of two stable shapes (SPEC "Output Contract"):

- **Success:** `{ ok:true, data:<payload> }` (in `--json` mode), payload always passed through redaction (RULE-003).
- **Failure / unavailable:** `{ ok:false, error }` or, for designed-unavailable evidence, a payload with `{ available:false, code, reason }`. The `available:false` + `code` convention is the universal "we couldn't, and here's the stable why" signal used by RULE-017/018/019/021/022/028 and the policy-denied shape (RULE-001).

`tool-json-envelope` (`src/core/tool-json-envelope/src/main/index.ts`) and `command-dispatch-envelope` own this boundary; they are where redaction (RULE-003) and output truncation (RULE-041) are applied.
