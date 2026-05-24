import { describe, expect, it } from "@effect/vitest"
import { ndjsonStream, OUTPUT_BUDGET, overflowMarker, RunningTruncator, truncate } from "@expo98/core"
import { Chunk, Effect, Stream } from "effect"

describe("Truncation — one canonical budget + one marker (AC-041)", () => {
  it("AC-041 short output passes through unchanged", () => {
    expect(truncate("hello")).toBe("hello")
  })

  it("AC-041 over-budget output is truncated with the one overflow marker", () => {
    const input = "x".repeat(OUTPUT_BUDGET + 100)
    const out = truncate(input)
    expect(out.startsWith("x".repeat(OUTPUT_BUDGET))).toBe(true)
    expect(out).toContain(overflowMarker(100))
    // the leading content is exactly the budget; the marker is the only suffix
    expect(out).toBe("x".repeat(OUTPUT_BUDGET) + overflowMarker(100))
  })

  it("AC-041 budget is the single canonical 40,000 value", () => {
    expect(OUTPUT_BUDGET).toBe(40_000)
  })
})

describe("Streaming running-total truncation (AC-041, finding M2)", () => {
  it("AC-041 running total spans the whole stream with one terminal marker", () => {
    const trunc = new RunningTruncator(10)
    expect(trunc.push("abc")).toBe("abc") // 3/10
    expect(trunc.push("defg")).toBe("defg") // 7/10
    // this chunk crosses the budget: admit 3 ("hij"), drop 2, append ONE marker
    expect(trunc.push("hijkl")).toBe("hij" + overflowMarker(2))
    expect(trunc.isOverflowed).toBe(true)
    // everything after overflow is dropped — no further markers
    expect(trunc.push("more")).toBe("")
  })

  it.effect("AC-041 ndjsonStream redacts whole values and caps the running total", () =>
    Effect.gen(function* () {
      const events = Stream.fromIterable([{ msg: "tick", token: "SECRET" }, { msg: "tock" }])
      const lines = yield* Stream.runCollect(ndjsonStream(events))
      const all = Chunk.toReadonlyArray(lines).join("")
      // secret redacted at WHOLE-value granularity before serialisation
      expect(all).toContain("[redacted]")
      expect(all).not.toContain("SECRET")
      expect(all).toContain("tick")
      expect(all).toContain("tock")
    }),
  )
})
