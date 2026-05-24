import { LEGACY_OUTPUT_TRUNCATION_SUFFIX } from "./domain.js";

export type RunPayloadSummary = {
  keys: string[];
  available: boolean | undefined;
  routeCount: unknown;
  eventCount: number | undefined;
};

/**
 * RULE-021: applies the legacy --max-output boundary to already formatted
 * command output.
 */
export function boundOutput(text: string, globals: { maxOutput?: number | null } = {}): string {
  if (globals.maxOutput === null || globals.maxOutput === undefined) {
    return text;
  }

  const max = clampNumber(globals.maxOutput, 1, 10_000_000);
  if (text.length <= max) {
    return text;
  }

  return `${text.slice(0, Math.max(0, max - LEGACY_OUTPUT_TRUNCATION_SUFFIX.length))}${LEGACY_OUTPUT_TRUNCATION_SUFFIX}`;
}

export function truncateSubprocessOutput(value: unknown, limit = 100_000): string {
  const text = String(value ?? "");
  if (text.length <= limit) {
    return text;
  }
  return `${text.slice(0, limit)}\n[truncated ${text.length - limit} characters]`;
}

export function summarizeRunPayload(payload: unknown): RunPayloadSummary | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const record = payload as Record<string, unknown>;

  return {
    keys: Object.keys(record).slice(0, 40),
    available: typeof record.available === "boolean" ? record.available : undefined,
    routeCount: record.routeCount,
    eventCount: Array.isArray(record.events) ? record.events.length : undefined,
  };
}

function clampNumber(value: unknown, min: number, max: number): number {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new Error(`Expected a finite number, got ${value}.`);
  }
  return Math.min(Math.max(number, min), max);
}
