/**
 * `ux-context` — D12 UX-context bundle (`--include-screenshot/-runtime/-hierarchy/-logs`).
 *
 * A pure `read` command that bundles whichever evidence facets the caller opted
 * into. No AC pins the bundle calculation, so this is kept small and faithful:
 * the contract is the envelope/shape — `action`, the selected `includes`, and a
 * `facets` record naming the requested evidence. Handler `R = never` (read).
 */
import { command, type Command } from "@expo98/core"
import { Effect } from "effect"
import { descriptor } from "./support.js"

export interface UxContextArgs {
  readonly includeScreenshot?: boolean
  readonly includeRuntime?: boolean
  readonly includeHierarchy?: boolean
  readonly includeLogs?: boolean
}

export type UxFacet = "screenshot" | "runtime" | "hierarchy" | "logs"

export interface UxContextResult {
  readonly action: "ux-context"
  /** The facets the caller opted into (insertion order = declaration order). */
  readonly includes: ReadonlyArray<UxFacet>
  /** Per-facet inclusion flags (so absent facets are explicit, not missing). */
  readonly facets: Readonly<Record<UxFacet, boolean>>
}

/** Build a `ux-context` read command from the `--include-*` flags. */
export const uxContextCommand = (args: UxContextArgs = {}): Command<"read", UxContextResult> => {
  const facets: Record<UxFacet, boolean> = {
    screenshot: args.includeScreenshot === true,
    runtime: args.includeRuntime === true,
    hierarchy: args.includeHierarchy === true,
    logs: args.includeLogs === true,
  }
  const order: ReadonlyArray<UxFacet> = ["screenshot", "runtime", "hierarchy", "logs"]
  const includes = order.filter((facet) => facets[facet])
  return command(
    descriptor("ux-context", "read"),
    Effect.succeed<UxContextResult>({ action: "ux-context", includes, facets }),
  )
}
