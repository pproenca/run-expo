import {
  toolJson,
  unwrapToolJson,
  type ToolTextResult,
} from "../../../tool-json-envelope/src/main/index.ts";
import { CURRENT_CLI_NAME, CLI_VERSION } from "../../../cli-identity/src/main/index.ts";
import { COMMAND_ALIASES, commandAliases } from "../../../command-surface/src/main/index.ts";
import {
  formatError,
  redactValue,
  sanitizeErrorMessage,
  truncateOutput,
} from "../../../policy-redaction/src/main/redactor.ts";

export const EXIT_SUCCESS = 0;
export const EXIT_RUNTIME_FAILURE = 1;
export const EXIT_INVALID_USAGE = 2;
export const CLI_NAME = CURRENT_CLI_NAME;
export const REDACTED = "[redacted]";

export { toolJson, unwrapToolJson };
export {
  formatError,
  redactValue,
  sanitizeErrorMessage,
};
export type { ToolTextResult };

export interface CliGlobals {
  json: boolean;
  plain: boolean;
  quiet: boolean;
  debug: boolean;
  maxOutput: string | number | null;
  contentBoundaries: boolean;
  [key: string]: unknown;
}

export interface ParsedCommand {
  command: string | null;
  args: Record<string, unknown> & { _: unknown[] };
  globals: CliGlobals;
}

export interface RunToolOptions {
  command: string;
  globals: CliGlobals;
  silent?: boolean;
}

export type ToolHandler = (args: Record<string, unknown>) => Promise<unknown> | unknown;

export interface RunRecorder {
  path: string | null;
  finish(entry: { status: "completed" | "failed"; exitCode: number; payload?: unknown; error?: unknown }): Promise<void> | void;
}

export interface DispatchDependencies {
  handlers: Record<string, ToolHandler>;
  projectArgs?: (command: string, args: ParsedCommand["args"], globals: CliGlobals) => Record<string, unknown>;
  startRunRecord?: (entry: { command: string; args: Record<string, unknown>; globals: CliGlobals }) => Promise<RunRecorder> | RunRecorder;
  stdout?: (text: string) => void;
  stderr?: (text: string) => void;
  printHelp?: () => string;
  cliVersion?: string;
}

export class CliUsageError extends Error {
  readonly exitCode = EXIT_INVALID_USAGE;

  constructor(message: string) {
    super(message);
    this.name = "CliUsageError";
  }
}

export { COMMAND_ALIASES, commandAliases };

export async function dispatchCommand(parsed: ParsedCommand, dependencies: DispatchDependencies): Promise<number> {
  const { globals, command, args } = parsed;
  const stdout = dependencies.stdout ?? (() => {});
  const stderr = dependencies.stderr ?? (() => {});

  if (globals.json && globals.plain) {
    throw new CliUsageError("--json and --plain are mutually exclusive.");
  }

  if (globals.version) {
    stdout(`${dependencies.cliVersion ?? CLI_VERSION}\n`);
    return EXIT_SUCCESS;
  }

  if (globals.help || !command || command === "help" || args.help) {
    stdout(dependencies.printHelp ? dependencies.printHelp() : "");
    return EXIT_SUCCESS;
  }

  const toolName = COMMAND_ALIASES[command];
  if (!toolName) {
    throw new CliUsageError(`Unknown command: ${command}`);
  }

  const effectiveArgs = dependencies.projectArgs ? dependencies.projectArgs(command, args, globals) : pickDefined({ ...args });
  const recorder = await (dependencies.startRunRecord
    ? dependencies.startRunRecord({ command, args: effectiveArgs, globals })
    : noopRecorder());

  try {
    const payload = await runToolAndEmitPayload(toolName, effectiveArgs, {
      handlers: dependencies.handlers,
      command,
      globals,
      stdout,
    });
    await recorder.finish({ status: "completed", exitCode: EXIT_SUCCESS, payload });
    if (globals.debug && recorder.path) {
      stderr(`run-record: ${recorder.path}\n`);
    }
    return EXIT_SUCCESS;
  } catch (error) {
    const exitCode = exitCodeForError(error);
    await recorder.finish({ status: "failed", exitCode, error });
    if (globals.debug && recorder.path) {
      stderr(`run-record: ${recorder.path}\n`);
    }
    throw error;
  }
}

export async function runToolAndEmitPayload(
  toolName: string,
  args: Record<string, unknown>,
  options: RunToolOptions & { handlers: Record<string, ToolHandler>; stdout?: (text: string) => void },
): Promise<unknown> {
  const handler = options.handlers[toolName];
  if (!handler) {
    throw new CliUsageError(`Unknown tool: ${toolName}`);
  }
  const result = await handler(args);
  const payload = unwrapToolJson(result);
  const redactedPayload = redactValue(payload);
  if (!options.silent) {
    const text = formatCliPayload(redactedPayload, options);
    if (text !== null) {
      (options.stdout ?? (() => {}))(text);
    }
  }
  return redactedPayload;
}

export function formatCliPayload(payload: unknown, options: RunToolOptions): string | null {
  const globals = options.globals;
  if (globals.quiet && !globals.json) {
    return null;
  }
  const maybeBoundedPayload = globals.contentBoundaries === true
    ? { contentBoundary: "expo98-untrusted-output", payload }
    : payload;
  if (globals.json) {
    return boundOutput(`${JSON.stringify({ ok: true, data: maybeBoundedPayload }, null, 2)}\n`, globals);
  }
  if (globals.plain) {
    return boundOutput(`${plainPayload(options.command, maybeBoundedPayload).join("\n")}\n`, globals);
  }
  return boundOutput(`${JSON.stringify(maybeBoundedPayload, null, 2)}\n`, globals);
}

export function boundOutput(text: string, globals: Pick<CliGlobals, "maxOutput"> = { maxOutput: null }): string {
  if (globals.maxOutput === null || globals.maxOutput === undefined) {
    return text;
  }
  const max = clampNumber(globals.maxOutput, 1, 10_000_000);
  if (text.length <= max) {
    return text;
  }
  const suffix = "\n[expo98 output truncated by --max-output]\n";
  return `${text.slice(0, Math.max(0, max - suffix.length))}${suffix}`;
}

export function formatCliError(error: unknown, options: CliGlobals): string | null {
  if (options.quiet && !options.json) {
    return null;
  }
  const exitCode = exitCodeForError(error);
  const payload: {
    ok: false;
    error: {
      code: "invalid_usage" | "runtime_failure" | "error";
      message: string;
      exitCode: number;
      name?: string;
    };
  } = {
    ok: false,
    error: {
      code: errorCodeForExitCode(exitCode),
      message: sanitizeErrorMessage(formatError(error)),
      exitCode,
    },
  };
  if (options.debug) {
    payload.error.name = (error as { name?: string } | null | undefined)?.name ?? "Error";
  }
  if (options.json || options.plain !== true) {
    return `${JSON.stringify(payload, null, 2)}\n`;
  }
  return `error: ${payload.error.message}\n`;
}

export function plainPayload(command: string, payload: any): string[] {
  const lines = ["ok: true", `command: ${command}`];
  if (command === "doctor") {
    lines.push(`cli: ${payload.cli?.name ?? CLI_NAME} ${payload.cli?.version ?? CLI_VERSION}`);
    lines.push(`cwd: ${payload.cwd ?? ""}`);
    lines.push(`ios-simulator: ${payload.capabilities?.iosSimulator ? "yes" : "no"}`);
    lines.push(`expo-cli: ${payload.capabilities?.expoCli ? "yes" : "no"}`);
    return lines;
  }
  if (command === "routes") {
    lines.push(`routes: ${payload.routeCount ?? payload.routes?.length ?? 0}`);
    for (const route of payload.routes ?? []) {
      lines.push(`route: ${route.route} ${route.file}`);
    }
    return lines;
  }
  if (command === "review-next") {
    lines.push(`toc-step: ${payload.constraint?.tocStep ?? ""}`);
    lines.push(`next: ${payload.nextStep ?? ""}`);
    for (const suggested of payload.suggestedCommands ?? []) {
      lines.push(`suggested-command: ${suggested}`);
    }
    return lines;
  }
  if (payload.available === false && payload.reason) {
    lines.push("available: false");
    lines.push(`reason: ${payload.reason}`);
    return lines;
  }
  lines.push(`data: ${JSON.stringify(payload)}`);
  return lines;
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

export function truncate(value: unknown, limit = 40_000): string {
  return truncateOutput(value, limit);
}

export function clampNumber(value: unknown, min: number, max: number): number {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new Error(`Expected a finite number, got ${value}.`);
  }
  return Math.min(Math.max(number, min), max);
}

function pickDefined(object: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined));
}

function noopRecorder(): RunRecorder {
  return { path: null, async finish() {} };
}
