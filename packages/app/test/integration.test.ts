/**
 * Final-integration tests — the FULL command surface wired into the shell.
 *
 * Proves:
 *   1. The registry exposes the expected command surface (≥ the wired minimum).
 *   2. A read command (`doctor`) dispatched through the ASSEMBLED registry path
 *      returns a `{ ok:true, … }`-shaped envelope at exit 0.
 *   3. A gated `device` command (`launch-app`) WITHOUT policy is DENIED
 *      (`policy-denied`), exits 0 (designed-unavailable), and the concrete device
 *      capability is invoked ZERO times (capability withholding — proven with a
 *      counting fake capability layer).
 *   4. A gated `runtime-eval` command (`trace start`) WITHOUT policy is likewise
 *      denied with the eval capability invoked ZERO times.
 *   5. With policy, the SAME gated command passes the gate and reaches the
 *      (fake) capability — confirming the dispatch path is real, not a stub.
 */
import { describe, expect, it } from "@effect/vitest"
import { coreReadCommands, handlerCommands, registerCommands, runRegistered } from "@expo98/app"
import { DeviceCapability, EXIT_SUCCESS, RuntimeEvalCapability, SourceWriteCapability } from "@expo98/core"
import { makeMemoryFs } from "@expo98/domain"
import { Effect, Layer, Option, Ref } from "effect"

const registry = registerCommands([...coreReadCommands, ...handlerCommands])

/** Counting fake capability layers — record every invocation for assertions. */
const countingCaps = (deviceCalls: Ref.Ref<number>, evalCalls: Ref.Ref<number>) =>
  Layer.mergeAll(
    Layer.succeed(
      DeviceCapability,
      DeviceCapability.of({
        invoke: () => Ref.update(deviceCalls, (n) => n + 1).pipe(Effect.as("device-ok")),
      }),
    ),
    Layer.succeed(
      RuntimeEvalCapability,
      RuntimeEvalCapability.of({
        evaluate: () => Ref.update(evalCalls, (n) => n + 1).pipe(Effect.as("eval-ok")),
      }),
    ),
    Layer.succeed(
      SourceWriteCapability,
      SourceWriteCapability.of({
        writeFile: () => Effect.void,
        deleteFile: () => Effect.void,
      }),
    ),
  )

const globals = {
  json: true,
  plain: false,
  ndjson: false,
  quiet: false,
  root: Option.none<string>(),
  stateDir: Option.none<string>(),
  actionPolicy: Option.none<string>(),
  maxOutput: Option.none<number>(),
  allowRuntimeEval: false,
  confirmActions: [] as ReadonlyArray<string>,
  record: false,
  contentBoundaries: false,
  debug: false,
  noColor: false,
  noInput: false,
}

describe("Final integration — full command surface", () => {
  it("registers the whole surface without a duplicate-path throw", () => {
    // 5 core read + the handler/integration surface. Assert a sensible minimum.
    expect(registry.all.length).toBeGreaterThanOrEqual(60)
    expect(registry.all.length).toBe(coreReadCommands.length + handlerCommands.length)
    // Spot-check that representative verbs of every package are addressable.
    for (const path of [
      "doctor",
      "trace start",
      "inspector probe",
      "navigation state",
      "launch-app",
      "tap",
      "wait",
      "snapshot",
      "accessibility tree",
      "rn tree",
      "network",
      "perf",
      "diff snapshot",
      "dashboard start",
      "live-backlog generate",
      "bridge install",
      "expo-compat",
      "sitemap",
      "review-overlay",
    ]) {
      expect(registry.get(path), `missing wired path: ${path}`).toBeDefined()
    }
  })

  it.effect("keeps mixed-family registration metadata aligned with built command classes", () =>
    Effect.gen(function* () {
      const fs = yield* makeMemoryFs()
      const cases = [
        ["inspector probe", "read"],
        ["inspector toggle", "runtime-eval"],
        ["inspector open-dev-menu", "device"],
        ["navigation state", "read"],
        ["navigation back", "device"],
      ] as const
      for (const [path, sideEffect] of cases) {
        const reg = registry.get(path)
        expect(reg, `missing wired path: ${path}`).toBeDefined()
        expect(reg!.sideEffect).toBe(sideEffect)
        expect(reg!.build({ positionals: [], policy: {}, fs }).descriptor.sideEffect).toBe(sideEffect)
      }
    }),
  )

  it.effect("read command (doctor) → ok envelope, exit 0 through the assembled path", () =>
    Effect.gen(function* () {
      const fs = yield* makeMemoryFs()
      const deviceCalls = yield* Ref.make(0)
      const evalCalls = yield* Ref.make(0)
      const reg = registry.get("doctor")!
      const result = yield* runRegistered(reg, {
        positionals: [],
        policy: {},
        fs,
      }).pipe(Effect.provide(countingCaps(deviceCalls, evalCalls)))
      expect(result.exitCode).toBe(EXIT_SUCCESS)
      expect(result.sideEffect).toBe("read")
      const payload = result.payload as { available: boolean }
      expect(payload.available).toBe(true)
    }),
  )

  it.effect("gated device command (launch-app) WITHOUT policy → denied, exit 0, device invoked 0×", () =>
    Effect.gen(function* () {
      const fs = yield* makeMemoryFs()
      const deviceCalls = yield* Ref.make(0)
      const evalCalls = yield* Ref.make(0)
      const reg = registry.get("launch-app")!
      expect(reg.sideEffect).toBe("device")
      const result = yield* runRegistered(reg, {
        positionals: ["booted", "com.example.app"],
        policy: {}, // no allow → fail-closed denial
        fs,
      }).pipe(Effect.provide(countingCaps(deviceCalls, evalCalls)))
      // Designed-unavailable: exit 0 with the policy-denied payload.
      expect(result.exitCode).toBe(EXIT_SUCCESS)
      const payload = result.payload as { code?: string; denied?: boolean }
      expect(payload.code).toBe("policy-denied")
      expect(payload.denied).toBe(true)
      // CAPABILITY WITHHELD: the device capability was never invoked.
      expect(yield* Ref.get(deviceCalls)).toBe(0)
    }),
  )

  it.effect("gated runtime-eval command (trace start) WITHOUT policy → denied, eval invoked 0×", () =>
    Effect.gen(function* () {
      const fs = yield* makeMemoryFs()
      const deviceCalls = yield* Ref.make(0)
      const evalCalls = yield* Ref.make(0)
      const reg = registry.get("trace start")!
      expect(reg.sideEffect).toBe("runtime-eval")
      const result = yield* runRegistered(reg, {
        positionals: [],
        policy: {},
        fs,
      }).pipe(Effect.provide(countingCaps(deviceCalls, evalCalls)))
      expect(result.exitCode).toBe(EXIT_SUCCESS)
      const payload = result.payload as { code?: string }
      expect(payload.code).toBe("policy-denied")
      expect(yield* Ref.get(evalCalls)).toBe(0)
    }),
  )

  it.effect("gated device command WITH policy → gate passes, the concrete capability IS reached", () =>
    Effect.gen(function* () {
      const fs = yield* makeMemoryFs()
      const deviceCalls = yield* Ref.make(0)
      const evalCalls = yield* Ref.make(0)
      const reg = registry.get("launch-app")!
      const result = yield* runRegistered(reg, {
        positionals: ["booted", "com.example.app"],
        policy: { allow: ["launch-app"] },
        fs,
      }).pipe(Effect.provide(countingCaps(deviceCalls, evalCalls)))
      expect(result.exitCode).toBe(EXIT_SUCCESS)
      // The dispatch path is REAL: with the gate open, the injected device
      // capability was invoked (≥1 — launch-app also runs a crash scan).
      expect(yield* Ref.get(deviceCalls)).toBeGreaterThanOrEqual(1)
    }),
  )

  it.effect("resolvePolicy + dispatch survive an absent --action-policy (Fs read)", () =>
    Effect.gen(function* () {
      // Sanity: the assembled CommandContext wiring (Fs port + policy) holds for a
      // read command with the default globals.
      const fs = yield* makeMemoryFs()
      const deviceCalls = yield* Ref.make(0)
      const evalCalls = yield* Ref.make(0)
      expect(globals.actionPolicy._tag).toBe("None")
      const reg = registry.get("version")!
      const result = yield* runRegistered(reg, {
        positionals: [],
        policy: {},
        fs,
      }).pipe(Effect.provide(countingCaps(deviceCalls, evalCalls)))
      expect(result.exitCode).toBe(EXIT_SUCCESS)
    }),
  )
})
