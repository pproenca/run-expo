export type SafeToolSectionResult<T> = { ok: true; value: T } | { ok: false; error: string };

const MAX_OUTPUT = 16_384;

export async function safeToolSection<T>(fn: () => Promise<T> | T): Promise<SafeToolSectionResult<T>> {
  try {
    return { ok: true, value: await fn() };
  } catch (error) {
    return { ok: false, error: formatError(error) };
  }
}

export function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${field} must be a non-empty string.`);
  }
  return value.trim();
}

export function clampNumber(value: unknown, min: number, max: number): number {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new Error(`Expected a finite number, got ${String(value)}.`);
  }
  return Math.min(Math.max(number, min), max);
}

export function truncate(value: unknown, limit = MAX_OUTPUT): string {
  const text = String(value ?? "");
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}\n[truncated ${text.length - limit} characters]`;
}

export function formatError(error: unknown): string {
  if (!error) return "Unknown error";
  const record = typeof error === "object" ? error as Record<string, unknown> : null;
  const parts = [record && "message" in record ? record.message : String(error)];
  if (record?.stdout) parts.push(`stdout:\n${truncate(record.stdout)}`);
  if (record?.stderr) parts.push(`stderr:\n${truncate(record.stderr)}`);
  return parts.join("\n\n");
}
