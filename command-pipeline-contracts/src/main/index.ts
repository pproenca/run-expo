export const COMMAND_FAMILIES = [
  "discovery",
  "session",
  "target",
  "runtime",
  "action",
  "devtools",
  "performance",
  "review",
  "skills",
] as const;

export const BUILT_IN_MIDDLEWARE = [
  "schema-validation",
  "policy",
  "session",
  "run-record",
  "redaction",
  "output-boundary",
  "artifact-capture",
  "error-envelope",
] as const;

export type CommandFamily = (typeof COMMAND_FAMILIES)[number];
export type BuiltInMiddleware = (typeof BUILT_IN_MIDDLEWARE)[number];
export type CommandName = string;
export type CommandEffect = "read" | "write" | "device" | "runtime" | "sidecar";
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
  globals: Record<string, unknown>;
  session: unknown | null;
  target: unknown | null;
  policy: unknown;
  artifacts: unknown;
};

export type CommandDefinition<TArgs, TResult> = {
  name: CommandName;
  summary: string;
  inputSchema: unknown;
  effects: CommandEffect[];
  actionCategories: string[];
  examples: string[];
};

export interface CommandHandler<TArgs, TResult> {
  run(args: TArgs, context: CommandContext): Promise<CommandOutcome<TResult>>;
}

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
  list(): CommandMiddleware[];
  build<TArgs, TResult>(
    definition: CommandDefinition<TArgs, TResult>,
    handler: CommandHandler<TArgs, TResult>,
  ): CommandHandler<TArgs, TResult>;
}

export class InMemoryCommandRegistry implements CommandRegistry {
  readonly #modules: CommandModule[] = [];

  constructor(modules: CommandModule[] = []) {
    for (const module of modules) {
      this.register(module);
    }
  }

  list(): CommandModule[] {
    return [...this.#modules];
  }

  get(name: CommandName): CommandModule | null {
    return this.#modules.find((module) => module.definition.name === name) ?? null;
  }

  register(module: CommandModule): void {
    const index = this.#modules.findIndex(
      (current) => current.definition.name === module.definition.name,
    );

    if (index === -1) {
      this.#modules.push(module);
      return;
    }

    this.#modules[index] = module;
  }
}

class DefaultCommandPipeline implements CommandPipeline {
  readonly #middleware: CommandMiddleware[] = [];

  constructor(middleware: CommandMiddleware[]) {
    for (const item of middleware) {
      this.use(item);
    }
  }

  use(middleware: CommandMiddleware): void {
    this.#middleware.push(middleware);
  }

  list(): CommandMiddleware[] {
    return [...this.#middleware];
  }

  build<TArgs, TResult>(
    definition: CommandDefinition<TArgs, TResult>,
    handler: CommandHandler<TArgs, TResult>,
  ): CommandHandler<TArgs, TResult> {
    const middleware = [...this.#middleware];
    const base: CommandNext<TArgs, TResult> = (invocation) =>
      handler.run(invocation.args, invocation.context);
    const chain = middleware.reduceRight(
      (next, item) => item.wrap(definition, next),
      base,
    );

    return {
      run(args, context) {
        return chain({ name: definition.name, args, context });
      },
    };
  }
}

export function createCommandPipeline(
  middleware: CommandMiddleware[] = [],
): CommandPipeline {
  return new DefaultCommandPipeline(middleware);
}

export function ok<T>(
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

export function usageFailure(
  message: string,
  command?: string,
): CommandOutcome<never> {
  return command === undefined
    ? failure("usage", message)
    : failure("usage", message, { command });
}
