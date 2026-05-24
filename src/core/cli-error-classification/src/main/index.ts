export const EXIT_SUCCESS = 0;
export const EXIT_RUNTIME_FAILURE = 1;
export const EXIT_INVALID_USAGE = 2;

export type CliErrorCode = "invalid_usage" | "runtime_failure" | "error";

export class CliUsageError extends Error {
  readonly exitCode = EXIT_INVALID_USAGE;

  constructor(message: string) {
    super(message);
    this.name = "CliUsageError";
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

export function errorCodeForExitCode(exitCode: number): CliErrorCode {
  if (exitCode === EXIT_INVALID_USAGE) return "invalid_usage";
  if (exitCode === EXIT_RUNTIME_FAILURE) return "runtime_failure";
  return "error";
}
