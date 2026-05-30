/**
 * Performance frame / FPS metrics (AC-047). PURE.
 *
 * In the legacy these ran inside injected JS that maintained a ring buffer of
 * per-frame samples; the live capture is the documented read-eval CDP seam (see
 * `support.ts`). Here we PORT the pure math so it can be tested exhaustively
 * against literal frame deltas — no injection, no sockets.
 *
 * AC-047 contract:
 *   - `avgFps = round((1000 / mean(deltaMs)) * 10) / 10`
 *   - `droppedFrameCount = count(delta > FRAME_2)`
 *   - `longFrameCount   = count(delta > FRAME_1)`
 *   - `worstFrameMs     = max(deltas)`
 *   - stats computed over the LAST 300 samples; retain the newest 1000.
 *   - `deltaMs = round((ts − lastTs) * 10) / 10`
 *
 * FRAME-BUDGET CORRECTION (Q#18 / MODERNIZATION_BRIEF §6 — AC-047):
 * the legacy used `16.7` / `33.4`, which are NOT exact 60fps budgets. Per the
 * committee decision (2026-05-24) the greenfield uses the EXACT budgets
 * `FRAME_1 = 16.67` (one 60fps frame) and `FRAME_2 = 33.33` (two frames). The
 * legacy 16.7/33.4 are noted here for traceability; this is a deliberate FIX of
 * a low-impact rounding typo, not a preserve.
 */
import { numberOrNull } from "./support.js"

/** EXACT one-frame budget at 60fps (Q#18). Legacy used 16.7 (rounding typo). */
export const FRAME_1 = 16.67 as const
/** EXACT two-frame budget at 60fps (Q#18). Legacy used 33.4 (rounding typo). */
export const FRAME_2 = 33.33 as const

/** Stats are computed over the most-recent N samples (AC-047). */
export const STATS_WINDOW = 300 as const
/** The ring buffer retains the newest N samples (AC-047). */
export const RETAIN_WINDOW = 1_000 as const

export interface FrameSample {
  /** The frame timestamp (ms). */
  readonly t: number
  /** `round((t − lastT) * 10) / 10`. */
  readonly deltaMs: number
}

export interface FrameStats {
  readonly avgFps: number | null
  readonly worstFrameMs: number | null
  readonly droppedFrameCount: number
  readonly longFrameCount: number
  readonly sampleCount: number
}

/** Round to one decimal place: `round(v * 10) / 10` (AC-047). PURE. */
export const round1 = (value: number): number => Math.round(value * 10) / 10

/**
 * Compute `deltaMs` for a frame given the previous timestamp: `round((ts −
 * lastTs) * 10) / 10` (AC-047). PURE.
 */
export const frameDeltaMs = (ts: number, lastTs: number): number => round1(ts - lastTs)

/**
 * Append a frame to a ring buffer, computing its `deltaMs` against the last
 * retained sample, and truncate to the newest `RETAIN_WINDOW` (AC-047). PURE —
 * returns a NEW array. The very first sample has no predecessor; its delta is 0.
 */
export const pushFrame = (frames: ReadonlyArray<FrameSample>, ts: number): ReadonlyArray<FrameSample> => {
  const last = frames[frames.length - 1]
  const deltaMs = last === undefined ? 0 : frameDeltaMs(ts, last.t)
  const next = [...frames, { t: ts, deltaMs }]
  return next.length > RETAIN_WINDOW ? next.slice(next.length - RETAIN_WINDOW) : next
}

/**
 * Compute frame stats over the LAST `STATS_WINDOW` samples (AC-047). PURE.
 *
 *   - only FINITE deltas are considered.
 *   - `avgFps = round((1000 / mean(delta)) * 10) / 10` (null when no deltas).
 *   - `droppedFrameCount = count(delta > FRAME_2)`; `longFrameCount = count(delta > FRAME_1)`.
 *   - `worstFrameMs = max(delta)` (null when no deltas).
 */
export const frameStats = (frames: ReadonlyArray<FrameSample>): FrameStats => {
  const window = frames.length > STATS_WINDOW ? frames.slice(frames.length - STATS_WINDOW) : frames
  const deltas: Array<number> = []
  for (const frame of window) {
    const delta = numberOrNull(frame.deltaMs)
    if (delta !== null && delta > 0) {
      deltas.push(delta)
    }
  }
  if (deltas.length === 0) {
    return {
      avgFps: null,
      worstFrameMs: null,
      droppedFrameCount: 0,
      longFrameCount: 0,
      sampleCount: 0,
    }
  }
  const mean = deltas.reduce((sum, value) => sum + value, 0) / deltas.length
  return {
    avgFps: round1(1000 / mean),
    worstFrameMs: Math.max(...deltas),
    droppedFrameCount: deltas.filter((delta) => delta > FRAME_2).length,
    longFrameCount: deltas.filter((delta) => delta > FRAME_1).length,
    sampleCount: deltas.length,
  }
}
