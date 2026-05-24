/**
 * Performance findings from fixed thresholds (AC-046). PURE.
 *
 * Re-spec of the legacy `normalizePerfReport` finding logic. The thresholds are
 * exact, fixed numbers (AC-046):
 *   - NETWORK: slow if `durationMs ≥ 500`; severity `high` if ≥ 1000 else `medium`.
 *   - RENDER:  worst commit `≥ 16.7ms` flagged; `high` if ≥ 50 else `medium`.
 *   - FRAMES:  `droppedFrames = frames.droppedFrameCount ?? count(deltaMs > 33.4)`;
 *              flagged if > 0; `high` if ≥ 5 else `medium`.
 *
 * NOTE on the two frame budgets: AC-046's finding thresholds (16.7 / 33.4) are
 * the LEGACY render/frame-jank trigger values and are PRESERVED here verbatim —
 * they are the "is this worth flagging" gates, separate from the AC-047 FPS-calc
 * budgets, which the committee corrected to the exact 16.67/33.33 (Q#18). AC-046
 * was not in the Q#18 correction set, so its 16.7/33.4 stay as the legacy spec.
 */

export type PerfSeverity = "high" | "medium" | "info"

export interface PerfFinding {
  readonly type: "network-latency" | "render-cost" | "frame-jank" | "insufficient-evidence"
  readonly severity: PerfSeverity
  readonly summary: string
}

// AC-046 fixed thresholds (network).
export const NETWORK_SLOW_MS = 500 as const
export const NETWORK_HIGH_MS = 1_000 as const
// AC-046 fixed thresholds (render commit). Legacy 16.7/50 — PRESERVED (not Q#18).
export const RENDER_FLAG_MS = 16.7 as const
export const RENDER_HIGH_MS = 50 as const
// AC-046 fixed thresholds (frame jank). Legacy 33.4 / ≥5 — PRESERVED (not Q#18).
export const FRAME_DROP_MS = 33.4 as const
export const FRAME_HIGH_COUNT = 5 as const

export interface ReportInput {
  readonly requests?: ReadonlyArray<{ readonly durationMs?: number | null }>
  readonly renderCommits?: ReadonlyArray<{
    readonly durationMs?: number | null
    readonly actualDuration?: number | null
  }>
  readonly frames?: ReadonlyArray<{ readonly deltaMs?: number | null }>
  /** When the bridge already reports a dropped-frame count, it WINS over the count(>33.4). */
  readonly droppedFrameCount?: number | null
}

const commitDuration = (commit: {
  readonly durationMs?: number | null
  readonly actualDuration?: number | null
}): number => Number(commit.durationMs ?? commit.actualDuration ?? 0)

/**
 * Derive findings from fixed thresholds (AC-046). Returns the matched findings
 * in evaluation order (network, render, frames); when none match, returns a
 * single `insufficient-evidence` finding (legacy behaviour). PURE.
 */
export const reportFindings = (input: ReportInput): ReadonlyArray<PerfFinding> => {
  const findings: Array<PerfFinding> = []

  // NETWORK — the slowest request ≥ 500 (high if ≥ 1000).
  const slow = (input.requests ?? [])
    .filter((request) => Number(request.durationMs) >= NETWORK_SLOW_MS)
    .slice()
    .sort((a, b) => Number(b.durationMs ?? 0) - Number(a.durationMs ?? 0))
  const worstRequest = slow[0]
  if (worstRequest !== undefined) {
    findings.push({
      type: "network-latency",
      severity: Number(worstRequest.durationMs) >= NETWORK_HIGH_MS ? "high" : "medium",
      summary: "Slow network request exceeded the 500ms latency threshold."
    })
  }

  // RENDER — the worst commit ≥ 16.7 (high if ≥ 50).
  let worstCommitMs = 0
  for (const commit of input.renderCommits ?? []) {
    const ms = commitDuration(commit)
    if (ms > worstCommitMs) {
      worstCommitMs = ms
    }
  }
  if ((input.renderCommits ?? []).length > 0 && worstCommitMs >= RENDER_FLAG_MS) {
    findings.push({
      type: "render-cost",
      severity: worstCommitMs >= RENDER_HIGH_MS ? "high" : "medium",
      summary: "React render commit exceeded one frame budget."
    })
  }

  // FRAMES — droppedFrameCount ?? count(deltaMs > 33.4); flagged if > 0 (high if ≥ 5).
  const droppedFrames =
    typeof input.droppedFrameCount === "number"
      ? input.droppedFrameCount
      : (input.frames ?? []).filter((frame) => Number(frame.deltaMs) > FRAME_DROP_MS).length
  if (droppedFrames > 0) {
    findings.push({
      type: "frame-jank",
      severity: droppedFrames >= FRAME_HIGH_COUNT ? "high" : "medium",
      summary: "Frame samples include dropped or long frames."
    })
  }

  if (findings.length === 0) {
    return [
      {
        type: "insufficient-evidence",
        severity: "info",
        summary: "No bottleneck can be ranked from the available evidence."
      }
    ]
  }
  return findings
}
