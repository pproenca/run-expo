export type RealValidationState =
  | "validated"
  | "partial"
  | "unvalidated"
  | "environment-blocked"
  | "unsupported"
  | "simulated";

export interface RealValidationEvidence {
  source: string;
  artifactPath?: string | null;
  command?: string | null;
  timestamp?: string | null;
  buildKind?: string | null;
  confidence?: string | null;
}

export interface RealValidationMissingEvidence {
  signal: string;
  reason: string;
  recommendedFix: string;
}

export interface RealValidation {
  state: RealValidationState;
  claimsAllowed: {
    networkLatency: boolean;
    networkWaterfall: boolean;
    renderCost: boolean;
    frameJank: boolean;
    nativeCpu: boolean;
    releasePerformance: boolean;
  };
  evidence: RealValidationEvidence[];
  missingEvidence: RealValidationMissingEvidence[];
}

export function realValidation(input: {
  state: RealValidationState;
  claimsAllowed?: Partial<RealValidation["claimsAllowed"]>;
  evidence?: RealValidationEvidence[];
  missingEvidence?: RealValidationMissingEvidence[];
}): RealValidation {
  return {
    state: input.state,
    claimsAllowed: {
      networkLatency: false,
      networkWaterfall: false,
      renderCost: false,
      frameJank: false,
      nativeCpu: false,
      releasePerformance: false,
      ...(input.claimsAllowed ?? {}),
    },
    evidence: input.evidence ?? [],
    missingEvidence: input.missingEvidence ?? [],
  };
}

export function validationStateForAvailability(value: {
  available?: unknown;
  hasEvidence?: boolean;
  partialReason?: string | null;
  unsupported?: boolean;
  environmentBlocked?: boolean;
}): RealValidationState {
  if (value.environmentBlocked) return "environment-blocked";
  if (value.unsupported) return "unsupported";
  if (value.available === false) return "unvalidated";
  if (value.hasEvidence === true && !value.partialReason) return "validated";
  return "partial";
}
