import { execFile as nodeExecFile } from "node:child_process";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { SnapshotArgs, SnapshotCommandDependencies, SnapshotResult } from "./domain.js";
import { buildSnapshotFilters } from "./filters.js";
import { persistNativeSnapshot, persistSemanticSnapshot } from "./persistence.js";
import { randomBase36Suffix } from "../../../session-run-records/src/main/ids.js";
import { resolveExpoStateRoot, sessionDirectory, sessionJsonPath } from "../../../session-run-records/src/main/paths.js";

export async function snapshotCommand(
  args: SnapshotArgs = {},
  deps: SnapshotCommandDependencies = defaultSnapshotDependencies,
): Promise<SnapshotResult | { available: false; [key: string]: unknown }> {
  const stateRoot = args.stateRoot ?? resolveExpoStateRoot(args as Record<string, string | null>);
  const session = await deps.readLatestSession(stateRoot);
  if (!session) {
    return {
      available: false,
      reason: "No session exists. Run `expo-ios --json session new review` first.",
    };
  }
  if (!session.activeTargetId) {
    return {
      available: false,
      reason: "No target selected for the current session.",
      sessionId: session.sessionId,
    };
  }

  const target = await deps.readSelectedTarget(stateRoot, session);
  if (!target?.device?.id) {
    return {
      available: false,
      reason: "Selected target metadata is missing.",
      targetId: session.activeTargetId,
    };
  }

  const filters = buildSnapshotFilters(args);
  const semanticBridge = await deps.captureSemanticBridge(args, { stateRoot, session, filters }).catch((error: unknown) => ({
    available: false as const,
    source: "plugin-bridge-semantic",
    code: "transport-failure",
    reason: formatError(error),
  }));
  if (semanticBridge.available === true) {
    return persistSemanticSnapshot({ stateRoot, session, filters, semanticBridge }, deps);
  }

  const axe = await deps.findAxeCli();
  if (!axe) {
    return {
      available: false,
      reason: "axe CLI is not installed or not on PATH.",
      targetId: session.activeTargetId,
      semanticBridge,
    };
  }

  const result = await deps.describeNativeUi(axe, target.device.id);
  if (result.error) {
    return {
      available: false,
      reason: "Native accessibility snapshot failed.",
      targetId: session.activeTargetId,
      stderr: truncate(result.stderr),
      error: result.error,
      semanticBridge,
    };
  }

  return persistNativeSnapshot({
    stateRoot,
    session,
    filters,
    semanticBridge,
    accessibilityTree: JSON.parse(result.stdout || "[]"),
  }, deps);
}

const defaultSnapshotDependencies: SnapshotCommandDependencies = {
  now: () => new Date(),
  randomSuffix: randomBase36Suffix,
  ensureDirectory: (path) => mkdir(path, { recursive: true }),
  writeJsonFile: writeJson,
  updateSessionRecord: async (stateRoot, record) => {
    await mkdir(sessionDirectory(stateRoot, record.sessionId), { recursive: true });
    await writeJson(sessionJsonPath(stateRoot, record.sessionId), record);
    return record;
  },
  readLatestSession: async (stateRoot) => {
    const sessionsRoot = join(stateRoot, "sessions");
    const entries = await readdir(sessionsRoot, { withFileTypes: true }).catch(() => []);
    const sessions = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const record = await readJson(join(sessionsRoot, entry.name, "session.json")).catch(() => null);
      if (record) sessions.push(record as any);
    }
    sessions.sort((left, right) => String(right.updatedAt ?? right.createdAt).localeCompare(String(left.updatedAt ?? left.createdAt)));
    return sessions[0] ?? null;
  },
  readSelectedTarget: async (stateRoot, session) => {
    return readJson(join(sessionDirectory(stateRoot, session.sessionId), "target.json")).catch(() => null);
  },
  captureSemanticBridge: async (args) => ({
    available: false,
    source: "plugin-bridge-semantic",
    code: "no-runtime-target",
    reason: "Semantic bridge adapter is not configured.",
    metroPort: args.metroPort ?? 8081,
  }),
  findAxeCli: () => commandPath("axe"),
  describeNativeUi: (axePath, deviceId) => execFile(axePath, ["describe-ui", "--udid", deviceId], { timeout: 12_000 }),
};

function commandPath(command: string): Promise<string | null> {
  return new Promise((resolve) => {
    nodeExecFile("which", [command], { timeout: 5000 }, (error, stdout) => {
      resolve(error ? null : String(stdout ?? "").trim() || null);
    });
  });
}

function execFile(
  file: string,
  args: string[],
  options: { timeout: number },
): Promise<{ stdout: string; stderr: string; error?: unknown }> {
  return new Promise((resolve) => {
    nodeExecFile(file, args, { timeout: options.timeout, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
      resolve({
        stdout: String(stdout ?? ""),
        stderr: String(stderr ?? ""),
        error: error ? { message: error.message, code: error.code, signal: error.signal } : undefined,
      });
    });
  });
}

async function readJson(file: string): Promise<any> {
  return JSON.parse(await readFile(file, "utf8"));
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function formatError(error: unknown): string {
  if (!error) {
    return "Unknown error";
  }
  const record = error as { message?: unknown; stdout?: unknown; stderr?: unknown };
  const parts = [record.message ?? String(error)];
  if (record.stdout) parts.push(`stdout:\n${truncate(record.stdout)}`);
  if (record.stderr) parts.push(`stderr:\n${truncate(record.stderr)}`);
  return parts.join("\n\n");
}

function truncate(value: unknown, limit = 4_000): string {
  const text = String(value ?? "");
  return text.length <= limit ? text : `${text.slice(0, limit)}\n[truncated ${text.length - limit} characters]`;
}
