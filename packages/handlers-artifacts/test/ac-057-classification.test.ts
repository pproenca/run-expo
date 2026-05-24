/**
 * AC-057 — live-backlog classifies each command row from its evidence.
 *
 * One case per classification branch, driving the PURE `classifyRow` with a FAKE
 * `LiveEvidenceSignal` (the documented seam):
 *   - exit 2                                        → expected-usage-error
 *   - non-zero exit (with requirements)             → environment-blocked
 *   - non-zero exit (no requirements)               → defect
 *   - exit 0 + runtime requirement + NO live ev.    → environment-blocked
 *   - exit 0 + runtime requirement + live evidence  → live-pass
 *   - exit 0 + no requirements                       → static-pass
 *   - available:false (designed code)               → designed-unavailable
 *   - available:false (environment code)            → environment-blocked
 *   - available:false (no req, unknown code)        → expected-usage-error
 *
 * Plus the live-evidence detector (`hasLiveEvidence`) over each signal facet, and
 * the `run` command's end-to-end classification + AC-042 summary.
 */
import { describe, expect, it } from "@effect/vitest"
import { DeviceCapability, dispatch, RuntimeEvalCapability, SourceWriteCapability } from "@expo98/core"
import {
  classifyRow,
  hasLiveEvidence,
  type LiveEvidenceSignal,
  liveBacklogRunCommand,
  type RowEvidence,
  type RowEvidenceMap,
  type RuntimeRequirement,
} from "@expo98/handlers-artifacts"
import { Effect, Layer } from "effect"

const Caps = Layer.mergeAll(
  Layer.succeed(RuntimeEvalCapability, RuntimeEvalCapability.of({ evaluate: () => Effect.succeed(null) })),
  Layer.succeed(DeviceCapability, DeviceCapability.of({ invoke: () => Effect.succeed("ok") })),
  Layer.succeed(
    SourceWriteCapability,
    SourceWriteCapability.of({
      writeFile: () => Effect.void,
      deleteFile: () => Effect.void,
    }),
  ),
)

/** A fake live-evidence signal: nothing live. */
const NO_LIVE: LiveEvidenceSignal = {
  hasTargets: false,
  hasCdpCalls: false,
  hasWsUrls: false,
  hasRunningPackager: false,
}

/** A fake live-evidence signal: a live target observed. */
const LIVE: LiveEvidenceSignal = {
  hasTargets: true,
  hasCdpCalls: false,
  hasWsUrls: false,
  hasRunningPackager: false,
}

const REQ: ReadonlyArray<RuntimeRequirement> = ["metro"]
const NO_REQ: ReadonlyArray<RuntimeRequirement> = []

const evidence = (over: Partial<RowEvidence>): RowEvidence => ({
  exitCode: 0,
  requirements: NO_REQ,
  availableFalse: false,
  liveEvidence: NO_LIVE,
  ...over,
})

describe("AC-057 live-backlog row classification (fake live-evidence signal)", () => {
  it("AC-057 exit 2 → expected-usage-error (even with requirements + live evidence)", () => {
    expect(classifyRow(evidence({ exitCode: 2, requirements: REQ, liveEvidence: LIVE }))).toBe("expected-usage-error")
  })

  it("AC-057 non-zero exit WITH requirements → environment-blocked", () => {
    expect(classifyRow(evidence({ exitCode: 1, requirements: REQ }))).toBe("environment-blocked")
  })

  it("AC-057 non-zero exit with NO requirements → defect", () => {
    expect(classifyRow(evidence({ exitCode: 1, requirements: NO_REQ }))).toBe("defect")
  })

  it("AC-057 exit 0 + runtime requirement but NO live evidence → environment-blocked", () => {
    expect(classifyRow(evidence({ exitCode: 0, requirements: REQ, liveEvidence: NO_LIVE }))).toBe("environment-blocked")
  })

  it("AC-057 exit 0 + runtime requirement + live evidence → live-pass", () => {
    expect(classifyRow(evidence({ exitCode: 0, requirements: REQ, liveEvidence: LIVE }))).toBe("live-pass")
  })

  it("AC-057 exit 0 + NO requirements → static-pass", () => {
    expect(classifyRow(evidence({ exitCode: 0, requirements: NO_REQ }))).toBe("static-pass")
  })

  it("AC-057 available:false with a designed code → designed-unavailable", () => {
    expect(classifyRow(evidence({ availableFalse: true, unavailableCode: "policy-denied", requirements: REQ }))).toBe(
      "designed-unavailable",
    )
  })

  it("AC-057 available:false with an environment code → environment-blocked", () => {
    expect(
      classifyRow(
        evidence({
          availableFalse: true,
          unavailableCode: "no-runtime-target",
          requirements: REQ,
        }),
      ),
    ).toBe("environment-blocked")
  })

  it("AC-057 available:false, unknown code, WITH requirements → environment-blocked", () => {
    expect(classifyRow(evidence({ availableFalse: true, unavailableCode: "mystery", requirements: REQ }))).toBe(
      "environment-blocked",
    )
  })

  it("AC-057 available:false, unknown code, NO requirements → expected-usage-error", () => {
    expect(
      classifyRow(
        evidence({
          availableFalse: true,
          unavailableCode: "mystery",
          requirements: NO_REQ,
        }),
      ),
    ).toBe("expected-usage-error")
  })

  it("AC-057 live-evidence detection fires on ANY live facet (the seam)", () => {
    expect(hasLiveEvidence(NO_LIVE)).toBe(false)
    expect(hasLiveEvidence({ ...NO_LIVE, hasTargets: true })).toBe(true)
    expect(hasLiveEvidence({ ...NO_LIVE, hasCdpCalls: true })).toBe(true)
    expect(hasLiveEvidence({ ...NO_LIVE, hasWsUrls: true })).toBe(true)
    expect(hasLiveEvidence({ ...NO_LIVE, hasRunningPackager: true })).toBe(true)
  })

  it.effect("AC-057 live-backlog run classifies each substituted row from injected evidence", () =>
    Effect.gen(function* () {
      // Provide a fake per-row evidence map: metro is live-pass, console is
      // environment-blocked (exit 0, needs hermes, no live evidence), routes is
      // static-pass.
      const map: RowEvidenceMap = {
        "metro-status": evidence({
          exitCode: 0,
          requirements: ["metro"],
          liveEvidence: LIVE,
        }),
        "launch-app": evidence({
          exitCode: 0,
          requirements: ["app-bridge"],
          liveEvidence: LIVE,
        }),
        "open-route": evidence({
          exitCode: 0,
          requirements: ["metro-message"],
          liveEvidence: LIVE,
        }),
        routes: evidence({ exitCode: 0, requirements: [] }),
        console: evidence({
          exitCode: 0,
          requirements: ["hermes-target"],
          liveEvidence: NO_LIVE,
        }),
      }
      const result = yield* dispatch(
        liveBacklogRunCommand(
          {
            metroPort: 8081,
            bundleId: "com.example.myapp",
            device: "iPhone 16 Pro",
            devClientUrl: "exp+myapp://x",
          },
          map,
        ),
        {},
      ).pipe(Effect.provide(Caps))
      expect(result.sideEffect).toBe("read")
      const payload = result.payload as {
        available: boolean
        rows: ReadonlyArray<{ id: string; classification: string }>
        summary: { rowCount: number; byClassification: Record<string, number> }
      }
      expect(payload.available).toBe(true)
      const byId = Object.fromEntries(payload.rows.map((r) => [r.id, r.classification]))
      expect(byId["metro-status"]).toBe("live-pass")
      expect(byId["routes"]).toBe("static-pass")
      expect(byId["console"]).toBe("environment-blocked")
      // AC-042 rollup is present and counts each classification.
      expect(payload.summary.rowCount).toBe(5)
      expect(payload.summary.byClassification["live-pass"]).toBe(3)
      expect(payload.summary.byClassification["static-pass"]).toBe(1)
      expect(payload.summary.byClassification["environment-blocked"]).toBe(1)
    }),
  )

  it.skip("AC-057 live-backlog run against a REAL environment (Metro + Hermes + simulator)", () => {
    // Requires a running Metro/Hermes/simulator to produce real per-row evidence
    // through the live-evidence probe (WS URLs / CDP calls / running packager /
    // non-empty targets). The pure classification + summary are fully covered
    // above with the injected fake `LiveEvidenceSignal`.
  })
})
