import { openSync } from "node:fs";
import { copyFile, mkdir, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import { spawn } from "node:child_process";

import { automationTakeScreenshot } from "../../../screenshot-capture/src/main/index.ts";
import { captureUxContext } from "../../../ux-context-capture/src/main/index.ts";

export interface ToolTextResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

export interface AnnotateScreenArgs extends Record<string, unknown> {
  cwd?: unknown;
  outputDir?: unknown;
  screenshotPath?: unknown;
  includeUxContext?: boolean;
  device?: unknown;
  bundleId?: unknown;
  metroPort?: unknown;
  title?: unknown;
  serve?: boolean;
  port?: unknown;
}

export interface AnnotationServerProcess {
  pid?: number;
  unref?: () => void;
}

export interface AnnotateScreenDependencies {
  normalizeProjectCwd: (cwd: unknown, options: { allowMissingPackageJson: true }) => Promise<string>;
  fallbackCwd: () => string;
  resolvePath: (...parts: string[]) => string;
  joinPath: (...parts: string[]) => string;
  mkdir: (dir: string, options: { recursive: true }) => Promise<unknown>;
  copyFile: (from: string, to: string) => Promise<unknown>;
  writeFile: (file: string, data: string, encoding: "utf8") => Promise<unknown>;
  pathExists: (file: string) => Promise<boolean>;
  captureUxContext: (args: Record<string, unknown>) => Promise<ToolTextResult> | ToolTextResult;
  automationTakeScreenshot: (args: Record<string, unknown>) => Promise<ToolTextResult> | ToolTextResult;
  annotationHtml?: (args: { title: string }) => string;
  findAvailablePort: (start: number) => Promise<number>;
  openLogFile: (file: string, flags: "a") => Promise<unknown> | unknown;
  spawnDetached: (command: string, argv: string[], options: { detached: true; stdio: unknown[] }) => Promise<AnnotationServerProcess> | AnnotationServerProcess;
  execPath: string;
  scriptPath: string;
  now?: () => Date;
}

export function toolJson(value: unknown): ToolTextResult {
  return { content: [{ type: "text", text: `${JSON.stringify(value, null, 2)}\n` }] };
}

export function unwrapToolJson(result: unknown): unknown {
  const text = (result as ToolTextResult | null | undefined)?.content?.[0]?.text;
  if (typeof text !== "string") return result;
  try {
    return JSON.parse(text);
  } catch {
    return { text };
  }
}

export async function annotateScreen(
  args: AnnotateScreenArgs = {},
  deps: AnnotateScreenDependencies = defaultAnnotateScreenDependencies,
): Promise<ToolTextResult> {
  const cwd = await deps.normalizeProjectCwd(args.cwd, { allowMissingPackageJson: true })
    .catch(() => deps.resolvePath(String(args.cwd ?? deps.fallbackCwd())));
  const timestamp = now(deps).toISOString().replace(/[:.]/g, "-");
  const outputDir = deps.resolvePath(
    requireOptionalString(args.outputDir) ??
      deps.joinPath(cwd, ".scratch", "expo-ios-annotations", `annotation-${timestamp}`),
  );
  await deps.mkdir(outputDir, { recursive: true });

  const screenshotPath = deps.joinPath(outputDir, "screenshot.png");
  let context: unknown = null;
  const existingScreenshot = requireOptionalString(args.screenshotPath);
  if (existingScreenshot) {
    await deps.copyFile(deps.resolvePath(existingScreenshot), screenshotPath);
    context = {
      source: "provided-screenshot",
      screenshot: { outputPath: screenshotPath },
      capturedAt: now(deps).toISOString(),
    };
  } else if (args.includeUxContext !== false) {
    context = unwrapToolJson(await deps.captureUxContext({
      cwd,
      device: args.device,
      bundleId: args.bundleId,
      metroPort: args.metroPort,
      outputPath: screenshotPath,
      includeScreenshot: true,
      includeImageAnalysis: true,
      includeHierarchy: true,
      includeRuntime: true,
      includeComponents: true,
      includeLogs: false,
    }));
  } else {
    const shot = unwrapToolJson(await deps.automationTakeScreenshot({
      platform: "ios",
      device: args.device,
      outputPath: screenshotPath,
    }));
    context = { source: "screenshot-only", screenshot: shot, capturedAt: now(deps).toISOString() };
  }

  const title = requireOptionalString(args.title) ?? "Expo screen annotations";
  const contextPath = deps.joinPath(outputDir, "context.json");
  const annotationsPath = deps.joinPath(outputDir, "annotations.json");
  const htmlPath = deps.joinPath(outputDir, "annotate.html");
  await deps.writeFile(contextPath, `${JSON.stringify(context, null, 2)}\n`, "utf8");
  if (!(await deps.pathExists(annotationsPath))) {
    await deps.writeFile(annotationsPath, `${JSON.stringify({
      version: 1,
      title,
      createdAt: now(deps).toISOString(),
      screenshot: "screenshot.png",
      context: "context.json",
      comments: [],
    }, null, 2)}\n`, "utf8");
  }
  await deps.writeFile(htmlPath, (deps.annotationHtml ?? annotationHtml)({ title }), "utf8");

  let server = null;
  if (args.serve === true) {
    const port = args.port ? clampNumber(args.port, 1, 65535) : await deps.findAvailablePort(17654);
    const logPath = deps.joinPath(outputDir, "annotation-server.log");
    const logFd = await deps.openLogFile(logPath, "a");
    const child = await deps.spawnDetached(deps.execPath, [
      deps.scriptPath,
      "annotation-server",
      "--dir",
      outputDir,
      "--port",
      String(port),
    ], {
      detached: true,
      stdio: ["ignore", logFd, logFd],
    });
    child.unref?.();
    server = {
      url: `http://127.0.0.1:${port}/`,
      pid: child.pid,
      logPath,
      stop: `kill ${child.pid}`,
    };
  }

  return toolJson({
    outputDir,
    htmlPath,
    screenshotPath,
    contextPath,
    annotationsPath,
    server,
    instructions: [
      server
        ? `Open ${server.url}, click or drag on the screenshot, add comments, then press Save.`
        : `Open ${htmlPath}. In file mode, use Download JSON or Copy JSON after adding comments.`,
      `Codex can read comments from ${annotationsPath}.`,
    ],
  });
}

const defaultAnnotateScreenDependencies: AnnotateScreenDependencies = {
  normalizeProjectCwd: defaultNormalizeProjectCwd,
  fallbackCwd: () => process.cwd(),
  resolvePath: (...parts) => path.resolve(...parts.filter((part): part is string => Boolean(part))),
  joinPath: (...parts) => path.join(...parts),
  mkdir,
  copyFile,
  writeFile,
  pathExists: async (file) => stat(file).then(() => true, () => false),
  captureUxContext,
  automationTakeScreenshot,
  findAvailablePort,
  openLogFile: (file) => openSync(file, "a"),
  spawnDetached: (command, argv, options) => spawn(command, argv, options),
  execPath: process.execPath,
  scriptPath: process.argv[1] ?? "",
  now: () => new Date(),
};

export function annotationHtml({ title }: { title: string }): string {
  const safeTitle = escapeHtml(title);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${safeTitle}</title>
  <style>
    :root { color-scheme: dark; font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif; background: #111; color: #f5f5f7; }
    body { margin: 0; display: grid; grid-template-columns: minmax(0, 1fr) 360px; min-height: 100vh; }
    #stage { position: relative; align-self: start; margin: 16px; border: 1px solid #3a3a3c; border-radius: 12px; overflow: hidden; background: #000; }
    #shot { display: block; width: 100%; height: auto; user-select: none; -webkit-user-drag: none; }
    aside { border-left: 1px solid #2c2c2e; padding: 16px; position: sticky; top: 0; height: 100vh; box-sizing: border-box; overflow: auto; background: #1c1c1e; }
    button, textarea { font: inherit; }
    button { border: 0; border-radius: 8px; padding: 8px 10px; background: #0a84ff; color: white; font-weight: 600; cursor: pointer; }
    button.secondary { background: #3a3a3c; }
    textarea { width: 100%; min-height: 72px; box-sizing: border-box; border-radius: 8px; border: 1px solid #48484a; background: #111; color: white; padding: 8px; resize: vertical; }
    .marker { position: absolute; min-width: 20px; height: 20px; border-radius: 999px; transform: translate(-50%, -50%); background: #ff453a; color: white; display: grid; place-items: center; font-size: 12px; font-weight: 700; }
    .rect { position: absolute; border: 2px solid #0a84ff; background: rgba(10,132,255,.12); border-radius: 6px; pointer-events: none; }
    .comment { border: 1px solid #38383a; border-radius: 10px; padding: 10px; margin: 10px 0; background: #242426; }
    .row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
    .hint { color: #a1a1a6; font-size: 13px; line-height: 1.35; }
  </style>
</head>
<body>
  <main><div id="stage"><img id="shot" src="screenshot.png" alt="Captured app screen"></div></main>
  <aside>
    <h1>${safeTitle}</h1>
    <p class="hint">Click the screenshot to add a point comment. Served mode saves to annotations.json.</p>
    <div class="row">
      <button id="save">Save</button>
      <button id="download" class="secondary">Download JSON</button>
      <button id="copy" class="secondary">Copy JSON</button>
    </div>
    <p id="status" class="hint"></p>
    <section id="comments"></section>
  </aside>
  <script>
    const stage = document.getElementById('stage');
    const shot = document.getElementById('shot');
    const commentsEl = document.getElementById('comments');
    const statusEl = document.getElementById('status');
    let annotations = { version: 1, title: ${JSON.stringify(title)}, screenshot: 'screenshot.png', context: 'context.json', comments: [] };
    let dragStart = null;
    fetch('annotations.json').then(r => r.ok ? r.json() : annotations).then(data => {
      if (data && Array.isArray(data.comments)) annotations = data;
      render();
    }).catch(render);
    function point(event) {
      const rect = shot.getBoundingClientRect();
      const x = Math.max(0, Math.min(rect.width, event.clientX - rect.left));
      const y = Math.max(0, Math.min(rect.height, event.clientY - rect.top));
      return { kind: 'point', x, y, nx: x / rect.width, ny: y / rect.height };
    }
    stage.addEventListener('mousedown', event => { if (event.button === 0) dragStart = point(event); });
    stage.addEventListener('mouseup', event => {
      if (!dragStart) return;
      const end = point(event);
      const dx = Math.abs(end.x - dragStart.x);
      const dy = Math.abs(end.y - dragStart.y);
      const isRect = dx > 8 || dy > 8;
      const text = prompt(isRect ? 'Comment for this region:' : 'Comment for this point:');
      if (text && text.trim()) {
        const rect = shot.getBoundingClientRect();
        const comment = isRect
          ? {
              kind: 'rect',
              x: Math.min(dragStart.x, end.x),
              y: Math.min(dragStart.y, end.y),
              width: dx,
              height: dy,
              nx: Math.min(dragStart.x, end.x) / rect.width,
              ny: Math.min(dragStart.y, end.y) / rect.height,
              nw: dx / rect.width,
              nh: dy / rect.height,
            }
          : end;
        annotations.comments.push({ id: 'c' + Date.now().toString(36), createdAt: new Date().toISOString(), ...comment, text: text.trim() });
        render();
      }
      dragStart = null;
    });
    function render() {
      stage.querySelectorAll('.marker,.rect').forEach(node => node.remove());
      commentsEl.textContent = '';
      const rect = shot.getBoundingClientRect();
      annotations.comments.forEach((comment, index) => {
        if (comment.kind === 'rect') {
          const node = document.createElement('div');
          node.className = 'rect';
          node.style.left = (comment.nx * rect.width) + 'px';
          node.style.top = (comment.ny * rect.height) + 'px';
          node.style.width = (comment.nw * rect.width) + 'px';
          node.style.height = (comment.nh * rect.height) + 'px';
          stage.appendChild(node);
        } else {
          const marker = document.createElement('div');
          marker.className = 'marker';
          marker.textContent = String(index + 1);
          marker.style.left = (comment.nx * rect.width) + 'px';
          marker.style.top = (comment.ny * rect.height) + 'px';
          stage.appendChild(marker);
        }
        const card = document.createElement('div');
        card.className = 'comment';
        const label = document.createElement('strong');
        label.textContent = '#' + (index + 1);
        const textarea = document.createElement('textarea');
        textarea.value = comment.text || '';
        textarea.addEventListener('input', () => { comment.text = textarea.value; });
        card.append(label, textarea);
        commentsEl.appendChild(card);
      });
    }
    async function save() {
      annotations.savedAt = new Date().toISOString();
      try {
        const res = await fetch('/annotations', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(annotations) });
        if (!res.ok) throw new Error(await res.text());
        statusEl.textContent = 'Saved to annotations.json';
      } catch {
        statusEl.textContent = 'Could not save via server. Use Download JSON or Copy JSON.';
      }
    }
    function download() {
      const blob = new Blob([JSON.stringify(annotations, null, 2) + '\\n'], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'annotations.json';
      a.click();
      URL.revokeObjectURL(url);
    }
    async function copyJson() {
      await navigator.clipboard.writeText(JSON.stringify(annotations, null, 2));
      statusEl.textContent = 'Copied JSON';
    }
    document.getElementById('save').addEventListener('click', save);
    document.getElementById('download').addEventListener('click', download);
    document.getElementById('copy').addEventListener('click', copyJson);
    window.addEventListener('resize', render);
    shot.addEventListener('load', render);
  </script>
</body>
</html>
`;
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

function now(deps: AnnotateScreenDependencies): Date {
  return deps.now?.() ?? new Date();
}

async function defaultNormalizeProjectCwd(cwd: unknown): Promise<string> {
  const resolved = path.resolve(requireOptionalString(cwd) ?? ".");
  const details = await stat(resolved).catch(() => null);
  if (!details?.isDirectory()) throw new Error(`Directory does not exist: ${resolved}`);
  return resolved;
}

function findAvailablePort(start: number): Promise<number> {
  return new Promise((resolve) => {
    const tryPort = (port: number) => {
      const server = createServer();
      server.once("error", () => tryPort(port + 1));
      server.once("listening", () => {
        server.close(() => resolve(port));
      });
      server.listen(port, "127.0.0.1");
    };
    tryPort(start);
  });
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
