import { mkdir, readdir, rm } from "node:fs/promises";
import { join } from "node:path";

import { toolJson } from "../../../../core/tool-json-envelope/src/main/index.ts";
import type { CleanSessionsResult, Clock, RandomSuffix, SessionActionResult, SessionRecord, ToolTextResult } from "./domain.js";
import { createSessionId, randomBase36Suffix, systemClock } from "./ids.js";
import { readJsonFile, writeJsonFile } from "./json-store.js";
import { resolveExpoStateRoot, sessionDirectory, sessionJsonPath } from "./paths.js";
import { requireOptionalString, requireString } from "./validation.js";

export { toolJson };

export interface SessionCommandDependencies {
  now?: Clock;
  randomSuffix?: RandomSuffix;
}

export async function sessionCommand(
  args: Record<string, unknown> = {},
  deps: SessionCommandDependencies = {},
): Promise<ToolTextResult> {
  const action = requireString(args.action ?? "new", "action");
  if (!["new", "list", "show", "close", "clean"].includes(action)) {
    throw new Error(`Unknown session action: ${action}`);
  }
  const stateRoot = resolveExpoStateRoot(args);
  if (action === "list") {
    return toolJson({ available: true, action, stateRoot, sessions: await listSessions(stateRoot) });
  }
  if (action === "show") {
    return toolJson(await showSession({ stateRoot, name: requireOptionalString(args.name) }));
  }
  if (action === "close") {
    return toolJson(await closeSession({ stateRoot, name: requireOptionalString(args.name), now: deps.now }));
  }
  if (action === "clean") {
    return toolJson(await cleanSessions({ stateRoot, olderThan: requireOptionalString(args.olderThan) ?? undefined, now: deps.now }));
  }
  return toolJson(await createSession({
    stateRoot,
    name: requireOptionalString(args.name) ?? undefined,
    now: deps.now,
    randomSuffix: deps.randomSuffix,
  }));
}

export function parseDurationMs(value: unknown): number {
  const match = /^(\d+)([smhd])$/.exec(String(value));
  if (!match) {
    throw new Error("duration must look like 30s, 2m, 1h, or 7d.");
  }
  const amount = Number(match[1]);
  const unit = match[2] as "s" | "m" | "h" | "d";
  return amount * ({ s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[unit]);
}

export function normalizeSessionName(value: unknown): string {
  const name = requireString(value, "name")
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!name) {
    throw new Error("name must include at least one letter or number.");
  }
  return name.slice(0, 48);
}

/**
 * RULE-013/RULE-018: creates an isolated session artifact namespace and writes
 * the canonical `session.json` record.
 */
export async function createSession(input: {
  stateRoot: string;
  name?: string;
  now?: Clock;
  randomSuffix?: RandomSuffix;
}): Promise<SessionRecord> {
  const name = normalizeSessionName(input.name ?? "review");
  const now = input.now ?? systemClock;
  const created = now();
  const createdAt = created.toISOString();
  const sessionId = createSessionId(name, created, input.randomSuffix ?? randomBase36Suffix);
  const artifactDir = join(sessionDirectory(input.stateRoot, sessionId), "artifacts");
  await mkdir(artifactDir, { recursive: true });

  const record: SessionRecord = {
    schemaVersion: 1,
    sessionId,
    name,
    artifactDir,
    createdAt,
    updatedAt: createdAt,
    activeTargetId: null,
    lastSnapshotId: null,
    sidecars: [],
  };
  await writeJsonFile(sessionJsonPath(input.stateRoot, sessionId), record);
  return record;
}

export async function listSessions(stateRoot: string): Promise<SessionRecord[]> {
  const sessionsDir = join(stateRoot, "sessions");
  const entries = await readdir(sessionsDir, { withFileTypes: true }).catch(() => []);
  const sessions: SessionRecord[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const record = await readJsonFile<SessionRecord>(join(sessionsDir, entry.name, "session.json")).catch(() => null);
    if (record) {
      sessions.push(record);
    }
  }

  return sessions.sort((left, right) => String(left.createdAt ?? "").localeCompare(String(right.createdAt ?? "")));
}

export async function showSession(input: { stateRoot: string; name?: string | null }): Promise<SessionActionResult> {
  const sessions = await listSessions(input.stateRoot);
  const requested = requireOptionalString(input.name);
  const session = requested
    ? sessions.find((item) => item.name === requested || item.sessionId === requested)
    : sessions.at(-1);

  return session
    ? { available: true, action: "show", session }
    : { available: false, action: "show", reason: "Session not found.", name: requested };
}

/**
 * RULE-013: closing a session stamps close/update time and clears sidecars.
 */
export async function closeSession(input: {
  stateRoot: string;
  name?: string | null;
  now?: Clock;
}): Promise<SessionActionResult> {
  const sessions = await listSessions(input.stateRoot);
  const requested = requireOptionalString(input.name);
  const session = requested
    ? sessions.find((item) => item.name === requested || item.sessionId === requested)
    : sessions.at(-1);

  if (!session) {
    return { available: false, action: "close", reason: "Session not found.", name: requested };
  }

  const closedAt = (input.now ?? systemClock)().toISOString();
  const closed = { ...session, closedAt, updatedAt: closedAt, sidecars: [] };
  await writeJsonFile(sessionJsonPath(input.stateRoot, session.sessionId), closed);
  return { available: true, action: "close", session: closed };
}

export async function cleanSessions(input: {
  stateRoot: string;
  olderThan?: string;
  now?: Clock;
}): Promise<CleanSessionsResult> {
  const olderThan = input.olderThan ?? "7d";
  const cutoff = (input.now ?? systemClock)().getTime() - parseDurationMs(olderThan);
  const sessions = await listSessions(input.stateRoot);
  const removed: string[] = [];

  for (const session of sessions) {
    const created = Date.parse(session.createdAt ?? session.updatedAt ?? "0");
    if (Number.isFinite(created) && created < cutoff) {
      await rm(sessionDirectory(input.stateRoot, session.sessionId), { recursive: true, force: true });
      removed.push(session.sessionId);
    }
  }

  return { available: true, action: "clean", stateRoot: input.stateRoot, olderThan, removed };
}

export async function readLatestSession(stateRoot: string): Promise<SessionRecord | null> {
  const sessionsDir = join(stateRoot, "sessions");
  const entries = await readdir(sessionsDir, { withFileTypes: true }).catch(() => []);
  const sessions: SessionRecord[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const record = await readJsonFile<SessionRecord>(join(sessionsDir, entry.name, "session.json")).catch(() => null);
    if (record) {
      sessions.push(record);
    }
  }

  sessions.sort((left, right) => String(right.updatedAt ?? right.createdAt).localeCompare(String(left.updatedAt ?? left.createdAt)));
  return sessions[0] ?? null;
}
