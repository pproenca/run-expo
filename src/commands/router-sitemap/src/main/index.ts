import { promises as fs } from "node:fs";
import path from "node:path";

import { toolJson, type ToolTextResult } from "../../../../core/tool-json-envelope/src/main/index.ts";

export interface DirentLike {
  name: string;
  isDirectory(): boolean;
  isFile(): boolean;
}

export interface RouterFileSystem {
  stat?(filePath: string): Promise<{ isDirectory(): boolean } | null>;
  pathExists?(filePath: string): Promise<boolean>;
  readdir?(dirPath: string, options: { withFileTypes: true }): Promise<DirentLike[]>;
  readFile?(filePath: string, encoding: "utf8"): Promise<string>;
}

export interface RouterPathAdapter {
  sep: string;
  resolve(...parts: Array<string | undefined>): string;
  join(...parts: string[]): string;
  relative(from: string, to: string): string;
}

export interface RouterSitemapDependencies {
  fs?: RouterFileSystem;
  path?: RouterPathAdapter;
  processCwd?: string;
}

export interface RouterSitemapArgs {
  cwd?: string;
  appDir?: string;
}

export interface RouteEntry {
  route: string;
  file: string;
  segments: string[];
}

export interface SpecialFileEntry {
  kind: "layout" | "special";
  file: string;
}

interface RouterSitemapBasePayload {
  cwd: string;
  appDir: string;
  routes: RouteEntry[];
  specialFiles: SpecialFileEntry[];
}

export type RouterSitemapPayload =
  | (RouterSitemapBasePayload & { routeCount: number; warning?: never })
  | (RouterSitemapBasePayload & { warning: "App directory was not found."; routeCount?: never });

export interface ExpoRouteContext {
  appDir: string | null;
  routeCount: number;
  routes: RouteEntry[];
  specialFiles: SpecialFileEntry[];
  typedRoutesPath: string | null;
  typedRoutes: string[];
}

export type RouteParseResult =
  | { kind: "route"; route: string; segments: string[] }
  | { kind: "layout" }
  | { kind: "special" };

export function routeFromFile(
  relativeFile: string,
  dependencies: Pick<RouterSitemapDependencies, "path"> = {},
): RouteParseResult {
  const paths = dependencies.path ?? defaultPath;
  const noExt = relativeFile.replace(/\.(jsx?|tsx?)$/, "");
  const rawSegments = noExt.split(paths.sep);
  if (rawSegments.some((segment) => segment === "_layout")) return { kind: "layout" };
  if (rawSegments.some((segment) => segment.startsWith("+"))) return { kind: "special" };

  const segments: string[] = [];
  for (const rawSegment of rawSegments) {
    if (rawSegment === "index") continue;
    if (/^\(.+\)$/.test(rawSegment)) continue;
    segments.push(formatRouteSegment(rawSegment));
  }
  return { kind: "route", route: `/${segments.join("/")}`.replace(/\/$/, "") || "/", segments };
}

export async function walkFiles(root: string, dependencies: RouterSitemapDependencies = {}): Promise<string[]> {
  const deps = resolveDependencies(dependencies);
  const entries = await deps.fs.readdir(root, { withFileTypes: true });
  const result: string[] = [];
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = deps.path.join(root, entry.name);
    if (entry.isDirectory()) {
      result.push(...await walkFiles(full, dependencies));
    } else if (entry.isFile()) {
      result.push(full);
    }
  }
  return result;
}

export async function expoRouterSitemap(
  args: RouterSitemapArgs = {},
  dependencies: RouterSitemapDependencies = {},
): Promise<ToolTextResult> {
  const deps = resolveDependencies(dependencies);
  const cwd = await normalizeCwd(args.cwd, deps);
  const appDir = deps.path.resolve(cwd, args.appDir ?? "app");
  if (!await deps.fs.pathExists(appDir)) {
    return toolJson({
      cwd,
      appDir,
      routes: [],
      specialFiles: [],
      warning: "App directory was not found.",
    });
  }

  const { routes, specialFiles } = await collectRoutes(appDir, deps, { sortSpecialFiles: true });
  return toolJson({ cwd, appDir, routeCount: routes.length, routes, specialFiles });
}

export async function expoRouteContext(
  cwd: string,
  dependencies: RouterSitemapDependencies = {},
): Promise<ExpoRouteContext> {
  const deps = resolveDependencies(dependencies);
  const appDir = deps.path.join(cwd, "app");
  const appExists = await deps.fs.pathExists(appDir);
  const { routes, specialFiles } = appExists ? await collectRoutes(appDir, deps) : { routes: [], specialFiles: [] };
  const typedRoutesPath = deps.path.join(cwd, ".expo", "types", "router.d.ts");
  const hasTypedRoutes = await deps.fs.pathExists(typedRoutesPath);
  const typedRoutes = hasTypedRoutes
    ? parseTypedRoutes(await deps.fs.readFile(typedRoutesPath, "utf8"))
    : [];
  return {
    appDir: appExists ? appDir : null,
    routeCount: routes.length,
    routes,
    specialFiles,
    typedRoutesPath: hasTypedRoutes ? typedRoutesPath : null,
    typedRoutes,
  };
}

async function collectRoutes(appDir: string, deps: RequiredRouterDependencies, options: { sortSpecialFiles?: boolean } = {}): Promise<{
  routes: RouteEntry[];
  specialFiles: SpecialFileEntry[];
}> {
  const files = await walkFiles(appDir, { fs: deps.fs, path: deps.path });
  const routeFiles = files.filter((file) => /\.(jsx?|tsx?)$/.test(file));
  const routes: RouteEntry[] = [];
  const specialFiles: SpecialFileEntry[] = [];
  for (const file of routeFiles) {
    const parsed = routeFromFile(deps.path.relative(appDir, file), { path: deps.path });
    if (parsed.kind === "route") {
      routes.push({ route: parsed.route, file, segments: parsed.segments });
    } else {
      specialFiles.push({ kind: parsed.kind, file });
    }
  }
  routes.sort((a, b) => a.route.localeCompare(b.route));
  if (options.sortSpecialFiles) specialFiles.sort((a, b) => a.file.localeCompare(b.file));
  return { routes, specialFiles };
}

function formatRouteSegment(segment: string): string {
  if (/^\[\.\.\..+\]$/.test(segment)) return `*${segment.slice(4, -1)}`;
  if (/^\[\[.+\]\]$/.test(segment)) return `:${segment.slice(2, -2)}?`;
  if (/^\[.+\]$/.test(segment)) return `:${segment.slice(1, -1)}`;
  return segment;
}

function parseTypedRoutes(source: string): string[] {
  return [...new Set(source.match(/pathname:\s*`([^`]+)`/g)?.map((match) => match.replace(/^pathname:\s*`|`$/g, "")) ?? [])].sort();
}

async function normalizeCwd(cwd: string | undefined, deps: RequiredRouterDependencies): Promise<string> {
  const resolved = deps.path.resolve(cwd ?? deps.processCwd);
  const stat = await deps.fs.stat(resolved);
  if (!stat?.isDirectory()) throw new Error(`Directory does not exist: ${resolved}`);
  return resolved;
}

interface RequiredRouterDependencies {
  fs: Required<RouterFileSystem>;
  path: RouterPathAdapter;
  processCwd: string;
}

function resolveDependencies(dependencies: RouterSitemapDependencies): RequiredRouterDependencies {
  const paths = dependencies.path ?? defaultPath;
  return {
    fs: {
      stat: dependencies.fs?.stat ?? defaultStat,
      pathExists: dependencies.fs?.pathExists ?? defaultPathExists,
      readdir: dependencies.fs?.readdir ?? defaultReaddir,
      readFile: dependencies.fs?.readFile ?? defaultReadFile,
    },
    path: paths,
    processCwd: dependencies.processCwd ?? ".",
  };
}

const defaultPath: RouterPathAdapter = {
  sep: path.sep,
  resolve: (...parts) => path.resolve(...parts.filter((part): part is string => Boolean(part))),
  join: (...parts) => path.join(...parts),
  relative: (from, to) => path.relative(from, to),
};

async function defaultStat(filePath: string): Promise<{ isDirectory(): boolean } | null> {
  return fs.stat(filePath).catch(() => null);
}

async function defaultPathExists(filePath: string): Promise<boolean> {
  return fs.access(filePath).then(() => true, () => false);
}

async function defaultReaddir(dirPath: string, options: { withFileTypes: true }): Promise<DirentLike[]> {
  return fs.readdir(dirPath, options);
}

async function defaultReadFile(filePath: string, encoding: "utf8"): Promise<string> {
  return fs.readFile(filePath, encoding);
}
