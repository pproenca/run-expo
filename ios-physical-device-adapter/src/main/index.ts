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

export interface IosPhysicalDeviceDependencies {
  execFilePromise?: (file: string, args: string[], options: ExecOptions) => Promise<ExecResult> | ExecResult;
}

export interface IosPhysicalDevice {
  name: unknown;
  identifier: unknown;
  platform: unknown;
  model: unknown;
  connectionType: unknown;
  state: unknown;
}

export async function listIosPhysicalDevices(
  limit: number,
  dependencies: IosPhysicalDeviceDependencies = {},
): Promise<IosPhysicalDevice[]> {
  const run = dependencies.execFilePromise ?? execFilePromise;
  const { stdout } = await run("xcrun", ["devicectl", "list", "devices", "--json-output", "-"], {
    timeout: 20_000,
    maxBuffer: 4 * 1024 * 1024,
  });
  const parsed = JSON.parse(stdout);
  const devices = parsed?.result?.devices ?? parsed?.devices ?? [];
  return devices.slice(0, limit).map((device: any) => ({
    name: device.deviceProperties?.name ?? device.name ?? null,
    identifier: device.identifier ?? device.udid ?? null,
    platform: device.deviceProperties?.platform ?? device.platform ?? null,
    model: device.hardwareProperties?.marketingName ?? device.model ?? null,
    connectionType: device.connectionProperties?.transportType ?? device.connectionType ?? null,
    state: device.connectionProperties?.pairingState ?? device.state ?? null,
  }));
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
