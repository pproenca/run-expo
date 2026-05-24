import { policyDeniedPayload as sharedPolicyDeniedPayload } from "../../../../core/policy-redaction/src/main/policy-service.ts";
import type {
  ActionPolicyDecision,
  GesturePlan,
  InteractionArgs,
  InteractionDependencies,
  InteractionPayload,
  Platform,
  RefActionAdapterDependencies,
  RefActionModule,
  ToolTextResult,
} from "./types.js";
import { MAX_OUTPUT } from "./types.js";

export function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${field} must be a non-empty string.`);
  return value.trim();
}

export function clampNumber(value: unknown, min: number, max: number): number {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`Expected a finite number, got ${value}.`);
  return Math.min(Math.max(number, min), max);
}

export function truncate(value: unknown, limit = MAX_OUTPUT): string {
  const text = String(value ?? "");
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}\n[truncated ${text.length - limit} characters]`;
}

export function toolJson(value: unknown): ToolTextResult {
  return { content: [{ type: "text", text: `${JSON.stringify(value, null, 2)}\n` }], isError: false };
}

export function createRefActionAdapter(
  refDeps: RefActionAdapterDependencies,
  refActions: RefActionModule,
): Pick<InteractionDependencies, "planRefAction" | "readRefRecord" | "refPoint" | "scrollPlan"> {
  return {
    planRefAction: (args) => refActions.planRefAction(args, refDeps),
    readRefRecord: async (ref, args) => readRefRecordFromCache(ref, args, refDeps),
    refPoint: async (ref, args) => refPointFromCache(ref, args, refDeps),
    scrollPlan: (args) => refActions.scrollPlan(args, refDeps),
  };
}

export function policyDeniedPayload({ domain, action, policy }: { domain: string; action: string; policy: ActionPolicyDecision }): InteractionPayload {
  return sharedPolicyDeniedPayload({ domain, action, policy });
}

export async function readRefRecordFromCache(
  refValue: unknown,
  args: InteractionArgs,
  deps: RefActionAdapterDependencies,
): Promise<InteractionPayload> {
  const ref = requireString(refValue, "ref");
  const cache = await deps.readLatestRefCache(args);
  if (!cache) return { available: false, reason: "No snapshot exists for the current session.", ref };
  const record = cache.refs.find((item) => item.ref === ref);
  if (!record) return { available: false, reason: "Ref not found in the latest snapshot.", ref };
  if (record.stale) return { available: false, reason: "Ref is stale. Capture a new snapshot before acting.", ref };
  return { available: true, record, cache };
}

export async function refPointFromCache(
  refValue: unknown,
  args: InteractionArgs,
  deps: RefActionAdapterDependencies,
): Promise<InteractionPayload> {
  const ref = requireString(refValue, "ref");
  const found = await readRefRecordFromCache(ref, args, deps);
  if (found.available === false) return found;
  const record = asRecord(found.record);
  const box = asRecord(record.box);
  if (!box) return { available: false, reason: "Ref does not include bounds.", ref };
  const x = Number(box.x) + Number(box.width) / 2;
  const y = Number(box.y) + Number(box.height) / 2;
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return { available: false, reason: "Ref bounds are not finite.", ref, box };
  }
  return {
    available: true,
    ref,
    point: { x, y },
    box,
  };
}

export async function policyGate(
  args: InteractionArgs,
  action: string,
  domain: string,
  deps: InteractionDependencies,
): Promise<InteractionPayload | null> {
  const policy = await deps.policyDecision(args, action, "device");
  return policy.allowed ? null : policyDeniedPayload({ domain, action, policy });
}

export async function resolveIosInteractionTool(deps: InteractionDependencies): Promise<{ tool: "idb" | "axe"; path: string } | null> {
  const idb = await deps.commandPath("idb");
  if (idb) return { tool: "idb", path: idb };
  const axe = await deps.commandPath("axe");
  if (axe) return { tool: "axe", path: axe };
  return null;
}

export function androidDeviceArgs(device: string | null, args: string[]): string[] {
  return device ? ["-s", device, ...args] : args;
}

export function platformArg(value: unknown): Platform {
  return value === "android" ? "android" : "ios";
}

export function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function asRecord(value: unknown): InteractionPayload {
  return value && typeof value === "object" ? value as InteractionPayload : {};
}

export function isFinitePoint(value: InteractionPayload): value is { x: number; y: number } {
  return Number.isFinite(value.x) && Number.isFinite(value.y);
}

export function asGesturePlan(value: unknown): GesturePlan {
  const record = asRecord(value);
  return {
    tool: String(record.tool ?? ""),
    command: Array.isArray(record.command) ? record.command.map(String) : [],
    repeat: Number(record.repeat ?? 1),
    intervalMs: Number(record.intervalMs ?? 0),
    notes: Array.isArray(record.notes) ? record.notes.map(String) : [],
  };
}

export function unwrapToolPayload(value: ToolTextResult | Record<string, unknown>): InteractionPayload {
  if (value && typeof value === "object" && Array.isArray((value as ToolTextResult).content)) {
    const text = (value as ToolTextResult).content[0]?.text ?? "{}";
    return JSON.parse(text) as InteractionPayload;
  }
  return asRecord(value);
}

export function formatSeconds(ms: number): string {
  return (ms / 1000).toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

export function reviewQuestions(): string[] {
  return [
    "Does a long press stay on the intended target instead of becoming scroll?",
    "Does a drag/swipe create, resize, or scroll according to the intended mode?",
    "Do screenshots before and after show unintended movement, selection, or chrome overlap?",
    "Do React commits/layout changes during the gesture match the expected interaction owner?",
  ];
}
