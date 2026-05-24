import { Data } from "effect"

/**
 * Domain & usage error taxonomy.
 *
 * Exit-code mapping (AC-015/AC-016) is a *pure* classification over the error
 * tag, deliberately kept here next to the error definitions so the mapping
 * cannot drift from the error set.
 */

/** Invalid CLI usage — mutually-exclusive flags, missing flag values, unknown
 * commands. Always maps to exit code 2. */
export class CliUsageError extends Data.TaggedError("CliUsageError")<{
  readonly message: string
}> {}

/** A runtime/domain failure raised by a handler. Maps to exit code 1. */
export class CliRuntimeError extends Data.TaggedError("CliRuntimeError")<{
  readonly message: string
}> {}

/** A user-supplied artifact path escaped the artifacts root (AC-013). */
export class PathEscape extends Data.TaggedError("PathEscape")<{
  readonly root: string
  readonly candidate: string
  readonly resolved: string
}> {}

/** An external binary was not found on PATH (AC-053 / S1 Subprocess). */
export class ToolNotFound extends Data.TaggedError("ToolNotFound")<{
  readonly tool: string
}> {}

/** A subprocess exceeded its per-call timeout (AC-053). */
export class SubprocessTimeout extends Data.TaggedError("SubprocessTimeout")<{
  readonly tool: string
  readonly timeoutMs: number
}> {}

/** A subprocess exited non-zero. */
export class SubprocessFailed extends Data.TaggedError("SubprocessFailed")<{
  readonly tool: string
  readonly exitCode: number
  readonly stderr: string
}> {}

/** A capability gate denied a state-changing action (AC-001/005/010/011). */
export class PolicyDenied extends Data.TaggedError("PolicyDenied")<{
  readonly action: string
  readonly reason: string
}> {}

/** The union of every error this package can surface to the dispatcher. */
export type DomainError =
  | CliUsageError
  | CliRuntimeError
  | PathEscape
  | ToolNotFound
  | SubprocessTimeout
  | SubprocessFailed
  | PolicyDenied

export const EXIT_SUCCESS = 0
export const EXIT_RUNTIME_FAILURE = 1
export const EXIT_INVALID_USAGE = 2

export type ExitCode = 0 | 1 | 2

/**
 * AC-015/AC-016: `CliUsageError` ⇒ exit 2; any other runtime error ⇒ exit 1.
 *
 * SAFETY INVARIANT: this is a *total* function over `unknown` — anything we
 * cannot positively identify as a usage error is treated as a runtime failure
 * (exit 1), never silently as success.
 */
export const exitCodeForError = (error: unknown): 1 | 2 => {
  if (typeof error === "object" && error !== null && "_tag" in error) {
    return (error as { readonly _tag: unknown })._tag === "CliUsageError"
      ? EXIT_INVALID_USAGE
      : EXIT_RUNTIME_FAILURE
  }
  return EXIT_RUNTIME_FAILURE
}
