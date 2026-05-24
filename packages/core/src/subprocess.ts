import { Context, Effect, Layer } from "effect"
import { SubprocessFailed, SubprocessTimeout, ToolNotFound } from "./errors.js"
import { OUTPUT_BUDGET } from "./truncate.js"

/**
 * S1 — Subprocess service. AC-053.
 *
 * ONE typed boundary over `@effect/platform` `Command` semantics: argv arrays
 * only (NO shell ⇒ no CWE-78 by construction), a per-call timeout and a
 * `maxBuffer`. The class is the interface; the real `@effect/platform-node`
 * executor is wired in the deferred `app` package. A fake lives here for tests.
 *
 * SAFETY INVARIANT (AC-041): the default `maxBuffer` is WELL ABOVE the output
 * truncation budget so capture never clips legitimate tool output before
 * redaction/truncation can run at the boundary.
 */

/** Default per-call I/O buffer — comfortably above the 40,000-char budget. */
export const DEFAULT_MAX_BUFFER = OUTPUT_BUDGET * 10 // 400_000 bytes

/** Default per-call timeout (AC-053 mid-range). */
export const DEFAULT_TIMEOUT_MS = 120_000

export interface RunOptions {
  /** Per-call wall-clock timeout in ms. */
  readonly timeoutMs?: number
  /** Per-call stdout/stderr capture ceiling in bytes. */
  readonly maxBuffer?: number
  /** Working directory for the child. */
  readonly cwd?: string
  /** Extra environment for the child (merged over inherited env). */
  readonly env?: Readonly<Record<string, string>>
}

export interface RunResult {
  readonly tool: string
  readonly args: ReadonlyArray<string>
  readonly stdout: string
  readonly stderr: string
  readonly exitCode: number
}

export interface SubprocessService {
  /**
   * Run `tool` with `args` (NO shell). Resolves with captured output on a
   * zero exit; fails with a typed error otherwise:
   * `ToolNotFound` | `SubprocessTimeout` | `SubprocessFailed`.
   */
  readonly run: (
    tool: string,
    args: ReadonlyArray<string>,
    options?: RunOptions
  ) => Effect.Effect<RunResult, ToolNotFound | SubprocessTimeout | SubprocessFailed>
}

export class Subprocess extends Context.Tag("@expo98/core/Subprocess")<
  Subprocess,
  SubprocessService
>() {}

/** A scripted response for the test fake, keyed by `"<tool> <args...>"`. */
export type FakeResponse =
  | { readonly _tag: "ok"; readonly stdout: string; readonly stderr?: string }
  | { readonly _tag: "notFound" }
  | { readonly _tag: "timeout"; readonly timeoutMs: number }
  | { readonly _tag: "failed"; readonly exitCode: number; readonly stderr: string }

export const fakeKey = (
  tool: string,
  args: ReadonlyArray<string>
): string => [tool, ...args].join(" ")

/**
 * Deterministic in-memory fake of S1 for tests. Unmatched invocations fail
 * closed with `ToolNotFound` rather than succeeding silently.
 */
export const SubprocessFake = (
  responses: ReadonlyMap<string, FakeResponse>
): Layer.Layer<Subprocess> =>
  Layer.succeed(
    Subprocess,
    Subprocess.of({
      run: (tool, args) =>
        Effect.suspend((): Effect.Effect<
          RunResult,
          ToolNotFound | SubprocessTimeout | SubprocessFailed
        > => {
          const response = responses.get(fakeKey(tool, args))
          if (response === undefined) {
            return Effect.fail(new ToolNotFound({ tool }))
          }
          switch (response._tag) {
            case "ok":
              return Effect.succeed({
                tool,
                args,
                stdout: response.stdout,
                stderr: response.stderr ?? "",
                exitCode: 0
              })
            case "notFound":
              return Effect.fail(new ToolNotFound({ tool }))
            case "timeout":
              return Effect.fail(
                new SubprocessTimeout({ tool, timeoutMs: response.timeoutMs })
              )
            case "failed":
              return Effect.fail(
                new SubprocessFailed({
                  tool,
                  exitCode: response.exitCode,
                  stderr: response.stderr
                })
              )
          }
        })
    })
  )
