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

export interface IosSimulatorTargetDependencies {
  execFilePromise?: (file: string, args: string[], options: ExecOptions) => Promise<ExecResult> | ExecResult;
}

export type DeviceState = "booted" | "shutdown" | "connected" | "unknown";

export interface IosSimulatorTarget {
  runtime: string;
  id: unknown;
  name: unknown;
  state: DeviceState;
}

export async function listIosSimulatorTargets(
  dependencies: IosSimulatorTargetDependencies = {},
): Promise<IosSimulatorTarget[]> {
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
        id: device.udid,
        name: device.name ?? device.udid,
        state: normalizeDeviceState(device.state),
      })),
    )
    .sort((left, right) =>
      Number(right.state === "booted") - Number(left.state === "booted") ||
      String(left.name).localeCompare(String(right.name)),
    );
}

export function normalizeDeviceState(state: unknown): DeviceState {
  if (state === "Booted") return "booted";
  if (state === "Shutdown") return "shutdown";
  if (state === "connected") return "connected";
  return "unknown";
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
