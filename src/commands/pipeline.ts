import type {
  CommandContext,
  CommandDefinition,
  CommandHandler,
  CommandName,
} from "../contracts/commands.js";
import type { CommandOutcome } from "../contracts/primitives.js";

export type CommandInvocation<TArgs = unknown> = {
  name: CommandName;
  args: TArgs;
  context: CommandContext;
};

export type CommandNext<TArgs, TResult> = (
  invocation: CommandInvocation<TArgs>,
) => Promise<CommandOutcome<TResult>>;

export interface CommandMiddleware {
  name: string;
  wrap<TArgs, TResult>(
    definition: CommandDefinition<TArgs, TResult>,
    next: CommandNext<TArgs, TResult>,
  ): CommandNext<TArgs, TResult>;
}

export interface CommandPipeline {
  use(middleware: CommandMiddleware): void;
  build<TArgs, TResult>(
    definition: CommandDefinition<TArgs, TResult>,
    handler: CommandHandler<TArgs, TResult>,
  ): CommandHandler<TArgs, TResult>;
}

export type BuiltInMiddleware =
  | "schema-validation"
  | "policy"
  | "session"
  | "run-record"
  | "redaction"
  | "output-boundary"
  | "artifact-capture"
  | "error-envelope";
