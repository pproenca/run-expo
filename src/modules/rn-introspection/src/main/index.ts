import { readdir, readFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { bridgeDomainCommand } from "../../../bridge-domain-actions/src/main/index.ts";

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

export interface RnBridgeRequest {
  args: Record<string, unknown>;
  domain: "rn";
  action: string;
  expression: string;
  policy: {
    checked: true;
    action: string;
    sideEffect: "read";
    allowed: true;
    reason: string;
  };
}

export interface RnIntrospectionDependencies {
  readLatestRefCache?: (args: Record<string, unknown>) => Promise<RefCache | null> | RefCache | null;
  bridgeDomainCommand?: (request: RnBridgeRequest) => Promise<Record<string, any>> | Record<string, any>;
}

export function toolJson(value: unknown): ToolTextResult {
  return { content: [{ type: "text", text: `${JSON.stringify(value, null, 2)}\n` }] };
}

export async function rnCommand(
  args: Record<string, unknown> = {},
  deps: RnIntrospectionDependencies = defaultRnDependencies,
): Promise<ToolTextResult> {
  const positionals = Array.isArray(args._) ? args._ : [];
  const action = requireString(args.action ?? positionals[0] ?? "tree", "action");
  if (!["tree", "inspect", "renders", "fiber"].includes(action)) throw new Error(`Unknown React Native action: ${action}`);
  if (action === "inspect") return toolJson(await rnInspectPayload(args, deps));

  const subaction = action === "renders" ? requireString(args.subaction ?? positionals[1] ?? "read", "subaction") : null;
  if (subaction && !["start", "stop", "read"].includes(subaction)) throw new Error(`Unknown React Native renders action: ${subaction}`);
  const bridgeAction = action === "renders" ? `renders-${subaction}` : action;
  const bridgePayload = await deps.bridgeDomainCommand({
    args,
    domain: "rn",
    action: bridgeAction,
    expression: rnExpression({ action: bridgeAction, ref: args.ref }),
    policy: {
      checked: true,
      action: `rn.${bridgeAction}`,
      sideEffect: "read",
      allowed: true,
      reason: "React Native introspection is read-only.",
    },
  });
  return toolJson({
    ...bridgePayload,
    action,
    ...(subaction ? { subaction, bridgeAction } : {}),
    limitations: rnLimitations(bridgePayload.limitations),
  });
}

const defaultRnDependencies: RnIntrospectionDependencies = {
  bridgeDomainCommand: defaultBridgeDomainCommand,
};

async function defaultBridgeDomainCommand(request: RnBridgeRequest): Promise<Record<string, any>> {
  return bridgeDomainCommand(request);
}

export async function rnInspectPayload(
  args: Record<string, unknown> = {},
  deps: Pick<RnIntrospectionDependencies, "readLatestRefCache"> = {},
): Promise<Record<string, any>> {
  const positionals = Array.isArray(args._) ? args._ : [];
  const ref = requireString(args.ref ?? positionals[1] ?? positionals[0], "ref");
  const cache = await readLatestRefCache(args, deps);
  if (!cache) {
    return {
      available: false,
      action: "inspect",
      ref,
      sources: ["snapshot-cache"],
      reason: "No snapshot exists for the current session.",
      limitations: rnLimitations(),
    };
  }
  const record = (cache.refs ?? []).find((item) => item.ref === ref);
  if (!record) {
    return {
      available: false,
      action: "inspect",
      ref,
      sources: ["native-accessibility", "snapshot-cache"],
      reason: "Ref not found in the latest snapshot.",
      snapshotId: cache.snapshotId,
      targetId: cache.targetId,
      limitations: rnLimitations(),
    };
  }
  return {
    available: true,
    action: "inspect",
    ref,
    sources: ["native-accessibility", "snapshot-cache"],
    snapshotId: cache.snapshotId,
    targetId: cache.targetId,
    record,
    limitations: rnLimitations([
      "Inspect uses cached semantic/native accessibility evidence and does not expose private fiber internals.",
    ]),
  };
}

export function rnExpression({ action, ref }: { action: string; ref?: unknown }): string {
  return `(() => {
    const action = ${JSON.stringify(action)};
    const ref = ${JSON.stringify(ref ?? null)};
    const bridge = globalThis.__EXPO_IOS_RN_BRIDGE__ ||
      (globalThis.__EXPO_IOS_INSTRUMENTATION__ && globalThis.__EXPO_IOS_INSTRUMENTATION__.rn);
    if (!bridge) return { available: false, sources: ['runtime', 'app-instrumentation'], source: 'app-instrumentation', reason: 'React Native bridge is not installed.', action };
    if (action === 'tree') return bridge.tree ? bridge.tree() : { available: true, sources: ['runtime', 'app-instrumentation'], action, tree: bridge.tree || [] };
    if (action === 'fiber') return bridge.fiber ? bridge.fiber(ref) : { available: false, sources: ['runtime', 'app-instrumentation'], action, ref, reason: 'Fiber inspection is not exposed by the app bridge.' };
    if (action === 'renders-start') return bridge.renders && bridge.renders.start ? bridge.renders.start() : { available: true, sources: ['runtime', 'app-instrumentation'], action, renders: { recording: true } };
    if (action === 'renders-stop') return bridge.renders && bridge.renders.stop ? bridge.renders.stop() : { available: true, sources: ['runtime', 'app-instrumentation'], action, renders: { recording: false } };
    if (action === 'renders-read') return bridge.renders && bridge.renders.read ? bridge.renders.read() : { available: true, sources: ['runtime', 'app-instrumentation'], action, renders: { recording: false, commits: [] } };
    return { available: false, sources: ['runtime', 'app-instrumentation'], source: 'app-instrumentation', reason: 'Unsupported React Native bridge action.', action };
  })()`;
}

export function rnLimitations(extra: unknown[] = []): string[] {
  return [
    ...extra.map(String),
    "private React Native hooks and fiber fields are version-dependent and may be incomplete or unavailable.",
  ];
}

export async function readLatestRefCache(
  args: Record<string, unknown> = {},
  deps: Pick<RnIntrospectionDependencies, "readLatestRefCache"> = {},
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

function asRecord(value: unknown): Record<string, any> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : null;
}
