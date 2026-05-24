/**
 * AC-055 — RN introspection caps traversal depth/nodes and rounds.
 *
 *   maxDepth = max(1, min(depth ?? 30, 80))
 *   maxNodes = max(1, min(limit ?? 500, 2000))
 *   ancestor path: take ≤ depth 40, then slice(16, 24)
 *   control list slice(0, 80); record list slice(0, 60); element actions slice(0, 10)
 *   round(v) = Math.round(v * 100) / 100
 *
 * We assert each cap function directly AND the per-verb projection (tree/refs/
 * renders/inspect), plus the no-graph edge.
 */
import { describe, expect, it } from "@effect/vitest"
import {
  applyTraversalCaps,
  capActions,
  capAncestors,
  resolveRnMaxDepth,
  resolveRnMaxNodes,
  type RnInspectResultEnvelope,
  type RnNode,
  type RnRefsResult,
  type RnRendersResult,
  rnResult,
  type RnTreeResult,
  type RnUnavailable,
  round,
} from "@expo98/handlers-snapshot"

const node = (over: Omit<Partial<RnNode>, "id"> & { id: string }): RnNode => ({
  name: `Comp${over.id}`,
  depth: 0,
  ...over,
  id: over.id,
})

describe("AC-055 depth + node caps", () => {
  it("AC-055 maxDepth = max(1, min(depth ?? 30, 80))", () => {
    expect(resolveRnMaxDepth(undefined)).toBe(30)
    expect(resolveRnMaxDepth(0)).toBe(1) // max(1, min(0,80)) = 1
    expect(resolveRnMaxDepth(-5)).toBe(1)
    expect(resolveRnMaxDepth(50)).toBe(50)
    expect(resolveRnMaxDepth(80)).toBe(80)
    expect(resolveRnMaxDepth(81)).toBe(80)
    expect(resolveRnMaxDepth(9_999)).toBe(80)
  })

  it("AC-055 maxNodes = max(1, min(limit ?? 500, 2000))", () => {
    expect(resolveRnMaxNodes(undefined)).toBe(500)
    expect(resolveRnMaxNodes(0)).toBe(1)
    expect(resolveRnMaxNodes(-5)).toBe(1)
    expect(resolveRnMaxNodes(1_000)).toBe(1_000)
    expect(resolveRnMaxNodes(2_000)).toBe(2_000)
    expect(resolveRnMaxNodes(2_001)).toBe(2_000)
    expect(resolveRnMaxNodes(99_999)).toBe(2_000)
  })

  it("AC-055 applyTraversalCaps prunes depth > maxDepth then slices to maxNodes", () => {
    const graph: ReadonlyArray<RnNode> = Array.from({ length: 10 }, (_, i) => node({ id: `${i}`, depth: i }))
    // maxDepth 5 keeps depths 0..5 (6 nodes), maxNodes 3 slices to first 3.
    const capped = applyTraversalCaps(graph, 5, 3)
    expect(capped.map((n) => n.id)).toEqual(["0", "1", "2"])
    // maxDepth 4 (depths 0..4 = 5 nodes), maxNodes 100 keeps all 5.
    const capped2 = applyTraversalCaps(graph, 4, 100)
    expect(capped2.map((n) => n.id)).toEqual(["0", "1", "2", "3", "4"])
  })
})

describe("AC-055 round / actions / ancestors caps", () => {
  it("AC-055 round(v) = Math.round(v*100)/100", () => {
    expect(round(1.23456)).toBe(1.23)
    expect(round(1.235)).toBe(1.24)
    expect(round(10)).toBe(10)
    expect(round(0.1 + 0.2)).toBe(0.3)
  })

  it("AC-055 element actions slice(0, 10)", () => {
    const many = Array.from({ length: 20 }, (_, i) => `a${i}`)
    expect(capActions(many)).toHaveLength(10)
    expect(capActions(many)).toEqual(many.slice(0, 10))
    expect(capActions(undefined)).toEqual([])
  })

  it("AC-055 ancestor path: take ≤ 40 deep, then slice(16, 24)", () => {
    // 50 ancestors → first 40 → slice(16,24) = indices 16..23 (8 entries).
    const many = Array.from({ length: 50 }, (_, i) => `anc${i}`)
    const sliced = capAncestors(many)
    expect(sliced).toEqual(many.slice(0, 40).slice(16, 24))
    expect(sliced).toHaveLength(8)
    expect(sliced[0]).toBe("anc16")
    expect(sliced[sliced.length - 1]).toBe("anc23")
    // Fewer than 16 ancestors → empty after the slice.
    expect(capAncestors(["a", "b"])).toEqual([])
    expect(capAncestors(undefined)).toEqual([])
  })
})

describe("AC-055 per-verb projections", () => {
  it("AC-055 tree caps actions per node and respects depth/node caps", () => {
    const graph: ReadonlyArray<RnNode> = [
      node({ id: "1", depth: 0, actions: Array.from({ length: 15 }, (_, i) => `a${i}`) }),
      node({ id: "2", depth: 1 }),
      node({ id: "3", depth: 99 }), // pruned by default maxDepth 30
    ]
    const result = rnResult("tree", { graph }) as RnTreeResult
    expect(result.maxDepth).toBe(30)
    expect(result.maxNodes).toBe(500)
    expect(result.nodes.map((n) => n.id)).toEqual(["1", "2"])
    expect(result.nodes[0]?.actions).toHaveLength(10)
  })

  it("AC-055 refs caps the control list at 80 and rounds the box", () => {
    const graph: ReadonlyArray<RnNode> = Array.from({ length: 120 }, (_, i) =>
      node({
        id: `${i}`,
        depth: 0,
        layout: { x: 1.239, y: 2.5, width: 3.001, height: 4.999 },
      }),
    )
    const result = rnResult("refs", { graph }) as RnRefsResult
    expect(result.controls).toHaveLength(80)
    expect(result.controls[0]?.box).toEqual({ x: 1.24, y: 2.5, width: 3, height: 5 })
  })

  it("AC-055 renders caps the record list at 60 and rounds renderMs", () => {
    const graph: ReadonlyArray<RnNode> = Array.from({ length: 100 }, (_, i) =>
      node({ id: `${i}`, depth: 0, renderMs: 16.666 + i }),
    )
    const result = rnResult("renders", { graph }) as RnRendersResult
    expect(result.records).toHaveLength(60)
    expect(result.records[0]?.renderMs).toBe(16.67)
  })

  it("AC-055 renders skips nodes without a renderMs measurement", () => {
    const graph: ReadonlyArray<RnNode> = [
      node({ id: "1", depth: 0, renderMs: 12.345 }),
      node({ id: "2", depth: 0 }), // no renderMs
    ]
    const result = rnResult("renders", { graph }) as RnRendersResult
    expect(result.records.map((r) => r.id)).toEqual(["1"])
    expect(result.records[0]?.renderMs).toBe(12.35)
  })

  it("AC-055 inspect caps actions(10) + ancestors(40→slice16,24) and rounds the box", () => {
    const graph: ReadonlyArray<RnNode> = [
      node({
        id: "target",
        depth: 0,
        layout: { x: 5.555, y: 6.5, width: 7.004, height: 8.996 },
        actions: Array.from({ length: 12 }, (_, i) => `a${i}`),
        ancestors: Array.from({ length: 50 }, (_, i) => `anc${i}`),
      }),
    ]
    const result = rnResult("inspect", { graph, elementId: "target" }) as RnInspectResultEnvelope
    expect(result.available).toBe(true)
    expect(result.element.actions).toHaveLength(10)
    expect(result.element.ancestors).toEqual(
      Array.from({ length: 50 }, (_, i) => `anc${i}`)
        .slice(0, 40)
        .slice(16, 24),
    )
    expect(result.element.box).toEqual({ x: 5.56, y: 6.5, width: 7, height: 9 })
  })

  it("AC-055 inspect of a missing element → available:false", () => {
    const result = rnResult("inspect", {
      graph: [node({ id: "a", depth: 0 })],
      elementId: "missing",
    }) as RnUnavailable
    expect(result.available).toBe(false)
  })

  it("AC-055 no component graph → available:false (every verb)", () => {
    for (const verb of ["tree", "refs", "renders", "inspect"] as const) {
      const result = rnResult(verb, { graph: null }) as RnUnavailable
      expect(result.available).toBe(false)
    }
  })
})
