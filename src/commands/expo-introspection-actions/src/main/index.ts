import { access, readFile, stat } from "node:fs/promises";
import path from "node:path";

import {
  buildUpstreamDependencyReport,
  doctor,
  projectInfo,
} from "../../../project-info-doctor/src/main/index.ts";
import { toolJson, unwrapToolJson, type ToolTextResult } from "../../../../core/tool-json-envelope/src/main/index.ts";

export const EXPO_ACTIONS = ["modules", "config", "doctor", "upstream-policy", "prebuild-plan"] as const;

export type ExpoAction = (typeof EXPO_ACTIONS)[number];
export type ExpoModuleCategory = "expo" | "config-plugin" | "other";
export type ExpoRiskLevel = "low" | "medium" | "high";

export interface ExpoCommandArgs {
  action?: unknown;
  cwd?: string;
}

export interface ExpoProjectSummary extends Record<string, unknown> {
  projectRoot: string;
  expoDependency?: unknown;
  reactNativeDependency?: unknown;
  appConfig?: ExpoAppConfigSummary | null;
}

export interface ExpoAppConfigSummary extends Record<string, unknown> {
  dynamic?: boolean;
}

export interface ExpoModuleRecord {
  name: string;
  version: unknown;
  category: ExpoModuleCategory;
}

export interface NativeProjectRisk {
  kind: "native-project-present";
  platform: "ios" | "android";
  severity: "high";
  message: string;
}

export interface ConfigPluginRisk {
  kind: "config-plugin";
  package: string;
  severity: "medium";
  message: string;
}

export interface AppConfigPluginRisk {
  kind: "app-config-plugin";
  plugin: string;
  severity: "medium";
  message: string;
}

export type ExpoPrebuildRisk = NativeProjectRisk | ConfigPluginRisk | AppConfigPluginRisk;

export interface ExpoModuleRecordsDependencies {
  findUp: (projectRoot: string, filename: string) => Promise<string | null>;
  readJsonFile: (filePath: string) => Promise<unknown>;
}

export interface ExpoAppConfigPluginDependencies {
  joinPath: (...parts: string[]) => string;
  pathExists: (filePath: string) => Promise<boolean>;
  readJsonFile: (filePath: string) => Promise<unknown>;
  firstExisting: (projectRoot: string, names: string[]) => Promise<string | null>;
  readTextFile: (filePath: string) => Promise<string>;
}

export interface ExpoPrebuildRiskDependencies extends ExpoAppConfigPluginDependencies {}

export interface ExpoCommandDependencies extends ExpoModuleRecordsDependencies, ExpoPrebuildRiskDependencies {
  normalizeProjectCwd: (cwd: string | undefined, options: { allowMissingPackageJson: true }) => Promise<string>;
  resolvePath: (input: string) => string;
  currentWorkingDirectory: () => string;
  runtimeSummary: (cwd: string) => Promise<ExpoProjectSummary>;
  doctor: (args: { cwd: string }) => Promise<unknown>;
  projectInfo: (args: { cwd: string }) => Promise<unknown>;
  buildUpstreamDependencyReport: (projectRoot: string, allDeps: Record<string, string>) => unknown;
}

export async function expoCommand(
  args: ExpoCommandArgs = {},
  deps: ExpoCommandDependencies = defaultExpoCommandDependencies,
): Promise<ToolTextResult> {
  const action = requireString(args.action ?? "modules", "action");
  if (!isExpoAction(action)) throw new Error(`Unknown Expo action: ${action}`);

  const cwd = await deps.normalizeProjectCwd(args.cwd, { allowMissingPackageJson: true })
    .catch(() => deps.resolvePath(args.cwd ?? deps.currentWorkingDirectory()));
  const summary = await deps.runtimeSummary(cwd);

  if (action === "doctor") {
    return toolJson({
      available: true,
      action,
      sources: ["project", "native"],
      projectRoot: summary.projectRoot,
      summary: unwrapToolJson(await deps.doctor({ cwd: summary.projectRoot })),
    });
  }

  if (action === "upstream-policy") {
    const info = asRecord(unwrapToolJson(await deps.projectInfo({ cwd: summary.projectRoot }))) ?? {};
    return toolJson({
      available: Boolean(info.isExpoProject),
      action,
      sources: ["project"],
      projectRoot: summary.projectRoot,
      report: info.upstreamDependencies ?? deps.buildUpstreamDependencyReport(summary.projectRoot, {}),
      limitations: [
        "Static dependency policy cannot prove a runtime target is registered; run DevTools and bridge health checks for live domains.",
      ],
    });
  }

  if (action === "config") {
    return toolJson({
      available: true,
      action,
      sources: ["project"],
      ...summary,
      limitations: expoConfigLimitations(summary),
    });
  }

  const modules = await expoModuleRecords(summary.projectRoot, deps);
  if (action === "modules") {
    return toolJson({
      available: true,
      action,
      sources: ["project"],
      projectRoot: summary.projectRoot,
      expoDependency: summary.expoDependency,
      reactNativeDependency: summary.reactNativeDependency,
      modules,
      limitations: ["Static dependency inspection cannot prove which native modules are currently compiled into the running app."],
    });
  }

  const risks = await expoPrebuildRisks(summary.projectRoot, modules, deps);
  return toolJson({
    available: true,
    action,
    sources: ["project"],
    projectRoot: summary.projectRoot,
    riskLevel: expoPrebuildRiskLevel(risks),
    risks,
    modules: modules.filter((module) => module.category === "config-plugin"),
    appConfig: summary.appConfig,
    limitations: [
      "This static plan flags rebuild risk; it does not run expo prebuild or mutate native projects.",
      "Dynamic app.config files are read with conservative string extraction only.",
    ],
  });
}

const defaultExpoCommandDependencies: ExpoCommandDependencies = {
  normalizeProjectCwd: defaultNormalizeProjectCwd,
  resolvePath: (input) => path.resolve(input),
  currentWorkingDirectory: () => process.cwd(),
  runtimeSummary: async (cwd) => {
    const info = asRecord(unwrapToolJson(await projectInfo({ cwd }))) ?? {};
    return {
      projectRoot: String(info.projectRoot ?? cwd),
      expoDependency: info.expoDependency ?? null,
      reactNativeDependency: info.reactNativeDependency ?? null,
      appConfig: asRecord(info.appConfig) as ExpoAppConfigSummary | null,
    };
  },
  doctor,
  projectInfo,
  buildUpstreamDependencyReport,
  findUp,
  readJsonFile: async (filePath) => JSON.parse(await readFile(filePath, "utf8")),
  joinPath: (...parts) => path.join(...parts),
  pathExists: async (filePath) => access(filePath).then(() => true, () => false),
  firstExisting: async (projectRoot, names) => {
    for (const name of names) {
      const candidate = path.join(projectRoot, name);
      if (await access(candidate).then(() => true, () => false)) return candidate;
    }
    return null;
  },
  readTextFile: (filePath) => readFile(filePath, "utf8"),
};

export async function expoModuleRecords(
  projectRoot: string,
  deps: ExpoModuleRecordsDependencies,
): Promise<ExpoModuleRecord[]> {
  const packageJsonPath = await deps.findUp(projectRoot, "package.json");
  const packageJson = packageJsonPath ? asRecord(await deps.readJsonFile(packageJsonPath)) ?? {} : {};
  const allDeps = {
    ...asRecord(packageJson.dependencies),
    ...asRecord(packageJson.devDependencies),
  };

  return Object.entries(allDeps)
    .filter(([name]) => isExpoRelatedPackage(name))
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, version]) => ({
      name,
      version,
      category: expoModuleCategory(name),
    }));
}

export function isExpoRelatedPackage(name: string): boolean {
  return name === "expo" ||
    name.startsWith("expo-") ||
    name.startsWith("@expo/") ||
    name.startsWith("@config-plugins/") ||
    name.includes("config-plugin");
}

export function expoModuleCategory(name: string): ExpoModuleCategory {
  if (name.startsWith("@config-plugins/") || name.includes("config-plugin")) return "config-plugin";
  if (name === "expo" || name.startsWith("expo-") || name.startsWith("@expo/")) return "expo";
  return "other";
}

export async function expoPrebuildRisks(
  projectRoot: string,
  modules: ExpoModuleRecord[],
  deps: ExpoPrebuildRiskDependencies,
): Promise<ExpoPrebuildRisk[]> {
  const risks: ExpoPrebuildRisk[] = [];

  for (const platformDir of ["ios", "android"] as const) {
    if (await deps.pathExists(deps.joinPath(projectRoot, platformDir))) {
      risks.push({
        kind: "native-project-present",
        platform: platformDir,
        severity: "high",
        message: `${platformDir} native project exists; config and native module changes may require a rebuild.`,
      });
    }
  }

  for (const module of modules.filter((item) => item.category === "config-plugin")) {
    risks.push({
      kind: "config-plugin",
      package: module.name,
      severity: "medium",
      message: "Config-plugin dependency can affect native prebuild output.",
    });
  }

  for (const plugin of await readExpoAppConfigPlugins(projectRoot, deps)) {
    risks.push({
      kind: "app-config-plugin",
      plugin,
      severity: "medium",
      message: "App config plugin can affect native prebuild output.",
    });
  }

  return risks;
}

export async function readExpoAppConfigPlugins(
  projectRoot: string,
  deps: ExpoAppConfigPluginDependencies,
): Promise<string[]> {
  const appJsonPath = deps.joinPath(projectRoot, "app.json");
  if (await deps.pathExists(appJsonPath)) {
    const appJson = asRecord(await deps.readJsonFile(appJsonPath));
    const expoConfig = asRecord(appJson?.expo);
    const plugins = expoConfig?.plugins ?? appJson?.plugins ?? [];
    return Array.isArray(plugins) ? plugins.map(formatExpoPluginEntry) : [];
  }

  const configPath = await deps.firstExisting(projectRoot, ["app.config.ts", "app.config.js", "app.config.mjs", "app.config.cjs"]);
  if (!configPath) return [];
  const text = await deps.readTextFile(configPath);
  const match = /\bplugins\s*:\s*\[([\s\S]*?)\]/m.exec(text);
  if (!match) return [];
  return [...match[1].matchAll(/["'`]([^"'`]+)["'`]/g)].map((item) => item[1]);
}

export function formatExpoPluginEntry(entry: unknown): string {
  if (typeof entry === "string") return entry;
  if (Array.isArray(entry)) return String(entry[0] ?? "");
  return JSON.stringify(entry);
}

export function expoConfigLimitations(summary: Pick<ExpoProjectSummary, "appConfig">): string[] {
  return summary.appConfig?.dynamic
    ? ["Dynamic Expo config was summarized with static string extraction and may omit computed values."]
    : ["Expo config is summarized from project files; native runtime overrides are not included."];
}

export function expoPrebuildRiskLevel(risks: ExpoPrebuildRisk[]): ExpoRiskLevel {
  if (risks.some((risk) => risk.kind === "native-project-present")) return "high";
  return risks.length > 0 ? "medium" : "low";
}

export function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${field} must be a non-empty string.`);
  }
  return value.trim();
}

function isExpoAction(action: string): action is ExpoAction {
  return (EXPO_ACTIONS as readonly string[]).includes(action);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

async function defaultNormalizeProjectCwd(cwd: string | undefined): Promise<string> {
  const resolved = path.resolve(cwd ?? ".");
  const details = await stat(resolved).catch(() => null);
  if (!details?.isDirectory()) throw new Error(`Directory does not exist: ${resolved}`);
  return resolved;
}

async function findUp(projectRoot: string, filename: string): Promise<string | null> {
  let current = path.resolve(projectRoot);
  while (true) {
    const candidate = path.join(current, filename);
    if (await access(candidate).then(() => true, () => false)) return candidate;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}
