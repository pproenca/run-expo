/**
 * CI dependency-DAG guard (architecture finding M4).
 *
 * Reads every workspace `package.json` and asserts the layering DAG so the legacy
 * D1↔D2 cycle (and any future cross-handler coupling) can NEVER reappear:
 *
 *   - `core`                       depends on NO other `@expo98/*` package.
 *   - `domain` / `protocols`       depend only on `@expo98/core`.
 *   - handler / integration /      depend only on `@expo98/core` / `domain` /
 *     overlay packages               `protocols` — NEVER on each other.
 *   - `app`                        may depend on all.
 *   - the whole `@expo98/*` graph  is ACYCLIC (a topological sort succeeds).
 *
 * The graph is built from each package's declared `dependencies` /
 * `devDependencies` / `peerDependencies` (the `@expo98/*` edges only).
 */
import { describe, expect, it } from "@effect/vitest"
import { readFileSync, readdirSync } from "node:fs"
import { fileURLToPath } from "node:url"

const PACKAGES_DIR = fileURLToPath(new URL("../../", import.meta.url))

interface PackageManifest {
  readonly name: string
  readonly dependencies?: Readonly<Record<string, string>>
  readonly devDependencies?: Readonly<Record<string, string>>
  readonly peerDependencies?: Readonly<Record<string, string>>
}

const SCOPE = "@expo98/"

/** Read every workspace `package.json`, keyed by its `@expo98/*` name. */
const readManifests = (): ReadonlyMap<string, PackageManifest> => {
  const entries = readdirSync(PACKAGES_DIR, { withFileTypes: true })
  const manifests = new Map<string, PackageManifest>()
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue
    }
    let raw: string
    try {
      raw = readFileSync(`${PACKAGES_DIR}${entry.name}/package.json`, "utf8")
    } catch {
      continue // a dir without a package.json is not a workspace package
    }
    const manifest = JSON.parse(raw) as PackageManifest
    if (typeof manifest.name === "string" && manifest.name.startsWith(SCOPE)) {
      manifests.set(manifest.name, manifest)
    }
  }
  return manifests
}

/** The set of `@expo98/*` packages a manifest depends on (any dependency kind). */
const expoDepsOf = (manifest: PackageManifest): ReadonlySet<string> => {
  const all = {
    ...manifest.dependencies,
    ...manifest.devDependencies,
    ...manifest.peerDependencies
  }
  return new Set(Object.keys(all).filter((dep) => dep.startsWith(SCOPE)))
}

const short = (name: string): string => name.slice(SCOPE.length)

const CORE = "@expo98/core"
const DOMAIN = "@expo98/domain"
const PROTOCOLS = "@expo98/protocols"
const APP = "@expo98/app"
const FOUNDATION: ReadonlySet<string> = new Set([CORE, DOMAIN, PROTOCOLS])

describe("M4 — dependency DAG guard", () => {
  const manifests = readManifests()
  const graph = new Map<string, ReadonlySet<string>>()
  for (const [name, manifest] of manifests) {
    graph.set(name, expoDepsOf(manifest))
  }

  it("discovers the expected workspace packages", () => {
    expect(manifests.has(CORE)).toBe(true)
    expect(manifests.has(DOMAIN)).toBe(true)
    expect(manifests.has(PROTOCOLS)).toBe(true)
    expect(manifests.has(APP)).toBe(true)
    // 11 packages in the rebuild.
    expect(manifests.size).toBeGreaterThanOrEqual(11)
  })

  it("core depends on NO other @expo98/* package", () => {
    const deps = graph.get(CORE) ?? new Set<string>()
    expect([...deps]).toEqual([])
  })

  it("domain and protocols depend only on @expo98/core", () => {
    for (const pkg of [DOMAIN, PROTOCOLS]) {
      const deps = [...(graph.get(pkg) ?? new Set<string>())]
      expect(deps.sort()).toEqual([CORE])
    }
  })

  it("handler/integration/overlay packages depend only on core/domain/protocols (NOT each other)", () => {
    const foundationOrApp: ReadonlySet<string> = new Set([...FOUNDATION, APP])
    for (const [name, deps] of graph) {
      if (foundationOrApp.has(name)) {
        continue // foundation + app are checked separately
      }
      for (const dep of deps) {
        expect(
          FOUNDATION.has(dep),
          `${short(name)} must NOT depend on ${short(dep)} — handlers may only depend on core/domain/protocols`
        ).toBe(true)
      }
    }
  })

  it("app may depend on the whole @expo98/* graph (no forbidden edge)", () => {
    const deps = graph.get(APP) ?? new Set<string>()
    for (const dep of deps) {
      expect(manifests.has(dep)).toBe(true) // every edge points at a real package
    }
    // app is the composition root: it is allowed to (and does) name handlers.
    expect(deps.size).toBeGreaterThanOrEqual(3)
  })

  it("the whole @expo98/* graph is ACYCLIC (topological sort succeeds)", () => {
    // Kahn's algorithm over the @expo98/* subgraph.
    const indegree = new Map<string, number>()
    for (const name of graph.keys()) {
      indegree.set(name, 0)
    }
    for (const deps of graph.values()) {
      for (const dep of deps) {
        if (indegree.has(dep)) {
          indegree.set(dep, (indegree.get(dep) ?? 0) + 1)
        }
      }
    }
    // Edge direction: dependant → dependency. A node with NO dependants left is a
    // sink we can remove; we peel sinks until the graph is empty or a cycle blocks.
    const remaining = new Map<string, Set<string>>()
    for (const [name, deps] of graph) {
      remaining.set(name, new Set([...deps].filter((d) => graph.has(d))))
    }
    const order: Array<string> = []
    let progressed = true
    while (remaining.size > 0 && progressed) {
      progressed = false
      for (const [name, deps] of [...remaining]) {
        if (deps.size === 0) {
          order.push(name)
          remaining.delete(name)
          for (const other of remaining.values()) {
            other.delete(name)
          }
          progressed = true
        }
      }
    }
    // If anything remains, those nodes are in a cycle.
    expect(
      [...remaining.keys()].map(short),
      "remaining nodes indicate a dependency cycle"
    ).toEqual([])
    expect(order.length).toBe(graph.size)
    expect(indegree.get(CORE)).toBeGreaterThanOrEqual(1) // core is depended upon
  })
})
