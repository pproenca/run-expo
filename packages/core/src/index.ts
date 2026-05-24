/**
 * `@expo98/core` — the SAFETY SPINE of the Effect-TS rebuild.
 *
 * Public surface: the 4-tier policy classifier + fail-closed gate (S4), the
 * single strongest-superset redactor (S5), the capability-injection dispatch
 * runtime (S6), the subprocess service (S1), `confinePath` (S2), the clock/id
 * service (S3), canonical truncation (AC-041), and the error/exit-code taxonomy.
 */

// Errors & exit codes (AC-015/016)
export {
  CliRuntimeError,
  CliUsageError,
  type DomainError,
  EXIT_INVALID_USAGE,
  EXIT_RUNTIME_FAILURE,
  EXIT_SUCCESS,
  type ExitCode,
  exitCodeForError,
  PathEscape,
  PolicyDenied,
  SubprocessFailed,
  SubprocessTimeout,
  ToolNotFound
} from "./errors.js"

// S5 Redaction (AC-003/012)
export { redact, redactSecretsInString, REDACTED } from "./redaction.js"

// Truncation (AC-041)
export {
  OUTPUT_BUDGET,
  overflowMarker,
  RunningTruncator,
  truncate
} from "./truncate.js"

// S2 Path confinement (AC-013)
export { confinePath } from "./confine-path.js"

// S3 Clock / Id (AC-034)
export {
  formatTimestamp,
  Id,
  IdDefault,
  IdLive,
  type IdService,
  RandomBytes,
  RandomBytesLive,
  type RandomBytesService
} from "./clock-id.js"

// S1 Subprocess (AC-053)
export {
  DEFAULT_MAX_BUFFER,
  DEFAULT_TIMEOUT_MS,
  type FakeResponse,
  fakeKey,
  type RunOptions,
  type RunResult,
  Subprocess,
  SubprocessFake,
  type SubprocessService
} from "./subprocess.js"

// S4 Policy (AC-001/002/008)
export {
  classify,
  type CommandDescriptor,
  DENIED_REASON,
  gate,
  type GateDecision,
  policyDeniedPayload,
  type PolicyDeniedPayload,
  type PolicyDocument,
  type SideEffect
} from "./policy.js"

// Capabilities — the three dangerous Context.Tags (the crux)
export {
  type AnyCapability,
  DeviceCapability,
  type DeviceCapabilityService,
  RuntimeEvalCapability,
  type RuntimeEvalCapabilityService,
  SourceWriteCapability,
  type SourceWriteCapabilityService
} from "./capabilities.js"

// S6 Dispatch Runtime (AC-001/015/016/025/031/041) — capability injection
export {
  type BatchResult,
  type BatchStep,
  type BatchStepResult,
  type CapabilityEnv,
  type CapabilityFor,
  command,
  type Command,
  dispatch,
  type DispatchResult,
  ndjsonStream,
  NoopRecorder,
  runBatch,
  type RunRecorder
} from "./dispatch.js"
