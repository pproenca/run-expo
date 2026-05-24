import type { SnapshotArgs, SnapshotCommandDependencies, SnapshotResult } from "./domain.js";
import { buildSnapshotFilters } from "./filters.js";
import { persistNativeSnapshot, persistSemanticSnapshot } from "./persistence.js";

export async function snapshotCommand(
  args: SnapshotArgs,
  deps: SnapshotCommandDependencies,
): Promise<SnapshotResult | { available: false; [key: string]: unknown }> {
  const stateRoot = args.stateRoot ?? "";
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
