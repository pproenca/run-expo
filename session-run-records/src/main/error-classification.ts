import { EXIT_INVALID_USAGE, EXIT_RUNTIME_FAILURE } from "./domain.js";

export class CliUsageError extends Error {
  readonly exitCode = EXIT_INVALID_USAGE;

  constructor(message: string) {
    super(message);
    this.name = "CliUsageError";
  }
}

/**
 * RULE-007: the CLI refuses simultaneous machine JSON and plain output modes.
 */
export function validateOutputMode(options: { json?: boolean | null; plain?: boolean | null }): void {
  if (options.json && options.plain) {
    throw new CliUsageError("--json and --plain are mutually exclusive.");
  }
}

export function exitCodeForError(error: unknown): number {
  const record = error as { exitCode?: unknown; message?: unknown } | null | undefined;
  const explicitExitCode = record?.exitCode;
  if (Number.isInteger(explicitExitCode)) {
    return explicitExitCode as number;
  }
  const message = String(record?.message ?? "");
  if (/Unknown command|Unknown tool|requires a value|Expected a finite number|must be a non-empty string|must look like|must not contain whitespace|valid JSON|mutually exclusive/i.test(message)) {
    return EXIT_INVALID_USAGE;
  }
  return EXIT_RUNTIME_FAILURE;
}

export function errorCodeForExitCode(exitCode: number): "invalid_usage" | "runtime_failure" | "error" {
  switch (exitCode) {
    case EXIT_INVALID_USAGE:
      return "invalid_usage";
    case EXIT_RUNTIME_FAILURE:
      return "runtime_failure";
    default:
      return "error";
  }
}
