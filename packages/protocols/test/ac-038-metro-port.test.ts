/**
 * AC-038 — Metro port defaults to 8081 and clamps to 1..65535.
 *
 * `resolveMetroPort` is PURE; test it exhaustively at the boundaries + default + bad inputs.
 */
import { describe, expect, it } from "@effect/vitest"
import { DEFAULT_METRO_PORT, loopbackMetroBaseUrl, MAX_PORT, MIN_PORT, resolveMetroPort } from "../src/index.js"

describe("AC-038 Metro port clamp", () => {
  it("defaults to 8081 when undefined/null", () => {
    expect(resolveMetroPort(undefined)).toBe(8081)
    expect(resolveMetroPort(null)).toBe(8081)
    expect(DEFAULT_METRO_PORT).toBe(8081)
  })

  it("passes through valid in-range ports", () => {
    expect(resolveMetroPort(8081)).toBe(8081)
    expect(resolveMetroPort(19000)).toBe(19000)
    expect(resolveMetroPort(MIN_PORT)).toBe(1)
    expect(resolveMetroPort(MAX_PORT)).toBe(65535)
  })

  it("clamps below 1 up to 1 and above 65535 down to 65535", () => {
    expect(resolveMetroPort(0)).toBe(1)
    expect(resolveMetroPort(-5)).toBe(1)
    expect(resolveMetroPort(70000)).toBe(65535)
    expect(resolveMetroPort(999999)).toBe(65535)
  })

  it("falls back to default on non-finite, truncates fractional ports", () => {
    expect(resolveMetroPort(Number.NaN)).toBe(8081)
    expect(resolveMetroPort(Number.POSITIVE_INFINITY)).toBe(8081)
    expect(resolveMetroPort(8081.9)).toBe(8081)
  })

  it("the loopback base URL embeds the clamped port and is always 127.0.0.1", () => {
    expect(loopbackMetroBaseUrl(8081)).toBe("http://127.0.0.1:8081")
    expect(loopbackMetroBaseUrl(0)).toBe("http://127.0.0.1:1")
    expect(loopbackMetroBaseUrl(70000)).toBe("http://127.0.0.1:65535")
  })
})
