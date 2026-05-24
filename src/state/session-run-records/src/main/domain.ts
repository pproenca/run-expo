import { CURRENT_CLI_NAME, CLI_VERSION } from "../../../../core/cli-identity/src/main/index.ts";

export const CLI_NAME = CURRENT_CLI_NAME;
export { CLI_VERSION };
export const EXIT_RUNTIME_FAILURE = 1;
export const EXIT_INVALID_USAGE = 2;
export const REDACTED = "[redacted]";
export const MAX_OUTPUT = 40_000;

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type SidecarStatus = "running" | "stale" | "stopped" | "unknown";

export type SidecarRecord = {
  name: string;
  pid: number | null;
  port: number | null;
  status: SidecarStatus;
};

export type SessionRecord = {
  schemaVersion: 1;
  sessionId: string;
  name: string;
  artifactDir: string;
  createdAt: string;
  updatedAt: string;
  activeTargetId: string | null;
  lastSnapshotId: string | null;
  sidecars: SidecarRecord[];
  closedAt?: string;
};

export type SessionActionResult =
  | { available: true; action: "show" | "close"; session: SessionRecord }
  | { available: false; action: "show" | "close"; reason: "Session not found."; name: string | null };

export type CleanSessionsResult = {
  available: true;
  action: "clean";
  stateRoot: string;
  olderThan: string;
  removed: string[];
};

export type RunRecordStatus = "running" | "completed" | "failed";

export type RunPayloadSummary = {
  keys: string[];
  available?: boolean;
  routeCount?: unknown;
  eventCount?: number;
};

export type RunningRunRecord = {
  schemaVersion: 1;
  runId: string;
  cli: { name: typeof CLI_NAME; version: typeof CLI_VERSION };
  command: string;
  args: Record<string, JsonValue>;
  root: string;
  stateDir: string;
  startedAt: string;
  finishedAt: null;
  status: "running";
  exitCode: null;
};

export type FinishedRunRecord = Omit<RunningRunRecord, "finishedAt" | "status" | "exitCode"> & {
  finishedAt: string;
  status: "completed" | "failed";
  exitCode: number;
  summary: RunPayloadSummary | null;
  error: string | null;
};

export type RunRecorder = {
  path: string | null;
  finish(input: {
    status: Exclude<RunRecordStatus, "running">;
    exitCode: number;
    payload?: unknown;
    error?: unknown;
  }): Promise<void>;
};

export type Clock = () => Date;
export type RandomSuffix = () => string;

export type ToolTextResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};
