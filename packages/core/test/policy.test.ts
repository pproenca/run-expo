import { describe, expect, it } from "@effect/vitest"
import { classify, type CommandDescriptor, DENIED_REASON, gate, type PolicyDocument } from "@expo98/core"

describe("S4 Policy classifier (AC-002)", () => {
  it("AC-002 classifies each of the four declared tiers", () => {
    expect(classify({ sideEffect: "read" })).toBe("read")
    expect(classify({ sideEffect: "device" })).toBe("device")
    expect(classify({ sideEffect: "runtime-eval" })).toBe("runtime-eval")
    expect(classify({ sideEffect: "source-write" })).toBe("source-write")
  })

  it("AC-002 unknown side-effect fails closed to device", () => {
    // An untyped caller smuggling an unrecognised value must NOT become `read`.
    expect(classify({ sideEffect: "wat" })).toBe("device")
    expect(classify({ sideEffect: "" })).toBe("device")
  })
})

describe("S4 Policy fail-closed gate (AC-001)", () => {
  const emptyPolicy: PolicyDocument = {}

  it("AC-001 reads always pass with no policy file required", () => {
    const cmd: CommandDescriptor = { action: "doctor", sideEffect: "read" }
    const decision = gate(cmd, emptyPolicy)
    expect(decision._tag).toBe("allow")
  })

  it("AC-001 device action denied without policy, with the exact denial payload", () => {
    const cmd: CommandDescriptor = { action: "launch-app", sideEffect: "device" }
    const decision = gate(cmd, emptyPolicy)
    expect(decision._tag).toBe("deny")
    if (decision._tag === "deny") {
      expect(decision.payload).toEqual({
        available: false,
        source: "policy",
        evidenceSource: "policy",
        code: "policy-denied",
        denied: true,
        reason: DENIED_REASON,
        policy: emptyPolicy,
      })
    }
  })

  it("AC-001 device action allowed when allow[] includes the exact action", () => {
    const cmd: CommandDescriptor = { action: "launch-app", sideEffect: "device" }
    const decision = gate(cmd, { allow: ["launch-app"] })
    expect(decision._tag).toBe("allow")
  })

  it("AC-001 device action allowed when actions[action] === 'allow' or true", () => {
    const cmd: CommandDescriptor = { action: "install-app", sideEffect: "device" }
    expect(gate(cmd, { actions: { "install-app": "allow" } })._tag).toBe("allow")
    expect(gate(cmd, { actions: { "install-app": true } })._tag).toBe("allow")
    expect(gate(cmd, { actions: { "install-app": "deny" } })._tag).toBe("deny")
    expect(gate(cmd, { actions: { "install-app": false } })._tag).toBe("deny")
  })

  it("AC-001 a different allowed action does not allow this one", () => {
    const cmd: CommandDescriptor = { action: "uninstall-app", sideEffect: "device" }
    expect(gate(cmd, { allow: ["install-app"] })._tag).toBe("deny")
  })

  it("AC-010/011 runtime-eval denied without policy or flag", () => {
    const cmd: CommandDescriptor = { action: "trace", sideEffect: "runtime-eval" }
    expect(gate(cmd, emptyPolicy)._tag).toBe("deny")
  })

  it("AC-010/011 runtime-eval allowed by --allow-runtime-eval or exact policy", () => {
    const cmd: CommandDescriptor = { action: "trace", sideEffect: "runtime-eval" }
    expect(gate(cmd, { allowRuntimeEval: true })._tag).toBe("allow")
    expect(gate(cmd, { allow: ["trace"] })._tag).toBe("allow")
  })
})

describe("S4 source-write confirmation tier (AC-008)", () => {
  const cmd: CommandDescriptor = {
    action: "bridge-install",
    sideEffect: "source-write",
  }

  it("AC-008 source-write denied when policy disallows the action", () => {
    expect(gate(cmd, {})._tag).toBe("deny")
    expect(gate(cmd, { confirmations: ["bridge-install"] })._tag).toBe("deny")
  })

  it("AC-008 source-write needs BOTH policy allow AND a confirmation token", () => {
    // Policy allows but no token ⇒ still denied (second factor missing).
    const denied = gate(cmd, { allow: ["bridge-install"] })
    expect(denied._tag).toBe("deny")
    if (denied._tag === "deny") {
      expect(denied.payload.reason).toContain("confirmation token")
    }
    // Policy allows AND matching token ⇒ allowed.
    const allowed = gate(cmd, {
      allow: ["bridge-install"],
      confirmations: ["bridge-install"],
    })
    expect(allowed._tag).toBe("allow")
  })
})
