/**
 * Full-screenshot scroll/stitch geometry (AC-054) — pure calculation.
 *
 * A full-page screenshot scrolls the app through a fixed number of segments,
 * capturing each, then stitches them. This module owns the PURE geometry; the
 * screenshot handler (`interaction.ts`) drives the captures via the injected
 * `DeviceCapability` and writes the stitched artifact through `confinePath`.
 *
 * AC-054:
 *   - `segmentCount = clamp(args.fullSegments ?? args.segments ?? 3, 1, 12)`
 *   - fallback device size `390 × 844`
 *   - per-segment swipe: `startX = round(width/2)`, `startY = round(height*0.82)`,
 *     `endY = round(height*0.28)` (≈54% of the viewport advanced per segment).
 */
import { clamp } from "./support.js"

export const MIN_SEGMENTS = 1 as const
export const MAX_SEGMENTS = 12 as const
export const DEFAULT_SEGMENTS = 3 as const

/** Fallback device viewport when the real size is unknown (AC-054). */
export const FALLBACK_WIDTH = 390 as const
export const FALLBACK_HEIGHT = 844 as const

/** Fractions of the viewport the per-segment swipe runs between (AC-054). */
export const START_Y_FRACTION = 0.82 as const
export const END_Y_FRACTION = 0.28 as const

export interface FullScreenshotArgs {
  readonly fullSegments?: number
  readonly segments?: number
  readonly width?: number
  readonly height?: number
}

export interface SegmentSwipe {
  readonly startX: number
  readonly startY: number
  readonly endX: number
  readonly endY: number
}

export interface FullScreenshotPlan {
  readonly segmentCount: number
  readonly width: number
  readonly height: number
  /** The single swipe applied between each captured segment (AC-054). */
  readonly swipe: SegmentSwipe
}

/** AC-054: `segmentCount = clamp(args.fullSegments ?? args.segments ?? 3, 1, 12)`. */
export const resolveSegmentCount = (args: FullScreenshotArgs): number =>
  clamp(
    args.fullSegments ?? args.segments ?? DEFAULT_SEGMENTS,
    MIN_SEGMENTS,
    MAX_SEGMENTS
  )

/**
 * AC-054: compute the full-screenshot plan. `startX = round(width/2)`,
 * `startY = round(height*0.82)`, `endY = round(height*0.28)`; `endX = startX`
 * (a vertical swipe). Falls back to 390×844 when a dimension is missing.
 */
export const planFullScreenshot = (
  args: FullScreenshotArgs = {}
): FullScreenshotPlan => {
  const width = args.width ?? FALLBACK_WIDTH
  const height = args.height ?? FALLBACK_HEIGHT
  const startX = Math.round(width / 2)
  return {
    segmentCount: resolveSegmentCount(args),
    width,
    height,
    swipe: {
      startX,
      startY: Math.round(height * START_Y_FRACTION),
      endX: startX,
      endY: Math.round(height * END_Y_FRACTION)
    }
  }
}
