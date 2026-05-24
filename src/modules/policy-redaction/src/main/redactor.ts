import { REDACTED } from "./domain.js";

const SECRET_KEY_PATTERN = /token|authorization|cookie|password|secret|apikey|apiKey/i;
const URL_QUERY_SECRET_PATTERN =
  /([?&](cookie|token|authorization|password|secret)=)[^&]+/gi;

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
      isSecretKey(childKey) ? REDACTED : redactJson(childValue, childKey)
    ])
  ) as T;
}

export function redactText(value: string | null | undefined): string {
  return String(value ?? "").replace(
    URL_QUERY_SECRET_PATTERN,
    `$1${REDACTED}`
  );
}

export function sanitizeErrorMessage(message: unknown): string {
  return redactText(String(message ?? ""));
}

export function isSecretKey(key: string): boolean {
  return SECRET_KEY_PATTERN.test(key);
}
