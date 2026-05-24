import { execFile as nodeExecFile } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import {
  toolJson,
  unwrapToolJson,
  type ToolTextResult,
} from "../../../../core/tool-json-envelope/src/main/index.ts";
import type { SessionRecord } from "../../../../state/session-run-records/src/main/index.ts";
import { resolveIosDevice } from "../../../route-url-actions/src/main/index.ts";
import type { RefCache } from "../../../snapshot-evidence/src/main/index.ts";

export interface AccessibilityDependencies {
  readLatestRefCache?: (
    args: Record<string, unknown>,
  ) => Promise<RefCache | null> | RefCache | null;
  refActionCommand?: (args: Record<string, unknown>) => Promise<ToolTextResult> | ToolTextResult;
  semanticBridgeSnapshot?: (
    args: Record<string, unknown>,
    context: Record<string, unknown>,
  ) => Promise<Record<string, any>> | Record<string, any>;
  commandPath?: (name: string) => Promise<string | null> | string | null;
  resolveIosDevice?: (
    device: unknown,
    options: { preferBooted: boolean },
  ) => Promise<Record<string, any>> | Record<string, any>;
  execFile?: (
    file: string,
    argv: string[],
    options: { timeout: number; maxBuffer: number; rejectOnError: false },
  ) =>
    | Promise<{ stdout: string; stderr: string; error?: unknown }>
    | { stdout: string; stderr: string; error?: unknown };
}

export interface StateRootArgs extends Record<string, unknown> {
  stateDir?: string | null;
  root?: string | null;
  cwd?: string | null;
}

const FOCUS_LIMITATION =
  "Native iOS accessibility focus APIs are not exposed by stable local simulator tooling here; this command focuses the element through the available ref tap path.";

export async function accessibilityCommand(
  args: Record<string, unknown> = {},
  deps: AccessibilityDependencies = defaultAccessibilityDependencies,
): Promise<ToolTextResult> {
  const positionals = Array.isArray(args._) ? args._ : [];
  const action = requireString(args.action ?? positionals[0] ?? "tree", "action");
  if (!["tree", "inspect", "audit", "focus"].includes(action))
    throw new Error(`Unknown accessibility action: ${action}`);
  if (action === "focus") {
    const ref = requireString(args.ref ?? positionals[1], "ref");
    if (!deps.refActionCommand)
      return toolJson({
        available: false,
        action,
        ref,
        reason: "No ref action adapter is configured.",
      });
    const result =
      asRecord(unwrapToolJson(await deps.refActionCommand({ ...args, command: "focus", ref }))) ??
      {};
    return toolJson({
      ...result,
      action,
      source: result.source ?? "ref-action",
      limitations: [FOCUS_LIMITATION],
    });
  }
  if (action === "inspect") {
    const ref = requireString(args.ref ?? positionals[1], "ref");
    const cache = await readLatestRefCache(args, deps);
    if (!cache)
      return toolJson({
        available: false,
        action,
        reason: "No snapshot exists for the current session.",
        ref,
      });
    const record = (cache.refs ?? []).find((item) => item.ref === ref);
    return toolJson(
      record
        ? {
            available: true,
            action,
            ref,
            snapshotId: cache.snapshotId,
            targetId: cache.targetId,
            record,
          }
        : { available: false, action, reason: "Ref not found in the latest snapshot.", ref },
    );
  }
  if (action === "audit") {
    const cache = await readLatestRefCache(args, deps);
    if (!cache)
      return toolJson({
        available: false,
        action,
        reason: "No snapshot exists for the current session.",
        issues: [],
      });
    const issues = auditAccessibilityRefs(cache);
    return toolJson({
      available: true,
      action,
      snapshotId: cache.snapshotId,
      targetId: cache.targetId,
      issueCount: issues.length,
      issues,
    });
  }
  return toolJson(await accessibilityTreePayload(args, deps));
}

const defaultAccessibilityDependencies: AccessibilityDependencies = {
  commandPath: defaultCommandPath,
  resolveIosDevice: (device, options) =>
    resolveIosDevice(typeof device === "string" ? device : null, options),
  execFile: defaultExecFile,
  refActionCommand: (args) =>
    toolJson({
      available: false,
      action: "focus",
      ref: args.ref ?? null,
      reason: "Accessibility focus requires a current ref action adapter.",
    }),
};

function defaultCommandPath(command: string): Promise<string | null> {
  return new Promise((resolve) => {
    nodeExecFile("which", [command], { timeout: 5000 }, (error, stdout) => {
      resolve(error ? null : String(stdout ?? "").trim() || null);
    });
  });
}

function defaultExecFile(
  file: string,
  argv: string[],
  options: { timeout: number; maxBuffer: number; rejectOnError: false },
): Promise<{ stdout: string; stderr: string; error?: unknown }> {
  return new Promise((resolve) => {
    nodeExecFile(
      file,
      argv,
      {
        timeout: options.timeout,
        maxBuffer: options.maxBuffer,
      },
      (error, stdout, stderr) => {
        resolve({
          stdout: String(stdout ?? ""),
          stderr: String(stderr ?? ""),
          error: error
            ? { message: error.message, code: error.code, signal: error.signal }
            : undefined,
        });
      },
    );
  });
}

export async function accessibilityTreePayload(
  args: Record<string, unknown>,
  deps: AccessibilityDependencies = {},
): Promise<Record<string, unknown>> {
  const semanticBridge = await semanticBridgeTree(args, deps);
  const axe = deps.commandPath ? await deps.commandPath("axe") : null;
  if (!axe)
    return {
      available: false,
      action: "tree",
      reason: "axe CLI is not installed or not on PATH.",
      semanticBridge,
    };
  if (!deps.resolveIosDevice)
    return { available: false, action: "tree", reason: "No iOS device resolver is configured." };
  if (!deps.execFile)
    return { available: false, action: "tree", reason: "No subprocess adapter is configured." };
  const device = await deps.resolveIosDevice(args.device, { preferBooted: true });
  const result = await deps.execFile(axe, ["describe-ui", "--udid", String(device.udid)], {
    timeout: 12_000,
    maxBuffer: 4 * 1024 * 1024,
    rejectOnError: false,
  });
  if (result.error) {
    return {
      available: false,
      action: "tree",
      reason: "Native accessibility tree failed.",
      stderr: truncate(result.stderr),
      error: result.error,
      semanticBridge,
    };
  }
  const tree = JSON.parse(result.stdout || "[]");
  return {
    available: true,
    action: "tree",
    source: semanticBridge?.available
      ? ["plugin-bridge-semantic", "native-accessibility"]
      : "native-accessibility",
    device,
    tree,
    semanticBridge,
  };
}

export function auditAccessibilityRefs(
  cache: RefCache,
): Array<{ ref: unknown; rule: string; message: string }> {
  return (cache.refs ?? [])
    .filter((record) => (record.actions ?? []).length > 0 && !record.label && !record.text)
    .map((record) => ({
      ref: record.ref,
      rule: "interactive-name",
      message: "Interactive ref has no label or text.",
    }));
}

export async function readLatestRefCache(
  args: Record<string, unknown> = {},
  deps: Pick<AccessibilityDependencies, "readLatestRefCache"> = {},
): Promise<RefCache | null> {
  if (deps.readLatestRefCache) return deps.readLatestRefCache(args);
  const stateRoot = resolveExpoStateRoot(args);
  const session = await readLatestSession(stateRoot);
  if (!session?.lastSnapshotId) return null;
  const parsed = await readJsonFile(
    join(sessionDirectory(stateRoot, String(session.sessionId)), "refs.json"),
  ).catch(() => null);
  return asRefCache(parsed);
}

export async function semanticBridgeTree(
  args: Record<string, unknown>,
  deps: Pick<AccessibilityDependencies, "semanticBridgeSnapshot"> = {},
): Promise<Record<string, any> | null> {
  if (!deps.semanticBridgeSnapshot) return null;
  try {
    return await deps.semanticBridgeSnapshot(args, {
      stateRoot: resolveExpoStateRoot(args),
      session: { activeTargetId: null },
      filters: {
        interactiveOnly: false,
        compact: false,
        depth: null,
        includeSource: true,
        includeBounds: true,
      },
    });
  } catch (error) {
    return {
      available: false,
      source: "plugin-bridge-semantic",
      code: "transport-failure",
      reason: formatError(error),
    };
  }
}

export async function readLatestSession(stateRoot: string): Promise<SessionRecord | null> {
  const sessionsRoot = join(stateRoot, "sessions");
  const entries = await readdir(sessionsRoot, { withFileTypes: true }).catch(() => []);
  const sessions = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const record = await readJsonFile(join(sessionsRoot, entry.name, "session.json")).catch(
      () => null,
    );
    const session = asSessionRecord(record);
    if (session) sessions.push(session);
  }
  sessions.sort((a, b) =>
    String(b.updatedAt ?? b.createdAt).localeCompare(String(a.updatedAt ?? a.createdAt)),
  );
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

export function requireString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0)
    throw new Error(`${name} must be a non-empty string.`);
  return value.trim();
}

export function clampNumber(value: unknown, min: number, max: number): number {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`Expected a finite number, got ${String(value)}.`);
  return Math.min(Math.max(number, min), max);
}

export function truncate(value: unknown, max = 40_000): string {
  const text = String(value ?? "");
  if (text.length <= max) return text;
  return `${text.slice(0, max)}...[truncated ${text.length - max} chars]`;
}

function formatError(error: unknown): string {
  const record = error && typeof error === "object" ? (error as { message?: unknown }) : null;
  return record?.message == null ? String(error) : String(record.message);
}

function asRecord(value: unknown): Record<string, any> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, any>)
    : null;
}

function asRefCache(value: unknown): RefCache | null {
  const record = asRecord(value);
  if (!record || !Array.isArray(record.refs)) return null;
  return record as RefCache;
}

function asSessionRecord(value: unknown): SessionRecord | null {
  const record = asRecord(value);
  return typeof record?.sessionId === "string" ? (record as SessionRecord) : null;
}
