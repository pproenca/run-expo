/**
 * `sitemap` — Expo Router file-path → route normalization (AC-044).
 *
 * Pure path transform (no Expo SDK needed); the file LISTING that feeds it is the
 * `// SEAM (Expo SDK)` (a real build reads the target's `app/` tree). The rules,
 * applied to a slash-joined relative path:
 *
 *   1. Strip the file extension.
 *   2. If ANY segment is `_layout`        → `{ kind: "layout" }`.
 *   3. If ANY segment starts with `+`     → `{ kind: "special" }`.
 *   4. Else: drop `index` segments and group `(...)` segments, format each
 *      remaining segment, join with `/` and prefix with `/`.
 *
 * Per-segment dynamic formatting:
 *   - `[...rest]`  → `*rest`     (catch-all)
 *   - `[[opt]]`    → `:opt?`     (optional)
 *   - `[param]`    → `:param`    (dynamic)
 *   - else         → literal
 */

export type SitemapKind = "route" | "layout" | "special"

export interface SitemapEntry {
  readonly source: string
  readonly kind: SitemapKind
  /** Normalized route path (only meaningful for `kind === "route"`). */
  readonly route: string | null
}

/** Strip a trailing file extension (`.tsx`, `.ts`, `.jsx`, `.js`, …). */
const stripExtension = (path: string): string => path.replace(/\.[^./]+$/, "")

/** A group segment is `(...)` — Expo Router route groups (dropped from the URL). */
const isGroupSegment = (segment: string): boolean => segment.startsWith("(") && segment.endsWith(")")

/** Format a single dynamic/literal segment per the AC-044 rules. */
export const formatSegment = (segment: string): string => {
  // Catch-all: `[...rest]` → `*rest`
  const catchAll = /^\[\.\.\.(.+)\]$/.exec(segment)
  if (catchAll !== null) {
    return `*${catchAll[1]}`
  }
  // Optional: `[[opt]]` → `:opt?`
  const optional = /^\[\[(.+)\]\]$/.exec(segment)
  if (optional !== null) {
    return `:${optional[1]}?`
  }
  // Dynamic: `[param]` → `:param`
  const dynamic = /^\[(.+)\]$/.exec(segment)
  if (dynamic !== null) {
    return `:${dynamic[1]}`
  }
  // Literal.
  return segment
}

/**
 * Normalize ONE Expo Router file path into a sitemap entry. `source` is a
 * relative path (slash-joined; backslashes are normalized first).
 */
export const normalizeRoutePath = (source: string): SitemapEntry => {
  const withoutExt = stripExtension(source.replace(/\\/g, "/"))
  const segments = withoutExt.split("/").filter((s) => s.length > 0)

  // Layout: any segment is `_layout`.
  if (segments.some((s) => s === "_layout")) {
    return { source, kind: "layout", route: null }
  }

  // Special: any segment starts with `+` (e.g. `+not-found`, `+html`, `+native-intent`).
  if (segments.some((s) => s.startsWith("+"))) {
    return { source, kind: "special", route: null }
  }

  // Route: drop `index` + group segments, format the rest, join.
  const kept = segments.filter((s) => s !== "index" && !isGroupSegment(s)).map(formatSegment)

  return { source, kind: "route", route: `/${kept.join("/")}` }
}

/** Normalize a whole listing (the file tree from the Expo SDK seam). */
export const buildSitemap = (sources: ReadonlyArray<string>): ReadonlyArray<SitemapEntry> =>
  sources.map(normalizeRoutePath)
