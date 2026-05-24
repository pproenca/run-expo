import { Context, Effect, Layer, Ref } from "effect"
import { StorageFailure } from "./errors.js"

/**
 * Filesystem PORT (hexagonal seam).
 *
 * S7 Persistence depends on this narrow interface, NOT on `@effect/platform`'s
 * `FileSystem` directly, and NEVER on `@effect/platform-node`. That keeps the
 * domain package platform-agnostic and lets tests inject an in-memory impl.
 *
 * // INTEGRATION SEAM (@expo98/platform-node adapter, deferred): the CLI shell
 * // package will provide a `Layer` that satisfies `FsPort` by delegating to
 * // `@effect/platform` `FileSystem` + `Path`. The shape below is intentionally
 * // a subset of that API (string paths, utf-8 JSON) so the adapter is trivial.
 *
 * All paths are absolute, POSIX-style, and slash-joined by the persistence
 * layer (see `paths.ts`). Failures surface as the typed `StorageFailure`.
 */
export interface FsPort {
  readonly readFile: (path: string) => Effect.Effect<string, StorageFailure>
  readonly writeFile: (path: string, contents: string) => Effect.Effect<void, StorageFailure>
  readonly exists: (path: string) => Effect.Effect<boolean, StorageFailure>
  readonly mkdirp: (path: string) => Effect.Effect<void, StorageFailure>
  /** List immediate child entry names of a directory (not recursive). */
  readonly readDir: (path: string) => Effect.Effect<ReadonlyArray<string>, StorageFailure>
  /** Recursively remove a file or directory; a no-op if it does not exist. */
  readonly remove: (path: string) => Effect.Effect<void, StorageFailure>
}

export class Fs extends Context.Tag("@expo98/domain/Fs")<Fs, FsPort>() {}

// ---------------------------------------------------------------------------
// In-memory implementation (for tests). A flat map of absolute path → contents
// plus a set of known directories. Faithfully models the small slice of POSIX
// semantics S7 needs: nested mkdir, recursive remove, immediate-child listing.
// ---------------------------------------------------------------------------

interface MemState {
  readonly files: Map<string, string>
  readonly dirs: Set<string>
}

const normalize = (p: string): string => {
  // Collapse duplicate slashes and strip a trailing slash (except root).
  const collapsed = p.replace(/\/+/g, "/")
  return collapsed.length > 1 && collapsed.endsWith("/")
    ? collapsed.slice(0, -1)
    : collapsed
}

const parentOf = (p: string): string => {
  const norm = normalize(p)
  const idx = norm.lastIndexOf("/")
  return idx <= 0 ? "/" : norm.slice(0, idx)
}

const ancestorsOf = (p: string): ReadonlyArray<string> => {
  const out: Array<string> = []
  let cur = normalize(p)
  while (cur !== "/" && cur.includes("/")) {
    out.push(cur)
    const parent = parentOf(cur)
    if (parent === cur) break
    cur = parent
  }
  out.push("/")
  return out
}

/**
 * Build an in-memory `FsPort` Layer. Useful for acceptance tests that need a
 * fast, deterministic, isolated filesystem.
 */
export const makeMemoryFs = (): Effect.Effect<FsPort> =>
  Effect.gen(function* () {
    const state = yield* Ref.make<MemState>({ files: new Map(), dirs: new Set(["/"]) })

    const readFile = (path: string): Effect.Effect<string, StorageFailure> =>
      Effect.gen(function* () {
        const s = yield* Ref.get(state)
        const c = s.files.get(normalize(path))
        if (c === undefined) {
          return yield* Effect.fail(
            new StorageFailure({ op: "read", path, reason: "ENOENT" })
          )
        }
        return c
      })

    const mkdirp = (path: string): Effect.Effect<void, StorageFailure> =>
      Ref.update(state, (s) => {
        const dirs = new Set(s.dirs)
        for (const a of ancestorsOf(path)) dirs.add(a)
        return { files: s.files, dirs }
      })

    const writeFile = (path: string, contents: string): Effect.Effect<void, StorageFailure> =>
      Effect.gen(function* () {
        yield* mkdirp(parentOf(path))
        yield* Ref.update(state, (s) => {
          const files = new Map(s.files)
          files.set(normalize(path), contents)
          return { files, dirs: s.dirs }
        })
      })

    const exists = (path: string): Effect.Effect<boolean, StorageFailure> =>
      Effect.gen(function* () {
        const s = yield* Ref.get(state)
        const norm = normalize(path)
        return s.files.has(norm) || s.dirs.has(norm)
      })

    const readDir = (path: string): Effect.Effect<ReadonlyArray<string>, StorageFailure> =>
      Effect.gen(function* () {
        const s = yield* Ref.get(state)
        const dir = normalize(path)
        if (!s.dirs.has(dir)) {
          return yield* Effect.fail(
            new StorageFailure({ op: "list", path, reason: "ENOENT" })
          )
        }
        const prefix = dir === "/" ? "/" : dir + "/"
        const children = new Set<string>()
        const collect = (full: string) => {
          if (!full.startsWith(prefix) || full === dir) return
          const rest = full.slice(prefix.length)
          const name = rest.includes("/") ? rest.slice(0, rest.indexOf("/")) : rest
          if (name.length > 0) children.add(name)
        }
        for (const f of s.files.keys()) collect(f)
        for (const d of s.dirs) collect(d)
        return Array.from(children).sort()
      })

    const remove = (path: string): Effect.Effect<void, StorageFailure> =>
      Ref.update(state, (s) => {
        const target = normalize(path)
        const prefix = target + "/"
        const files = new Map<string, string>()
        for (const [k, v] of s.files) {
          if (k !== target && !k.startsWith(prefix)) files.set(k, v)
        }
        const dirs = new Set<string>()
        for (const d of s.dirs) {
          if (d !== target && !d.startsWith(prefix)) dirs.add(d)
        }
        dirs.add("/")
        return { files, dirs }
      })

    return { readFile, writeFile, exists, mkdirp, readDir, remove }
  })

/** A ready-to-use in-memory `Fs` Layer for tests. */
export const MemoryFsLayer = Layer.effect(Fs, makeMemoryFs())
