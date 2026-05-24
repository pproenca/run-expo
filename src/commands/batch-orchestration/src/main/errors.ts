import type { BatchErrorEnvelope } from "./domain.js";
import {
  errorCodeForExitCode,
  exitCodeForError,
} from "../../../../core/cli-error-classification/src/main/index.ts";
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

export function truncate(value: unknown, limit = MAX_OUTPUT): string {
  return truncateOutput(value, limit);
}
