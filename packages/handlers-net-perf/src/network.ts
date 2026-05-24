/**
 * `network` — D11 network-evidence derivations (AC-045) + HAR write confinement
 * (AC-013). All PURE except the single HAR file path which is confined through
 * core's `confinePath` before any write (AC-013, the FIX).
 *
 * Pipeline (re-spec of the legacy `network-evidence`):
 *   1. Validate the harvested payload SHAPE via `@expo98/protocols`
 *      `validateNetworkEvidence` (AC-022 — reused, not re-implemented).
 *   2. NORMALIZE each request row: derive `origin`/`path` from the URL (invalid
 *      URL → regex query fallback), `status`, `ok`, `endedAt`, `responseBytes`
 *      fallback chain, `retryCount ?? 0` (AC-045).
 *   3. WATERFALL: keep numeric `durationMs`, sort desc, top 50;
 *      `slowThresholdMs = 500`; `slowRequestCount` = ranked ≥ 500.
 *   4. DUPLICATES: group by `<method> <origin><path|url>`, keep groups > 1,
 *      report `count` / `requestIds` / `totalDurationMs`.
 *   5. HAR: `version "1.2"`, `time = durationMs ?? 0`, query+cookies emptied,
 *      `endedAt` inferred when absent.
 *
 * REDACTION NOTE: redaction (auth headers / cookies / secret query values,
 * AC-012/003) happens at core's SINGLE output boundary (`redact`) — NOT here.
 * This module only derives structure. The HAR query/cookie arrays are emptied
 * (a HAR-shape requirement), which is distinct from value redaction.
 */
import { confinePath, type PathEscape } from "@expo98/core"
import { type Effect } from "effect"
import { isRecord, numberOrNull, optionalString } from "./support.js"

export const SLOW_THRESHOLD_MS = 500 as const
export const WATERFALL_TOP_N = 50 as const
export const HAR_VERSION = "1.2" as const

/** A raw, un-normalized request row as harvested over CDP. */
export interface RawNetworkRequest {
  readonly id?: unknown
  readonly requestId?: unknown
  readonly method?: unknown
  readonly url?: unknown
  readonly startedAt?: unknown
  readonly endedAt?: unknown
  readonly completedAt?: unknown
  readonly durationMs?: unknown
  readonly status?: unknown
  readonly ok?: unknown
  readonly headers?: unknown
  readonly request?: unknown
  readonly response?: unknown
  readonly requestBytes?: unknown
  readonly encodedRequestBytes?: unknown
  readonly responseBytes?: unknown
  readonly encodedResponseBytes?: unknown
  readonly retryCount?: unknown
  readonly aborted?: unknown
  readonly error?: unknown
  readonly [key: string]: unknown
}

/** A normalized request row with all AC-045 derived fields. */
export interface NormalizedNetworkRequest {
  readonly id: string | null
  readonly requestId: string | null
  readonly method: string
  readonly url: string
  readonly origin: string | null
  readonly path: string | null
  readonly startedAt: string | null
  readonly endedAt: string | null
  readonly durationMs: number | null
  readonly status: number | null
  /** `explicit boolean ?? (200 ≤ status < 400)` — `undefined` when status absent. */
  readonly ok: boolean | undefined
  readonly requestBytes: number | null
  readonly responseBytes: number | null
  readonly retryCount: number
  readonly aborted: boolean
  readonly error: string | null
}

export interface DuplicateGroup {
  readonly key: string
  readonly count: number
  readonly requestIds: ReadonlyArray<string>
  readonly totalDurationMs: number
}

export interface NetworkWaterfall {
  readonly requestCount: number
  readonly slowThresholdMs: number
  readonly slowRequestCount: number
  readonly rankedRequests: ReadonlyArray<NormalizedNetworkRequest>
  readonly duplicateGroups: ReadonlyArray<DuplicateGroup>
}

// ──────────────────────────────────────────────────────────────────────────
// URL parsing (AC-045: invalid URL → regex query fallback for `path`)
// ──────────────────────────────────────────────────────────────────────────

/** Parse origin/path from a URL; an invalid URL yields `origin:null, path:url`. PURE. */
export const parseUrlParts = (url: string): { readonly origin: string | null; readonly path: string | null } => {
  if (!url) {
    return { origin: null, path: null }
  }
  try {
    const parsed = new URL(url)
    return { origin: parsed.origin, path: `${parsed.pathname}${parsed.search}` }
  } catch {
    // AC-045 edge: not a parseable absolute URL — keep the raw string as the path.
    return { origin: null, path: url || null }
  }
}

/** Infer `endedAt = Date.parse(startedAt) + durationMs` when absent (AC-045). PURE. */
export const inferEndedAt = (startedAt: string | null, durationMs: number | null): string | null => {
  if (startedAt === null || durationMs === null) {
    return null
  }
  const started = Date.parse(startedAt)
  if (!Number.isFinite(started)) {
    return null
  }
  return new Date(started + durationMs).toISOString()
}

// ──────────────────────────────────────────────────────────────────────────
// Normalization (AC-045 derived fields)
// ──────────────────────────────────────────────────────────────────────────

/**
 * Normalize one request row, deriving every AC-045 field. PURE.
 *
 *   - `status = numberOrNull(request.status) ?? numberOrNull(response.status)`
 *   - `ok = explicit boolean ?? (200 ≤ status < 400)` (undefined when no status)
 *   - `responseBytes` fallback chain:
 *      responseBytes → encodedResponseBytes → response.encodedBodySize → response.size
 *   - `retryCount ?? 0`
 */
export const normalizeRequest = (raw: unknown): NormalizedNetworkRequest => {
  const request = isRecord(raw) ? raw : {}
  const inner = isRecord(request["request"]) ? (request["request"] as Record<string, unknown>) : {}
  const response = isRecord(request["response"]) ? (request["response"] as Record<string, unknown>) : {}

  const url = String(request["url"] ?? inner["url"] ?? "")
  const parsed = parseUrlParts(url)
  const startedAt = optionalString(request["startedAt"])
  const durationMs = numberOrNull(request["durationMs"])
  const endedAt = optionalString(request["endedAt"] ?? request["completedAt"]) ?? inferEndedAt(startedAt, durationMs)

  const status = numberOrNull(request["status"]) ?? numberOrNull(response["status"])
  const ok =
    typeof request["ok"] === "boolean"
      ? (request["ok"] as boolean)
      : typeof status === "number"
        ? status >= 200 && status < 400
        : undefined

  return {
    id: optionalString(request["id"]) ?? optionalString(request["requestId"]),
    requestId: optionalString(request["requestId"]) ?? optionalString(request["id"]),
    method: optionalString(request["method"]) ?? optionalString(inner["method"]) ?? "GET",
    url,
    origin: parsed.origin,
    path: parsed.path,
    startedAt,
    endedAt,
    durationMs,
    status,
    ok,
    requestBytes: numberOrNull(request["requestBytes"] ?? request["encodedRequestBytes"]),
    responseBytes: numberOrNull(
      request["responseBytes"] ?? request["encodedResponseBytes"] ?? response["encodedBodySize"] ?? response["size"],
    ),
    retryCount: numberOrNull(request["retryCount"]) ?? 0,
    aborted: request["aborted"] === true,
    error: optionalString(request["error"]),
  }
}

/** Normalize a list of raw request rows (AC-045). PURE. */
export const normalizeRequests = (rows: ReadonlyArray<unknown>): ReadonlyArray<NormalizedNetworkRequest> =>
  rows.map(normalizeRequest)

// ──────────────────────────────────────────────────────────────────────────
// Duplicates (AC-045)
// ──────────────────────────────────────────────────────────────────────────

/**
 * Group by `<method> <origin><path|url>`, keep groups with > 1 row, and report
 * `count` / `requestIds` (non-null) / `totalDurationMs` (Σ durationMs). PURE.
 */
export const duplicateGroups = (requests: ReadonlyArray<NormalizedNetworkRequest>): ReadonlyArray<DuplicateGroup> => {
  const groups = new Map<string, Array<NormalizedNetworkRequest>>()
  for (const request of requests) {
    const key = `${request.method} ${request.origin ?? ""}${request.path ?? request.url ?? ""}`
    const group = groups.get(key) ?? []
    group.push(request)
    groups.set(key, group)
  }
  const out: Array<DuplicateGroup> = []
  for (const [key, group] of groups) {
    if (group.length <= 1) {
      continue
    }
    const requestIds: Array<string> = []
    let totalDurationMs = 0
    for (const request of group) {
      const id = request.requestId ?? request.id
      if (id !== null && id !== undefined) {
        requestIds.push(id)
      }
      totalDurationMs += request.durationMs ?? 0
    }
    out.push({ key, count: group.length, requestIds, totalDurationMs })
  }
  return out
}

// ──────────────────────────────────────────────────────────────────────────
// Waterfall (AC-045)
// ──────────────────────────────────────────────────────────────────────────

/**
 * Build the waterfall view from normalized requests (AC-045):
 *   - rank: keep numeric `durationMs`, sort DESC, top 50.
 *   - `slowThresholdMs = 500`; `slowRequestCount` = RANKED rows with durationMs ≥ 500.
 *   - `duplicateGroups` over ALL requests.
 * PURE.
 */
export const buildWaterfall = (requests: ReadonlyArray<NormalizedNetworkRequest>): NetworkWaterfall => {
  const ranked = requests
    .filter((request) => typeof request.durationMs === "number")
    .slice()
    .sort((a, b) => (b.durationMs ?? 0) - (a.durationMs ?? 0))
    .slice(0, WATERFALL_TOP_N)
  return {
    requestCount: requests.length,
    slowThresholdMs: SLOW_THRESHOLD_MS,
    slowRequestCount: ranked.filter((request) => (request.durationMs ?? 0) >= SLOW_THRESHOLD_MS).length,
    rankedRequests: ranked,
    duplicateGroups: duplicateGroups(requests),
  }
}

// ──────────────────────────────────────────────────────────────────────────
// HAR (AC-045) — version "1.2", time = durationMs ?? 0, query+cookies emptied.
// ──────────────────────────────────────────────────────────────────────────

export interface HarEntry {
  readonly startedDateTime: string
  readonly time: number
  readonly request: {
    readonly method: string
    readonly url: string
    readonly headers: Record<string, unknown>
    readonly queryString: ReadonlyArray<never>
    readonly cookies: ReadonlyArray<never>
  }
  readonly response: {
    readonly status: number
    readonly statusText: string
    readonly headers: Record<string, unknown>
    readonly cookies: ReadonlyArray<never>
    readonly content: { readonly size: number; readonly mimeType: string }
  }
}

export interface HarLog {
  readonly version: typeof HAR_VERSION
  readonly creator: { readonly name: string; readonly version: string }
  readonly entries: ReadonlyArray<HarEntry>
}

export interface HarDocument {
  readonly log: HarLog
}

export interface HarCreator {
  readonly name: string
  readonly version: string
}

/**
 * Build a HAR 1.2 document from normalized requests (AC-045). PURE.
 * `startedDateTime` falls back to a caller-supplied `nowIso` when a row has no
 * `startedAt` (keeps the function pure — no `Date.now()` inside).
 */
export const harFromRequests = (
  requests: ReadonlyArray<NormalizedNetworkRequest>,
  creator: HarCreator,
  nowIso: string,
): HarDocument => ({
  log: {
    version: HAR_VERSION,
    creator,
    entries: requests.map(
      (request): HarEntry => ({
        startedDateTime: request.startedAt ?? nowIso,
        time: request.durationMs ?? 0,
        request: {
          method: request.method,
          url: request.url,
          headers: {},
          queryString: [],
          cookies: [],
        },
        response: {
          status: request.status ?? 0,
          statusText: "",
          headers: {},
          cookies: [],
          content: { size: request.responseBytes ?? 0, mimeType: "" },
        },
      }),
    ),
  },
})

/**
 * AC-013 (FIX): resolve a user-supplied HAR `--output-path` UNDER the artifacts
 * root, rejecting `../` / absolute escapes BEFORE any mkdir/write. Delegates to
 * core's `confinePath` (the single confinement authority). Returns the confined
 * absolute path; fails with `PathEscape` on an escape.
 *
 * The legacy `network-evidence` did a bare `path.resolve(args.outputPath ?? …)`
 * with no confinement (CWE-22) — this is exactly that hole, closed.
 */
export const confineHarOutputPath = (artifactsRoot: string, outputPath: string): Effect.Effect<string, PathEscape> =>
  confinePath(artifactsRoot, outputPath)
