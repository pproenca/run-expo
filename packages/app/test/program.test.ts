import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { AppLayer, runProgram } from "run-expo"
import { afterAll, vi } from "vitest"

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

/**
 * Regression: a global flag must bind in EITHER textual position. `@effect/cli`
 * parses a flag into the ROOT scope when it precedes the subcommand and into the
 * SUBCOMMAND scope when it follows — the shell folds both (`mergeGlobals`). The
 * bug this guards: `--action-policy <file>` in the DOCUMENTED pre-verb position
 * was dropped, so the gate fail-closed DENIED a granted action ("taps don't work
 * when they should"). `policy show <action>` surfaces the effective decision as
 * payload data (a denial is still exit 0), so capture stdout and read it.
 */
describe("Integration — --action-policy is position-independent", () => {
  const policyDir = mkdtempSync(join(tmpdir(), "run-expo-policy-"))
  const policyFile = join(policyDir, "tap.json")
  writeFileSync(policyFile, JSON.stringify({ allow: ["tap"] }))
  afterAll(() => rmSync(policyDir, { recursive: true, force: true }))

  /** Run the assembled program over argv, capturing the emitted JSON envelope. */
  const decisionFor = async (
    ...args: ReadonlyArray<string>
  ): Promise<{ code: number; ok: boolean; denied: boolean; decision: string }> => {
    const lines: Array<string> = []
    const spy = vi.spyOn(console, "log").mockImplementation((...parts: ReadonlyArray<unknown>) => {
      lines.push(parts.map(String).join(" "))
    })
    let code: number
    try {
      code = await Effect.runPromise(runProgram([NODE, SCRIPT, ...args]).pipe(Effect.provide(AppLayer)))
    } finally {
      spy.mockRestore()
    }
    const envelope = JSON.parse(lines.at(-1) ?? "{}") as {
      ok: boolean
      data: { denied?: boolean; decision?: string }
    }
    return { code, ok: envelope.ok, denied: envelope.data?.denied ?? false, decision: envelope.data?.decision ?? "" }
  }

  it("grants a policied action with --action-policy BEFORE the verb (the documented position)", async () => {
    const d = await decisionFor("--json", "--action-policy", policyFile, "policy", "show", "tap")
    expect(d.code).toBe(0)
    expect(d.ok).toBe(true)
    expect(d.denied).toBe(false)
    expect(d.decision).toBe("allow")
  })

  it("grants a policied action with --action-policy AFTER the verb", async () => {
    const d = await decisionFor("--json", "policy", "show", "tap", "--action-policy", policyFile)
    expect(d.denied).toBe(false)
    expect(d.decision).toBe("allow")
  })

  it("denies fail-closed when no policy is supplied (control)", async () => {
    const d = await decisionFor("--json", "policy", "show", "tap")
    expect(d.code).toBe(0)
    expect(d.denied).toBe(true)
    expect(d.decision).toBe("deny")
  })
})
