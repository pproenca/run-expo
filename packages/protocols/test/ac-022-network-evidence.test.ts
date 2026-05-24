/**
 * AC-022 — Network evidence requires a live target, well-formed shape, observed traffic.
 *
 * `validateNetworkEvidence` is PURE; cover every unavailable code + the happy path + the clamps.
 */
import { describe, expect, it } from "@effect/vitest";
import {
  DEFAULT_LIMIT,
  resolveLimit,
  validateNetworkEvidence,
} from "../src/index.js";

describe("AC-022 network evidence shape validation (PURE)", () => {
  it("no Hermes target / no evaluator -> no-runtime-target", () => {
    const res = validateNetworkEvidence({ hasRuntimeTarget: false, payload: { requests: [] } });
    expect(res.available).toBe(false);
    if (!res.available) expect(res.code).toBe("no-runtime-target");
  });

  it("transport fault -> transport-failure (takes precedence over no-target)", () => {
    const res = validateNetworkEvidence({
      hasRuntimeTarget: false,
      transportFailed: true,
      payload: null,
    });
    expect(res.available).toBe(false);
    if (!res.available) expect(res.code).toBe("transport-failure");
  });

  it("non-object payload -> malformed-payload", () => {
    for (const payload of [null, 42, "str", true, [] as unknown[]]) {
      const res = validateNetworkEvidence({ hasRuntimeTarget: true, payload });
      expect(res.available).toBe(false);
      if (!res.available) expect(res.code).toBe("malformed-payload");
    }
  });

  it("non-array requests -> malformed-payload", () => {
    const res = validateNetworkEvidence({
      hasRuntimeTarget: true,
      payload: { requests: "not an array" },
    });
    expect(res.available).toBe(false);
    if (!res.available) expect(res.code).toBe("malformed-payload");
  });

  it("empty observed traffic -> no-observed-traffic", () => {
    const res = validateNetworkEvidence({ hasRuntimeTarget: true, payload: { requests: [] } });
    expect(res.available).toBe(false);
    if (!res.available) expect(res.code).toBe("no-observed-traffic");
  });

  it("happy path -> validated with metroPort/limit defaults and the rows", () => {
    const rows = [{ url: "https://a" }, { url: "https://b" }];
    const res = validateNetworkEvidence({ hasRuntimeTarget: true, payload: { requests: rows } });
    expect(res.available).toBe(true);
    if (res.available) {
      expect(res.metroPort).toBe(8081);
      expect(res.limit).toBe(DEFAULT_LIMIT);
      expect(res.requests).toEqual(rows);
      expect(res.truncated).toBe(false);
    }
  });

  it("validated rows are the LAST `limit` entries (take-last, AC-039)", () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({ i }));
    const res = validateNetworkEvidence({
      hasRuntimeTarget: true,
      payload: { requests: rows },
      limit: 2,
    });
    expect(res.available).toBe(true);
    if (res.available) {
      expect(res.requests).toEqual([{ i: 3 }, { i: 4 }]);
      expect(res.truncated).toBe(true);
    }
  });

  it("metroPort clamps 1..65535; limit clamps 1..1000", () => {
    const res = validateNetworkEvidence({
      hasRuntimeTarget: true,
      payload: { requests: [{ x: 1 }] },
      metroPort: 999999,
      limit: 999999,
    });
    expect(res.available).toBe(true);
    if (res.available) {
      expect(res.metroPort).toBe(65535);
      expect(res.limit).toBe(1000);
    }
  });

  it("resolveLimit: default 100, clamps, falls back on non-finite", () => {
    expect(resolveLimit(undefined)).toBe(100);
    expect(resolveLimit(null)).toBe(100);
    expect(resolveLimit(0)).toBe(1);
    expect(resolveLimit(5000)).toBe(1000);
    expect(resolveLimit(Number.NaN)).toBe(100);
    expect(resolveLimit(50.9)).toBe(50);
  });
});
