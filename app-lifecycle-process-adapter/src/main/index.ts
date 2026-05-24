export const MAX_OUTPUT = 40_000;

export interface AppLifecycleExecOptions {
  timeout?: number;
  maxBuffer?: number;
  rejectOnError?: boolean;
}

export interface ExecFileOptions extends AppLifecycleExecOptions {
  cwd?: string;
  env?: Record<string, string | undefined>;
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

export type NodeExecFileAdapter = (
  file: string,
  args: string[],
  options: { cwd: string; env: Record<string, string | undefined>; timeout: number; maxBuffer: number },
  callback: ExecFileCallback,
) => ExecFileChild;

export interface AppLifecycleProcessDependencies {
  execFile: NodeExecFileAdapter;
  cwd?: () => string;
  env?: () => Record<string, string | undefined>;
}

export type AppLifecycleExecFile = (
  file: string,
  args: string[],
  options: AppLifecycleExecOptions,
) => Promise<ExecFileResult>;

export function createAppLifecycleExecFile(deps: AppLifecycleProcessDependencies): AppLifecycleExecFile {
  return (file, args, options) => execFilePromise(file, args, options, deps);
}

export function execFilePromise(
  file: string,
  args: string[],
  options: ExecFileOptions = {},
  deps: AppLifecycleProcessDependencies,
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
