export const DEFAULT_PROCESS_ARGV_OFFSET = 2;

export type CliMain = (argv: string[]) => Promise<number> | number;
export type ExitCodeWriter = (exitCode: number) => void;
export type CliErrorWriter = (error: unknown) => void;
export type ErrorExitClassifier = (error: unknown) => number;

export interface CliExecutableDependencies {
  argv: string[] | (() => string[]);
  main: CliMain;
  setExitCode: ExitCodeWriter;
  writeCliError: CliErrorWriter;
  exitCodeForError: ErrorExitClassifier;
  argvOffset?: number;
}

export interface CliExecutable {
  run(): Promise<number>;
  argv(): string[];
}

export function createCliExecutable(deps: CliExecutableDependencies): CliExecutable {
  return {
    argv: () => cliArgv(readArgv(deps.argv), deps.argvOffset),
    run: () => runCliExecutable(deps),
  };
}

export async function runCliExecutable(deps: CliExecutableDependencies): Promise<number> {
  const argv = cliArgv(readArgv(deps.argv), deps.argvOffset);
  try {
    const exitCode = await deps.main(argv);
    deps.setExitCode(exitCode);
    return exitCode;
  } catch (error) {
    deps.writeCliError(error);
    const exitCode = deps.exitCodeForError(error);
    deps.setExitCode(exitCode);
    return exitCode;
  }
}

export function cliArgv(
  processArgv: readonly string[],
  argvOffset = DEFAULT_PROCESS_ARGV_OFFSET,
): string[] {
  const offset =
    Number.isFinite(argvOffset) && argvOffset >= 0
      ? Math.floor(argvOffset)
      : DEFAULT_PROCESS_ARGV_OFFSET;
  return processArgv.slice(offset);
}

function readArgv(argv: string[] | (() => string[])): string[] {
  return typeof argv === "function" ? argv() : argv;
}
