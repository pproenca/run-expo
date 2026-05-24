/**
 * `compat` — Expo SDK ↔ React Native compatibility classification (AC-020).
 *
 * The SDK→RN map is loaded from a DATA FILE (`src/data/expo-rn-compat.json`,
 * brief Q#10), so a new Expo SDK row updates the classification WITHOUT a code
 * release. A fetched manifest can be supplied instead via `classifyCompat`'s
 * `map` argument, which defaults to the bundled data file.
 *
 * Classification (in order):
 *   - either version missing                              → `missing`
 *   - either version declared-unresolved
 *     (`catalog:|workspace:|file:|link:|portal:`)         → `declared-unresolved`
 *   - Expo major not in the table                         → `unknown`
 *   - RN major.minor === expected for that Expo major     → `compatible`
 *   - else                                                → `mismatched`
 *
 * `// SEAM (Expo SDK)`: live extraction of the declared Expo/RN versions from a
 * target project (`expo config` / `@expo/config-plugins` / package.json read)
 * needs the TARGET project's Expo install — see `introspect.ts`. This module is
 * the PURE classifier that consumes already-extracted version strings.
 */
import compatData from "./data/expo-rn-compat.json" with { type: "json" }

/** The shape of the data-file map. */
export interface CompatMap {
  readonly version: number
  readonly expoToReactNative: Readonly<Record<string, string>>
}

/** The bundled data-file map (the default source; replaceable by a manifest). */
export const DEFAULT_COMPAT_MAP: CompatMap = {
  version: compatData.version,
  expoToReactNative: compatData.expoToReactNative
}

/** Prefixes a package manager leaves UNRESOLVED in a manifest (AC-020). */
export const UNRESOLVED_PREFIXES = [
  "catalog:",
  "workspace:",
  "file:",
  "link:",
  "portal:"
] as const

export type CompatClass =
  | "missing"
  | "declared-unresolved"
  | "unknown"
  | "compatible"
  | "mismatched"

export interface CompatResult {
  readonly classification: CompatClass
  /** The raw declared Expo version (as provided), when present. */
  readonly expoDeclared: string | null
  /** The raw declared RN version (as provided), when present. */
  readonly reactNativeDeclared: string | null
  /** Parsed Expo major (table key), when resolvable. */
  readonly expoMajor: number | null
  /** Parsed RN `major.minor`, when resolvable. */
  readonly reactNativeMinor: string | null
  /** Expected RN `major.minor` for the Expo major from the map, when known. */
  readonly expectedReactNativeMinor: string | null
  /** Revision of the map used (for traceability of which manifest decided). */
  readonly mapVersion: number
}

/** First `\d+\.\d+(\.\d+)?` run in a string (AC-020). */
const VERSION_RE = /\d+\.\d+(?:\.\d+)?/

/** Parse the first semver-ish run out of a declared version string. */
export const parseVersion = (
  raw: string
): { readonly major: number; readonly minor: number; readonly minorString: string } | null => {
  const match = VERSION_RE.exec(raw)
  if (match === null) {
    return null
  }
  const [majorPart, minorPart] = match[0].split(".")
  const major = Number(majorPart)
  const minor = Number(minorPart)
  if (!Number.isFinite(major) || !Number.isFinite(minor)) {
    return null
  }
  return { major, minor, minorString: `${major}.${minor}` }
}

const isUnresolved = (raw: string): boolean =>
  UNRESOLVED_PREFIXES.some((prefix) => raw.startsWith(prefix))

const isMissing = (raw: string | undefined | null): raw is undefined | null | "" =>
  raw === undefined || raw === null || raw.trim().length === 0

/**
 * Classify a declared Expo/RN version pair against the compatibility map.
 *
 * @param map defaults to the bundled data file; pass a fetched manifest to
 *   re-classify against a newer table with NO code change.
 */
export const classifyCompat = (
  input: { readonly expo?: string | null; readonly reactNative?: string | null },
  map: CompatMap = DEFAULT_COMPAT_MAP
): CompatResult => {
  const expoRaw = input.expo ?? null
  const rnRaw = input.reactNative ?? null

  const base = {
    expoDeclared: expoRaw,
    reactNativeDeclared: rnRaw,
    expoMajor: null,
    reactNativeMinor: null,
    expectedReactNativeMinor: null,
    mapVersion: map.version
  } satisfies Omit<CompatResult, "classification">

  // missing — either side absent/blank.
  if (isMissing(expoRaw) || isMissing(rnRaw)) {
    return { ...base, classification: "missing" }
  }

  // declared-unresolved — either side a non-version manifest pointer.
  if (isUnresolved(expoRaw) || isUnresolved(rnRaw)) {
    return { ...base, classification: "declared-unresolved" }
  }

  const expoParsed = parseVersion(expoRaw)
  const rnParsed = parseVersion(rnRaw)

  // Unparseable Expo version cannot key the table → unknown.
  if (expoParsed === null) {
    return { ...base, classification: "unknown" }
  }

  const expected = map.expoToReactNative[String(expoParsed.major)]
  // Expo major not in the table → unknown (newer SDK; update the data file).
  if (expected === undefined) {
    return {
      ...base,
      classification: "unknown",
      expoMajor: expoParsed.major,
      reactNativeMinor: rnParsed?.minorString ?? null
    }
  }

  const reactNativeMinor = rnParsed?.minorString ?? null
  const classification: CompatClass =
    reactNativeMinor === expected ? "compatible" : "mismatched"

  return {
    ...base,
    classification,
    expoMajor: expoParsed.major,
    reactNativeMinor,
    expectedReactNativeMinor: expected
  }
}
