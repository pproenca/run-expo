import {
  CliUsageError,
  errorCodeForExitCode,
  exitCodeForError,
} from "../../../../core/cli-error-classification/src/main/index.ts";

export { CliUsageError, errorCodeForExitCode, exitCodeForError };

/**
 * RULE-007: the CLI refuses simultaneous machine JSON and plain output modes.
 */
export function validateOutputMode(options: {
  json?: boolean | null;
  plain?: boolean | null;
}): void {
  if (options.json && options.plain) {
    throw new CliUsageError("--json and --plain are mutually exclusive.");
  }
}
