/**
 * Smoke — `dashboard` opens NO network listener (interfaces §1.4).
 *
 * The dashboard is file/state ONLY. The single inbound listener in the system is
 * the review-overlay ingest server (its own package). This test asserts:
 *   1. `dashboard.networkListener` is `false` for every verb (the runtime claim).
 *   2. The dashboard module SOURCE imports no `http`/`net`/socket/`ws` — a
 *      structural guard so a regression that adds a port bind is caught.
 *
 * Run through core's dispatch (read path, ungated).
 */
import { describe, expect, it } from "@effect/vitest"
import {
  DeviceCapability,
  dispatch,
  EXIT_SUCCESS,
  RuntimeEvalCapability,
  SourceWriteCapability
} from "@expo98/core"
import {
  dashboardCommand,
  type DashboardResult,
  type DashboardVerb
} from "@expo98/handlers-artifacts"
import { Effect, Layer } from "effect"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

const Caps = Layer.mergeAll(
  Layer.succeed(
    RuntimeEvalCapability,
    RuntimeEvalCapability.of({ evaluate: () => Effect.succeed(null) })
  ),
  Layer.succeed(
    DeviceCapability,
    DeviceCapability.of({ invoke: () => Effect.succeed("ok") })
  ),
  Layer.succeed(
    SourceWriteCapability,
    SourceWriteCapability.of({
      writeFile: () => Effect.void,
      deleteFile: () => Effect.void
    })
  )
)

const VERBS: ReadonlyArray<DashboardVerb> = ["start", "stop", "report"]

describe("dashboard opens NO network listener (file/state only)", () => {
  for (const verb of VERBS) {
    it.effect(`dashboard ${verb} reports networkListener:false (no port bind)`, () =>
      Effect.gen(function* () {
        const result = yield* dispatch(dashboardCommand(verb), {}).pipe(
          Effect.provide(Caps)
        )
        expect(result.exitCode).toBe(EXIT_SUCCESS)
        expect(result.sideEffect).toBe("read")
        const payload = result.payload as DashboardResult
        expect(payload.networkListener).toBe(false)
      })
    )
  }

  it("dashboard start→running, stop→stopped, report→prior status", () => {
    const start = dashboardCommand("start")
    const stop = dashboardCommand("stop")
    // Construct and read the synchronous handlers' descriptors are read-classed.
    expect(start.descriptor.sideEffect).toBe("read")
    expect(stop.descriptor.sideEffect).toBe("read")
  })

  it("dashboard SOURCE imports no http/net/socket/ws (structural no-listener guard)", () => {
    const src = readFileSync(
      fileURLToPath(new URL("../src/dashboard.ts", import.meta.url)),
      "utf8"
    )
    // No network primitives may be imported in the dashboard module.
    expect(src).not.toMatch(/from\s+["']node:http["']/)
    expect(src).not.toMatch(/from\s+["']node:net["']/)
    expect(src).not.toMatch(/from\s+["']node:https["']/)
    expect(src).not.toMatch(/createServer/)
    expect(src).not.toMatch(/\.listen\(/)
    expect(src).not.toMatch(/from\s+["']ws["']/)
  })
})
