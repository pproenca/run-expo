/**
 * AC-045 — network waterfall / duplicates / HAR / `ok` derivation (pure, exhaustive).
 * AC-013 — HAR `--output-path` confinement (FIX): an escape is rejected.
 * AC-022 — reuse protocols' shape validation for input shape.
 *
 * These are PURE calculations; tested directly with literal request rows,
 * including the edge cases the rule calls out (invalid URL → regex query
 * fallback, inferred endedAt, the responseBytes fallback chain, retryCount ?? 0).
 */
import { describe, expect, it } from "@effect/vitest"
import {
  buildWaterfall,
  confineHarOutputPath,
  duplicateGroups,
  HAR_VERSION,
  harFromRequests,
  inferEndedAt,
  normalizeRequest,
  normalizeRequests,
  parseUrlParts,
  SLOW_THRESHOLD_MS,
  validateNetworkEvidence,
} from "@expo98/handlers-net-perf"
import { Effect } from "effect"

describe("AC-045 request normalization + `ok` derivation", () => {
  it("AC-045 derives origin/path from a valid URL", () => {
    const parsed = parseUrlParts("https://api.example.com/v1/items?q=1")
    expect(parsed.origin).toBe("https://api.example.com")
    expect(parsed.path).toBe("/v1/items?q=1")
  })

  it("AC-045 EDGE: invalid URL → origin null, path falls back to the raw string", () => {
    const parsed = parseUrlParts("/relative/only?token=abc")
    expect(parsed.origin).toBeNull()
    // regex/raw fallback: the unparseable value is kept verbatim as the path.
    expect(parsed.path).toBe("/relative/only?token=abc")
  })

  it("AC-045 EDGE: empty URL → origin null, path null", () => {
    expect(parseUrlParts("")).toEqual({ origin: null, path: null })
  })

  it("AC-045 status = request.status ?? response.status", () => {
    expect(normalizeRequest({ status: 201 }).status).toBe(201)
    expect(normalizeRequest({ response: { status: 404 } }).status).toBe(404)
    expect(normalizeRequest({ status: 200, response: { status: 500 } }).status).toBe(200)
    expect(normalizeRequest({}).status).toBeNull()
  })

  it("AC-045 ok = explicit boolean ?? (200 ≤ status < 400)", () => {
    // explicit boolean wins, even against a contradicting status.
    expect(normalizeRequest({ ok: true, status: 500 }).ok).toBe(true)
    expect(normalizeRequest({ ok: false, status: 200 }).ok).toBe(false)
    // derived from status.
    expect(normalizeRequest({ status: 200 }).ok).toBe(true)
    expect(normalizeRequest({ status: 399 }).ok).toBe(true)
    expect(normalizeRequest({ status: 400 }).ok).toBe(false)
    expect(normalizeRequest({ status: 199 }).ok).toBe(false)
    // no status, no explicit → undefined.
    expect(normalizeRequest({}).ok).toBeUndefined()
  })

  it("AC-045 responseBytes fallback chain", () => {
    expect(normalizeRequest({ responseBytes: 10 }).responseBytes).toBe(10)
    expect(normalizeRequest({ encodedResponseBytes: 20 }).responseBytes).toBe(20)
    expect(normalizeRequest({ response: { encodedBodySize: 30 } }).responseBytes).toBe(30)
    expect(normalizeRequest({ response: { size: 40 } }).responseBytes).toBe(40)
    // precedence: responseBytes wins over the rest.
    expect(normalizeRequest({ responseBytes: 1, encodedResponseBytes: 2, response: { size: 3 } }).responseBytes).toBe(1)
    expect(normalizeRequest({}).responseBytes).toBeNull()
  })

  it("AC-045 retryCount ?? 0 and aborted boolean", () => {
    expect(normalizeRequest({ retryCount: 3 }).retryCount).toBe(3)
    expect(normalizeRequest({}).retryCount).toBe(0)
    expect(normalizeRequest({ retryCount: "nope" }).retryCount).toBe(0)
    expect(normalizeRequest({ aborted: true }).aborted).toBe(true)
    expect(normalizeRequest({}).aborted).toBe(false)
  })

  it("AC-045 method defaults to GET; id/requestId cross-fill", () => {
    expect(normalizeRequest({}).method).toBe("GET")
    expect(normalizeRequest({ request: { method: "POST" } }).method).toBe("POST")
    const r = normalizeRequest({ id: "a" })
    expect(r.id).toBe("a")
    expect(r.requestId).toBe("a")
  })

  it("AC-045 endedAt inferred = Date.parse(startedAt) + durationMs when absent", () => {
    const startedAt = "2026-01-01T00:00:00.000Z"
    expect(inferEndedAt(startedAt, 1500)).toBe("2026-01-01T00:00:01.500Z")
    // explicit endedAt wins over inference.
    const r = normalizeRequest({ startedAt, durationMs: 1000, endedAt: "2026-01-01T00:00:05.000Z" })
    expect(r.endedAt).toBe("2026-01-01T00:00:05.000Z")
    // inferred when absent.
    expect(normalizeRequest({ startedAt, durationMs: 250 }).endedAt).toBe("2026-01-01T00:00:00.250Z")
    // no startedAt or no duration → null.
    expect(inferEndedAt(null, 100)).toBeNull()
    expect(inferEndedAt(startedAt, null)).toBeNull()
    expect(inferEndedAt("not-a-date", 100)).toBeNull()
  })
})

describe("AC-045 waterfall", () => {
  const rows = normalizeRequests([
    { id: "a", url: "https://x.test/a", durationMs: 600 },
    { id: "b", url: "https://x.test/b", durationMs: 1200 },
    { id: "c", url: "https://x.test/c", durationMs: 50 },
    { id: "d", url: "https://x.test/d" }, // no duration → excluded from ranking
    { id: "e", url: "https://x.test/e", durationMs: 500 }, // exactly at threshold
  ])

  it("AC-045 ranks by durationMs DESC, drops rows without numeric durationMs", () => {
    const w = buildWaterfall(rows)
    expect(w.rankedRequests.map((r) => r.id)).toEqual(["b", "a", "e", "c"])
    expect(w.requestCount).toBe(5) // count is over ALL requests, not just ranked
  })

  it("AC-045 slowThresholdMs = 500 and slowRequestCount counts ranked ≥ 500 (inclusive)", () => {
    const w = buildWaterfall(rows)
    expect(w.slowThresholdMs).toBe(SLOW_THRESHOLD_MS)
    expect(SLOW_THRESHOLD_MS).toBe(500)
    // b(1200), a(600), e(500) are ≥ 500; c(50) is not.
    expect(w.slowRequestCount).toBe(3)
  })

  it("AC-045 ranks at most the top 50", () => {
    const many = normalizeRequests(
      Array.from({ length: 120 }, (_, i) => ({ id: `r${i}`, url: `https://x.test/${i}`, durationMs: i })),
    )
    const w = buildWaterfall(many)
    expect(w.rankedRequests.length).toBe(50)
    // top is the largest duration (119).
    expect(w.rankedRequests[0]?.durationMs).toBe(119)
  })
})

describe("AC-045 duplicates", () => {
  it("AC-045 groups by `<method> <origin><path|url>`, keeps groups > 1", () => {
    const rows = normalizeRequests([
      { id: "1", method: "GET", url: "https://x.test/dup", durationMs: 100 },
      { id: "2", method: "GET", url: "https://x.test/dup", durationMs: 200 },
      { id: "3", method: "POST", url: "https://x.test/dup", durationMs: 5 }, // different method
      { id: "4", method: "GET", url: "https://x.test/unique", durationMs: 1 },
    ])
    const groups = duplicateGroups(rows)
    expect(groups.length).toBe(1)
    const group = groups[0]
    expect(group?.key).toBe("GET https://x.test/dup")
    expect(group?.count).toBe(2)
    expect(group?.requestIds).toEqual(["1", "2"])
    expect(group?.totalDurationMs).toBe(300)
  })

  it("AC-045 no duplicates → empty array", () => {
    const rows = normalizeRequests([
      { id: "1", url: "https://x.test/a", durationMs: 1 },
      { id: "2", url: "https://x.test/b", durationMs: 2 },
    ])
    expect(duplicateGroups(rows)).toEqual([])
  })
})

describe("AC-045 HAR", () => {
  const creator = { name: "expo98", version: "0.1.0" }
  const now = "2026-05-24T00:00:00.000Z"

  it("AC-045 HAR version 1.2, time = durationMs ?? 0, query+cookies emptied", () => {
    const rows = normalizeRequests([
      {
        method: "GET",
        url: "https://x.test/a?token=secret&q=1",
        startedAt: "2026-01-01T00:00:00.000Z",
        durationMs: 123,
        status: 200,
        responseBytes: 42,
      },
    ])
    const har = harFromRequests(rows, creator, now)
    expect(har.log.version).toBe(HAR_VERSION)
    expect(HAR_VERSION).toBe("1.2")
    const entry = har.log.entries[0]
    expect(entry?.time).toBe(123)
    expect(entry?.request.queryString).toEqual([])
    expect(entry?.request.cookies).toEqual([])
    expect(entry?.response.cookies).toEqual([])
    expect(entry?.response.content.size).toBe(42)
    expect(entry?.startedDateTime).toBe("2026-01-01T00:00:00.000Z")
  })

  it("AC-045 HAR time defaults to 0 and startedDateTime falls back to now when absent", () => {
    const rows = normalizeRequests([{ url: "https://x.test/a" }])
    const har = harFromRequests(rows, creator, now)
    const entry = har.log.entries[0]
    expect(entry?.time).toBe(0)
    expect(entry?.startedDateTime).toBe(now)
    expect(entry?.response.status).toBe(0)
  })
})

describe("AC-013 HAR --output-path confinement (FIX)", () => {
  const root = "/workspace/.scratch/expo98/artifacts"

  it.effect("AC-013 a path inside the artifacts root resolves OK", () =>
    Effect.gen(function* () {
      const resolved = yield* confineHarOutputPath(root, "network-2026.har")
      expect(resolved).toBe("/workspace/.scratch/expo98/artifacts/network-2026.har")
    }),
  )

  it.effect("AC-013 a `../` traversal escape is REJECTED with PathEscape", () =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(confineHarOutputPath(root, "../../../etc/evil.har"))
      expect(exit._tag).toBe("Failure")
    }),
  )

  it.effect("AC-013 an absolute escape outside the root is REJECTED", () =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(confineHarOutputPath(root, "/etc/passwd"))
      expect(exit._tag).toBe("Failure")
    }),
  )

  it.effect("AC-013 a sibling-prefix path is REJECTED (no false-positive containment)", () =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(confineHarOutputPath("/workspace/artifacts", "/workspace/artifacts-evil/x.har"))
      expect(exit._tag).toBe("Failure")
    }),
  )
})

describe("AC-022 reuse protocols' network shape validation for input", () => {
  it("AC-022 non-object payload → malformed-payload", () => {
    const r = validateNetworkEvidence({ hasRuntimeTarget: true, payload: 42 })
    expect(r.available).toBe(false)
    if (!r.available) expect(r.code).toBe("malformed-payload")
  })

  it("AC-022 empty requests → no-observed-traffic", () => {
    const r = validateNetworkEvidence({ hasRuntimeTarget: true, payload: { requests: [] } })
    expect(r.available).toBe(false)
    if (!r.available) expect(r.code).toBe("no-observed-traffic")
  })

  it("AC-022 valid shape passes through and feeds normalization", () => {
    const r = validateNetworkEvidence({
      hasRuntimeTarget: true,
      payload: { requests: [{ id: "1", url: "https://x.test/a", durationMs: 700 }] },
    })
    expect(r.available).toBe(true)
    if (r.available) {
      const normalized = normalizeRequests(r.requests)
      expect(buildWaterfall(normalized).slowRequestCount).toBe(1)
    }
  })
})

it.skip("AC-045 live network capture against a running Hermes (CDP read-eval seam)", () => {
  // Requires a running Metro + Hermes target; harvesting is the documented
  // read-eval capability seam. All derivation logic is fully covered above.
})
