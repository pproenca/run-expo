import {
  BRIDGE_CONFIRMATIONS,
  POLICY_REASONS,
  checkedPolicyDecision
} from "./domain.js";

export type PolicyDocument = {
  allow?: string[];
  actions?: Record<string, "allow" | boolean | string>;
};

export type PolicyDecision = ReturnType<typeof checkedPolicyDecision>;
export type PolicyDeniedDecision = {
  checked?: boolean;
  action?: string;
  sideEffect?: string;
  allowed?: boolean | null;
  source?: string | null;
  reason?: string;
  [key: string]: unknown;
};

/**
 * RULE-001 and RULE-004: evaluates the legacy action-policy contract from
 * the compiled CLI while accepting an already-loaded policy object.
 */
export function decideActionPolicy({
  action,
  sideEffect,
  policy = null,
  source = null,
  allowRuntimeEval = false
}: {
  action: string;
  sideEffect: string;
  policy?: PolicyDocument | null;
  source?: string | null;
  allowRuntimeEval?: boolean;
}): PolicyDecision {
  if (action === "wait.fn" && allowRuntimeEval === true) {
    return checkedPolicyDecision({
      action,
      sideEffect: "runtime-eval",
      allowed: true,
      source: "--allow-runtime-eval",
      reason: "Runtime eval allowed by global flag."
    });
  }

  if (sideEffect === "read") {
    return checkedPolicyDecision({
      action,
      sideEffect,
      allowed: true,
      source: null,
      reason: POLICY_REASONS.READ_ALLOWED
    });
  }

  if (!policy) {
    return checkedPolicyDecision({
      action,
      sideEffect,
      allowed: false,
      source: null,
      reason: POLICY_REASONS.MISSING_POLICY
    });
  }

  const allowed = policyAllowsAction(policy, action);
  return checkedPolicyDecision({
    action,
    sideEffect,
    allowed,
    source,
    reason: allowed ? POLICY_REASONS.ACTION_ALLOWED : POLICY_REASONS.ACTION_DENIED
  });
}

export function policyAllowsAction(policy: PolicyDocument | null | undefined, action: string): boolean {
  if (Array.isArray(policy?.allow) && policy.allow.includes(action)) {
    return true;
  }
  if (policy?.actions?.[action] === "allow" || policy?.actions?.[action] === true) {
    return true;
  }
  return false;
}

export function defaultPolicySummary() {
  return {
    allow: [],
    defaults: {
      read: "allow",
      write: "deny",
      device: "deny",
      runtimeEval: "deny unless --allow-runtime-eval true or an action policy allows the command",
    },
  };
}

export function actionSideEffect(action: string): "read" | "device" {
  if (/^(doctor|project-info|routes|devices|target\.list|target\.current|snapshot|refs|get|find|wait|console|errors|logs|metro\.status|policy|redact|review)/.test(action)) {
    return "read";
  }
  if (/^(storage\.set|storage\.clear|state\.save|state\.load|state\.clear|install-app|uninstall-app|set\.|wait\.fn)/.test(action)) {
    return "device";
  }
  return "device";
}

export function policyDeniedPayload({ domain, action, policy }: {
  domain: string;
  action: string;
  policy: PolicyDeniedDecision;
}) {
  return {
    available: false,
    domain,
    action,
    source: "policy",
    evidenceSource: "policy",
    code: "policy-denied",
    denied: true,
    reason: "Policy denied action.",
    policy
  };
}

/**
 * RULE-005: mirrors the legacy bridge install/remove confirmation check
 * without performing file mutations.
 */
export function requireBridgeConfirmation({
  action,
  confirmActions,
  status,
  projectRoot,
  plan
}: {
  action: "install" | "remove" | string;
  confirmActions?: string | null;
  status?: string;
  projectRoot?: string;
  plan?: unknown;
}) {
  const requiredConfirmation =
    action === "install" || action === "remove" ? BRIDGE_CONFIRMATIONS[action] : undefined;
  if (!requiredConfirmation || hasExplicitConfirmation(confirmActions, requiredConfirmation)) {
    return null;
  }

  return {
    available: false,
    action,
    status,
    projectRoot,
    reason: `Refusing to mutate app files without explicit --confirm-actions ${requiredConfirmation}.`,
    requiredConfirmation,
    plan
  };
}

export function hasExplicitConfirmation(value: string | null | undefined, required: string): boolean {
  return String(value ?? "")
    .split(",")
    .map((item) => item.trim())
    .includes(required);
}
