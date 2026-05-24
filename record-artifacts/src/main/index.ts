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

const RECORD_LIMITATION = "This tracer-bullet command records metadata; native video capture is implemented by a later adapter.";

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
  if (action === "start") {
    const metadata = {
      available: true,
      action,
      startedAt: now(deps).toISOString(),
      sessionId: session?.sessionId ?? null,
      targetId: session?.activeTargetId ?? null,
      status: "recording",
      limitations: [RECORD_LIMITATION],
    };
    await writeJsonFile(metadataPath, metadata);
    return toolJson({ ...metadata, metadataPath });
  }
  const outputPath = resolve(String(args.outputPath ?? positionals[1] ?? join(recordDir, `recording-${isoStamp(deps)}.mov`)));
  await mkdir(dirname(outputPath), { recursive: true });
  if (!(await pathExists(outputPath))) await writeFile(outputPath, "recording placeholder\n", "utf8");
  const metadata = {
    available: true,
    action,
    stoppedAt: now(deps).toISOString(),
    sessionId: session?.sessionId ?? null,
    targetId: session?.activeTargetId ?? null,
    outputPath,
    metadataPath,
    status: "stopped",
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
  return join(root, ".scratch", "expo-ios");
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
