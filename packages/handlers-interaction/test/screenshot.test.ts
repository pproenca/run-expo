/**
 * AC-054 — full screenshots scroll/stitch a fixed segment geometry (PURE calc).
 * AC-013 — `screenshot --output-path` is confined under the artifacts root; an
 *          escaping path is rejected via core's `confinePath` BEFORE any device
 *          work / write (run END-TO-END through dispatch with a counting fake
 *          device capability).
 */
import { describe, expect, it } from "@effect/vitest"
import {
  type Command,
  DeviceCapability,
  dispatch,
  type DispatchResult,
  EXIT_RUNTIME_FAILURE,
  EXIT_SUCCESS,
  RuntimeEvalCapability,
  type SideEffect,
  SourceWriteCapability
} from "@expo98/core"
import {
  planFullScreenshot,
  resolveSegmentCount,
  type ScreenshotResult,
  screenshotCommand
} from "@expo98/handlers-interaction"
import { Effect, Layer, Ref } from "effect"

describe("AC-054 full screenshot stitch geometry", () => {
  it("AC-054 segmentCount = clamp(fullSegments ?? segments ?? 3, 1, 12)", () => {
    expect(resolveSegmentCount({})).toBe(3)
    expect(resolveSegmentCount({ segments: 6 })).toBe(6)
    expect(resolveSegmentCount({ fullSegments: 9 })).toBe(9)
    // fullSegments takes precedence over segments.
    expect(resolveSegmentCount({ fullSegments: 4, segments: 99 })).toBe(4)
    expect(resolveSegmentCount({ segments: 0 })).toBe(1)
    expect(resolveSegmentCount({ segments: 99 })).toBe(12)
  })

  it("AC-054 fallback 390×844; startY=round(h*0.82), endY=round(h*0.28), startX=round(w/2)", () => {
    const plan = planFullScreenshot({})
    expect(plan.width).toBe(390)
    expect(plan.height).toBe(844)
    expect(plan.swipe.startX).toBe(195) // round(390/2)
    expect(plan.swipe.startY).toBe(Math.round(844 * 0.82)) // 692
    expect(plan.swipe.endY).toBe(Math.round(844 * 0.28)) // 236
    expect(plan.swipe.endX).toBe(plan.swipe.startX) // vertical swipe
    expect(plan.swipe.startY).toBe(692)
    expect(plan.swipe.endY).toBe(236)
  })

  it("AC-054 explicit dimensions are honoured", () => {
    const plan = planFullScreenshot({ width: 1_000, height: 2_000, segments: 5 })
    expect(plan.segmentCount).toBe(5)
    expect(plan.swipe.startX).toBe(500)
    expect(plan.swipe.startY).toBe(Math.round(2_000 * 0.82))
    expect(plan.swipe.endY).toBe(Math.round(2_000 * 0.28))
  })
})

const ARTIFACTS_ROOT = "/state/artifacts"

const makeCaps = (calls: Ref.Ref<number>) =>
  Layer.mergeAll(
    Layer.succeed(
      DeviceCapability,
      DeviceCapability.of({
        invoke: () => Ref.update(calls, (n) => n + 1).pipe(Effect.as("captured"))
      })
    ),
    Layer.succeed(
      RuntimeEvalCapability,
      RuntimeEvalCapability.of({ evaluate: () => Effect.succeed(null) })
    ),
    Layer.succeed(
      SourceWriteCapability,
      SourceWriteCapability.of({
        writeFile: () => Effect.void,
        deleteFile: () => Effect.void
      })
    )
  )

const run = (
  cmd: Command<"device", ScreenshotResult>,
  policy: Parameters<typeof dispatch>[1],
  caps: Layer.Layer<
    DeviceCapability | RuntimeEvalCapability | SourceWriteCapability
  >
): Effect.Effect<DispatchResult<ScreenshotResult>> =>
  dispatch(cmd as Command<SideEffect, ScreenshotResult>, policy).pipe(
    Effect.provide(caps)
  )

describe("AC-013 screenshot --output-path confinement", () => {
  it.effect("AC-013 an in-root output path is accepted and resolved under the artifacts root", () =>
    Effect.gen(function* () {
      const calls = yield* Ref.make(0)
      const cmd = screenshotCommand(ARTIFACTS_ROOT, {
        outputPath: "shots/home.png"
      })
      const result = yield* run(cmd, { allow: ["screenshot"] }, makeCaps(calls))
      const payload = result.payload as { outputPath?: string; action?: string }
      expect(result.exitCode).toBe(EXIT_SUCCESS)
      expect(payload.action).toBe("screenshot")
      expect(payload.outputPath).toBe("/state/artifacts/shots/home.png")
      // device capture ran once.
      expect(yield* Ref.get(calls)).toBe(1)
    })
  )

  it.effect("AC-013 a `../` escape is REJECTED before any device work (PathEscape → exit 1)", () =>
    Effect.gen(function* () {
      const calls = yield* Ref.make(0)
      const cmd = screenshotCommand(ARTIFACTS_ROOT, {
        outputPath: "../../etc/passwd"
      })
      const result = yield* run(cmd, { allow: ["screenshot"] }, makeCaps(calls))
      // The handler failed with PathEscape → runtime failure envelope, exit 1.
      const payload = result.payload as { ok?: boolean; error?: string }
      expect(result.exitCode).toBe(EXIT_RUNTIME_FAILURE)
      expect(payload.ok).toBe(false)
      // Zero device work — confinement is checked BEFORE the capture.
      expect(yield* Ref.get(calls)).toBe(0)
    })
  )

  it.effect("AC-013 an absolute escape outside the root is REJECTED before any device work", () =>
    Effect.gen(function* () {
      const calls = yield* Ref.make(0)
      const cmd = screenshotCommand(ARTIFACTS_ROOT, {
        outputPath: "/tmp/evil.png"
      })
      const result = yield* run(cmd, { allow: ["screenshot"] }, makeCaps(calls))
      expect(result.exitCode).toBe(EXIT_RUNTIME_FAILURE)
      expect(yield* Ref.get(calls)).toBe(0)
    })
  )

  it.effect("AC-013/AC-005 screenshot is device-gated: denied without policy, zero device work", () =>
    Effect.gen(function* () {
      const calls = yield* Ref.make(0)
      const cmd = screenshotCommand(ARTIFACTS_ROOT, { outputPath: "shots/home.png" })
      const result = yield* run(cmd, {}, makeCaps(calls))
      const payload = result.payload as { code?: string }
      expect(payload.code).toBe("policy-denied")
      expect(yield* Ref.get(calls)).toBe(0)
    })
  )

  it.skip("AC-054 live stitch: scroll + capture + stitch on a real simulator", () => {
    // Requires a real simulator; geometry + confinement are fully covered above.
  })
})
