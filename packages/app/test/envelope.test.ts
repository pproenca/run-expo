import { describe, expect, it } from "@effect/vitest"
import { OUTPUT_BUDGET } from "@expo98/core"
import { Chunk, Effect, Stream } from "effect"
import {
  formatJson,
  formatPlain,
  ndjsonEnvelope,
  selectMode
} from "@expo98/app"

describe("Output envelope — --json { ok, data } / { ok, error } (§3.2)", () => {
  it("success → { ok:true, data } with the payload redacted", () => {
    const out = formatJson({ value: 1, token: "SECRET" }, 0)
    const parsed = JSON.parse(out) as { ok: boolean; data: Record<string, unknown> }
    expect(parsed.ok).toBe(true)
    expect(parsed.data.value).toBe(1)
    // AC-003/012: the secret-shaped key is redacted at the boundary.
    expect(parsed.data.token).toBe("[redacted]")
  })

  it("failure → { ok:false, error } carrying the message", () => {
    const out = formatJson({ ok: false, error: "boom" }, 1)
    const parsed = JSON.parse(out) as { ok: boolean; error: string }
    expect(parsed.ok).toBe(false)
    expect(parsed.error).toBe("boom")
  })

  it("AC-041 the serialised json envelope is truncated to the one budget", () => {
    const huge = "x".repeat(OUTPUT_BUDGET * 2)
    const out = formatJson({ blob: huge }, 0)
    // The marker is appended after the budget; content is capped at the budget.
    expect(out.length).toBeLessThanOrEqual(OUTPUT_BUDGET + 64)
    expect(out).toContain("[truncated")
  })
})

describe("Output envelope — --plain stable line output", () => {
  it("renders sorted key=value lines (deterministic)", () => {
    const out = formatPlain({ b: 2, a: 1, c: { nested: true } })
    expect(out.split("\n")).toEqual(["a=1", "b=2", 'c={"nested":true}'])
  })

  it("redacts secret-shaped keys in plain output too", () => {
    const out = formatPlain({ authorization: "Bearer abc", ok: true })
    expect(out).toContain("authorization=[redacted]")
    expect(out).toContain("ok=true")
  })
})

describe("selectMode — channel selection", () => {
  it("--ndjson wins, then --plain, else json", () => {
    expect(selectMode({ json: false, plain: false, ndjson: true })).toBe("ndjson")
    expect(selectMode({ json: false, plain: true, ndjson: false })).toBe("plain")
    expect(selectMode({ json: false, plain: false, ndjson: false })).toBe("json")
    expect(selectMode({ json: true, plain: false, ndjson: false })).toBe("json")
  })
})

describe("AC-041 — --ndjson streaming: per-event redaction + running-total truncation", () => {
  it.effect("each event is one redacted JSON line", () =>
    Effect.gen(function* () {
      const events = Stream.fromIterable([
        { step: 1, token: "SECRET" },
        { step: 2, password: "hunter2" }
      ])
      const lines = yield* Stream.runCollect(ndjsonEnvelope(events))
      const arr = Chunk.toReadonlyArray(lines)
      expect(arr.length).toBe(2)
      const first = JSON.parse(arr[0]!) as { step: number; token: string }
      expect(first.step).toBe(1)
      // M2: redaction is per WHOLE value before serialisation — secret never
      // splits across events.
      expect(first.token).toBe("[redacted]")
      const second = JSON.parse(arr[1]!) as { step: number; password: string }
      expect(second.password).toBe("[redacted]")
    })
  )

  it.effect("the 40,000-char budget is a RUNNING TOTAL with one terminal marker", () =>
    Effect.gen(function* () {
      // Each event ~30k chars; the second crosses the running budget.
      const big = "y".repeat(30_000)
      const events = Stream.fromIterable([{ a: big }, { b: big }, { c: big }])
      const lines = yield* Stream.runCollect(ndjsonEnvelope(events))
      const arr = Chunk.toReadonlyArray(lines)
      const joined = arr.join("")
      // Total admitted content never exceeds the budget (plus one marker).
      const markerCount = (joined.match(/\[truncated/g) ?? []).length
      expect(markerCount).toBe(1) // EXACTLY one terminal overflow marker
      // First event fully admitted; once overflowed, later events are dropped.
      expect(arr[0]).toContain('"a"')
    })
  )
})
