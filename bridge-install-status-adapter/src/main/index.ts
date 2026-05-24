import { promises as fs } from "node:fs";
import path from "node:path";

export const EXPO_IOS_BRIDGE_VERSION = "1.0.0";
export const BRIDGE_SCHEMA_VERSION = 1;

export type JsonRecord = Record<string, unknown>;

export type BridgeIssue = {
  code: string;
  message: string;
};

export type BridgeInstallStatusState = "absent" | "present" | "stale" | "incompatible";

export type BridgeInstallStatus = {
  projectRoot: string;
  state: BridgeInstallStatusState;
  bridgeVersion: unknown;
  expectedBridgeVersion: string;
  developmentOnly: boolean;
  metadataPath: string;
  sourcePath: string;
  files: { metadata: boolean; source: boolean };
  dependencies: {
    expo: unknown;
    rozenite: Array<{ name: string; version: unknown }>;
  };
  issues: BridgeIssue[];
};

export type BridgeInstallStatusDependencies = {
  readJsonFile?: (file: string) => Promise<unknown> | unknown;
  pathExists?: (file: string) => Promise<boolean> | boolean;
  joinPath?: (...parts: string[]) => string;
};

export function bridgeMetadata() {
  return {
    schemaVersion: BRIDGE_SCHEMA_VERSION,
    bridgeVersion: EXPO_IOS_BRIDGE_VERSION,
    developmentOnly: true,
    generatedBy: "expo-ios",
    domains: ["navigation", "network", "storage", "controls", "performance", "snapshot"]
  };
}

export async function bridgeInstallStatus(
  projectRoot: string,
  dependencies: BridgeInstallStatusDependencies = {}
): Promise<BridgeInstallStatus> {
  const io = bridgeInstallStatusIo(dependencies);
  const packageJsonPath = io.joinPath(projectRoot, "package.json");
  const packageJson = await readJsonOrNull(io.readJsonFile, packageJsonPath);
  const deps = packageJson ? dependencyMap(packageJson) : {};
  const metadataPath = io.joinPath(projectRoot, ".expo-ios", "bridge.json");
  const sourcePath = io.joinPath(projectRoot, "src", "expo-ios-devtools-bridge.ts");
  const metadata = await readJsonOrNull(io.readJsonFile, metadataPath);
  const sourceExists = await Promise.resolve(io.pathExists(sourcePath));
  const hasExpo = typeof deps.expo === "string";
  const rozenitePackages = Object.keys(deps)
    .filter((name) => name === "rozenite" || name.startsWith("@rozenite/"))
    .sort();
  let state: BridgeInstallStatusState = "absent";
  const issues: BridgeIssue[] = [];

  if (!hasExpo) {
    state = "incompatible";
    issues.push({
      code: "missing-expo",
      message: "The project does not declare expo, so an Expo DevTools bridge cannot be installed safely."
    });
  } else if (metadata || sourceExists) {
    if (!metadata || !sourceExists) {
      state = "stale";
      issues.push({
        code: "partial-install",
        message: "Bridge metadata and source file are not both present."
      });
    } else if (metadataProperty(metadata, "bridgeVersion") !== EXPO_IOS_BRIDGE_VERSION || metadataProperty(metadata, "schemaVersion") !== BRIDGE_SCHEMA_VERSION) {
      state = "stale";
      issues.push({
        code: "version-mismatch",
        message: `Bridge version ${String(metadataProperty(metadata, "bridgeVersion") ?? "unknown")} does not match ${EXPO_IOS_BRIDGE_VERSION}.`
      });
    } else if (metadataProperty(metadata, "developmentOnly") !== true) {
      state = "incompatible";
      issues.push({
        code: "not-development-only",
        message: "Bridge metadata must declare developmentOnly: true."
      });
    } else {
      state = "present";
    }
  }

  return {
    projectRoot,
    state,
    bridgeVersion: metadataProperty(metadata, "bridgeVersion") ?? null,
    expectedBridgeVersion: EXPO_IOS_BRIDGE_VERSION,
    developmentOnly: metadataProperty(metadata, "developmentOnly") === true,
    metadataPath,
    sourcePath,
    files: { metadata: Boolean(metadata), source: sourceExists },
    dependencies: {
      expo: deps.expo ?? null,
      rozenite: rozenitePackages.map((name) => ({ name, version: deps[name] }))
    },
    issues
  };
}

export async function readJsonFile(file: string): Promise<unknown> {
  return JSON.parse(await fs.readFile(file, "utf8"));
}

export async function pathExists(file: string): Promise<boolean> {
  return fs.access(file).then(() => true, () => false);
}

function bridgeInstallStatusIo(dependencies: BridgeInstallStatusDependencies): Required<BridgeInstallStatusDependencies> {
  return {
    readJsonFile: dependencies.readJsonFile ?? readJsonFile,
    pathExists: dependencies.pathExists ?? pathExists,
    joinPath: dependencies.joinPath ?? path.join
  };
}

async function readJsonOrNull(read: (file: string) => Promise<unknown> | unknown, file: string): Promise<unknown | null> {
  try {
    return await read(file);
  } catch {
    return null;
  }
}

function dependencyMap(packageJson: unknown): Record<string, unknown> {
  const record = asRecord(packageJson);
  return {
    ...asRecord(record?.dependencies),
    ...asRecord(record?.devDependencies)
  };
}

function asRecord(value: unknown): JsonRecord | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : undefined;
}

function metadataProperty(metadata: unknown, key: string): unknown {
  return asRecord(metadata)?.[key];
}
