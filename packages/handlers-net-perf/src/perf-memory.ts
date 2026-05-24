/**
 * Memory-leak claim gating (AC-051). PURE.
 *
 *   - `samples = clamp(args.samples ?? 1, 1, 100)`.
 *   - metric confidence is `medium` IFF `samples ≥ 2` OR a native artifact
 *     exists, else `low`.
 *   - `leakClaim.allowed = samples ≥ 2 || Boolean(nativeArtifact)`.
 *
 * Rationale: a single in-simulator sample is a hint, not evidence; a leak claim
 * needs either repeated sampling (≥2) or a native memgraph artifact.
 */
import { type PerfConfidence } from "./perf-confidence.js"
import { resolveSamples } from "./support.js"

export const MIN_SAMPLES_FOR_CLAIM = 2 as const

export interface MemoryEvidenceInput {
  readonly samples?: number
  /** A native memgraph/sample artifact path (or any truthy marker). */
  readonly nativeArtifact?: string | null
}

export interface LeakClaim {
  readonly allowed: boolean
  readonly reason: string
}

export interface MemoryEvidence {
  /** Resolved sample count after `clamp(?? 1, 1, 100)`. */
  readonly samples: number
  /** Whether a native artifact was supplied. */
  readonly hasNativeArtifact: boolean
  /** The single memory.samples metric's confidence. */
  readonly confidence: PerfConfidence
  readonly leakClaim: LeakClaim
}

const ALLOWED_REASON = "Repeated measurements or native artifacts are present."
const DENIED_REASON =
  "Repeated measurements or a native memgraph artifact are required before making a memory-leak claim."

/**
 * Evaluate memory evidence and the leak-claim gate (AC-051). PURE.
 * `confidence` and `leakClaim.allowed` are BOTH `(samples ≥ 2) || nativeArtifact`.
 */
export const evaluateMemoryEvidence = (input: MemoryEvidenceInput): MemoryEvidence => {
  const samples = resolveSamples(input.samples)
  const hasNativeArtifact = Boolean(input.nativeArtifact)
  const allowed = samples >= MIN_SAMPLES_FOR_CLAIM || hasNativeArtifact
  return {
    samples,
    hasNativeArtifact,
    confidence: allowed ? "medium" : "low",
    leakClaim: {
      allowed,
      reason: allowed ? ALLOWED_REASON : DENIED_REASON,
    },
  }
}
