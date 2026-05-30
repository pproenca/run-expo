import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { afterAll, vi } from "vitest"
import { AppLayer, runProgram } from "../src/index"

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

const runCaptured = async (
  ...args: ReadonlyArray<string>
): Promise<{ code: number; logs: ReadonlyArray<string>; errors: ReadonlyArray<string> }> => {
  const logs: Array<string> = []
  const errors: Array<string> = []
  const logSpy = vi.spyOn(console, "log").mockImplementation((...parts: ReadonlyArray<unknown>) => {
    logs.push(parts.map(String).join(" "))
  })
  const errorSpy = vi.spyOn(console, "error").mockImplementation((...parts: ReadonlyArray<unknown>) => {
    errors.push(parts.map(String).join(" "))
  })
  try {
    const code = await Effect.runPromise(runProgram([NODE, SCRIPT, ...args]).pipe(Effect.provide(AppLayer)))
    return { code, logs, errors }
  } finally {
    logSpy.mockRestore()
    errorSpy.mockRestore()
  }
}

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

  it("exit 2 — an unknown subcommand in a known family emits a JSON usage error", async () => {
    const result = await runCaptured("--json", "trace", "definitely-not-a-subcommand")
    expect(result.code).toBe(2)
    const envelope = JSON.parse(result.errors.at(-1) ?? "{}") as { ok: boolean; error: string }
    expect(envelope.ok).toBe(false)
    expect(envelope.error).toContain("Unknown subcommand: trace definitely-not-a-subcommand")
  })

  it("plain usage errors are redacted before stderr", async () => {
    const result = await runCaptured("--plain", "trace", "sk-usage-error-secret123")
    expect(result.code).toBe(2)
    const message = result.errors.at(-1) ?? ""
    expect(message).toContain("[redacted]")
    expect(message).not.toContain("sk-usage-error-secret123")
  })

  it("--ndjson emits the final command payload as one event line", async () => {
    const result = await runCaptured("doctor", "--ndjson")
    expect(result.code).toBe(0)
    const event = JSON.parse(result.logs.at(-1) ?? "{}") as { available?: boolean; ok?: boolean }
    expect(event.available).toBe(true)
    expect(event.ok).toBeUndefined()
  })

  it("--allow-runtime-eval is a boolean global before or after the verb", async () => {
    for (const args of [
      ["--json", "--allow-runtime-eval", "trace", "start"],
      ["--json", "trace", "start", "--allow-runtime-eval"],
    ] as const) {
      const result = await runCaptured(...args)
      expect(result.code).toBe(0)
      const envelope = JSON.parse(result.logs.at(-1) ?? "{}") as {
        ok: boolean
        data?: { action?: string; code?: string }
      }
      expect(envelope.ok).toBe(true)
      expect(envelope.data?.action).toBe("trace.start")
      expect(envelope.data?.code).not.toBe("policy-denied")
    }
  })

  it("policy show resolves a named action to its authoritative side-effect class", async () => {
    const result = await runCaptured("--json", "--allow-runtime-eval", "policy", "show", "trace.start")
    expect(result.code).toBe(0)
    const envelope = JSON.parse(result.logs.at(-1) ?? "{}") as {
      ok: boolean
      data?: { denied?: boolean; decision?: string; sideEffect?: string }
    }
    expect(envelope.ok).toBe(true)
    expect(envelope.data?.sideEffect).toBe("runtime-eval")
    expect(envelope.data?.denied).toBe(false)
    expect(envelope.data?.decision).toBe("allow")
  })

  it("policy show resolves wait.fn as runtime-eval", async () => {
    const result = await runCaptured("--json", "--allow-runtime-eval", "policy", "show", "wait.fn")
    expect(result.code).toBe(0)
    const envelope = JSON.parse(result.logs.at(-1) ?? "{}") as {
      ok: boolean
      data?: { denied?: boolean; decision?: string; sideEffect?: string }
    }
    expect(envelope.ok).toBe(true)
    expect(envelope.data?.sideEffect).toBe("runtime-eval")
    expect(envelope.data?.denied).toBe(false)
    expect(envelope.data?.decision).toBe("allow")
  })

  it("wait fn is denied without runtime-eval policy", async () => {
    const result = await runCaptured("--json", "wait", "fn", "true")
    expect(result.code).toBe(0)
    const envelope = JSON.parse(result.logs.at(-1) ?? "{}") as {
      ok: boolean
      data?: { code?: string; denied?: boolean }
    }
    expect(envelope.ok).toBe(true)
    expect(envelope.data?.code).toBe("policy-denied")
    expect(envelope.data?.denied).toBe(true)
  })

  it("--root reaches root-sensitive command builders", async () => {
    const result = await runCaptured("--json", "--root", "/tmp/run-expo-fixture", "sitemap")
    expect(result.code).toBe(0)
    const envelope = JSON.parse(result.logs.at(-1) ?? "{}") as {
      ok: boolean
      data?: { entries?: ReadonlyArray<{ source: string }> }
    }
    expect(envelope.ok).toBe(true)
    expect(envelope.data?.entries?.[0]?.source).toBe("/tmp/run-expo-fixture")
  })

  it("--record writes a redacted terminal run record", async () => {
    const dir = mkdtempSync(join(tmpdir(), "run-expo-record-"))
    try {
      const result = await runCaptured("--json", "--state-dir", dir, "--record", "doctor")
      expect(result.code).toBe(0)
      const files = readdirSync(dir).filter((file) => file.endsWith(".json"))
      expect(files).toHaveLength(1)
      const record = JSON.parse(readFileSync(join(dir, files[0]!), "utf8")) as {
        status?: string
        command?: string
        finishedAt?: string | null
        exitCode?: number | null
        summary?: { available?: boolean; keys?: ReadonlyArray<string> } | null
      }
      expect(record.status).toBe("completed")
      expect(record.command).toBe("doctor")
      expect(record.finishedAt).not.toBeNull()
      expect(record.exitCode).toBe(0)
      expect(record.summary?.available).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
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
    const result = await runCaptured(...args)
    const envelope = JSON.parse(result.logs.at(-1) ?? "{}") as {
      ok: boolean
      data: { denied?: boolean; decision?: string }
    }
    return {
      code: result.code,
      ok: envelope.ok,
      denied: envelope.data?.denied ?? false,
      decision: envelope.data?.decision ?? "",
    }
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
