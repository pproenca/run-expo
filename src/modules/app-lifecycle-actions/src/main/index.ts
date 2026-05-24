import { execFile as nodeExecFile } from "node:child_process";
import * as fs from "node:fs/promises";
import { homedir } from "node:os";
import { join as joinPath, resolve as resolvePath } from "node:path";

const MAX_OUTPUT = 40_000;

export type Platform = "ios" | "android";

export type ExecError = {
  message: string;
  code?: number | string | null;
  signal?: string | null;
};

export type ExecResult = {
  stdout?: string | null;
  stderr?: string | null;
  error?: ExecError | null;
};

export type ExecOptions = {
  timeout?: number;
  maxBuffer?: number;
  rejectOnError?: boolean;
};

export type ExecCall = {
  file: string;
  args: string[];
  options: ExecOptions;
};

export type IosDevice = {
  udid: string;
  name: string;
  state?: string;
  runtime?: string;
  isAvailable?: boolean;
};

export type ActionPolicyDecision = {
  checked: true;
  action: string;
  sideEffect: "read" | "device" | "write" | "runtime-eval";
  allowed: boolean;
  source: string | null;
  reason: string;
};

export type RuntimeSummary = {
  appConfig?: {
    iosBundleIdentifier?: string | null;
    androidPackage?: string | null;
  } | null;
};

export type DiagnosticReportEntry = {
  name: string;
  path: string;
  isFile: boolean;
  mtimeMs: number;
  mtimeIso: string;
  content: string;
};

export type AppLifecycleDependencies = {
  execFile(file: string, args: string[], options: ExecOptions): Promise<ExecResult>;
  resolveIosDevice(requested: string | undefined, options: { preferBooted: true }): Promise<IosDevice>;
  wait(ms: number): Promise<void>;
  now(): number;
  policyDecision(args: Record<string, unknown>, action: string, sideEffect: "device"): Promise<ActionPolicyDecision>;
  runtimeSummary(cwd: string): Promise<RuntimeSummary | null>;
  listDiagnosticReports(): Promise<DiagnosticReportEntry[]>;
};

export type AppActionArgs = Record<string, unknown>;
export type AppActionPayload = Record<string, unknown>;

const defaultAppLifecycleDependencies: AppLifecycleDependencies = {
  execFile: defaultExecFile,
  resolveIosDevice: defaultResolveIosDevice,
  wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now: () => Date.now(),
  policyDecision: defaultPolicyDecision,
  runtimeSummary: defaultRuntimeSummary,
  listDiagnosticReports: defaultListDiagnosticReports,
};

export async function bootSimulator(
  args: AppActionArgs,
  deps: AppLifecycleDependencies = defaultAppLifecycleDependencies,
): Promise<AppActionPayload> {
  const policy = await deps.policyDecision(args, "boot-simulator", "device");
  if (!policy.allowed) return policyDeniedPayload("boot-simulator", policy);
  const requestedDevice = optionalString(args.device) ?? undefined;
  const device = await deps.resolveIosDevice(requestedDevice, { preferBooted: true });
  const bootResult = await deps.execFile("xcrun", ["simctl", "boot", device.udid], {
    timeout: 60_000,
    rejectOnError: false,
  });
  const shouldOpen = args.openSimulator !== false;
  if (shouldOpen) {
    await deps.execFile("open", ["-a", "Simulator"], { timeout: 10_000, rejectOnError: false });
  }

  return {
    requestedDevice: requestedDevice ?? null,
    device,
    openSimulator: shouldOpen,
    stdout: truncateSubprocessOutput(bootResult.stdout),
    stderr: truncateSubprocessOutput(bootResult.stderr),
  };
}

export async function launchApp(
  args: AppActionArgs,
  deps: AppLifecycleDependencies = defaultAppLifecycleDependencies,
): Promise<AppActionPayload> {
  const platform = platformArg(args.platform);
  const policy = await deps.policyDecision(args, "launch-app", "device");
  if (!policy.allowed) return policyDeniedPayload("launch-app", policy);

  if (platform === "android") {
    const packageName = requireString(args.packageName ?? args.bundleId, "packageName");
    const activity = optionalString(args.activity);
    const commandArgs = activity
      ? ["shell", "am", "start", "-n", `${packageName}/${activity}`]
      : ["shell", "monkey", "-p", packageName, "1"];
    const result = await deps.execFile("adb", androidDeviceArgs(args.device, commandArgs), {
      timeout: 30_000,
      rejectOnError: false,
    });

    return {
      platform,
      packageName,
      stdout: truncateSubprocessOutput(result.stdout),
      stderr: truncateSubprocessOutput(result.stderr),
    };
  }

  const bundleId = requireString(args.bundleId ?? args.packageName, "bundleId");
  const device = await deps.resolveIosDevice(optionalString(args.device) ?? undefined, { preferBooted: true });
  const startedAt = deps.now();
  const result = await deps.execFile("xcrun", ["simctl", "launch", device.udid, bundleId], {
    timeout: 30_000,
    rejectOnError: false,
  });

  return attachIosCrashEvidence(
    {
      platform,
      device,
      bundleId,
      available: !result.error,
      stdout: truncateSubprocessOutput(result.stdout),
      stderr: truncateSubprocessOutput(result.stderr),
      error: result.error ?? null,
    },
    {
      platform,
      bundleId,
      processName: args.processName,
      sinceMs: startedAt,
      waitMs: args.crashCheckMs,
      action: "launch-app",
    },
    deps,
  );
}

export async function terminateApp(
  args: AppActionArgs,
  deps: AppLifecycleDependencies = defaultAppLifecycleDependencies,
): Promise<AppActionPayload> {
  const platform = platformArg(args.platform);
  const policy = await deps.policyDecision(args, "terminate-app", "device");
  if (!policy.allowed) return policyDeniedPayload("terminate-app", policy);
  const bundleId = await resolveBundleId(args, deps);
  if (args.dryRun === true) {
    return { available: true, dryRun: true, action: "terminate-app", platform, bundleId };
  }

  if (platform === "android") {
    const result = await deps.execFile("adb", androidDeviceArgs(args.device, ["shell", "am", "force-stop", bundleId]), {
      timeout: 20_000,
      rejectOnError: false,
    });
    return {
      available: !result.error,
      action: "terminate-app",
      platform,
      packageName: bundleId,
      stdout: truncateSubprocessOutput(result.stdout),
      stderr: truncateSubprocessOutput(result.stderr),
      error: result.error ?? null,
    };
  }

  const device = await deps.resolveIosDevice(optionalString(args.device) ?? undefined, { preferBooted: true });
  const result = await deps.execFile("xcrun", ["simctl", "terminate", device.udid, bundleId], {
    timeout: 20_000,
    rejectOnError: false,
  });
  return {
    available: !result.error,
    action: "terminate-app",
    platform,
    device,
    bundleId,
    stdout: truncateSubprocessOutput(result.stdout),
    stderr: truncateSubprocessOutput(result.stderr),
    error: result.error ?? null,
  };
}

export async function reloadApp(
  args: AppActionArgs,
  deps: AppLifecycleDependencies = defaultAppLifecycleDependencies,
): Promise<AppActionPayload> {
  const policy = await deps.policyDecision(args, "reload-app", "device");
  if (!policy.allowed) return policyDeniedPayload("reload-app", policy);
  const bundleId = await resolveBundleId(args, deps);
  if (args.dryRun === true) {
    return { available: true, dryRun: true, action: "reload-app", bundleId };
  }

  const terminated = await terminateApp({ ...args, bundleId }, deps);
  const launched = await launchApp({ ...args, bundleId }, deps);
  return {
    available: launched.available === false || launched.error ? false : true,
    action: "reload-app",
    bundleId,
    strategy: "terminate-and-launch",
    terminated,
    launched,
  };
}

export async function attachIosCrashEvidence(
  payload: AppActionPayload,
  options: AppActionArgs,
  deps: AppLifecycleDependencies,
): Promise<AppActionPayload> {
  if (options.platform !== "ios") return payload;
  const evidence = await iosCrashEvidence(options, deps);
  const crashReports = Array.isArray(evidence.crashReports) ? evidence.crashReports : [];
  if (crashReports.length === 0) return { ...payload, ...evidence };

  return {
    ...payload,
    ...evidence,
    available: false,
    reason: `The app generated ${crashReports.length} matching iOS crash report(s) after ${String(options.action)}.`,
  };
}

export async function iosCrashEvidence(
  args: AppActionArgs,
  deps: AppLifecycleDependencies = defaultAppLifecycleDependencies,
): Promise<AppActionPayload> {
  const sinceMs = finiteNumber(args.sinceMs ?? deps.now());
  const delay = clampNumber(args.waitMs ?? 0, 0, 30_000);
  if (delay > 0) await deps.wait(delay);

  const bundleId = optionalString(args.bundleId);
  const processName = optionalString(args.processName);
  const crashReports = await matchingIosCrashReports({ bundleId, processName, sinceMs }, deps);
  return {
    crashCheck: {
      action: String(args.action ?? "launch-app"),
      bundleId: bundleId ?? null,
      processName: processName ?? null,
      since: new Date(sinceMs).toISOString(),
      waitedMs: delay,
      reportCount: crashReports.length,
    },
    crashReports,
  };
}

export async function matchingIosCrashReports(
  args: AppActionArgs,
  deps: AppLifecycleDependencies = defaultAppLifecycleDependencies,
): Promise<AppActionPayload[]> {
  const bundleId = optionalString(args.bundleId);
  const processName = optionalString(args.processName);
  if (!bundleId && !processName) return [];

  const reports = await deps.listDiagnosticReports();
  const sinceMs = finiteNumber(args.sinceMs ?? 0);
  const wantedProcess = processName?.toLowerCase() ?? null;
  const matches: AppActionPayload[] = [];

  for (const report of reports) {
    if (!report.isFile) continue;
    if (!/(\.ips|\.crash)$/.test(report.name)) continue;
    if (report.mtimeMs < sinceMs) continue;

    const metadata = parseCrashReportMetadata(report.content);
    const metadataBundle = stringFrom(metadata?.bundleID ?? metadata?.bundleId);
    const metadataName = stringFrom(metadata?.app_name ?? metadata?.name ?? metadata?.procName);
    const nameMatches = wantedProcess
      ? report.name.toLowerCase().includes(wantedProcess) || (metadataName?.toLowerCase() === wantedProcess)
      : false;

    if ((bundleId && metadataBundle === bundleId) || nameMatches) {
      matches.push({
        path: report.path,
        file: report.name,
        mtime: report.mtimeIso,
        appName: metadataName,
        bundleId: metadataBundle,
        incidentId: stringFrom(metadata?.incident_id ?? metadata?.incident),
      });
    }
  }

  return matches.sort((left, right) => String(left.path).localeCompare(String(right.path)));
}

export async function readCrashReportMetadata(
  reportPath: string,
  deps: AppLifecycleDependencies = defaultAppLifecycleDependencies,
): Promise<Record<string, unknown> | null> {
  const report = (await deps.listDiagnosticReports()).find((entry) => entry.path === reportPath);
  return report ? parseCrashReportMetadata(report.content) : null;
}

export async function installApp(
  args: AppActionArgs,
  deps: AppLifecycleDependencies = defaultAppLifecycleDependencies,
): Promise<AppActionPayload> {
  const platform = platformArg(args.platform);
  const appPath = resolvePath(requireString(args.appPath, "appPath"));
  const policy = await deps.policyDecision(args, "install-app", "device");
  if (!policy.allowed) return policyDeniedPayload("install-app", policy);
  if (args.dryRun === true) {
    return { available: true, dryRun: true, action: "install-app", platform, appPath, policy };
  }

  if (platform === "android") {
    const result = await deps.execFile("adb", androidDeviceArgs(args.device, ["install", "-r", appPath]), {
      timeout: 120_000,
      rejectOnError: false,
    });
    return {
      available: !result.error,
      action: "install-app",
      platform,
      appPath,
      stdout: truncateSubprocessOutput(result.stdout),
      stderr: truncateSubprocessOutput(result.stderr),
      error: result.error ?? null,
      policy,
    };
  }

  const device = await deps.resolveIosDevice(optionalString(args.device) ?? undefined, { preferBooted: true });
  const result = await deps.execFile("xcrun", ["simctl", "install", device.udid, appPath], {
    timeout: 120_000,
    rejectOnError: false,
  });
  return {
    available: !result.error,
    action: "install-app",
    platform,
    device,
    appPath,
    stdout: truncateSubprocessOutput(result.stdout),
    stderr: truncateSubprocessOutput(result.stderr),
    error: result.error ?? null,
    policy,
  };
}

export async function uninstallApp(
  args: AppActionArgs,
  deps: AppLifecycleDependencies = defaultAppLifecycleDependencies,
): Promise<AppActionPayload> {
  const platform = platformArg(args.platform);
  const policy = await deps.policyDecision(args, "uninstall-app", "device");
  if (!policy.allowed) return policyDeniedPayload("uninstall-app", policy);
  const bundleId = await resolveBundleId(args, deps);
  if (args.dryRun === true) {
    return { available: true, dryRun: true, action: "uninstall-app", platform, bundleId, policy };
  }

  if (platform === "android") {
    const result = await deps.execFile("adb", androidDeviceArgs(args.device, ["uninstall", bundleId]), {
      timeout: 60_000,
      rejectOnError: false,
    });
    return {
      available: !result.error,
      action: "uninstall-app",
      platform,
      packageName: bundleId,
      stdout: truncateSubprocessOutput(result.stdout),
      stderr: truncateSubprocessOutput(result.stderr),
      error: result.error ?? null,
      policy,
    };
  }

  const device = await deps.resolveIosDevice(optionalString(args.device) ?? undefined, { preferBooted: true });
  const result = await deps.execFile("xcrun", ["simctl", "uninstall", device.udid, bundleId], {
    timeout: 60_000,
    rejectOnError: false,
  });
  return {
    available: !result.error,
    action: "uninstall-app",
    platform,
    device,
    bundleId,
    stdout: truncateSubprocessOutput(result.stdout),
    stderr: truncateSubprocessOutput(result.stderr),
    error: result.error ?? null,
    policy,
  };
}

export async function resolveBundleId(
  args: AppActionArgs,
  deps: AppLifecycleDependencies = defaultAppLifecycleDependencies,
): Promise<string> {
  const explicit = optionalString(args.bundleId ?? args.packageName);
  if (explicit) return explicit;

  const cwd = optionalString(args.cwd) ?? ".";
  const summary = await deps.runtimeSummary(cwd).catch(() => null);
  const inferred = optionalString(summary?.appConfig?.iosBundleIdentifier ?? summary?.appConfig?.androidPackage);
  if (!inferred) throw new Error("bundleId must be provided or inferable from Expo app config.");
  return inferred;
}

export async function collectAppLogs(
  args: AppActionArgs,
  deps: AppLifecycleDependencies = defaultAppLifecycleDependencies,
): Promise<AppActionPayload> {
  const platform = platformArg(args.platform);
  if (platform === "android") {
    const device = optionalString(args.device);
    const lines = String(clampNumber(args.lines ?? 500, 1, 5000));
    const result = await deps.execFile("adb", androidDeviceArgs(device, ["logcat", "-d", "-t", lines]), {
      timeout: 30_000,
      maxBuffer: 4 * 1024 * 1024,
      rejectOnError: false,
    });
    return {
      platform,
      device: device ?? null,
      stdout: truncateSubprocessOutput(result.stdout),
      stderr: truncateSubprocessOutput(result.stderr),
    };
  }

  const device = await deps.resolveIosDevice(optionalString(args.device) ?? undefined, { preferBooted: true });
  const last = optionalString(args.last) ?? "2m";
  if (!/^\d+[smhd]$/.test(last)) throw new Error("last must look like 30s, 2m, 1h, or 1d.");
  const predicate = optionalString(args.predicate) ?? iosLogPredicate(args);
  const commandArgs = ["simctl", "spawn", device.udid, "log", "show", "--style", "compact", "--last", last];
  if (predicate) commandArgs.push("--predicate", predicate);
  const result = await deps.execFile("xcrun", commandArgs, {
    timeout: 45_000,
    maxBuffer: 5 * 1024 * 1024,
    rejectOnError: false,
  });

  return {
    platform,
    device,
    last,
    predicate: predicate ?? null,
    stdout: truncateSubprocessOutput(result.stdout),
    stderr: truncateSubprocessOutput(result.stderr),
  };
}

export function iosLogPredicate(args: AppActionArgs): string | null {
  const processName = optionalString(args.processName);
  if (processName) return `process == "${escapePredicateValue(processName)}"`;

  const bundleId = optionalString(args.bundleId);
  const inferredProcess = bundleId?.split(".").filter(Boolean).at(-1);
  return inferredProcess ? `process CONTAINS "${escapePredicateValue(inferredProcess)}"` : null;
}

function defaultExecFile(file: string, args: string[], options: ExecOptions = {}): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    nodeExecFile(file, args, {
      timeout: options.timeout,
      maxBuffer: options.maxBuffer ?? MAX_OUTPUT,
    }, (error, stdout, stderr) => {
      if (error && options.rejectOnError !== false) {
        Object.assign(error, { stdout, stderr });
        reject(error);
        return;
      }
      resolve({
        stdout: String(stdout ?? ""),
        stderr: String(stderr ?? ""),
        error: error ? { message: error.message, code: error.code, signal: error.signal } : null,
      });
    });
  });
}

async function defaultResolveIosDevice(requested: string | undefined): Promise<IosDevice> {
  if (requested && /^[0-9A-Fa-f-]{20,}$/.test(requested)) {
    return { udid: requested, name: requested, state: "unknown" };
  }

  const { stdout } = await defaultExecFile("xcrun", ["simctl", "list", "devices", "available", "--json"], {
    timeout: 20_000,
    maxBuffer: 4 * 1024 * 1024,
  });
  const parsed = JSON.parse(String(stdout ?? "{}")) as { devices?: Record<string, unknown[]> };
  const devices = Object.entries(parsed.devices ?? {}).flatMap(([runtime, runtimeDevices]) =>
    (Array.isArray(runtimeDevices) ? runtimeDevices : []).map((device) => {
      const record = isRecord(device) ? device : {};
      return {
        udid: String(record.udid ?? ""),
        name: String(record.name ?? ""),
        state: stringFrom(record.state) ?? undefined,
        runtime,
        isAvailable: record.isAvailable === undefined ? undefined : Boolean(record.isAvailable),
      };
    }),
  ).filter((device) => device.udid && device.name);

  if (requested) {
    const exact = devices.find((device) => device.udid === requested || device.name === requested);
    if (exact) return exact;
    const partial = devices.find((device) => device.name.toLowerCase().includes(requested.toLowerCase()));
    if (partial) return partial;
    throw new Error(`No available iOS simulator matched: ${requested}`);
  }

  const booted = devices.find((device) => device.state === "Booted");
  if (booted) return booted;
  const iphone = [...devices].reverse().find((device) => /iPhone/.test(device.name));
  if (iphone) return iphone;
  if (devices[0]) return devices[0];
  throw new Error("No available iOS simulators found.");
}

async function defaultPolicyDecision(
  args: Record<string, unknown>,
  action: string,
  sideEffect: "device",
): Promise<ActionPolicyDecision> {
  const policyPath = optionalString(args.actionPolicy);
  if (!policyPath) {
    return {
      checked: true,
      action,
      sideEffect,
      allowed: false,
      source: null,
      reason: "No action policy allowed this state-changing operation.",
    };
  }

  const policy = JSON.parse(await fs.readFile(resolvePath(policyPath), "utf8")) as {
    allow?: unknown;
    actions?: Record<string, unknown>;
  };
  const allowed = (Array.isArray(policy.allow) && policy.allow.includes(action))
    || policy.actions?.[action] === true
    || policy.actions?.[action] === "allow";
  return {
    checked: true,
    action,
    sideEffect,
    allowed,
    source: resolvePath(policyPath),
    reason: allowed ? "Action allowed by policy." : "Action policy did not allow this operation.",
  };
}

async function defaultRuntimeSummary(cwd: string): Promise<RuntimeSummary | null> {
  const appJsonPath = resolvePath(cwd, "app.json");
  const text = await fs.readFile(appJsonPath, "utf8").catch(() => null);
  if (!text) return null;
  const parsed = JSON.parse(text) as Record<string, unknown>;
  const expo = isRecord(parsed.expo) ? parsed.expo : parsed;
  const ios = isRecord(expo.ios) ? expo.ios : {};
  const android = isRecord(expo.android) ? expo.android : {};
  return {
    appConfig: {
      iosBundleIdentifier: stringFrom(ios.bundleIdentifier) ?? stringFrom(expo.bundleIdentifier),
      androidPackage: stringFrom(android.package) ?? stringFrom(expo.package),
    },
  };
}

async function defaultListDiagnosticReports(): Promise<DiagnosticReportEntry[]> {
  const directory = joinPath(homedir(), "Library", "Logs", "DiagnosticReports");
  const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
  const reports = await Promise.all(entries
    .filter((entry) => entry.isFile() && /\.(ips|crash)$/.test(entry.name))
    .map(async (entry) => {
      const file = joinPath(directory, entry.name);
      const stat = await fs.stat(file);
      return {
        name: entry.name,
        path: file,
        isFile: true,
        mtimeMs: stat.mtimeMs,
        mtimeIso: stat.mtime.toISOString(),
        content: await fs.readFile(file, "utf8").catch(() => ""),
      };
    }));
  return reports;
}

export function truncateSubprocessOutput(value: unknown, limit = MAX_OUTPUT): string {
  const text = value == null ? "" : String(value);
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}\n[truncated ${text.length - limit} characters]`;
}

function androidDeviceArgs(device: unknown, args: string[]): string[] {
  const requested = optionalString(device);
  return requested ? ["-s", requested, ...args] : args;
}

function clampNumber(value: unknown, min: number, max: number): number {
  const number = finiteNumber(value);
  return Math.min(max, Math.max(min, number));
}

function escapePredicateValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown): number {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`Expected a finite number, got ${String(value)}.`);
  return number;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function platformArg(value: unknown): Platform {
  return value === "android" ? "android" : "ios";
}

function policyDeniedPayload(action: string, policy: ActionPolicyDecision): AppActionPayload {
  return {
    available: false,
    domain: "app",
    action,
    source: "policy",
    evidenceSource: "policy",
    code: "policy-denied",
    denied: true,
    reason: "Policy denied action.",
    policy,
  };
}

function parseCrashReportMetadata(content: string): Record<string, unknown> | null {
  const firstLine = content.split(/\r?\n/, 1)[0]?.trim();
  if (!firstLine?.startsWith("{")) return null;

  try {
    const parsed: unknown = JSON.parse(firstLine);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function requireString(value: unknown, field: string): string {
  const text = optionalString(value);
  if (!text) throw new Error(`${field} must be a non-empty string.`);
  return text;
}

function stringFrom(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}
