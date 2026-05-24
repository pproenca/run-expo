import type { ToolTextResult } from "../../../../core/tool-json-envelope/src/main/index.ts";
import {
  CliUsageError,
  EXIT_INVALID_USAGE,
  EXIT_RUNTIME_FAILURE,
} from "../../../../core/cli-error-classification/src/main/index.ts";

export type { ToolTextResult };
export { CliUsageError, EXIT_INVALID_USAGE, EXIT_RUNTIME_FAILURE };

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
  runToolAndEmitPayload: (toolName: string, args: Record<string, unknown>, options: RunToolOptions) => Promise<unknown> | unknown;
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
