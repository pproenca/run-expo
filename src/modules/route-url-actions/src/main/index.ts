import { execFile as nodeExecFile } from "node:child_process";
import * as fs from "node:fs/promises";
import path from "node:path";

const MAX_OUTPUT = 40_000;

export interface ToolTextResult {
  content: Array<{
    type: "text";
    text: string;
  }>;
  isError?: boolean;
}

export interface ExecFileResult {
  stdout?: string;
  stderr?: string;
  error?: ExecErrorResult | null;
}

export interface ExecErrorResult {
  message?: string;
  code?: string | number | null;
  signal?: string | null;
  [key: string]: unknown;
}

export type ExecFile = (
  file: string,
  args: readonly string[],
  options?: Record<string, unknown>,
) => Promise<ExecFileResult>;

export interface RouteUrlActionDependencies {
  execFile?: ExecFile;
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

export interface RouteUrlArgs {
  platform?: "ios" | "android" | string;
  url?: unknown;
  device?: string;
  cwd?: string;
  scheme?: unknown;
  route?: unknown;
  query?: unknown;
  authCookie?: unknown;
  [key: string]: unknown;
}

export function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${field} must be a non-empty string.`);
  }
  return value.trim();
}

export function requireOptionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export async function buildExpoRouteUrl(cwd: string, args: RouteUrlArgs = {}): Promise<string> {
  const scheme = requireOptionalString(args.scheme) ?? await inferExpoScheme(cwd);
  if (!scheme) throw new Error("Could not infer Expo scheme. Pass scheme or url.");

  const rawRoute = requireOptionalString(args.route) ?? "/";
  const route = rawRoute.startsWith("/") ? rawRoute.slice(1) : rawRoute;
  const params = new URLSearchParams(requireOptionalString(args.query) ?? "");
  const authCookie = requireOptionalString(args.authCookie);
  if (authCookie) params.set("cookie", authCookie);
  const query = params.toString();
  return `${scheme}:///${route}${query ? `?${query}` : ""}`;
}

export async function inferExpoScheme(cwd: string): Promise<string | null> {
  const appJsonPath = path.join(cwd, "app.json");
  if (await pathExists(appJsonPath)) {
    const appJson = await readJsonFile(appJsonPath);
    const expo = isRecord(appJson.expo) ? appJson.expo : {};
    const scheme = expo.scheme ?? appJson.scheme;
    if (typeof scheme === "string" && scheme.trim()) return scheme.trim();
  }

  const configPath = await firstExisting(cwd, ["app.config.ts", "app.config.js", "app.config.mjs", "app.config.cjs"]);
  if (!configPath) return null;
  const text = await fs.readFile(configPath, "utf8");
  const match = /\bscheme\s*:\s*["'`]([^"'`]+)["'`]/.exec(text);
  return match?.[1] ?? null;
}

export function redactUrlAuthCookie(url: string): string {
  try {
    const parsed = new URL(url);
    for (const key of [...parsed.searchParams.keys()]) {
      if (isSensitiveQueryKey(key)) parsed.searchParams.set(key, "[redacted]");
    }
    return parsed.toString();
  } catch {
    return redactSensitiveUrlQuery(url);
  }
}

export function processNameFromBundleId(bundleId: unknown): string | null {
  if (!bundleId) return null;
  const last = String(bundleId).split(".").filter(Boolean).at(-1);
  return last ? last.replace(/[^a-zA-Z0-9_-]/g, "") : null;
}

export function androidDeviceArgs(device: string | null | undefined, args: readonly string[]): string[] {
  return device ? ["-s", device, ...args] : [...args];
}

export async function resolveIosDevice(
  requested?: string | null,
  options: ResolveIosDeviceOptions = {},
  deps: RouteUrlActionDependencies = {},
): Promise<IosDevice> {
  if (requested && /^[0-9A-Fa-f-]{20,}$/.test(requested)) {
    return { udid: requested, name: requested, state: "unknown" };
  }

  const execFile = deps.execFile ?? defaultExecFile;
  const { stdout } = await execFile("xcrun", ["simctl", "list", "devices", "available", "--json"], {
    timeout: 20_000,
    maxBuffer: 4 * 1024 * 1024,
  });
  const parsed = JSON.parse(String(stdout ?? "{}")) as { devices?: Record<string, unknown[]> };
  const devices = Object.entries(parsed.devices ?? {}).flatMap(([runtime, runtimeDevices]) =>
    (Array.isArray(runtimeDevices) ? runtimeDevices : []).map((device) => ({ ...device as Record<string, unknown>, runtime }) as IosDevice),
  );

  if (requested) {
    const exact = devices.find((device) => device.udid === requested || device.name === requested);
    if (exact) return exact;
    const partial = devices.find((device) => String(device.name).toLowerCase().includes(requested.toLowerCase()));
    if (partial) return partial;
    throw new Error(`No available iOS simulator matched: ${requested}`);
  }

  if (options.preferBooted) {
    const booted = devices.find((device) => device.state === "Booted");
    if (booted) return booted;
  }

  const iphone = [...devices].reverse().find((device) => /iPhone/.test(device.name));
  if (iphone) return iphone;
  if (devices[0]) return devices[0];
  throw new Error("No available iOS simulators found.");
}

export async function openUrl(
  args: RouteUrlArgs,
  deps: RouteUrlActionDependencies = {},
): Promise<ToolTextResult> {
  const platform = args.platform ?? "ios";
  const url = requireString(args.url, "url");
  if (/\s/.test(url)) throw new Error("url must not contain whitespace.");
  const execFile = deps.execFile ?? defaultExecFile;

  if (platform === "android") {
    const adbArgs = androidDeviceArgs(args.device, ["shell", "am", "start", "-a", "android.intent.action.VIEW", "-d", url]);
    const result = await execFile("adb", adbArgs, { timeout: 30_000, rejectOnError: false });
    return toolJson(redactToolPayload({ platform, device: args.device ?? null, stdout: truncate(result.stdout), stderr: truncate(result.stderr) }));
  }

  const device = await resolveIosDevice(args.device, { preferBooted: true }, deps);
  const result = await execFile("xcrun", ["simctl", "openurl", device.udid, url], {
    timeout: 30_000,
    rejectOnError: false,
  });
  return toolJson(redactToolPayload({ platform, device, stdout: truncate(result.stdout), stderr: truncate(result.stderr) }));
}

export async function openExpoRoute(
  args: RouteUrlArgs,
  deps: RouteUrlActionDependencies = {},
): Promise<ToolTextResult> {
  const cwd = await normalizeProjectCwd(args.cwd, { allowMissingPackageJson: true });
  const device = await resolveIosDevice(args.device, { preferBooted: true }, deps);
  const url = args.url ? requireString(args.url, "url") : await buildExpoRouteUrl(cwd, args);
  if (/\s/.test(url)) throw new Error("url must not contain whitespace.");
  const execFile = deps.execFile ?? defaultExecFile;
  const result = await execFile("xcrun", ["simctl", "openurl", device.udid, url], {
    timeout: 30_000,
    rejectOnError: false,
  });

  return toolJson(redactToolPayload({
    platform: "ios",
    device,
    url: redactUrlAuthCookie(url),
    stdout: truncate(result.stdout),
    stderr: truncate(result.stderr),
    error: normalizeExecError(result.error),
  }));
}

async function normalizeProjectCwd(cwd: string | undefined, options: { allowMissingPackageJson?: boolean } = {}): Promise<string> {
  const resolved = await normalizeCwd(cwd);
  if (options.allowMissingPackageJson) return resolved;
  const packageJson = await findUp(resolved, "package.json");
  if (!packageJson) throw new Error(`No package.json found from ${resolved}. Pass cwd for an Expo project.`);
  return path.dirname(packageJson);
}

async function normalizeCwd(cwd: string | undefined): Promise<string> {
  const resolved = path.resolve(cwd ?? ".");
  const stat = await fs.stat(resolved).catch(() => null);
  if (!stat?.isDirectory()) throw new Error(`Directory does not exist: ${resolved}`);
  return resolved;
}

async function findUp(startDir: string, filename: string): Promise<string | null> {
  let current = path.resolve(startDir);
  while (true) {
    const candidate = path.join(current, filename);
    if (await pathExists(candidate)) return candidate;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

async function firstExisting(root: string, names: string[]): Promise<string | null> {
  for (const name of names) {
    const candidate = path.join(root, name);
    if (await pathExists(candidate)) return candidate;
  }
  return null;
}

async function pathExists(file: string): Promise<boolean> {
  return fs.access(file).then(() => true, () => false);
}

async function readJsonFile(file: string): Promise<Record<string, unknown>> {
  return JSON.parse(await fs.readFile(file, "utf8")) as Record<string, unknown>;
}

function toolJson(value: unknown): ToolTextResult {
  return { content: [{ type: "text", text: `${JSON.stringify(value, null, 2)}\n` }] };
}

function truncate(value: unknown, limit = MAX_OUTPUT): string {
  const text = String(value ?? "");
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}\n[truncated ${text.length - limit} characters]`;
}

function redactToolPayload<T>(value: T): T {
  return redactUnknown(value) as T;
}

function redactUnknown(value: unknown): unknown {
  if (typeof value === "string") return redactSensitiveUrlQuery(value);
  if (Array.isArray(value)) return value.map((item) => redactUnknown(item));
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactUnknown(item)]));
  }
  return value;
}

function normalizeExecError(error: ExecErrorResult | null | undefined): ExecErrorResult | null {
  if (!error) return error ?? null;
  return redactToolPayload({
    message: typeof error.message === "string" ? error.message : undefined,
    code: error.code ?? null,
    signal: error.signal ?? null,
  });
}

function redactSensitiveUrlQuery(value: string): string {
  return value.replace(
    /([?&][^=\s&]*(?:cookie|token|authorization|password|secret)[^=\s&]*=)[^&\s]+/gi,
    "$1[redacted]",
  );
}

function isSensitiveQueryKey(key: string): boolean {
  return /cookie|token|authorization|password|secret/i.test(key);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

const defaultExecFile: ExecFile = (file, args, options = {}) => new Promise((resolve, reject) => {
  const { timeout = 60_000, maxBuffer = MAX_OUTPUT, rejectOnError = true } = options;
  nodeExecFile(file, [...args], { timeout: Number(timeout), maxBuffer: Number(maxBuffer) }, (error, stdout, stderr) => {
    if (error && rejectOnError) {
      Object.assign(error, { stdout, stderr });
      reject(error);
      return;
    }
    resolve({
      stdout: String(stdout ?? ""),
      stderr: String(stderr ?? ""),
      error: error ? { message: error.message, code: error.code, signal: error.signal } : undefined,
    });
  });
});
