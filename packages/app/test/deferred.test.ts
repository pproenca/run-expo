import { describe, it } from "@effect/vitest"

/**
 * The full handler / integration command surface is now WIRED into the shell and
 * exercised end-to-end through dispatch in `integration.test.ts` (registry count,
 * read envelopes, and the device / runtime-eval gating with the concrete
 * capability invoked 0× on denial). What remains genuinely deferred is the LIVE
 * device / Hermes / Metro path for the gated commands — it needs a running
 * simulator + Metro + Hermes, which CI cannot provide. The WIRING and types are
 * real and compile; only the live transport is left as a documented seam.
 *
 * These skips track the live-path UAT, each naming the owning package + AC.
 */
describe("Deferred LIVE paths — require a running device / Hermes / Metro", () => {
  it.skip(
    "AC-005 LIVE: `launch-app` etc. against a booted simulator drives xcrun/simctl — needs a live simulator (handlers-interaction; gating + dispatch proven in integration.test.ts)",
    () => {}
  )
  it.skip(
    "AC-010/011 LIVE: `trace`/`inspector` runtime-eval against a running Hermes — needs a live app (handlers-devtools; gating proven: eval invoked 0× on denial)",
    () => {}
  )
  it.skip(
    "AC-008 LIVE: `bridge install/remove` writes/deletes real project files via SourceWriteCapability + confirmation token — needs a target project (expo-integration; source-write dispatch wired)",
    () => {}
  )
  it.skip(
    "AC-022/045-052 LIVE: `network`/`perf` harvested over the protocols read-eval CDP seam — needs a running Hermes (handlers-net-perf; pure derivations wired as read)",
    () => {}
  )
  it.skip(
    "AC-019/026 LIVE: `snapshot` capture over the SemanticCapture/NativeAxe seams + domain persistence — needs a live device (handlers-snapshot; read wrapper wired)",
    () => {}
  )
  it.skip(
    "AC-014 LIVE: `review-overlay server` binds the hardened loopback ingest server — live bind is the seam (overlay-server; prepare/read/clear wired as read)",
    () => {}
  )
})
