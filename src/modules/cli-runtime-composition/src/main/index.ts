export const EXIT_SUCCESS = 0;
export const EXIT_RUNTIME_FAILURE = 1;

export type RuntimeComponentSource = {
  role: string;
  packageName: `@expo98/${string}`;
  exportName: string;
  required: boolean;
};

export const CLI_RUNTIME_COMPONENT_SOURCES = [
  component("parseCliArgs", "@expo98/cli-argv-parser", "parseCliArgs"),
  component("commandArgs", "@expo98/command-arg-projection", "commandArgs"),
  component("dispatchCommand", "@expo98/command-dispatch-envelope", "dispatchCommand"),
  component("formatCliError", "@expo98/command-dispatch-envelope", "formatCliError"),
  component("exitCodeForError", "@expo98/command-dispatch-envelope", "exitCodeForError"),
  component("bindHandlers", "@expo98/tool-handler-registry", "bindHandlers"),
  component("handlerImplementationSources", "@expo98/tool-handler-registry", "handlerImplementationSources"),
  component("createCliFacade", "@expo98/cli-facade-entrypoint", "createCliFacade"),
  component("cliHelpText", "@expo98/cli-help-surface", "cliHelpText"),
  component("startRunRecord", "@expo98/session-run-records", "startRunRecord"),
  component("createCliRuntime", "@expo98/cli-runtime-composition", "createCliRuntime"),
  component("createCliExecutable", "@expo98/cli-executable-wrapper", "createCliExecutable"),
] as const satisfies readonly RuntimeComponentSource[];

export interface CliGlobals extends Record<string, unknown> {
  json: boolean;
  plain: boolean;
  quiet: boolean;
  debug: boolean;
  maxOutput: string | number | null;
  contentBoundaries: boolean;
}

export interface ParsedCommand {
  command: string | null;
  args: Record<string, unknown> & { _: unknown[] };
  globals: CliGlobals;
}

export interface RunRecorder {
  path: string | null;
  finish(entry: { status: "completed" | "failed"; exitCode: number; payload?: unknown; error?: unknown }): Promise<void> | void;
}

export type ToolHandler = (args: Record<string, unknown>) => Promise<unknown> | unknown;
export type ToolHandlerImplementations = Record<string, ToolHandler>;
export type ToolHandlerRegistry = Record<string, ToolHandler>;

export interface DispatchDependencies {
  handlers: ToolHandlerRegistry;
  projectArgs: (command: string, args: ParsedCommand["args"], globals: CliGlobals) => Record<string, unknown>;
  startRunRecord?: (entry: { command: string; args: Record<string, unknown>; globals: CliGlobals }) => Promise<RunRecorder> | RunRecorder;
  stdout?: (text: string) => void;
  stderr?: (text: string) => void;
  printHelp?: () => string;
  cliVersion?: string;
}

export interface CliFacade {
  main(argv: string[]): Promise<number>;
  run(argv: string[]): Promise<number>;
  getLastCliOptions(): CliGlobals;
}

export interface CliRuntime {
  main(argv: string[]): Promise<number>;
  run(argv: string[]): Promise<number>;
  getLastCliOptions(): CliGlobals;
  handlers: ToolHandlerRegistry;
  dispatchDependencies: DispatchDependencies;
}

export interface CliRuntimeDependencies {
  parseCliArgs: (argv: string[]) => ParsedCommand;
  commandArgs: (command: string, args: ParsedCommand["args"], globals: CliGlobals) => Record<string, unknown>;
  dispatchCommand: (parsed: ParsedCommand, deps: DispatchDependencies) => Promise<number> | number;
  bindHandlers: (implementations: ToolHandlerImplementations) => ToolHandlerRegistry;
  createCliFacade: (deps: {
    parseCliArgs: (argv: string[]) => ParsedCommand;
    dispatchCommand: (parsed: ParsedCommand) => Promise<number> | number;
    writeCliError: (error: unknown, options: CliGlobals) => void;
    exitCodeForError: (error: unknown) => number;
  }) => CliFacade;
  writeCliError: (error: unknown, options: CliGlobals) => void;
  exitCodeForError: (error: unknown) => number;
  handlerImplementations: ToolHandlerImplementations;
  startRunRecord?: DispatchDependencies["startRunRecord"];
  stdout?: (text: string) => void;
  stderr?: (text: string) => void;
  printHelp?: () => string;
  cliVersion?: string;
}

export function runtimeComponentSources(): RuntimeComponentSource[] {
  return CLI_RUNTIME_COMPONENT_SOURCES.map((item) => ({ ...item }));
}

export function runtimeComponentSourceByRole(role: string): RuntimeComponentSource | null {
  const source = CLI_RUNTIME_COMPONENT_SOURCES.find((item) => item.role === role);
  return source ? { ...source } : null;
}

export function requiredRuntimeComponentRoles(): string[] {
  return CLI_RUNTIME_COMPONENT_SOURCES
    .filter((item) => item.required)
    .map((item) => item.role);
}

export function assertRuntimeComponentSourcesCover(roles: readonly string[]): void {
  const known = new Set(CLI_RUNTIME_COMPONENT_SOURCES.map((item) => item.role));
  const missing = roles.filter((role) => !known.has(role));
  if (missing.length > 0) {
    throw new Error(`Missing runtime component sources: ${missing.join(", ")}`);
  }
}

export function createCliRuntime(deps: CliRuntimeDependencies): CliRuntime {
  const handlers = deps.bindHandlers(deps.handlerImplementations);
  const dispatchDependencies: DispatchDependencies = {
    handlers,
    projectArgs: deps.commandArgs,
    startRunRecord: deps.startRunRecord,
    stdout: deps.stdout,
    stderr: deps.stderr,
    printHelp: deps.printHelp,
    cliVersion: deps.cliVersion,
  };
  const facade = deps.createCliFacade({
    parseCliArgs: deps.parseCliArgs,
    dispatchCommand: (parsed) => deps.dispatchCommand(parsed, dispatchDependencies),
    writeCliError: deps.writeCliError,
    exitCodeForError: deps.exitCodeForError,
  });

  return {
    main: (argv) => facade.main(argv),
    run: (argv) => facade.run(argv),
    getLastCliOptions: () => facade.getLastCliOptions(),
    handlers,
    dispatchDependencies,
  };
}

function component(
  role: string,
  packageName: `@expo98/${string}`,
  exportName: string,
  required = true,
): RuntimeComponentSource {
  return { role, packageName, exportName, required };
}

export function createProcessExitRunner(runtime: Pick<CliRuntime, "run">, setExitCode: (exitCode: number) => void): (argv: string[]) => Promise<number> {
  return async (argv) => {
    const exitCode = await runtime.run(argv);
    setExitCode(exitCode);
    return exitCode;
  };
}

export function assertRuntimeHasHandlers(runtime: Pick<CliRuntime, "handlers">, toolNames: readonly string[]): void {
  const missing = toolNames.filter((toolName) => runtime.handlers[toolName] === undefined);
  if (missing.length > 0) {
    throw new Error(`Missing runtime handlers: ${missing.join(", ")}`);
  }
}
