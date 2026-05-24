import { MAX_OUTPUT, REDACTED } from "./domain.js";

const SECRET_KEY_PATTERN = /token|authorization|cookie|password|secret|apikey|apiKey/i;
const URL_QUERY_SECRET_PATTERN = /([?&](cookie|token|authorization|password|secret)=)[^&]+/gi;

export function redactValue<T>(value: T, key = ""): T {
  if (typeof value === "string") {
    if (isSecretKey(key)) {
      return REDACTED as T;
    }
    return value.replace(URL_QUERY_SECRET_PATTERN, `$1${REDACTED}`) as T;
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
  return redactValue(String(message ?? ""));
}

export function formatError(error: unknown): string {
  if (!error) {
    return "Unknown error";
  }
  const record = error as { message?: unknown; stdout?: unknown; stderr?: unknown };
  const parts = [record.message ?? String(error)];
  if (record.stdout) {
    parts.push(`stdout:\n${truncate(record.stdout)}`);
  }
  if (record.stderr) {
    parts.push(`stderr:\n${truncate(record.stderr)}`);
  }
  return parts.join("\n\n");
}

function isSecretKey(key: string): boolean {
  return SECRET_KEY_PATTERN.test(key);
}

export function truncateOutput(value: unknown, limit = MAX_OUTPUT): string {
  const text = String(value ?? "");
  if (text.length <= limit) {
    return text;
  }
  return `${text.slice(0, limit)}\n[truncated ${text.length - limit} characters]`;
}

const truncate = truncateOutput;
