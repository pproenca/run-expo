/**
 * `bridge-transport` — the in-app devtools bridge transport SEAM.
 *
 * A `Context.Tag` representing the channel that calls a domain/action on the
 * running app's installed bridge and returns its raw value. This is the seam the
 * official Expo DevTools Plugins SDK fills (brief Q#10):
 *
 *   `// SEAM (Expo SDK)`: the production `BridgeTransport` is backed by the Expo
 *   DevTools Plugins SDK delivering a message to the in-app bridge over the dev
 *   client connection. Tests inject a fake transport. The bridge is reached over
 *   loopback CDP underneath (`@expo98/protocols`), which is why the runtime-health
 *   machine probes Hermes via `HermesEvidence` before trusting this transport.
 *
 * Crucially this tag is NOT one of core's dangerous capability tags: it is the
 * READ/evidence channel. State-MUTATING domain actions are still gated by core's
 * policy gate (their side-effect class is `device`/`write`), and the gate is
 * enforced BEFORE this transport is ever consulted (AC-006). A denied action
 * never calls the transport.
 */
import { Context, type Effect } from "effect"

export interface BridgeCallResult {
  /** Whether the bridge responded successfully. */
  readonly available: boolean
  /** The raw value returned by the bridge (unbounded, un-redacted). */
  readonly value: unknown
  /** A stable unavailable code when `available` is false. */
  readonly code?: BridgeUnavailableCode
}

export type BridgeUnavailableCode =
  | "no-runtime-target"
  | "transport-failure"
  | "version-mismatch"
  | "missing-domain"
  | "unavailable-bridge"

export interface BridgeTransportService {
  /** Call `domain/action` on the in-app bridge with optional args. */
  readonly call: (
    domain: string,
    action: string,
    args: Readonly<Record<string, unknown>>
  ) => Effect.Effect<BridgeCallResult>
}

export class BridgeTransport extends Context.Tag("@expo98/expo-integration/BridgeTransport")<
  BridgeTransport,
  BridgeTransportService
>() {}
