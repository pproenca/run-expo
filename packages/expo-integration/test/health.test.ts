/**
 * AC-028 — bridge runtime-health is a REAL ordered state machine; AC-009 — the
 * bridge is development-only (install-state + runtime registration refusals).
 *
 * Each step's unavailable code is asserted at the RIGHT step, in order, plus the
 * all-pass `ready` payload. The Hermes probe is a fake `HermesEvidence`; install
 * state is supplied directly (so each step is isolated from the Fs read).
 */
import { describe, expect, it } from "@effect/vitest"
import { Fs, makeMemoryFs } from "@expo98/domain"
import {
  bridgeHealth,
  type HealthReady,
  type HealthUnavailable,
  type InstallStateResult,
} from "@expo98/expo-integration"
import { type CdpEvaluateResult, HermesEvidence } from "@expo98/protocols"
import { Effect, Layer } from "effect"

const ROOT = "/proj"

/** A `present` install state (the only one that can reach `ready`). */
const presentInstall: InstallStateResult = {
  status: "present",
  issue: null,
  expoPresent: true,
  metadataPresent: true,
  sourcePresent: true,
  bridgeVersion: "1.0.0",
  schemaVersion: 1,
  developmentOnly: true,
}

const installWith = (over: Partial<InstallStateResult>): InstallStateResult => ({
  ...presentInstall,
  ...over,
})

/** Fake `HermesEvidence` returning a fixed result. */
const hermesLayer = (result: CdpEvaluateResult) =>
  Layer.succeed(HermesEvidence, HermesEvidence.of({ evaluateReadOnly: () => Effect.succeed(result) }))

const ok = (value: unknown): CdpEvaluateResult => ({
  available: true,
  result: { value, url: "ws://127.0.0.1:8081/x" },
})

const fail = (error: string): CdpEvaluateResult => ({
  available: false,
  error,
  diagnostics: { attemptedUrls: ["ws://127.0.0.1:8081/x"] },
})

/** A healthy registration probe value. */
const registered = {
  bridgePresent: true,
  registered: true,
  devMode: "true",
  version: "1.0.0",
  schemaVersion: 1,
}

const run = (input: Parameters<typeof bridgeHealth>[0], hermes: CdpEvaluateResult, fs?: Fs["Type"]) =>
  Effect.gen(function* () {
    const realFs = fs ?? (yield* makeMemoryFs())
    return yield* bridgeHealth(input).pipe(Effect.provide(Layer.merge(hermesLayer(hermes), Layer.succeed(Fs, realFs))))
  })

describe("AC-028 bridge runtime-health ordered state machine", () => {
  it.effect("step 1 install-state stale → unavailable(stale-bridge) BEFORE probing", () =>
    Effect.gen(function* () {
      const result = (yield* run(
        { root: ROOT, installState: installWith({ status: "stale", issue: "partial-install" }), attemptedUrls: ["x"] },
        ok(registered),
      )) as HealthUnavailable
      expect(result.available).toBe(false)
      expect(result.step).toBe("install-state")
      expect(result.code).toBe("stale-bridge")
    }),
  )

  it.effect("step 1 install-state incompatible → unavailable(incompatible-project)", () =>
    Effect.gen(function* () {
      const result = (yield* run(
        {
          root: ROOT,
          installState: installWith({ status: "incompatible", issue: "not-development-only" }),
          attemptedUrls: ["x"],
        },
        ok(registered),
      )) as HealthUnavailable
      expect(result.step).toBe("install-state")
      expect(result.code).toBe("incompatible-project")
    }),
  )

  it.effect("step 2 transport no Hermes target (no urls) → no-runtime-target", () =>
    Effect.gen(function* () {
      const result = (yield* run(
        { root: ROOT, installState: presentInstall, attemptedUrls: [] },
        fail("nothing"),
      )) as HealthUnavailable
      expect(result.step).toBe("transport")
      expect(result.code).toBe("no-runtime-target")
    }),
  )

  it.effect("step 2 transport failure (urls present, eval failed) → transport-failure", () =>
    Effect.gen(function* () {
      const result = (yield* run(
        { root: ROOT, installState: presentInstall, attemptedUrls: ["ws://127.0.0.1:8081/x"] },
        fail("connection reset"),
      )) as HealthUnavailable
      expect(result.step).toBe("transport")
      expect(result.code).toBe("transport-failure")
    }),
  )

  it.effect("step 3 registration: bridge global absent → missing-bridge", () =>
    Effect.gen(function* () {
      const result = (yield* run(
        { root: ROOT, installState: presentInstall, attemptedUrls: ["x"] },
        ok({ bridgePresent: false }),
      )) as HealthUnavailable
      expect(result.step).toBe("registration")
      expect(result.code).toBe("missing-bridge")
    }),
  )

  it.effect("step 3 registration: bridge present but registration field absent → missing-registration", () =>
    Effect.gen(function* () {
      const result = (yield* run(
        { root: ROOT, installState: presentInstall, attemptedUrls: ["x"] },
        ok({ bridgePresent: true, registered: false, devMode: "true" }),
      )) as HealthUnavailable
      expect(result.step).toBe("registration")
      expect(result.code).toBe("missing-registration")
    }),
  )

  it.effect("step 4 version mismatch → version-mismatch", () =>
    Effect.gen(function* () {
      const result = (yield* run(
        { root: ROOT, installState: presentInstall, attemptedUrls: ["x"] },
        ok({ bridgePresent: true, registered: true, devMode: "true", version: "0.9.0", schemaVersion: 1 }),
      )) as HealthUnavailable
      expect(result.step).toBe("version")
      expect(result.code).toBe("version-mismatch")
    }),
  )

  it.effect("all checks pass → ready: reports read/write domains, redaction boundaries, policy requirements", () =>
    Effect.gen(function* () {
      const result = (yield* run(
        { root: ROOT, installState: presentInstall, attemptedUrls: ["x"] },
        ok(registered),
      )) as HealthReady
      expect(result.available).toBe(true)
      expect(result.step).toBe("ready")
      expect(result.bridgeVersion).toBe("1.0.0")
      expect(result.schemaVersion).toBe(1)
      expect(result.readDomains).toContain("storage")
      expect(result.readDomains).toContain("navigation")
      expect(result.writeDomains).toEqual(["storage", "state", "controls"])
      expect(result.redactionBoundaries.length).toBeGreaterThan(0)
      expect(result.policyRequirements["source-write"]).toContain("confirmation")
    }),
  )

  it.effect("AC-028 ordering: install-state short-circuits BEFORE the transport probe is consulted", () =>
    Effect.gen(function* () {
      // A Hermes layer that FAILS the test if it is ever invoked. A stale install
      // must resolve at step 1 without touching the transport.
      let probed = false
      const spyHermes = Layer.succeed(
        HermesEvidence,
        HermesEvidence.of({
          evaluateReadOnly: () =>
            Effect.sync(() => {
              probed = true
            }).pipe(Effect.as(ok(registered))),
        }),
      )
      const fs = yield* makeMemoryFs()
      const result = (yield* bridgeHealth({
        root: ROOT,
        installState: installWith({ status: "stale", issue: "version-mismatch" }),
        attemptedUrls: ["x"],
      }).pipe(Effect.provide(Layer.merge(spyHermes, Layer.succeed(Fs, fs))))) as HealthUnavailable
      expect(result.code).toBe("stale-bridge")
      expect(probed).toBe(false)
    }),
  )
})

describe("AC-009 the generated bridge is development-only", () => {
  it.effect("AC-009 install-state not-development-only → incompatible-project at step 1", () =>
    Effect.gen(function* () {
      const result = (yield* run(
        {
          root: ROOT,
          installState: installWith({ status: "incompatible", issue: "not-development-only" }),
          attemptedUrls: ["x"],
        },
        ok(registered),
      )) as HealthUnavailable
      expect(result.step).toBe("install-state")
      expect(result.code).toBe("incompatible-project")
    }),
  )

  it.effect("AC-009 runtime: __DEV__ undefined → development-mode-required (refuses to register)", () =>
    Effect.gen(function* () {
      const result = (yield* run(
        { root: ROOT, installState: presentInstall, attemptedUrls: ["x"] },
        ok({ bridgePresent: true, registered: false, devMode: "undefined" }),
      )) as HealthUnavailable
      expect(result.step).toBe("registration")
      expect(result.code).toBe("development-mode-required")
    }),
  )

  it.effect("AC-009 runtime: __DEV__ === false → production-build (refuses to register)", () =>
    Effect.gen(function* () {
      const result = (yield* run(
        { root: ROOT, installState: presentInstall, attemptedUrls: ["x"] },
        ok({ bridgePresent: true, registered: false, devMode: "false" }),
      )) as HealthUnavailable
      expect(result.step).toBe("registration")
      expect(result.code).toBe("production-build")
    }),
  )

  it.effect("AC-009 the generated source exposes registerExpo98DevtoolsBridge as the only registration path", () =>
    Effect.gen(function* () {
      const { bridgeSourceContents } = yield* Effect.promise(() => import("@expo98/expo-integration"))
      const src = bridgeSourceContents()
      expect(src).toContain("registerExpo98DevtoolsBridge")
      expect(src).toContain("development-mode-required")
      expect(src).toContain("production-build")
      expect(src).toContain("__EXPO98_DEVTOOLS_BRIDGE__")
    }),
  )

  it.skip("AC-028 live bridge runtime registration probe against running Hermes", () => {
    // Requires a running Metro/Hermes target + an installed in-app bridge.
  })
})
