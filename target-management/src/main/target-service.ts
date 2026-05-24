import type {
  TargetCommandArgs,
  TargetCommandResult,
  TargetCurrentResult,
  TargetDependencies,
  TargetListResult,
  TargetRecord,
  TargetUnavailableResult,
} from "./domain.js";
import { discoverTargets } from "./discovery.js";
import { requireString } from "./validation.js";

/**
 * RULE-009: lists current target candidates and annotates a selected target
 * when a session already has one.
 */
export async function listTargets(
  args: Pick<TargetCommandArgs, "platform" | "metroPort" | "stateRoot">,
  deps: TargetDependencies,
): Promise<TargetListResult> {
  const session = await deps.readLatestSession(args.stateRoot);
  const targets = await discoverTargets({ ...args, selectedTargetId: session?.activeTargetId ?? null }, deps);
  return { available: targets.length > 0, targets };
}

export async function selectTarget(
  args: Pick<TargetCommandArgs, "targetId" | "platform" | "metroPort" | "stateRoot" | "now">,
  deps: TargetDependencies,
): Promise<TargetRecord | TargetUnavailableResult> {
  const session = await deps.readLatestSession(args.stateRoot);
  if (!session) {
    return { available: false, reason: "No session exists. Run `expo-ios --json session new review` first." };
  }

  const targetId = requireString(args.targetId, "targetId");
  const targets = await discoverTargets({ ...args, selectedTargetId: session.activeTargetId }, deps);
  const target = targets.find((item) => item.targetId === targetId);
  if (!target) {
    return { available: false, reason: "Target not found.", targetId, targets };
  }
  const selected: TargetRecord = { ...target, selected: true, stale: false };
  await deps.updateSessionRecord(args.stateRoot, {
    ...session,
    activeTargetId: selected.targetId,
    updatedAt: (args.now ?? (() => new Date()))().toISOString(),
  });
  await deps.writePersistedTarget(args.stateRoot, session.sessionId, selected);
  return selected;
}

/**
 * RULE-009/RULE-010: returns the current selected target when rediscovered,
 * otherwise a stable unavailable payload that downstream snapshot capture can
 * use as its precondition.
 */
export async function getCurrentTarget(
  args: Pick<TargetCommandArgs, "platform" | "metroPort" | "stateRoot">,
  deps: TargetDependencies,
): Promise<TargetCurrentResult> {
  const session = await deps.readLatestSession(args.stateRoot);
  if (!session) {
    return { available: false, reason: "No session exists. Run `expo-ios --json session new review` first." };
  }

  if (!session.activeTargetId) {
    return {
      available: false,
      reason: "No target selected for the current session.",
      sessionId: session.sessionId,
    };
  }

  const targets = await discoverTargets({ ...args, selectedTargetId: session.activeTargetId }, deps);
  const current = targets.find((item) => item.targetId === session.activeTargetId);
  if (current) {
    return {
      available: true,
      sessionId: session.sessionId,
      target: { ...current, selected: true, stale: false },
    };
  }

  const persisted = await deps.readPersistedTarget(args.stateRoot, session.sessionId).catch(() => null);
  return {
    available: false,
    reason: "Selected target is stale.",
    sessionId: session.sessionId,
    target: persisted
      ? { ...persisted, selected: true, stale: true }
      : { targetId: session.activeTargetId, selected: true, stale: true },
  };
}

/**
 * Compatibility facade for the legacy CLI command switch.
 */
export async function targetCommand(args: TargetCommandArgs, deps: TargetDependencies): Promise<TargetCommandResult> {
  const action = requireString(args.action ?? "list", "action");
  if (!["list", "select", "current"].includes(action)) {
    throw new Error(`Unknown target action: ${action}`);
  }

  if (action === "list") {
    return listTargets(args, deps);
  }
  if (action === "select") {
    return selectTarget(args, deps);
  }
  return getCurrentTarget(args, deps);
}
