import { describe, it } from "@effect/vitest"

/**
 * Deferred acceptance criteria — full handler behavior lives in the handler /
 * integration packages, but the SAFETY MECHANISM each relies on is proven here
 * in `core` (the capability-injection gate). Tracked from day one as skips with
 * their AC ids so coverage is visible.
 */
describe("Deferred ACs (handler/integration packages)", () => {
  it.skip("AC-005 device/app lifecycle mutations gated — full xcrun/simctl handler behavior in packages/handlers-lifecycle; gate mechanism proven by dispatch.test + capability-injection.type-test", () => {})
  it.skip("AC-006 bridge storage/state/controls writes gated + bounded — full bridge handler in packages/handlers-bridge; gate mechanism proven by core", () => {})
  it.skip("AC-007 navigation mutations gated (state ungated) — full nav handler in packages/handlers-devtools; gate mechanism proven by core", () => {})
  it.skip("AC-010 trace gated as runtime-eval — full handler behavior in packages/handlers-devtools; mechanism proven by capability-injection.type-test", () => {})
  it.skip("AC-011 inspector mutations gated, reads classified read — full handler behavior in packages/handlers-devtools; mechanism proven by capability-injection.type-test", () => {})
})
