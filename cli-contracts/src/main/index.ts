export const CLI_INTERFACE_NAMES = ["CliParser", "CliOutputWriter", "CliRuntime"] as const;

export const PARSED_CLI_FIELDS = ["globals", "command", "rawArgs", "args"] as const;

export const GLOBAL_OPTION_KEYS = [
  "json",
  "plain",
  "quiet",
  "debug",
  "root",
  "stateDir",
  "record",
  "maxOutputChars",
  "contentBoundaries",
  "allowRuntimeEval",
  "actionPolicyPath",
] as const;

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export type CommandName = string;

export type GlobalOptions = {
  json: boolean;
  plain: boolean;
  quiet: boolean;
  debug: boolean;
  root: string | null;
  stateDir: string | null;
  record: boolean;
  maxOutputChars: number | null;
  contentBoundaries: boolean;
  allowRuntimeEval: boolean;
  actionPolicyPath: string | null;
};

export type CommandFailureType =
  | "usage"
  | "runtime"
  | "tool-missing"
  | "unavailable"
  | "policy-denied"
  | "unexpected";

export type CommandFailure = {
  type: CommandFailureType;
  message: string;
  command?: string;
  hint?: string;
  debug?: unknown;
};

export type CommandWarning = {
  code: string;
  message: string;
  source?: string;
};

export type CommandOutcome<T> =
  | { ok: true; data: T; warnings?: CommandWarning[] }
  | { ok: false; error: CommandFailure; warnings?: CommandWarning[] };

export type CommandContext = {
  cwd: string;
  globals: GlobalOptions;
  [key: string]: unknown;
};

export type ParsedCli = {
  globals: GlobalOptions;
  command: CommandName | null;
  rawArgs: string[];
  args: Record<string, unknown>;
};

export interface CliParser {
  parse(argv: string[]): ParsedCli;
}

export interface CliOutputWriter {
  writeSuccess<T extends JsonValue>(
    command: CommandName,
    payload: T,
    globals: GlobalOptions,
  ): void;
  writeFailure(
    command: CommandName | null,
    outcome: CommandOutcome<never>,
    globals: GlobalOptions,
  ): void;
}

export interface CliRuntime {
  createContext(parsed: ParsedCli): Promise<CommandContext>;
  execute(parsed: ParsedCli): Promise<number>;
}

export type CliRuntimeDependencies = {
  createContext(parsed: ParsedCli): Promise<CommandContext>;
  dispatch(
    command: CommandName,
    args: Record<string, unknown>,
    context: CommandContext,
  ): Promise<CommandOutcome<JsonValue>>;
  outputWriter: CliOutputWriter;
};

export function createParsedCli(
  globals: GlobalOptions,
  command: CommandName | null,
  rawArgs: string[],
  args: Record<string, unknown>,
): ParsedCli {
  return {
    globals: { ...globals },
    command,
    rawArgs: [...rawArgs],
    args: { ...args },
  };
}

export function createCliRuntime(dependencies: CliRuntimeDependencies): CliRuntime {
  return {
    createContext(parsed) {
      return dependencies.createContext(parsed);
    },
    async execute(parsed) {
      if (parsed.command === null) {
        dependencies.outputWriter.writeFailure(
          null,
          failure("usage", "No command provided"),
          parsed.globals,
        );
        return 1;
      }

      const context = await dependencies.createContext(parsed);
      const outcome = await dependencies.dispatch(parsed.command, parsed.args, context);
      if (!outcome.ok) {
        dependencies.outputWriter.writeFailure(parsed.command, outcome, parsed.globals);
        return 1;
      }

      dependencies.outputWriter.writeSuccess(parsed.command, outcome.data, parsed.globals);
      return 0;
    },
  };
}

export function ok<T extends JsonValue>(
  data: T,
  warnings?: CommandWarning[],
): CommandOutcome<T> {
  return warnings === undefined ? { ok: true, data } : { ok: true, data, warnings };
}

export function failure(
  type: CommandFailureType,
  message: string,
  options: Omit<CommandFailure, "type" | "message"> = {},
): CommandOutcome<never> {
  return {
    ok: false,
    error: {
      type,
      message,
      ...options,
    },
  };
}
