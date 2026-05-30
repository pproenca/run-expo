/**
 * `domain-actions` — bridge storage / state / controls actions (AC-006).
 *
 * Per-action side-effect classes (the gate driver):
 *   - storage `list`/`get`  → read ; any other storage action → device
 *   - state   `list`        → read ; any other state action   → device
 *   - controls `press`      → device ; any other controls action → read
 *
 * Gating (fail-closed, AC-006):
 *   1. Classify the action and build a core `Command` with that descriptor.
 *   2. Run it through core `dispatch`; a denied mutate never executes the
 *      handler, so the bridge is not consulted.
 *   3. Allowed mutates require the device capability in the handler `R`, proving
 *      that only the dispatch gate-pass branch can run the bridge call.
 *   4. Re-check the gate after the bridge call as defense-in-depth, then surface
 *      bounded evidence.
 *
 * The bridge is reached via the `BridgeTransport` SEAM (Expo DevTools Plugins SDK
 * in production); it is the READ/evidence channel, NOT a dangerous capability —
 * the policy gate above is what authorises a mutate, enforced before any call.
 */
import {
  command,
  type Command,
  type CommandDescriptor,
  type DispatchResult,
  dispatch,
  DeviceCapability,
  gate,
  policyDeniedPayload,
  type PolicyDeniedPayload,
  type PolicyDocument,
  RuntimeEvalCapability,
  SourceWriteCapability,
  type SideEffect,
} from "@expo98/core"
import { Effect } from "effect"
import { boundBridgeValue } from "./bound.js"
import {
  BridgeTransport,
  type BridgeCallResult,
  type BridgeTransportService,
  type BridgeUnavailableCode,
} from "./bridge-transport.js"

export type DomainName = "storage" | "state" | "controls"
type DomainActionSideEffect = "read" | "device"

/** Read actions per domain (everything else in that domain is a mutate). */
const READ_ACTIONS: Readonly<Record<DomainName, ReadonlyArray<string>>> = {
  storage: ["list", "get"],
  state: ["list"],
  controls: ["describe"],
}

/** Device (mutating) actions per domain — only meaningful for `controls`. */
const DEVICE_ACTIONS: Readonly<Record<DomainName, ReadonlyArray<string>>> = {
  storage: [],
  state: [],
  controls: ["press"],
}

/** Classify a `domain/action` into its side-effect class (AC-006). */
export const domainActionSideEffect = (domain: DomainName, action: string): DomainActionSideEffect => {
  if (domain === "controls") {
    return READ_ACTIONS.controls.includes(action) ? "read" : "device"
  }
  // storage/state: listed read actions → read, else device (mutate).
  return READ_ACTIONS[domain].includes(action) ? "read" : "device"
}

export interface DomainActionInput {
  readonly domain: DomainName
  readonly action: string
  readonly args?: Readonly<Record<string, unknown>>
  readonly metroPort?: number
  readonly target?: string | null
  readonly policy: PolicyDocument
}

export interface DomainActionEvidence {
  readonly domain: DomainName
  readonly action: string
  readonly sideEffect: SideEffect
  readonly metroPort: number | null
  readonly target: string | null
  readonly transport: "expo-devtools-bridge"
  readonly evidenceSource: "bridge"
  readonly policy: PolicyDocument
  readonly available: boolean
  /** The bridge value, redacted-at-boundary + size-bounded. */
  readonly value: unknown
  readonly code?: BridgeUnavailableCode
}

export type DomainActionResult = DomainActionEvidence | PolicyDeniedPayload

const TRANSPORT = "expo-devtools-bridge" as const
const EVIDENCE_SOURCE = "bridge" as const

/** The policy-gate action key for a domain action (`<domain>.<action>`). */
export const domainActionKey = (domain: DomainName, action: string): string => `${domain}.${action}`

const evidence = (input: DomainActionInput, sideEffect: SideEffect, call: BridgeCallResult): DomainActionEvidence => ({
  domain: input.domain,
  action: input.action,
  sideEffect,
  metroPort: input.metroPort ?? null,
  target: input.target ?? null,
  transport: TRANSPORT,
  evidenceSource: EVIDENCE_SOURCE,
  policy: input.policy,
  available: call.available,
  value: boundBridgeValue(call.value),
  ...(call.code !== undefined ? { code: call.code } : {}),
})

const internalCapabilities = <A>(
  effect: Effect.Effect<A, never, DeviceCapability | RuntimeEvalCapability | SourceWriteCapability>,
): Effect.Effect<A> =>
  effect.pipe(
    Effect.provideService(
      DeviceCapability,
      DeviceCapability.of({
        invoke: () => Effect.dieMessage("domain action dispatch injected device capability unexpectedly"),
      }),
    ),
    Effect.provideService(
      RuntimeEvalCapability,
      RuntimeEvalCapability.of({
        evaluate: () => Effect.dieMessage("domain action dispatch injected runtime-eval capability unexpectedly"),
      }),
    ),
    Effect.provideService(
      SourceWriteCapability,
      SourceWriteCapability.of({
        writeFile: () => Effect.dieMessage("domain action dispatch injected source-write capability unexpectedly"),
        deleteFile: () => Effect.dieMessage("domain action dispatch injected source-write capability unexpectedly"),
      }),
    ),
  )

const buildDomainCommand = (
  input: DomainActionInput,
  transport: BridgeTransportService,
): Command<"read", DomainActionResult> | Command<"device", DomainActionResult> => {
  const { action, domain, policy } = input
  const sideEffect = domainActionSideEffect(domain, action)
  const descriptor: CommandDescriptor & { readonly sideEffect: typeof sideEffect } = {
    action: domainActionKey(domain, action),
    sideEffect,
  }
  const runBridge = Effect.gen(function* () {
    const call = yield* transport.call(domain, action, input.args ?? {})
    if (sideEffect !== "read" && gate(descriptor, policy)._tag === "deny") {
      return policyDeniedPayload(`Policy denied action "${descriptor.action}" (defense-in-depth).`, policy)
    }
    return evidence(input, sideEffect, call)
  })

  return sideEffect === "read"
    ? command(descriptor as CommandDescriptor & { readonly sideEffect: "read" }, runBridge)
    : command(
        descriptor as CommandDescriptor & { readonly sideEffect: "device" },
        DeviceCapability.pipe(Effect.flatMap(() => runBridge)),
      )
}

/**
 * Run a bridge storage/state/controls action through core dispatch. A denied
 * mutate returns a `policyDeniedPayload` without touching the bridge; allowed
 * actions return size-bounded bridge evidence.
 */
export const runDomainAction = (input: DomainActionInput): Effect.Effect<DomainActionResult, never, BridgeTransport> =>
  Effect.gen(function* () {
    const transport = yield* BridgeTransport
    const result: DispatchResult<DomainActionResult> = yield* dispatch(
      buildDomainCommand(input, transport),
      input.policy,
    ).pipe(internalCapabilities)
    return result.payload as DomainActionResult
  })
