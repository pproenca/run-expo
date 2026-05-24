import path from "node:path";

export interface ExpoConfigSummary {
  source: unknown;
  name?: unknown;
  slug?: unknown;
  scheme?: unknown;
  iosBundleIdentifier?: unknown;
  androidPackage?: unknown;
  easProjectId?: unknown;
  userInterfaceStyle?: unknown;
  dynamic?: unknown;
}

export function projectInfoAppConfigSummary(summary: ExpoConfigSummary): Record<string, unknown> {
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

export function regexConfigValue(text: string, key: string): string | null {
  return new RegExp(`\\b${key}\\s*:\\s*["'\`]([^"'\`]+)["'\`]`).exec(text)?.[1] ?? null;
}

export function regexNestedConfigValue(text: string, key: string): string | null {
  return new RegExp(`\\b${key}\\s*:\\s*["'\`]([^"'\`]+)["'\`]`).exec(text)?.[1] ?? null;
}
