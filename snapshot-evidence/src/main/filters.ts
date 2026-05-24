import type { SnapshotArgs, SnapshotFilters } from "./domain.js";

/**
 * RULE-010: snapshot capture converts CLI flags to the legacy filter contract
 * before either semantic or native capture runs.
 */
export function buildSnapshotFilters(args: SnapshotArgs = {}): SnapshotFilters {
  return {
    interactiveOnly: args.interactive === true,
    compact: args.compact === true,
    depth: args.depth === undefined ? null : clampNumber(args.depth, 1, 100),
    includeSource: args.source === true,
    includeBounds: args.bounds === true,
  };
}

function clampNumber(value: unknown, min: number, max: number): number {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) {
    throw new Error(`Expected a finite number, got ${value}.`);
  }
  return Math.max(min, Math.min(max, numberValue));
}
