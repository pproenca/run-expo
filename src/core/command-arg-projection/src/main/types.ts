export interface CliArgs {
  _: unknown[];
  [key: string]: unknown;
}

export interface CliGlobals {
  root?: unknown;
  stateDir?: unknown;
  actionPolicy?: unknown;
  allowRuntimeEval?: unknown;
  confirmActions?: unknown;
  [key: string]: unknown;
}

export type ProjectedCommandArgs = Record<string, unknown>;
export type CommonCommandArgs = Record<string, unknown>;

export interface CommandProjectionContext {
  command: string;
  args: CliArgs;
  globals: CliGlobals;
  cwd: unknown;
  common: CommonCommandArgs;
}

export type CommandProjector = (context: CommandProjectionContext) => ProjectedCommandArgs;
