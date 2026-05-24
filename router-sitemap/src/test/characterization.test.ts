import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  expoRouteContext,
  expoRouterSitemap,
  routeFromFile,
  walkFiles,
} from "../main/index.js";
import type {
  DirentLike,
  RouterFileSystem,
  RouterPathAdapter,
  RouterSitemapDependencies,
  RouterSitemapPayload,
  ToolTextResult,
} from "../main/index.js";

const pathAdapter: RouterPathAdapter = {
  sep: "/",
  resolve: (...parts) => normalizePath(parts.filter((part): part is string => Boolean(part)).join("/")),
  join: (...parts) => normalizePath(parts.join("/")),
  relative: (from, to) => {
    const normalizedFrom = normalizePath(from);
    const normalizedTo = normalizePath(to);
    if (normalizedTo === normalizedFrom) return "";
    return normalizedTo.startsWith(`${normalizedFrom}/`) ? normalizedTo.slice(normalizedFrom.length + 1) : normalizedTo;
  },
};

describe("router-sitemap legacy characterization", () => {
  describe("RULE-025 routeFromFile", () => {
    it("maps index files to the root route and nested index files to their parent route", () => {
      assert.deepEqual(routeFromFile("index.tsx", { path: pathAdapter }), {
        kind: "route",
        route: "/",
        segments: [],
      });
      assert.deepEqual(routeFromFile("settings/index.ts", { path: pathAdapter }), {
        kind: "route",
        route: "/settings",
        segments: ["settings"],
      });
    });

    it("omits route groups and preserves nested non-group segments", () => {
      assert.deepEqual(routeFromFile("(tabs)/feed.tsx", { path: pathAdapter }), {
        kind: "route",
        route: "/feed",
        segments: ["feed"],
      });
      assert.deepEqual(routeFromFile("(tabs)/account/profile.jsx", { path: pathAdapter }), {
        kind: "route",
        route: "/account/profile",
        segments: ["account", "profile"],
      });
    });

    it("classifies _layout files anywhere in the path as layout files", () => {
      assert.deepEqual(routeFromFile("_layout.tsx", { path: pathAdapter }), { kind: "layout" });
      assert.deepEqual(routeFromFile("settings/_layout.jsx", { path: pathAdapter }), { kind: "layout" });
    });

    it("classifies + files anywhere in the path as special files", () => {
      assert.deepEqual(routeFromFile("+not-found.tsx", { path: pathAdapter }), { kind: "special" });
      assert.deepEqual(routeFromFile("account/+html.tsx", { path: pathAdapter }), { kind: "special" });
    });

    it("formats dynamic, optional dynamic, and rest segments using legacy route syntax", () => {
      assert.deepEqual(routeFromFile("users/[id].tsx", { path: pathAdapter }), {
        kind: "route",
        route: "/users/:id",
        segments: ["users", ":id"],
      });
      assert.deepEqual(routeFromFile("blog/[[slug]].tsx", { path: pathAdapter }), {
        kind: "route",
        route: "/blog/:slug?",
        segments: ["blog", ":slug?"],
      });
      assert.deepEqual(routeFromFile("docs/[...rest].tsx", { path: pathAdapter }), {
        kind: "route",
        route: "/docs/*rest",
        segments: ["docs", "*rest"],
      });
    });

    it("strips only js, jsx, ts, and tsx route extensions from the final segment", () => {
      assert.deepEqual(routeFromFile("about.js", { path: pathAdapter }), {
        kind: "route",
        route: "/about",
        segments: ["about"],
      });
      assert.deepEqual(routeFromFile("profile.test.tsx", { path: pathAdapter }), {
        kind: "route",
        route: "/profile.test",
        segments: ["profile.test"],
      });
      assert.deepEqual(routeFromFile("bundle.ts.map", { path: pathAdapter }), {
        kind: "route",
        route: "/bundle.ts.map",
        segments: ["bundle.ts.map"],
      });
    });
  });

  describe("walk and sitemap behavior", () => {
    it("walkFiles recurses through ordinary directories and skips node_modules and dot directories", async () => {
      const visited: string[] = [];
      const deps = depsWithTree({
        "/repo/app": [dir("(tabs)"), dir(".expo"), dir("node_modules"), file("index.tsx"), file("readme.md")],
        "/repo/app/(tabs)": [file("feed.tsx"), dir("nested")],
        "/repo/app/(tabs)/nested": [file("[id].tsx")],
        "/repo/app/.expo": [file("ignored.tsx")],
        "/repo/app/node_modules": [file("ignored.tsx")],
      }, { visited });

      assert.deepEqual(await walkFiles("/repo/app", deps), [
        "/repo/app/(tabs)/feed.tsx",
        "/repo/app/(tabs)/nested/[id].tsx",
        "/repo/app/index.tsx",
        "/repo/app/readme.md",
      ]);
      assert.deepEqual(visited, ["/repo/app", "/repo/app/(tabs)", "/repo/app/(tabs)/nested"]);
    });

    it("expoRouterSitemap includes only js/jsx/ts/tsx route files, sorts routes by route, and sorts special files by file", async () => {
      const deps = depsWithTree({
        "/repo/project": [dir("app")],
        "/repo/project/app": [
          file("zeta.md"),
          file("settings.js"),
          file("index.tsx"),
          file("+not-found.tsx"),
          dir("users"),
          dir("(tabs)"),
          dir("admin"),
        ],
        "/repo/project/app/users": [file("[id].tsx"), file("_layout.tsx"), file("notes.css")],
        "/repo/project/app/(tabs)": [file("feed.jsx")],
        "/repo/project/app/admin": [file("+html.tsx")],
      });

      const payload = parseToolJson(await expoRouterSitemap({ cwd: "/repo/project" }, deps));

      assert.deepEqual(payload, {
        cwd: "/repo/project",
        appDir: "/repo/project/app",
        routeCount: 4,
        routes: [
          { route: "/", file: "/repo/project/app/index.tsx", segments: [] },
          { route: "/feed", file: "/repo/project/app/(tabs)/feed.jsx", segments: ["feed"] },
          { route: "/settings", file: "/repo/project/app/settings.js", segments: ["settings"] },
          { route: "/users/:id", file: "/repo/project/app/users/[id].tsx", segments: ["users", ":id"] },
        ],
        specialFiles: [
          { kind: "special", file: "/repo/project/app/+not-found.tsx" },
          { kind: "special", file: "/repo/project/app/admin/+html.tsx" },
          { kind: "layout", file: "/repo/project/app/users/_layout.tsx" },
        ],
      });
    });

    it("returns the legacy missing-app-directory warning shape without routeCount", async () => {
      const deps = depsWithTree({ "/repo/project": [] });

      assert.deepEqual(parseToolJson(await expoRouterSitemap({ cwd: "/repo/project" }, deps)), {
        cwd: "/repo/project",
        appDir: "/repo/project/app",
        routes: [],
        specialFiles: [],
        warning: "App directory was not found.",
      });
    });

    it("resolves cwd and appDir through injected path/fs adapters", async () => {
      const resolveCalls: string[][] = [];
      const statCalls: string[] = [];
      const customPath: RouterPathAdapter = {
        ...pathAdapter,
        resolve: (...parts) => {
          resolveCalls.push(parts.filter((part): part is string => Boolean(part)));
          return pathAdapter.resolve(...parts);
        },
      };
      const deps = depsWithTree({
        "/repo/project": [dir("src")],
        "/repo/project/src": [dir("app")],
        "/repo/project/src/app": [file("index.tsx")],
      }, { path: customPath });
      const originalStat = deps.fs?.stat;
      deps.fs = {
        ...deps.fs,
        stat: async (filePath) => {
          statCalls.push(filePath);
          return originalStat?.(filePath) ?? null;
        },
      };

      const payload = parseToolJson(await expoRouterSitemap({ cwd: "/repo/project", appDir: "src/app" }, deps));

      assert.equal(payload.cwd, "/repo/project");
      assert.equal(payload.appDir, "/repo/project/src/app");
      assert.deepEqual(resolveCalls, [["/repo/project"], ["/repo/project", "src/app"]]);
      assert.deepEqual(statCalls, ["/repo/project"]);
    });

    it("validates cwd exists and is a directory before returning app-directory warnings", async () => {
      const missing = depsWithTree({ "/repo/project/app": [file("index.tsx")] });
      await assert.rejects(
        () => expoRouterSitemap({ cwd: "/repo/missing" }, missing),
        /Directory does not exist: \/repo\/missing/,
      );

      const cwdIsFile = depsWithTree({ "/repo": [file("project")] });
      await assert.rejects(
        () => expoRouterSitemap({ cwd: "/repo/project" }, cwdIsFile),
        /Directory does not exist: \/repo\/project/,
      );
    });

    it("does not read, import, or evaluate route files while producing a sitemap", async () => {
      const attemptedReads: string[] = [];
      const routeFile = "/repo/project/app/index.tsx";
      const deps = depsWithTree({ "/repo/project": [dir("app")], "/repo/project/app": [file("index.tsx")] }, {
        readFile: async (filePath) => {
          attemptedReads.push(filePath);
          throw new Error(`Route files must not be read: ${routeFile}`);
        },
      });

      const payload = parseToolJson(await expoRouterSitemap({ cwd: "/repo/project" }, deps));

      assert.deepEqual(payload.routes, [{ route: "/", file: routeFile, segments: [] }]);
      assert.deepEqual(attemptedReads, []);
    });
  });

  describe("expoRouteContext", () => {
    it("returns appDir null when the app directory is missing and parses typed routes uniquely and sorted", async () => {
      const deps = depsWithTree({
        "/repo/project": [],
        "/repo/project/.expo": [dir("types")],
        "/repo/project/.expo/types": [file("router.d.ts")],
      }, {
        readFile: async (filePath, encoding) => {
          assert.equal(filePath, "/repo/project/.expo/types/router.d.ts");
          assert.equal(encoding, "utf8");
          return [
            "declare const a: { pathname: `/settings` };",
            "declare const b: { pathname: `/` };",
            "declare const c: { pathname: `/users/[id]` };",
            "declare const duplicate: { pathname: `/settings` };",
          ].join("\n");
        },
      });

      assert.deepEqual(await expoRouteContext("/repo/project", deps), {
        appDir: null,
        routeCount: 0,
        routes: [],
        specialFiles: [],
        typedRoutesPath: "/repo/project/.expo/types/router.d.ts",
        typedRoutes: ["/", "/settings", "/users/[id]"],
      });
    });

    it("builds route context from app files without reading or evaluating route modules", async () => {
      const attemptedRouteReads: string[] = [];
      const deps = depsWithTree({
        "/repo/project/app": [file("home.tsx"), file("+not-found.tsx"), file("_layout.tsx")],
        "/repo/project/.expo": [dir("types")],
        "/repo/project/.expo/types": [file("router.d.ts")],
      }, {
        readFile: async (filePath) => {
          if (filePath.startsWith("/repo/project/app/")) {
            attemptedRouteReads.push(filePath);
            throw new Error(`Route files must not be read: ${filePath}`);
          }
          return "type Routes = { pathname: `/home` } | { pathname: `/home` }";
        },
      });

      assert.deepEqual(await expoRouteContext("/repo/project", deps), {
        appDir: "/repo/project/app",
        routeCount: 1,
        routes: [{ route: "/home", file: "/repo/project/app/home.tsx", segments: ["home"] }],
        specialFiles: [
          { kind: "special", file: "/repo/project/app/+not-found.tsx" },
          { kind: "layout", file: "/repo/project/app/_layout.tsx" },
        ],
        typedRoutesPath: "/repo/project/.expo/types/router.d.ts",
        typedRoutes: ["/home"],
      });
      assert.deepEqual(attemptedRouteReads, []);
    });
  });
});

function parseToolJson(result: ToolTextResult): RouterSitemapPayload {
  assert.equal(result.content[0]?.type, "text");
  const text = result.content[0]?.text;
  if (typeof text !== "string") throw new Error("Expected text content.");
  assert.match(text, /\n$/);
  return JSON.parse(text) as RouterSitemapPayload;
}

function depsWithTree(
  tree: Record<string, DirentLike[]>,
  options: {
    path?: RouterPathAdapter;
    visited?: string[];
    readFile?: RouterFileSystem["readFile"];
  } = {},
): RouterSitemapDependencies {
  const adapter = options.path ?? pathAdapter;
  const directories = new Set(Object.keys(tree).map((dirPath) => normalizePath(dirPath)));
  const files = new Set<string>();
  for (const [dirPath, entries] of Object.entries(tree)) {
    for (const entry of entries) {
      if (entry.isFile()) files.add(adapter.join(dirPath, entry.name));
    }
  }

  return {
    path: adapter,
    fs: {
      stat: async (filePath) => directories.has(normalizePath(filePath)) ? { isDirectory: () => true } : null,
      pathExists: async (filePath) => directories.has(normalizePath(filePath)) || files.has(normalizePath(filePath)),
      readdir: async (dirPath) => {
        const normalized = normalizePath(dirPath);
        options.visited?.push(normalized);
        const entries = tree[normalized];
        if (!entries) throw new Error(`ENOENT: ${normalized}`);
        return entries;
      },
      readFile: options.readFile,
    },
  };
}

function dir(name: string): DirentLike {
  return {
    name,
    isDirectory: () => true,
    isFile: () => false,
  };
}

function file(name: string): DirentLike {
  return {
    name,
    isDirectory: () => false,
    isFile: () => true,
  };
}

function normalizePath(input: string): string {
  return input.replace(/\/+/g, "/").replace(/\/$/, "") || "/";
}
