import { mkdir as fsMkdir, readdir, readFile, writeFile as fsWriteFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

export interface ToolTextResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

export interface RefCache {
  snapshotId?: string | null;
  targetId?: string | null;
  refs?: Array<Record<string, any>>;
}

export interface StateRootArgs extends Record<string, unknown> {
  stateDir?: string | null;
  root?: string | null;
  cwd?: string | null;
}

export interface DebugInspectDependencies {
  readLatestRefCache?: (args: Record<string, unknown>) => Promise<RefCache | null> | RefCache | null;
  readLatestSession?: (stateRoot: string) => Promise<Record<string, any> | null> | Record<string, any> | null;
  readSelectedTarget?: (stateRoot: string, session: Record<string, any>) => Promise<Record<string, any> | null> | Record<string, any> | null;
  metroStatusPayload?: (args: { metroPort: number }) => Promise<Record<string, any>> | Record<string, any>;
  mkdir?: (path: string, options: { recursive: true }) => Promise<void> | void;
  writeFile?: (path: string, data: string, encoding: "utf8") => Promise<void> | void;
  now?: () => Date;
}

export function toolJson(value: unknown): ToolTextResult {
  return { content: [{ type: "text", text: `${JSON.stringify(value, null, 2)}\n` }] };
}

export async function debugInspectCommand(
  args: Record<string, unknown> = {},
  deps: DebugInspectDependencies = {},
): Promise<ToolTextResult> {
  return toolJson(await debugInspectPayload(args, deps));
}

export async function debugInspectPayload(
  args: Record<string, unknown> = {},
  deps: DebugInspectDependencies = {},
): Promise<Record<string, any>> {
  const ref = requireString(args.ref ?? firstPositional(args), "ref");
  const found = await readRefRecord(ref, args, deps);
  const stateRoot = resolveExpoStateRoot(args);
  const session = await latestSession(stateRoot, deps);
  if (found.available === false) {
    return {
      ...found,
      action: "inspect",
      sessionId: session?.sessionId ?? null,
    };
  }

  const metroPort = clampNumber(args.metroPort ?? 8081, 1, 65_535);
  const metro = await metroStatus({ metroPort }, deps);
  const target = session ? await selectedTarget(stateRoot, session, deps) : null;
  const record = found.record;
  const sessionId = String(session?.sessionId ?? "");
  return {
    available: true,
    action: "inspect",
    ref,
    sessionId: session?.sessionId ?? null,
    snapshotId: found.cache.snapshotId,
    targetId: found.cache.targetId,
    target,
    metro: {
      available: metro.available === true,
      port: metroPort,
      targetCount: metro.targetCount ?? 0,
      firstTarget: metro.targets?.[0] ?? null,
    },
    element: {
      ref,
      role: record.role ?? null,
      label: record.label ?? null,
      text: record.text ?? null,
      testID: record.testID ?? record.nativeID ?? null,
      box: record.box ?? null,
      source: record.source ?? null,
      component: record.component ?? null,
      props: record.props ?? null,
      actions: record.actions ?? [],
      stale: record.stale === true,
    },
    evidence: {
      refCache: join(sessionDirectory(stateRoot, sessionId), "refs.json"),
      snapshotId: found.cache.snapshotId,
    },
    limitations: [
      "Inspect is assembled from the latest cached semantic/native ref snapshot plus Metro target status.",
      "Props and source are present only when the snapshot source includes them.",
    ],
  };
}

export async function highlightCommand(
  args: Record<string, unknown> = {},
  deps: DebugInspectDependencies = {},
): Promise<ToolTextResult> {
  const ref = requireString(args.ref ?? firstPositional(args), "ref");
  const found = await readRefRecord(ref, args, deps);
  if (found.available === false) return toolJson({ ...found, action: "highlight" });

  if (!found.record.box) {
    return toolJson({
      available: false,
      action: "highlight",
      ref,
      reason: "Ref does not include bounds. Capture a snapshot with --bounds before highlighting.",
      record: found.record,
    });
  }
  const box = asBox(found.record.box);
  if (box.width <= 0 || box.height <= 0) {
    return toolJson({
      available: false,
      action: "highlight",
      ref,
      reason: "Ref bounds are zero-sized, so no useful highlight can be drawn.",
      record: found.record,
    });
  }

  const stateRoot = resolveExpoStateRoot(args);
  const timestamp = (deps.now?.() ?? new Date()).toISOString().replace(/[:.]/g, "-");
  const outputPath = resolve(String(args.outputPath ?? join(stateRoot, "artifacts", `highlight-${ref.replace(/[^a-z0-9]/gi, "")}-${timestamp}.svg`)));
  await (deps.mkdir ?? fsMkdir)(dirname(outputPath), { recursive: true });
  await (deps.writeFile ?? fsWriteFile)(outputPath, highlightSvg({ ref, record: found.record, durationMs: args.durationMs }), "utf8");
  return toolJson({
    available: true,
    action: "highlight",
    ref,
    durationMs: args.durationMs ?? null,
    snapshotId: found.cache.snapshotId,
    targetId: found.cache.targetId,
    outputPath,
    record: found.record,
    limitations: ["Highlight writes an evidence overlay artifact from cached bounds; it does not draw inside the running app."],
  });
}

export function highlightSvg({ ref, record, durationMs }: {
  ref: string;
  record: Record<string, any>;
  durationMs?: unknown;
}): string {
  const box = asBox(record.box);
  const width = Math.max(390, Math.ceil(box.x + box.width + 24));
  const height = Math.max(844, Math.ceil(box.y + box.height + 24));
  const label = `${ref} ${record.label ?? record.text ?? record.role ?? ""}`.trim();
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="100%" height="100%" fill="rgba(0,0,0,0.08)"/>
  <rect x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" fill="rgba(255,204,0,0.25)" stroke="#ffcc00" stroke-width="4"/>
  <text x="${Math.max(4, box.x)}" y="${Math.max(18, box.y - 8)}" fill="#111" font-family="Menlo, monospace" font-size="14">${escapeHtml(label)}</text>
  <text x="8" y="${height - 12}" fill="#444" font-family="Menlo, monospace" font-size="11">${escapeHtml(durationMs ? `durationMs=${durationMs}` : "static highlight evidence")}</text>
</svg>
`;
}

export async function readRefRecord(
  ref: string,
  args: Record<string, unknown> = {},
  deps: Pick<DebugInspectDependencies, "readLatestRefCache"> = {},
): Promise<Record<string, any>> {
  const cache = await readLatestRefCache(args, deps);
  if (!cache) return { available: false, reason: "No snapshot exists for the current session.", ref };
  const record = (cache.refs ?? []).find((item) => item.ref === ref);
  if (!record) return { available: false, reason: "Ref not found in the latest snapshot.", ref };
  if (record.stale) return { available: false, reason: "Ref is stale. Capture a new snapshot before acting.", ref };
  return { available: true, record, cache };
}

export async function readLatestRefCache(
  args: Record<string, unknown> = {},
  deps: Pick<DebugInspectDependencies, "readLatestRefCache"> = {},
): Promise<RefCache | null> {
  if (deps.readLatestRefCache) return deps.readLatestRefCache(args);
  const stateRoot = resolveExpoStateRoot(args);
  const session = await readLatestSession(stateRoot);
  if (!session?.lastSnapshotId) return null;
  return readJsonFile(join(sessionDirectory(stateRoot, String(session.sessionId)), "refs.json")).catch(() => null) as Promise<RefCache | null>;
}

export async function readLatestSession(stateRoot: string): Promise<Record<string, any> | null> {
  const sessionsRoot = join(stateRoot, "sessions");
  const entries = await readdir(sessionsRoot, { withFileTypes: true }).catch(() => []);
  const sessions = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const record = await readJsonFile(join(sessionsRoot, entry.name, "session.json")).catch(() => null);
    if (record) sessions.push(record);
  }
  sessions.sort((a, b) => String(asRecord(b)?.updatedAt ?? asRecord(b)?.createdAt).localeCompare(String(asRecord(a)?.updatedAt ?? asRecord(a)?.createdAt)));
  return asRecord(sessions[0]);
}

export async function readSelectedTarget(stateRoot: string, session: Record<string, any>): Promise<Record<string, any> | null> {
  return readJsonFile(join(sessionDirectory(stateRoot, String(session.sessionId)), "target.json")).then(asRecord).catch(() => null);
}

export function resolveExpoStateRoot(args: StateRootArgs = {}): string {
  if (args.stateDir) {
    const resolved = resolve(args.stateDir);
    return basename(resolved) === "runs" ? resolve(join(resolved, "..")) : resolved;
  }
  const root = resolve(args.root ?? args.cwd ?? process.cwd());
  return join(root, ".scratch", "expo-ios");
}

export function sessionDirectory(stateRoot: string, sessionId: string): string {
  return join(stateRoot, "sessions", sessionId);
}

export async function readJsonFile(file: string): Promise<unknown> {
  return JSON.parse(await readFile(file, "utf8"));
}

export function requireString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${name} must be a non-empty string.`);
  return value.trim();
}

export function clampNumber(value: unknown, min: number, max: number): number {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`Expected a finite number, got ${String(value)}.`);
  return Math.min(Math.max(number, min), max);
}

export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

async function latestSession(
  stateRoot: string,
  deps: Pick<DebugInspectDependencies, "readLatestSession">,
): Promise<Record<string, any> | null> {
  return deps.readLatestSession ? deps.readLatestSession(stateRoot) : readLatestSession(stateRoot);
}

async function selectedTarget(
  stateRoot: string,
  session: Record<string, any>,
  deps: Pick<DebugInspectDependencies, "readSelectedTarget">,
): Promise<Record<string, any> | null> {
  return deps.readSelectedTarget ? deps.readSelectedTarget(stateRoot, session) : readSelectedTarget(stateRoot, session);
}

async function metroStatus(
  args: { metroPort: number },
  deps: Pick<DebugInspectDependencies, "metroStatusPayload">,
): Promise<Record<string, any>> {
  return deps.metroStatusPayload ? deps.metroStatusPayload(args) : { available: false, targetCount: 0, targets: [] };
}

function asBox(value: unknown): { x: number; y: number; width: number; height: number } {
  const record = asRecord(value);
  const x = Number(record?.x);
  const y = Number(record?.y);
  const width = Number(record?.width);
  const height = Number(record?.height);
  if (![x, y, width, height].every(Number.isFinite)) throw new Error("record.box must include finite x, y, width, and height.");
  return { x, y, width, height };
}

function firstPositional(args: Record<string, unknown>): unknown {
  return Array.isArray(args._) ? args._[0] : undefined;
}

function asRecord(value: unknown): Record<string, any> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : null;
}
