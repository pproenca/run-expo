export const EXIT_SUCCESS = 0;
export const EXIT_RUNTIME_FAILURE = 1;

export interface CliGlobals extends Record<string, unknown> {
  json: boolean;
  plain: boolean;
  quiet: boolean;
  debug: boolean;
  maxOutput: string | number | null;
  contentBoundaries: boolean;
  allowRuntimeEval: string | boolean | null;
  confirmActions: string | null;
}

export interface ParsedCommand {
  command: string | null;
  args: Record<string, unknown> & { _: unknown[] };
  globals: CliGlobals;
}

export interface CliFacadeDependencies {
  parseCliArgs: (argv: string[]) => ParsedCommand;
  dispatchCommand: (parsed: ParsedCommand) => Promise<number> | number;
  writeCliError: (error: unknown, options: CliGlobals) => void;
  exitCodeForError: (error: unknown) => number;
}

export interface CliFacade {
  main(argv: string[]): Promise<number>;
  run(argv: string[]): Promise<number>;
  getLastCliOptions(): CliGlobals;
}

export function defaultLastCliOptions(): CliGlobals {
  return {
    json: false,
    plain: false,
    quiet: false,
    debug: false,
    maxOutput: null,
    contentBoundaries: false,
    allowRuntimeEval: null,
    confirmActions: null,
  };
}

export function createCliFacade(deps: CliFacadeDependencies): CliFacade {
  let lastCliOptions = defaultLastCliOptions();

  async function main(argv: string[]): Promise<number> {
    const parsed = deps.parseCliArgs(argv);
    lastCliOptions = parsed.globals;
    return deps.dispatchCommand(parsed);
  }

  async function run(argv: string[]): Promise<number> {
    try {
      return await main(argv);
    } catch (error) {
      deps.writeCliError(error, lastCliOptions);
      return deps.exitCodeForError(error);
    }
  }

  return {
    main,
    run,
    getLastCliOptions: () => ({ ...lastCliOptions }),
  };
}
