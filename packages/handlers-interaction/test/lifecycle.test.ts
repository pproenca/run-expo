/**
 * AC-005 — app/device lifecycle mutations are policy-gated, END-TO-END through
 * core's dispatch with a FAKE `DeviceCapability` that COUNTS its invocations.
 *
 * The behavioural contract: a denied lifecycle command performs ZERO device work
 * (the gate withholds the capability, so the fake `invoke` is called 0×); an
 * allowed one runs and invokes the device. `install-app`/`uninstall-app`
 * `--dry-run` returns a plan and mutates nothing (device invoked 0× even though
 * the gate passed). AC-029/AC-056 cover the post-launch crash check.
 */
import { describe, expect, it } from "@effect/vitest"
import {
  type Command,
  DeviceCapability,
  dispatch,
  type DispatchResult,
  EXIT_SUCCESS,
  RuntimeEvalCapability,
  type SideEffect,
  SourceWriteCapability,
} from "@expo98/core"
import {
  lifecycle,
  lifecycleCommand,
  type LifecyclePlan,
  type LifecycleResult,
  lifecycleSideEffect,
  type LifecycleVerb,
} from "@expo98/handlers-interaction"
import { Effect, Layer, Ref } from "effect"

/** A counting fake device capability. Each tuple records one `invoke` call. */
const makeCaps = (calls: Ref.Ref<ReadonlyArray<string>>, scanOutput = "") =>
  Layer.mergeAll(
    Layer.succeed(
      DeviceCapability,
      DeviceCapability.of({
        invoke: (tool, args) =>
          Ref.update(calls, (xs) => [...xs, [tool, ...args].join(" ")]).pipe(
            // The crash-scan command returns the (test-controlled) report listing;
            // every other call returns a plain ok marker.
            Effect.as(args.includes("--crash-reports") ? scanOutput : "device-ok"),
          ),
      }),
    ),
    Layer.succeed(RuntimeEvalCapability, RuntimeEvalCapability.of({ evaluate: () => Effect.succeed(null) })),
    Layer.succeed(
      SourceWriteCapability,
      SourceWriteCapability.of({
        writeFile: () => Effect.void,
        deleteFile: () => Effect.void,
      }),
    ),
  )

const run = <A>(
  cmd: Command<"device", A>,
  policy: Parameters<typeof dispatch>[1],
  caps: Layer.Layer<DeviceCapability | RuntimeEvalCapability | SourceWriteCapability>,
): Effect.Effect<DispatchResult<A>> => dispatch(cmd as Command<SideEffect, A>, policy).pipe(Effect.provide(caps))

const ALL_VERBS: ReadonlyArray<LifecycleVerb> = [
  "boot-simulator",
  "open-url",
  "launch-app",
  "terminate-app",
  "reload-app",
  "install-app",
  "uninstall-app",
  "open-route",
  "set",
]

describe("AC-005 lifecycle mutations are policy-gated", () => {
  it("AC-005 every lifecycle verb is classified `device`", () => {
    for (const verb of ALL_VERBS) {
      expect(lifecycleSideEffect(verb)).toBe("device")
    }
  })

  for (const verb of ALL_VERBS) {
    it.effect(`AC-005 ${verb} with NO policy is DENIED and the device capability is NEVER invoked (0 calls)`, () =>
      Effect.gen(function* () {
        const calls = yield* Ref.make<ReadonlyArray<string>>([])
        const cmd = lifecycleCommand(verb, { bundleId: "com.example.app" })
        const result = yield* run(cmd, {}, makeCaps(calls))
        const payload = result.payload as {
          code?: string
          denied?: boolean
          available?: boolean
        }
        expect(payload.code).toBe("policy-denied")
        expect(payload.denied).toBe(true)
        expect(payload.available).toBe(false)
        expect(result.exitCode).toBe(EXIT_SUCCESS)
        expect(result.sideEffect).toBe("device")
        // THE behavioural assertion: zero device invocations on denial.
        expect((yield* Ref.get(calls)).length).toBe(0)
      }),
    )
  }

  it.effect("AC-005 boot-simulator WITH policy allow invokes the device capability", () =>
    Effect.gen(function* () {
      const calls = yield* Ref.make<ReadonlyArray<string>>([])
      const cmd = lifecycleCommand("boot-simulator", { device: "iPhone-15" })
      const result = yield* run(cmd, { allow: ["boot-simulator"] }, makeCaps(calls))
      const payload = result.payload as { action?: string; verb?: string }
      expect(payload.action).toBe("boot-simulator")
      const seen = yield* Ref.get(calls)
      expect(seen.length).toBe(1)
      expect(seen[0]).toContain("simctl boot iPhone-15")
    }),
  )

  it.effect("AC-005 install-app --dry-run returns a plan and mutates nothing (device invoked 0×)", () =>
    Effect.gen(function* () {
      const calls = yield* Ref.make<ReadonlyArray<string>>([])
      // Even WITH policy allow, --dry-run must not touch the device.
      const cmd = lifecycle("install-app", {
        appPath: "/tmp/App.app",
        dryRun: true,
      }) as Command<"device", LifecyclePlan>
      const result = yield* run(cmd, { allow: ["install-app"] }, makeCaps(calls))
      const payload = result.payload as {
        dryRun?: boolean
        tool?: string
        args?: ReadonlyArray<string>
      }
      expect(payload.dryRun).toBe(true)
      expect(payload.tool).toBe("xcrun")
      expect(payload.args).toEqual(["simctl", "install", "booted", "/tmp/App.app"])
      // Plan only — zero device work.
      expect((yield* Ref.get(calls)).length).toBe(0)
    }),
  )

  it.effect("AC-005 uninstall-app --dry-run returns a plan, mutates nothing", () =>
    Effect.gen(function* () {
      const calls = yield* Ref.make<ReadonlyArray<string>>([])
      const cmd = lifecycle("uninstall-app", {
        bundleId: "com.example.app",
        dryRun: true,
      }) as Command<"device", LifecyclePlan>
      const result = yield* run(cmd, { allow: ["uninstall-app"] }, makeCaps(calls))
      const payload = result.payload as { dryRun?: boolean; args?: ReadonlyArray<string> }
      expect(payload.dryRun).toBe(true)
      expect(payload.args).toEqual(["simctl", "uninstall", "booted", "com.example.app"])
      expect((yield* Ref.get(calls)).length).toBe(0)
    }),
  )

  it.effect("AC-005 install-app WITHOUT --dry-run AND with policy actually invokes the device", () =>
    Effect.gen(function* () {
      const calls = yield* Ref.make<ReadonlyArray<string>>([])
      const cmd = lifecycle("install-app", {
        appPath: "/tmp/App.app",
      }) as Command<"device", LifecycleResult>
      const result = yield* run(cmd, { allow: ["install-app"] }, makeCaps(calls))
      const payload = result.payload as { action?: string }
      expect(payload.action).toBe("install-app")
      const seen = yield* Ref.get(calls)
      expect(seen.length).toBe(1)
      expect(seen[0]).toContain("simctl install booted /tmp/App.app")
    }),
  )

  it.skip("AC-005 live boot/launch on a real simulator drives xcrun/simctl", () => {
    // Requires a real iOS simulator; the gating + argv shape are fully covered
    // above with the injected fake DeviceCapability.
  })
})

describe("AC-029 launch/reload attach crashCheck and fail closed on crash", () => {
  it.effect("AC-029 launch-app with NO post-launch crash attaches crashCheck and stays available", () =>
    Effect.gen(function* () {
      const calls = yield* Ref.make<ReadonlyArray<string>>([])
      const cmd = lifecycleCommand("launch-app", {
        bundleId: "com.example.app",
      })
      const result = yield* run(
        cmd,
        { allow: ["launch-app"] },
        makeCaps(calls, ""), // no crash reports listed
      )
      const payload = result.payload as {
        available?: boolean
        crashCheck?: { action?: string; bundleId?: string; reportCount?: number }
        crashReports?: ReadonlyArray<unknown>
      }
      expect(payload.available).toBe(true)
      expect(payload.crashCheck?.action).toBe("launch-app")
      expect(payload.crashCheck?.bundleId).toBe("com.example.app")
      expect(payload.crashCheck?.reportCount).toBe(0)
      expect(payload.crashReports).toEqual([])
      // Launch + crash-scan are two device calls.
      expect((yield* Ref.get(calls)).length).toBe(2)
    }),
  )

  it.effect(
    "AC-029 launch-app fails closed (available:false) when a matching crash report appears after startedAt",
    () =>
      Effect.gen(function* () {
        const calls = yield* Ref.make<ReadonlyArray<string>>([])
        // A crash report dated far in the future relative to startedAt (= now).
        const future = Date.now() + 60_000
        const scan = `/Library/Logs/DiagnosticReports/com.example.app-2026.ips\t${future}`
        const cmd = lifecycleCommand("launch-app", {
          bundleId: "com.example.app",
        })
        const result = yield* run(cmd, { allow: ["launch-app"] }, makeCaps(calls, scan))
        const payload = result.payload as {
          available?: boolean
          reason?: string
          crashCheck?: { reportCount?: number }
          crashReports?: ReadonlyArray<{ path?: string }>
        }
        expect(payload.available).toBe(false)
        expect(payload.reason).toContain("matching iOS crash report")
        expect(payload.crashCheck?.reportCount).toBe(1)
        expect(payload.crashReports?.[0]?.path).toContain(".ips")
      }),
  )

  it.effect("AC-029 reload-app also attaches a crashCheck", () =>
    Effect.gen(function* () {
      const calls = yield* Ref.make<ReadonlyArray<string>>([])
      const cmd = lifecycleCommand("reload-app", { bundleId: "com.example.app" })
      const result = yield* run(cmd, { allow: ["reload-app"] }, makeCaps(calls, ""))
      const payload = result.payload as { crashCheck?: { action?: string } }
      expect(payload.crashCheck?.action).toBe("reload-app")
    }),
  )

  it.effect("AC-029 a pre-existing report (mtime BEFORE startedAt) does NOT fail the launch", () =>
    Effect.gen(function* () {
      const calls = yield* Ref.make<ReadonlyArray<string>>([])
      // A report from the distant past must not be matched.
      const past = 0
      const scan = `/Library/Logs/DiagnosticReports/old.crash\t${past}`
      const cmd = lifecycleCommand("launch-app", { bundleId: "com.example.app" })
      const result = yield* run(cmd, { allow: ["launch-app"] }, makeCaps(calls, scan))
      const payload = result.payload as { available?: boolean; crashCheck?: { reportCount?: number } }
      expect(payload.available).toBe(true)
      expect(payload.crashCheck?.reportCount).toBe(0)
    }),
  )

  it.effect("AC-029 a denied launch performs ZERO device work (no launch, no crash scan)", () =>
    Effect.gen(function* () {
      const calls = yield* Ref.make<ReadonlyArray<string>>([])
      const cmd = lifecycleCommand("launch-app", { bundleId: "com.example.app" })
      const result = yield* run(cmd, {}, makeCaps(calls, ""))
      const payload = result.payload as { code?: string }
      expect(payload.code).toBe("policy-denied")
      expect((yield* Ref.get(calls)).length).toBe(0)
    }),
  )

  it.skip("AC-029 live crash scan against a real DiagnosticReports directory", () => {
    // Requires a real device + crashing app; the matching logic is unit-covered above.
  })
})
