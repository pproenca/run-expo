/**
 * AC-056 — post-launch crash grace window (the FIX: non-zero default).
 * AC-029 — crash evaluation pure logic (matched/unmatched, verbatim crashCheck).
 *
 * These are PURE calculations, tested directly (no dispatch / no capability).
 */
import { describe, expect, it } from "@effect/vitest"
import {
  DEFAULT_CRASH_GRACE_MS,
  evaluateCrash,
  isCrashReportPath,
  MAX_CRASH_GRACE_MS,
  resolveCrashGraceMs,
} from "@expo98/handlers-interaction"

describe("AC-056 crash grace window default + clamp", () => {
  it("AC-056 default grace is 1000ms (non-zero — the FIX)", () => {
    expect(DEFAULT_CRASH_GRACE_MS).toBe(1_000)
    expect(resolveCrashGraceMs(undefined)).toBe(1_000)
  })

  it("AC-056 clamp(waitMs, 0, 30000)", () => {
    expect(resolveCrashGraceMs(0)).toBe(0)
    expect(resolveCrashGraceMs(-5)).toBe(0)
    expect(resolveCrashGraceMs(2_000)).toBe(2_000)
    expect(resolveCrashGraceMs(30_000)).toBe(30_000)
    expect(resolveCrashGraceMs(99_999)).toBe(MAX_CRASH_GRACE_MS)
  })
})

describe("AC-029 crash report matching + evaluation", () => {
  it("AC-029 only `.ips`/`.crash` paths are recognised", () => {
    expect(isCrashReportPath("/x/App-2026.ips")).toBe(true)
    expect(isCrashReportPath("/x/App.crash")).toBe(true)
    expect(isCrashReportPath("/x/App.IPS")).toBe(true)
    expect(isCrashReportPath("/x/App.log")).toBe(false)
    expect(isCrashReportPath("/x/App.txt")).toBe(false)
  })

  it("AC-029 no candidates → available, reportCount 0, empty reports", () => {
    const e = evaluateCrash({
      action: "launch-app",
      bundleId: "com.example.app",
      processName: "com.example.app",
      startedAt: 1_000,
      waitedMs: 1_000,
      candidates: [],
    })
    expect(e.available).toBe(true)
    expect(e.reason).toBeNull()
    expect(e.crashReports).toEqual([])
    expect(e.crashCheck).toEqual({
      action: "launch-app",
      bundleId: "com.example.app",
      processName: "com.example.app",
      since: 1_000,
      waitedMs: 1_000,
      reportCount: 0,
    })
  })

  it("AC-029 a report AFTER startedAt fails closed with the verbatim reason", () => {
    const e = evaluateCrash({
      action: "launch-app",
      bundleId: "com.example.app",
      processName: "com.example.app",
      startedAt: 1_000,
      waitedMs: 1_000,
      candidates: [{ path: "/x/App.ips", mtimeMs: 2_000 }],
    })
    expect(e.available).toBe(false)
    expect(e.reason).toBe("The app generated 1 matching iOS crash report(s) after launch-app.")
    expect(e.crashCheck.reportCount).toBe(1)
    expect(e.crashReports).toEqual([{ path: "/x/App.ips", mtimeMs: 2_000 }])
  })

  it("AC-029 a report BEFORE or AT startedAt is ignored", () => {
    const e = evaluateCrash({
      action: "reload-app",
      bundleId: "b",
      processName: "b",
      startedAt: 5_000,
      waitedMs: 1_000,
      candidates: [
        { path: "/x/old.crash", mtimeMs: 4_999 },
        { path: "/x/exact.crash", mtimeMs: 5_000 },
      ],
    })
    expect(e.available).toBe(true)
    expect(e.crashCheck.reportCount).toBe(0)
  })

  it("AC-029 a non-crash file after startedAt is ignored", () => {
    const e = evaluateCrash({
      action: "launch-app",
      bundleId: "b",
      processName: "b",
      startedAt: 1_000,
      waitedMs: 1_000,
      candidates: [{ path: "/x/App.log", mtimeMs: 9_999 }],
    })
    expect(e.available).toBe(true)
    expect(e.crashCheck.reportCount).toBe(0)
  })

  it("AC-029 multiple matching reports are all counted + attached", () => {
    const e = evaluateCrash({
      action: "launch-app",
      bundleId: "b",
      processName: "b",
      startedAt: 1_000,
      waitedMs: 1_000,
      candidates: [
        { path: "/x/a.ips", mtimeMs: 1_500 },
        { path: "/x/b.crash", mtimeMs: 2_000 },
      ],
    })
    expect(e.available).toBe(false)
    expect(e.crashCheck.reportCount).toBe(2)
    expect(e.crashReports.length).toBe(2)
    expect(e.reason).toContain("2 matching")
  })
})
