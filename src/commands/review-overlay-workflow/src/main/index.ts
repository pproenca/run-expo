import { spawn, type StdioOptions } from "node:child_process";
import { openSync } from "node:fs";
import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  toolJson,
  type ToolTextResult,
} from "../../../../core/tool-json-envelope/src/main/index.ts";
import { createEventsFile, readEvents } from "./events.js";
import { codexReviewOverlayComponentSource } from "./scaffold-template.js";
import {
  clampNumber,
  findAvailablePort,
  normalizeEndpointPath,
  reviewOverlayServer,
} from "./server.js";

export { codexReviewOverlayComponentSource };
export { normalizeEndpointPath, reviewOverlayServer };

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
  normalizeProjectCwd: (
    cwd: unknown,
    options: { allowMissingPackageJson: true },
  ) => Promise<string>;
  fallbackCwd: () => string;
  resolvePath: (...parts: string[]) => string;
  joinPath: (...parts: string[]) => string;
  relativePath: (from: string, to: string) => string;
  createEventsFile: (args: {
    outputDir: string;
    title?: unknown;
    reset: boolean;
  }) => Promise<Record<string, any>>;
  readEvents: (
    eventsPath: string,
    options?: { metroPort?: unknown },
  ) => Promise<Record<string, any>>;
  reviewOverlayServer: (args: {
    dir: string;
    port?: unknown;
    endpointPath?: unknown;
  }) => Promise<ToolTextResult> | ToolTextResult;
  mkdir: (dir: string, options: { recursive: true }) => Promise<unknown>;
  writeFile: (file: string, data: string, encoding: "utf8") => Promise<unknown>;
  pathExists: (file: string) => Promise<boolean>;
  findAvailablePort: (start: number) => Promise<number>;
  openLogFile: (file: string, flags: "a") => Promise<number> | number;
  spawnDetached: (
    command: string,
    argv: string[],
    options: { detached: true; stdio: StdioOptions },
  ) => Promise<{ pid?: number; unref?: () => void }> | { pid?: number; unref?: () => void };
  execPath: string;
  scriptPath: string;
}

export type ReviewOverlayPayload = Record<string, any>;

const REVIEW_OVERLAY_ACTIONS = new Set(["prepare", "scaffold", "server", "read", "clear"]);

export async function reviewOverlay(
  args: ReviewOverlayArgs = {},
  deps: ReviewOverlayDependencies = defaultReviewOverlayDependencies,
): Promise<ToolTextResult> {
  const payload = await reviewOverlayAction(args, deps);
  return isToolTextResult(payload) ? payload : toolJson(payload);
}

export async function reviewOverlayAction(
  args: ReviewOverlayArgs = {},
  deps: ReviewOverlayDependencies = defaultReviewOverlayDependencies,
): Promise<ReviewOverlayPayload | ToolTextResult> {
  const action = requireOptionalString(args.action) ?? "prepare";
  if (!REVIEW_OVERLAY_ACTIONS.has(action)) {
    throw new Error(`Unknown review-overlay action: ${action}`);
  }
  if (action === "scaffold") return scaffoldReviewOverlay(args, deps);

  const cwd = await deps
    .normalizeProjectCwd(args.cwd, { allowMissingPackageJson: true })
    .catch(() => deps.resolvePath(String(args.cwd ?? deps.fallbackCwd())));
  const outputDir = deps.resolvePath(
    requireOptionalString(args.outputDir) ?? deps.joinPath(cwd, ".scratch", "codex-review-overlay"),
  );
  const eventsPath = deps.joinPath(outputDir, "events.json");

  if (action === "read") {
    const data = await deps.readEvents(eventsPath, { metroPort: args.metroPort });
    return { outputDir, eventsPath, ...data };
  }
  if (action === "clear") {
    const data = await deps.createEventsFile({ outputDir, title: args.title, reset: true });
    return { outputDir, eventsPath, cleared: true, ...data };
  }
  if (action === "server") {
    return deps.reviewOverlayServer({
      dir: outputDir,
      port: args.port,
      endpointPath: args.endpointPath,
    });
  }

  const title = requireOptionalString(args.title) ?? "Codex in-app review";
  const data = await deps.createEventsFile({ outputDir, title, reset: false });
  let server = null;
  if (args.serve === true) {
    const port = args.port ? clampNumber(args.port, 1, 65535) : await deps.findAvailablePort(17655);
    const endpointPath = normalizeEndpointPath(args.endpointPath);
    const logPath = deps.joinPath(outputDir, "review-overlay-server.log");
    const logFd = await deps.openLogFile(logPath, "a");
    const child = await deps.spawnDetached(
      deps.execPath,
      [
        deps.scriptPath,
        "review-overlay-server",
        "--output-dir",
        outputDir,
        "--port",
        String(port),
        "--endpoint-path",
        endpointPath,
      ],
      {
        detached: true,
        stdio: ["ignore", logFd, logFd],
      },
    );
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

  return {
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
  };
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
  pathExists: async (file) =>
    stat(file).then(
      () => true,
      () => false,
    ),
  findAvailablePort,
  openLogFile: (file) => openSync(file, "a"),
  spawnDetached: (command, argv, options) => spawn(command, argv, options),
  execPath: process.execPath,
  scriptPath: process.argv[1] ?? "",
};

function isToolTextResult(value: unknown): value is ToolTextResult {
  return Array.isArray((value as { content?: unknown } | null)?.content);
}

export async function scaffoldReviewOverlay(
  args: ReviewOverlayArgs = {},
  deps: ReviewOverlayDependencies,
): Promise<Record<string, any>> {
  const cwd = await deps
    .normalizeProjectCwd(args.cwd, { allowMissingPackageJson: true })
    .catch(() => deps.resolvePath(String(args.cwd ?? deps.fallbackCwd())));
  const overlayDir = deps.resolvePath(
    cwd,
    requireOptionalString(args.overlayDir) ?? "codex-review-overlay",
  );
  const componentPath = deps.joinPath(overlayDir, "CodexReviewOverlay.tsx");
  const indexPath = deps.joinPath(overlayDir, "index.ts");
  if ((await deps.pathExists(componentPath)) && args.force !== true) {
    throw new Error(`${componentPath} already exists. Pass --force true to overwrite.`);
  }
  await deps.mkdir(overlayDir, { recursive: true });
  await deps.writeFile(componentPath, codexReviewOverlayComponentSource(), "utf8");
  await deps.writeFile(
    indexPath,
    `export { CodexReviewOverlay } from "./CodexReviewOverlay";\nexport { default } from "./CodexReviewOverlay";\n`,
    "utf8",
  );
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

export function relativeImportFromAppRoot(
  cwd: string,
  overlayDir: string,
  deps?: Pick<ReviewOverlayDependencies, "relativePath">,
): string {
  const rel = (
    deps?.relativePath(cwd, overlayDir) ?? relativePathFallback(cwd, overlayDir)
  ).replace(/\\/g, "/");
  return rel.startsWith(".") ? rel : `./${rel}`;
}

export function requireOptionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
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
