export const REDACTED = "[redacted]";

export const POLICY_REASONS = Object.freeze({
  READ_ALLOWED: "Read action does not require policy approval.",
  MISSING_POLICY: "No action policy allowed this state-changing operation.",
  ACTION_ALLOWED: "Action allowed by policy.",
  ACTION_DENIED: "Action policy did not allow this operation."
});

export const BRIDGE_CONFIRMATIONS = Object.freeze({
  install: "bridge-install",
  remove: "bridge-remove"
});

export const LEGACY_OUTPUT_TRUNCATION_SUFFIX =
  "\n[expo-ios output truncated by --max-output]\n";

export function checkedPolicyDecision({
  action,
  sideEffect,
  allowed,
  source = null,
  reason
}: {
  action: string;
  sideEffect: string;
  allowed: boolean;
  source?: string | null;
  reason: string;
}) {
  return {
    checked: true,
    action,
    sideEffect,
    allowed,
    source,
    reason
  };
}
