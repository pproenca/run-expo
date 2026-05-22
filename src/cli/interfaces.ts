import type {
  CommandContext,
  CommandName,
  GlobalOptions,
} from "../contracts/commands.js";
import type { CommandOutcome, JsonValue } from "../contracts/primitives.js";

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
  writeFailure(command: CommandName | null, outcome: CommandOutcome<never>, globals: GlobalOptions): void;
}

export interface CliRuntime {
  createContext(parsed: ParsedCli): Promise<CommandContext>;
  execute(parsed: ParsedCli): Promise<number>;
}
