import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import type { RefCache, RefCommandDependencies, RefRecord } from "./domain.js";
import { resolveExpoStateRoot } from "../../../../state/session-run-records/src/main/paths.js";

export async function refsCommand(
  args: { stateRoot?: string; cwd?: string; root?: string; stateDir?: string } = {},
  deps: RefCommandDependencies = defaultRefCommandDependencies,
): Promise<({ available: true } & RefCache) | { available: false; reason: string }> {
  const cache = await readLatestRefCache(resolveStateRoot(args), deps);
  if (!cache) {
    return { available: false, reason: "No snapshot exists for the current session." };
  }
  return { available: true, ...cache };
}

export async function getRefCommand(
  args: { stateRoot?: string; cwd?: string; root?: string; stateDir?: string; ref: string; field: string },
  deps: RefCommandDependencies = defaultRefCommandDependencies,
): Promise<{ available?: false; reason?: string; ref?: string } | { ref: string; field: string; stale: boolean; value: unknown }> {
  const field = requireString(args.field, "field");
  const ref = requireString(args.ref, "ref");
  if (!/^@e\d+$/.test(ref)) {
    return { available: false, reason: "Ref must look like @e1.", ref };
  }

  const cache = await readLatestRefCache(resolveStateRoot(args), deps);
  if (!cache) {
    return { available: false, reason: "No snapshot exists for the current session." };
  }

  const record = cache.refs.find((item) => item.ref === ref);
  if (!record) {
    return { available: false, reason: "Ref not found in the latest snapshot.", ref };
  }

  return {
    ref,
    field,
    stale: record.stale,
    value: refFieldValue(record, field),
  };
}

const defaultRefCommandDependencies: RefCommandDependencies = {
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
  readJsonFile: readJson,
};

function resolveStateRoot(args: { stateRoot?: string; cwd?: string; root?: string; stateDir?: string }): string {
  return args.stateRoot ?? resolveExpoStateRoot(args);
}

async function readJson(file: string): Promise<any> {
  return JSON.parse(await readFile(file, "utf8"));
}

export function refFieldValue(record: RefRecord, field: string): unknown {
  switch (field) {
    case "text":
      return record.text ?? record.label ?? null;
    case "props":
      return {
        role: record.role,
        label: record.label,
        placeholder: record.placeholder,
        testID: record.testID,
        nativeID: record.nativeID,
        component: record.component,
        actions: record.actions,
      };
    case "box":
      return record.box;
    case "style":
      return null;
    case "source":
      return record.source;
    default:
      throw new Error(`Unknown ref field: ${field}`);
  }
}

async function readLatestRefCache(stateRoot: string, deps: RefCommandDependencies): Promise<RefCache | null> {
  const session = await deps.readLatestSession(stateRoot);
  if (!session?.lastSnapshotId) {
    return null;
  }
  try {
    return await deps.readJsonFile(`${stateRoot}/sessions/${session.sessionId}/refs.json`);
  } catch {
    return null;
  }
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${name} is required.`);
  }
  return value.trim();
}
