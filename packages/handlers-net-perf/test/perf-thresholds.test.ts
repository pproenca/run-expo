/**
 * AC-046 — performance findings use fixed network/render/frame thresholds.
 * AC-047 — frame / FPS metrics at the EXACT corrected budgets (Q#18).
 * AC-048 — confidence rollup (all branches) + lowerConfidence.
 *
 * All PURE. The AC-047 tests pin the budget CORRECTION: counts are evaluated at
 * the exact 16.67/33.33, not the legacy 16.7/33.4.
 */
import { describe, expect, it } from "@effect/vitest"
import {
  FRAME_1,
  FRAME_2,
  FRAME_DROP_MS,
  frameDeltaMs,
  frameStats,
  lowerConfidence,
  NETWORK_HIGH_MS,
  NETWORK_SLOW_MS,
  overallConfidence,
  pushFrame,
  RENDER_FLAG_MS,
  RENDER_HIGH_MS,
  reportFindings,
  round1,
  STATS_WINDOW
} from "@expo98/handlers-net-perf"

describe("AC-046 fixed thresholds", () => {
  it("AC-046 constants are exactly the spec values", () => {
    expect(NETWORK_SLOW_MS).toBe(500)
    expect(NETWORK_HIGH_MS).toBe(1000)
    expect(RENDER_FLAG_MS).toBe(16.7)
    expect(RENDER_HIGH_MS).toBe(50)
    expect(FRAME_DROP_MS).toBe(33.4)
  })

  it("AC-046 network: slow ≥ 500 (medium), high ≥ 1000", () => {
    expect(reportFindings({ requests: [{ durationMs: 499 }] })[0]?.type).toBe(
      "insufficient-evidence"
    )
    const medium = reportFindings({ requests: [{ durationMs: 500 }] })
    expect(medium[0]?.type).toBe("network-latency")
    expect(medium[0]?.severity).toBe("medium")
    const high = reportFindings({ requests: [{ durationMs: 1000 }] })
    expect(high[0]?.severity).toBe("high")
  })

  it("AC-046 render: worst commit ≥ 16.7 flagged (high ≥ 50), uses actualDuration fallback", () => {
    expect(reportFindings({ renderCommits: [{ durationMs: 16 }] })[0]?.type).toBe(
      "insufficient-evidence"
    )
    const flagged = reportFindings({ renderCommits: [{ durationMs: 16.7 }] })
    expect(flagged[0]?.type).toBe("render-cost")
    expect(flagged[0]?.severity).toBe("medium")
    const high = reportFindings({ renderCommits: [{ actualDuration: 60 }] })
    expect(high[0]?.severity).toBe("high")
  })

  it("AC-046 frames: droppedFrameCount ?? count(delta > 33.4); flagged > 0 (high ≥ 5)", () => {
    // explicit droppedFrameCount wins.
    const explicit = reportFindings({ droppedFrameCount: 5, frames: [] })
    expect(explicit[0]?.type).toBe("frame-jank")
    expect(explicit[0]?.severity).toBe("high")
    // derived: only deltas STRICTLY greater than 33.4 count.
    const derived = reportFindings({ frames: [{ deltaMs: 33.4 }, { deltaMs: 40 }, { deltaMs: 50 }] })
    expect(derived[0]?.type).toBe("frame-jank")
    expect(derived[0]?.severity).toBe("medium") // 2 dropped (40, 50) → < 5 → medium
    // zero dropped → no frame finding.
    expect(reportFindings({ frames: [{ deltaMs: 10 }] })[0]?.type).toBe("insufficient-evidence")
  })

  it("AC-046 returns insufficient-evidence when nothing crosses a threshold", () => {
    const findings = reportFindings({})
    expect(findings.length).toBe(1)
    expect(findings[0]?.type).toBe("insufficient-evidence")
    expect(findings[0]?.severity).toBe("info")
  })

  it("AC-046 multiple findings appear in order network, render, frames", () => {
    const findings = reportFindings({
      requests: [{ durationMs: 1200 }],
      renderCommits: [{ durationMs: 80 }],
      frames: [{ deltaMs: 34 }, { deltaMs: 34 }, { deltaMs: 34 }, { deltaMs: 34 }, { deltaMs: 34 }]
    })
    expect(findings.map((f) => f.type)).toEqual(["network-latency", "render-cost", "frame-jank"])
    expect(findings[2]?.severity).toBe("high") // 5 dropped → high
  })
})

describe("AC-047 frame / FPS calc at EXACT budgets (Q#18)", () => {
  it("AC-047 budgets are corrected to the EXACT 60fps multiples", () => {
    // The committee fix (Q#18): EXACT 16.67/33.33, not legacy 16.7/33.4.
    expect(FRAME_1).toBe(16.67)
    expect(FRAME_2).toBe(33.33)
  })

  it("AC-047 deltaMs = round((ts − lastTs) * 10) / 10", () => {
    expect(frameDeltaMs(116.66, 100)).toBe(16.7)
    expect(round1(16.666)).toBe(16.7)
    expect(round1(33.349)).toBe(33.3)
  })

  it("AC-047 avgFps = round((1000 / mean(deltaMs)) * 10) / 10", () => {
    // mean = 16.67 → 1000/16.67 = 59.988 → round1 = 60.0
    const stats = frameStats([
      { t: 0, deltaMs: 16.67 },
      { t: 16.67, deltaMs: 16.67 }
    ])
    expect(stats.avgFps).toBe(60)
    // mean of [10,20] = 15 → 1000/15 = 66.666… → 66.7
    expect(
      frameStats([
        { t: 0, deltaMs: 10 },
        { t: 10, deltaMs: 20 }
      ]).avgFps
    ).toBe(66.7)
  })

  it("AC-047 droppedFrameCount = count(delta > 33.33) at the EXACT budget", () => {
    // 33.33 is NOT > 33.33 (not counted); 33.34 IS. The legacy 33.4 would MISS 33.34.
    const stats = frameStats([
      { t: 0, deltaMs: 33.33 },
      { t: 1, deltaMs: 33.34 },
      { t: 2, deltaMs: 50 }
    ])
    expect(stats.droppedFrameCount).toBe(2) // 33.34 and 50
  })

  it("AC-047 longFrameCount = count(delta > 16.67) at the EXACT budget", () => {
    const stats = frameStats([
      { t: 0, deltaMs: 16.67 }, // not > 16.67 → not long
      { t: 1, deltaMs: 16.68 }, // long
      { t: 2, deltaMs: 40 } // long (and dropped)
    ])
    expect(stats.longFrameCount).toBe(2)
  })

  it("AC-047 worstFrameMs = max(deltas)", () => {
    expect(
      frameStats([
        { t: 0, deltaMs: 12 },
        { t: 1, deltaMs: 99 },
        { t: 2, deltaMs: 33 }
      ]).worstFrameMs
    ).toBe(99)
  })

  it("AC-047 empty deltas → nulls and zero counts", () => {
    const stats = frameStats([])
    expect(stats.avgFps).toBeNull()
    expect(stats.worstFrameMs).toBeNull()
    expect(stats.droppedFrameCount).toBe(0)
    expect(stats.longFrameCount).toBe(0)
  })

  it("AC-047 stats computed over the LAST 300 samples only", () => {
    // 400 fast frames then we artificially make the OLDEST 100 huge; they must be ignored.
    const old = Array.from({ length: 100 }, (_, i) => ({ t: i, deltaMs: 1000 }))
    const recent = Array.from({ length: 300 }, (_, i) => ({ t: 100 + i, deltaMs: 16.67 }))
    const stats = frameStats([...old, ...recent])
    expect(stats.sampleCount).toBe(STATS_WINDOW)
    expect(stats.droppedFrameCount).toBe(0) // the 1000ms frames are outside the 300-window
    expect(stats.avgFps).toBe(60)
  })

  it("AC-047 pushFrame retains the newest 1000 and computes delta vs last", () => {
    let frames: ReadonlyArray<{ t: number; deltaMs: number }> = []
    frames = pushFrame(frames, 100) // first → delta 0
    frames = pushFrame(frames, 116.67) // delta = round1(16.67) = 16.7
    expect(frames[0]?.deltaMs).toBe(0)
    expect(frames[1]?.deltaMs).toBe(16.7)
    // grow beyond 1000 → retains newest 1000.
    let big: ReadonlyArray<{ t: number; deltaMs: number }> = []
    for (let i = 0; i < 1100; i++) {
      big = pushFrame(big, i)
    }
    expect(big.length).toBe(1000)
    expect(big[big.length - 1]?.t).toBe(1099)
  })
})

describe("AC-048 confidence rollup + lowerConfidence", () => {
  it("AC-048 empty/none → low", () => {
    expect(overallConfidence([])).toBe("low")
    expect(overallConfidence([{ confidence: "low" }, { confidence: "low" }])).toBe("low")
    expect(overallConfidence([{ confidence: "bogus" }])).toBe("low")
  })

  it("AC-048 any high → high (wins over medium/low)", () => {
    expect(overallConfidence([{ confidence: "low" }, { confidence: "high" }])).toBe("high")
    expect(overallConfidence([{ confidence: "medium" }, { confidence: "high" }])).toBe("high")
  })

  it("AC-048 else any medium → medium", () => {
    expect(overallConfidence([{ confidence: "low" }, { confidence: "medium" }])).toBe("medium")
  })

  it("AC-048 lowerConfidence returns the WEAKER of two", () => {
    expect(lowerConfidence("high", "low")).toBe("low")
    expect(lowerConfidence("high", "medium")).toBe("medium")
    expect(lowerConfidence("medium", "high")).toBe("medium")
    expect(lowerConfidence("high", "high")).toBe("high")
    // unknown values normalise to low.
    expect(lowerConfidence("high", "???")).toBe("low")
    expect(lowerConfidence(undefined, "medium")).toBe("low")
  })
})
