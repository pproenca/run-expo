/**
 * Smoke — the small read commands (`diff`, `ux-context`, `review-next`, `review`).
 *
 * No AC pins their calculation, so these assert the ENVELOPE/SHAPE: each is a
 * `read` command that runs ungated through dispatch (exit 0, sideEffect `read`)
 * and returns its documented result shape.
 */
import { describe, expect, it } from "@effect/vitest"
import { DeviceCapability, dispatch, EXIT_SUCCESS, RuntimeEvalCapability, SourceWriteCapability } from "@expo98/core"
import {
  diffCommand,
  type DiffResult,
  reviewCommand,
  reviewNextCommand,
  type ReviewNextResult,
  type ReviewResult,
  uxContextCommand,
  type UxContextResult,
} from "@expo98/handlers-artifacts"
import { Effect, Layer } from "effect"

const Caps = Layer.mergeAll(
  Layer.succeed(RuntimeEvalCapability, RuntimeEvalCapability.of({ evaluate: () => Effect.succeed(null) })),
  Layer.succeed(DeviceCapability, DeviceCapability.of({ invoke: () => Effect.succeed("ok") })),
  Layer.succeed(
    SourceWriteCapability,
    SourceWriteCapability.of({
      writeFile: () => Effect.void,
      deleteFile: () => Effect.void,
    }),
  ),
)

describe("D12 small read commands (envelope/shape)", () => {
  it.effect("diff with no --baseline is available:false (designed-unavailable)", () =>
    Effect.gen(function* () {
      const result = yield* dispatch(diffCommand("snapshot"), {}).pipe(Effect.provide(Caps))
      expect(result.exitCode).toBe(EXIT_SUCCESS)
      expect(result.sideEffect).toBe("read")
      const payload = result.payload as DiffResult
      expect(payload.kind).toBe("snapshot")
      expect(payload.available).toBe(false)
      expect(payload.changed).toBeNull()
    }),
  )

  it.effect("diff with a --baseline compares candidate vs baseline", () =>
    Effect.gen(function* () {
      const result = yield* dispatch(diffCommand("screenshot", { baseline: "a", candidate: "b" }), {}).pipe(
        Effect.provide(Caps),
      )
      const payload = result.payload as DiffResult
      expect(payload.available).toBe(true)
      expect(payload.changed).toBe(true)
      const same = yield* dispatch(diffCommand("screenshot", { baseline: "a", candidate: "a" }), {}).pipe(
        Effect.provide(Caps),
      )
      expect((same.payload as DiffResult).changed).toBe(false)
    }),
  )

  it.effect("ux-context reflects the --include-* facets in order", () =>
    Effect.gen(function* () {
      const result = yield* dispatch(uxContextCommand({ includeScreenshot: true, includeLogs: true }), {}).pipe(
        Effect.provide(Caps),
      )
      const payload = result.payload as UxContextResult
      expect(payload.includes).toEqual(["screenshot", "logs"])
      expect(payload.facets).toEqual({
        screenshot: true,
        runtime: false,
        hierarchy: false,
        logs: true,
      })
    }),
  )

  it.effect("review-next echoes the --surface/--stage/--issue context as steps", () =>
    Effect.gen(function* () {
      const result = yield* dispatch(reviewNextCommand({ surface: "home", stage: "triage", issue: "BUG-1" }), {}).pipe(
        Effect.provide(Caps),
      )
      const payload = result.payload as ReviewNextResult
      expect(payload.surface).toBe("home")
      expect(payload.stage).toBe("triage")
      expect(payload.issue).toBe("BUG-1")
      expect(payload.steps.length).toBe(3)
    }),
  )

  it.effect("review report/matrix render the captured entries", () =>
    Effect.gen(function* () {
      const report = yield* dispatch(reviewCommand("report", { entries: [{ x: 1 }, { y: 2 }] }), {}).pipe(
        Effect.provide(Caps),
      )
      const payload = report.payload as ReviewResult
      expect(payload.verb).toBe("report")
      expect(payload.entryCount).toBe(2)

      const matrix = yield* dispatch(reviewCommand("matrix"), {}).pipe(Effect.provide(Caps))
      expect((matrix.payload as ReviewResult).verb).toBe("matrix")
      expect((matrix.payload as ReviewResult).entryCount).toBe(0)
    }),
  )
})
