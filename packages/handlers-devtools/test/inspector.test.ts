/**
 * AC-011 — `inspector` mutating actions are gated; reads run ungated.
 *
 * Run END-TO-END through core's dispatch with FAKE eval + device capabilities
 * that COUNT invocations:
 *   - mutating verbs (`install-comment-menu`/`clear-comments`/`toggle`) → DENIED
 *     without policy, and the eval capability is NEVER invoked (zero calls).
 *   - read verbs (`probe`/`read-comments`)                             → run ungated.
 *   - `open-dev-menu`                                                  → device-gated.
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
  SourceWriteCapability
} from "@expo98/core"
import {
  inspectorCommand,
  type InspectorResult,
  inspectorSideEffect
} from "@expo98/handlers-devtools"
import { Effect, Layer, Ref } from "effect"

interface Counters {
  readonly evalCalls: Ref.Ref<number>
  readonly deviceCalls: Ref.Ref<number>
}

const makeCaps = (c: Counters) =>
  Layer.mergeAll(
    Layer.succeed(
      RuntimeEvalCapability,
      RuntimeEvalCapability.of({
        evaluate: (expression) =>
          Ref.update(c.evalCalls, (n) => n + 1).pipe(Effect.as({ ran: expression }))
      })
    ),
    Layer.succeed(
      DeviceCapability,
      DeviceCapability.of({
        invoke: (tool, args) =>
          Ref.update(c.deviceCalls, (n) => n + 1).pipe(
            Effect.as([tool, ...args].join(" "))
          )
      })
    ),
    Layer.succeed(
      SourceWriteCapability,
      SourceWriteCapability.of({
        writeFile: () => Effect.void,
        deleteFile: () => Effect.void
      })
    )
  )

const makeCounters = Effect.all({
  evalCalls: Ref.make(0),
  deviceCalls: Ref.make(0)
})

/**
 * The union returned by `inspectorCommand` carries the per-verb class on its
 * descriptor; widen to the dispatch input type after narrowing so a single
 * `dispatch` call serves any verb in the test.
 */
const run = (
  cmd: Command<SideEffect, InspectorResult>,
  policy: Parameters<typeof dispatch>[1],
  caps: Layer.Layer<
    RuntimeEvalCapability | DeviceCapability | SourceWriteCapability
  >
): Effect.Effect<DispatchResult<InspectorResult>> =>
  dispatch(cmd, policy).pipe(Effect.provide(caps))

describe("AC-011 inspector mutating actions gated; reads ungated", () => {
  for (const verb of ["install-comment-menu", "clear-comments", "toggle"] as const) {
    it.effect(
      `AC-011 inspector ${verb} with NO policy is DENIED and the eval capability is NEVER invoked`,
      () =>
        Effect.gen(function* () {
          const c = yield* makeCounters
          expect(inspectorSideEffect(verb)).toBe("runtime-eval")
          const cmd = inspectorCommand(verb) as Command<SideEffect, InspectorResult>
          const result = yield* run(cmd, {}, makeCaps(c))
          const payload = result.payload as { code?: string; denied?: boolean }
          expect(payload.code).toBe("policy-denied")
          expect(payload.denied).toBe(true)
          expect(result.exitCode).toBe(EXIT_SUCCESS)
          // THE behavioural assertion: zero eval invocations on denial.
          expect(yield* Ref.get(c.evalCalls)).toBe(0)
        })
    )
  }

  it.effect("AC-011 inspector toggle WITH policy allow runs and INVOKES the eval capability", () =>
    Effect.gen(function* () {
      const c = yield* makeCounters
      const cmd = inspectorCommand("toggle") as Command<SideEffect, InspectorResult>
      const result = yield* run(cmd, { allow: ["inspector.toggle"] }, makeCaps(c))
      const payload = result.payload as { action?: string }
      expect(payload.action).toBe("inspector.toggle")
      expect(yield* Ref.get(c.evalCalls)).toBe(1)
    })
  )

  it.effect("AC-011 inspector install-comment-menu allowed by --allow-runtime-eval runs", () =>
    Effect.gen(function* () {
      const c = yield* makeCounters
      const cmd = inspectorCommand("install-comment-menu") as Command<
        SideEffect,
        InspectorResult
      >
      const result = yield* run(cmd, { allowRuntimeEval: true }, makeCaps(c))
      const payload = result.payload as { action?: string }
      expect(payload.action).toBe("inspector.install-comment-menu")
      expect(yield* Ref.get(c.evalCalls)).toBe(1)
    })
  )

  for (const verb of ["probe", "read-comments"] as const) {
    it.effect(`AC-011 inspector ${verb} is classified read and runs UNGATED (no policy)`, () =>
      Effect.gen(function* () {
        const c = yield* makeCounters
        expect(inspectorSideEffect(verb)).toBe("read")
        const cmd = inspectorCommand(verb) as Command<SideEffect, InspectorResult>
        const result = yield* run(cmd, {}, makeCaps(c))
        const payload = result.payload as {
          action?: string
          sideEffect?: string
          code?: string
        }
        // A read runs with no policy — NOT denied.
        expect(payload.code).not.toBe("policy-denied")
        expect(payload.action).toBe(`inspector.${verb}`)
        expect(payload.sideEffect).toBe("read")
        expect(result.sideEffect).toBe("read")
        // Reads neither touch eval nor device.
        expect(yield* Ref.get(c.evalCalls)).toBe(0)
        expect(yield* Ref.get(c.deviceCalls)).toBe(0)
      })
    )
  }

  it.effect("AC-011 inspector open-dev-menu is device-gated: DENIED without policy, zero device work", () =>
    Effect.gen(function* () {
      const c = yield* makeCounters
      expect(inspectorSideEffect("open-dev-menu")).toBe("device")
      const cmd = inspectorCommand("open-dev-menu") as Command<SideEffect, InspectorResult>
      const result = yield* run(cmd, {}, makeCaps(c))
      const payload = result.payload as { code?: string }
      expect(payload.code).toBe("policy-denied")
      expect(yield* Ref.get(c.deviceCalls)).toBe(0)
    })
  )

  it.effect("AC-011 inspector open-dev-menu WITH policy allow invokes the device capability", () =>
    Effect.gen(function* () {
      const c = yield* makeCounters
      const cmd = inspectorCommand("open-dev-menu") as Command<SideEffect, InspectorResult>
      const result = yield* run(cmd, { allow: ["inspector.open-dev-menu"] }, makeCaps(c))
      const payload = result.payload as { action?: string }
      expect(payload.action).toBe("inspector.open-dev-menu")
      expect(yield* Ref.get(c.deviceCalls)).toBe(1)
      expect(yield* Ref.get(c.evalCalls)).toBe(0)
    })
  )

  it.skip("AC-011 live inspector install-comment-menu against running Hermes writes __CODEX_SIMULATOR_REVIEW__", () => {
    // Requires a running Metro + Hermes target.
  })
})
