import { describe, expect, it } from "@effect/vitest"
import {
  DeviceCapability,
  EXIT_RUNTIME_FAILURE,
  EXIT_SUCCESS,
  RuntimeEvalCapability,
  SourceWriteCapability,
} from "@expo98/core"
import { makeMemoryFs, MemoryFsLayer } from "@expo98/domain"
import { Effect, Layer, Option } from "effect"
import { CLI_VERSION, coreReadCommands, registerCommands, resolvePolicy, runRegistered } from "../src/index"

/**
 * The proof READ commands run end-to-end THROUGH core's dispatch — the gate +
 * the redaction/truncation boundary applied uniformly. Proves `policy`, `redact`,
 * `doctor` (+ `skills`, `version`) return the correct envelopes.
 */

// Concrete capability services (the dispatcher injects them only on gate-pass;
// the read commands never reach them, but the env must satisfy CapabilityEnv).
const TestCaps = Layer.mergeAll(
  Layer.succeed(DeviceCapability, DeviceCapability.of({ invoke: () => Effect.succeed("device-ok") })),
  Layer.succeed(RuntimeEvalCapability, RuntimeEvalCapability.of({ evaluate: () => Effect.succeed("eval-ok") })),
  Layer.succeed(
    SourceWriteCapability,
    SourceWriteCapability.of({
      writeFile: () => Effect.void,
      deleteFile: () => Effect.void,
    }),
  ),
)

const registry = registerCommands([...coreReadCommands])

const globals = {
  json: true,
  plain: false,
  ndjson: false,
  quiet: false,
  root: Option.none(),
  stateDir: Option.none(),
  actionPolicy: Option.none(),
  maxOutput: Option.none(),
  allowRuntimeEval: false,
  confirmActions: [] as ReadonlyArray<string>,
  record: false,
  contentBoundaries: false,
  debug: false,
  noColor: false,
  noInput: false,
}

describe("Read commands through dispatch", () => {
  it.effect("version → exit 0, { available, version } envelope (policy via Fs)", () =>
    Effect.gen(function* () {
      const fs = yield* makeMemoryFs()
      // resolvePolicy reads the (absent) --action-policy file via the Fs port.
      const policy = yield* resolvePolicy(globals)
      const reg = registry.get("version")!
      const result = yield* runRegistered(reg, { positionals: [], policy, fs })
      expect(result.exitCode).toBe(EXIT_SUCCESS)
      const payload = result.payload as { available: boolean; version: string }
      expect(payload.available).toBe(true)
      // The `version` command plumbs CLI_VERSION through dispatch — assert that
      // wiring against the constant, NOT a hardcoded literal (which is what let
      // 0.1.2 ship as "0.1.1"). Under vitest CLI_VERSION is the "0.0.0-dev"
      // fallback; the BUILT bin's real version is asserted by CI's smoke step.
      expect(payload.version).toBe(CLI_VERSION)
    }).pipe(Effect.provide(Layer.merge(TestCaps, MemoryFsLayer))),
  )

  it.effect("doctor → exit 0, capability summary (read, always allowed)", () =>
    Effect.gen(function* () {
      const fs = yield* makeMemoryFs()
      const reg = registry.get("doctor")!
      const result = yield* runRegistered(reg, { positionals: [], policy: {}, fs })
      expect(result.exitCode).toBe(EXIT_SUCCESS)
      const payload = result.payload as {
        available: boolean
        capabilities: Record<string, string>
      }
      expect(payload.available).toBe(true)
      expect(payload.capabilities.xcrun).toBe("unknown")
    }).pipe(Effect.provide(TestCaps)),
  )

  it.effect("policy show → reflects the gate decision for an action", () =>
    Effect.gen(function* () {
      const fs = yield* makeMemoryFs()
      const reg = registry.get("policy show")!
      // No policy ⇒ a device action is denied.
      const denied = yield* runRegistered(reg, {
        positionals: ["launch-app"],
        policy: {},
        fs,
      })
      const dp = denied.payload as { denied: boolean; decision: string }
      expect(dp.denied).toBe(true)
      expect(dp.decision).toBe("deny")
      // Allowing the action flips the decision.
      const allowed = yield* runRegistered(reg, {
        positionals: ["launch-app"],
        policy: { allow: ["launch-app"] },
        fs,
      })
      const ap = allowed.payload as { denied: boolean; decision: string }
      expect(ap.denied).toBe(false)
      expect(ap.decision).toBe("allow")
    }).pipe(Effect.provide(TestCaps)),
  )

  it.effect("redact <file> → reads + redacts file contents (AC-003/012)", () =>
    Effect.gen(function* () {
      const fs = yield* makeMemoryFs()
      yield* fs.writeFile("/secrets.json", JSON.stringify({ authorization: "Bearer abc", visible: 1 }))
      const reg = registry.get("redact")!
      const result = yield* runRegistered(reg, {
        positionals: ["/secrets.json"],
        policy: {},
        fs,
      })
      expect(result.exitCode).toBe(EXIT_SUCCESS)
      const payload = result.payload as {
        redacted: { authorization: string; visible: number }
      }
      expect(payload.redacted.authorization).toBe("[redacted]")
      expect(payload.redacted.visible).toBe(1)
    }).pipe(Effect.provide(TestCaps)),
  )

  it.effect("redact with a missing file → exit 1, { ok:false, error }", () =>
    Effect.gen(function* () {
      const fs = yield* makeMemoryFs()
      const reg = registry.get("redact")!
      const result = yield* runRegistered(reg, {
        positionals: ["/does-not-exist.json"],
        policy: {},
        fs,
      })
      // A handler runtime failure ⇒ exit 1 and the failure envelope.
      expect(result.exitCode).toBe(EXIT_RUNTIME_FAILURE)
      const payload = result.payload as { ok: boolean; error: string }
      expect(payload.ok).toBe(false)
      expect(payload.error).toContain("Cannot read")
    }).pipe(Effect.provide(TestCaps)),
  )

  it.effect("redact with no <file> argument → exit 1 usage-ish runtime error", () =>
    Effect.gen(function* () {
      const fs = yield* makeMemoryFs()
      const reg = registry.get("redact")!
      const result = yield* runRegistered(reg, { positionals: [], policy: {}, fs })
      expect(result.exitCode).toBe(EXIT_RUNTIME_FAILURE)
      const payload = result.payload as { ok: boolean; error: string }
      expect(payload.error).toContain("requires a <file>")
    }).pipe(Effect.provide(TestCaps)),
  )
})

describe("registry — composition wiring", () => {
  it("registers the five core read commands at stable paths", () => {
    expect([...registry.paths].sort()).toEqual(["doctor", "policy show", "redact", "skills list", "version"].sort())
  })

  it("rejects duplicate command paths (fail fast)", () => {
    expect(() => registerCommands([...coreReadCommands, ...coreReadCommands])).toThrow(/Duplicate command path/)
  })
})
