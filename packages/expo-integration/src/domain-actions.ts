/**
 * `domain-actions` — bridge storage / state / controls actions (AC-006).
 *
 * Per-action side-effect classes (the gate driver):
 *   - storage `list`/`get`  → read ; any other storage action → device
 *   - state   `list`        → read ; any other state action   → device
 *   - controls `press`      → device ; any other controls action → read
 *
 * Gating (fail-closed, AC-006):
 *   1. Classify the action.
 *   2. If NON-read and the policy does not allow the EXACT action →
 *      `policyDeniedPayload` and DO NOT call the bridge (capability withheld).
 *   3. Otherwise call the bridge, then DEFENSE-IN-DEPTH re-check: if the action
 *      is non-read and policy still isn't allowed, re-deny (a second, independent
 *      gate so a classification regression can't slip a mutate through).
 *   4. Surface the bridge value REDACTED (by core at the boundary) + SIZE-BOUNDED
 *      (`MAX_OUTPUT`/`MAX_ARRAY_ITEMS`), tagged with
 *      `domain/action/metroPort/target/transport/evidenceSource/policy`.
 *
 * The bridge is reached via the `BridgeTransport` SEAM (Expo DevTools Plugins SDK
 * in production); it is the READ/evidence channel, NOT a dangerous capability —
 * the policy gate above is what authorises a mutate, enforced before any call.
 */
import { gate, policyDeniedPayload, type PolicyDeniedPayload, type PolicyDocument, type SideEffect } from "@expo98/core"
import { Effect } from "effect"
import { boundBridgeValue } from "./bound.js"
import { BridgeTransport, type BridgeCallResult, type BridgeUnavailableCode } from "./bridge-transport.js"

export type DomainName = "storage" | "state" | "controls"

/** Read actions per domain (everything else in that domain is a mutate). */
const READ_ACTIONS: Readonly<Record<DomainName, ReadonlyArray<string>>> = {
  storage: ["list", "get"],
  state: ["list"],
  // controls is inverted: `press` is the only device action; the rest are reads.
  controls: [],
}

/** Device (mutating) actions per domain — only meaningful for `controls`. */
const DEVICE_ACTIONS: Readonly<Record<DomainName, ReadonlyArray<string>>> = {
  storage: [],
  state: [],
  controls: ["press"],
}

/** Classify a `domain/action` into its side-effect class (AC-006). */
export const domainActionSideEffect = (domain: DomainName, action: string): SideEffect => {
  if (domain === "controls") {
    // `press` → device, everything else → read.
    return DEVICE_ACTIONS.controls.includes(action) ? "device" : "read"
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

/** Is this non-read action allowed by the policy? (the gate predicate.) */
const nonReadAllowed = (
  domain: DomainName,
  action: string,
  sideEffect: SideEffect,
  policy: PolicyDocument,
): boolean => {
  const descriptor = { action: domainActionKey(domain, action), sideEffect }
  return gate(descriptor, policy)._tag === "allow"
}

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

/**
 * Run a bridge storage/state/controls action with the AC-006 gate. Returns a
 * `policyDeniedPayload` (without touching the bridge) for a withheld mutate, else
 * the size-bounded bridge evidence.
 */
export const runDomainAction = (input: DomainActionInput): Effect.Effect<DomainActionResult, never, BridgeTransport> =>
  Effect.gen(function* () {
    const { action, domain, policy } = input
    const sideEffect = domainActionSideEffect(domain, action)
    const isRead = sideEffect === "read"
    const actionKey = domainActionKey(domain, action)

    // 1. First gate: a non-read action needs an explicit policy allow.
    if (!isRead && !nonReadAllowed(domain, action, sideEffect, policy)) {
      // CAPABILITY WITHHELD: the bridge is NEVER consulted for a denied mutate.
      return policyDeniedPayload(`Policy denied action.`, policy)
    }

    // 2. Allowed (or read): consult the bridge transport.
    const transport = yield* BridgeTransport
    const call = yield* transport.call(domain, action, input.args ?? {})

    // 3. DEFENSE-IN-DEPTH: re-check the gate after the call so a classification
    //    drift cannot surface a mutate's result without an allow.
    if (!isRead && !nonReadAllowed(domain, action, sideEffect, policy)) {
      return policyDeniedPayload(`Policy denied action "${actionKey}" (defense-in-depth).`, policy)
    }

    // 4. Surface bounded evidence (redaction happens at core's output boundary).
    return evidence(input, sideEffect, call)
  })
