import { execFile } from "node:child_process";

declare const process: { cwd(): string; env: Record<string, string | undefined> };

export interface ExecResult {
  stdout: string;
  stderr: string;
}

export interface ExecOptions {
  timeout: number;
  maxBuffer: number;
}

export interface IosSimulatorDeviceListDependencies {
  execFilePromise?: (file: string, args: string[], options: ExecOptions) => Promise<ExecResult> | ExecResult;
}

export interface IosSimulatorDeviceListEntry {
  runtime: string;
  name: unknown;
  udid: unknown;
  state: unknown;
  isAvailable: unknown;
}

export async function listIosSimulatorDevices(
  limit: number,
  dependencies: IosSimulatorDeviceListDependencies = {},
): Promise<IosSimulatorDeviceListEntry[]> {
  const run = dependencies.execFilePromise ?? execFilePromise;
  const { stdout } = await run("xcrun", ["simctl", "list", "devices", "available", "--json"], {
    timeout: 20_000,
    maxBuffer: 4 * 1024 * 1024,
  });
  const parsed = JSON.parse(stdout);
  return Object.entries(parsed.devices ?? {})
    .flatMap(([runtime, devices]) =>
      (devices as Array<Record<string, unknown>>).map((device) => ({
        runtime,
        name: device.name,
        udid: device.udid,
        state: device.state,
        isAvailable: device.isAvailable,
      })),
    )
    .sort((left, right) =>
      Number(right.state === "Booted") - Number(left.state === "Booted") ||
      String(left.name).localeCompare(String(right.name)),
    )
    .slice(0, limit);
}

function execFilePromise(file: string, args: string[], options: ExecOptions): Promise<ExecResult> {
  const { timeout, maxBuffer } = options;
  return new Promise((resolve, reject) => {
    execFile(file, args, { cwd: process.cwd(), env: process.env, timeout, maxBuffer }, (error: any, stdout: unknown, stderr: unknown) => {
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
