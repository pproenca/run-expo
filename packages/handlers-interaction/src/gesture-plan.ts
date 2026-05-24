import type { ScreenBox, ScreenPoint } from "@expo98/domain"
import { centerOf } from "@expo98/domain"
/**
 * D7 gesture / scroll plan CALCULATION (AC-036, AC-037) — pure.
 *
 * These helpers compute the device-coordinate plan a gesture/scroll handler then
 * executes via the injected `DeviceCapability`. They are PURE so they can be
 * tested directly (no capability, no dispatch). The handlers in `interaction.ts`
 * call them and pass the result to the device.
 *
 * AC-037 PRESERVE note: scroll "down" SUBTRACTS from Y (a swipe-up gesture moves
 * content down). The math is intentional and preserved verbatim.
 */
import { clamp } from "./support.js"

export type { ScreenBox, ScreenPoint }
export { centerOf }

// ── AC-036 — ref point actions target the element centre ──

/**
 * AC-036: `point = { x: box.x + box.width/2, y: box.y + box.height/2 }`. A
 * missing box → `null` (the caller reports unavailable; no coordinates computed).
 */
export const pointForBox = (box: ScreenBox | null): ScreenPoint | null => (box === null ? null : centerOf(box))

// ── AC-037 — scroll plans use signed deltas + clamped amount ──

export const MIN_SCROLL_AMOUNT = 1 as const
export const MAX_SCROLL_AMOUNT = 5_000 as const
export const DEFAULT_SCROLL_AMOUNT = 600 as const

/** The default scroll origin (centre-ish of a 390×844 device). */
export const DEFAULT_SCROLL_ORIGIN: ScreenPoint = { x: 200, y: 700 }

export type ScrollDirection = "down" | "up" | "left" | "right"

export interface ScrollArgs {
  readonly amount?: number
  /** Some callers pass the amount positionally as `text`; honoured per legacy. */
  readonly text?: number
  readonly origin?: ScreenPoint
}

export interface ScrollPlan {
  readonly direction: ScrollDirection
  readonly amount: number
  readonly origin: ScreenPoint
  readonly delta: ScreenPoint
}

/** AC-037: `amount = clamp(args.amount ?? args.text ?? 600, 1, 5000)`. */
export const resolveScrollAmount = (args: ScrollArgs): number =>
  clamp(args.amount ?? args.text ?? DEFAULT_SCROLL_AMOUNT, MIN_SCROLL_AMOUNT, MAX_SCROLL_AMOUNT)

/**
 * AC-037: signed deltas (PRESERVE the swipe→content mapping):
 *   down  → { x: 0,       y: -amount }
 *   up    → { x: 0,       y: +amount }
 *   left  → { x: +amount, y: 0       }
 *   right → { x: -amount, y: 0       }
 */
export const scrollDelta = (direction: ScrollDirection, amount: number): ScreenPoint => {
  switch (direction) {
    case "down":
      return { x: 0, y: -amount }
    case "up":
      return { x: 0, y: amount }
    case "left":
      return { x: amount, y: 0 }
    case "right":
      return { x: -amount, y: 0 }
  }
}

export const planScroll = (direction: ScrollDirection, args: ScrollArgs = {}): ScrollPlan => {
  const amount = resolveScrollAmount(args)
  return {
    direction,
    amount,
    origin: args.origin ?? DEFAULT_SCROLL_ORIGIN,
    delta: scrollDelta(direction, amount),
  }
}

// ── AC-037 — gesture plans + clamped defaults ──

export type GestureKind = "long-press" | "drag" | "swipe" | "tap"

export const MIN_REPEAT = 1 as const
export const MAX_REPEAT = 20 as const
export const DEFAULT_REPEAT = 1 as const

export const MIN_INTERVAL_MS = 0 as const
export const MAX_INTERVAL_MS = 10_000 as const
export const DEFAULT_INTERVAL_MS = 250 as const

export const MIN_DURATION_MS = 1 as const
export const MAX_DURATION_MS = 30_000 as const

export const MIN_MAX_EVENTS = 1 as const
export const MAX_MAX_EVENTS = 2_000 as const
export const DEFAULT_MAX_EVENTS = 200 as const

/** AC-037: default gesture durations (ms) per kind. */
export const DEFAULT_DURATION_MS: Readonly<Record<GestureKind, number>> = {
  "long-press": 900,
  drag: 900,
  swipe: 250,
  tap: 80,
}

export interface GestureArgs {
  readonly x?: number
  readonly y?: number
  readonly toX?: number
  readonly toY?: number
  readonly repeat?: number
  readonly intervalMs?: number
  readonly durationMs?: number
  readonly maxEvents?: number
}

export interface GesturePlan {
  readonly kind: GestureKind
  readonly from: ScreenPoint
  readonly to: ScreenPoint
  readonly repeat: number
  readonly intervalMs: number
  readonly durationMs: number
  readonly maxEvents: number
}

/** AC-037: `repeat = clamp(args.repeat ?? 1, 1, 20)`. */
export const resolveRepeat = (repeat: number | undefined): number =>
  clamp(repeat ?? DEFAULT_REPEAT, MIN_REPEAT, MAX_REPEAT)

/** AC-037: `intervalMs = clamp(args.intervalMs ?? 250, 0, 10000)`. */
export const resolveIntervalMs = (intervalMs: number | undefined): number =>
  clamp(intervalMs ?? DEFAULT_INTERVAL_MS, MIN_INTERVAL_MS, MAX_INTERVAL_MS)

/** AC-037: `durationMs = clamp(args.durationMs ?? default(kind), 1, 30000)`. */
export const resolveDurationMs = (kind: GestureKind, durationMs: number | undefined): number =>
  clamp(durationMs ?? DEFAULT_DURATION_MS[kind], MIN_DURATION_MS, MAX_DURATION_MS)

/** AC-037: `maxEvents = clamp(args.maxEvents ?? 200, 1, 2000)`. */
export const resolveMaxEvents = (maxEvents: number | undefined): number =>
  clamp(maxEvents ?? DEFAULT_MAX_EVENTS, MIN_MAX_EVENTS, MAX_MAX_EVENTS)

export const planGesture = (kind: GestureKind, args: GestureArgs = {}): GesturePlan => {
  const from: ScreenPoint = { x: args.x ?? 0, y: args.y ?? 0 }
  // A swipe/drag ends at an explicit target; long-press/tap end where they start.
  const to: ScreenPoint = kind === "swipe" || kind === "drag" ? { x: args.toX ?? from.x, y: args.toY ?? from.y } : from
  return {
    kind,
    from,
    to,
    repeat: resolveRepeat(args.repeat),
    intervalMs: resolveIntervalMs(args.intervalMs),
    durationMs: resolveDurationMs(kind, args.durationMs),
    maxEvents: resolveMaxEvents(args.maxEvents),
  }
}
