import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";

import { CLI_NAME, CLI_VERSION, type Clock, type JsonValue, type RunPayloadSummary, type RunRecorder, type RunningRunRecord } from "./domain.js";
import { createRunId, randomBase36Suffix, systemClock } from "./ids.js";
import { writeJsonFile } from "./json-store.js";
import { formatError, redactValue, sanitizeErrorMessage } from "./redaction.js";

type StartRunRecordInput = {
  command: string;
  args: Record<string, JsonValue | undefined>;
  globals: Record<string, JsonValue | undefined>;
  cwd?: string;
  now?: Clock;
  randomSuffix?: () => string;
};

/**
 * RULE-014/RULE-018: creates a durable running run record when `--record` or
 * `--state-dir` is active, then rewrites it as completed or failed.
 */
export async function startRunRecord(input: StartRunRecordInput): Promise<RunRecorder> {
  if (!input.globals.record && !input.globals.stateDir) {
    return { path: null, async finish() {} };
  }

  const now = input.now ?? systemClock;
  const startedAt = now().toISOString();
  const runId = createRunId(new Date(startedAt), input.randomSuffix ?? randomBase36Suffix);
  const root = resolve(String(input.globals.root ?? input.args.cwd ?? input.cwd ?? process.cwd()));
  const stateDir = resolve(String(input.globals.stateDir ?? join(root, ".scratch", "expo98", "runs")));
  const recordPath = join(stateDir, `${runId}.json`);
  const baseRecord: RunningRunRecord = {
    schemaVersion: 1,
    runId,
    cli: { name: CLI_NAME, version: CLI_VERSION },
    command: input.command,
    args: redactValue(stripUndefined(input.args)) as Record<string, JsonValue>,
    root,
    stateDir,
    startedAt,
    finishedAt: null,
    status: "running",
    exitCode: null,
  };

  await mkdir(stateDir, { recursive: true });
  await writeJsonFile(recordPath, baseRecord);

  return {
    path: recordPath,
    async finish({ status, exitCode, payload, error }) {
      await writeJsonFile(recordPath, {
        ...baseRecord,
        finishedAt: now().toISOString(),
        status,
        exitCode,
        summary: summarizeRunPayload(payload),
        error: error ? sanitizeErrorMessage(formatError(error)) : null,
      });
    },
  };
}

export function summarizeRunPayload(payload: unknown): RunPayloadSummary | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const record = payload as Record<string, unknown>;
  const summary: RunPayloadSummary = {
    keys: Object.keys(record).slice(0, 40),
  };
  if (typeof record.available === "boolean") {
    summary.available = record.available;
  }
  if (record.routeCount !== undefined) {
    summary.routeCount = record.routeCount;
  }
  if (Array.isArray(record.events)) {
    summary.eventCount = record.events.length;
  }
  return summary;
}

function stripUndefined(value: Record<string, JsonValue | undefined>): Record<string, JsonValue> {
  return Object.fromEntries(Object.entries(value).filter(([, child]) => child !== undefined)) as Record<string, JsonValue>;
}
