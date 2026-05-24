/**
 * AC-049 — direction-aware compare (the FIX): an FPS gain is `improved:true`;
 *           a latency drop is `improved:true`; the LEGACY bug (improved =
 *           candidate ≤ baseline) would mark an FPS gain NOT improved — asserted.
 * AC-050 — budget fails closed on a missing metric.
 * AC-051 — memory-leak claim needs ≥2 samples or a native artifact.
 *
 * All PURE.
 */
import { describe, expect, it } from "@effect/vitest"
import {
  comparePerfMetrics,
  evaluateBudget,
  evaluateMemoryEvidence,
  metricDirection,
  type PerfMetricLike,
} from "@expo98/handlers-net-perf"

const metric = (
  name: string,
  value: unknown,
  confidence: unknown = "medium",
  unit: string | null = null,
): PerfMetricLike => ({ name, value, confidence, unit })

describe("AC-049 direction-aware comparison (FIX)", () => {
  it("AC-049 metricDirection: avgFps/throughput/good-counts are higher-is-better", () => {
    expect(metricDirection("avgFps")).toBe("higher-is-better")
    expect(metricDirection("interaction.avgFps")).toBe("higher-is-better")
    expect(metricDirection("network.throughput")).toBe("higher-is-better")
    expect(metricDirection("requestsPerSecond")).toBe("higher-is-better")
    expect(metricDirection("goodFrameCount")).toBe("higher-is-better")
    // everything else lower-is-better.
    expect(metricDirection("network.latencyMs")).toBe("lower-is-better")
    expect(metricDirection("frames.droppedFrameCount")).toBe("lower-is-better")
    expect(metricDirection("native.footprintMb")).toBe("lower-is-better")
  })

  it("AC-049 an FPS GAIN is improved:true (THE FIX — the legacy bug would say false)", () => {
    const baseline = [metric("avgFps", 45)]
    const candidate = [metric("avgFps", 60)] // higher = better
    const [delta] = comparePerfMetrics(baseline, candidate)
    expect(delta?.metric).toBe("avgFps")
    expect(delta?.delta).toBe(15)
    expect(delta?.direction).toBe("higher-is-better")
    // THE FIX:
    expect(delta?.improved).toBe(true)
    // The LEGACY bug was `improved = candidate <= baseline` → 60 <= 45 → false.
    // Assert our result DIVERGES from that defect.
    const legacyBuggyImproved = (candidate[0]!.value as number) <= (baseline[0]!.value as number)
    expect(legacyBuggyImproved).toBe(false)
    expect(delta?.improved).not.toBe(legacyBuggyImproved)
  })

  it("AC-049 an FPS REGRESSION is improved:false", () => {
    const [delta] = comparePerfMetrics([metric("avgFps", 60)], [metric("avgFps", 45)])
    expect(delta?.improved).toBe(false)
    expect(delta?.delta).toBe(-15)
  })

  it("AC-049 a latency DROP is improved:true (lower-is-better)", () => {
    const [delta] = comparePerfMetrics([metric("network.latencyMs", 800)], [metric("network.latencyMs", 300)])
    expect(delta?.direction).toBe("lower-is-better")
    expect(delta?.improved).toBe(true)
    expect(delta?.delta).toBe(-500)
  })

  it("AC-049 a latency INCREASE is improved:false", () => {
    const [delta] = comparePerfMetrics([metric("network.latencyMs", 300)], [metric("network.latencyMs", 800)])
    expect(delta?.improved).toBe(false)
  })

  it("AC-049 NO CHANGE is not improved under either direction (corrects legacy `<=`)", () => {
    const fps = comparePerfMetrics([metric("avgFps", 60)], [metric("avgFps", 60)])
    expect(fps[0]?.improved).toBe(false)
    const lat = comparePerfMetrics([metric("network.latencyMs", 300)], [metric("network.latencyMs", 300)])
    expect(lat[0]?.improved).toBe(false)
  })

  it("AC-049 delta = candidate − baseline; confidence = lowerConfidence", () => {
    const [delta] = comparePerfMetrics(
      [metric("network.latencyMs", 100, "high")],
      [metric("network.latencyMs", 70, "low")],
    )
    expect(delta?.delta).toBe(-30)
    expect(delta?.confidence).toBe("low") // weaker of high/low
  })

  it("AC-049 only metrics present in BOTH with numeric values are compared", () => {
    const deltas = comparePerfMetrics(
      [metric("avgFps", 30), metric("only.baseline", 1), metric("nonNumeric", "x")],
      [metric("avgFps", 40), metric("only.candidate", 2), metric("nonNumeric", "y")],
    )
    expect(deltas.map((d) => d.metric)).toEqual(["avgFps"])
  })
})

describe("AC-050 budget fail-closed", () => {
  it("AC-050 passes when value within [min, max]", () => {
    const result = evaluateBudget([{ metric: "avgFps", min: 50 }], [metric("avgFps", 60)])
    expect(result.passed).toBe(true)
    expect(result.checks[0]?.passed).toBe(true)
    expect(result.checks[0]?.value).toBe(60)
  })

  it("AC-050 a MISSING metric → value null → fails (fail-closed)", () => {
    const result = evaluateBudget([{ metric: "avgFps", min: 50 }], [])
    expect(result.passed).toBe(false)
    expect(result.checks[0]?.value).toBeNull()
    expect(result.checks[0]?.passed).toBe(false)
  })

  it("AC-050 a NON-NUMERIC metric value → null → fails", () => {
    const result = evaluateBudget([{ metric: "avgFps", min: 50 }], [metric("avgFps", "fast")])
    expect(result.checks[0]?.value).toBeNull()
    expect(result.checks[0]?.passed).toBe(false)
  })

  it("AC-050 max boundary: value ≤ max passes, value > max fails", () => {
    expect(evaluateBudget([{ metric: "m", max: 100 }], [metric("m", 100)]).passed).toBe(true)
    expect(evaluateBudget([{ metric: "m", max: 100 }], [metric("m", 101)]).passed).toBe(false)
  })

  it("AC-050 min boundary: value ≥ min passes, value < min fails", () => {
    expect(evaluateBudget([{ metric: "m", min: 10 }], [metric("m", 10)]).passed).toBe(true)
    expect(evaluateBudget([{ metric: "m", min: 10 }], [metric("m", 9)]).passed).toBe(false)
  })

  it("AC-050 overall passed = checks.every(passed); one missing fails the whole budget", () => {
    const result = evaluateBudget(
      [
        { metric: "avgFps", min: 50 },
        { metric: "absent", max: 1 },
      ],
      [metric("avgFps", 60)],
    )
    expect(result.checks[0]?.passed).toBe(true)
    expect(result.checks[1]?.passed).toBe(false)
    expect(result.passed).toBe(false)
  })

  it("AC-050 empty rule set passes vacuously", () => {
    expect(evaluateBudget([], [metric("x", 1)]).passed).toBe(true)
  })
})

describe("AC-051 memory-leak claim", () => {
  it("AC-051 1 sample, no native artifact → low confidence / NOT allowed", () => {
    const ev = evaluateMemoryEvidence({ samples: 1 })
    expect(ev.samples).toBe(1)
    expect(ev.confidence).toBe("low")
    expect(ev.leakClaim.allowed).toBe(false)
  })

  it("AC-051 default samples (undefined → 1) → low / NOT allowed", () => {
    const ev = evaluateMemoryEvidence({})
    expect(ev.samples).toBe(1)
    expect(ev.leakClaim.allowed).toBe(false)
  })

  it("AC-051 2 samples → medium confidence / allowed", () => {
    const ev = evaluateMemoryEvidence({ samples: 2 })
    expect(ev.samples).toBe(2)
    expect(ev.confidence).toBe("medium")
    expect(ev.leakClaim.allowed).toBe(true)
  })

  it("AC-051 a native artifact with 1 sample → medium / allowed", () => {
    const ev = evaluateMemoryEvidence({ samples: 1, nativeArtifact: "/tmp/heap.memgraph" })
    expect(ev.hasNativeArtifact).toBe(true)
    expect(ev.confidence).toBe("medium")
    expect(ev.leakClaim.allowed).toBe(true)
  })

  it("AC-051 samples clamp to [1, 100]", () => {
    expect(evaluateMemoryEvidence({ samples: 0 }).samples).toBe(1)
    expect(evaluateMemoryEvidence({ samples: 9999 }).samples).toBe(100)
  })
})

it.skip("AC-046/047/049 live perf capture against a running Hermes (CDP read-eval seam)", () => {
  // Requires a running Metro + Hermes target; the calc is fully covered above.
})
