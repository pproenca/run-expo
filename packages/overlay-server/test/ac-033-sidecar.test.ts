/**
 * AC-033 — Session sidecar lifecycle (the "implement, don't drop" decision).
 *
 * A REAL `running → stale → stopped` state machine over the domain `SidecarRecord`
 * for the one long-lived sidecar (the review-overlay ingest server). The legacy
 * declared the statuses but never populated a non-empty `sidecars`; this proves
 * each transition.
 */
import { type SidecarRecord } from "@expo98/domain"
import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import {
  isReapable,
  observeLiveness,
  refreshSidecar,
  registerSidecar,
  SIDECAR_NAME,
  type SidecarProbe,
  stopSidecar
} from "../src/index.js"

describe("AC-033 sidecar transitions (PURE)", () => {
  it("register → running", () => {
    const s = registerSidecar(4242, 17655)
    expect(s).toEqual({ name: SIDECAR_NAME, pid: 4242, port: 17655, status: "running" })
  })

  it("running → stale when the process is no longer alive", () => {
    const running = registerSidecar(4242, 17655)
    const stale = observeLiveness(running, false)
    expect(stale.status).toBe("stale")
  })

  it("running → running when still alive", () => {
    const running = registerSidecar(4242, 17655)
    expect(observeLiveness(running, true).status).toBe("running")
  })

  it("running → stopped on a clean stop()", () => {
    const running = registerSidecar(4242, 17655)
    const stopped = stopSidecar(running)
    expect(stopped.status).toBe("stopped")
  })

  it("stale → stopped (reaped)", () => {
    const stale = observeLiveness(registerSidecar(4242, 17655), false)
    expect(isReapable(stale)).toBe(true)
    expect(stopSidecar(stale).status).toBe("stopped")
  })

  it("stale → running when re-observed alive (probe raced a restart)", () => {
    const stale = observeLiveness(registerSidecar(4242, 17655), false)
    expect(observeLiveness(stale, true).status).toBe("running")
  })

  it("stopped is terminal — a liveness probe never resurrects it", () => {
    const stopped = stopSidecar(registerSidecar(4242, 17655))
    expect(observeLiveness(stopped, true).status).toBe("stopped")
    expect(observeLiveness(stopped, false).status).toBe("stopped")
  })

  it("isReapable only for stale records", () => {
    const running = registerSidecar(4242, 17655)
    expect(isReapable(running)).toBe(false)
    expect(isReapable(stopSidecar(running))).toBe(false)
    expect(isReapable(observeLiveness(running, false))).toBe(true)
  })

  it("the full running → stale → stopped path", () => {
    let s: SidecarRecord = registerSidecar(4242, 17655)
    expect(s.status).toBe("running")
    s = observeLiveness(s, false) // process vanished
    expect(s.status).toBe("stale")
    s = stopSidecar(s) // reaped
    expect(s.status).toBe("stopped")
  })
})

describe("AC-033 refreshSidecar (Effectful, scripted probe)", () => {
  const aliveProbe = (alive: boolean): SidecarProbe => ({ isAlive: () => Effect.succeed(alive) })

  it.effect("refresh drives running → stale from a dead probe", () =>
    Effect.gen(function* () {
      const running = registerSidecar(4242, 17655)
      const refreshed = yield* refreshSidecar(running, aliveProbe(false))
      expect(refreshed.status).toBe("stale")
    })
  )

  it.effect("refresh keeps running when the probe reports alive", () =>
    Effect.gen(function* () {
      const running = registerSidecar(4242, 17655)
      const refreshed = yield* refreshSidecar(running, aliveProbe(true))
      expect(refreshed.status).toBe("running")
    })
  )

  it.effect("refresh short-circuits a stopped record (no probe call)", () =>
    Effect.gen(function* () {
      let probed = false
      const probe: SidecarProbe = {
        isAlive: () =>
          Effect.sync(() => {
            probed = true
            return true
          })
      }
      const stopped = stopSidecar(registerSidecar(4242, 17655))
      const refreshed = yield* refreshSidecar(stopped, probe)
      expect(refreshed.status).toBe("stopped")
      expect(probed).toBe(false)
    })
  )
})
