/**
 * AC-010 — `trace` is runtime-eval, run END-TO-END through core's dispatch gate.
 *
 * These tests drive the REAL `dispatch` with a FAKE `RuntimeEvalCapability` that
 * COUNTS its invocations. The structural guarantee (a read-classed handler can't
 * even name the eval capability) is proven in `trace.type-test.ts`; here we prove
 * the BEHAVIOURAL half: with no policy / no `--allow-runtime-eval` the command is
 * denied AND the fake eval capability is NEVER invoked (zero calls); with the
 * flag (or policy) the handler runs and the eval capability IS invoked.
 */
import { describe, expect, it } from "@effect/vitest"
import { DeviceCapability, dispatch, EXIT_SUCCESS, RuntimeEvalCapability, SourceWriteCapability } from "@expo98/core"
import { traceCommand, type TraceVerb } from "@expo98/handlers-devtools"
import { Effect, Layer, Ref } from "effect"

/** A counting fake eval capability. The Ref records every `evaluate` call. */
const makeCountingCaps = (calls: Ref.Ref<number>) =>
  Layer.mergeAll(
    Layer.succeed(
      RuntimeEvalCapability,
      RuntimeEvalCapability.of({
        evaluate: (expression) => Ref.update(calls, (n) => n + 1).pipe(Effect.as({ ran: expression })),
      }),
    ),
    Layer.succeed(DeviceCapability, DeviceCapability.of({ invoke: () => Effect.succeed("device-ok") })),
    Layer.succeed(
      SourceWriteCapability,
      SourceWriteCapability.of({
        writeFile: () => Effect.void,
        deleteFile: () => Effect.void,
      }),
    ),
  )

const VERBS: ReadonlyArray<TraceVerb> = ["start", "read", "clear", "stop"]

describe("AC-010 trace is runtime-eval through core's gate", () => {
  for (const verb of VERBS) {
    it.effect(
      `AC-010 trace.${verb} with NO policy and NO --allow-runtime-eval is DENIED and the eval capability is NEVER invoked`,
      () =>
        Effect.gen(function* () {
          const calls = yield* Ref.make(0)
          const result = yield* dispatch(traceCommand(verb), {}).pipe(Effect.provide(makeCountingCaps(calls)))
          // Denied: the AC-001/policyDeniedPayload shape, exit 0 (designed-unavailable).
          const payload = result.payload as {
            code?: string
            denied?: boolean
            available?: boolean
          }
          expect(payload.code).toBe("policy-denied")
          expect(payload.denied).toBe(true)
          expect(payload.available).toBe(false)
          expect(result.exitCode).toBe(EXIT_SUCCESS)
          expect(result.sideEffect).toBe("runtime-eval")
          // THE behavioural assertion: zero eval invocations on denial.
          expect(yield* Ref.get(calls)).toBe(0)
        }),
    )
  }

  it.effect("AC-010 trace.start WITH --allow-runtime-eval runs the handler and INVOKES the eval capability", () =>
    Effect.gen(function* () {
      const calls = yield* Ref.make(0)
      const result = yield* dispatch(traceCommand("start"), {
        allowRuntimeEval: true,
      }).pipe(Effect.provide(makeCountingCaps(calls)))
      const payload = result.payload as { action?: string; value?: unknown }
      expect(payload.action).toBe("trace.start")
      expect(result.exitCode).toBe(EXIT_SUCCESS)
      // The eval capability was invoked exactly once.
      expect(yield* Ref.get(calls)).toBe(1)
    }),
  )

  it.effect("AC-010 trace.stop allowed by an explicit policy entry runs and INVOKES the eval capability", () =>
    Effect.gen(function* () {
      const calls = yield* Ref.make(0)
      const result = yield* dispatch(traceCommand("stop"), {
        allow: ["trace.stop"],
      }).pipe(Effect.provide(makeCountingCaps(calls)))
      const payload = result.payload as { action?: string }
      expect(payload.action).toBe("trace.stop")
      expect(yield* Ref.get(calls)).toBe(1)
    }),
  )

  it.effect("AC-010 maxEvents clamps to 1..2000 and metroPort to 1..65535", () =>
    Effect.gen(function* () {
      const calls = yield* Ref.make(0)
      const tooBig = yield* dispatch(traceCommand("start", { maxEvents: 9_999, metroPort: 70_000 }), {
        allowRuntimeEval: true,
      }).pipe(Effect.provide(makeCountingCaps(calls)))
      const tooSmall = yield* dispatch(traceCommand("start", { maxEvents: 0, metroPort: 0 }), {
        allowRuntimeEval: true,
      }).pipe(Effect.provide(makeCountingCaps(calls)))
      const big = tooBig.payload as { maxEvents?: number; metroPort?: number }
      const small = tooSmall.payload as { maxEvents?: number; metroPort?: number }
      expect(big.maxEvents).toBe(2_000)
      expect(big.metroPort).toBe(65_535)
      expect(small.maxEvents).toBe(1)
      expect(small.metroPort).toBe(1)
    }),
  )

  it.effect("AC-010 trace passes the resolved metroPort into the runtime-eval capability", () =>
    Effect.gen(function* () {
      const seen = yield* Ref.make<ReadonlyArray<number | undefined>>([])
      const caps = Layer.mergeAll(
        Layer.succeed(
          RuntimeEvalCapability,
          RuntimeEvalCapability.of({
            evaluate: (_expression, options) =>
              Ref.update(seen, (ports) => [...ports, options?.metroPort]).pipe(Effect.as({ ok: true })),
          }),
        ),
        Layer.succeed(DeviceCapability, DeviceCapability.of({ invoke: () => Effect.succeed("device-ok") })),
        Layer.succeed(
          SourceWriteCapability,
          SourceWriteCapability.of({
            writeFile: () => Effect.void,
            deleteFile: () => Effect.void,
          }),
        ),
      )
      yield* dispatch(traceCommand("start", { metroPort: 19000 }), { allowRuntimeEval: true }).pipe(
        Effect.provide(caps),
      )
      expect(yield* Ref.get(seen)).toEqual([19000])
    }),
  )

  it.skip("AC-010 live trace against a running Hermes patches RAF + commit hook", () => {
    // Requires a running Metro + Hermes target; pure logic is fully covered above
    // with the injected fake eval capability.
  })
})
