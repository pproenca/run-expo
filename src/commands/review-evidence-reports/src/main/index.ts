import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

import { toolJson, unwrapToolJson, type ToolTextResult } from "../../../../core/tool-json-envelope/src/main/index.ts";
import { openExpoRoute } from "../../../route-url-actions/src/main/index.ts";
import { captureScreenshot } from "../../../screenshot-capture/src/main/index.ts";

export interface ReviewDiffDependencies {
  openExpoRoute?: (args: Record<string, unknown>) => Promise<ToolTextResult> | ToolTextResult;
  captureScreenshot?: (args: Record<string, unknown>) => Promise<{ outputPath?: string | null } | null> | { outputPath?: string | null } | null;
  now?: () => Date;
  nowMs?: () => number;
}

export interface StateRootArgs extends Record<string, unknown> {
  stateDir?: string | null;
  root?: string | null;
  cwd?: string | null;
}

export interface RunSummary {
  command: unknown;
  status: unknown;
  exitCode: unknown;
  startedAt: unknown;
  completedAt: unknown;
  path: unknown;
  summary: unknown;
}

const REVIEW_LIMITATION = "Review reports assemble evidence already captured by other commands; they do not independently judge UI quality.";
const ROUTE_DIFF_LIMITATION = "Route diff captures route-open evidence and optional screenshots; semantic visual comparison is left to the caller.";

export async function reviewCommand(
  args: Record<string, unknown> = {},
  deps: ReviewDiffDependencies = defaultReviewDiffDependencies,
): Promise<ToolTextResult> {
  const positionals = Array.isArray(args._) ? args._ : [];
  const action = requireString(args.action ?? positionals[0] ?? "report", "action");
  if (!["report", "matrix"].includes(action)) throw new Error(`Unknown review action: ${action}`);
  const stateRoot = resolveExpoStateRoot(args);
  const session = await readLatestSession(stateRoot);
  const outputPath = resolve(String(args.outputPath ?? join(stateRoot, "artifacts", `review-${action}-${isoStamp(deps)}.json`)));
  await mkdir(dirname(outputPath), { recursive: true });
  const runs = await listRunRecords(stateRoot);
  const latestRefs = await readLatestRefCache(args);
  const payload = action === "matrix"
    ? reviewMatrixPayload({ stateRoot, session, runs, latestRefs, outputPath })
    : reviewReportPayload({ stateRoot, session, runs, latestRefs, outputPath });
  await writeJsonFile(outputPath, payload);
  return toolJson(payload);
}

export async function diffCommand(
  args: Record<string, unknown> = {},
  deps: ReviewDiffDependencies = defaultReviewDiffDependencies,
): Promise<ToolTextResult> {
  const positionals = Array.isArray(args._) ? args._ : [];
  const kind = requireString(args.kind ?? positionals[0], "kind");
  if (!["snapshot", "screenshot", "route"].includes(kind)) throw new Error(`Unknown diff kind: ${kind}`);
  const normalizedArgs: Record<string, unknown> = {
    ...args,
    kind,
    baseline: args.baseline ?? positionals[1],
    current: args.current ?? positionals[2],
    routeA: args.routeA ?? (kind === "route" ? positionals[1] : undefined),
    routeB: args.routeB ?? (kind === "route" ? positionals[2] : undefined),
  };
  const stateRoot = resolveExpoStateRoot(normalizedArgs);
  const session = await readLatestSession(stateRoot);
  const outputPath = resolve(String(normalizedArgs.outputPath ?? join(stateRoot, "artifacts", `diff-${kind}-${isoStamp(deps)}.json`)));
  await mkdir(dirname(outputPath), { recursive: true });
  const diff = kind === "snapshot"
    ? await snapshotDiffPayload(normalizedArgs)
    : kind === "route"
    ? await routeDiffPayload(normalizedArgs, deps)
    : await screenshotDiffPayload(normalizedArgs);
  const payload = {
    ...diff,
    kind,
    sessionId: asRecord(session)?.sessionId ?? null,
    targetId: asRecord(session)?.activeTargetId ?? null,
    outputPath,
  };
  await writeJsonFile(outputPath, payload);
  return toolJson(payload);
}

const defaultReviewDiffDependencies: ReviewDiffDependencies = {
  openExpoRoute,
  captureScreenshot,
  now: () => new Date(),
  nowMs: () => Date.now(),
};

export function reviewReportPayload(args: {
  stateRoot: string;
  session: unknown;
  runs: Array<Record<string, any>>;
  latestRefs: Record<string, any> | null;
  outputPath: string;
}): Record<string, unknown> {
  const session = asRecord(args.session);
  const artifacts = collectExpoIosArtifacts(args.stateRoot);
  return {
    available: true,
    action: "report",
    outputPath: args.outputPath,
    stateRoot: args.stateRoot,
    sessionId: session?.sessionId ?? null,
    activeTargetId: session?.activeTargetId ?? null,
    lastSnapshotId: session?.lastSnapshotId ?? null,
    runCount: args.runs.length,
    recentRuns: args.runs.slice(-25).map(runSummary),
    refCount: Array.isArray(args.latestRefs?.refs) ? args.latestRefs.refs.length : 0,
    artifacts,
    limitations: [REVIEW_LIMITATION],
  };
}

export function reviewMatrixPayload(args: {
  stateRoot: string;
  session: unknown;
  runs: Array<Record<string, any>>;
  latestRefs: Record<string, any> | null;
  outputPath: string;
}): Record<string, unknown> {
  const session = asRecord(args.session);
  const commands = new Set(args.runs.map((run) => run.command).filter(Boolean));
  const checks = [
    { name: "session", passed: Boolean(session), evidence: session ? sessionDirectory(args.stateRoot, String(session.sessionId)) : null },
    { name: "target", passed: Boolean(session?.activeTargetId), evidence: session?.activeTargetId ?? null },
    { name: "snapshot", passed: Boolean(args.latestRefs?.snapshotId), evidence: args.latestRefs?.snapshotId ?? null },
    { name: "screenshot", passed: commands.has("screenshot") || commands.has("annotate-screen"), evidence: "run-records" },
    { name: "runtime", passed: commands.has("devtools") || commands.has("inspector") || commands.has("ux-context"), evidence: "run-records" },
    { name: "diagnostics", passed: commands.has("console") || commands.has("errors") || commands.has("logs"), evidence: "run-records" },
    { name: "interaction", passed: commands.has("tap") || commands.has("gesture") || commands.has("fill"), evidence: "run-records" },
  ];
  return {
    available: true,
    action: "matrix",
    outputPath: args.outputPath,
    stateRoot: args.stateRoot,
    sessionId: session?.sessionId ?? null,
    checks,
    passed: checks.every((check) => check.passed),
    runCount: args.runs.length,
  };
}

export async function routeDiffPayload(
  args: Record<string, unknown> = {},
  deps: ReviewDiffDependencies = defaultReviewDiffDependencies,
): Promise<Record<string, unknown>> {
  const routeA = requireString(args.routeA, "routeA");
  const routeB = requireString(args.routeB, "routeB");
  const screenshot = args.screenshot === true;
  if (!deps.openExpoRoute) return { available: false, routeA, routeB, reason: "No open-route adapter is configured." };
  const openedA = unwrapToolJson(await deps.openExpoRoute({ ...args, route: routeA }));
  const shotA = screenshot
    ? await captureRouteScreenshot(args, deps, `route-a-${nowMs(deps)}.png`)
    : null;
  const openedB = unwrapToolJson(await deps.openExpoRoute({ ...args, route: routeB }));
  const shotB = screenshot
    ? await captureRouteScreenshot(args, deps, `route-b-${nowMs(deps)}.png`)
    : null;
  return {
    available: true,
    routeA,
    routeB,
    openedA,
    openedB,
    screenshots: screenshot ? { before: shotA?.outputPath ?? null, after: shotB?.outputPath ?? null } : null,
    limitations: [ROUTE_DIFF_LIMITATION],
  };
}

export async function snapshotDiffPayload(args: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const baseline = await readJsonFile(resolve(requireString(args.baseline, "baseline")));
  const current = args.current
    ? await readJsonFile(resolve(requireString(args.current, "current")))
    : await latestSnapshotJson(args);
  if (!current) return { available: false, reason: "No current snapshot exists for the current session." };
  const beforeRefs = new Set(refsFromSnapshot(baseline));
  const afterRefs = new Set(refsFromSnapshot(current));
  return {
    available: true,
    baselineSnapshotId: asRecord(baseline)?.snapshotId ?? null,
    currentSnapshotId: asRecord(current)?.snapshotId ?? null,
    addedRefs: [...afterRefs].filter((ref) => !beforeRefs.has(ref)),
    removedRefs: [...beforeRefs].filter((ref) => !afterRefs.has(ref)),
    beforeCount: beforeRefs.size,
    afterCount: afterRefs.size,
  };
}

export async function screenshotDiffPayload(args: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const baseline = resolve(requireString(args.baseline, "baseline"));
  const current = resolve(requireString(args.current, "current"));
  const [before, after] = await Promise.all([stat(baseline), stat(current)]);
  return {
    available: true,
    baseline,
    current,
    byteDelta: after.size - before.size,
    changed: before.size !== after.size,
  };
}

export async function latestSnapshotJson(args: Record<string, unknown> = {}): Promise<unknown | null> {
  const cache = await readLatestRefCache(args);
  if (!cache?.snapshotId) return null;
  const stateRoot = resolveExpoStateRoot(args);
  const session = await readLatestSession(stateRoot);
  const sessionId = asRecord(session)?.sessionId;
  if (!sessionId) return cache;
  return readJsonFile(join(sessionDirectory(stateRoot, String(sessionId)), "snapshots", `${cache.snapshotId}.json`)).catch(() => cache);
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

export async function readLatestRefCache(args: Record<string, unknown> = {}): Promise<Record<string, any> | null> {
  const stateRoot = resolveExpoStateRoot(args);
  const session = asRecord(await readLatestSession(stateRoot));
  if (!session?.lastSnapshotId) return null;
  return readJsonFile(join(sessionDirectory(stateRoot, String(session.sessionId)), "refs.json")).catch(() => null) as Promise<Record<string, any> | null>;
}

export async function listRunRecords(stateRoot: string): Promise<Array<Record<string, any>>> {
  const runsRoot = join(stateRoot, "runs");
  const entries = await readdir(runsRoot, { withFileTypes: true }).catch(() => []);
  const records: Array<Record<string, any>> = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const file = join(runsRoot, entry.name);
    const record = asRecord(await readJsonFile(file).catch(() => null));
    if (record) records.push({ ...record, path: file });
  }
  records.sort((a, b) => String(a.startedAt ?? a.createdAt ?? "").localeCompare(String(b.startedAt ?? b.createdAt ?? "")));
  return records;
}

export function runSummary(run: Record<string, any>): RunSummary {
  return {
    command: run.command ?? null,
    status: run.status ?? null,
    exitCode: run.exitCode ?? null,
    startedAt: run.startedAt ?? run.createdAt ?? null,
    completedAt: run.completedAt ?? run.finishedAt ?? null,
    path: run.path ?? null,
    summary: run.summary ?? null,
  };
}

export function collectExpoIosArtifacts(stateRoot: string): Record<string, string> {
  return {
    runs: join(stateRoot, "runs"),
    sessions: join(stateRoot, "sessions"),
    artifacts: join(stateRoot, "artifacts"),
  };
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

export async function writeJsonFile(file: string, value: unknown): Promise<void> {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function requireString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${name} must be a non-empty string.`);
  return value.trim();
}

function refsFromSnapshot(snapshot: unknown): string[] {
  const refs = asRecord(snapshot)?.refs;
  if (!Array.isArray(refs)) return [];
  return refs.map((record) => asRecord(record)?.ref).filter((ref): ref is string => typeof ref === "string");
}

async function captureRouteScreenshot(
  args: Record<string, unknown>,
  deps: ReviewDiffDependencies,
  filename: string,
): Promise<{ outputPath?: string | null } | null> {
  if (!deps.captureScreenshot) return null;
  const outputPath = join(resolveExpoStateRoot(args), "artifacts", filename);
  return deps.captureScreenshot({ ...args, outputPath });
}

function isoStamp(deps: ReviewDiffDependencies): string {
  return (deps.now ? deps.now() : new Date()).toISOString().replace(/[:.]/g, "-");
}

function nowMs(deps: ReviewDiffDependencies): number {
  return deps.nowMs ? deps.nowMs() : Date.now();
}

function asRecord(value: unknown): Record<string, any> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : null;
}
