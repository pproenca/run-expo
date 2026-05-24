/**
 * `rn` — D8 React Native component-tree introspection (AC-055).
 *
 * Four read verbs: `tree` / `refs` / `renders` / `inspect`. Every verb is a
 * pure `read` (handler `R = never`): introspection evidence is harvested over a
 * READ surface (in a live build, a fixed semantic probe) and the component graph
 * is passed in by the shell. This module owns ONLY the AC-055 traversal CAPS and
 * the value ROUNDING — the numeric contract the legacy spread across the handler.
 *
 * Caps (AC-055):
 *   - `maxDepth  = max(1, min(depth ?? 30, 80))`
 *   - `maxNodes  = max(1, min(limit ?? 500, 2000))`
 *   - ancestor path: traverse ≤ depth 40, then `slice(16, 24)`
 *   - control list `slice(0, 80)`; record list `slice(0, 60)`
 *   - element actions `slice(0, 10)`
 *   - `round(v) = Math.round(v * 100) / 100`
 */
import { command, type Command } from "@expo98/core"
import { Effect } from "effect"
import {
  ANCESTOR_PATH_DEPTH_CAP,
  ANCESTOR_SLICE_HEAD,
  ANCESTOR_SLICE_TAIL,
  CONTROL_LIST_CAP,
  descriptor,
  ELEMENT_ACTIONS_CAP,
  RECORD_LIST_CAP,
  resolveRnMaxDepth,
  resolveRnMaxNodes,
  round,
} from "./support.js"

export type RnVerb = "tree" | "refs" | "renders" | "inspect"

// ───────────────────────────────────────────────────────────────────────────
// Input graph (what the shell harvests over the read surface)
// ───────────────────────────────────────────────────────────────────────────

/** One node in the RN component graph (children referenced by index). */
export interface RnNode {
  readonly id: string
  readonly name: string
  readonly depth: number
  /** Measured layout (rounded on output). */
  readonly layout?: { readonly x: number; readonly y: number; readonly width: number; readonly height: number }
  /** Interaction actions (capped to 10 on output). */
  readonly actions?: ReadonlyArray<string>
  /** Last commit duration in ms (rounded on output). */
  readonly renderMs?: number
  /** Ancestor names, root-first (capped/sliced on output). */
  readonly ancestors?: ReadonlyArray<string>
}

export interface RnArgs {
  readonly depth?: number
  readonly limit?: number
}

// ───────────────────────────────────────────────────────────────────────────
// Output rows
// ───────────────────────────────────────────────────────────────────────────

export interface RnTreeRow {
  readonly id: string
  readonly name: string
  readonly depth: number
  readonly actions: ReadonlyArray<string>
}

export interface RnRefRow {
  readonly id: string
  readonly name: string
  readonly box: { readonly x: number; readonly y: number; readonly width: number; readonly height: number } | null
  readonly actions: ReadonlyArray<string>
}

export interface RnRenderRow {
  readonly id: string
  readonly name: string
  readonly renderMs: number
}

export interface RnInspectResult {
  readonly id: string
  readonly name: string
  readonly box: { readonly x: number; readonly y: number; readonly width: number; readonly height: number } | null
  readonly actions: ReadonlyArray<string>
  readonly ancestors: ReadonlyArray<string>
}

export interface RnUnavailable {
  readonly available: false
  readonly action: string
  readonly reason: string
}

export interface RnTreeResult {
  readonly available: true
  readonly action: "rn.tree"
  readonly maxDepth: number
  readonly maxNodes: number
  readonly nodes: ReadonlyArray<RnTreeRow>
}

export interface RnRefsResult {
  readonly available: true
  readonly action: "rn.refs"
  readonly maxDepth: number
  readonly maxNodes: number
  readonly controls: ReadonlyArray<RnRefRow>
}

export interface RnRendersResult {
  readonly available: true
  readonly action: "rn.renders"
  readonly maxDepth: number
  readonly maxNodes: number
  readonly records: ReadonlyArray<RnRenderRow>
}

export interface RnInspectResultEnvelope {
  readonly available: true
  readonly action: "rn.inspect"
  readonly element: RnInspectResult
}

export type RnResult = RnUnavailable | RnTreeResult | RnRefsResult | RnRendersResult | RnInspectResultEnvelope

// ───────────────────────────────────────────────────────────────────────────
// AC-055 helpers (PURE — exported for direct assertions)
// ───────────────────────────────────────────────────────────────────────────

const roundBox = (
  layout: RnNode["layout"],
): { readonly x: number; readonly y: number; readonly width: number; readonly height: number } | null =>
  layout === undefined
    ? null
    : {
        x: round(layout.x),
        y: round(layout.y),
        width: round(layout.width),
        height: round(layout.height),
      }

/** Element actions capped to 10 (AC-055). */
export const capActions = (actions: ReadonlyArray<string> | undefined): ReadonlyArray<string> =>
  (actions ?? []).slice(0, ELEMENT_ACTIONS_CAP)

/**
 * Ancestor path cap (AC-055): take at most the first 40 ancestors, then
 * `slice(16, 24)` of that capped path.
 */
export const capAncestors = (ancestors: ReadonlyArray<string> | undefined): ReadonlyArray<string> =>
  (ancestors ?? []).slice(0, ANCESTOR_PATH_DEPTH_CAP).slice(ANCESTOR_SLICE_HEAD, ANCESTOR_SLICE_TAIL)

/**
 * Apply the depth + node caps to the graph: keep nodes with `depth <= maxDepth`,
 * then `slice(0, maxNodes)` (AC-055). PURE.
 */
export const applyTraversalCaps = (
  graph: ReadonlyArray<RnNode>,
  maxDepth: number,
  maxNodes: number,
): ReadonlyArray<RnNode> => graph.filter((n) => n.depth <= maxDepth).slice(0, maxNodes)

// ───────────────────────────────────────────────────────────────────────────
// Per-verb projections
// ───────────────────────────────────────────────────────────────────────────

const buildTree = (capped: ReadonlyArray<RnNode>): ReadonlyArray<RnTreeRow> =>
  capped.map((n) => ({
    id: n.id,
    name: n.name,
    depth: n.depth,
    actions: capActions(n.actions),
  }))

/** `refs` ⇒ the control list, capped at 80 (AC-055). */
const buildRefs = (capped: ReadonlyArray<RnNode>): ReadonlyArray<RnRefRow> =>
  capped.slice(0, CONTROL_LIST_CAP).map((n) => ({
    id: n.id,
    name: n.name,
    box: roundBox(n.layout),
    actions: capActions(n.actions),
  }))

/** `renders` ⇒ the render record list, capped at 60 with rounded ms (AC-055). */
const buildRenders = (capped: ReadonlyArray<RnNode>): ReadonlyArray<RnRenderRow> =>
  capped
    .filter((n): n is RnNode & { renderMs: number } => typeof n.renderMs === "number")
    .slice(0, RECORD_LIST_CAP)
    .map((n) => ({ id: n.id, name: n.name, renderMs: round(n.renderMs) }))

const buildInspect = (node: RnNode): RnInspectResult => ({
  id: node.id,
  name: node.name,
  box: roundBox(node.layout),
  actions: capActions(node.actions),
  ancestors: capAncestors(node.ancestors),
})

// ───────────────────────────────────────────────────────────────────────────
// Result + command
// ───────────────────────────────────────────────────────────────────────────

export interface RnInput {
  readonly graph: ReadonlyArray<RnNode> | null
  readonly args?: RnArgs
  /** For `inspect`: the target element id. */
  readonly elementId?: string
}

const NO_GRAPH_REASON = "No component graph available. Capture a snapshot first."

/** Compute the RN introspection result for a verb. PURE. */
export const rnResult = (verb: RnVerb, input: RnInput): RnResult => {
  if (input.graph === null) {
    return { available: false, action: `rn.${verb}`, reason: NO_GRAPH_REASON }
  }
  const maxDepth = resolveRnMaxDepth(input.args?.depth)
  const maxNodes = resolveRnMaxNodes(input.args?.limit)
  const capped = applyTraversalCaps(input.graph, maxDepth, maxNodes)

  switch (verb) {
    case "tree":
      return {
        available: true,
        action: "rn.tree",
        maxDepth,
        maxNodes,
        nodes: buildTree(capped),
      }
    case "refs":
      return {
        available: true,
        action: "rn.refs",
        maxDepth,
        maxNodes,
        controls: buildRefs(capped),
      }
    case "renders":
      return {
        available: true,
        action: "rn.renders",
        maxDepth,
        maxNodes,
        records: buildRenders(capped),
      }
    case "inspect": {
      const found = capped.find((n) => n.id === input.elementId)
      if (found === undefined) {
        return {
          available: false,
          action: "rn.inspect",
          reason: `Element "${input.elementId ?? ""}" not found in the capped graph.`,
        }
      }
      return { available: true, action: "rn.inspect", element: buildInspect(found) }
    }
  }
}

/**
 * Build the `rn.<verb>` read command. The projection is computed at construction
 * time so the handler stays a pure `read` (R = never).
 */
export const rnCommand = (verb: RnVerb, input: RnInput): Command<"read", RnResult> =>
  command(descriptor(`rn.${verb}`, "read"), Effect.succeed(rnResult(verb, input)))
