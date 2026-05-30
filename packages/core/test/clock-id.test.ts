import { describe, expect, it } from "@effect/vitest"
import { formatTimestamp, Id, IdLive, RandomBytes, RandomBytesLive } from "@expo98/core"
import { Effect, Layer, TestClock } from "effect"

// Deterministic randomness so the suffix is fixed under test.
const FixedRandom = Layer.succeed(RandomBytes, RandomBytes.of({ nextSuffix: Effect.succeed("aaaaaaaaaa") }))

const TestId = IdLive.pipe(Layer.provide(FixedRandom))

describe("S3 Clock / Id (AC-034)", () => {
  it("AC-034 single timestamp format is ISO-8601 UTC", () => {
    expect(formatTimestamp(0)).toBe("1970-01-01T00:00:00.000Z")
  })

  it.effect("AC-034 id = prefix-timestamp-suffix, deterministic under TestClock", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(0)
      const id = yield* Effect.flatMap(Id, (svc) => svc.generateId("snapshot"))
      // timestamp portion is filesystem-safe (no ':' or '.')
      expect(id).toBe("snapshot-19700101T000000000Z-aaaaaaaaaa")
    }).pipe(Effect.provide(TestId)),
  )

  it.effect("AC-034 suffix is collision-resistant length (>= 6, fixed 10)", () =>
    Effect.gen(function* () {
      const id = yield* Effect.flatMap(Id, (svc) => svc.generateId("run"))
      const suffix = id.split("-").at(-1) ?? ""
      expect(suffix.length).toBeGreaterThanOrEqual(6)
      expect(suffix.length).toBe(10)
    }).pipe(Effect.provide(TestId)),
  )

  it.effect("AC-034 live suffix is fixed-length lowercase base36", () =>
    Effect.gen(function* () {
      const random = yield* RandomBytes
      const suffix = yield* random.nextSuffix
      expect(suffix).toMatch(/^[0-9a-z]{10}$/)
    }).pipe(Effect.provide(RandomBytesLive)),
  )
})
