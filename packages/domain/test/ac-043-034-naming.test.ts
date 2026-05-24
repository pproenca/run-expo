import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import {
  idTimestampSegment,
  makeSessionId,
  makeSnapshotId,
  normalizeSessionName,
  parseDuration
} from "../src/naming.js"

// ===========================================================================
// AC-043 — session name normalisation + duration parse
// ===========================================================================
describe("AC-043 session-name normalisation", () => {
  it("lowercases, replaces illegal runs with -, trims, slices(0,48)", () =>
    Effect.gen(function* () {
      expect(yield* normalizeSessionName("My Review!")).toBe("my-review")
      expect(yield* normalizeSessionName("  Hello   World  ")).toBe("hello-world")
      expect(yield* normalizeSessionName("a__b.c-d")).toBe("a__b.c-d") // _ . - kept
      expect(yield* normalizeSessionName("---trim---")).toBe("trim")
    }).pipe(Effect.runPromise)
  )

  it("defaults to 'review' when undefined", () =>
    Effect.gen(function* () {
      expect(yield* normalizeSessionName(undefined)).toBe("review")
    }).pipe(Effect.runPromise)
  )

  it("caps at 48 chars", () =>
    Effect.gen(function* () {
      const long = "a".repeat(100)
      const out = yield* normalizeSessionName(long)
      expect(out.length).toBe(48)
    }).pipe(Effect.runPromise)
  )

  it("throws (fails) when the normalised name is empty", () =>
    Effect.gen(function* () {
      const result = yield* normalizeSessionName("!!!@@@###").pipe(Effect.either)
      expect(result._tag).toBe("Left")
      if (result._tag === "Left") expect(result.left._tag).toBe("EmptySessionName")
    }).pipe(Effect.runPromise)
  )
})

describe("AC-043 duration parse ^(\\d+)([smhd])$", () => {
  it("parses each unit", () =>
    Effect.gen(function* () {
      expect(yield* parseDuration("30s")).toBe(30_000)
      expect(yield* parseDuration("5m")).toBe(300_000)
      expect(yield* parseDuration("2h")).toBe(7_200_000)
      expect(yield* parseDuration("7d")).toBe(604_800_000)
    }).pipe(Effect.runPromise)
  )

  it("rejects malformed durations", () =>
    Effect.gen(function* () {
      for (const bad of ["7", "d", "7x", "-1d", "1.5h", ""]) {
        const r = yield* parseDuration(bad).pipe(Effect.either)
        expect(r._tag).toBe("Left")
        if (r._tag === "Left") expect(r.left._tag).toBe("InvalidDuration")
      }
    }).pipe(Effect.runPromise)
  )
})

// ===========================================================================
// AC-034 — id format (collision-resistant + single timestamp format)
// ===========================================================================
describe("AC-034 evidence id shape", () => {
  const NOW = "2026-05-24T01:02:03.456Z"

  it("timestamp segment strips : and . (single canonical format)", () => {
    expect(idTimestampSegment(NOW)).toBe("2026-05-24T01-02-03-456Z")
  })

  it("session id = name-<ts>-<suffix>", () => {
    const id = makeSessionId("review", NOW, "abc123")
    expect(id).toBe("review-2026-05-24T01-02-03-456Z-abc123")
  })

  it("snapshot id = snapshot-<ts>-<suffix>", () => {
    const id = makeSnapshotId(NOW, "def456")
    expect(id).toBe("snapshot-2026-05-24T01-02-03-456Z-def456")
    expect(id.startsWith("snapshot-")).toBe(true)
  })

  it("distinct suffixes yield distinct ids at the same instant (collision-resistant)", () => {
    const a = makeSnapshotId(NOW, "000001")
    const b = makeSnapshotId(NOW, "000002")
    expect(a).not.toBe(b)
  })
})
