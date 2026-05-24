/**
 * AC-036 — ref point actions target the element centre.
 * AC-037 — scroll/gesture plans use signed deltas + clamped defaults (PRESERVE
 *          the swipe→content mapping: "down" subtracts from Y).
 *
 * PURE calculations, tested directly.
 */
import { describe, expect, it } from "@effect/vitest"
import {
  centerOf,
  DEFAULT_DURATION_MS,
  planGesture,
  planScroll,
  pointForBox,
  resolveDurationMs,
  resolveGestureIntervalMs,
  resolveMaxEvents,
  resolveRepeat,
  resolveScrollAmount,
  scrollDelta
} from "@expo98/handlers-interaction"

describe("AC-036 ref point actions target the element centre", () => {
  it("AC-036 point = { x: box.x + box.width/2, y: box.y + box.height/2 }", () => {
    expect(centerOf({ x: 10, y: 20, width: 100, height: 40 })).toEqual({
      x: 60,
      y: 40
    })
    expect(pointForBox({ x: 0, y: 0, width: 20, height: 20 })).toEqual({
      x: 10,
      y: 10
    })
  })

  it("AC-036 a missing box → null (no coordinates computed → unavailable)", () => {
    expect(pointForBox(null)).toBeNull()
  })
})

describe("AC-037 scroll plans: signed deltas + clamped amount", () => {
  it("AC-037 amount = clamp(args.amount ?? args.text ?? 600, 1, 5000)", () => {
    expect(resolveScrollAmount({})).toBe(600)
    expect(resolveScrollAmount({ amount: 1_000 })).toBe(1_000)
    expect(resolveScrollAmount({ text: 250 })).toBe(250)
    // amount takes precedence over text.
    expect(resolveScrollAmount({ amount: 300, text: 9_999 })).toBe(300)
    expect(resolveScrollAmount({ amount: 0 })).toBe(1)
    expect(resolveScrollAmount({ amount: 99_999 })).toBe(5_000)
  })

  it("AC-037 signed deltas: down {0,-a} up {0,+a} left {+a,0} right {-a,0}", () => {
    expect(scrollDelta("down", 600)).toEqual({ x: 0, y: -600 })
    expect(scrollDelta("up", 600)).toEqual({ x: 0, y: 600 })
    expect(scrollDelta("left", 600)).toEqual({ x: 600, y: 0 })
    expect(scrollDelta("right", 600)).toEqual({ x: -600, y: 0 })
  })

  it("AC-037 planScroll carries amount, default origin {200,700}, and signed delta", () => {
    const plan = planScroll("down")
    expect(plan.amount).toBe(600)
    expect(plan.origin).toEqual({ x: 200, y: 700 })
    expect(plan.delta).toEqual({ x: 0, y: -600 })
  })
})

describe("AC-037 gesture plans: clamped defaults + per-kind durations", () => {
  it("AC-037 repeat = clamp(?? 1, 1, 20)", () => {
    expect(resolveRepeat(undefined)).toBe(1)
    expect(resolveRepeat(0)).toBe(1)
    expect(resolveRepeat(5)).toBe(5)
    expect(resolveRepeat(99)).toBe(20)
  })

  it("AC-037 intervalMs = clamp(?? 250, 0, 10000)", () => {
    expect(resolveGestureIntervalMs(undefined)).toBe(250)
    expect(resolveGestureIntervalMs(-1)).toBe(0)
    expect(resolveGestureIntervalMs(500)).toBe(500)
    expect(resolveGestureIntervalMs(99_999)).toBe(10_000)
  })

  it("AC-037 maxEvents = clamp(?? 200, 1, 2000)", () => {
    expect(resolveMaxEvents(undefined)).toBe(200)
    expect(resolveMaxEvents(0)).toBe(1)
    expect(resolveMaxEvents(9_999)).toBe(2_000)
  })

  it("AC-037 default durations: long-press 900, drag 900, swipe 250, tap 80", () => {
    expect(DEFAULT_DURATION_MS["long-press"]).toBe(900)
    expect(DEFAULT_DURATION_MS.drag).toBe(900)
    expect(DEFAULT_DURATION_MS.swipe).toBe(250)
    expect(DEFAULT_DURATION_MS.tap).toBe(80)
    expect(resolveDurationMs("long-press", undefined)).toBe(900)
    expect(resolveDurationMs("swipe", undefined)).toBe(250)
    expect(resolveDurationMs("tap", undefined)).toBe(80)
  })

  it("AC-037 durationMs = clamp(?? default, 1, 30000)", () => {
    expect(resolveDurationMs("tap", 0)).toBe(1)
    expect(resolveDurationMs("drag", 99_999)).toBe(30_000)
    expect(resolveDurationMs("swipe", 400)).toBe(400)
  })

  it("AC-037 planGesture(swipe) ends at the target; long-press ends where it starts", () => {
    const swipe = planGesture("swipe", { x: 10, y: 20, toX: 30, toY: 40 })
    expect(swipe.from).toEqual({ x: 10, y: 20 })
    expect(swipe.to).toEqual({ x: 30, y: 40 })
    expect(swipe.durationMs).toBe(250)

    const longPress = planGesture("long-press", { x: 5, y: 6 })
    expect(longPress.from).toEqual({ x: 5, y: 6 })
    expect(longPress.to).toEqual({ x: 5, y: 6 })
    expect(longPress.durationMs).toBe(900)
  })
})
