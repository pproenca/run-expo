/**
 * Network evidence shape validation (AC-022) — PURE.
 *
 * Validates the SHAPE of network evidence harvested over CDP before it is redacted/emitted. This is
 * the transport-side gate from AC-022; redaction (AC-012/003) happens later in `@expo98/core`'s
 * Redaction Service (NOT here — that is the single output boundary).
 *
 * INTEGRATION SEAM (@expo98/core): the validated evidence returned here is handed to core's
 * Redaction Service before anything leaves the process. This package only validates structure.
 *
 * Outcomes (stable `code`s), in evaluation order:
 *   - no Hermes target / no evaluator  -> `no-runtime-target` (or `transport-failure` when a
 *     transport fault is the cause).
 *   - non-object payload OR non-array `requests`  -> `malformed-payload`.
 *   - empty observed traffic (zero requests)  -> `no-observed-traffic`.
 *   - else  -> validated.
 *
 * Clamps: `metroPort` 1..65535 (default 8081); `limit` 1..1000 (default 100). The last `limit`
 * entries are kept (AC-039 take-last semantics).
 */
import { clamp, resolveMetroPort } from "./loopback.js";

export const MIN_LIMIT = 1 as const;
export const MAX_LIMIT = 1_000 as const;
export const DEFAULT_LIMIT = 100 as const;

/** Resolve a request/console limit: `clamp(limit ?? 100, 1, 1000)` (AC-039). PURE. */
export const resolveLimit = (limit: number | undefined | null): number => {
  if (limit === undefined || limit === null || !Number.isFinite(limit)) {
    return DEFAULT_LIMIT;
  }
  return clamp(Math.trunc(limit), MIN_LIMIT, MAX_LIMIT);
};

export type NetworkUnavailableCode =
  | "no-runtime-target"
  | "transport-failure"
  | "malformed-payload"
  | "no-observed-traffic";

export interface NetworkEvidenceUnavailable {
  readonly available: false;
  readonly code: NetworkUnavailableCode;
  readonly reason: string;
}

export interface NetworkEvidenceValidated {
  readonly available: true;
  readonly metroPort: number;
  readonly limit: number;
  /** The (limited) raw request rows — UNREDACTED; redaction is core's job at the boundary. */
  readonly requests: ReadonlyArray<unknown>;
  /** True iff the input was truncated to `limit` entries. */
  readonly truncated: boolean;
}

export type NetworkEvidenceResult = NetworkEvidenceUnavailable | NetworkEvidenceValidated;

/** The transport context for a network harvest: whether a Hermes target/evaluator existed. */
export interface NetworkEvidenceInput {
  /** False when there was no Hermes debug target to talk to. */
  readonly hasRuntimeTarget: boolean;
  /** True when a transport fault (refused/timeout) occurred while harvesting. */
  readonly transportFailed?: boolean;
  /** The raw payload the in-app collector returned (expected `{ requests: [...] }`). */
  readonly payload: unknown;
  readonly metroPort?: number;
  readonly limit?: number;
}

const REASONS: Record<NetworkUnavailableCode, string> = {
  "no-runtime-target": "No Hermes runtime target was available to collect network evidence.",
  "transport-failure": "The CDP transport failed while collecting network evidence.",
  "malformed-payload": "Network evidence payload was not an object with a requests array.",
  "no-observed-traffic": "No network traffic has been observed yet.",
};

const unavailable = (code: NetworkUnavailableCode): NetworkEvidenceUnavailable => ({
  available: false,
  code,
  reason: REASONS[code],
});

/**
 * Validate network evidence shape (AC-022). PURE — no I/O.
 */
export const validateNetworkEvidence = (
  input: NetworkEvidenceInput,
): NetworkEvidenceResult => {
  const metroPort = resolveMetroPort(input.metroPort);
  const limit = resolveLimit(input.limit);

  // (1) no target / no evaluator -> transport-failure (if a fault) else no-runtime-target.
  if (input.transportFailed === true) {
    return unavailable("transport-failure");
  }
  if (!input.hasRuntimeTarget) {
    return unavailable("no-runtime-target");
  }

  // (2) non-object payload OR non-array `requests` -> malformed-payload.
  const payload = input.payload;
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return unavailable("malformed-payload");
  }
  const requests = (payload as Record<string, unknown>)["requests"];
  if (!Array.isArray(requests)) {
    return unavailable("malformed-payload");
  }

  // (3) empty observed traffic -> no-observed-traffic.
  if (requests.length === 0) {
    return unavailable("no-observed-traffic");
  }

  // (4) validated: take the LAST `limit` entries (AC-039).
  const truncated = requests.length > limit;
  const limited = truncated ? requests.slice(requests.length - limit) : requests;

  return {
    available: true,
    metroPort,
    limit,
    requests: limited,
    truncated,
  };
};
