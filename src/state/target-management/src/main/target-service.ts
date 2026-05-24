import { execFile as nodeExecFile } from "node:child_process";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  resolveExpoStateRoot,
  sessionDirectory,
  sessionJsonPath,
} from "../../../session-run-records/src/main/paths.js";
import { discoverTargets } from "./discovery.js";
import { normalizeSimulatorDevices } from "./discovery.js";
import type {
  TargetCommandArgs,
  TargetCommandResult,
  TargetCurrentResult,
  TargetDependencies,
  TargetListResult,
  TargetRecord,
  TargetUnavailableResult,
} from "./domain.js";
import { requireString } from "./validation.js";

/**
 * RULE-009: lists current target candidates and annotates a selected target
 * when a session already has one.
 */
export async function listTargets(
  args: Pick<TargetCommandArgs, "platform" | "metroPort" | "stateRoot">,
  deps: TargetDependencies = defaultTargetDependencies,
): Promise<TargetListResult> {
  const session = await deps.readLatestSession(args.stateRoot);
  const targets = await discoverTargets(
    { ...args, selectedTargetId: session?.activeTargetId ?? null },
    deps,
  );
  return { available: targets.length > 0, targets };
}

export async function selectTarget(
  args: Pick<TargetCommandArgs, "targetId" | "platform" | "metroPort" | "stateRoot" | "now">,
  deps: TargetDependencies = defaultTargetDependencies,
): Promise<TargetRecord | TargetUnavailableResult> {
  const session = await deps.readLatestSession(args.stateRoot);
  if (!session) {
    return {
      available: false,
      reason: "No session exists. Run `expo98 --json session new review` first.",
    };
  }

  const targetId = requireString(args.targetId, "targetId");
  const targets = await discoverTargets(
    { ...args, selectedTargetId: session.activeTargetId },
    deps,
  );
  const target = targets.find((item) => item.targetId === targetId);
  if (!target) {
    return { available: false, reason: "Target not found.", targetId, targets };
  }
  const selected: TargetRecord = { ...target, selected: true, stale: false };
  await deps.updateSessionRecord(args.stateRoot, {
    ...session,
    activeTargetId: selected.targetId,
    updatedAt: (args.now ?? (() => new Date()))().toISOString(),
  });
  await deps.writePersistedTarget(args.stateRoot, session.sessionId, selected);
  return selected;
}

/**
 * RULE-009/RULE-010: returns the current selected target when rediscovered,
 * otherwise a stable unavailable payload that downstream snapshot capture can
 * use as its precondition.
 */
export async function getCurrentTarget(
  args: Pick<TargetCommandArgs, "platform" | "metroPort" | "stateRoot">,
  deps: TargetDependencies = defaultTargetDependencies,
): Promise<TargetCurrentResult> {
  const session = await deps.readLatestSession(args.stateRoot);
  if (!session) {
    return {
      available: false,
      reason: "No session exists. Run `expo98 --json session new review` first.",
    };
  }

  if (!session.activeTargetId) {
    return {
      available: false,
      reason: "No target selected for the current session.",
      sessionId: session.sessionId,
    };
  }

  const targets = await discoverTargets(
    { ...args, selectedTargetId: session.activeTargetId },
    deps,
  );
  const current = targets.find((item) => item.targetId === session.activeTargetId);
  if (current) {
    return {
      available: true,
      sessionId: session.sessionId,
      target: { ...current, selected: true, stale: false },
    };
  }

  const persisted = await deps
    .readPersistedTarget(args.stateRoot, session.sessionId)
    .catch(() => null);
  return {
    available: false,
    reason: "Selected target is stale.",
    sessionId: session.sessionId,
    target: persisted
      ? { ...persisted, selected: true, stale: true }
      : { targetId: session.activeTargetId, selected: true, stale: true },
  };
}

/**
 * Compatibility facade for the legacy CLI command switch.
 */
export async function targetCommand(
  args: TargetCommandArgs,
  deps: TargetDependencies = defaultTargetDependencies,
): Promise<TargetCommandResult> {
  const effectiveArgs = {
    ...args,
    stateRoot:
      args.stateRoot ?? resolveExpoStateRoot(args as unknown as Record<string, string | null>),
  };
  const action = requireString(args.action ?? "list", "action");
  if (!["list", "select", "current"].includes(action)) {
    throw new Error(`Unknown target action: ${action}`);
  }

  if (action === "list") {
    return listTargets(effectiveArgs, deps);
  }
  if (action === "select") {
    return selectTarget(effectiveArgs, deps);
  }
  return getCurrentTarget(effectiveArgs, deps);
}

const defaultTargetDependencies: TargetDependencies = {
  readLatestSession: async (stateRoot) => {
    const sessionsRoot = join(stateRoot, "sessions");
    const entries = await readdir(sessionsRoot, { withFileTypes: true }).catch(() => []);
    const sessions = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const record = await readJson(join(sessionsRoot, entry.name, "session.json")).catch(
        () => null,
      );
      if (record) sessions.push(record as any);
    }
    sessions.sort((left, right) =>
      String(right.updatedAt ?? right.createdAt).localeCompare(
        String(left.updatedAt ?? left.createdAt),
      ),
    );
    return sessions[0] ?? null;
  },
  updateSessionRecord: async (stateRoot, record) => {
    await mkdir(sessionDirectory(stateRoot, record.sessionId), { recursive: true });
    await writeJson(sessionJsonPath(stateRoot, record.sessionId), record);
    return record;
  },
  readPersistedTarget: async (stateRoot, sessionId) => {
    return readJson(join(sessionDirectory(stateRoot, sessionId), "target.json")).catch(
      () => null,
    ) as Promise<TargetRecord | null>;
  },
  writePersistedTarget: async (stateRoot, sessionId, target) => {
    await mkdir(sessionDirectory(stateRoot, sessionId), { recursive: true });
    await writeJson(join(sessionDirectory(stateRoot, sessionId), "target.json"), target);
  },
  listIosSimulatorTargets: async () => {
    const result = await execFile("xcrun", ["simctl", "list", "devices", "available", "--json"], {
      timeout: 20_000,
    });
    const parsed = JSON.parse(result.stdout || "{}") as {
      devices?: Record<string, Array<Record<string, unknown>>>;
    };
    return normalizeSimulatorDevices(Object.values(parsed.devices ?? {}).flat());
  },
  fetchMetroTargets: async (port) => {
    const response = await fetch(`http://localhost:${port}/json/list`);
    if (!response.ok) return [];
    return response.json();
  },
};

async function execFile(
  file: string,
  args: string[],
  options: { timeout: number },
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    nodeExecFile(
      file,
      args,
      { timeout: options.timeout, maxBuffer: 4 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          Object.assign(error, { stdout, stderr });
          reject(error);
          return;
        }
        resolve({ stdout: String(stdout ?? ""), stderr: String(stderr ?? "") });
      },
    );
  });
}

async function readJson(file: string): Promise<any> {
  return JSON.parse(await readFile(file, "utf8"));
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
