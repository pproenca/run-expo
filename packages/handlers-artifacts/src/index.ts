/**
 * `@expo98/handlers-artifacts` — D12 artifacts / review / observability /
 * orchestration command handlers for the Effect-TS rebuild of `expo98`.
 *
 * Every command here is `read` (handler `R = never`): it reads source-derived
 * backlogs, captured evidence, files, and observability state. None inject JS,
 * drive the device, or write source — so none can name a dangerous capability,
 * the same structural guarantee the devtools package relies on.
 *
 * Lands:
 *   - AC-057 — live-backlog row classification from evidence (with a documented
 *     live-evidence detection seam, `LiveEvidenceSignal`).
 *   - AC-058 — live-backlog substitutions are PROJECT INPUTS, not baked fixtures
 *     (`__METRO_PORT__ → metroPort ?? 8081`; `__BUNDLE_ID__`/`__DEVICE__`/
 *     `__DEV_CLIENT_URL__` resolve from required inputs; a missing one is a clear
 *     error — never `com.maddie.console` / `exp+maddie://` / `booted`).
 *   - AC-042 — backlog summary `keys.slice(0,20)` + rollups; run-record summary
 *     `keys.slice(0,40)` + `available`/`routeCount`/`eventCount`.
 *
 * DROPPED (Phase B, NOT built here): video `record` and the in-app HTML overlay
 * scaffold. The hardened review-overlay INGEST server lives in its own package
 * (`@expo98/overlay-server`); `batch` (AC-031) lives in `@expo98/core`'s `runBatch`
 * (reused, never re-implemented).
 */

// AC-042 — payload summaries (run-record slice(0,40) + backlog slice(0,20)).
export { type BacklogSummary, summarizeBacklogPayload, summarizeRunRecordPayload } from "./summary.js"
export { BACKLOG_SUMMARY_KEY_CAP, descriptor, RUN_RECORD_SUMMARY_KEY_CAP } from "./support.js"

// AC-057 / AC-058 — live-backlog (generate / matrix / run).
export {
  applySubstitutions,
  BACKLOG_PLACEHOLDERS,
  BACKLOG_TEMPLATE,
  type BacklogGenerateResult,
  type BacklogInputs,
  type BacklogMatrixCommandResult,
  type BacklogMatrixResult,
  type BacklogMatrixRow,
  type BacklogPlaceholder,
  type BacklogRunResult,
  type BacklogRunRowResult,
  type BacklogTemplateRow,
  buildMatrix,
  classifyRow,
  hasLiveEvidence,
  liveBacklogGenerateCommand,
  liveBacklogMatrixCommand,
  liveBacklogRunCommand,
  type LiveBacklogArgs,
  type LiveBacklogVerb,
  type LiveEvidenceSignal,
  MissingBacklogInput,
  resolveMetroPort,
  resolveSubstitution,
  resolveSubstitutions,
  type ResolvedSubstitution,
  type RowClassification,
  type RowEvidence,
  type RowEvidenceMap,
  RUNTIME_REQUIREMENTS,
  type RuntimeRequirement,
  type SubstitutionMap,
  type SubstitutionResolution,
} from "./live-backlog.js"

// diff (snapshot / screenshot, --baseline) — read.
export { diffCommand, type DiffArgs, type DiffKind, type DiffResult } from "./diff.js"

// ux-context (--include-screenshot/-runtime/-hierarchy/-logs) — read.
export { type UxContextArgs, uxContextCommand, type UxContextResult, type UxFacet } from "./ux-context.js"

// review-next (--surface / --stage / --issue) — read.
export { type ReviewNextArgs, reviewNextCommand, type ReviewNextResult } from "./review-next.js"

// review (report / matrix) — read.
export { type ReviewArgs, reviewCommand, type ReviewResult, type ReviewVerb } from "./review.js"

// dashboard (start / stop / report — file/state only, NO network listener) — read.
export {
  type DashboardArgs,
  dashboardCommand,
  type DashboardResult,
  type DashboardStatus,
  type DashboardVerb,
} from "./dashboard.js"
