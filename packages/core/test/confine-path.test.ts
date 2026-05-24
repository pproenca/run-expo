import { describe, expect, it } from "@effect/vitest"
import { confinePath, PathEscape } from "@expo98/core"
import { Effect, Exit } from "effect"

const ROOT = "/work/.scratch/expo98/artifacts"

describe("S2 confinePath (AC-013)", () => {
  it.effect("AC-013 a relative child resolves under the root", () =>
    Effect.gen(function* () {
      const resolved = yield* confinePath(ROOT, "screenshots/home.png")
      expect(resolved).toBe(`${ROOT}/screenshots/home.png`)
    })
  )

  it.effect("AC-013 the root itself is allowed", () =>
    Effect.gen(function* () {
      const resolved = yield* confinePath(ROOT, ".")
      expect(resolved).toBe(ROOT)
    })
  )

  it.effect("AC-013 rejects ../ traversal that escapes the root", () =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(confinePath(ROOT, "../../../etc/passwd"))
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const failure = exit.cause
        // the only failure is a PathEscape
        expect(JSON.stringify(failure)).toContain("PathEscape")
      }
    })
  )

  it.effect("AC-013 rejects an absolute escape", () =>
    Effect.gen(function* () {
      const result = yield* Effect.either(confinePath(ROOT, "/etc/passwd"))
      expect(result._tag).toBe("Left")
      if (result._tag === "Left") {
        expect(result.left).toBeInstanceOf(PathEscape)
      }
    })
  )

  it.effect("AC-013 rejects a sibling-prefix path (no separator-boundary bypass)", () =>
    Effect.gen(function* () {
      // /work/.scratch/expo98/artifacts-evil must NOT count as under artifacts
      const result = yield* Effect.either(confinePath(ROOT, "/work/.scratch/expo98/artifacts-evil/x"))
      expect(result._tag).toBe("Left")
    })
  )

  it.effect("AC-013 normalises interior ../ that stays inside the root", () =>
    Effect.gen(function* () {
      const resolved = yield* confinePath(ROOT, "a/b/../c.png")
      expect(resolved).toBe(`${ROOT}/a/c.png`)
    })
  )
})
