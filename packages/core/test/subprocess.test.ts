import { describe, expect, it } from "@effect/vitest"
import { DEFAULT_MAX_BUFFER, fakeKey, OUTPUT_BUDGET, Subprocess, SubprocessFake, ToolNotFound } from "@expo98/core"
import { Effect } from "effect"

const responses = new Map([
  [fakeKey("xcrun", ["simctl", "list"]), { _tag: "ok", stdout: "{}" } as const],
  [fakeKey("axe", ["describe-ui"]), { _tag: "failed", exitCode: 3, stderr: "no app" } as const],
])

const TestSubprocess = SubprocessFake(responses)

describe("S1 Subprocess service (AC-053)", () => {
  it("AC-053 default maxBuffer is well above the truncation budget", () => {
    // SAFETY (AC-041): capture must never clip legit output before truncation.
    expect(DEFAULT_MAX_BUFFER).toBeGreaterThan(OUTPUT_BUDGET)
  })

  it.effect("AC-053 argv invocation returns captured output on success", () =>
    Effect.gen(function* () {
      const sp = yield* Subprocess
      const result = yield* sp.run("xcrun", ["simctl", "list"])
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe("{}")
    }).pipe(Effect.provide(TestSubprocess)),
  )

  it.effect("AC-053 unknown tool fails closed with typed ToolNotFound", () =>
    Effect.gen(function* () {
      const sp = yield* Subprocess
      const result = yield* Effect.either(sp.run("does-not-exist", []))
      expect(result._tag).toBe("Left")
      if (result._tag === "Left") {
        expect(result.left).toBeInstanceOf(ToolNotFound)
      }
    }).pipe(Effect.provide(TestSubprocess)),
  )

  it.effect("AC-053 a non-zero exit surfaces a typed SubprocessFailed", () =>
    Effect.gen(function* () {
      const sp = yield* Subprocess
      const result = yield* Effect.either(sp.run("axe", ["describe-ui"]))
      expect(result._tag).toBe("Left")
      if (result._tag === "Left") {
        expect(result.left._tag).toBe("SubprocessFailed")
      }
    }).pipe(Effect.provide(TestSubprocess)),
  )
})
