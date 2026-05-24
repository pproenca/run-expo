import { REDACTED } from "./domain.js";

const SECRET_KEY_PATTERN = /token|authorization|cookie|password|secret|apikey|apiKey/i;
const URL_QUERY_SECRET_PATTERN = /([?&](cookie|token|authorization|password|secret)=)[^&]+/gi;
const FREEFORM_SECRET_PATTERN = /\b(token|authorization|password|secret)=([^\s&]+)/gi;
const BEARER_SECRET_PATTERN = /(authorization=\[redacted\]\s+)[^\s&]+/gi;

/**
 * RULE-002: recursively redacts JSON-shaped values using the legacy key and
 * URL query semantics.
 */
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export function redactJson<T extends JsonValue>(value: T, key = ""): T {
  if (typeof value === "string") {
    if (isSecretKey(key)) {
      return REDACTED as T;
    }
    return redactText(value) as T;
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactJson(item, key)) as T;
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([childKey, childValue]) => [
      childKey,
      isSecretKey(childKey) ? REDACTED : redactJson(childValue, childKey),
    ]),
  ) as T;
}

export function redactText(value: string | null | undefined): string {
  return String(value ?? "")
    .replace(URL_QUERY_SECRET_PATTERN, `$1${REDACTED}`)
    .replace(FREEFORM_SECRET_PATTERN, `$1=${REDACTED}`)
    .replace(BEARER_SECRET_PATTERN, `$1${REDACTED}`);
}

export function redactValue<T>(value: T, key = ""): T {
  if (typeof value === "string") {
    return (isSecretKey(key) ? REDACTED : redactText(value)) as T;
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, key)) as T;
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([childKey, childValue]) => [
      childKey,
      isSecretKey(childKey) ? REDACTED : redactValue(childValue, childKey),
    ]),
  ) as T;
}

export function sanitizeErrorMessage(message: unknown): string {
  return redactText(String(message ?? ""));
}

export function formatError(error: unknown, limit = 40_000): string {
  if (!error) return "Unknown error";
  const record = error as { message?: unknown; stdout?: unknown; stderr?: unknown };
  const parts = [record.message ?? String(error)];
  if (record.stdout) parts.push(`stdout:\n${truncateOutput(record.stdout, limit)}`);
  if (record.stderr) parts.push(`stderr:\n${truncateOutput(record.stderr, limit)}`);
  return parts.join("\n\n");
}

export function truncateOutput(value: unknown, limit = 40_000): string {
  const text = String(value ?? "");
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}\n[truncated ${text.length - limit} characters]`;
}

export function isSecretKey(key: string): boolean {
  return SECRET_KEY_PATTERN.test(key);
}
