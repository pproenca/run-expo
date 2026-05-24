import { execFile } from "node:child_process";

declare const process: { cwd(): string; env: Record<string, string | undefined> };

export interface ExecResult {
  stdout: string;
  stderr: string;
}

export interface ExecOptions {
  timeout: number;
}

export interface AndroidDeviceListDependencies {
  execFilePromise?: (file: string, args: string[], options: ExecOptions) => Promise<ExecResult> | ExecResult;
}

export interface AndroidDeviceListEntry {
  serial: string | undefined;
  state: string | undefined;
  details: string;
}

export async function listAndroidDevices(
  limit: number,
  dependencies: AndroidDeviceListDependencies = {},
): Promise<AndroidDeviceListEntry[]> {
  const run = dependencies.execFilePromise ?? execFilePromise;
  const { stdout } = await run("adb", ["devices", "-l"], { timeout: 20_000 });
  return parseAdbDevices(stdout).slice(0, limit);
}

export function parseAdbDevices(stdout: string): AndroidDeviceListEntry[] {
  return stdout
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [serial, state, ...details] = line.split(/\s+/);
      return { serial, state, details: details.join(" ") };
    });
}

function execFilePromise(file: string, args: string[], options: ExecOptions): Promise<ExecResult> {
  const { timeout } = options;
  return new Promise((resolve, reject) => {
    execFile(file, args, { cwd: process.cwd(), env: process.env, timeout }, (error: any, stdout: unknown, stderr: unknown) => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
        return;
      }
      resolve({ stdout: String(stdout ?? ""), stderr: String(stderr ?? "") });
    });
  });
}
