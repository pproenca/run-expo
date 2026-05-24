/**
 * AC-040 — snapshot filter depth clamps to 1..100; deeper nodes are pruned;
 * `null` is unbounded; root depth is 0.
 *
 * We test the two halves directly: `resolveDepth` (the `null` | clamp(1,100)
 * rule) and `filterByDepth` (prune nodes with depth > limit, root at depth 0).
 */
import { describe, expect, it } from "@effect/vitest"
import type { SnapshotNode } from "@expo98/domain"
import { type DepthedNode, filterByDepth, MAX_DEPTH, MIN_DEPTH, resolveDepth } from "@expo98/handlers-snapshot"

const node = (ref: string): SnapshotNode => ({
  ref: ref as SnapshotNode["ref"],
  role: null,
  label: null,
  text: null,
  testID: null,
  source: "semantic-bridge",
  box: null,
  actions: [],
})

const depthed = (refs: ReadonlyArray<[string, number]>): ReadonlyArray<DepthedNode> =>
  refs.map(([ref, depth]) => ({ node: node(ref), depth }))

describe("AC-040 snapshot depth clamp", () => {
  it("AC-040 depth null is unbounded; otherwise clamps to [1, 100]", () => {
    expect(resolveDepth(null)).toBe(null)
    expect(resolveDepth(undefined)).toBe(null)
    expect(resolveDepth(0)).toBe(MIN_DEPTH) // 0 → 1
    expect(resolveDepth(-10)).toBe(MIN_DEPTH)
    expect(resolveDepth(1)).toBe(1)
    expect(resolveDepth(50)).toBe(50)
    expect(resolveDepth(100)).toBe(MAX_DEPTH)
    expect(resolveDepth(101)).toBe(MAX_DEPTH) // 101 → 100
    expect(resolveDepth(9_999)).toBe(MAX_DEPTH)
  })
})

describe("AC-040 depth pruning (root depth 0)", () => {
  const tree = depthed([
    ["@e1", 0], // root
    ["@e2", 1],
    ["@e3", 1],
    ["@e4", 2],
    ["@e5", 3],
  ])

  it("AC-040 null keeps every node (unbounded)", () => {
    const kept = filterByDepth(tree, null)
    expect(kept.map((n) => n.ref)).toEqual(["@e1", "@e2", "@e3", "@e4", "@e5"])
  })

  it("AC-040 depth 0 keeps only the root", () => {
    const kept = filterByDepth(tree, 0)
    expect(kept.map((n) => n.ref)).toEqual(["@e1"])
  })

  it("AC-040 depth 1 keeps the root + its immediate children, prunes deeper", () => {
    const kept = filterByDepth(tree, 1)
    expect(kept.map((n) => n.ref)).toEqual(["@e1", "@e2", "@e3"])
  })

  it("AC-040 depth 2 prunes only the depth-3 node", () => {
    const kept = filterByDepth(tree, 2)
    expect(kept.map((n) => n.ref)).toEqual(["@e1", "@e2", "@e3", "@e4"])
  })
})
