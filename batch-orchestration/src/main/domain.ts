export const EXIT_RUNTIME_FAILURE = 1;
export const EXIT_INVALID_USAGE = 2;

export class CliUsageError extends Error {
  readonly exitCode = EXIT_INVALID_USAGE;

  constructor(message: string) {
    super(message);
    this.name = "CliUsageError";
  }
}

export interface ToolTextResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

export interface ParsedCliArgs {
  globals: Record<string, unknown>;
  command: string | null;
  args: Record<string, unknown> & { _: unknown[] };
}

export interface RunToolOptions {
  command: string;
  globals: Record<string, unknown>;
  silent?: boolean;
}

export interface BatchDependencies {
  runTool: (toolName: string, args: Record<string, unknown>, options: RunToolOptions) => Promise<unknown> | unknown;
}

export interface BatchStepSuccess {
  index: number;
  command: string;
  ok: true;
  data: unknown;
}

export interface BatchStepFailure {
  index: number;
  command: string | null;
  ok: false;
  error: BatchErrorEnvelope;
}

export interface BatchErrorEnvelope {
  code: "invalid_usage" | "runtime_failure" | "error";
  message: string;
  exitCode: number;
}

export interface BatchPayload {
  ok: boolean;
  bail: boolean;
  failureIndex: number | null;
  steps: Array<BatchStepSuccess | BatchStepFailure>;
}
