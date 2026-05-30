/**
 * AC-005 (interaction subset) + AC-036 — the D7 interaction handlers run through
 * core's dispatch and are device-gated: a denied tap/gesture/ref-action/keyboard/
 * clipboard performs ZERO device work; an allowed one invokes the device. The
 * ref-action centre point (AC-036) is surfaced on the plan.
 */
import { describe, expect, it } from "@effect/vitest"
import {
  type Command,
  DeviceCapability,
  dispatch,
  type DispatchResult,
  EXIT_SUCCESS,
  RuntimeEvalCapability,
  type SideEffect,
  SourceWriteCapability,
} from "@expo98/core"
import {
  clipboardCommand,
  gestureCommand,
  keyboardCommand,
  refActionCommand,
  refActionIsPointAction,
} from "@expo98/handlers-interaction"
import { Effect, Layer, Ref } from "effect"

const makeCaps = (calls: Ref.Ref<ReadonlyArray<string>>) =>
  Layer.mergeAll(
    Layer.succeed(
      DeviceCapability,
      DeviceCapability.of({
        invoke: (tool, args) =>
          Ref.update(calls, (xs) => [...xs, [tool, ...args].join(" ")]).pipe(Effect.as("device-ok")),
      }),
    ),
    Layer.succeed(RuntimeEvalCapability, RuntimeEvalCapability.of({ evaluate: () => Effect.succeed(null) })),
    Layer.succeed(
      SourceWriteCapability,
      SourceWriteCapability.of({
        writeFile: () => Effect.void,
        deleteFile: () => Effect.void,
      }),
    ),
  )

const run = <A>(
  cmd: Command<"device", A>,
  policy: Parameters<typeof dispatch>[1],
  caps: Layer.Layer<DeviceCapability | RuntimeEvalCapability | SourceWriteCapability>,
): Effect.Effect<DispatchResult<A>> => dispatch(cmd as Command<SideEffect, A>, policy).pipe(Effect.provide(caps))

describe("AC-005 interaction handlers are device-gated", () => {
  it.effect("AC-005 tap is DENIED without policy, zero device work", () =>
    Effect.gen(function* () {
      const calls = yield* Ref.make<ReadonlyArray<string>>([])
      const result = yield* run(gestureCommand("tap", { x: 5, y: 6 }), {}, makeCaps(calls))
      const payload = result.payload as { code?: string }
      expect(payload.code).toBe("policy-denied")
      expect((yield* Ref.get(calls)).length).toBe(0)
    }),
  )

  it.effect("AC-005 gesture swipe WITH policy invokes the device with the planned coords", () =>
    Effect.gen(function* () {
      const calls = yield* Ref.make<ReadonlyArray<string>>([])
      const result = yield* run(
        gestureCommand("swipe", { x: 10, y: 20, toX: 30, toY: 40 }),
        { allow: ["gesture"] },
        makeCaps(calls),
      )
      const payload = result.payload as {
        action?: string
        plan?: { durationMs?: number; to?: { x: number; y: number } }
      }
      expect(payload.action).toBe("gesture")
      expect(payload.plan?.durationMs).toBe(250)
      expect(payload.plan?.to).toEqual({ x: 30, y: 40 })
      const seen = yield* Ref.get(calls)
      expect(seen.length).toBe(1)
      expect(seen[0]).toContain("ui gesture swipe 10 20 30 40")
    }),
  )

  it.effect("AC-037 gesture repeat executes every planned repetition", () =>
    Effect.gen(function* () {
      const calls = yield* Ref.make<ReadonlyArray<string>>([])
      const result = yield* run(
        gestureCommand("tap", { x: 10, y: 20, repeat: 3, intervalMs: 0 }),
        { allow: ["gesture"] },
        makeCaps(calls),
      )
      const payload = result.payload as { plan?: { repeat?: number; intervalMs?: number }; value?: unknown }
      expect(payload.plan?.repeat).toBe(3)
      expect(payload.plan?.intervalMs).toBe(0)
      expect(payload.value).toEqual(["device-ok", "device-ok", "device-ok"])
      expect((yield* Ref.get(calls))).toHaveLength(3)
    }),
  )

  it.effect("AC-005 keyboard type is DENIED without policy, zero device work", () =>
    Effect.gen(function* () {
      const calls = yield* Ref.make<ReadonlyArray<string>>([])
      const result = yield* run(keyboardCommand("type", { text: "hello" }), {}, makeCaps(calls))
      const payload = result.payload as { code?: string }
      expect(payload.code).toBe("policy-denied")
      expect((yield* Ref.get(calls)).length).toBe(0)
    }),
  )

  it.effect("AC-005 clipboard write WITH policy invokes the device", () =>
    Effect.gen(function* () {
      const calls = yield* Ref.make<ReadonlyArray<string>>([])
      const result = yield* run(
        clipboardCommand("write", { text: "copied" }),
        { allow: ["clipboard"] },
        makeCaps(calls),
      )
      const payload = result.payload as { action?: string; verb?: string }
      expect(payload.action).toBe("clipboard")
      expect(payload.verb).toBe("write")
      expect((yield* Ref.get(calls)).length).toBe(1)
    }),
  )
})

describe("AC-036 ref-action plans surface the element centre", () => {
  it("AC-036 point-actions vs non-point-actions", () => {
    expect(refActionIsPointAction("long-press")).toBe(true)
    expect(refActionIsPointAction("scroll")).toBe(true)
    expect(refActionIsPointAction("focus")).toBe(false)
    expect(refActionIsPointAction("blur")).toBe(false)
  })

  it.effect("AC-036 a ref-action with a box surfaces point = box centre", () =>
    Effect.gen(function* () {
      const calls = yield* Ref.make<ReadonlyArray<string>>([])
      const result = yield* run(
        refActionCommand("long-press", "@e1", {
          box: { x: 10, y: 20, width: 100, height: 40 },
        }),
        { allow: ["ref.long-press"] },
        makeCaps(calls),
      )
      const payload = result.payload as {
        action?: string
        ref?: string
        point?: { x: number; y: number } | null
      }
      expect(payload.action).toBe("ref.long-press")
      expect(payload.ref).toBe("@e1")
      expect(payload.point).toEqual({ x: 60, y: 40 })
      expect((yield* Ref.get(calls)).length).toBe(1)
    }),
  )

  it.effect("AC-036 a ref-action with NO box surfaces point = null", () =>
    Effect.gen(function* () {
      const calls = yield* Ref.make<ReadonlyArray<string>>([])
      const result = yield* run(
        refActionCommand("focus", "@e2", { box: null }),
        { allow: ["ref.focus"] },
        makeCaps(calls),
      )
      const payload = result.payload as { point?: unknown }
      expect(payload.point).toBeNull()
    }),
  )

  it.effect("AC-037 a scroll ref-action carries the signed scroll plan", () =>
    Effect.gen(function* () {
      const calls = yield* Ref.make<ReadonlyArray<string>>([])
      const result = yield* run(
        refActionCommand("scroll", "@e3", {
          box: { x: 0, y: 0, width: 10, height: 10 },
          direction: "down",
        }),
        { allow: ["ref.scroll"] },
        makeCaps(calls),
      )
      const payload = result.payload as {
        scroll?: { amount?: number; delta?: { x: number; y: number } }
      }
      expect(payload.scroll?.amount).toBe(600)
      expect(payload.scroll?.delta).toEqual({ x: 0, y: -600 })
    }),
  )

  it.effect("AC-005 ref-action denied without policy performs zero device work", () =>
    Effect.gen(function* () {
      const calls = yield* Ref.make<ReadonlyArray<string>>([])
      const result = yield* run(
        refActionCommand("fill", "@e1", {
          box: { x: 0, y: 0, width: 1, height: 1 },
          value: "text",
        }),
        {},
        makeCaps(calls),
      )
      const payload = result.payload as { code?: string }
      expect(payload.code).toBe("policy-denied")
      expect((yield* Ref.get(calls)).length).toBe(0)
    }),
  )
})
