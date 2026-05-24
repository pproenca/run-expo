import { execFile as nodeExecFile } from "node:child_process";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { RefRecord, ScreenBox, SemanticBridgeSnapshot, SnapshotArgs, SnapshotCommandDependencies, SnapshotFilters, SnapshotResult } from "./domain.js";
import { buildSnapshotFilters } from "./filters.js";
import { persistNativeSnapshot, persistSemanticSnapshot } from "./persistence.js";
import { evaluateHermesExpression } from "../../../hermes-cdp-client/src/main/index.ts";
import { metroTargets } from "../../../metro-probes/src/main/index.ts";
import { randomBase36Suffix } from "../../../session-run-records/src/main/ids.js";
import { resolveExpoStateRoot, sessionDirectory, sessionJsonPath } from "../../../session-run-records/src/main/paths.js";

export async function snapshotCommand(
  args: SnapshotArgs = {},
  deps: SnapshotCommandDependencies = defaultSnapshotDependencies,
): Promise<SnapshotResult | { available: false; [key: string]: unknown }> {
  const stateRoot = args.stateRoot ?? resolveExpoStateRoot(args as Record<string, string | null>);
  const session = await deps.readLatestSession(stateRoot);
  if (!session) {
    return {
      available: false,
      reason: "No session exists. Run `expo-ios --json session new review` first.",
    };
  }
  if (!session.activeTargetId) {
    return {
      available: false,
      reason: "No target selected for the current session.",
      sessionId: session.sessionId,
    };
  }

  const target = await deps.readSelectedTarget(stateRoot, session);
  if (!target?.device?.id) {
    return {
      available: false,
      reason: "Selected target metadata is missing.",
      targetId: session.activeTargetId,
    };
  }

  const filters = buildSnapshotFilters(args);
  const semanticBridge = await deps.captureSemanticBridge(args, { stateRoot, session, filters }).catch((error: unknown) => ({
    available: false as const,
    source: "plugin-bridge-semantic",
    code: "transport-failure",
    reason: formatError(error),
  }));
  if (semanticBridge.available === true) {
    return persistSemanticSnapshot({ stateRoot, session, filters, semanticBridge }, deps);
  }

  const axe = await deps.findAxeCli();
  if (!axe) {
    return {
      available: false,
      reason: "axe CLI is not installed or not on PATH.",
      targetId: session.activeTargetId,
      semanticBridge,
    };
  }

  const result = await deps.describeNativeUi(axe, target.device.id);
  if (result.error) {
    return {
      available: false,
      reason: "Native accessibility snapshot failed.",
      targetId: session.activeTargetId,
      stderr: truncate(result.stderr),
      error: result.error,
      semanticBridge,
    };
  }

  return persistNativeSnapshot({
    stateRoot,
    session,
    filters,
    semanticBridge,
    accessibilityTree: JSON.parse(result.stdout || "[]"),
  }, deps);
}

const defaultSnapshotDependencies: SnapshotCommandDependencies = {
  now: () => new Date(),
  randomSuffix: randomBase36Suffix,
  ensureDirectory: (path) => mkdir(path, { recursive: true }),
  writeJsonFile: writeJson,
  updateSessionRecord: async (stateRoot, record) => {
    await mkdir(sessionDirectory(stateRoot, record.sessionId), { recursive: true });
    await writeJson(sessionJsonPath(stateRoot, record.sessionId), record);
    return record;
  },
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
  readSelectedTarget: async (stateRoot, session) => {
    return readJson(join(sessionDirectory(stateRoot, session.sessionId), "target.json")).catch(() => null);
  },
  captureSemanticBridge,
  findAxeCli: () => commandPath("axe"),
  describeNativeUi: (axePath, deviceId) => execFile(axePath, ["describe-ui", "--udid", deviceId], { timeout: 12_000 }),
};

async function captureSemanticBridge(args: SnapshotArgs, context: { filters: SnapshotFilters }): Promise<SemanticBridgeSnapshot | { available: false; [key: string]: unknown }> {
  const metroPort = clampNumber(args.metroPort ?? 8081, 1, 65535);
  const targets = await metroTargets(metroPort);
  const target = targets.find((item) => item.webSocketDebuggerUrl) ?? targets[0] ?? null;
  const webSocketDebuggerUrl = target?.webSocketDebuggerUrl ?? null;
  if (!webSocketDebuggerUrl) {
    return {
      available: false,
      source: "plugin-bridge-semantic",
      code: "no-runtime-target",
      reason: "No Metro inspector target.",
      metroPort,
      target,
    };
  }

  const result = await evaluateHermesExpression(webSocketDebuggerUrl, semanticBridgeExpression(context.filters), { timeoutMs: 5000 });
  const value = result.result?.result?.value;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      available: false,
      source: "plugin-bridge-semantic",
      code: "transport-failure",
      reason: result.error ?? "Hermes runtime did not return semantic bridge data.",
      metroPort,
      target,
      transport: result.diagnostics ?? result.cdp ?? null,
    };
  }

  const normalized = normalizeSemanticBridgeSnapshot(value as Record<string, any>, context.filters);
  if (!normalized.refs.length) {
    return {
      available: false,
      source: normalized.source,
      code: "app-bridge-unavailable",
      reason: normalized.reason ?? "No semantic or React Native bridge data is installed in the app runtime.",
      metroPort,
      target,
      transport: result.diagnostics ?? result.cdp ?? null,
      raw: value,
    };
  }

  return {
    available: true,
    source: normalized.source,
    bridgeVersion: normalized.bridgeVersion,
    routeHint: normalized.routeHint,
    refs: normalized.refs,
    rawCount: normalized.rawCount,
    metroPort,
    transport: result.diagnostics ?? result.cdp ?? null,
    limitations: normalized.limitations,
  };
}

function semanticBridgeExpression(filters: SnapshotFilters): string {
  return `(async () => {
    const filters = ${JSON.stringify(filters)};
    const callBridge = async (candidate, source) => {
      if (!candidate) return null;
      let payload = candidate;
      if (typeof candidate === 'function') payload = await candidate({ filters });
      else if (candidate.snapshot && typeof candidate.snapshot === 'function') payload = await candidate.snapshot({ filters });
      else if (candidate.tree && typeof candidate.tree === 'function') payload = await candidate.tree({ filters });
      else if (candidate.refs && typeof candidate.refs === 'function') payload = await candidate.refs({ filters });
      if (!payload) return null;
      if (Array.isArray(payload)) return { available: true, source, refs: payload };
      if (typeof payload === 'object') return { available: payload.available !== false, source: payload.source || source, ...payload };
      return null;
    };
    const instrumentation = globalThis.__EXPO_IOS_INSTRUMENTATION__ || {};
    const probes = [
      ['plugin-bridge-semantic', globalThis.__EXPO_IOS_SEMANTIC_BRIDGE__],
      ['app-instrumentation', instrumentation.semantic],
      ['app-instrumentation', instrumentation.snapshot],
      ['app-rn-bridge', globalThis.__EXPO_IOS_RN_BRIDGE__],
    ];
    const failures = [];
    for (const [source, candidate] of probes) {
      try {
        const payload = await callBridge(candidate, source);
        if (payload && payload.available !== false) return payload;
        if (payload && payload.available === false) failures.push({ source, reason: payload.reason || 'Bridge probe returned unavailable.' });
      } catch (error) {
        failures.push({ source, reason: error && error.message ? error.message : String(error) });
      }
    }
    return {
      available: false,
      source: failures[0] ? failures[0].source : 'app-instrumentation',
      reason: failures[0] ? failures[0].reason : 'No semantic or React Native bridge global was found.',
      failures,
    };
  })()`;
}

function normalizeSemanticBridgeSnapshot(value: Record<string, any>, filters: SnapshotFilters): {
  source: string;
  bridgeVersion: string | null;
  routeHint: string | null;
  refs: Array<Partial<RefRecord> & { raw?: unknown }>;
  rawCount: number;
  reason?: string;
  limitations: string[];
} {
  const source = typeof value.source === "string" ? value.source : "app-instrumentation";
  const rawRefs = firstArray(value.refs, value.tree, value.nodes, value.elements, value.items);
  const refs = rawRefs
    .map((node) => normalizeSemanticRef(node, filters))
    .filter((node): node is Partial<RefRecord> & { raw?: unknown } => Boolean(node));
  return {
    source,
    bridgeVersion: typeof value.bridgeVersion === "string" ? value.bridgeVersion : typeof value.version === "string" ? value.version : null,
    routeHint: typeof value.routeHint === "string" ? value.routeHint : typeof value.route === "string" ? value.route : null,
    refs,
    rawCount: rawRefs.length,
    reason: typeof value.reason === "string" ? value.reason : undefined,
    limitations: Array.isArray(value.limitations) ? value.limitations.map(String) : [
      "Semantic snapshot data comes from app-side dev instrumentation exposed through Hermes Runtime.evaluate.",
    ],
  };
}

function normalizeSemanticRef(node: unknown, filters: SnapshotFilters): (Partial<RefRecord> & { raw?: unknown }) | null {
  const record = asRecord(node);
  if (!record) return null;
  const role = stringOrNull(record.role ?? record.accessibilityRole ?? record.type);
  const actions = actionsFrom(record.actions ?? record.accessibilityActions ?? record.handlers);
  if (filters.interactiveOnly && actions.length === 0 && !role) return null;
  return {
    role,
    label: stringOrNull(record.label ?? record.accessibilityLabel ?? record.title ?? record.name),
    text: stringOrNull(record.text ?? record.children ?? record.value),
    placeholder: stringOrNull(record.placeholder ?? record.placeholderText),
    testID: stringOrNull(record.testID ?? record.testId ?? record.testid),
    nativeID: stringOrNull(record.nativeID ?? record.nativeId),
    component: stringOrNull(record.component ?? record.componentName ?? record.displayName ?? record.name ?? record.type),
    source: record.source ?? record.sourceLocation ?? record._source ?? null,
    box: normalizeBox(record.box ?? record.bounds ?? record.frame ?? record.layout),
    actions,
    disabled: typeof record.disabled === "boolean" ? record.disabled : undefined,
    raw: node,
  };
}

function firstArray(...values: unknown[]): unknown[] {
  for (const value of values) {
    if (Array.isArray(value)) return value;
  }
  return [];
}

function actionsFrom(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => typeof item === "string" ? item : stringOrNull(asRecord(item)?.name ?? asRecord(item)?.action))
    .filter((item): item is string => Boolean(item));
}

function normalizeBox(value: unknown): ScreenBox | null {
  const record = asRecord(value);
  if (!record) return null;
  const x = numberOrNull(record.x ?? record.left);
  const y = numberOrNull(record.y ?? record.top);
  const width = numberOrNull(record.width ?? record.w);
  const height = numberOrNull(record.height ?? record.h);
  return x == null || y == null || width == null || height == null ? null : { x, y, width, height };
}

function clampNumber(value: unknown, min: number, max: number): number {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`Expected a finite number, got ${String(value)}.`);
  return Math.min(Math.max(number, min), max);
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function numberOrNull(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function asRecord(value: unknown): Record<string, any> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : null;
}

function commandPath(command: string): Promise<string | null> {
  return new Promise((resolve) => {
    nodeExecFile("which", [command], { timeout: 5000 }, (error, stdout) => {
      resolve(error ? null : String(stdout ?? "").trim() || null);
    });
  });
}

function execFile(
  file: string,
  args: string[],
  options: { timeout: number },
): Promise<{ stdout: string; stderr: string; error?: unknown }> {
  return new Promise((resolve) => {
    nodeExecFile(file, args, { timeout: options.timeout, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
      resolve({
        stdout: String(stdout ?? ""),
        stderr: String(stderr ?? ""),
        error: error ? { message: error.message, code: error.code, signal: error.signal } : undefined,
      });
    });
  });
}

async function readJson(file: string): Promise<any> {
  return JSON.parse(await readFile(file, "utf8"));
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function formatError(error: unknown): string {
  if (!error) {
    return "Unknown error";
  }
  const record = error as { message?: unknown; stdout?: unknown; stderr?: unknown };
  const parts = [record.message ?? String(error)];
  if (record.stdout) parts.push(`stdout:\n${truncate(record.stdout)}`);
  if (record.stderr) parts.push(`stderr:\n${truncate(record.stderr)}`);
  return parts.join("\n\n");
}

function truncate(value: unknown, limit = 4_000): string {
  const text = String(value ?? "");
  return text.length <= limit ? text : `${text.slice(0, limit)}\n[truncated ${text.length - limit} characters]`;
}
