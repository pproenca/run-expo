/**
 * AC-004 — runtime-eval (`wait --fn`) needs a flag or policy.
 * AC-035 — wait polls on a bounded cadence until match/timeout.
 *
 * AC-004 runs END-TO-END through core's dispatch with a FAKE
 * `RuntimeEvalCapability` that COUNTS invocations: `wait --fn` with no flag/policy
 * is DENIED and the eval capability is NEVER invoked (0 calls); with the flag (or
 * policy) it runs and invokes eval. A runtime predicate with NO adapter returns
 * the AC-004 unavailable shape WITHOUT invoking eval.
 *
 * AC-035 covers the cadence math directly + a TestClock-driven cadence loop.
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
  resolveMs,
  resolveTimeoutMs,
  resolveWaitIntervalMs,
  tickSleepMs,
  type WaitResult,
  waitCommand,
  waitMode,
  waitSideEffect,
} from "@expo98/handlers-interaction"
import { Effect, Fiber, Layer, Ref, TestClock } from "effect"

// ── AC-035: cadence math ──

describe("AC-035 wait cadence math", () => {
  it("AC-035 timeoutMs = clamp(args.timeoutMs ?? 5000, 0, 60000)", () => {
    expect(resolveTimeoutMs(undefined)).toBe(5_000)
    expect(resolveTimeoutMs(-1)).toBe(0)
    expect(resolveTimeoutMs(10_000)).toBe(10_000)
    expect(resolveTimeoutMs(99_999)).toBe(60_000)
  })

  it("AC-035 intervalMs = min(max(floor(timeoutMs/10), 25), 250)", () => {
    expect(resolveWaitIntervalMs(5_000)).toBe(250) // floor(500)→250 cap
    expect(resolveWaitIntervalMs(100)).toBe(25) // floor(10)→25 floor
    expect(resolveWaitIntervalMs(1_000)).toBe(100) // floor(100)
    expect(resolveWaitIntervalMs(0)).toBe(25)
    expect(resolveWaitIntervalMs(60_000)).toBe(250)
  })

  it("AC-035 ms = clamp(args.ms ?? 0, 0, 60000)", () => {
    expect(resolveMs(undefined)).toBe(0)
    expect(resolveMs(-5)).toBe(0)
    expect(resolveMs(1_500)).toBe(1_500)
    expect(resolveMs(99_999)).toBe(60_000)
  })

  it("AC-035 each tick sleeps min(intervalMs, timeoutMs - elapsed)", () => {
    expect(tickSleepMs(250, 5_000, 0)).toBe(250)
    expect(tickSleepMs(250, 5_000, 4_900)).toBe(100) // near the deadline
    expect(tickSleepMs(250, 5_000, 5_000)).toBe(0)
  })
})

// ── Mode + side-effect classification ──

describe("AC-004 wait mode → side-effect classification", () => {
  it("AC-004 --fn → runtime-eval; --ms / predicate → read", () => {
    expect(waitMode({ fn: "x > 0" })).toBe("fn")
    expect(waitMode({ ms: 100 })).toBe("ms")
    expect(waitMode({ text: "Welcome" })).toBe("predicate")
    expect(waitMode({})).toBe("predicate")
    expect(waitSideEffect("fn")).toBe("runtime-eval")
    expect(waitSideEffect("ms")).toBe("read")
    expect(waitSideEffect("predicate")).toBe("read")
  })
})

// ── AC-004: gating through dispatch ──

const makeCaps = (evalCalls: Ref.Ref<number>) =>
  Layer.mergeAll(
    Layer.succeed(
      RuntimeEvalCapability,
      RuntimeEvalCapability.of({
        evaluate: (expression) =>
          Ref.update(evalCalls, (n) => n + 1)
            .pipe(Effect.as(true))
            .pipe(Effect.tap(() => Effect.sync(() => void expression))),
      }),
    ),
    Layer.succeed(DeviceCapability, DeviceCapability.of({ invoke: () => Effect.succeed("ok") })),
    Layer.succeed(
      SourceWriteCapability,
      SourceWriteCapability.of({
        writeFile: () => Effect.void,
        deleteFile: () => Effect.void,
      }),
    ),
  )

const run = (
  cmd: Command<"read", WaitResult> | Command<"runtime-eval", WaitResult>,
  policy: Parameters<typeof dispatch>[1],
  caps: Layer.Layer<RuntimeEvalCapability | DeviceCapability | SourceWriteCapability>,
): Effect.Effect<DispatchResult<WaitResult>> =>
  dispatch(cmd as Command<SideEffect, WaitResult>, policy).pipe(Effect.provide(caps))

describe("AC-004 wait.fn runtime-eval gate", () => {
  it.effect("AC-004 wait --fn with NO flag and NO policy is DENIED and the eval capability is NEVER invoked", () =>
    Effect.gen(function* () {
      const calls = yield* Ref.make(0)
      const cmd = waitCommand(
        { fn: "globalThis.ready === true" },
        {
          hasRuntimeAdapter: true,
        },
      )
      const result = yield* run(cmd, {}, makeCaps(calls))
      const payload = result.payload as {
        code?: string
        denied?: boolean
        available?: boolean
      }
      expect(payload.code).toBe("policy-denied")
      expect(payload.denied).toBe(true)
      expect(result.exitCode).toBe(EXIT_SUCCESS)
      expect(result.sideEffect).toBe("runtime-eval")
      // THE behavioural assertion: zero eval invocations on denial.
      expect(yield* Ref.get(calls)).toBe(0)
    }),
  )

  it.effect("AC-004 wait --fn WITH --allow-runtime-eval runs and INVOKES eval once", () =>
    Effect.gen(function* () {
      const calls = yield* Ref.make(0)
      const cmd = waitCommand(
        { fn: "globalThis.ready === true" },
        {
          hasRuntimeAdapter: true,
        },
      )
      const result = yield* run(cmd, { allowRuntimeEval: true }, makeCaps(calls))
      const payload = result.payload as { action?: string; matched?: boolean }
      expect(payload.action).toBe("wait.fn")
      expect(payload.matched).toBe(true)
      expect(yield* Ref.get(calls)).toBe(1)
    }),
  )

  it.effect("AC-004 wait --fn allowed by an explicit `wait.fn` policy entry runs and INVOKES eval", () =>
    Effect.gen(function* () {
      const calls = yield* Ref.make(0)
      const cmd = waitCommand({ fn: "true" }, { hasRuntimeAdapter: true })
      const result = yield* run(cmd, { allow: ["wait.fn"] }, makeCaps(calls))
      const payload = result.payload as { action?: string }
      expect(payload.action).toBe("wait.fn")
      expect(yield* Ref.get(calls)).toBe(1)
    }),
  )

  it.effect(
    "AC-004 wait --fn with NO runtime adapter → unavailable shape, eval NEVER invoked (even when allowed)",
    () =>
      Effect.gen(function* () {
        const calls = yield* Ref.make(0)
        const cmd = waitCommand({ fn: "true" }, { hasRuntimeAdapter: false })
        const result = yield* run(cmd, { allowRuntimeEval: true }, makeCaps(calls))
        const payload = result.payload as {
          matched?: boolean
          available?: boolean
          reason?: string
        }
        expect(payload.matched).toBe(false)
        expect(payload.available).toBe(false)
        expect(payload.reason).toBe("Runtime wait predicates require a runtime adapter.")
        // No adapter ⇒ nothing to evaluate ⇒ eval capability untouched.
        expect(yield* Ref.get(calls)).toBe(0)
      }),
  )
})

// ── AC-035: the read paths through dispatch (no policy required) ──

describe("AC-035 wait read paths (ms + predicate cadence)", () => {
  it.effect("AC-035 wait --ms sleeps the clamped duration and reports matched:true", () =>
    Effect.gen(function* () {
      const calls = yield* Ref.make(0)
      const cmd = waitCommand({ ms: 1_500 })
      const fiber = yield* Effect.fork(run(cmd, {}, makeCaps(calls)))
      // TestClock: the sleep does not complete until time is advanced.
      yield* TestClock.adjust("1500 millis")
      const result = yield* Fiber.join(fiber)
      const payload = result.payload as {
        mode?: string
        matched?: boolean
        waitedMs?: number
      }
      expect(payload.mode).toBe("ms")
      expect(payload.matched).toBe(true)
      expect(payload.waitedMs).toBe(1_500)
    }),
  )

  it.effect("AC-035 a predicate that is already true matches WITHOUT sleeping", () =>
    Effect.gen(function* () {
      const calls = yield* Ref.make(0)
      const cmd = waitCommand({ text: "Welcome" }, { predicate: () => Effect.succeed(true) })
      const result = yield* run(cmd, {}, makeCaps(calls))
      const payload = result.payload as {
        mode?: string
        matched?: boolean
        intervalMs?: number
        timeoutMs?: number
      }
      expect(payload.mode).toBe("predicate")
      expect(payload.matched).toBe(true)
      expect(payload.timeoutMs).toBe(5_000)
      expect(payload.intervalMs).toBe(250)
    }),
  )

  it.effect("AC-035 a predicate that flips true after a few ticks matches via the cadence loop", () =>
    Effect.gen(function* () {
      const calls = yield* Ref.make(0)
      const ticks = yield* Ref.make(0)
      // False for the first 3 samples, true thereafter.
      const predicate = () => Ref.updateAndGet(ticks, (n) => n + 1).pipe(Effect.map((n) => n > 3))
      const cmd = waitCommand({ timeoutMs: 5_000 }, { predicate })
      const fiber = yield* Effect.fork(run(cmd, {}, makeCaps(calls)))
      // interval = 250ms; advance enough for >3 samples to occur.
      yield* TestClock.adjust("1000 millis")
      const result = yield* Fiber.join(fiber)
      const payload = result.payload as { matched?: boolean; intervalMs?: number }
      expect(payload.matched).toBe(true)
      expect(payload.intervalMs).toBe(250)
    }),
  )

  it.effect("AC-035 a never-true predicate times out (matched:false) at the deadline", () =>
    Effect.gen(function* () {
      const calls = yield* Ref.make(0)
      const cmd = waitCommand({ timeoutMs: 1_000 }, { predicate: () => Effect.succeed(false) })
      const fiber = yield* Effect.fork(run(cmd, {}, makeCaps(calls)))
      // interval = floor(1000/10)=100ms; advance past the full timeout.
      yield* TestClock.adjust("1000 millis")
      const result = yield* Fiber.join(fiber)
      const payload = result.payload as {
        matched?: boolean
        timeoutMs?: number
        intervalMs?: number
      }
      expect(payload.matched).toBe(false)
      expect(payload.timeoutMs).toBe(1_000)
      expect(payload.intervalMs).toBe(100)
    }),
  )
})
