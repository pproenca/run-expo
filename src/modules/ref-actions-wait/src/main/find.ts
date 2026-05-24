import type { RefActionDependencies, RefRecord, ToolTextResult } from "./domain.js";
import { clampNumber, normalizeFinderText, requireString, toolJson, unwrapToolJson } from "./common.js";
import { defaultRefActionDependencies } from "./defaults.js";

/**
 * RULE-008: finder operations only use the latest cached refs and can attach
 * a dry-run action plan for the first match.
 */
export async function findCommand(
  args: Record<string, unknown>,
  deps: RefActionDependencies = defaultRefActionDependencies,
): Promise<ToolTextResult> {
  const kind = requireString(args.kind, "kind").toLowerCase();
  const value = requireString(args.value, "value");
  const cache = await deps.readLatestRefCache(args);
  if (!cache) {
    return toolJson({ available: false, reason: "No snapshot exists for the current session." });
  }

  const matches = findMatches(cache.refs, kind, value, args.name);
  const payload: Record<string, unknown> = {
    available: matches.length > 0,
    kind,
    value,
    name: args.name ?? null,
    matches,
  };

  if (args.action) {
    payload.actionResult = matches[0]
      ? await finderActionResult({ ...args, ref: matches[0].ref }, deps)
      : { available: false, reason: "No matching ref for action.", action: args.action };
  }

  return toolJson(payload);
}

export async function finderActionResult(
  args: Record<string, unknown>,
  deps: RefActionDependencies,
): Promise<unknown> {
  const action = requireString(args.action, "action");
  const dryRun = args.dryRun !== false;
  if (!["tap", "inspect", "long-press", "fill", "scroll-into-view", "focus"].includes(action)) {
    return { available: false, reason: `Unsupported finder action: ${action}`, action };
  }
  if (deps.planFinderAction) {
    return deps.planFinderAction({ ...args, action, dryRun });
  }
  if (action === "tap" || ["long-press", "fill", "scroll-into-view", "focus"].includes(action)) {
    return unwrapToolJson(toolJson(await planUnavailable(action)));
  }
  if (action === "inspect") {
    return { available: false, reason: "Inspect action is not wired in this module.", ref: args.ref };
  }
  return { available: false, reason: `Unsupported finder action: ${action}`, action };
}

export function findMatches(refs: RefRecord[], kind: string, value: unknown, name?: unknown): RefRecord[] {
  if (kind === "first") {
    const match = refs.find((record) =>
      refMatches(record, "source", value, name)
      || refMatches(record, "text", value, name)
      || refMatches(record, "label", value, name)
    );
    return match ? [match] : [];
  }

  if (kind === "nth") {
    const index = clampNumber(Number(value), 1, Number.MAX_SAFE_INTEGER) - 1;
    const needle = requireString(name, "name");
    const matches = refs.filter((record) =>
      refMatches(record, "source", needle)
      || refMatches(record, "text", needle)
      || refMatches(record, "label", needle)
    );
    return matches[index] ? [matches[index]] : [];
  }

  return refs.filter((record) => refMatches(record, kind, value, name));
}

function refMatches(record: RefRecord, kind: string, value: unknown, name?: unknown): boolean {
  const expected = normalizeFinderText(value);
  if (kind === "role") {
    if (normalizeFinderText(record.role) !== expected) return false;
    if (!name) return true;
    const accessibleName = normalizeFinderText([record.label, record.text].filter(Boolean).join(" "));
    return accessibleName.includes(normalizeFinderText(name));
  }
  if (kind === "text") return normalizeFinderText(record.text ?? record.label).includes(expected);
  if (kind === "label") return normalizeFinderText(record.label).includes(expected);
  if (kind === "placeholder") return normalizeFinderText(record.placeholder).includes(expected);
  if (kind === "testid") return normalizeFinderText(record.testID ?? record.nativeID).includes(expected);
  if (kind === "source") {
    return normalizeFinderText([record.component, record.source?.file].filter(Boolean).join(" ")).includes(expected);
  }
  throw new Error(`Unknown finder kind: ${kind}`);
}

async function planUnavailable(action: string): Promise<Record<string, unknown>> {
  return { available: false, reason: `No action planner configured for ${action}.`, action };
}
