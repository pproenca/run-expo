/**
 * `@expo98/protocols` — the DEVICE-PROTOCOL services of the Effect-TS expo98 rebuild.
 *
 *   S8 Metro Probe  (loopback-only HTTP probes; AC-021, AC-038)
 *   S9 Hermes CDP   (loopback-enforced WS + connect-time Origin + bounded open; AC-030, AC-022)
 *
 * The S9 transport is a thin `ws` adapter behind a `Context.Tag` (the SPIKE decision — see SPIKE.md
 * / finding M1). The CDP eval surface is SPLIT into a read-eval evidence capability and a
 * runtime-eval mutation capability the dispatcher withholds (see cdp.ts header + README).
 */

// Pure primitives (loopback allowlist, port clamp) — shared by S8 + S9.
export {
  LOOPBACK_HOSTS,
  DEFAULT_METRO_PORT,
  MIN_PORT,
  MAX_PORT,
  isLoopbackHost,
  checkLoopbackUrl,
  type LoopbackUrlResult,
  clamp,
  resolveMetroPort,
  loopbackMetroBaseUrl,
} from "./loopback.js"

// Typed failures.
export { LoopbackViolation, HttpTransportError, CdpSocketError, CdpMalformedFrame, CdpProtocolError } from "./errors.js"

// S8 — Metro Probe.
export {
  MetroProbe,
  MetroProbeLayer,
  MetroHttpClient,
  type MetroHttpRequest,
  type MetroHttpResponse,
  type MetroTarget,
  type MalformedTarget,
  type MetroTargetsResult,
  type MetroStatusResult,
  type MetroVersionResult,
  type MetroSymbolicateResult,
} from "./metro.js"

// S9 — Hermes CDP (split surface).
export {
  HermesEvidence,
  HermesEvidenceLayer,
  HermesReadOnlyExpression,
  HermesRuntimeEval,
  HermesRuntimeEvalLayer,
  assertLoopbackUrl,
  boundedOpenMs,
  originForPort,
  MAX_OPEN_MS,
  DEFAULT_EVAL_TIMEOUT_MS,
  MALFORMED_PREVIEW_CHARS,
  type CdpEvaluateOptions,
  type CdpEvaluation,
  type CdpEvaluateResult,
  type CdpUnavailable,
  type CdpFailureDiagnostics,
} from "./cdp.js"

// S9 — the CDP socket port (the dependency-agnostic seam) + the `ws` adapter (the spike decision).
export { CdpSocketFactory, type CdpSocket, type CdpConnectOptions } from "./cdp-socket.js"
export { WsCdpSocketFactoryLayer } from "./ws-adapter.js"

// Network evidence shape validation (AC-022) — pure.
export {
  validateNetworkEvidence,
  resolveLimit,
  MIN_LIMIT,
  MAX_LIMIT,
  DEFAULT_LIMIT,
  type NetworkEvidenceInput,
  type NetworkEvidenceResult,
  type NetworkEvidenceValidated,
  type NetworkEvidenceUnavailable,
  type NetworkUnavailableCode,
} from "./network-evidence.js"
