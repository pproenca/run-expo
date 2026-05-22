import type {
  CommandDefinition,
  CommandHandler,
  CommandName,
} from "../contracts/commands.js";

export type CommandFamily =
  | "discovery"
  | "session"
  | "target"
  | "runtime"
  | "action"
  | "devtools"
  | "performance"
  | "review"
  | "skills";

export type CommandModule<TArgs = unknown, TResult = unknown> = {
  family: CommandFamily;
  definition: CommandDefinition<TArgs, TResult>;
};

export interface CommandRegistry {
  list(): CommandModule[];
  get(name: CommandName): CommandModule | null;
  register(module: CommandModule): void;
}

export interface CommandFacade {
  dispatch(name: CommandName, args: unknown): Promise<unknown>;
}

export interface CommandFactory {
  create<TArgs, TResult>(
    module: CommandModule<TArgs, TResult>,
  ): CommandHandler<TArgs, TResult>;
}
