import { execFile } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { CURRENT_CLI_NAME, CLI_VERSION } from "../../../../core/cli-identity/src/main/index.ts";
import {
  toolJson,
  unwrapToolJson,
  type ToolTextResult,
} from "../../../../core/tool-json-envelope/src/main/index.ts";

declare const process: { cwd(): string };

export const CLI_NAME = CURRENT_CLI_NAME;
export const MAX_OUTPUT = 40_000;

export interface CommandPaths {
  node: string | null;
  npx: string | null;
  xcrun: string | null;
  open: string | null;
  plutil: string | null;
  idb: string | null;
  axe: string | null;
  adb: string | null;
}

export interface DoctorDependencies {
  commandPath?: (command: string) => Promise<string | null>;
  hasFetch?: boolean;
  hasWebSocket?: boolean;
}

export interface DoctorArgs {
  cwd?: string;
  fix?: boolean;
  deps?: DoctorDependencies;
}

export interface ProjectInfoArgs {
  cwd?: string;
}

export interface DependencyInfo {
  name: string;
  present: boolean;
  declaredVersion: string | null;
  resolvedVersion: string | null;
  unresolved: boolean;
}

export interface CompatibilityClassification {
  state: string;
  expected: string;
  expo?: string | null;
  reactNative?: string | null;
}

const COMMAND_NAMES = ["node", "npx", "xcrun", "open", "plutil", "idb", "axe", "adb"] as const;
const EXPO_REACT_NATIVE_COMPATIBILITY = [
  { expoMajor: 54, reactNativeMajorMinor: "0.81" },
  { expoMajor: 53, reactNativeMajorMinor: "0.79" },
  { expoMajor: 52, reactNativeMajorMinor: "0.76" },
  { expoMajor: 51, reactNativeMajorMinor: "0.74" },
  { expoMajor: 50, reactNativeMajorMinor: "0.73" },
];

export async function doctor(args: DoctorArgs = {}): Promise<ToolTextResult> {
  const cwd = await normalizeCwd(args.cwd).catch(() => path.resolve(args.cwd ?? process.cwd()));
  const commands = {} as CommandPaths;
  for (const command of COMMAND_NAMES) {
    commands[command] = await commandPath(command, args.deps);
  }
  const projectInfoResult = await safeToolSection(() => projectInfo({ cwd }));
  const repairs = args.fix === true ? await doctorRepairs(cwd) : [];
  return toolJson({
    cli: { name: CLI_NAME, version: CLI_VERSION },
    cwd,
    auth: { required: false, source: "not-required" },
    commands,
    capabilities: {
      iosSimulator: Boolean(commands.xcrun),
      simulatorScreenshots: Boolean(commands.xcrun),
      iosCoordinateTap: Boolean(commands.idb || commands.axe),
      iosCoordinateGestures: Boolean(commands.idb || commands.axe),
      iosHierarchy: Boolean(commands.axe),
      androidDeviceBridge: Boolean(commands.adb),
      expoCli: Boolean(commands.npx),
      metroHermes:
        hasRuntimeGlobal("fetch", args.deps?.hasFetch) &&
        hasRuntimeGlobal("WebSocket", args.deps?.hasWebSocket),
    },
    repairs,
    project: projectInfoResult.ok ? unwrapToolJson(projectInfoResult.value) : projectInfoResult,
  });
}

export async function doctorRepairs(cwd: string): Promise<unknown[]> {
  const stateRoot = resolveExpoStateRoot({ cwd });
  const runs = path.join(stateRoot, "runs");
  const sessions = path.join(stateRoot, "sessions");
  await fs.mkdir(runs, { recursive: true });
  await fs.mkdir(sessions, { recursive: true });
  return [
    { action: "ensure-directory", path: runs },
    { action: "ensure-directory", path: sessions },
  ];
}

export async function projectInfo(args: ProjectInfoArgs): Promise<ToolTextResult> {
  const cwd = await normalizeCwd(args.cwd);
  const packageJsonPath = await findUp(cwd, "package.json");
  if (!packageJsonPath) {
    return toolJson({
      cwd,
      isExpoProject: false,
      reason: "No package.json found in this directory or its parents.",
    });
  }

  const projectRoot = path.dirname(packageJsonPath);
  const packageJson = asRecord(await readJsonFile(packageJsonPath)) ?? {};
  const allDeps = {
    ...asStringRecord(packageJson.dependencies),
    ...asStringRecord(packageJson.devDependencies),
  };
  const appJsonPath = await pathExists(path.join(projectRoot, "app.json"));
  const appConfigPath = await firstExisting(projectRoot, [
    "app.config.ts",
    "app.config.js",
    "app.config.mjs",
    "app.config.cjs",
  ]);
  const appJson = appJsonPath
    ? asRecord(await readJsonFile(path.join(projectRoot, "app.json")))
    : null;
  const expoConfig = appJson ? (asRecord(appJson.expo) ?? appJson) : null;
  const appConfigSummary = await readExpoConfigSummary(projectRoot);
  const easJson = (await pathExists(path.join(projectRoot, "eas.json")))
    ? asRecord(await readJsonFile(path.join(projectRoot, "eas.json")))
    : null;

  return toolJson({
    cwd,
    projectRoot,
    isExpoProject: Boolean(allDeps.expo || expoConfig),
    packageManager: await detectPackageManager(projectRoot),
    expoDependency: allDeps.expo ?? null,
    reactNativeDependency: allDeps["react-native"] ?? null,
    expoRouterDependency: allDeps["expo-router"] ?? null,
    upstreamDependencies: buildUpstreamDependencyReport(projectRoot, allDeps),
    scripts: asRecord(packageJson.scripts) ?? {},
    appConfig: appConfigSummary
      ? projectInfoAppConfigSummary(appConfigSummary as Record<string, unknown>)
      : expoConfig
        ? {
            source: appJsonPath ? "app.json" : path.basename(appConfigPath ?? ""),
            name: expoConfig.name ?? null,
            slug: expoConfig.slug ?? null,
            scheme: expoConfig.scheme ?? null,
            iosBundleIdentifier: asRecord(expoConfig.ios)?.bundleIdentifier ?? null,
            androidPackage: asRecord(expoConfig.android)?.package ?? null,
            easProjectId: asRecord(asRecord(expoConfig.extra)?.eas)?.projectId ?? null,
          }
        : null,
    hasDynamicAppConfig: Boolean(appConfigPath),
    eas: easJson
      ? {
          buildProfiles: Object.keys(asRecord(easJson.build) ?? {}),
          submitProfiles: Object.keys(asRecord(easJson.submit) ?? {}),
          cli: easJson.cli ?? null,
        }
      : null,
  });
}

export function buildUpstreamDependencyReport(
  projectRoot: string,
  allDeps: Record<string, string> = {},
): unknown {
  const expoVersion = dependencyInfo(allDeps, "expo");
  const reactNativeVersion = dependencyInfo(allDeps, "react-native");
  const metroVersion = dependencyInfo(allDeps, "metro");
  const expoCliVersion = dependencyInfo(allDeps, "@expo/cli");
  const devMiddlewareVersion = dependencyInfo(allDeps, "@react-native/dev-middleware");
  const rozenitePackages = Object.keys(allDeps)
    .filter((name) => name === "rozenite" || name.startsWith("@rozenite/"))
    .sort()
    .map((name) => dependencyInfo(allDeps, name));
  const expoRnCompatibility = classifyExpoReactNativeCompatibility(expoVersion, reactNativeVersion);
  const dependencies = [
    {
      id: "expo-public-api",
      ecosystem: "expo",
      packageName: "expo",
      integrationPoint:
        "Expo config, dev-client, expo/devtools plugin APIs, and public package exports.",
      classification: "public-api",
      usage: "direct-dependency",
      directDependency: expoVersion.present,
      declaredVersion: expoVersion.declaredVersion,
      resolvedVersion: expoVersion.resolvedVersion,
      status: dependencyStatus(expoVersion),
      compatibility: expoRnCompatibility.forExpo,
      notes: expoVersion.present
        ? ["Expo is declared by the project and can be used for public API compatibility checks."]
        : ["Expo is not declared; Expo-specific upstream clients remain unavailable."],
    },
    {
      id: "metro-inspector-http",
      ecosystem: "metro",
      packageName: "metro",
      integrationPoint:
        "Metro /status, /json/list, /json/version, /symbolicate, and /message HTTP/WebSocket surfaces.",
      classification: "documented-unstable-api",
      usage: "optional-compatibility-shim",
      directDependency: metroVersion.present,
      declaredVersion: metroVersion.declaredVersion,
      resolvedVersion: metroVersion.resolvedVersion,
      status: metroVersion.present
        ? dependencyStatus(metroVersion)
        : expoVersion.present
          ? "inferred-transitive"
          : "missing",
      compatibility: {
        state: metroVersion.present || expoVersion.present ? "discoverable-at-runtime" : "missing",
        expected:
          "Metro inspector endpoints are discovered over local HTTP at runtime; direct internal imports are not required.",
      },
      notes: [
        "The CLI may probe Metro's local HTTP endpoints, but Metro server internals are reference-only unless isolated by a shim.",
      ],
    },
    {
      id: "hermes-react-native-cdp",
      ecosystem: "hermes-react-native",
      packageName: "react-native",
      integrationPoint:
        "Hermes inspector Chrome DevTools Protocol websocket exposed by React Native/Metro.",
      classification: "optional-compatibility-shim",
      usage: "optional-compatibility-shim",
      directDependency: reactNativeVersion.present,
      declaredVersion: reactNativeVersion.declaredVersion,
      resolvedVersion: reactNativeVersion.resolvedVersion,
      status: dependencyStatus(reactNativeVersion),
      compatibility: expoRnCompatibility.forReactNative,
      notes: [
        "CDP method calls must stay behind the expo98 CDP client because Hermes/RN can expose implementation-specific methods.",
      ],
    },
    {
      id: "react-native-devtools",
      ecosystem: "react-native-devtools",
      packageName: "@react-native/dev-middleware",
      integrationPoint:
        "React Native DevTools launch metadata, panel discovery, and machine-readable domains where available.",
      classification: "documented-unstable-api",
      usage: "internal-reference-only",
      directDependency: devMiddlewareVersion.present,
      declaredVersion: devMiddlewareVersion.declaredVersion,
      resolvedVersion: devMiddlewareVersion.resolvedVersion,
      status: devMiddlewareVersion.present
        ? dependencyStatus(devMiddlewareVersion)
        : reactNativeVersion.present
          ? "reference-only"
          : "missing",
      compatibility: {
        state: reactNativeVersion.present ? "runtime-target-required" : "missing",
        expected:
          "React Native DevTools capabilities are confirmed from Metro target metadata before use.",
      },
      notes: [
        "React Native DevTools internals can inform local wrappers, but command code must not depend on private build paths.",
      ],
    },
    {
      id: "expo-devtools-plugin",
      ecosystem: "expo-devtools-plugin",
      packageName: "expo",
      integrationPoint:
        "expo/devtools and useDevToolsPluginClient two-way development plugin APIs.",
      classification: "public-api",
      usage: "direct-dependency",
      directDependency: expoVersion.present,
      declaredVersion: expoVersion.declaredVersion,
      resolvedVersion: expoVersion.resolvedVersion,
      status: dependencyStatus(expoVersion),
      compatibility: {
        state: expoVersion.present ? "available-when-app-registers" : "missing",
        expected:
          "Plugin domains still require a live development build to register the app-side bridge.",
      },
      notes: [
        "Plugin bridge installation and mutation remain explicit-user-permission operations.",
      ],
    },
    {
      id: "rozenite-devtools-bridge",
      ecosystem: "rozenite",
      packageName:
        rozenitePackages.length > 0
          ? rozenitePackages.map((item) => item.name).join(", ")
          : "rozenite/@rozenite/*",
      integrationPoint:
        "Rozenite bridge, agent, React Navigation, network, storage, controls, and performance integrations.",
      classification: "optional-compatibility-shim",
      usage: "optional-compatibility-shim",
      directDependency: rozenitePackages.length > 0,
      declaredVersion:
        rozenitePackages.length > 0
          ? rozenitePackages.map((item) => `${item.name}@${item.declaredVersion}`).join(", ")
          : null,
      resolvedVersion:
        rozenitePackages.length > 0
          ? rozenitePackages
              .map((item) => `${item.name}@${item.resolvedVersion ?? item.declaredVersion}`)
              .join(", ")
          : null,
      status:
        rozenitePackages.length > 0
          ? rozenitePackages.some((item) => item.unresolved)
            ? "declared-unresolved"
            : "present"
          : "missing",
      compatibility: {
        state: rozenitePackages.length > 0 ? "optional-present" : "optional-missing",
        expected:
          "Rozenite-backed domains are preferred only when installed and registered by the app.",
      },
      notes: [
        "Rozenite is optional; absence must produce structured unavailable data, not a CLI failure.",
      ],
    },
    {
      id: "expo-cli-internals",
      ecosystem: "expo",
      packageName: "@expo/cli",
      integrationPoint: "Expo CLI private implementation details used only as reference material.",
      classification: "internal-reference-only",
      usage: "internal-reference-only",
      directDependency: expoCliVersion.present,
      declaredVersion: expoCliVersion.declaredVersion,
      resolvedVersion: expoCliVersion.resolvedVersion,
      status: expoCliVersion.present ? dependencyStatus(expoCliVersion) : "not-depended-on",
      compatibility: {
        state: "reference-only",
        expected: "Private Expo CLI build paths must not be imported by command handlers.",
      },
      notes: [
        "If an internal path is ever needed, it must be wrapped by an optional compatibility shim with fallback behavior.",
      ],
    },
  ];
  return {
    schemaVersion: 1,
    projectRoot,
    policy: {
      categories: [
        { id: "public-api", mayImportDirectly: true, requiresShim: false },
        { id: "documented-unstable-api", mayImportDirectly: false, requiresShim: true },
        { id: "internal-reference-only", mayImportDirectly: false, requiresShim: true },
        { id: "optional-compatibility-shim", mayImportDirectly: false, requiresShim: true },
      ],
      rules: [
        "Command handlers depend on expo98 adapters, not raw upstream package objects.",
        "Metro and Hermes runtime availability is confirmed at runtime before a command reports live evidence.",
        "Internal Expo, Metro, React Native, or DevTools source paths are reference material unless isolated behind optional shims.",
        "Missing optional upstream packages produce structured unavailable reports instead of thrown errors.",
      ],
    },
    summary: summarizeUpstreamDependencies(dependencies),
    dependencies,
  };
}

export function dependencyInfo(allDeps: Record<string, string>, name: string): DependencyInfo {
  const declaredVersion = allDeps[name] ?? null;
  return {
    name,
    present: typeof declaredVersion === "string" && declaredVersion.length > 0,
    declaredVersion,
    resolvedVersion: parseVersionLike(declaredVersion),
    unresolved:
      typeof declaredVersion === "string" &&
      /^(catalog|workspace|file|link|portal):/.test(declaredVersion),
  };
}

export function dependencyStatus(info: DependencyInfo): string {
  if (!info.present) return "missing";
  if (info.unresolved) return "declared-unresolved";
  return "present";
}

export function parseVersionLike(version: unknown): string | null {
  if (typeof version !== "string") return null;
  const match = version.match(/\d+\.\d+(?:\.\d+)?/);
  return match ? (match[0] ?? null) : null;
}

export function classifyExpoReactNativeCompatibility(
  expoVersion: DependencyInfo,
  reactNativeVersion: DependencyInfo,
): { forExpo: CompatibilityClassification; forReactNative: CompatibilityClassification } {
  const missing = {
    state: "missing",
    expected: "Declare both expo and react-native to classify SDK compatibility.",
  };
  if (!expoVersion.present || !reactNativeVersion.present) {
    return { forExpo: missing, forReactNative: missing };
  }
  if (expoVersion.unresolved || reactNativeVersion.unresolved) {
    const unresolved = {
      state: "declared-unresolved",
      expected:
        "Resolve catalog/workspace dependency versions before treating compatibility as proven.",
      expo: expoVersion.declaredVersion,
      reactNative: reactNativeVersion.declaredVersion,
    };
    return { forExpo: unresolved, forReactNative: unresolved };
  }
  const expoMajor = majorFromVersion(expoVersion.declaredVersion);
  const reactNativeMajorMinor = majorMinorFromVersion(reactNativeVersion.declaredVersion);
  const expected = EXPO_REACT_NATIVE_COMPATIBILITY.find((entry) => entry.expoMajor === expoMajor);
  if (!expected) {
    const unknown = {
      state: "unknown",
      expected:
        "This Expo SDK is not in expo98's compatibility table; verify with the project dependency source.",
      expo: expoVersion.declaredVersion,
      reactNative: reactNativeVersion.declaredVersion,
    };
    return { forExpo: unknown, forReactNative: unknown };
  }
  const result = {
    state: reactNativeMajorMinor === expected.reactNativeMajorMinor ? "compatible" : "mismatched",
    expected: `Expo SDK ${expected.expoMajor} expects React Native ${expected.reactNativeMajorMinor}.x.`,
    expo: expoVersion.declaredVersion,
    reactNative: reactNativeVersion.declaredVersion,
  };
  return { forExpo: result, forReactNative: result };
}

export async function normalizeCwd(cwd?: string): Promise<string> {
  const resolved = path.resolve(cwd ?? process.cwd());
  const stat = await fs.stat(resolved).catch(() => null);
  if (!stat?.isDirectory()) throw new Error(`Directory does not exist: ${resolved}`);
  return resolved;
}

export async function findUp(startDir: string, filename: string): Promise<string | null> {
  let current = path.resolve(startDir);
  while (true) {
    const candidate = path.join(current, filename);
    if (await pathExists(candidate)) return candidate;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

export async function readJsonFile(file: string): Promise<unknown> {
  return JSON.parse(await fs.readFile(file, "utf8"));
}

export async function detectPackageManager(projectRoot: string): Promise<string> {
  let current = path.resolve(projectRoot);
  while (true) {
    if (await pathExists(path.join(current, "pnpm-lock.yaml"))) return "pnpm";
    if (await pathExists(path.join(current, "yarn.lock"))) return "yarn";
    if (await pathExists(path.join(current, "bun.lockb"))) return "bun";
    if (await pathExists(path.join(current, "bun.lock"))) return "bun";
    if (await pathExists(path.join(current, "package-lock.json"))) return "npm";
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return "unknown";
}

export async function firstExisting(root: string, names: string[]): Promise<string | null> {
  for (const name of names) {
    const candidate = path.join(root, name);
    if (await pathExists(candidate)) return candidate;
  }
  return null;
}

export async function pathExists(file: string): Promise<boolean> {
  return fs.access(file).then(
    () => true,
    () => false,
  );
}

export async function readExpoConfigSummary(projectRoot: string): Promise<unknown> {
  const appJsonPath = path.join(projectRoot, "app.json");
  if (await pathExists(appJsonPath)) {
    const appJson = asRecord(await readJsonFile(appJsonPath)) ?? {};
    const expo = asRecord(appJson.expo) ?? appJson;
    return {
      source: appJsonPath,
      name: expo.name ?? null,
      slug: expo.slug ?? null,
      scheme: expo.scheme ?? null,
      iosBundleIdentifier: asRecord(expo.ios)?.bundleIdentifier ?? null,
      androidPackage: asRecord(expo.android)?.package ?? null,
      easProjectId: asRecord(asRecord(expo.extra)?.eas)?.projectId ?? null,
      userInterfaceStyle: expo.userInterfaceStyle ?? null,
    };
  }
  const configPath = await firstExisting(projectRoot, [
    "app.config.ts",
    "app.config.js",
    "app.config.mjs",
    "app.config.cjs",
  ]);
  if (!configPath) return null;
  const text = await fs.readFile(configPath, "utf8");
  return {
    source: configPath,
    name: regexConfigValue(text, "name"),
    slug: regexConfigValue(text, "slug"),
    scheme: regexConfigValue(text, "scheme"),
    iosBundleIdentifier: regexNestedConfigValue(text, "bundleIdentifier"),
    androidPackage: regexNestedConfigValue(text, "package"),
    easProjectId: regexConfigValue(text, "projectId"),
    userInterfaceStyle: regexConfigValue(text, "userInterfaceStyle"),
    dynamic: true,
  };
}

export function projectInfoAppConfigSummary(summary: Record<string, unknown>): unknown {
  const payload: Record<string, unknown> = {
    source: path.basename(String(summary.source)),
    name: summary.name ?? null,
    slug: summary.slug ?? null,
    scheme: summary.scheme ?? null,
    iosBundleIdentifier: summary.iosBundleIdentifier ?? null,
    androidPackage: summary.androidPackage ?? null,
    easProjectId: summary.easProjectId ?? null,
  };
  if (summary.userInterfaceStyle != null) payload.userInterfaceStyle = summary.userInterfaceStyle;
  if (summary.dynamic === true) payload.dynamic = true;
  return payload;
}

export function resolveExpoStateRoot(
  args: { cwd?: string; root?: string; stateDir?: string } = {},
): string {
  if (args.stateDir) {
    const resolved = path.resolve(args.stateDir);
    return path.basename(resolved) === "runs" ? path.dirname(resolved) : resolved;
  }
  const root = path.resolve(args.root ?? args.cwd ?? process.cwd());
  return path.join(root, ".scratch", "expo98");
}

export async function safeToolSection<T>(
  fn: () => Promise<T> | T,
): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
  try {
    return { ok: true, value: await fn() };
  } catch (error) {
    return { ok: false, error: formatError(error) };
  }
}

export function truncate(value: unknown, limit = MAX_OUTPUT): string {
  const text = String(value ?? "");
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}\n[truncated ${text.length - limit} characters]`;
}

export function formatError(error: unknown): string {
  if (!error) return "Unknown error";
  const record = asRecord(error);
  const parts = [error instanceof Error ? error.message : String(error)];
  if (record?.stdout) parts.push(`stdout:\n${truncate(record.stdout)}`);
  if (record?.stderr) parts.push(`stderr:\n${truncate(record.stderr)}`);
  return parts.join("\n\n");
}

async function commandPath(command: string, deps?: DoctorDependencies): Promise<string | null> {
  if (deps?.commandPath) return deps.commandPath(command);
  const result = await execFilePromise("sh", ["-lc", `command -v ${shellArg(command)}`], {
    timeout: 5_000,
    rejectOnError: false,
  });
  return result.stdout.trim() || null;
}

function execFilePromise(
  file: string,
  args: string[],
  options: { timeout?: number; rejectOnError?: boolean } = {},
): Promise<{
  stdout: string;
  stderr: string;
  error: { message: string; code?: string | number; signal?: string | null } | null;
}> {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      { timeout: options.timeout },
      (error: any, stdout: unknown, stderr: unknown) => {
        const result = {
          stdout: String(stdout ?? ""),
          stderr: String(stderr ?? ""),
          error: error ? { message: error.message, code: error.code, signal: error.signal } : null,
        };
        if (error && options.rejectOnError !== false) reject(Object.assign(error, result));
        else resolve(result);
      },
    );
  });
}

function hasRuntimeGlobal(name: string, override: boolean | undefined): boolean {
  if (override !== undefined) return override;
  return typeof (globalThis as Record<string, unknown>)[name] === "function";
}

function shellArg(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asStringRecord(value: unknown): Record<string, string> {
  const record = asRecord(value);
  if (!record) return {};
  return Object.fromEntries(
    Object.entries(record).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

function majorFromVersion(version: unknown): number | null {
  const parsed = parseVersionLike(version);
  if (!parsed) return null;
  return Number(parsed.split(".")[0]);
}

function majorMinorFromVersion(version: unknown): string | null {
  const parsed = parseVersionLike(version);
  if (!parsed) return null;
  const [major, minor] = parsed.split(".");
  return `${major}.${minor ?? "0"}`;
}

function regexConfigValue(text: string, key: string): string | null {
  return new RegExp(`\\b${key}\\s*:\\s*["'\`]([^"'\`]+)["'\`]`).exec(text)?.[1] ?? null;
}

function regexNestedConfigValue(text: string, key: string): string | null {
  return new RegExp(`\\b${key}\\s*:\\s*["'\`]([^"'\`]+)["'\`]`).exec(text)?.[1] ?? null;
}

function summarizeUpstreamDependencies(dependencies: Array<Record<string, any>>): unknown {
  const statuses: Record<string, number> = {};
  for (const dependency of dependencies) {
    statuses[dependency.status] = (statuses[dependency.status] ?? 0) + 1;
  }
  return {
    total: dependencies.length,
    directDependencies: dependencies.filter(
      (dependency) => dependency.usage === "direct-dependency",
    ).length,
    internalReferenceOnly: dependencies.filter(
      (dependency) => dependency.classification === "internal-reference-only",
    ).length,
    optionalCompatibilityShims: dependencies.filter(
      (dependency) => dependency.classification === "optional-compatibility-shim",
    ).length,
    statuses,
    mismatched: dependencies
      .filter((dependency) => dependency.compatibility?.state === "mismatched")
      .map((dependency) => dependency.id),
    missing: dependencies
      .filter((dependency) => dependency.status === "missing")
      .map((dependency) => dependency.id),
  };
}
