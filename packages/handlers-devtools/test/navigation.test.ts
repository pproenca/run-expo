/**
 * AC-007 — navigation reads ungated; navigation mutations gated.
 *
 * Through core's dispatch: `state` runs ungated (read); `back`/`pop-to-root`/
 * `tab`/`deep-link` are device-gated and DENIED without policy (zero device work).
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
  navigationCommand,
  type NavigationResult,
  navigationSideEffect,
  type NavigationVerb,
} from "@expo98/handlers-devtools"
import { Effect, Layer, Ref } from "effect"

const makeCaps = (deviceCalls: Ref.Ref<number>) =>
  Layer.mergeAll(
    Layer.succeed(
      DeviceCapability,
      DeviceCapability.of({
        invoke: (tool, args) => Ref.update(deviceCalls, (n) => n + 1).pipe(Effect.as([tool, ...args].join(" "))),
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

const run = (
  cmd: Command<SideEffect, NavigationResult>,
  policy: Parameters<typeof dispatch>[1],
  caps: Layer.Layer<RuntimeEvalCapability | DeviceCapability | SourceWriteCapability>,
): Effect.Effect<DispatchResult<NavigationResult>> => dispatch(cmd, policy).pipe(Effect.provide(caps))

describe("AC-007 navigation reads ungated; mutations gated", () => {
  it.effect("AC-007 navigation state is read and runs UNGATED (no policy)", () =>
    Effect.gen(function* () {
      const deviceCalls = yield* Ref.make(0)
      expect(navigationSideEffect("state")).toBe("read")
      const cmd = navigationCommand("state") as Command<SideEffect, NavigationResult>
      const result = yield* run(cmd, {}, makeCaps(deviceCalls))
      const payload = result.payload as { action?: string; code?: string; available?: boolean; value?: unknown }
      expect(payload.code).not.toBe("policy-denied")
      expect(payload.action).toBe("navigation.state")
      expect(payload.available).toBe(false)
      expect(payload.value).toBeNull()
      expect(result.sideEffect).toBe("read")
      expect(yield* Ref.get(deviceCalls)).toBe(0)
    }),
  )

  it.effect("AC-007 navigation state returns supplied read evidence instead of a placeholder route", () =>
    Effect.gen(function* () {
      const deviceCalls = yield* Ref.make(0)
      const state = { route: "/settings", stack: ["/", "/settings"] }
      const cmd = navigationCommand("state", { state }) as Command<SideEffect, NavigationResult>
      const result = yield* run(cmd, {}, makeCaps(deviceCalls))
      const payload = result.payload as { available?: boolean; value?: unknown }
      expect(payload.available).toBe(true)
      expect(payload.value).toEqual(state)
      expect(yield* Ref.get(deviceCalls)).toBe(0)
    }),
  )

  const MUTATIONS: ReadonlyArray<NavigationVerb> = ["back", "pop-to-root", "tab", "deep-link"]

  for (const verb of MUTATIONS) {
    it.effect(`AC-007 navigation ${verb} is device-gated: DENIED without policy, zero device work`, () =>
      Effect.gen(function* () {
        const deviceCalls = yield* Ref.make(0)
        expect(navigationSideEffect(verb)).toBe("device")
        const cmd = navigationCommand(verb) as Command<SideEffect, NavigationResult>
        const result = yield* run(cmd, {}, makeCaps(deviceCalls))
        const payload = result.payload as { code?: string; denied?: boolean }
        expect(payload.code).toBe("policy-denied")
        expect(payload.denied).toBe(true)
        expect(result.exitCode).toBe(EXIT_SUCCESS)
        expect(yield* Ref.get(deviceCalls)).toBe(0)
      }),
    )
  }

  it.effect("AC-007 navigation back WITH policy allow invokes the device capability", () =>
    Effect.gen(function* () {
      const deviceCalls = yield* Ref.make(0)
      const cmd = navigationCommand("back") as Command<SideEffect, NavigationResult>
      const result = yield* run(cmd, { allow: ["navigation.back"] }, makeCaps(deviceCalls))
      const payload = result.payload as { action?: string }
      expect(payload.action).toBe("navigation.back")
      expect(yield* Ref.get(deviceCalls)).toBe(1)
    }),
  )

  it.effect("AC-007 navigation deep-link WITH policy allow invokes the device capability", () =>
    Effect.gen(function* () {
      const deviceCalls = yield* Ref.make(0)
      const cmd = navigationCommand("deep-link", {
        target: "exp://127.0.0.1:8081/--/profile",
      }) as Command<SideEffect, NavigationResult>
      const result = yield* run(cmd, { allow: ["navigation.deep-link"] }, makeCaps(deviceCalls))
      const payload = result.payload as { action?: string }
      expect(payload.action).toBe("navigation.deep-link")
      expect(yield* Ref.get(deviceCalls)).toBe(1)
    }),
  )
})
