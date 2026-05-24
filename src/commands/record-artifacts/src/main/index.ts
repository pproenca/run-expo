import { spawn } from "node:child_process";
import { access, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

export interface ToolTextResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

export interface RecordCommandDependencies {
  now?: () => Date;
}

export interface StateRootArgs extends Record<string, unknown> {
  stateDir?: string | null;
  root?: string | null;
  cwd?: string | null;
}

const RECORD_LIMITATION = "Simulator video capture uses xcrun simctl io recordVideo and requires a booted iOS simulator.";

export function toolJson(value: unknown): ToolTextResult {
  return { content: [{ type: "text", text: `${JSON.stringify(value, null, 2)}\n` }] };
}

export async function recordCommand(
  args: Record<string, unknown> = {},
  deps: RecordCommandDependencies = {},
): Promise<ToolTextResult> {
  const positionals = Array.isArray(args._) ? args._ : [];
  const action = requireString(args.action ?? positionals[0] ?? "start", "action");
  if (!["start", "stop"].includes(action)) throw new Error(`Unknown record action: ${action}`);
  const stateRoot = resolveExpoStateRoot(args);
  const session = asRecord(await readLatestSession(stateRoot));
  const recordDir = join(stateRoot, "artifacts", "recordings");
  await mkdir(recordDir, { recursive: true });
  const metadataPath = runRecordMetadataPath(stateRoot);
  const defaultOutputPath = join(recordDir, `recording-${isoStamp(deps)}.mov`);
  const outputPath = resolve(String(args.outputPath ?? positionals[1] ?? defaultOutputPath));
  if (action === "start") {
    await mkdir(dirname(outputPath), { recursive: true });
    const device = typeof args.device === "string" && args.device.trim() ? args.device.trim() : "booted";
    const child = spawn("xcrun", ["simctl", "io", device, "recordVideo", outputPath], {
      detached: true,
      stdio: "ignore",
    });
    child.unref();
    const metadata = {
      available: true,
      action,
      startedAt: now(deps).toISOString(),
      sessionId: session?.sessionId ?? null,
      targetId: session?.activeTargetId ?? null,
      outputPath,
      status: "recording",
      pid: child.pid ?? null,
      command: ["xcrun", "simctl", "io", device, "recordVideo", outputPath],
      limitations: [RECORD_LIMITATION],
    };
    await writeJsonFile(metadataPath, metadata);
    return toolJson({ ...metadata, metadataPath });
  }
  const previous = asRecord(await readJsonFile(metadataPath).catch(() => null));
  const previousPid = Number(previous?.pid);
  if (Number.isInteger(previousPid) && previousPid > 0) {
    try {
      process.kill(previousPid, "SIGINT");
    } catch {}
  }
  const finalOutputPath = resolve(String(args.outputPath ?? previous?.outputPath ?? outputPath));
  await waitForPath(finalOutputPath, 3000);
  const metadata = {
    available: true,
    action,
    stoppedAt: now(deps).toISOString(),
    sessionId: session?.sessionId ?? null,
    targetId: session?.activeTargetId ?? null,
    outputPath: finalOutputPath,
    metadataPath,
    status: "stopped",
    pid: Number.isInteger(previousPid) && previousPid > 0 ? previousPid : null,
    fileExists: await pathExists(finalOutputPath),
  };
  await writeJsonFile(metadataPath, metadata);
  return toolJson(metadata);
}

export function runRecordMetadataPath(stateRoot: string): string {
  return join(stateRoot, "artifacts", "recordings", "recording.json");
}

export async function readLatestSession(stateRoot: string): Promise<unknown | null> {
  const sessionsRoot = join(stateRoot, "sessions");
  const entries = await readdir(sessionsRoot, { withFileTypes: true }).catch(() => []);
  const sessions = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const record = await readJsonFile(join(sessionsRoot, entry.name, "session.json")).catch(() => null);
    if (record) sessions.push(record);
  }
  sessions.sort((a, b) => String(asRecord(b)?.updatedAt ?? asRecord(b)?.createdAt).localeCompare(String(asRecord(a)?.updatedAt ?? asRecord(a)?.createdAt)));
  return sessions[0] ?? null;
}

export function resolveExpoStateRoot(args: StateRootArgs = {}): string {
  if (args.stateDir) {
    const resolved = resolve(args.stateDir);
    return basename(resolved) === "runs" ? resolve(join(resolved, "..")) : resolved;
  }
  const root = resolve(args.root ?? args.cwd ?? process.cwd());
  return join(root, ".scratch", "expo98");
}

export function sessionDirectory(stateRoot: string, sessionId: string): string {
  return join(stateRoot, "sessions", sessionId);
}

export async function readJsonFile(file: string): Promise<unknown> {
  return JSON.parse(await readFile(file, "utf8"));
}

export async function writeJsonFile(file: string, value: unknown): Promise<void> {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function pathExists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

export async function waitForPath(file: string, timeoutMs: number): Promise<boolean> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await pathExists(file)) return true;
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  return pathExists(file);
}

export function requireString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${name} must be a non-empty string.`);
  return value.trim();
}

function isoStamp(deps: RecordCommandDependencies): string {
  return now(deps).toISOString().replace(/[:.]/g, "-");
}

function now(deps: RecordCommandDependencies): Date {
  return deps.now ? deps.now() : new Date();
}

function asRecord(value: unknown): Record<string, any> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : null;
}
