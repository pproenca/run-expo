/**
 * THE CRUX — capability-injection as a COMPILE-TIME guarantee (AC-010/AC-011).
 *
 * The `@ts-expect-error` lines below are the proof: each marks a line that MUST
 * fail to type-check. If the withholding ever regressed (a read-classed handler
 * could reach a dangerous capability), the marked line would START compiling and
 * `@ts-expect-error` would itself become an error — so `tsc --noEmit` failing is
 * the regression alarm, and `tsc` PASSING confirms the spine holds.
 *
 * This file is also exercised by @effect/vitest with a runtime assertion that the
 * gate denies an un-allowed runtime-eval at execution time (defense in depth).
 */
import { describe, expect, it } from "@effect/vitest"
import {
  command,
  type ConfinedPath,
  DeviceCapability,
  dispatch,
  RuntimeEvalCapability,
  SourceWriteCapability,
} from "@expo98/core"
import { Effect, Layer } from "effect"

// ──────────────────────────────────────────────────────────────────────────
// 1. A `read`-classed handler's R is `never` (CapabilityFor<"read"> = never).
//    Naming ANY dangerous capability inside it is a COMPILE error, because that
//    would widen R beyond `never` and the `command` builder rejects it.
// ──────────────────────────────────────────────────────────────────────────

// Effects that REQUIRE each dangerous capability in their R channel.
const evalEffect = RuntimeEvalCapability.pipe(Effect.flatMap((e) => e.evaluate("danger()")))
const deviceEffect = DeviceCapability.pipe(Effect.flatMap((d) => d.invoke("xcrun", ["boot"])))
const confined = "/x" as ConfinedPath
const writeEffect = SourceWriteCapability.pipe(Effect.flatMap((w) => w.writeFile(confined, "y")))

const readHandlerOk = command(
  { action: "doctor", sideEffect: "read" } as const,
  Effect.succeed({ ok: true }), // R = never — fine
)
void readHandlerOk

// A read handler (R = never) cannot accept a handler that requires a dangerous
// capability — the offending arg is on the line right after each directive.
const readCannotEval = command(
  { action: "doctor", sideEffect: "read" } as const,
  // @ts-expect-error read-classed handler cannot require RuntimeEvalCapability
  evalEffect,
)
void readCannotEval

const readCannotDevice = command(
  { action: "doctor", sideEffect: "read" } as const,
  // @ts-expect-error read-classed handler cannot require DeviceCapability
  deviceEffect,
)
void readCannotDevice

const readCannotWrite = command(
  { action: "doctor", sideEffect: "read" } as const,
  // @ts-expect-error read-classed handler cannot require SourceWriteCapability
  writeEffect,
)
void readCannotWrite

// ──────────────────────────────────────────────────────────────────────────
// 2. A `runtime-eval`-classed handler MAY require RuntimeEvalCapability — and
//    only that one. It still cannot reach device or source-write.
// ──────────────────────────────────────────────────────────────────────────

const evalHandlerOk = command(
  { action: "trace", sideEffect: "runtime-eval" } as const,
  RuntimeEvalCapability.pipe(Effect.flatMap((e) => e.evaluate("__trace__()"))),
)
void evalHandlerOk

// A runtime-eval handler still cannot smuggle the device capability.
const evalCannotDevice = command(
  { action: "trace", sideEffect: "runtime-eval" } as const,
  // @ts-expect-error runtime-eval-classed handler cannot require DeviceCapability
  deviceEffect,
)
void evalCannotDevice

// ──────────────────────────────────────────────────────────────────────────
// 3. A `device`-classed handler MAY require DeviceCapability — and only that.
// ──────────────────────────────────────────────────────────────────────────

const deviceHandlerOk = command(
  { action: "launch-app", sideEffect: "device" } as const,
  DeviceCapability.pipe(Effect.flatMap((d) => d.invoke("xcrun", ["launch"]))),
)
void deviceHandlerOk

const deviceCannotEval = command(
  { action: "launch-app", sideEffect: "device" } as const,
  // @ts-expect-error device-classed handler cannot require RuntimeEvalCapability
  evalEffect,
)
void deviceCannotEval

// ──────────────────────────────────────────────────────────────────────────
// 4. Runtime defense-in-depth: the gate denies an un-allowed runtime-eval even
//    if the capability is supplied to the dispatcher (it never gets provided to
//    the handler because the deny branch short-circuits before provision).
// ──────────────────────────────────────────────────────────────────────────

const TestCaps = Layer.mergeAll(
  Layer.succeed(RuntimeEvalCapability, RuntimeEvalCapability.of({ evaluate: () => Effect.succeed("eval-ran") })),
  Layer.succeed(DeviceCapability, DeviceCapability.of({ invoke: () => Effect.succeed("ran") })),
  Layer.succeed(
    SourceWriteCapability,
    SourceWriteCapability.of({
      writeFile: () => Effect.void,
      deleteFile: () => Effect.void,
    }),
  ),
)

describe("Capability injection — runtime gate (AC-010)", () => {
  it.effect("AC-010 un-allowed runtime-eval is denied even when the capability exists", () =>
    Effect.gen(function* () {
      const result = yield* dispatch(evalHandlerOk, {})
      const payload = result.payload as { code?: string }
      expect(payload.code).toBe("policy-denied")
    }).pipe(Effect.provide(TestCaps)),
  )
})
