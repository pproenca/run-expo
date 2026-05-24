import { Effect } from "effect"
import { PathEscape } from "./errors.js"

/**
 * S2 — Path confinement. AC-013 (FIX).
 *
 * A PURE function (finding N1: a Layer buys nothing — confinement is one
 * assertion every artifact writer calls). It resolves `candidate` against
 * `root` and asserts the result lives UNDER `root`, rejecting `../` traversal
 * and absolute escapes BEFORE any mkdir/write.
 *
 * SAFETY INVARIANT: containment is decided on the *resolved, normalised* path,
 * with a separator-boundary check so `/artifacts-evil` cannot pass as a child
 * of `/artifacts`. The resolution is implemented in-package (no `@effect/platform`
 * dependency) to keep the pure spine platform-free; it mirrors POSIX
 * `path.resolve`/`normalize` semantics.
 */
export const confinePath = (root: string, candidate: string): Effect.Effect<string, PathEscape> =>
  Effect.suspend(() => {
    const resolvedRoot = normalizeAbsolute(root)
    // An absolute candidate is resolved on its own; a relative one is resolved
    // against the root. Either way the containment check below is authoritative.
    const resolved = isAbsolute(candidate)
      ? normalizeAbsolute(candidate)
      : normalizeAbsolute(join(resolvedRoot, candidate))

    return isContained(resolvedRoot, resolved)
      ? Effect.succeed(resolved)
      : Effect.fail(new PathEscape({ root: resolvedRoot, candidate, resolved }))
  })

const SEP = "/"

const isAbsolute = (p: string): boolean => p.startsWith(SEP)

const join = (a: string, b: string): string => (a.endsWith(SEP) ? a + b : a + SEP + b)

/**
 * Resolve `.`/`..` segments against an absolute base. `..` cannot climb above
 * the filesystem root (it is dropped at the top), which is what makes the later
 * prefix check sufficient.
 */
const normalizeAbsolute = (p: string): string => {
  const segments = p.split(SEP)
  const stack: Array<string> = []
  for (const segment of segments) {
    if (segment === "" || segment === ".") {
      continue
    }
    if (segment === "..") {
      stack.pop()
      continue
    }
    stack.push(segment)
  }
  return SEP + stack.join(SEP)
}

/**
 * True iff `resolved` is `root` itself or a descendant of `root`. The
 * separator-boundary guard prevents sibling-prefix false positives
 * (`/a/artifacts-evil` is NOT under `/a/artifacts`).
 */
const isContained = (root: string, resolved: string): boolean => {
  if (resolved === root) {
    return true
  }
  const rootWithSep = root.endsWith(SEP) ? root : root + SEP
  return resolved.startsWith(rootWithSep)
}
