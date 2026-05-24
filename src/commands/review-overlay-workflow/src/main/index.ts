import { openSync } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import path from "node:path";
import { spawn, type StdioOptions } from "node:child_process";

import { toolJson, type ToolTextResult } from "../../../../core/tool-json-envelope/src/main/index.ts";

export interface ReviewOverlayArgs extends Record<string, unknown> {
  action?: unknown;
  cwd?: unknown;
  outputDir?: unknown;
  title?: unknown;
  serve?: boolean;
  port?: unknown;
  endpointPath?: unknown;
  metroPort?: unknown;
  overlayDir?: unknown;
  force?: boolean;
}

export interface ReviewOverlayDependencies {
  normalizeProjectCwd: (cwd: unknown, options: { allowMissingPackageJson: true }) => Promise<string>;
  fallbackCwd: () => string;
  resolvePath: (...parts: string[]) => string;
  joinPath: (...parts: string[]) => string;
  relativePath: (from: string, to: string) => string;
  createEventsFile: (args: { outputDir: string; title?: unknown; reset: boolean }) => Promise<Record<string, any>>;
  readEvents: (eventsPath: string, options?: { metroPort?: unknown }) => Promise<Record<string, any>>;
  reviewOverlayServer: (args: { dir: string; port?: unknown; endpointPath?: unknown }) => Promise<ToolTextResult> | ToolTextResult;
  mkdir: (dir: string, options: { recursive: true }) => Promise<unknown>;
  writeFile: (file: string, data: string, encoding: "utf8") => Promise<unknown>;
  pathExists: (file: string) => Promise<boolean>;
  findAvailablePort: (start: number) => Promise<number>;
  openLogFile: (file: string, flags: "a") => Promise<number> | number;
  spawnDetached: (command: string, argv: string[], options: { detached: true; stdio: StdioOptions }) => Promise<{ pid?: number; unref?: () => void }> | { pid?: number; unref?: () => void };
  execPath: string;
  scriptPath: string;
}

const REVIEW_OVERLAY_ACTIONS = new Set(["prepare", "scaffold", "server", "read", "clear"]);

export async function reviewOverlay(
  args: ReviewOverlayArgs = {},
  deps: ReviewOverlayDependencies = defaultReviewOverlayDependencies,
): Promise<ToolTextResult> {
  const action = requireOptionalString(args.action) ?? "prepare";
  if (!REVIEW_OVERLAY_ACTIONS.has(action)) {
    throw new Error(`Unknown review-overlay action: ${action}`);
  }
  if (action === "scaffold") return toolJson(await scaffoldReviewOverlay(args, deps));

  const cwd = await deps.normalizeProjectCwd(args.cwd, { allowMissingPackageJson: true })
    .catch(() => deps.resolvePath(String(args.cwd ?? deps.fallbackCwd())));
  const outputDir = deps.resolvePath(requireOptionalString(args.outputDir) ?? deps.joinPath(cwd, ".scratch", "codex-review-overlay"));
  const eventsPath = deps.joinPath(outputDir, "events.json");

  if (action === "read") {
    const data = await deps.readEvents(eventsPath, { metroPort: args.metroPort });
    return toolJson({ outputDir, eventsPath, ...data });
  }
  if (action === "clear") {
    const data = await deps.createEventsFile({ outputDir, title: args.title, reset: true });
    return toolJson({ outputDir, eventsPath, cleared: true, ...data });
  }
  if (action === "server") {
    return deps.reviewOverlayServer({ dir: outputDir, port: args.port, endpointPath: args.endpointPath });
  }

  const title = requireOptionalString(args.title) ?? "Codex in-app review";
  const data = await deps.createEventsFile({ outputDir, title, reset: false });
  let server = null;
  if (args.serve === true) {
    const port = args.port ? clampNumber(args.port, 1, 65535) : await deps.findAvailablePort(17655);
    const endpointPath = normalizeEndpointPath(args.endpointPath);
    const logPath = deps.joinPath(outputDir, "review-overlay-server.log");
    const logFd = await deps.openLogFile(logPath, "a");
    const child = await deps.spawnDetached(deps.execPath, [
      deps.scriptPath,
      "review-overlay-server",
      "--output-dir",
      outputDir,
      "--port",
      String(port),
      "--endpoint-path",
      endpointPath,
    ], {
      detached: true,
      stdio: ["ignore", logFd, logFd],
    });
    child.unref?.();
    server = {
      url: `http://127.0.0.1:${port}/`,
      endpoint: `http://127.0.0.1:${port}${endpointPath}`,
      eventsUrl: `http://127.0.0.1:${port}/events.json`,
      pid: child.pid,
      logPath,
      stop: `kill ${child.pid}`,
    };
  }

  return toolJson({
    outputDir,
    eventsPath,
    server,
    ...data,
    instructions: [
      "Run review-overlay scaffold once, then mount CodexReviewOverlay inside the app root in development only.",
      server
        ? `Pass endpoint="${server.endpoint}" to CodexReviewOverlay. In iOS Simulator, 127.0.0.1 points at the Mac host.`
        : "Start with --serve true or run review-overlay server before using the overlay in the simulator.",
      `Codex can read in-app review events from ${eventsPath}.`,
    ],
  });
}

const defaultReviewOverlayDependencies: ReviewOverlayDependencies = {
  normalizeProjectCwd: defaultNormalizeProjectCwd,
  fallbackCwd: () => process.cwd(),
  resolvePath: (...parts) => path.resolve(...parts.filter((part): part is string => Boolean(part))),
  joinPath: (...parts) => path.join(...parts),
  relativePath: (from, to) => path.relative(from, to),
  createEventsFile,
  readEvents,
  reviewOverlayServer,
  mkdir,
  writeFile,
  pathExists: async (file) => stat(file).then(() => true, () => false),
  findAvailablePort,
  openLogFile: (file) => openSync(file, "a"),
  spawnDetached: (command, argv, options) => spawn(command, argv, options),
  execPath: process.execPath,
  scriptPath: process.argv[1] ?? "",
};

export async function scaffoldReviewOverlay(
  args: ReviewOverlayArgs = {},
  deps: ReviewOverlayDependencies,
): Promise<Record<string, any>> {
  const cwd = await deps.normalizeProjectCwd(args.cwd, { allowMissingPackageJson: true })
    .catch(() => deps.resolvePath(String(args.cwd ?? deps.fallbackCwd())));
  const overlayDir = deps.resolvePath(cwd, requireOptionalString(args.overlayDir) ?? "codex-review-overlay");
  const componentPath = deps.joinPath(overlayDir, "CodexReviewOverlay.tsx");
  const indexPath = deps.joinPath(overlayDir, "index.ts");
  if (await deps.pathExists(componentPath) && args.force !== true) {
    throw new Error(`${componentPath} already exists. Pass --force true to overwrite.`);
  }
  await deps.mkdir(overlayDir, { recursive: true });
  await deps.writeFile(componentPath, codexReviewOverlayComponentSource(), "utf8");
  await deps.writeFile(indexPath, `export { CodexReviewOverlay } from "./CodexReviewOverlay";\nexport { default } from "./CodexReviewOverlay";\n`, "utf8");
  return {
    overlayDir,
    componentPath,
    indexPath,
    integration: {
      import: `import { CodexReviewOverlay } from "${relativeImportFromAppRoot(cwd, overlayDir, deps)}";`,
      jsx: `{__DEV__ ? <CodexReviewOverlay endpoint="http://127.0.0.1:17655/events" screenName="Schedule" inspectedViewRef={inspectedViewRef} /> : null}`,
      note: "Mount this near the root layout so it floats above the current screen. Wrap only the app content, not the overlay, in a host View ref with collapsable={false}; pass that ref as inspectedViewRef so comments identify the tapped app element.",
    },
    capabilities: [
      "single Comment control inside the app",
      "inactive state leaves the app interactive",
      "mouse-over preview after Comment resolves native elements before selection",
      "next click after Comment resolves the touched native element and owner hierarchy",
      "Copy action writes Agentation-style feedback markdown to the Mac clipboard",
      "bounding boxes around commented elements",
      "gesture metadata for tap, hold, and scroll conflict notes",
      "local JSON event sync readable by Codex",
    ],
  };
}

export function relativeImportFromAppRoot(cwd: string, overlayDir: string, deps?: Pick<ReviewOverlayDependencies, "relativePath">): string {
  const rel = (deps?.relativePath(cwd, overlayDir) ?? relativePathFallback(cwd, overlayDir)).replace(/\\/g, "/");
  return rel.startsWith(".") ? rel : `./${rel}`;
}

export function normalizeEndpointPath(value: unknown): string {
  const raw = requireOptionalString(value) ?? "/events";
  const endpoint = raw.startsWith("/") ? raw : `/${raw}`;
  if (!/^\/[A-Za-z0-9_./-]+$/.test(endpoint)) throw new Error("endpointPath must be a simple URL path.");
  return endpoint;
}

export function requireOptionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function clampNumber(value: unknown, min: number, max: number): number {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) {
    throw new Error(`Expected a finite number, got ${value}.`);
  }
  return Math.min(Math.max(numberValue, min), max);
}

export function codexReviewOverlayComponentSource(): string {
  return `import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

type CodexReviewOverlayProps = {
  endpoint?: string;
  screenName?: string;
  inspectedViewRef?: React.RefObject<unknown>;
};

export function CodexReviewOverlay({ endpoint = "http://127.0.0.1:17655/events", screenName = "Screen", inspectedViewRef }: CodexReviewOverlayProps): React.ReactElement {
  const [active, setActive] = useState(false);
  const [events, setEvents] = useState([]);
  const sequence = useRef(0);

  const submit = useCallback(async (event) => {
    const payload = {
      id: "overlay-" + Date.now().toString(36) + "-" + sequence.current++,
      screenName,
      createdAt: new Date().toISOString(),
      ...event,
    };
    setEvents((current) => current.concat(payload));
    try {
      await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch {}
  }, [endpoint, screenName]);

  const label = useMemo(() => active ? "Tap target" : "Comment", [active]);

  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      <View pointerEvents="box-none" style={styles.toolbar}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Codex review comment"
          onPress={() => setActive((value) => !value)}
          style={[styles.button, active ? styles.active : null]}
        >
          <Text style={styles.buttonText}>{label}</Text>
        </Pressable>
      </View>
      {active ? (
        <Pressable
          accessibilityLabel="Codex review target surface"
          style={StyleSheet.absoluteFill}
          onPress={(event) => {
            const { locationX, locationY, pageX, pageY } = event.nativeEvent;
            submit({
              type: "tap-comment",
              gesture: { locationX, locationY, pageX, pageY },
              element: { refAvailable: Boolean(inspectedViewRef?.current) },
            });
            setActive(false);
          }}
        />
      ) : null}
      <View pointerEvents="none" style={styles.counter}>
        <Text style={styles.counterText}>{events.length}</Text>
      </View>
    </View>
  );
}

export default CodexReviewOverlay;

const styles = StyleSheet.create({
  toolbar: { position: "absolute", top: 48, right: 16, zIndex: 9999 },
  button: { backgroundColor: "#0a84ff", borderRadius: 18, paddingHorizontal: 14, paddingVertical: 9 },
  active: { backgroundColor: "#ff453a" },
  buttonText: { color: "white", fontWeight: "700" },
  counter: { position: "absolute", top: 92, right: 16, minWidth: 24, alignItems: "center" },
  counterText: { color: "white", backgroundColor: "rgba(0,0,0,0.55)", borderRadius: 12, overflow: "hidden", paddingHorizontal: 7, paddingVertical: 2 },
});
`;
}

function relativePathFallback(from: string, to: string): string {
  const fromParts = from.split("/").filter(Boolean);
  const toParts = to.split("/").filter(Boolean);
  while (fromParts.length && toParts.length && fromParts[0] === toParts[0]) {
    fromParts.shift();
    toParts.shift();
  }
  return [...fromParts.map(() => ".."), ...toParts].join("/") || ".";
}

async function defaultNormalizeProjectCwd(cwd: unknown): Promise<string> {
  const resolved = path.resolve(requireOptionalString(cwd) ?? ".");
  const details = await stat(resolved).catch(() => null);
  if (!details?.isDirectory()) throw new Error(`Directory does not exist: ${resolved}`);
  return resolved;
}

async function createEventsFile(args: { outputDir: string; title?: unknown; reset: boolean }): Promise<Record<string, any>> {
  await mkdir(args.outputDir, { recursive: true });
  const eventsPath = path.join(args.outputDir, "events.json");
  const existing = await readJson(eventsPath).catch(() => null);
  const payload = args.reset || !existing
    ? {
      version: 1,
      title: requireOptionalString(args.title) ?? "Codex in-app review",
      createdAt: new Date().toISOString(),
      events: [],
    }
    : existing;
  await writeFile(eventsPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return { eventsPath, eventCount: Array.isArray(payload.events) ? payload.events.length : 0, title: payload.title ?? null };
}

async function readEvents(eventsPath: string, options: { metroPort?: unknown } = {}): Promise<Record<string, any>> {
  const payload = await readJson(eventsPath).catch(() => null);
  if (!payload) {
    return { available: false, reason: "No review overlay events file exists.", eventCount: 0, events: [], metroPort: options.metroPort ?? null };
  }
  const events = Array.isArray(payload.events) ? payload.events : [];
  return { available: true, eventCount: events.length, events, title: payload.title ?? null, metroPort: options.metroPort ?? null };
}

async function reviewOverlayServer(args: { dir: string; port?: unknown; endpointPath?: unknown }): Promise<ToolTextResult> {
  const dir = path.resolve(args.dir);
  const port = args.port ? clampNumber(args.port, 1, 65535) : await findAvailablePort(17655);
  const endpointPath = normalizeEndpointPath(args.endpointPath);
  await mkdir(dir, { recursive: true });
  await createEventsFile({ outputDir: dir, reset: false });
  const server = createHttpServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", async () => {
      const url = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);
      const eventsPath = path.join(dir, "events.json");
      if (request.method === "GET" && url.pathname === "/events.json") {
        const text = await readFile(eventsPath, "utf8").catch(() => "{\"events\":[]}\n");
        response.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
        response.end(text);
        return;
      }
      if (request.method === "POST" && url.pathname === endpointPath) {
        const current = await readJson(eventsPath).catch(() => ({ version: 1, events: [] }));
        const events = Array.isArray(current.events) ? current.events : [];
        events.push(JSON.parse(body || "{}"));
        const next = { ...current, events, updatedAt: new Date().toISOString() };
        await writeFile(eventsPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
        response.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
        response.end(`${JSON.stringify({ ok: true, eventsPath, eventCount: events.length }, null, 2)}\n`);
        return;
      }
      response.writeHead(404, { "content-type": "application/json; charset=utf-8" });
      response.end("{\"ok\":false,\"error\":\"not found\"}\n");
    });
  });
  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", () => resolve()));
  const payload = { ok: true, url: `http://127.0.0.1:${port}/`, endpoint: `http://127.0.0.1:${port}${endpointPath}`, eventsUrl: `http://127.0.0.1:${port}/events.json`, dir };
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  return await new Promise<never>(() => {});
}

async function readJson(file: string): Promise<Record<string, any>> {
  return JSON.parse(await readFile(file, "utf8"));
}

function findAvailablePort(start: number): Promise<number> {
  return new Promise((resolve) => {
    const tryPort = (port: number) => {
      const server = createNetServer();
      server.once("error", () => tryPort(port + 1));
      server.once("listening", () => {
        server.close(() => resolve(port));
      });
      server.listen(port, "127.0.0.1");
    };
    tryPort(start);
  });
}
