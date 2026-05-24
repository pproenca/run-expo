/**
 * Post-launch crash evidence (AC-029 + AC-056) — pure calculation.
 *
 * `launch-app` / `reload-app` complete by driving the device; AFTER the action a
 * grace window elapses and the iOS crash-report directory is scanned. If ≥1 NEW
 * matching `.ips`/`.crash` report appeared AFTER `startedAt`, the launch FAILS
 * CLOSED (`available:false`) — a crash a moment after launch must not be reported
 * as a healthy launch. This module owns the two pure pieces:
 *
 *   - `resolveCrashGraceMs` — AC-056: `clamp(args.waitMs ?? 1000, 0, 30000)`,
 *     DEFAULT 1000ms (the legacy 0ms-grace defect is fixed here).
 *   - `evaluateCrash` — AC-029: given the candidate reports + `startedAt`, decide
 *     matched/unmatched and build the `crashCheck` record verbatim.
 *
 * Only `.ips` and `.crash` files are matched. The actual directory scan is a
 * `device` side-effect performed by the lifecycle handler via the injected
 * `DeviceCapability`; this module never touches the filesystem or a subprocess.
 */

/** AC-056 crash-grace window bounds. */
export const MIN_CRASH_GRACE_MS = 0 as const
export const MAX_CRASH_GRACE_MS = 30_000 as const
export const DEFAULT_CRASH_GRACE_MS = 1_000 as const

/**
 * AC-056: the post-launch grace window. DEFAULT 1000ms (non-zero — the FIX), then
 * `clamp(_, 0, 30000)`. `launch-app` passes `waitMs: args.crashCheckMs`.
 */
export const resolveCrashGraceMs = (waitMs: number | undefined): number => {
  const requested = waitMs ?? DEFAULT_CRASH_GRACE_MS
  return Math.min(Math.max(requested, MIN_CRASH_GRACE_MS), MAX_CRASH_GRACE_MS)
}

/** The lifecycle action a crash check is attached to. */
export type CrashAction = "launch-app" | "reload-app"

/** Only `.ips` / `.crash` reports are matched (AC-029). */
const CRASH_EXTENSIONS: ReadonlyArray<string> = [".ips", ".crash"]

export const isCrashReportPath = (path: string): boolean =>
  CRASH_EXTENSIONS.some((ext) => path.toLowerCase().endsWith(ext))

/** One candidate crash report observed in the iOS report directory. */
export interface CrashReportCandidate {
  readonly path: string
  /** Epoch-ms the report file was written. */
  readonly mtimeMs: number
}

/** AC-029: the `crashCheck` record attached to every launch/reload result. */
export interface CrashCheck {
  readonly action: CrashAction
  readonly bundleId: string
  readonly processName: string
  readonly since: number
  readonly waitedMs: number
  readonly reportCount: number
}

/** A matched crash report surfaced alongside the failing launch. */
export interface CrashReport {
  readonly path: string
  readonly mtimeMs: number
}

export interface CrashEvaluation {
  /** False iff ≥1 matching report appeared after `startedAt` (fail-closed). */
  readonly available: boolean
  readonly reason: string | null
  readonly crashCheck: CrashCheck
  readonly crashReports: ReadonlyArray<CrashReport>
}

export interface EvaluateCrashInput {
  readonly action: CrashAction
  readonly bundleId: string
  readonly processName: string
  /** Epoch-ms captured BEFORE the action ran. AC-029 matches reports after this. */
  readonly startedAt: number
  readonly waitedMs: number
  readonly candidates: ReadonlyArray<CrashReportCandidate>
}

/**
 * AC-029: decide the launch/reload outcome from the scanned report directory.
 *
 * A report counts as a crash iff it is a `.ips`/`.crash` file whose mtime is
 * strictly AFTER `startedAt`. When ≥1 matches, the launch FAILS CLOSED:
 * `available:false` with the verbatim reason and the matched reports attached.
 * Otherwise the launch is unchanged and only the `crashCheck` record is attached.
 */
export const evaluateCrash = (input: EvaluateCrashInput): CrashEvaluation => {
  const matched: ReadonlyArray<CrashReport> = input.candidates
    .filter(
      (candidate) =>
        isCrashReportPath(candidate.path) && candidate.mtimeMs > input.startedAt
    )
    .map((candidate) => ({ path: candidate.path, mtimeMs: candidate.mtimeMs }))

  const crashCheck: CrashCheck = {
    action: input.action,
    bundleId: input.bundleId,
    processName: input.processName,
    since: input.startedAt,
    waitedMs: input.waitedMs,
    reportCount: matched.length
  }

  if (matched.length > 0) {
    return {
      available: false,
      reason: `The app generated ${matched.length} matching iOS crash report(s) after ${input.action}.`,
      crashCheck,
      crashReports: matched
    }
  }

  return { available: true, reason: null, crashCheck, crashReports: [] }
}
