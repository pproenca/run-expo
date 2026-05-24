/**
 * AC-044 — Expo Router file-path normalization (exhaustive).
 *
 * Covers extension stripping, `_layout` → layout, `+`-prefixed → special, index +
 * group `(...)` dropping, and every dynamic-segment form
 * (`[...rest]`/`[[opt]]`/`[param]`/literal).
 */
import { describe, expect, it } from "@effect/vitest"
import { buildSitemap, formatSegment, normalizeRoutePath } from "@expo98/expo-integration"

describe("AC-044 Expo Router sitemap normalization", () => {
  it("AC-044 strips the extension and roots a simple route", () => {
    expect(normalizeRoutePath("app/about.tsx")).toEqual({
      source: "app/about.tsx",
      kind: "route",
      route: "/app/about",
    })
  })

  it("AC-044 index → drops the index segment", () => {
    expect(normalizeRoutePath("index.tsx").route).toBe("/")
    expect(normalizeRoutePath("settings/index.tsx").route).toBe("/settings")
  })

  it("AC-044 group (...) segments are dropped from the URL", () => {
    expect(normalizeRoutePath("(tabs)/home.tsx").route).toBe("/home")
    expect(normalizeRoutePath("(auth)/(modal)/login.tsx").route).toBe("/login")
    expect(normalizeRoutePath("(tabs)/index.tsx").route).toBe("/")
  })

  it("AC-044 any _layout segment → layout (not a route)", () => {
    expect(normalizeRoutePath("_layout.tsx")).toEqual({
      source: "_layout.tsx",
      kind: "layout",
      route: null,
    })
    expect(normalizeRoutePath("(tabs)/_layout.tsx").kind).toBe("layout")
    expect(normalizeRoutePath("nested/deep/_layout.ts").kind).toBe("layout")
  })

  it("AC-044 any +-prefixed segment → special", () => {
    expect(normalizeRoutePath("+not-found.tsx")).toEqual({
      source: "+not-found.tsx",
      kind: "special",
      route: null,
    })
    expect(normalizeRoutePath("+html.tsx").kind).toBe("special")
    expect(normalizeRoutePath("api/+native-intent.ts").kind).toBe("special")
  })

  it("AC-044 [...rest] → *rest (catch-all)", () => {
    expect(formatSegment("[...rest]")).toBe("*rest")
    expect(normalizeRoutePath("blog/[...slug].tsx").route).toBe("/blog/*slug")
  })

  it("AC-044 [[opt]] → :opt? (optional)", () => {
    expect(formatSegment("[[opt]]")).toBe(":opt?")
    expect(normalizeRoutePath("shop/[[category]].tsx").route).toBe("/shop/:category?")
  })

  it("AC-044 [param] → :param (dynamic)", () => {
    expect(formatSegment("[id]")).toBe(":id")
    expect(normalizeRoutePath("users/[id]/posts/[postId].tsx").route).toBe("/users/:id/posts/:postId")
  })

  it("AC-044 literal segments pass through unchanged", () => {
    expect(formatSegment("about")).toBe("about")
  })

  it("AC-044 combined — groups + dynamic + index in one path", () => {
    expect(normalizeRoutePath("(tabs)/users/[id]/index.tsx").route).toBe("/users/:id")
  })

  it("AC-044 buildSitemap normalizes a whole listing", () => {
    const entries = buildSitemap([
      "_layout.tsx",
      "index.tsx",
      "(tabs)/profile.tsx",
      "blog/[...slug].tsx",
      "+not-found.tsx",
    ])
    expect(entries.map((e) => `${e.kind}:${e.route ?? ""}`)).toEqual([
      "layout:",
      "route:/",
      "route:/profile",
      "route:/blog/*slug",
      "special:",
    ])
  })

  it("AC-044 normalizes backslash paths (Windows-style listings)", () => {
    expect(normalizeRoutePath("app\\users\\[id].tsx").route).toBe("/app/users/:id")
  })
})
