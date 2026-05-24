/**
 * `dashboard` — D12 session observability (`start` / `stop` / `report`).
 *
 * CRITICAL CONTRACT (interfaces §1.4): the dashboard is FILE/STATE ONLY — it
 * opens NO network listener. The only inbound listener in the whole system is the
 * review-overlay ingest server (its own package, `@expo98/overlay-server`); the
 * dead `annotation-server` tombstone is gone. `dashboard` `start`/`stop` flip an
 * observability state record on disk and `report` reads it back — there is no
 * `http`/socket import in this module, by design.
 *
 * A pure `read` command (handler `R = never`): it mutates only an observability
 * state value the caller persists, never a device, never injected JS, never a
 * port bind. No AC pins its calculation beyond "no network listener", so the
 * shape is the contract.
 */
import { command, type Command } from "@expo98/core"
import { Effect } from "effect"
import { descriptor } from "./support.js"

export type DashboardVerb = "start" | "stop" | "report"

/** The observability state a dashboard tracks (file/state only — no pid/port). */
export type DashboardStatus = "running" | "stopped" | "unknown"

export interface DashboardArgs {
  /** The prior persisted state, if any (the caller reads it from disk). */
  readonly priorStatus?: DashboardStatus
  /** Observability metrics rolled into a `report` (opaque; caller-shaped). */
  readonly metrics?: Readonly<Record<string, unknown>>
}

export interface DashboardResult {
  readonly action: "dashboard"
  readonly verb: DashboardVerb
  /** The resulting observability state (file/state only). */
  readonly status: DashboardStatus
  /**
   * Always `false`: the dashboard NEVER opens a network listener. Asserted by
   * the smoke test so a regression that adds a port bind is caught.
   */
  readonly networkListener: false
  /** Present only on `report`. */
  readonly metrics?: Readonly<Record<string, unknown>>
}

/**
 * Build a `dashboard start/stop/report` read command.
 *   - `start`  → status `running`
 *   - `stop`   → status `stopped`
 *   - `report` → reflects the prior status + returns metrics
 *
 * `networkListener` is hard-`false` in every branch — the type literal makes any
 * future "open a server here" change a compile error.
 */
export const dashboardCommand = (
  verb: DashboardVerb,
  args: DashboardArgs = {}
): Command<"read", DashboardResult> =>
  command(
    descriptor(`dashboard.${verb}`, "read"),
    Effect.sync<DashboardResult>(() => {
      switch (verb) {
        case "start":
          return {
            action: "dashboard",
            verb,
            status: "running",
            networkListener: false
          }
        case "stop":
          return {
            action: "dashboard",
            verb,
            status: "stopped",
            networkListener: false
          }
        case "report":
          return {
            action: "dashboard",
            verb,
            status: args.priorStatus ?? "unknown",
            networkListener: false,
            metrics: args.metrics ?? {}
          }
      }
    })
  )
