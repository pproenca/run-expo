import { execFile as nodeExecFile } from "node:child_process";

export type DeviceListingPlatform = "all" | "ios" | "android";

export interface ListDevicesArgs {
  platform?: DeviceListingPlatform;
  limit?: unknown;
}

export interface ExecFileOptions {
  timeout?: number;
  maxBuffer?: number;
}

export interface ExecFileResult {
  stdout: string;
  stderr?: string;
}

export type ExecFileDependency = (
  file: string,
  args: string[],
  options?: ExecFileOptions,
) => Promise<ExecFileResult>;

export interface DeviceListingDependencies {
  execFile: ExecFileDependency;
}

export interface ToolTextResult {
  content: Array<{ type: "text"; text: string }>;
  isError: boolean;
}

export interface SafeToolSectionOk<T> {
  ok: true;
  value: T;
}

export interface SafeToolSectionError {
  ok: false;
  error: string;
}

export type SafeToolSectionResult<T> = SafeToolSectionOk<T> | SafeToolSectionError;

export interface IosSimulatorDevice {
  runtime: string;
  name?: unknown;
  udid?: unknown;
  state?: unknown;
  isAvailable?: unknown;
}

export interface IosPhysicalDevice {
  name: string | null;
  identifier: string | null;
  platform: string | null;
  model: string | null;
  connectionType: string | null;
  state: string | null;
}

export interface AndroidDevice {
  serial: string;
  state: string;
  details: string;
}

export interface DeviceListingPayload {
  ios?: SafeToolSectionResult<IosSimulatorDevice[]>;
  iosPhysical?: SafeToolSectionResult<IosPhysicalDevice[]>;
  android?: SafeToolSectionResult<AndroidDevice[]>;
}

const MAX_OUTPUT = 40_000;

export function clampNumber(value: unknown, min: number, max: number): number {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new Error(`Expected a finite number, got ${String(value)}.`);
  }
  return Math.min(Math.max(number, min), max);
}

export async function safeToolSection<T>(fn: () => T | Promise<T>): Promise<SafeToolSectionResult<T>> {
  try {
    return { ok: true, value: await fn() };
  } catch (error) {
    return { ok: false, error: formatError(error) };
  }
}

export async function listIosPhysicalDevices(
  limit: number,
  dependencies: DeviceListingDependencies,
): Promise<IosPhysicalDevice[]> {
  const { stdout } = await dependencies.execFile("xcrun", ["devicectl", "list", "devices", "--json-output", "-"], {
    timeout: 20_000,
    maxBuffer: 4 * 1024 * 1024,
  });
  const parsed: unknown = JSON.parse(stdout);
  const devices = devicesFromPhysicalPayload(parsed);
  return devices.slice(0, limit).map((device) => ({
    name: stringOrNull(deviceProperty(device, "deviceProperties", "name") ?? device.name),
    identifier: stringOrNull(device.identifier ?? device.udid),
    platform: stringOrNull(deviceProperty(device, "deviceProperties", "platform") ?? device.platform),
    model: stringOrNull(deviceProperty(device, "hardwareProperties", "marketingName") ?? device.model),
    connectionType: stringOrNull(deviceProperty(device, "connectionProperties", "transportType") ?? device.connectionType),
    state: stringOrNull(deviceProperty(device, "connectionProperties", "pairingState") ?? device.state),
  }));
}

export async function listDevices(
  args: ListDevicesArgs = {},
  dependencies: DeviceListingDependencies = defaultDeviceListingDependencies,
): Promise<ToolTextResult> {
  const platform = args.platform ?? "all";
  const limit = clampNumber(args.limit ?? 40, 1, 200);
  const payload: DeviceListingPayload = {};

  if (platform === "ios" || platform === "all") {
    payload.ios = await safeToolSection(async () => listIosSimulators(limit, dependencies));
    payload.iosPhysical = await safeToolSection(async () => listIosPhysicalDevices(limit, dependencies));
  }
  if (platform === "android" || platform === "all") {
    payload.android = await safeToolSection(async () => listAndroidDevices(limit, dependencies));
  }

  return toolJson(payload);
}

const defaultDeviceListingDependencies: DeviceListingDependencies = {
  execFile: (file, args, options = {}) => new Promise((resolve, reject) => {
    nodeExecFile(file, args, {
      timeout: options.timeout,
      maxBuffer: options.maxBuffer,
    }, (error, stdout, stderr) => {
      if (error) {
        Object.assign(error, { stdout, stderr });
        reject(error);
        return;
      }
      resolve({ stdout: String(stdout ?? ""), stderr: String(stderr ?? "") });
    });
  }),
};

async function listAndroidDevices(limit: number, dependencies: DeviceListingDependencies): Promise<AndroidDevice[]> {
  const { stdout } = await dependencies.execFile("adb", ["devices", "-l"], { timeout: 20_000 });
  return stdout
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [serial = "", state = "", ...details] = line.split(/\s+/);
      return { serial, state, details: details.join(" ") };
    })
    .slice(0, limit);
}

async function listIosSimulators(limit: number, dependencies: DeviceListingDependencies): Promise<IosSimulatorDevice[]> {
  const { stdout } = await dependencies.execFile("xcrun", ["simctl", "list", "devices", "available", "--json"], {
    timeout: 20_000,
    maxBuffer: 4 * 1024 * 1024,
  });
  const parsed: unknown = JSON.parse(stdout);
  const devices = isRecord(parsed) && isRecord(parsed.devices) ? parsed.devices : {};
  return Object.entries(devices)
    .flatMap(([runtime, runtimeDevices]) => {
      if (!Array.isArray(runtimeDevices)) throw new Error(`devices.${runtime} must be an array.`);
      return runtimeDevices.map((device) => {
        const record = isRecord(device) ? device : {};
        return {
          runtime,
          name: record.name,
          udid: record.udid,
          state: record.state,
          isAvailable: record.isAvailable,
        };
      });
    })
    .sort((left, right) =>
      Number(right.state === "Booted") - Number(left.state === "Booted")
      || String(left.name).localeCompare(String(right.name))
    )
    .slice(0, limit);
}

function deviceProperty(device: Record<string, unknown>, objectKey: string, propertyKey: string): unknown {
  const parent = device[objectKey];
  return isRecord(parent) ? parent[propertyKey] : undefined;
}

function devicesFromPhysicalPayload(value: unknown): Array<Record<string, unknown>> {
  if (!isRecord(value)) throw new Error("physical device payload must be an object.");
  const rawDevices = isRecord(value.result) && "devices" in value.result ? value.result.devices : value.devices;
  if (!Array.isArray(rawDevices)) throw new Error("physical devices must be an array.");
  return rawDevices.map((device) => {
    if (!isRecord(device)) throw new Error("physical device entry must be an object.");
    return device;
  });
}

function formatError(error: unknown): string {
  if (!error) return "Unknown error";
  const record = isRecord(error) ? error : {};
  const message = error instanceof Error ? error.message : String(error);
  const parts = [message];
  if (record.stdout) parts.push(`stdout:\n${truncate(record.stdout)}`);
  if (record.stderr) parts.push(`stderr:\n${truncate(record.stderr)}`);
  return parts.join("\n\n");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringOrNull(value: unknown): string | null {
  return value == null ? null : String(value);
}

function toolJson(value: unknown): ToolTextResult {
  return {
    content: [{ type: "text", text: `${JSON.stringify(value, null, 2)}\n` }],
    isError: false,
  };
}

function truncate(value: unknown, limit = MAX_OUTPUT): string {
  const text = String(value ?? "");
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}\n[truncated ${text.length - limit} characters]`;
}
