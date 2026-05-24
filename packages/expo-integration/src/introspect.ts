/**
 * `introspect` — Expo / React Native project introspection (D5).
 *
 * `// SEAM (Expo SDK)`: the AUTHORITATIVE way to learn a target project's resolved
 * Expo config + declared versions is the official `expo config` command and
 * `@expo/config-plugins` (brief Q#10) — those need the TARGET project's own Expo
 * install, not ours, so live extraction is a documented seam (skipped acceptance:
 * "live Expo project `expo config` introspection").
 *
 * What we CAN do without the SDK, over the `Fs` port, is read the declared
 * versions out of `package.json` and hand them to the PURE `classifyCompat`
 * (AC-020). This is the static fallback the seam upgrades; both feed the same
 * classifier so the compat result is identical regardless of source.
 */
import { Fs } from "@expo98/domain"
import { Effect } from "effect"
import { classifyCompat, type CompatMap, type CompatResult } from "./compat.js"

export interface DeclaredVersions {
  readonly expo: string | null
  readonly reactNative: string | null
}

/** Extract declared Expo/RN versions from a parsed `package.json`-shaped object. */
export const extractDeclaredVersions = (pkg: unknown): DeclaredVersions => {
  if (typeof pkg !== "object" || pkg === null) {
    return { expo: null, reactNative: null }
  }
  const record = pkg as Record<string, unknown>
  const lookup = (name: string): string | null => {
    for (const block of [record["dependencies"], record["devDependencies"]]) {
      if (typeof block === "object" && block !== null) {
        const value = (block as Record<string, unknown>)[name]
        if (typeof value === "string") {
          return value
        }
      }
    }
    return null
  }
  return { expo: lookup("expo"), reactNative: lookup("react-native") }
}

/**
 * Read the project's declared Expo/RN versions from `package.json` and classify
 * compatibility (AC-020). The `map` defaults to the bundled data file; pass a
 * fetched manifest to re-classify with no code change.
 */
export const classifyProjectCompat = (
  root: string,
  map?: CompatMap
): Effect.Effect<CompatResult, never, Fs> =>
  Effect.gen(function* () {
    const fs = yield* Fs
    const text = yield* fs
      .readFile(`${root.replace(/\/+$/, "")}/package.json`)
      .pipe(Effect.orElseSucceed(() => ""))
    let pkg: unknown
    try {
      pkg = text.length > 0 ? (JSON.parse(text) as unknown) : undefined
    } catch {
      pkg = undefined
    }
    const declared = extractDeclaredVersions(pkg)
    return classifyCompat(declared, map)
  })
