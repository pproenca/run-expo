/**
 * AC-058 — live-backlog substitutions must be PROJECT INPUTS, never baked fixtures.
 *
 *   - `__METRO_PORT__` → `clamp(metroPort ?? 8081, 1, 65535)` (the one default).
 *   - `__BUNDLE_ID__`, `__DEVICE__`, `__DEV_CLIENT_URL__` resolve ONLY from
 *     required project inputs; a missing required input → a clear error, NOT a
 *     default fixture.
 *   - The legacy developer fixtures (`com.maddie.console`, `exp+maddie://`,
 *     `booted`) must NOT appear ANYWHERE — template, resolver, or output.
 *
 * Run END-TO-END through core's dispatch where a command is involved (read path,
 * ungated) and directly against the pure resolver/builder.
 */
import { describe, expect, it } from "@effect/vitest"
import { DeviceCapability, dispatch, EXIT_SUCCESS, RuntimeEvalCapability, SourceWriteCapability } from "@expo98/core"
import {
  applySubstitutions,
  BACKLOG_TEMPLATE,
  buildMatrix,
  type BacklogInputs,
  liveBacklogMatrixCommand,
  MissingBacklogInput,
  resolveMetroPort,
  resolveSubstitution,
  resolveSubstitutions,
} from "@expo98/handlers-artifacts"
import { Effect, Layer } from "effect"

const Caps = Layer.mergeAll(
  Layer.succeed(RuntimeEvalCapability, RuntimeEvalCapability.of({ evaluate: () => Effect.succeed(null) })),
  Layer.succeed(DeviceCapability, DeviceCapability.of({ invoke: () => Effect.succeed("ok") })),
  Layer.succeed(
    SourceWriteCapability,
    SourceWriteCapability.of({
      writeFile: () => Effect.void,
      deleteFile: () => Effect.void,
    }),
  ),
)

const FORBIDDEN_FIXTURES = ["com.maddie.console", "exp+maddie://", "exp+maddie", "booted"]

const COMPLETE_INPUTS: BacklogInputs = {
  metroPort: 8081,
  bundleId: "com.example.myapp",
  device: "iPhone 16 Pro",
  devClientUrl: "exp+myapp://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A8081",
}

describe("AC-058 live-backlog substitutions are project inputs, not fixtures", () => {
  it("AC-058 __METRO_PORT__ defaults to 8081 and clamps to [1, 65535]", () => {
    expect(resolveMetroPort(undefined)).toBe(8081)
    expect(resolveMetroPort(8082)).toBe(8082)
    expect(resolveMetroPort(0)).toBe(1)
    expect(resolveMetroPort(70_000)).toBe(65_535)
    // The default reaches the placeholder value, end-to-end.
    const r = resolveSubstitution("__METRO_PORT__", {})
    expect(r._tag).toBe("resolved")
    if (r._tag === "resolved") {
      expect(r.value).toBe("8081")
    }
  })

  it("AC-058 the other three resolve from PROVIDED inputs (no fixtures)", () => {
    const bundle = resolveSubstitution("__BUNDLE_ID__", COMPLETE_INPUTS)
    const device = resolveSubstitution("__DEVICE__", COMPLETE_INPUTS)
    const url = resolveSubstitution("__DEV_CLIENT_URL__", COMPLETE_INPUTS)
    expect(bundle).toEqual({
      _tag: "resolved",
      placeholder: "__BUNDLE_ID__",
      value: "com.example.myapp",
    })
    expect(device).toEqual({
      _tag: "resolved",
      placeholder: "__DEVICE__",
      value: "iPhone 16 Pro",
    })
    expect(url._tag).toBe("resolved")
    if (url._tag === "resolved") {
      expect(url.value).toBe(COMPLETE_INPUTS.devClientUrl)
    }
  })

  it("AC-058 a missing required input → a clear error, NOT a default fixture", () => {
    // No bundleId / device / devClientUrl supplied (only the defaulting port).
    const resolution = resolveSubstitutions({ metroPort: 8081 })
    expect(resolution._tag).toBe("missing")
    if (resolution._tag === "missing") {
      const missingNames = resolution.errors.map((e) => e.inputName).sort()
      expect(missingNames).toEqual(["bundleId", "devClientUrl", "device"])
      for (const error of resolution.errors) {
        expect(error).toBeInstanceOf(MissingBacklogInput)
        // The error names the input to provide and says there is NO baked default.
        expect(error.message).toContain("there is no baked default")
        // And the error itself never leaks a developer fixture.
        for (const fixture of FORBIDDEN_FIXTURES) {
          expect(error.message).not.toContain(fixture)
        }
      }
    }
  })

  it("AC-058 each placeholder fails individually when its input is absent", () => {
    expect(resolveSubstitution("__BUNDLE_ID__", {})._tag).toBe("missing")
    expect(resolveSubstitution("__DEVICE__", {})._tag).toBe("missing")
    expect(resolveSubstitution("__DEV_CLIENT_URL__", {})._tag).toBe("missing")
    // Empty-string is treated as missing too (cannot be a real bundle id).
    expect(resolveSubstitution("__BUNDLE_ID__", { bundleId: "" })._tag).toBe("missing")
  })

  it("AC-058 buildMatrix substitutes provided inputs and applies them to argv", () => {
    const result = buildMatrix(COMPLETE_INPUTS)
    expect(result._tag).toBe("ok")
    if (result._tag === "ok") {
      const launch = result.rows.find((r) => r.id === "launch-app")
      expect(launch?.argv).toEqual([
        "--bundle-id",
        "com.example.myapp",
        "--device",
        "iPhone 16 Pro",
        "--crash-check-ms",
        "1000",
      ])
      const metro = result.rows.find((r) => r.id === "metro-status")
      expect(metro?.argv).toContain("8081")
      // No surviving placeholders anywhere in the substituted matrix.
      const allArgv = result.rows.flatMap((r) => r.argv)
      for (const token of allArgv) {
        expect(token).not.toContain("__")
      }
    }
  })

  it("AC-058 buildMatrix returns the missing inputs (not fixtures) when incomplete", () => {
    const result = buildMatrix({ metroPort: 8081 })
    expect(result._tag).toBe("missing")
    if (result._tag === "missing") {
      const serialized = JSON.stringify(result.errors.map((e) => e.message))
      for (const fixture of FORBIDDEN_FIXTURES) {
        expect(serialized).not.toContain(fixture)
      }
    }
  })

  it("AC-058 applySubstitutions replaces every occurrence and leaves other text alone", () => {
    const map = {
      values: {
        __METRO_PORT__: "8081",
        __BUNDLE_ID__: "com.example.myapp",
        __DEVICE__: "iPhone 16 Pro",
        __DEV_CLIENT_URL__: "exp+myapp://x",
      },
    }
    expect(applySubstitutions("port=__METRO_PORT__/__METRO_PORT__", map)).toBe("port=8081/8081")
    expect(applySubstitutions("literal", map)).toBe("literal")
  })

  it.effect("AC-058 live-backlog matrix command (read, ungated) substitutes provided inputs", () =>
    Effect.gen(function* () {
      const result = yield* dispatch(liveBacklogMatrixCommand(COMPLETE_INPUTS), {}).pipe(Effect.provide(Caps))
      expect(result.exitCode).toBe(EXIT_SUCCESS)
      expect(result.sideEffect).toBe("read")
      const payload = result.payload as {
        available: boolean
        rows: ReadonlyArray<{ argv: ReadonlyArray<string> }>
      }
      expect(payload.available).toBe(true)
      const flat = JSON.stringify(payload)
      for (const fixture of FORBIDDEN_FIXTURES) {
        expect(flat).not.toContain(fixture)
      }
    }),
  )

  it.effect("AC-058 live-backlog matrix command with missing inputs is available:false (no fixtures)", () =>
    Effect.gen(function* () {
      const result = yield* dispatch(liveBacklogMatrixCommand({ metroPort: 8081 }), {}).pipe(Effect.provide(Caps))
      const payload = result.payload as {
        available: boolean
        missing: ReadonlyArray<string>
      }
      expect(payload.available).toBe(false)
      expect([...payload.missing].sort()).toEqual(["bundleId", "devClientUrl", "device"])
    }),
  )

  it("AC-058 NO baked developer fixtures appear in the source-derived template", () => {
    const serialized = JSON.stringify(BACKLOG_TEMPLATE)
    for (const fixture of FORBIDDEN_FIXTURES) {
      expect(serialized).not.toContain(fixture)
    }
    // The template carries placeholders, proving substitution is deferred.
    expect(serialized).toContain("__BUNDLE_ID__")
    expect(serialized).toContain("__DEV_CLIENT_URL__")
    expect(serialized).toContain("__DEVICE__")
    expect(serialized).toContain("__METRO_PORT__")
  })
})
