import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import {
  toolJson,
  type ToolTextResult,
} from "../../../../core/tool-json-envelope/src/main/index.ts";

export interface StateRootArgs extends Record<string, unknown> {
  stateDir?: string | null;
  root?: string | null;
  cwd?: string | null;
}

export interface DashboardSession {
  sessionId: unknown;
  name: unknown;
  activeTargetId: unknown;
  lastSnapshotId: unknown;
  updatedAt: unknown;
  path: string;
}

const DASHBOARD_LIMITATION =
  "The dashboard command records a local static observability view; it does not expose network access unless a future server adapter is added.";

export async function dashboardCommand(
  args: Record<string, unknown> = {},
): Promise<ToolTextResult> {
  const positionals = Array.isArray(args._) ? args._ : [];
  const action = requireString(args.action ?? positionals[0] ?? "status", "action");
  if (!["start", "status", "stop"].includes(action))
    throw new Error(`Unknown dashboard action: ${action}`);
  const stateRoot = resolveExpoStateRoot(args);
  const dashboardDir = join(stateRoot, "dashboard");
  const statePath = join(dashboardDir, "dashboard-state.json");
  await mkdir(dashboardDir, { recursive: true });
  const previous = asRecord(await readJsonFile(statePath).catch(() => null));
  const previousArtifacts = asRecord(previous?.artifacts);
  const status =
    action === "start"
      ? "running"
      : action === "stop"
        ? "stopped"
        : (previous?.status ?? "stopped");
  const payload = {
    available: true,
    action,
    status,
    port: clampNumber(args.port ?? previous?.port ?? 0, 0, 65535),
    stateRoot,
    sessions: await dashboardSessions(stateRoot),
    artifacts: {
      json: resolve(
        String(args.outputPath ?? previousArtifacts?.json ?? join(dashboardDir, "dashboard.json")),
      ),
      html: String(previousArtifacts?.html ?? join(dashboardDir, "index.html")),
    },
    limitations: [DASHBOARD_LIMITATION],
  };
  await writeDashboardHtml(payload.artifacts.html, payload);
  await writeJsonFile(payload.artifacts.json, payload);
  await writeJsonFile(statePath, payload);
  return toolJson(payload);
}

export async function dashboardSessions(stateRoot: string): Promise<DashboardSession[]> {
  const sessionsDir = join(stateRoot, "sessions");
  const names = await readdir(sessionsDir).catch(() => []);
  const sessions: DashboardSession[] = [];
  for (const name of names.sort()) {
    const sessionPath = join(sessionsDir, name, "session.json");
    const session = asRecord(await readJsonFile(sessionPath).catch(() => null));
    if (session) {
      sessions.push({
        sessionId: session.sessionId ?? name,
        name: session.name ?? null,
        activeTargetId: session.activeTargetId ?? null,
        lastSnapshotId: session.lastSnapshotId ?? null,
        updatedAt: session.updatedAt ?? session.createdAt ?? null,
        path: sessionPath,
      });
    }
  }
  return sessions;
}

export async function writeDashboardHtml(
  file: string,
  payload: { status: unknown; sessions: unknown[] },
): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(
    file,
    `<!doctype html>
<html>
<head><meta charset="utf-8"><title>expo98 dashboard</title></head>
<body>
<h1>expo98 dashboard</h1>
<p>Status: ${escapeHtml(payload.status)}</p>
<p>Sessions: ${payload.sessions.length}</p>
<pre>${escapeHtml(JSON.stringify(payload.sessions, null, 2))}</pre>
</body>
</html>
`,
    "utf8",
  );
}

export function resolveExpoStateRoot(args: StateRootArgs = {}): string {
  if (args.stateDir) {
    const resolved = resolve(args.stateDir);
    return basename(resolved) === "runs" ? resolve(join(resolved, "..")) : resolved;
  }
  const root = resolve(args.root ?? args.cwd ?? process.cwd());
  return join(root, ".scratch", "expo98");
}

export async function readJsonFile(file: string): Promise<unknown> {
  return JSON.parse(await readFile(file, "utf8"));
}

export async function writeJsonFile(file: string, value: unknown): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
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
  if (!Number.isFinite(number)) throw new Error(`Expected a finite number, got ${String(value)}.`);
  return Math.min(Math.max(number, min), max);
}

export function requireString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0)
    throw new Error(`${name} must be a non-empty string.`);
  return value.trim();
}

function asRecord(value: unknown): Record<string, any> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, any>)
    : null;
}
