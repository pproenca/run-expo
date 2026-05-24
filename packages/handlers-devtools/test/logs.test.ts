/**
 * AC-039 — console/errors limit defaults to 100, clamps to 1..1000, returns last N.
 *
 * `console`/`errors` are pure reads (R = never), so they need no capability and
 * no policy. We assert the clamp + take-last behaviour both as direct command
 * construction and END-TO-END through dispatch (the read path runs ungated).
 */
import { describe, expect, it } from "@effect/vitest"
import {
  DeviceCapability,
  dispatch,
  RuntimeEvalCapability,
  SourceWriteCapability
} from "@expo98/core"
import {
  type LogEntry,
  logsCommand,
  type LogStream,
  resolveLimit
} from "@expo98/handlers-devtools"
import { Effect, Layer } from "effect"

const Caps = Layer.mergeAll(
  Layer.succeed(
    RuntimeEvalCapability,
    RuntimeEvalCapability.of({ evaluate: () => Effect.succeed(null) })
  ),
  Layer.succeed(
    DeviceCapability,
    DeviceCapability.of({ invoke: () => Effect.succeed("ok") })
  ),
  Layer.succeed(
    SourceWriteCapability,
    SourceWriteCapability.of({
      writeFile: () => Effect.void,
      deleteFile: () => Effect.void
    })
  )
)

const entries = (n: number): ReadonlyArray<LogEntry> =>
  Array.from({ length: n }, (_, i) => ({
    level: "log",
    message: `m${i}`,
    timestamp: i
  }))

const STREAMS: ReadonlyArray<LogStream> = ["console", "errors"]

describe("AC-039 console/errors limit clamp + last-N", () => {
  it("AC-039 limit defaults to 100 and clamps to [1, 1000]", () => {
    expect(resolveLimit(undefined)).toBe(100)
    expect(resolveLimit(0)).toBe(1)
    expect(resolveLimit(-5)).toBe(1)
    expect(resolveLimit(50)).toBe(50)
    expect(resolveLimit(1_000)).toBe(1_000)
    expect(resolveLimit(9_999)).toBe(1_000)
  })

  for (const stream of STREAMS) {
    it.effect(`AC-039 ${stream} returns the LAST N entries (default 100)`, () =>
      Effect.gen(function* () {
        const cmd = logsCommand(stream, { entries: entries(250) })
        const result = yield* dispatch(cmd, {}).pipe(Effect.provide(Caps))
        const payload = result.payload as {
          limit: number
          entries: ReadonlyArray<LogEntry>
          action: string
        }
        expect(payload.action).toBe(stream)
        expect(payload.limit).toBe(100)
        expect(payload.entries.length).toBe(100)
        // last-N: the final entry is the newest (m249), the first kept is m150.
        expect(payload.entries[0]?.message).toBe("m150")
        expect(payload.entries[payload.entries.length - 1]?.message).toBe("m249")
      })
    )
  }

  it.effect("AC-039 explicit limit clamps to 1000 and takes the last 1000", () =>
    Effect.gen(function* () {
      const cmd = logsCommand("console", { limit: 9_999, entries: entries(2_500) })
      const result = yield* dispatch(cmd, {}).pipe(Effect.provide(Caps))
      const payload = result.payload as {
        limit: number
        entries: ReadonlyArray<LogEntry>
      }
      expect(payload.limit).toBe(1_000)
      expect(payload.entries.length).toBe(1_000)
      expect(payload.entries[payload.entries.length - 1]?.message).toBe("m2499")
    })
  )

  it.effect("AC-039 fewer entries than the limit returns all of them", () =>
    Effect.gen(function* () {
      const cmd = logsCommand("errors", { limit: 100, entries: entries(7) })
      const result = yield* dispatch(cmd, {}).pipe(Effect.provide(Caps))
      const payload = result.payload as { entries: ReadonlyArray<LogEntry> }
      expect(payload.entries.length).toBe(7)
    })
  )
})
