import { promises as fs } from "node:fs";
import path from "node:path";

export type ExpoModuleCategory = "expo" | "config-plugin" | "other";
export type ExpoRiskLevel = "low" | "medium" | "high";

export interface ExpoAppConfigSummary {
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
  findUp: (startDir: string, filename: string) => Promise<string | null>;
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

const defaultModuleRecordDeps: ExpoModuleRecordsDependencies = {
  findUp,
  readJsonFile,
};

const defaultAppConfigDeps: ExpoAppConfigPluginDependencies = {
  joinPath: path.join,
  pathExists,
  readJsonFile,
  firstExisting,
  readTextFile,
};

export async function expoModuleRecords(
  projectRoot: string,
  deps: ExpoModuleRecordsDependencies = defaultModuleRecordDeps,
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
  deps: ExpoPrebuildRiskDependencies = defaultAppConfigDeps,
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
  deps: ExpoAppConfigPluginDependencies = defaultAppConfigDeps,
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
  const pluginListText = match[1] ?? "";
  return [...pluginListText.matchAll(/["'`]([^"'`]+)["'`]/g)].map((item) => item[1] ?? "");
}

export function formatExpoPluginEntry(entry: unknown): string {
  if (typeof entry === "string") return entry;
  if (Array.isArray(entry)) return String(entry[0] ?? "");
  return JSON.stringify(entry);
}

export function expoConfigLimitations(summary: { appConfig?: ExpoAppConfigSummary | null }): string[] {
  return summary.appConfig?.dynamic
    ? ["Dynamic Expo config was summarized with static string extraction and may omit computed values."]
    : ["Expo config is summarized from project files; native runtime overrides are not included."];
}

export function expoPrebuildRiskLevel(risks: ExpoPrebuildRisk[]): ExpoRiskLevel {
  if (risks.some((risk) => risk.kind === "native-project-present")) return "high";
  return risks.length > 0 ? "medium" : "low";
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

export async function firstExisting(root: string, names: string[]): Promise<string | null> {
  for (const name of names) {
    const candidate = path.join(root, name);
    if (await pathExists(candidate)) return candidate;
  }
  return null;
}

export async function pathExists(filePath: string): Promise<boolean> {
  return fs.access(filePath).then(() => true, () => false);
}

export async function readJsonFile(filePath: string): Promise<unknown> {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

export async function readTextFile(filePath: string): Promise<string> {
  return fs.readFile(filePath, "utf8");
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}
