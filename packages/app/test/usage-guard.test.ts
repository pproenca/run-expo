import { describe, expect, it } from "@effect/vitest"
import { exitCodeForError } from "@expo98/core"
import { Effect, Exit } from "effect"
import { assertUsage, VALUE_FLAGS } from "expo98"

/**
 * AC-015 / AC-016 — the CONTRACT TESTS, written FIRST (architecture finding N2).
 *
 * These pin the pre-parse usage guard that fronts `@effect/cli`. The guard is
 * the AUTHORITY for the two validation ACs because, empirically (verified by
 * reading the installed sources):
 *   - `@effect/cli` models `--json`/`--plain` as INDEPENDENT booleans → it never
 *     raises an error for both-present (AC-015 not enforced natively); and
 *   - `@effect/platform`'s `defaultTeardown` maps EVERY failure to exit 1, so
 *     even the `MissingValue` ValidationError `@effect/cli` does raise would be
 *     exit 1, not the contractual exit 2 (AC-016 not enforced natively).
 *
 * So a thin guard yields `CliUsageError`, which `exitCodeForError` maps to 2.
 */

/** Helper: run the guard and return the mapped exit code (0 on pass). */
const usageExit = (argv: ReadonlyArray<string>): Effect.Effect<0 | 1 | 2> =>
  Effect.exit(assertUsage(argv)).pipe(
    Effect.map((exit) => (Exit.isSuccess(exit) ? 0 : exitCodeForError(failure(exit.cause)))),
  )

const failure = (cause: unknown): unknown => {
  // assertUsage only ever fails with a single CliUsageError.
  if (typeof cause === "object" && cause !== null && "error" in cause) {
    return (cause as { error: unknown }).error
  }
  return cause
}

describe("AC-015 — --json and --plain are mutually exclusive (→ exit 2)", () => {
  it.effect("AC-015 both flags present → CliUsageError → exit 2", () =>
    Effect.gen(function* () {
      expect(yield* usageExit(["doctor", "--json", "--plain"])).toBe(2)
    }),
  )

  it.effect("AC-015 either flag alone is valid → exit 0", () =>
    Effect.gen(function* () {
      expect(yield* usageExit(["doctor", "--json"])).toBe(0)
      expect(yield* usageExit(["doctor", "--plain"])).toBe(0)
    }),
  )

  it.effect("AC-015 the usage error message names the conflict", () =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(assertUsage(["--json", "--plain"]))
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const err = failure(exit.cause) as { message?: string }
        expect(err.message).toBe("--json and --plain are mutually exclusive.")
      }
    }),
  )
})

describe("AC-016 — value flags require a value (→ exit 2)", () => {
  it.effect("AC-016 a value flag at end-of-argv with no value → exit 2", () =>
    Effect.gen(function* () {
      for (const flag of VALUE_FLAGS) {
        expect(yield* usageExit(["doctor", flag])).toBe(2)
      }
    }),
  )

  it.effect("AC-016 a value flag followed by another flag → exit 2", () =>
    Effect.gen(function* () {
      expect(yield* usageExit(["doctor", "--root", "--json"])).toBe(2)
      expect(yield* usageExit(["doctor", "--state-dir", "--quiet"])).toBe(2)
    }),
  )

  it.effect("AC-016 an empty inline value (--root=) → exit 2", () =>
    Effect.gen(function* () {
      expect(yield* usageExit(["doctor", "--root="])).toBe(2)
    }),
  )

  it.effect("AC-016 a value flag WITH a value → exit 0", () =>
    Effect.gen(function* () {
      expect(yield* usageExit(["doctor", "--root", "/tmp/proj"])).toBe(0)
      expect(yield* usageExit(["doctor", "--max-output", "1000"])).toBe(0)
      expect(yield* usageExit(["doctor", "--root=/tmp/proj"])).toBe(0)
      expect(yield* usageExit(["bridge", "install", "--confirm-actions", "bridge-install"])).toBe(0)
    }),
  )

  it.effect("AC-016 boolean flags are NOT value flags (no value required)", () =>
    Effect.gen(function* () {
      expect(yield* usageExit(["doctor", "--json"])).toBe(0)
      expect(yield* usageExit(["doctor", "--quiet", "--debug", "--no-color"])).toBe(0)
    }),
  )
})

describe("exit-code mapping 0/1/2 (AC-015/016 via core's exitCodeForError)", () => {
  it("a CliUsageError-shaped error maps to exit 2", () => {
    expect(exitCodeForError({ _tag: "CliUsageError", message: "x" })).toBe(2)
  })
  it("any other error maps to exit 1", () => {
    expect(exitCodeForError({ _tag: "CliRuntimeError", message: "x" })).toBe(1)
    expect(exitCodeForError(new Error("boom"))).toBe(1)
  })
})
