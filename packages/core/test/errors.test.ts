import { describe, expect, it } from "@effect/vitest"
import {
  CliRuntimeError,
  CliUsageError,
  EXIT_INVALID_USAGE,
  EXIT_RUNTIME_FAILURE,
  exitCodeForError,
  PathEscape,
} from "@expo98/core"

describe("Error classification → exit codes (AC-015, AC-016)", () => {
  it("AC-015 CliUsageError maps to exit 2 (invalid usage)", () => {
    const err = new CliUsageError({
      message: "--json and --plain are mutually exclusive.",
    })
    expect(exitCodeForError(err)).toBe(EXIT_INVALID_USAGE)
  })

  it("AC-016 a missing-value usage error maps to exit 2", () => {
    const err = new CliUsageError({ message: "--root requires a value." })
    expect(exitCodeForError(err)).toBe(2)
  })

  it("AC-015 a runtime error maps to exit 1", () => {
    const err = new CliRuntimeError({ message: "boom" })
    expect(exitCodeForError(err)).toBe(EXIT_RUNTIME_FAILURE)
  })

  it("AC-015 a non-usage domain error (PathEscape) maps to exit 1", () => {
    const err = new PathEscape({ root: "/r", candidate: "../x", resolved: "/x" })
    expect(exitCodeForError(err)).toBe(1)
  })

  it("AC-015 an unknown thrown value fails closed to exit 1, never 0", () => {
    expect(exitCodeForError("a bare string")).toBe(1)
    expect(exitCodeForError(undefined)).toBe(1)
    expect(exitCodeForError({ not: "a tagged error" })).toBe(1)
  })
})
