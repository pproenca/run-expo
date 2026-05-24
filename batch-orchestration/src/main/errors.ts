import { EXIT_INVALID_USAGE, EXIT_RUNTIME_FAILURE } from "./domain.js";
import type { BatchErrorEnvelope } from "./domain.js";

const REDACTED = "[redacted]";
const SECRET_KEY_PATTERN = /token|authorization|cookie|password|secret|apikey|apiKey/i;
const URL_QUERY_SECRET_PATTERN = /([?&](cookie|token|authorization|password|secret)=)[^&]+/gi;
const FREEFORM_SECRET_PATTERN = /\b(token|authorization|password|secret)=([^\s&]+)/gi;
const BEARER_SECRET_PATTERN = /(authorization=\[redacted\]\s+)[^\s&]+/gi;
const MAX_OUTPUT = 40_000;

export function batchStepError(error: unknown): BatchErrorEnvelope {
  const exitCode = exitCodeForError(error);
  return {
    code: errorCodeForExitCode(exitCode),
    message: sanitizeErrorMessage(formatError(error)),
    exitCode,
  };
}

export function exitCodeForError(error: unknown): number {
  const record = error as { exitCode?: unknown; message?: unknown } | null | undefined;
  if (record && Number.isInteger(record.exitCode)) {
    return record.exitCode as number;
  }
  const message = String(record?.message ?? "");
  if (/Unknown command|Unknown tool|requires a value|Expected a finite number|must be a non-empty string|must look like|must not contain whitespace|valid JSON/i.test(message)) {
    return EXIT_INVALID_USAGE;
  }
  return EXIT_RUNTIME_FAILURE;
}

export function errorCodeForExitCode(exitCode: number): "invalid_usage" | "runtime_failure" | "error" {
  if (exitCode === EXIT_INVALID_USAGE) return "invalid_usage";
  if (exitCode === EXIT_RUNTIME_FAILURE) return "runtime_failure";
  return "error";
}

export function formatError(error: unknown): string {
  if (!error) return "Unknown error";
  const record = error as { message?: unknown; stdout?: unknown; stderr?: unknown };
  const parts = [record.message ?? String(error)];
  if (record.stdout) parts.push(`stdout:\n${truncate(record.stdout)}`);
  if (record.stderr) parts.push(`stderr:\n${truncate(record.stderr)}`);
  return parts.join("\n\n");
}

export function truncate(value: unknown, limit = MAX_OUTPUT): string {
  const text = String(value ?? "");
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}\n[truncated ${text.length - limit} characters]`;
}

export function sanitizeErrorMessage(message: unknown): string {
  return redactValue(String(message ?? ""));
}

export function redactValue<T>(value: T, key = ""): T {
  if (typeof value === "string") {
    if (isSecretKey(key)) return REDACTED as T;
    return value
      .replace(URL_QUERY_SECRET_PATTERN, `$1${REDACTED}`)
      .replace(FREEFORM_SECRET_PATTERN, `$1=${REDACTED}`)
      .replace(BEARER_SECRET_PATTERN, `$1${REDACTED}`) as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, key)) as T;
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  return Object.fromEntries(Object.entries(value).map(([childKey, childValue]) => [
    childKey,
    isSecretKey(childKey) ? REDACTED : redactValue(childValue, childKey),
  ])) as T;
}

function isSecretKey(key: string): boolean {
  return SECRET_KEY_PATTERN.test(key);
}
