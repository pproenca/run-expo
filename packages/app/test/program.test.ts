import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { AppLayer, runProgram } from "run-expo"

/**
 * Integration: run the ASSEMBLED command with a synthetic argv, end-to-end,
 * WITHOUT calling `process.exit` (`runProgram` returns the POSIX exit code as the
 * Effect value). Exercises the full path: pre-parse guard → @effect/cli parse →
 * subcommand handler → resolvePolicy → dispatch → envelope → exit-code mapping.
 *
 * argv is the FULL process form `[node, script, ...args]` (Command.run drops 2).
 */
const NODE = "node"
const SCRIPT = "/abs/run-expo.mjs"
const run = (...args: ReadonlyArray<string>) => runProgram([NODE, SCRIPT, ...args]).pipe(Effect.provide(AppLayer))

describe("Integration — assembled program over synthetic argv", () => {
  it.effect("exit 0 — `version` succeeds through the whole stack", () =>
    Effect.gen(function* () {
      const code = yield* run("version", "--json")
      expect(code).toBe(0)
    }),
  )

  it.effect("exit 0 — `doctor` succeeds", () =>
    Effect.gen(function* () {
      expect(yield* run("doctor", "--json")).toBe(0)
    }),
  )

  it.effect("AC-015 exit 2 — `--json --plain` rejected before parse", () =>
    Effect.gen(function* () {
      expect(yield* run("doctor", "--json", "--plain")).toBe(2)
    }),
  )

  it.effect("AC-016 exit 2 — value flag with no value rejected before parse", () =>
    Effect.gen(function* () {
      expect(yield* run("doctor", "--root")).toBe(2)
    }),
  )

  it.effect("exit 1 — `redact` of a missing file is a runtime failure", () =>
    Effect.gen(function* () {
      // No file in the real FS at this path ⇒ handler runtime error ⇒ exit 1.
      expect(yield* run("redact", "/no/such/expo98-test-file.json", "--json")).toBe(1)
    }),
  )

  it.effect("exit 2 — an unknown command is invalid usage (@effect/cli)", () =>
    Effect.gen(function* () {
      expect(yield* run("definitely-not-a-command")).toBe(2)
    }),
  )
})
