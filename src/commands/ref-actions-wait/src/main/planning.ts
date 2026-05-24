import type { RefActionDependencies, RefBox, RefRecord } from "./domain.js";
import { clampNumber, requireString } from "./common.js";

export async function planRefActionWithDeps(
  args: Record<string, unknown>,
  deps: RefActionDependencies,
): Promise<Record<string, unknown>> {
  const action = requireString(args.action, "action");
  const ref = requireString(args.ref, "ref");
  const cache = await deps.readLatestRefCache(args);
  if (!cache) {
    return { available: false, reason: "No snapshot exists for the current session." };
  }
  const record = cache.refs.find((item) => item.ref === ref);
  if (!record) {
    return { available: false, reason: "Ref not found in the latest snapshot.", ref };
  }
  if (record.stale) {
    return { available: false, reason: "Ref is stale. Capture a new snapshot before acting.", ref };
  }
  if (!record.actions.includes(action)) {
    return {
      available: false,
      reason: "Action is not available for this ref.",
      ref,
      action,
      availableActions: record.actions,
    };
  }
  return {
    available: true,
    dryRun: true,
    plan: {
      action,
      ref,
      targetId: record.targetId,
      box: record.box ?? null,
      point: record.box ? centerPoint(record.box) : null,
    },
  };
}

export async function refPointWithDeps(
  refValue: unknown,
  deps: RefActionDependencies,
): Promise<Record<string, unknown>> {
  const ref = requireString(refValue, "ref");
  const found = await readRefRecord(ref, deps);
  if (found.available === false) {
    return found;
  }
  const box = found.record.box;
  if (!box) {
    return { available: false, reason: "Ref does not include bounds.", ref };
  }
  return {
    available: true,
    ref,
    point: centerPoint(box),
    box,
  };
}

export async function scrollPlanWithDeps(
  args: Record<string, unknown>,
  deps: RefActionDependencies,
): Promise<Record<string, unknown>> {
  const maybeRef = /^@e\d+$/.test(String(args.ref ?? "")) ? args.ref : null;
  const direction = requireString(
    maybeRef ? args.targetRef ?? args.direction : args.direction ?? args.ref,
    "direction",
  ).toLowerCase();
  const amount = clampNumber(args.amount ?? args.text ?? 600, 1, 5000);
  const origin = maybeRef ? await readRefPoint(maybeRef, args, deps) : { available: true, point: { x: 200, y: 700 } };
  if (origin.available === false) {
    return origin;
  }
  const point = origin.point as { x: number; y: number };
  const delta = {
    down: { x: 0, y: -amount },
    up: { x: 0, y: amount },
    left: { x: amount, y: 0 },
    right: { x: -amount, y: 0 },
  }[direction];
  if (!delta) {
    return { available: false, reason: `Unknown scroll direction: ${direction}`, direction };
  }
  return {
    available: true,
    dryRun: true,
    action: "scroll",
    direction,
    amount,
    coordinates: {
      startX: point.x,
      startY: point.y,
      endX: point.x + delta.x,
      endY: point.y + delta.y,
    },
  };
}

async function readRefRecord(
  ref: string,
  deps: RefActionDependencies,
  args?: Record<string, unknown>,
): Promise<{ available: true; record: RefRecord } | { available: false; reason: string; ref: string }> {
  const cache = await deps.readLatestRefCache(args);
  if (!cache) return { available: false, reason: "No snapshot exists for the current session.", ref };
  const record = cache.refs.find((item) => item.ref === ref);
  if (!record) return { available: false, reason: "Ref not found in the latest snapshot.", ref };
  if (record.stale) return { available: false, reason: "Ref is stale. Capture a new snapshot before acting.", ref };
  return { available: true, record };
}

async function readRefPoint(refValue: unknown, args: Record<string, unknown>, deps: RefActionDependencies): Promise<Record<string, unknown>> {
  const ref = requireString(refValue, "ref");
  const found = await readRefRecord(ref, deps, args);
  if (found.available === false) {
    return found;
  }
  const box = found.record.box;
  if (!box) {
    return { available: false, reason: "Ref does not include bounds.", ref };
  }
  return {
    available: true,
    ref,
    point: centerPoint(box),
    box,
  };
}

function centerPoint(box: RefBox): { x: number; y: number } {
  return {
    x: box.x + box.width / 2,
    y: box.y + box.height / 2,
  };
}
