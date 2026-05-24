export const MAX_OUTPUT = 40_000;

export interface ExecFileOptions {
  cwd?: string;
  env?: Record<string, string | undefined>;
  timeout?: number;
  maxBuffer?: number;
  rejectOnError?: boolean;
  input?: string | Uint8Array | null;
}

export interface ExecFileResult {
  stdout: string;
  stderr: string;
  error: { message: string; code?: unknown; signal?: unknown } | null;
}

export interface ExecFileChild {
  stdin?: { end(input?: string | Uint8Array | null): void } | null;
}

export type ExecFileCallback = (error: unknown, stdout: unknown, stderr: unknown) => void;
export type ExecFileAdapter = (
  file: string,
  args: string[],
  options: { cwd: string; env: Record<string, string | undefined>; timeout: number; maxBuffer: number },
  callback: ExecFileCallback,
) => ExecFileChild;

export interface CommandRunnerDependencies {
  execFile: ExecFileAdapter;
  cwd?: () => string;
  env?: () => Record<string, string | undefined>;
}

export async function commandPath(command: string, deps: CommandRunnerDependencies): Promise<string | null> {
  const result = await execFilePromise("sh", ["-lc", `command -v ${command}`], {
    timeout: 5000,
    rejectOnError: false,
  }, deps);
  return result.stdout.trim() || null;
}

export function execFilePromise(
  file: string,
  args: string[],
  options: ExecFileOptions = {},
  deps: CommandRunnerDependencies,
): Promise<ExecFileResult> {
  const cwd = options.cwd ?? deps.cwd?.() ?? ".";
  const env = options.env ?? deps.env?.() ?? {};
  const timeout = options.timeout ?? 60_000;
  const maxBuffer = options.maxBuffer ?? MAX_OUTPUT;
  const rejectOnError = options.rejectOnError ?? true;
  const input = options.input ?? null;

  return new Promise((resolve, reject) => {
    const child = deps.execFile(file, args, { cwd, env, timeout, maxBuffer }, (error, stdout, stderr) => {
      if (error && rejectOnError) {
        const rejected = error as Record<string, unknown>;
        rejected.stdout = stdout;
        rejected.stderr = stderr;
        reject(error);
        return;
      }
      resolve({
        stdout: String(stdout ?? ""),
        stderr: String(stderr ?? ""),
        error: error ? normalizeExecError(error) : null,
      });
    });

    if (input !== null && input !== undefined) {
      child.stdin?.end(input);
    }
  });
}

export function normalizeExecError(error: unknown): { message: string; code?: unknown; signal?: unknown } {
  const record = error as { message?: unknown; code?: unknown; signal?: unknown } | null | undefined;
  return {
    message: String(record?.message ?? error),
    code: record?.code,
    signal: record?.signal,
  };
}

