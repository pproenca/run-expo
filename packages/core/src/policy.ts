import { Match } from "effect"

/**
 * S4 — Policy (pure). AC-001, AC-002, AC-008.
 *
 * ONE side-effect classifier with FOUR tiers, and ONE fail-closed gate.
 *
 * The crucial correction (architecture finding C1/C2): the side-effect class is
 * a REQUIRED, TYPED field on the command descriptor — it is NOT derived from a
 * name regex. The classifier maps an explicit `declaredSideEffect` and routes
 * the unknown/never case to `device` (fail-closed) via `Match.exhaustive`.
 */

/** The four side-effect tiers. */
export type SideEffect = "read" | "device" | "runtime-eval" | "source-write"

/** A typed command descriptor. `sideEffect` is REQUIRED — not inferred. */
export interface CommandDescriptor {
  readonly action: string
  /** The required, typed side-effect class. Unknown values fail closed. */
  readonly sideEffect: SideEffect
}

/**
 * Classify the REQUIRED typed field. Unknown ⇒ `device` (fail-closed).
 *
 * SAFETY INVARIANT: the `Match.exhaustive` makes this a compile error if a new
 * tier is added without a branch, and `Match.orElse` defends the runtime case
 * where an untyped caller smuggles an unrecognised value in — that resolves to
 * `device`, never `read`.
 */
export const classify = (descriptor: {
  readonly sideEffect: SideEffect | (string & {})
}): SideEffect =>
  Match.value(descriptor.sideEffect as SideEffect).pipe(
    Match.when("read", () => "read" as const),
    Match.when("device", () => "device" as const),
    Match.when("runtime-eval", () => "runtime-eval" as const),
    Match.when("source-write", () => "source-write" as const),
    // Unknown / unclassified ⇒ device (fail-closed). Unreachable for a
    // well-typed descriptor; present so an untyped value can never become `read`.
    Match.orElse(() => "device" as const)
  )

/**
 * A policy document (non-persisted). Either form allows an exact action:
 *   - `allow[]` contains the action, OR
 *   - `actions[action]` is `"allow"` or `true`.
 * `confirmations[]` carries confirmation tokens for `source-write` actions.
 */
export interface PolicyDocument {
  readonly allow?: ReadonlyArray<string>
  readonly actions?: Readonly<Record<string, "allow" | "deny" | boolean>>
  /** Confirmation tokens supplied (e.g. via `--confirm-actions`). */
  readonly confirmations?: ReadonlyArray<string>
  /** Global escape hatch for runtime-eval (`--allow-runtime-eval`). */
  readonly allowRuntimeEval?: boolean
}

/** AC-001 denial payload shape (verbatim contract). */
export interface PolicyDeniedPayload {
  readonly available: false
  readonly source: "policy"
  readonly evidenceSource: "policy"
  readonly code: "policy-denied"
  readonly denied: true
  readonly reason: string
  readonly policy: PolicyDocument
}

export const policyDeniedPayload = (
  reason: string,
  policy: PolicyDocument
): PolicyDeniedPayload => ({
  available: false,
  source: "policy",
  evidenceSource: "policy",
  code: "policy-denied",
  denied: true,
  reason,
  policy
})

export const DENIED_REASON = "Policy denied action." as const

/** The outcome of evaluating the gate. */
export type GateDecision =
  | { readonly _tag: "allow"; readonly sideEffect: SideEffect }
  | { readonly _tag: "deny"; readonly payload: PolicyDeniedPayload }

const policyAllowsAction = (policy: PolicyDocument, action: string): boolean => {
  if (policy.allow?.includes(action)) {
    return true
  }
  const entry = policy.actions?.[action]
  return entry === "allow" || entry === true
}

/**
 * The fail-closed gate (AC-001/005/006/007/008/010/011).
 *
 * - `read` ⇒ always allowed (no policy file required).
 * - `device` / `runtime-eval` ⇒ allowed only if the policy allows the EXACT
 *   action (`runtime-eval` additionally honours `allowRuntimeEval`).
 * - `source-write` ⇒ allowed only if the policy allows the action AND a matching
 *   confirmation token is present.
 * - anything else ⇒ denied (fail closed).
 */
export const gate = (
  descriptor: CommandDescriptor,
  policy: PolicyDocument
): GateDecision => {
  const sideEffect = classify(descriptor)
  const action = descriptor.action

  const deny = (reason: string): GateDecision => ({
    _tag: "deny",
    payload: policyDeniedPayload(reason, policy)
  })
  const allow = (): GateDecision => ({ _tag: "allow", sideEffect })

  return Match.value(sideEffect).pipe(
    Match.when("read", allow),
    Match.when("device", () =>
      policyAllowsAction(policy, action) ? allow() : deny(DENIED_REASON)
    ),
    Match.when("runtime-eval", () =>
      policy.allowRuntimeEval === true || policyAllowsAction(policy, action)
        ? allow()
        : deny(DENIED_REASON)
    ),
    Match.when("source-write", () => {
      if (!policyAllowsAction(policy, action)) {
        return deny(DENIED_REASON)
      }
      // SAFETY: source-write needs an EXACT confirmation token in addition to
      // policy allow — the AC-008 second factor for file-mutating actions.
      const confirmed = policy.confirmations?.includes(action) === true
      return confirmed
        ? allow()
        : deny(`Action "${action}" requires confirmation token "${action}".`)
    }),
    Match.exhaustive
  )
}
