import type { ToolTextResult } from "./domain.js";

export function toolJson(value: unknown): ToolTextResult {
  return { content: [{ type: "text", text: `${JSON.stringify(value, null, 2)}\n` }] };
}

export function unwrapToolJson(result: ToolTextResult): unknown {
  const text = result?.content?.[0]?.text;
  if (typeof text !== "string") {
    return result;
  }
  try {
    return JSON.parse(text);
  } catch {
    return { text };
  }
}

export function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${field} must be a non-empty string.`);
  }
  return value.trim();
}

export function clampNumber(value: unknown, min: number, max: number): number {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) {
    throw new Error(`Expected a finite number, got ${value}.`);
  }
  return Math.min(Math.max(numberValue, min), max);
}

export function normalizeFinderText(value: unknown): string {
  return String(value ?? "").toLowerCase().trim();
}
