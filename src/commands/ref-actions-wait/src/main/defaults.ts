import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { resolveExpoStateRoot } from "../../../../state/session-run-records/src/main/paths.js";
import type { RefActionDependencies, RefCache } from "./domain.js";
import { planRefActionWithDeps } from "./planning.js";

type SessionRecord = {
  sessionId?: string;
  lastSnapshotId?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

export const defaultRefActionDependencies: RefActionDependencies = {
  readLatestRefCache,
  planFinderAction: (args) => planRefActionWithDeps(args, defaultRefActionDependencies),
};

async function readLatestRefCache(args: Record<string, unknown> = {}): Promise<RefCache | null> {
  const stateRoot = resolveExpoStateRoot(
    args as { cwd?: string; root?: string; stateDir?: string; stateRoot?: string },
  );
  const session = await readLatestSession(stateRoot);
  if (!session?.sessionId || !session.lastSnapshotId) return null;
  try {
    return await readJson(join(stateRoot, "sessions", session.sessionId, "refs.json"));
  } catch {
    return null;
  }
}

async function readLatestSession(stateRoot: string): Promise<SessionRecord | null> {
  const sessionsRoot = join(stateRoot, "sessions");
  const entries = await readdir(sessionsRoot, { withFileTypes: true }).catch(() => []);
  const sessions: SessionRecord[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const session = await readJson(join(sessionsRoot, entry.name, "session.json")).catch(
      () => null,
    );
    if (session && typeof session === "object") sessions.push(session as SessionRecord);
  }
  sessions.sort((left, right) =>
    String(right.updatedAt ?? right.createdAt ?? "").localeCompare(
      String(left.updatedAt ?? left.createdAt ?? ""),
    ),
  );
  return sessions[0] ?? null;
}

async function readJson(path: string): Promise<any> {
  return JSON.parse(await readFile(path, "utf8"));
}
