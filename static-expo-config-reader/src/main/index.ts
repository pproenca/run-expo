import { promises as fs } from "node:fs";
import path from "node:path";

export interface ExpoConfigSummary {
  source: string;
  name: unknown;
  slug: unknown;
  scheme: unknown;
  iosBundleIdentifier: unknown;
  androidPackage: unknown;
  easProjectId: unknown;
  userInterfaceStyle: unknown;
  dynamic?: true;
}

export async function readExpoConfigSummary(projectRoot: string): Promise<ExpoConfigSummary | null> {
  const appJsonPath = path.join(projectRoot, "app.json");
  if (await pathExists(appJsonPath)) {
    const appJson = await readJsonFile(appJsonPath) as Record<string, any>;
    const expo = appJson.expo ?? appJson;
    return {
      source: appJsonPath,
      name: expo.name ?? null,
      slug: expo.slug ?? null,
      scheme: expo.scheme ?? null,
      iosBundleIdentifier: expo.ios?.bundleIdentifier ?? null,
      androidPackage: expo.android?.package ?? null,
      easProjectId: expo.extra?.eas?.projectId ?? null,
      userInterfaceStyle: expo.userInterfaceStyle ?? null,
    };
  }

  const configPath = await firstExisting(projectRoot, ["app.config.ts", "app.config.js", "app.config.mjs", "app.config.cjs"]);
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

export async function firstExisting(root: string, names: string[]): Promise<string | null> {
  for (const name of names) {
    const candidate = path.join(root, name);
    if (await pathExists(candidate)) return candidate;
  }
  return null;
}

export async function pathExists(file: string): Promise<boolean> {
  return fs.access(file).then(() => true, () => false);
}

export async function readJsonFile(file: string): Promise<unknown> {
  return JSON.parse(await fs.readFile(file, "utf8"));
}

export function regexConfigValue(text: string, key: string): string | null {
  return new RegExp(`\\b${key}\\s*:\\s*["'\`]([^"'\`]+)["'\`]`).exec(text)?.[1] ?? null;
}

export function regexNestedConfigValue(text: string, key: string): string | null {
  return new RegExp(`\\b${key}\\s*:\\s*["'\`]([^"'\`]+)["'\`]`).exec(text)?.[1] ?? null;
}
