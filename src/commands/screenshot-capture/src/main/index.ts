import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { execFile, spawn } from "node:child_process";

import { toolJson, type ToolTextResult } from "../../../../core/tool-json-envelope/src/main/index.ts";

declare const process: { env: Record<string, string | undefined> };

export const MAX_OUTPUT = 40_000;

export type Platform = "ios" | "android" | string;

export type ExecError = {
  message: string;
  code?: number | string | null;
  signal?: string | null;
};

export type ExecResult = {
  stdout?: string | null;
  stderr?: string | null;
  error?: ExecError | null;
};

export type ExecOptions = {
  timeout?: number;
  maxBuffer?: number;
  rejectOnError?: boolean;
};

export type ExecCall = {
  file: string;
  args: string[];
  options: ExecOptions;
};

export type IosDevice = {
  udid: string;
  name: string;
  state?: string;
  runtime?: string;
  isAvailable?: boolean;
};

export type ScreenshotBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type ScreenshotRefRecord = {
  ref: string;
  snapshotId?: string | null;
  targetId?: string | null;
  label?: string | null;
  text?: string | null;
  role?: string | null;
  source?: unknown;
  box?: ScreenshotBox | null;
  stale?: boolean;
};

export type ScreenshotRefCache = {
  snapshotId?: string | null;
  targetId?: string | null;
  refs?: ScreenshotRefRecord[];
};

export type ScreenshotLabel = {
  ref: string;
  label: string;
  role: string | null;
  text: string | null;
  source: unknown;
  box: ScreenshotBox;
  snapshotId: string | null | undefined;
  targetId: string | null | undefined;
  index: number;
};

export type ScreenshotCaptureArgs = {
  platform?: Platform;
  device?: string;
  outputPath?: string;
  cwd?: string;
  root?: string;
  stateDir?: string;
  annotate?: boolean;
  full?: boolean;
  fullSegments?: number | string;
  segments?: number | string;
  [key: string]: unknown;
};

export type ToolResult = ToolTextResult;

export type SpawnedProcess = {
  stdout: {
    on(event: "data", handler: (chunk: Uint8Array) => void): void;
  };
  stderr: {
    setEncoding?(encoding: "utf8"): void;
    on(event: "data", handler: (chunk: string) => void): void;
  };
  on(event: "error", handler: (error: Error) => void): void;
  on(event: "close", handler: (code: number | null) => void): void;
  kill(): void;
};

export type ScreenshotCaptureDependencies = {
  captureFullScreenshot?(args: ScreenshotCaptureArgs): Promise<unknown>;
  captureScreenshot?(args: ScreenshotCaptureArgs): Promise<unknown>;
  annotatedScreenshot?(args: ScreenshotCaptureArgs): Promise<unknown>;
  execFile?(file: string, args: string[], options: ExecOptions): Promise<ExecResult>;
  spawnProcess?(file: string, args: string[], options: { stdio: ["ignore", "pipe", "pipe"] }): SpawnedProcess;
  resolveIosDevice?(requested: string | undefined, options: { preferBooted: true }): Promise<IosDevice>;
  adbScreenshot?(device: string | undefined, outputPath: string): Promise<void>;
  commandPath?(command: string): Promise<string | null>;
  pathExists?(file: string): Promise<boolean>;
  mkdir?(directory: string, options: { recursive: true }): Promise<void>;
  readLatestRefCache?(args: ScreenshotCaptureArgs): Promise<ScreenshotRefCache | null>;
  readDir?(directory: string, options: { withFileTypes: true }): Promise<Array<{ name: string; isDirectory(): boolean }>>;
  readJsonFile?(file: string): Promise<unknown>;
  writeJsonFile?(file: string, value: unknown): Promise<void>;
  writeFile?(file: string, contents: string, encoding: "utf8"): Promise<void>;
  wait?(ms: number): Promise<void>;
  nowIso?(): string;
};

export async function automationTakeScreenshot(
  args: ScreenshotCaptureArgs,
  deps: ScreenshotCaptureDependencies = {},
): Promise<ToolResult> {
  if (args.full === true) {
    return toolJson(await (deps.captureFullScreenshot ?? captureFullScreenshot)(args, deps));
  }
  if (args.annotate === true) {
    return toolJson(await (deps.annotatedScreenshot ?? annotatedScreenshot)(args, deps));
  }
  return toolJson(await (deps.captureScreenshot ?? captureScreenshot)(args, deps));
}

export async function captureFullScreenshot(
  args: ScreenshotCaptureArgs,
  deps: ScreenshotCaptureDependencies = {},
): Promise<Record<string, unknown>> {
  const platform = args.platform ?? "ios";
  if (platform !== "ios") {
    return {
      available: false,
      reason: "Segmented full-page capture is currently implemented for iOS simulator targets only.",
      mode: "full",
      platform,
    };
  }

  const axe = await commandPath("axe", deps);
  if (!axe) {
    return {
      available: false,
      reason: "Full-page capture requires the axe CLI to perform real simulator scroll gestures.",
      mode: "full",
      platform,
    };
  }

  const magick = await commandPath("magick", deps);
  if (!magick) {
    return {
      available: false,
      reason: "Full-page capture requires ImageMagick's magick command to stitch captured viewport segments.",
      mode: "full",
      platform,
    };
  }

  const device = await resolveIosDevice(args.device, deps);
  const outputPath = path.resolve(
    args.outputPath ??
      path.join(os.tmpdir(), "expo98-screenshots", `full-screenshot-${safeTimestamp(deps)}.png`),
  );
  const segmentCount = clampNumber(args.fullSegments ?? args.segments ?? 3, 1, 12);
  const segmentDir = path.join(path.dirname(outputPath), `${path.basename(outputPath, path.extname(outputPath))}-segments`);
  await mkdir(segmentDir, deps);

  const segments: string[] = [];
  const firstPath = path.join(segmentDir, "segment-000.png");
  const first = await (deps.captureScreenshot ?? captureScreenshot)(
    { ...args, full: false, annotate: false, outputPath: firstPath, device: device.udid, platform },
    deps,
  );
  if (isUnavailable(first)) return first;
  segments.push(firstPath);

  const dimensions = await imageDimensions(magick, firstPath, deps);
  const width = dimensions?.width ?? 390;
  const height = dimensions?.height ?? 844;
  const startX = Math.max(1, Math.round(width / 2));
  const startY = Math.max(1, Math.round(height * 0.82));
  const endY = Math.max(1, Math.round(height * 0.28));
  const gestureResults: Array<Record<string, unknown>> = [];

  for (let index = 1; index < segmentCount; index += 1) {
    const gesture = await execFilePromise(axe, [
      "swipe",
      "--start-x",
      String(startX),
      "--start-y",
      String(startY),
      "--end-x",
      String(startX),
      "--end-y",
      String(endY),
      "--duration",
      "0.45",
      "--udid",
      device.udid,
    ], { timeout: 10_000, rejectOnError: false }, deps);
    gestureResults.push({
      index,
      stdout: truncate(gesture.stdout),
      stderr: truncate(gesture.stderr),
      error: gesture.error ?? null,
    });
    if (gesture.error) break;
    await wait(300, deps);
    const segmentPath = path.join(segmentDir, `segment-${String(index).padStart(3, "0")}.png`);
    const segment = await (deps.captureScreenshot ?? captureScreenshot)(
      { ...args, full: false, annotate: false, outputPath: segmentPath, device: device.udid, platform },
      deps,
    );
    if (isUnavailable(segment)) break;
    segments.push(segmentPath);
  }

  for (let index = 1; index < segments.length; index += 1) {
    await execFilePromise(axe, [
      "swipe",
      "--start-x",
      String(startX),
      "--start-y",
      String(endY),
      "--end-x",
      String(startX),
      "--end-y",
      String(startY),
      "--duration",
      "0.25",
      "--udid",
      device.udid,
    ], { timeout: 10_000, rejectOnError: false }, deps);
  }

  await mkdir(path.dirname(outputPath), deps);
  const stitch = await execFilePromise(magick, [...segments, "-append", outputPath], {
    timeout: 30_000,
    rejectOnError: false,
  }, deps);
  if (stitch.error || !(await defaultPathExists(outputPath, deps))) {
    return {
      available: false,
      reason: "Captured scroll segments but failed to stitch the full screenshot artifact.",
      mode: "full",
      platform,
      device,
      outputPath,
      segmentDir,
      segments,
      stitch: {
        stdout: truncate(stitch.stdout),
        stderr: truncate(stitch.stderr),
        error: stitch.error,
      },
    };
  }

  return {
    available: true,
    mode: "full",
    strategy: "segmented-scroll-stitch",
    platform,
    device,
    outputPath,
    segmentDir,
    segments,
    segmentCount: segments.length,
    tools: { gesture: "axe", stitch: "magick" },
    limitation: "iOS Simulator does not expose a stable native full-page screenshot API for arbitrary React Native views; this artifact stitches real viewport screenshots captured after simulator scroll gestures.",
    gestures: gestureResults,
    stitch: {
      stdout: truncate(stitch.stdout),
      stderr: truncate(stitch.stderr),
    },
  };
}

export async function imageDimensions(
  magick: string,
  imagePath: string,
  deps: Pick<ScreenshotCaptureDependencies, "execFile"> = {},
): Promise<{ width: number; height: number } | null> {
  const result = await execFilePromise(magick, ["identify", "-format", "%w %h", imagePath], {
    timeout: 5_000,
    rejectOnError: false,
  }, deps);
  if (result.error) return null;
  const match = String(result.stdout ?? "").trim().match(/^(\d+)\s+(\d+)$/);
  if (!match) return null;
  return { width: Number(match[1]), height: Number(match[2]) };
}

export async function captureScreenshot(
  args: ScreenshotCaptureArgs,
  deps: ScreenshotCaptureDependencies = {},
): Promise<Record<string, unknown>> {
  const platform = args.platform ?? "ios";
  const outputPath = path.resolve(
    args.outputPath ??
      path.join(os.tmpdir(), "expo98-screenshots", `screenshot-${safeTimestamp(deps)}.png`),
  );
  await mkdir(path.dirname(outputPath), deps);

  if (platform === "android") {
    await adbScreenshot(args.device, outputPath, deps);
    return { platform, device: args.device ?? null, outputPath };
  }

  const device = await resolveIosDevice(args.device, deps);
  const result = await execFilePromise("xcrun", ["simctl", "io", device.udid, "screenshot", outputPath], {
    timeout: 30_000,
    rejectOnError: false,
  }, deps);
  if (result.error || !(await defaultPathExists(outputPath, deps))) {
    return {
      available: false,
      reason: "Screenshot tooling failed.",
      platform,
      device,
      outputPath,
      stdout: truncate(result.stdout),
      stderr: truncate(result.stderr),
      error: result.error,
    };
  }
  return {
    platform,
    device,
    outputPath,
    stdout: truncate(result.stdout),
    stderr: truncate(result.stderr),
  };
}

export async function annotatedScreenshot(
  args: ScreenshotCaptureArgs,
  deps: ScreenshotCaptureDependencies = {},
): Promise<Record<string, unknown>> {
  const cache = await readLatestRefCache(args, deps);
  if (!cache) {
    return { available: false, reason: "No snapshot exists for the current session." };
  }

  const labelMap = buildScreenshotLabelMap(cache);
  if (labelMap.available === false) return labelMap;

  const screenshot = asRecord(await captureScreenshot({ ...args, annotate: false }, deps));
  if (screenshot.available === false) return screenshot;

  const outputPath = String(screenshot.outputPath);
  const artifacts = annotatedScreenshotArtifactPaths(outputPath);
  const labels = (asRecord(labelMap).labels ?? []) as ScreenshotLabel[];
  await writeJsonFile(artifacts.labelMap, {
    schemaVersion: 1,
    createdAt: deps.nowIso?.() ?? new Date().toISOString(),
    screenshot: outputPath,
    annotatedImage: artifacts.annotatedImage,
    snapshotId: cache.snapshotId,
    targetId: cache.targetId,
    labels,
  }, deps);
  await writeFile(artifacts.annotatedImage, annotatedScreenshotSvg({ screenshotPath: outputPath, labels }), "utf8", deps);
  return {
    ...screenshot,
    available: true,
    annotated: true,
    snapshotId: cache.snapshotId,
    targetId: cache.targetId,
    artifacts: {
      screenshot: outputPath,
      annotatedImage: artifacts.annotatedImage,
      labelMap: artifacts.labelMap,
    },
    labels,
  };
}

export function buildScreenshotLabelMap(cache: ScreenshotRefCache): Record<string, unknown> {
  const refs = cache.refs ?? [];
  const targetMismatch = refs.filter((record) =>
    record.snapshotId !== cache.snapshotId ||
    record.targetId !== cache.targetId
  );
  if (targetMismatch.length > 0) {
    return {
      available: false,
      reason: "Ref cache contains refs from a different snapshot or target.",
      snapshotId: cache.snapshotId ?? null,
      targetId: cache.targetId ?? null,
      mismatchedRefs: targetMismatch.map((record) => record.ref),
    };
  }

  const activeRefs = refs.filter((record) => record.stale !== true);
  const missingBounds = activeRefs.filter((record) => !record.box);
  if (missingBounds.length > 0) {
    return {
      available: false,
      reason: "Cannot annotate screenshot because one or more refs do not include bounds.",
      snapshotId: cache.snapshotId ?? null,
      targetId: cache.targetId ?? null,
      missingRefs: missingBounds.map((record) => record.ref),
    };
  }

  if (activeRefs.length === 0) {
    return {
      available: false,
      reason: "No bounded refs are available for annotation.",
      snapshotId: cache.snapshotId ?? null,
      targetId: cache.targetId ?? null,
    };
  }

  return {
    available: true,
    labels: activeRefs.map((record, index) => ({
      ref: record.ref,
      label: record.label ?? record.text ?? record.role ?? record.ref,
      role: record.role ?? null,
      text: record.text ?? null,
      source: record.source ?? null,
      box: record.box as ScreenshotBox,
      snapshotId: cache.snapshotId,
      targetId: cache.targetId,
      index: index + 1,
    })),
  };
}

export function annotatedScreenshotArtifactPaths(
  outputPath: string,
): { labelMap: string; annotatedImage: string } {
  const ext = path.extname(outputPath);
  const base = ext ? outputPath.slice(0, -ext.length) : outputPath;
  return {
    labelMap: `${base}.labels.json`,
    annotatedImage: `${base}.annotated.svg`,
  };
}

export function annotatedScreenshotSvg(
  args: { screenshotPath: string; labels: ScreenshotLabel[] },
): string {
  const { width, height } = screenshotOverlaySize(args.labels);
  const imageHref = escapeHtml(path.basename(args.screenshotPath));
  const labelSvg = args.labels.map((label) => {
    const box = label.box;
    const textX = Math.max(0, box.x);
    const textY = Math.max(16, box.y - 6);
    const text = `${label.index}. ${label.ref}`;
    return [
      `<rect x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" fill="none" stroke="#ff3b30" stroke-width="2"/>`,
      `<rect x="${textX}" y="${textY - 15}" width="${Math.max(44, text.length * 8)}" height="18" fill="#ff3b30"/>`,
      `<text x="${textX + 4}" y="${textY - 2}" fill="#fff" font-family="Menlo, monospace" font-size="12">${escapeHtml(text)}</text>`,
    ].join("\n");
  }).join("\n");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <image href="${imageHref}" x="0" y="0" width="${width}" height="${height}" preserveAspectRatio="xMinYMin meet"/>
  ${labelSvg}
</svg>
`;
}

export function screenshotOverlaySize(labels: ScreenshotLabel[]): { width: number; height: number } {
  const maxX = Math.max(390, ...labels.map((label) => label.box.x + label.box.width + 24));
  const maxY = Math.max(844, ...labels.map((label) => label.box.y + label.box.height + 24));
  return { width: Math.ceil(maxX), height: Math.ceil(maxY) };
}

export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function clampNumber(value: unknown, min: number, max: number): number {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new Error(`Expected a finite number, got ${value}.`);
  }
  return Math.min(Math.max(number, min), max);
}

export function truncate(value: unknown, limit = MAX_OUTPUT): string {
  const text = String(value ?? "");
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}\n[truncated ${text.length - limit} characters]`;
}

export async function pathExists(
  file: string,
  deps: { access(file: string): Promise<void> },
): Promise<boolean> {
  return deps.access(file).then(() => true, () => false);
}

async function execFilePromise(
  file: string,
  args: string[],
  options: ExecOptions,
  deps: Pick<ScreenshotCaptureDependencies, "execFile"> = {},
): Promise<ExecResult> {
  if (deps.execFile) return deps.execFile(file, args, options);
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout: options.timeout, maxBuffer: options.maxBuffer ?? MAX_OUTPUT }, (
      error: unknown,
      stdout: unknown,
      stderr: unknown,
    ) => {
      if (error && options.rejectOnError !== false) {
        reject(error);
        return;
      }
      const execError = error as (Error & { code?: number | string | null; signal?: string | null }) | null;
      resolve({
        stdout: String(stdout ?? ""),
        stderr: String(stderr ?? ""),
        error: execError ? { message: execError.message, code: execError.code, signal: execError.signal } : null,
      });
    });
  });
}

async function commandPath(command: string, deps: ScreenshotCaptureDependencies): Promise<string | null> {
  if (deps.commandPath) return deps.commandPath(command);
  const result = await execFilePromise("sh", ["-lc", `command -v ${command}`], {
    timeout: 5_000,
    rejectOnError: false,
  }, deps);
  return String(result.stdout ?? "").trim() || null;
}

async function resolveIosDevice(requested: string | undefined, deps: ScreenshotCaptureDependencies): Promise<IosDevice> {
  if (deps.resolveIosDevice) return deps.resolveIosDevice(requested, { preferBooted: true });
  if (requested && /^[0-9A-Fa-f-]{20,}$/.test(requested)) {
    return { udid: requested, name: requested, state: "unknown" };
  }
  const { stdout } = await execFilePromise("xcrun", ["simctl", "list", "devices", "available", "--json"], {
    timeout: 20_000,
    maxBuffer: 4 * 1024 * 1024,
  }, deps);
  const parsed = JSON.parse(String(stdout ?? "{}")) as {
    devices?: Record<string, Array<Omit<IosDevice, "runtime">>>;
  };
  const devices = Object.entries(parsed.devices ?? {}).flatMap(([runtime, runtimeDevices]) =>
    runtimeDevices.map((device) => ({ ...device, runtime })),
  );
  if (requested) {
    const exact = devices.find((device) => device.udid === requested || device.name === requested);
    if (exact) return exact;
    const partial = devices.find((device) => device.name.toLowerCase().includes(requested.toLowerCase()));
    if (partial) return partial;
    throw new Error(`No available iOS simulator matched: ${requested}`);
  }
  const booted = devices.find((device) => device.state === "Booted");
  if (booted) return booted;
  const iphone = [...devices].reverse().find((device) => /iPhone/.test(device.name));
  if (iphone) return iphone;
  if (devices[0]) return devices[0];
  throw new Error("No available iOS simulators found.");
}

async function adbScreenshot(device: string | undefined, outputPath: string, deps: ScreenshotCaptureDependencies): Promise<void> {
  if (deps.adbScreenshot) return deps.adbScreenshot(device, outputPath);
  const args = device ? ["-s", device, "exec-out", "screencap", "-p"] : ["exec-out", "screencap", "-p"];
  await new Promise<void>((resolve, reject) => {
    const child = spawnProcess("adb", args, deps);
    let stderr = "";
    const chunks: Uint8Array[] = [];
    let byteLength = 0;
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("adb screenshot timed out after 30000ms"));
    }, 30_000);
    child.stdout.on("data", (chunk: Uint8Array) => {
      chunks.push(chunk);
      byteLength += chunk.byteLength;
    });
    child.stderr.setEncoding?.("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (error: Error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code: number | null) => {
      clearTimeout(timer);
      if (code === 0) {
        fs.writeFile(outputPath, Buffer.concat(chunks, byteLength)).then(resolve, reject);
      } else {
        reject(new Error(`adb screenshot failed with code ${code}: ${stderr}`));
      }
    });
  });
}

function spawnProcess(file: string, args: string[], deps: ScreenshotCaptureDependencies): SpawnedProcess {
  if (deps.spawnProcess) return deps.spawnProcess(file, args, { stdio: ["ignore", "pipe", "pipe"] });
  return spawn(file, args, { stdio: ["ignore", "pipe", "pipe"] });
}

async function defaultPathExists(file: string, deps: ScreenshotCaptureDependencies): Promise<boolean> {
  if (deps.pathExists) return deps.pathExists(file);
  return pathExists(file, { access: fs.access });
}

async function mkdir(directory: string, deps: ScreenshotCaptureDependencies): Promise<void> {
  if (deps.mkdir) return deps.mkdir(directory, { recursive: true });
  await fs.mkdir(directory, { recursive: true });
}

async function readLatestRefCache(
  args: ScreenshotCaptureArgs,
  deps: ScreenshotCaptureDependencies,
): Promise<ScreenshotRefCache | null> {
  if (deps.readLatestRefCache) return deps.readLatestRefCache(args);
  const stateRoot = resolveExpoStateRoot(args);
  const session = await readLatestSession(stateRoot, deps);
  if (!session?.lastSnapshotId || typeof session.sessionId !== "string") return null;
  return readJsonFile(path.join(stateRoot, "sessions", session.sessionId, "refs.json"), deps)
    .then((value) => asRecord(value) as ScreenshotRefCache)
    .catch(() => null);
}

async function writeJsonFile(file: string, value: unknown, deps: ScreenshotCaptureDependencies): Promise<void> {
  if (deps.writeJsonFile) return deps.writeJsonFile(file, value);
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function writeFile(
  file: string,
  contents: string,
  encoding: "utf8",
  deps: ScreenshotCaptureDependencies,
): Promise<void> {
  if (deps.writeFile) return deps.writeFile(file, contents, encoding);
  await fs.writeFile(file, contents, encoding);
}

async function wait(ms: number, deps: ScreenshotCaptureDependencies): Promise<void> {
  if (deps.wait) return deps.wait(ms);
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function safeTimestamp(deps: ScreenshotCaptureDependencies): string {
  return (deps.nowIso?.() ?? new Date().toISOString()).replace(/[:.]/g, "-");
}

function isUnavailable(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && (value as { available?: unknown }).available === false);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function resolveExpoStateRoot(args: { cwd?: string; root?: string; stateDir?: string } = {}): string {
  if (args.stateDir) {
    const resolved = path.resolve(args.stateDir);
    return path.basename(resolved) === "runs" ? path.dirname(resolved) : resolved;
  }
  const root = path.resolve(args.root ?? args.cwd ?? process.env.PWD ?? ".");
  return path.join(root, ".scratch", "expo98");
}

async function readLatestSession(
  stateRoot: string,
  deps: ScreenshotCaptureDependencies,
): Promise<Record<string, unknown> | null> {
  const sessionsRoot = path.join(stateRoot, "sessions");
  const entries = await readDir(sessionsRoot, deps).catch(() => []);
  const sessions: Array<Record<string, unknown>> = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const record = await readJsonFile(path.join(sessionsRoot, entry.name, "session.json"), deps).catch(() => null);
    if (record) sessions.push(asRecord(record));
  }
  sessions.sort((a, b) => String(b.updatedAt ?? b.createdAt).localeCompare(String(a.updatedAt ?? a.createdAt)));
  return sessions[0] ?? null;
}

async function readDir(
  directory: string,
  deps: ScreenshotCaptureDependencies,
): Promise<Array<{ name: string; isDirectory(): boolean }>> {
  if (deps.readDir) return deps.readDir(directory, { withFileTypes: true });
  return fs.readdir(directory, { withFileTypes: true });
}

async function readJsonFile(file: string, deps: ScreenshotCaptureDependencies): Promise<unknown> {
  if (deps.readJsonFile) return deps.readJsonFile(file);
  return JSON.parse(await fs.readFile(file, "utf8"));
}
