/**
 * Typed failures for the device-protocol services (S8 Metro, S9 Hermes CDP).
 *
 * These are the `E` channel of the protocol Effects. Designed-unavailable evidence (e.g. Metro
 * unreachable, no Hermes target) is NOT modeled as an error — it is a successful payload with
 * `available:false` + a stable `code` (the "couldn't, here's why" contract). Errors here are for
 * genuine transport faults the caller must handle.
 */
import { Data } from "effect";

/** A non-loopback target was rejected before connecting (AC-030 / AC-021 enforcement). */
export class LoopbackViolation extends Data.TaggedError("LoopbackViolation")<{
  readonly host: string | null;
  readonly url: string;
  readonly reason: string;
}> {}

/** The injected HTTP port (S8) failed at the transport layer (connection refused, abort, etc.). */
export class HttpTransportError extends Data.TaggedError("HttpTransportError")<{
  readonly url: string;
  readonly cause: unknown;
}> {}

/** A CDP socket failed to open, write, or closed unexpectedly. */
export class CdpSocketError extends Data.TaggedError("CdpSocketError")<{
  readonly url: string;
  readonly reason: "Open" | "OpenTimeout" | "Write" | "Read" | "Close";
  readonly cause: unknown;
}> {}

/**
 * A CDP frame arrived that could not be parsed as JSON. Per AC-030 the raw payload is truncated to
 * 1000 chars before it is surfaced (so a giant/garbage frame can't blow the output budget).
 */
export class CdpMalformedFrame extends Data.TaggedError("CdpMalformedFrame")<{
  /** Raw frame text, already truncated to <=1000 chars. */
  readonly rawTruncated: string;
}> {}

/** The Chrome DevTools Protocol returned an `error` object for a correlated request id. */
export class CdpProtocolError extends Data.TaggedError("CdpProtocolError")<{
  readonly code: number | null;
  readonly message: string;
}> {}
