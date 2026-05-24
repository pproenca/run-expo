import { type SidecarRecord, type SidecarStatus } from "@expo98/domain"
import { Effect } from "effect"

/**
 * Session sidecar lifecycle (AC-033) — the ONE long-lived sidecar.
 *
 * The legacy schema declared `running/stale/stopped/unknown` but no code ever
 * populated a non-empty `sidecars`. This is the "implement, don't drop" decision
 * (CLAUDE.md): a REAL `running → stale → stopped` state machine for the
 * long-lived review-overlay ingest server. (Video `record` and the HTML scaffold
 * are dropped, so this is the only sidecar.)
 *
 * State machine (pure transitions over `@expo98/domain`'s `SidecarRecord`):
 *
 *     register(pid,port) ───────────▶ running
 *          running ── liveness probe fails / pid gone ──▶ stale
 *          running ── stop() ───────────────────────────▶ stopped
 *          stale   ── stop()  (reap) ────────────────────▶ stopped
 *          stale   ── re-observed live (same pid) ───────▶ running
 *          stopped ── (terminal)
 *
 * `unknown` is the initial/indeterminate value the schema allows; this lifecycle
 * never produces it as an outcome — it is only the fail-closed default a reader
 * sees for a record it cannot classify.
 *
 * The transitions are PURE so they are exhaustively testable; an optional
 * liveness probe (`isAlive`) drives the running↔stale edge from real process
 * state when wired into the app.
 */

export const SIDECAR_NAME = "review-overlay-server" as const

/** Build a fresh `running` sidecar record (AC-033). PURE. */
export const registerSidecar = (pid: number, port: number): SidecarRecord => ({
  name: SIDECAR_NAME,
  pid,
  port,
  status: "running",
})

/**
 * Apply a liveness observation to a sidecar. PURE.
 *   - `running` + alive   → `running`
 *   - `running` + dead    → `stale`   (the process vanished without a clean stop)
 *   - `stale`   + alive   → `running` (re-observed; e.g. a probe raced a restart)
 *   - `stale`   + dead    → `stale`
 *   - `stopped`           → `stopped` (terminal; a probe never resurrects it)
 *   - `unknown` + alive   → `running`
 *   - `unknown` + dead    → `stale`
 */
export const observeLiveness = (sidecar: SidecarRecord, alive: boolean): SidecarRecord => {
  if (sidecar.status === "stopped") return sidecar
  const next: SidecarStatus = alive ? "running" : "stale"
  return { ...sidecar, status: next }
}

/** Transition a sidecar to `stopped` (clean shutdown or reaping a stale one). PURE. */
export const stopSidecar = (sidecar: SidecarRecord): SidecarRecord => ({
  ...sidecar,
  status: "stopped",
})

/** Is this sidecar a candidate for reaping (stale and thus safe to stop)? PURE. */
export const isReapable = (sidecar: SidecarRecord): boolean => sidecar.status === "stale"

// ---------------------------------------------------------------------------
// Effectful driver — runs the running↔stale edge from a real liveness probe.
// ---------------------------------------------------------------------------

/**
 * A liveness probe: does the process behind `pid` still hold `port`? Injected so
 * the app wires `process.kill(pid, 0)` / a loopback connect, and tests script it.
 */
export interface SidecarProbe {
  readonly isAlive: (sidecar: SidecarRecord) => Effect.Effect<boolean>
}

/**
 * Refresh a sidecar's status from a live probe (AC-033). Effectful wrapper over
 * the pure `observeLiveness` transition; `stopped` records short-circuit (no probe).
 */
export const refreshSidecar = (sidecar: SidecarRecord, probe: SidecarProbe): Effect.Effect<SidecarRecord> =>
  sidecar.status === "stopped"
    ? Effect.succeed(sidecar)
    : probe.isAlive(sidecar).pipe(Effect.map((alive) => observeLiveness(sidecar, alive)))
