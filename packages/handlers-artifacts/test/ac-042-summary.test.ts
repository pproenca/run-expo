/**
 * AC-042 — run/backlog payload summaries cap the key list.
 *
 *   - backlog summary: `Object.keys(payload).slice(0, 20)` + classification rollups
 *   - run-record summary: `Object.keys(payload).slice(0, 40)` +
 *     `available` / `routeCount` / `eventCount` rollups
 *
 * The run-record summary's shape is the domain `RunPayloadSummary` (reused), so
 * it persists unchanged; the rollups appear ONLY when present on the payload.
 */
import { describe, expect, it } from "@effect/vitest"
import { RunPayloadSummary } from "@expo98/domain"
import {
  BACKLOG_SUMMARY_KEY_CAP,
  RUN_RECORD_SUMMARY_KEY_CAP,
  summarizeBacklogPayload,
  summarizeRunRecordPayload
} from "@expo98/handlers-artifacts"
import { Schema } from "effect"

/** A payload with `n` top-level keys k0..k(n-1). */
const widePayload = (n: number): Record<string, number> =>
  Object.fromEntries(Array.from({ length: n }, (_, i) => [`k${i}`, i]))

describe("AC-042 run-record summary caps to the first 40 keys + rollups", () => {
  it("AC-042 the cap constant is 40", () => {
    expect(RUN_RECORD_SUMMARY_KEY_CAP).toBe(40)
  })

  it("AC-042 keys.slice(0, 40): a 50-key payload keeps exactly the first 40", () => {
    const summary = summarizeRunRecordPayload(widePayload(50))
    expect(summary.keys.length).toBe(40)
    expect(summary.keys[0]).toBe("k0")
    expect(summary.keys[39]).toBe("k39")
    expect(summary.keys).not.toContain("k40")
  })

  it("AC-042 a payload with fewer than 40 keys keeps all of them", () => {
    const summary = summarizeRunRecordPayload(widePayload(7))
    expect(summary.keys.length).toBe(7)
  })

  it("AC-042 rollups available/routeCount/eventCount are emitted only when present", () => {
    const full = summarizeRunRecordPayload({
      available: true,
      routeCount: 12,
      eventCount: 3,
      other: "x"
    })
    expect(full.available).toBe(true)
    expect(full.routeCount).toBe(12)
    expect(full.eventCount).toBe(3)

    const none = summarizeRunRecordPayload({ a: 1, b: 2 })
    expect(none.available).toBeUndefined()
    expect(none.routeCount).toBeUndefined()
    expect(none.eventCount).toBeUndefined()
    expect(none.keys).toEqual(["a", "b"])
  })

  it("AC-042 a non-object payload summarizes to an empty key list", () => {
    expect(summarizeRunRecordPayload(null).keys).toEqual([])
    expect(summarizeRunRecordPayload([1, 2, 3]).keys).toEqual([])
    expect(summarizeRunRecordPayload("hi").keys).toEqual([])
  })

  it("AC-042 the run-record summary is a valid domain RunPayloadSummary", () => {
    const summary = summarizeRunRecordPayload({
      available: false,
      routeCount: 0,
      keyA: 1
    })
    // Decoding through the domain schema proves shape compatibility (reuse).
    const decoded = Schema.decodeUnknownSync(RunPayloadSummary)(summary)
    expect(decoded.keys).toEqual(["available", "routeCount", "keyA"])
    expect(decoded.available).toBe(false)
    expect(decoded.routeCount).toBe(0)
  })
})

describe("AC-042 backlog summary caps to the first 20 keys + rollups", () => {
  it("AC-042 the cap constant is 20", () => {
    expect(BACKLOG_SUMMARY_KEY_CAP).toBe(20)
  })

  it("AC-042 keys.slice(0, 20): a 30-key payload keeps exactly the first 20", () => {
    const summary = summarizeBacklogPayload(widePayload(30))
    expect(summary.keys.length).toBe(20)
    expect(summary.keys[0]).toBe("k0")
    expect(summary.keys[19]).toBe("k19")
    expect(summary.keys).not.toContain("k20")
  })

  it("AC-042 backlog rollups count rows per classification", () => {
    const payload = {
      action: "live-backlog.run",
      rows: [
        { id: "a", classification: "live-pass" },
        { id: "b", classification: "live-pass" },
        { id: "c", classification: "environment-blocked" },
        { id: "d", classification: "static-pass" }
      ]
    }
    const summary = summarizeBacklogPayload(payload)
    expect(summary.rowCount).toBe(4)
    expect(summary.byClassification).toEqual({
      "live-pass": 2,
      "environment-blocked": 1,
      "static-pass": 1
    })
    // keys are the top-level keys of the payload (capped at 20).
    expect(summary.keys).toEqual(["action", "rows"])
  })

  it("AC-042 a backlog payload with no rows rolls up to zero", () => {
    const summary = summarizeBacklogPayload({ action: "live-backlog.run", rows: [] })
    expect(summary.rowCount).toBe(0)
    expect(summary.byClassification).toEqual({})
  })
})
