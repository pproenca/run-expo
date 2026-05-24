import { execFile } from "node:child_process";

declare const process: { cwd(): string; env: Record<string, string | undefined> };

export interface ExecResult {
  stdout: string;
  stderr: string;
  error?: unknown;
}

export interface ExecOptions {
  timeout: number;
  maxBuffer: number;
}

export interface MobileDeviceSelectionDependencies {
  execFilePromise?: (file: string, args: string[], options: ExecOptions) => Promise<ExecResult> | ExecResult;
}

export interface IosDevice {
  udid: string;
  name: string;
  state: string;
  runtime?: string;
  [key: string]: unknown;
}

export interface ResolveIosDeviceOptions {
  preferBooted?: boolean;
}

export async function resolveIosDevice(
  requested?: string | null,
  options: ResolveIosDeviceOptions = {},
  dependencies: MobileDeviceSelectionDependencies = {},
): Promise<IosDevice> {
  if (requested && /^[0-9A-Fa-f-]{20,}$/.test(requested)) {
    return { udid: requested, name: requested, state: "unknown" };
  }

  const run = dependencies.execFilePromise ?? execFilePromise;
  const { stdout } = await run("xcrun", ["simctl", "list", "devices", "available", "--json"], {
    timeout: 20_000,
    maxBuffer: 4 * 1024 * 1024,
  });
  const parsed = JSON.parse(stdout);
  const devices = Object.entries(parsed.devices ?? {}).flatMap(([runtime, runtimeDevices]) =>
    (runtimeDevices as Array<Record<string, unknown>>).map((device) => ({ ...device, runtime }) as IosDevice),
  );

  if (requested) {
    const exact = devices.find((device) => device.udid === requested || device.name === requested);
    if (exact) return exact;
    const partial = devices.find((device) => device.name.toLowerCase().includes(requested.toLowerCase()));
    if (partial) return partial;
    throw new Error(`No available iOS simulator matched: ${requested}`);
  }

  if (options.preferBooted) {
    const booted = devices.find((device) => device.state === "Booted");
    if (booted) return booted;
  }

  const iphone = [...devices]
    .reverse()
    .find((device) => /iPhone/.test(device.name));
  if (iphone) return iphone;
  if (devices[0]) return devices[0];
  throw new Error("No available iOS simulators found.");
}

export function androidDeviceArgs(device: unknown, args: readonly unknown[]): unknown[] {
  return device ? ["-s", device, ...args] : [...args];
}

export function iosLogPredicate(args: { processName?: unknown; bundleId?: unknown }): string | null {
  if (args.processName) return `process == "${escapePredicateValue(args.processName)}"`;
  if (args.bundleId) {
    const processName = String(args.bundleId).split(".").at(-1);
    if (processName) return `process CONTAINS "${escapePredicateValue(processName)}"`;
  }
  return null;
}

export function escapePredicateValue(value: unknown): string {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
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
