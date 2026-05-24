import { describe, expect, it } from "@effect/vitest"
import {
  command,
  type CommandDescriptor,
  DeviceCapability,
  dispatch,
  type DispatchResult,
  EXIT_SUCCESS,
  RuntimeEvalCapability,
  runBatch,
  type RunRecorder,
  SourceWriteCapability,
} from "@expo98/core"
import { Effect, Layer, Ref } from "effect"

// ── Test capability layers (concrete services the deployment "supplies"). ──
const deviceCalls: Array<string> = []
const TestDevice = Layer.succeed(
  DeviceCapability,
  DeviceCapability.of({
    invoke: (tool, args) =>
      Effect.sync(() => {
        deviceCalls.push([tool, ...args].join(" "))
        return "device-ok"
      }),
  }),
)
const TestRuntimeEval = Layer.succeed(
  RuntimeEvalCapability,
  RuntimeEvalCapability.of({ evaluate: () => Effect.succeed("eval-ok") }),
)
const TestSourceWrite = Layer.succeed(
  SourceWriteCapability,
  SourceWriteCapability.of({
    writeFile: () => Effect.void,
    deleteFile: () => Effect.void,
  }),
)
const TestCaps = Layer.mergeAll(TestDevice, TestRuntimeEval, TestSourceWrite)

describe("S6 Dispatch — gate at execution (AC-001)", () => {
  it.effect("AC-001 a denied device command emits the denial payload, exit 0, zero device work", () =>
    Effect.gen(function* () {
      deviceCalls.length = 0
      const cmd = command(
        { action: "launch-app", sideEffect: "device" } as const,
        DeviceCapability.pipe(Effect.flatMap((d) => d.invoke("xcrun", ["launch"]))),
      )
      const result = yield* dispatch(cmd, {}) // empty policy ⇒ deny
      expect(result.exitCode).toBe(EXIT_SUCCESS)
      const payload = result.payload as { code?: string; denied?: boolean }
      expect(payload.code).toBe("policy-denied")
      expect(payload.denied).toBe(true)
      // AC-005: denial performed ZERO device work.
      expect(deviceCalls.length).toBe(0)
    }).pipe(Effect.provide(TestCaps)),
  )

  it.effect("AC-001 an allowed device command runs the handler", () =>
    Effect.gen(function* () {
      deviceCalls.length = 0
      const cmd = command(
        { action: "launch-app", sideEffect: "device" } as const,
        DeviceCapability.pipe(Effect.flatMap((d) => d.invoke("xcrun", ["launch"]))),
      )
      const result = yield* dispatch(cmd, { allow: ["launch-app"] })
      expect(result.exitCode).toBe(EXIT_SUCCESS)
      expect(result.payload).toBe("device-ok")
      expect(deviceCalls).toEqual(["xcrun launch"])
    }).pipe(Effect.provide(TestCaps)),
  )

  it.effect("AC-010 an un-allowed runtime-eval command is denied at execution", () =>
    Effect.gen(function* () {
      const cmd = command(
        { action: "trace", sideEffect: "runtime-eval" } as const,
        RuntimeEvalCapability.pipe(Effect.flatMap((e) => e.evaluate("__trace__()"))),
      )
      const result = yield* dispatch(cmd, {}) // no policy / no flag ⇒ deny
      const payload = result.payload as { code?: string }
      expect(payload.code).toBe("policy-denied")
    }).pipe(Effect.provide(TestCaps)),
  )

  it.effect("AC-010 runtime-eval allowed with --allow-runtime-eval runs the handler", () =>
    Effect.gen(function* () {
      const cmd = command(
        { action: "trace", sideEffect: "runtime-eval" } as const,
        RuntimeEvalCapability.pipe(Effect.flatMap((e) => e.evaluate("__trace__()"))),
      )
      const result = yield* dispatch(cmd, { allowRuntimeEval: true })
      expect(result.payload).toBe("eval-ok")
    }).pipe(Effect.provide(TestCaps)),
  )

  it.effect("AC-003 the boundary redacts a successful read payload", () =>
    Effect.gen(function* () {
      const cmd = command(
        { action: "doctor", sideEffect: "read" } as const,
        Effect.succeed({ ok: true, token: "SECRET" }),
      )
      const result = yield* dispatch(cmd, {})
      const payload = result.payload as { ok: boolean; token: string }
      expect(payload.ok).toBe(true)
      expect(payload.token).toBe("[redacted]")
    }).pipe(Effect.provide(TestCaps)),
  )
})

describe("S6 Dispatch — run-record is observational (AC-025)", () => {
  it.effect("AC-025 a failing recorder does NOT change the exit code", () =>
    Effect.gen(function* () {
      const cmd = command({ action: "doctor", sideEffect: "read" } as const, Effect.succeed({ ok: true }))
      // Recorder whose finish ALWAYS fails — must be swallowed.
      const brokenRecorder: RunRecorder = {
        start: () => Effect.void,
        finish: () => Effect.fail(new Error("EACCES: state dir read-only")),
      }
      const result = yield* dispatch(cmd, {}, brokenRecorder)
      // Already-succeeded command stays exit 0 despite the record write failing.
      expect(result.exitCode).toBe(EXIT_SUCCESS)
    }).pipe(Effect.provide(TestCaps)),
  )

  it.effect("AC-025 the recorder observes start then finish on success", () =>
    Effect.gen(function* () {
      const log = yield* Ref.make<Array<string>>([])
      const cmd = command({ action: "doctor", sideEffect: "read" } as const, Effect.succeed({ ok: true }))
      const recorder: RunRecorder = {
        start: () => Ref.update(log, (l) => [...l, "start"]),
        finish: (o) => Ref.update(log, (l) => [...l, `finish:${o.status}`]),
      }
      yield* dispatch(cmd, {}, recorder)
      expect(yield* Ref.get(log)).toEqual(["start", "finish:completed"])
    }).pipe(Effect.provide(TestCaps)),
  )
})

describe("S6 Dispatch — batch (AC-031)", () => {
  const readCmd = (action: string, succeed: boolean) =>
    command(
      { action, sideEffect: "read" } as CommandDescriptor & { sideEffect: "read" },
      succeed ? Effect.succeed({ action }) : Effect.fail({ _tag: "CliRuntimeError", message: "boom" } as never),
    )

  it.effect("AC-031 steps run serially and bail on first failure", () =>
    Effect.gen(function* () {
      const order: Array<string> = []
      const step = (action: string, succeed: boolean) => ({
        run: dispatch(readCmd(action, succeed), {}).pipe(
          Effect.tap(() => Effect.sync(() => order.push(action))),
        ) as Effect.Effect<DispatchResult<unknown>, never, never>,
      })
      const result = yield* runBatch(
        [step("a", true), step("b", false), step("c", true)],
        true, // bail
      )
      expect(result.failureIndex).toBe(1)
      expect(result.ok).toBe(false)
      // "c" never ran — bailed after the failure at index 1.
      expect(order).toEqual(["a", "b"])
      expect(result.steps.length).toBe(2)
    }).pipe(Effect.provide(TestCaps)),
  )

  it.effect("AC-031 without bail all steps run and exit codes stay isolated", () =>
    Effect.gen(function* () {
      const step = (action: string, succeed: boolean) => ({
        run: dispatch(readCmd(action, succeed), {}) as Effect.Effect<DispatchResult<unknown>, never, never>,
      })
      const result = yield* runBatch([step("a", true), step("b", false), step("c", true)], false)
      expect(result.failureIndex).toBe(1)
      expect(result.steps.length).toBe(3)
      // exit-code isolation: the failing step is exit 1, the others exit 0.
      expect(result.steps[0]?.exitCode).toBe(0)
      expect(result.steps[1]?.exitCode).toBe(1)
      expect(result.steps[2]?.exitCode).toBe(0)
    }).pipe(Effect.provide(TestCaps)),
  )
})
