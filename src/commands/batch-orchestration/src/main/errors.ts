import { EXIT_INVALID_USAGE, EXIT_RUNTIME_FAILURE } from "./domain.js";
import type { BatchErrorEnvelope } from "./domain.js";
import {
  formatError,
  redactValue,
  sanitizeErrorMessage,
  truncateOutput,
} from "../../../../core/policy-redaction/src/main/redactor.ts";

const MAX_OUTPUT = 40_000;

export {
  formatError,
  redactValue,
  sanitizeErrorMessage,
};

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

export function truncate(value: unknown, limit = MAX_OUTPUT): string {
  return truncateOutput(value, limit);
}
