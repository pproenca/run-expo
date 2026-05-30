import { Fs } from "@expo98/domain"
/**
 * `health` — bridge RUNTIME-HEALTH state machine (AC-028, brief Q#12).
 *
 * The REAL ordered state machine (the legacy stub returned a flat
 * `available:false`; we build it for real). Each step can short-circuit to a
 * stable unavailable code BEFORE the next runs:
 *
 *   1. install-state  : stale → `stale-bridge`; incompatible → `incompatible-project`
 *                       (fail-closed BEFORE probing the device at all).
 *   2. transport      : no Hermes target → `no-runtime-target`;
 *                       transport failure → `transport-failure`.
 *   3. registration   : bridge global absent      → `missing-bridge`;
 *                       registration field absent  → `missing-registration`;
 *                       AC-009 runtime dev gate: `__DEV__` undefined →
 *                       `development-mode-required`; `__DEV__` === false →
 *                       `production-build`.
 *   4. version        : registered version/schema != expected → `version-mismatch`.
 *   5. all pass       : report read/write domains, redaction boundaries, policy
 *                       requirements.
 *
 * The Hermes probe is the `HermesEvidence` SEAM from `@expo98/protocols` (loopback
 * CDP, package-controlled read-only expression). `// SEAM (Expo SDK)`: a live
 * probe needs a running Metro/Hermes target; tests inject a fake `HermesEvidence`.
 */
import { type CdpEvaluateResult, HermesEvidence, HermesReadOnlyExpression } from "@expo98/protocols"
import { Effect } from "effect"
import { BRIDGE_DOMAINS, BRIDGE_SCHEMA_VERSION, EXPO98_BRIDGE_VERSION } from "./bridge-files.js"
import { type InstallStateResult, readInstallState } from "./install-state.js"

/** Stable unavailable codes for the health machine (AC-028 + AC-009). */
export type HealthUnavailableCode =
  | "stale-bridge"
  | "incompatible-project"
  | "bridge-not-installed"
  | "no-runtime-target"
  | "transport-failure"
  | "missing-bridge"
  | "missing-registration"
  | "version-mismatch"
  | "development-mode-required"
  | "production-build"

/** The step at which the machine resolved (for diagnostics/ordering proof). */
export type HealthStep = "install-state" | "transport" | "registration" | "version" | "ready"

export interface HealthUnavailable {
  readonly available: false
  readonly step: HealthStep
  readonly code: HealthUnavailableCode
  readonly reason: string
}

export interface HealthReady {
  readonly available: true
  readonly step: "ready"
  readonly bridgeVersion: string
  readonly schemaVersion: number
  /** Domains the bridge can READ. */
  readonly readDomains: ReadonlyArray<string>
  /** Domains the bridge can WRITE (gated by policy). */
  readonly writeDomains: ReadonlyArray<string>
  /** Where redaction is applied before any value leaves the process. */
  readonly redactionBoundaries: ReadonlyArray<string>
  /** Policy requirements per side-effect class. */
  readonly policyRequirements: Readonly<Record<string, string>>
}

export type HealthResult = HealthUnavailable | HealthReady

/**
 * The shape the package-controlled read-only registration probe returns from the
 * app, parsed from the `HermesEvidence` value. All fields optional/defensive.
 */
interface RegistrationProbe {
  /** Was `globalThis.__EXPO98_DEVTOOLS_BRIDGE__` present at all? */
  readonly bridgePresent?: boolean
  /** Was the registration object populated? */
  readonly registered?: boolean
  /** The runtime `__DEV__` state: "undefined" | "false" | "true". */
  readonly devMode?: "undefined" | "false" | "true"
  readonly version?: string
  readonly schemaVersion?: number
}

/** Read-domains: everything the bridge advertises. Write-domains: the mutable subset. */
const WRITE_DOMAINS: ReadonlyArray<string> = ["storage", "state", "controls"]

const readyPayload = (): HealthReady => ({
  available: true,
  step: "ready",
  bridgeVersion: EXPO98_BRIDGE_VERSION,
  schemaVersion: BRIDGE_SCHEMA_VERSION,
  readDomains: BRIDGE_DOMAINS,
  writeDomains: WRITE_DOMAINS,
  redactionBoundaries: ["dispatch-output-boundary", "run-record-write"],
  policyRequirements: {
    read: "no policy required",
    device: "policy allow for the exact action",
    "runtime-eval": "policy allow OR --allow-runtime-eval",
    "source-write": "policy allow AND confirmation token",
  },
})

const unavailable = (step: HealthStep, code: HealthUnavailableCode, reason: string): HealthUnavailable => ({
  available: false,
  step,
  code,
  reason,
})

/** Package-controlled read-only probe id (the legitimate `read` use). */
export const REGISTRATION_PROBE_EXPRESSION = HermesReadOnlyExpression.BridgeRegistrationProbe

const parseProbe = (value: unknown): RegistrationProbe => {
  if (typeof value !== "object" || value === null) {
    return {}
  }
  const r = value as Record<string, unknown>
  return {
    bridgePresent: typeof r["bridgePresent"] === "boolean" ? r["bridgePresent"] : undefined,
    registered: typeof r["registered"] === "boolean" ? r["registered"] : undefined,
    devMode:
      r["devMode"] === "undefined" || r["devMode"] === "false" || r["devMode"] === "true" ? r["devMode"] : undefined,
    version: typeof r["version"] === "string" ? r["version"] : undefined,
    schemaVersion: typeof r["schemaVersion"] === "number" ? r["schemaVersion"] : undefined,
  }
}

export interface HealthInput {
  readonly root: string
  readonly metroPort?: number
  /** `webSocketDebuggerUrl`s from Metro /json/list (loopback-enforced downstream). */
  readonly attemptedUrls?: ReadonlyArray<string>
}

/**
 * Run the ordered runtime-health state machine. `Fs` is needed only when the
 * install state isn't supplied; `HermesEvidence` is the CDP probe seam.
 */
export const bridgeHealth = (input: HealthInput): Effect.Effect<HealthResult, never, HermesEvidence | Fs> =>
  Effect.gen(function* () {
    // ── Step 1: install-state (fail-closed BEFORE probing the device) ──
    const install = yield* readInstallState(input.root)
    if (install.status === "stale") {
      return unavailable("install-state", "stale-bridge", `Bridge install is stale (${install.issue ?? "stale"}).`)
    }
    if (install.status === "incompatible") {
      // AC-009: developmentOnly !== true lands here as not-development-only.
      return unavailable(
        "install-state",
        "incompatible-project",
        `Bridge install is incompatible (${install.issue ?? "incompatible"}).`,
      )
    }
    if (install.status === "absent") {
      return unavailable("install-state", "bridge-not-installed", "Bridge is not installed in this project.")
    }

    // ── Step 2: transport (Hermes target + CDP round-trip) ──
    const hermes = yield* HermesEvidence
    const evalResult: CdpEvaluateResult = yield* hermes.evaluateReadOnly(REGISTRATION_PROBE_EXPRESSION, {
      attemptedUrls: input.attemptedUrls ?? [],
      metroPort: input.metroPort,
    })
    if (evalResult.available === false) {
      const noTarget = (input.attemptedUrls ?? []).length === 0
      return noTarget
        ? unavailable("transport", "no-runtime-target", "No Hermes runtime target was found.")
        : unavailable("transport", "transport-failure", evalResult.error)
    }

    // ── Step 3: registration (bridge present + registered + AC-009 dev gate) ──
    const probe = parseProbe(evalResult.result.value)
    if (probe.bridgePresent !== true) {
      return unavailable("registration", "missing-bridge", "The in-app bridge global is not present.")
    }
    // AC-009 runtime dev gate (mirrors `registerExpo98DevtoolsBridge`).
    if (probe.devMode === "undefined") {
      return unavailable(
        "registration",
        "development-mode-required",
        "__DEV__ is undefined; the bridge refuses to register.",
      )
    }
    if (probe.devMode === "false") {
      return unavailable(
        "registration",
        "production-build",
        "__DEV__ is false; the bridge refuses to register in a production build.",
      )
    }
    if (probe.registered !== true) {
      return unavailable("registration", "missing-registration", "The bridge global is present but not registered.")
    }

    // ── Step 4: version (registered version/schema must match) ──
    if (probe.version !== EXPO98_BRIDGE_VERSION || probe.schemaVersion !== BRIDGE_SCHEMA_VERSION) {
      return unavailable(
        "version",
        "version-mismatch",
        `Registered bridge version ${probe.version ?? "?"}/${
          probe.schemaVersion ?? "?"
        } does not match ${EXPO98_BRIDGE_VERSION}/${BRIDGE_SCHEMA_VERSION}.`,
      )
    }

    // ── Step 5: all checks pass → ready ──
    return readyPayload()
  })
