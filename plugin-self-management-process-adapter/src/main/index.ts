export const MAX_OUTPUT = 40_000;

export interface PluginReleaseExecOptions {
  cwd: string;
  timeout: number;
  rejectOnError: boolean;
}

export interface PluginReleaseExecResult {
  stdout: string;
  stderr: string;
  error: { message: string; code?: unknown; signal?: unknown } | null;
}

export interface PluginSelfManagementRuntimeOptions {
  pluginRoot?: string;
  homeDir?: string;
  tmpDir?: string;
}

export interface PluginSelfManagementRuntimeDependencies extends PluginSelfManagementRuntimeOptions {
  execFile: PluginReleaseExecFile;
}

export interface NodeExecFileChild {
  stdin?: { end(input?: string | Uint8Array | null): void } | null;
}

export type NodeExecFileCallback = (error: unknown, stdout: unknown, stderr: unknown) => void;

export type NodeExecFileAdapter = (
  file: string,
  args: string[],
  options: { cwd: string; env: Record<string, string | undefined>; timeout: number; maxBuffer: number },
  callback: NodeExecFileCallback,
) => NodeExecFileChild;

export interface PluginSelfManagementProcessDependencies {
  execFile: NodeExecFileAdapter;
  env?: () => Record<string, string | undefined>;
  maxBuffer?: number;
}

export type PluginReleaseExecFile = (
  file: string,
  args: string[],
  options: PluginReleaseExecOptions,
) => Promise<PluginReleaseExecResult>;

export function createPluginReleaseExecFile(deps: PluginSelfManagementProcessDependencies): PluginReleaseExecFile {
  return (file, args, options) => execFilePromise(file, args, options, deps);
}

export function createPluginSelfManagementRuntimeDependencies(
  deps: PluginSelfManagementProcessDependencies,
  options: PluginSelfManagementRuntimeOptions = {},
): PluginSelfManagementRuntimeDependencies {
  return {
    ...options,
    execFile: createPluginReleaseExecFile(deps),
  };
}

export function execFilePromise(
  file: string,
  args: string[],
  options: PluginReleaseExecOptions,
  deps: PluginSelfManagementProcessDependencies,
): Promise<PluginReleaseExecResult> {
  const env = deps.env?.() ?? {};
  const maxBuffer = deps.maxBuffer ?? MAX_OUTPUT;

  return new Promise((resolve, reject) => {
    deps.execFile(file, args, {
      cwd: options.cwd,
      env,
      timeout: options.timeout,
      maxBuffer,
    }, (error, stdout, stderr) => {
      if (error && options.rejectOnError) {
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
