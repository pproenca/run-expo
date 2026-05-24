import { promises as fs } from "node:fs";
import path from "node:path";

declare const process: { cwd(): string };

export const EXPO_IOS_BRIDGE_VERSION = "1.0.0";
export const BRIDGE_SCHEMA_VERSION = 1;

export type JsonRecord = Record<string, unknown>;
export type BridgeAction = "status" | "plan" | "health" | "domains" | "install" | "remove";
export type BridgeState = "absent" | "present" | "stale" | "incompatible";

export type BridgeIssue = {
  code: string;
  message: string;
};

export type BridgeInstallStatus = {
  projectRoot: string;
  state: BridgeState;
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

export type BridgeCommandArgs = {
  action?: unknown;
  cwd?: string;
  confirmActions?: string | null;
  [key: string]: unknown;
};

export type BridgeCommandDependencies = {
  normalizeProjectCwd?: (cwd: string | undefined, options: { allowMissingPackageJson: true }) => Promise<string> | string;
  bridgeHealthPayload?: (args: BridgeCommandArgs, context: { action: "health" | "domains"; status: BridgeInstallStatus; plan: BridgeInstallPlan }) => Promise<unknown> | unknown;
  readJsonFile?: (file: string) => Promise<unknown> | unknown;
  pathExists?: (file: string) => Promise<boolean> | boolean;
  mkdir?: (file: string, options: { recursive: true }) => Promise<unknown> | unknown;
  writeJsonFile?: (file: string, value: unknown) => Promise<unknown> | unknown;
  writeFile?: (file: string, text: string, encoding: "utf8") => Promise<unknown> | unknown;
  rm?: (file: string, options: { force: true }) => Promise<unknown> | unknown;
  joinPath?: (...parts: string[]) => string;
  resolvePath?: (...parts: string[]) => string;
  currentCwd?: () => string;
};

export type BridgeInstallPlan = ReturnType<typeof bridgeInstallPlan>;

export async function bridgeCommand(
  args: BridgeCommandArgs = {},
  dependencies: BridgeCommandDependencies = {}
) {
  const action = requireBridgeAction(args.action ?? "status");
  const io = bridgeCommandIo(dependencies);
  const cwd = await resolveProjectCwd(args.cwd, io);
  const status = await bridgeInstallStatus(cwd, io);
  const plan = bridgeInstallPlan(cwd, status);

  if (action === "status") return toolJson({ available: true, action, ...status });
  if (action === "plan") return toolJson({ available: true, action, status: status.state, projectRoot: status.projectRoot, plan });
  if (action === "health" || action === "domains") {
    return toolJson(await io.bridgeHealthPayload(args, { action, status, plan }));
  }

  const permission = action === "install" ? "bridge-install" : "bridge-remove";
  if (!hasExplicitConfirmation(args.confirmActions, permission)) {
    return toolJson({
      available: false,
      action,
      status: status.state,
      projectRoot: status.projectRoot,
      reason: `Refusing to mutate app files without explicit --confirm-actions ${permission}.`,
      requiredConfirmation: permission,
      plan
    });
  }

  if (action === "install") {
    await io.mkdir(io.joinPath(cwd, ".expo-ios"), { recursive: true });
    await io.mkdir(io.joinPath(cwd, "src"), { recursive: true });
    await io.writeJsonFile(io.joinPath(cwd, ".expo-ios", "bridge.json"), bridgeMetadata());
    await io.writeFile(io.joinPath(cwd, "src", "expo-ios-devtools-bridge.ts"), bridgeSource(), "utf8");
    return toolJson({ available: true, action, projectRoot: cwd, installed: true, status: (await bridgeInstallStatus(cwd, io)).state, plan });
  }

  await removeIgnoringErrors(io, io.joinPath(cwd, ".expo-ios", "bridge.json"));
  await removeIgnoringErrors(io, io.joinPath(cwd, "src", "expo-ios-devtools-bridge.ts"));
  return toolJson({ available: true, action, projectRoot: cwd, removed: true, status: (await bridgeInstallStatus(cwd, io)).state, plan });
}

export async function bridgeInstallStatus(
  projectRoot: string,
  dependencies: Pick<Required<BridgeCommandDependencies>, "readJsonFile" | "pathExists" | "joinPath"> | BridgeCommandDependencies = {}
): Promise<BridgeInstallStatus> {
  const io = bridgeCommandIo(dependencies);
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
  let state: BridgeState = "absent";
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

export function bridgeInstallPlan(projectRoot: string, status: BridgeInstallStatus) {
  return {
    permissionRequired: true,
    requiredConfirmations: ["bridge-install", "bridge-remove"],
    developmentOnly: true,
    productionExclusion: [
      "Bridge code must be imported only from development-only app entrypoints or guarded by __DEV__.",
      "Production/release builds must not import src/expo-ios-devtools-bridge.ts."
    ],
    filesToAddOrChange: [
      {
        path: status.metadataPath,
        action: status.files.metadata ? "update" : "add",
        purpose: "Versioned bridge metadata for stale/incompatible detection and removal."
      },
      {
        path: status.sourcePath,
        action: status.files.source ? "update" : "add",
        purpose: "Development-only Expo/Rozenite bridge registration shim."
      }
    ],
    removalPlan: [
      { path: status.metadataPath, action: "delete" },
      { path: status.sourcePath, action: "delete" }
    ],
    runtimeHealthCheckExpectations: [
      "Metro target is available.",
      "Hermes inspector is available.",
      "Bridge metadata version matches CLI expected version.",
      "App registers readable and writable domains separately.",
      "Mutation domains remain action-policy gated."
    ],
    status: status.state,
    issues: status.issues
  };
}

export function bridgeMetadata() {
  return {
    schemaVersion: BRIDGE_SCHEMA_VERSION,
    bridgeVersion: EXPO_IOS_BRIDGE_VERSION,
    developmentOnly: true,
    generatedBy: "expo-ios",
    domains: ["navigation", "network", "storage", "controls", "performance", "snapshot"]
  };
}

export function bridgeSource() {
  return `// Generated by expo-ios. Import this file only from development-only app code guarded by __DEV__.
export const expoIosDevtoolsBridgeMetadata = ${JSON.stringify(bridgeMetadata(), null, 2)} as const;

export function registerExpoIosDevtoolsBridge() {
  if (typeof __DEV__ === "undefined") return { registered: false, reason: "development-mode-required" };
  if (!__DEV__) return { registered: false, reason: "production-build" };
  const bridge = {
    registered: true,
    metadata: expoIosDevtoolsBridgeMetadata,
    bridgeVersion: expoIosDevtoolsBridgeMetadata.bridgeVersion,
    domains: expoIosDevtoolsBridgeMetadata.domains.map((name) => ({ name })),
  };
  globalThis.__EXPO_IOS_DEVTOOLS_BRIDGE__ = bridge;
  return { registered: true, metadata: expoIosDevtoolsBridgeMetadata };
}
`;
}

export function toolJson(value: unknown) {
  return { content: [{ type: "text", text: `${JSON.stringify(value, null, 2)}\n` }], isError: false };
}

export function unwrapToolJson(result: unknown): unknown {
  const content = asRecord(result)?.content;
  const first = Array.isArray(content) ? content[0] : null;
  if (!asRecord(first) || typeof first.text !== "string") return result;
  return JSON.parse(first.text);
}

export function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${field} must be a non-empty string.`);
  }
  return value.trim();
}

export function hasExplicitConfirmation(value: string | null | undefined, required: string): boolean {
  return String(value ?? "")
    .split(",")
    .map((item) => item.trim())
    .includes(required);
}

export async function normalizeProjectCwd(cwd?: string, options: { allowMissingPackageJson?: boolean } = {}): Promise<string> {
  const resolved = path.resolve(cwd ?? process.cwd());
  const stat = await fs.stat(resolved).catch(() => null);
  if (!stat?.isDirectory()) {
    throw new Error(`Directory does not exist: ${resolved}`);
  }
  if (options.allowMissingPackageJson) return resolved;
  return resolved;
}

export async function readJsonFile(file: string): Promise<unknown> {
  return JSON.parse(await fs.readFile(file, "utf8"));
}

export async function pathExists(file: string): Promise<boolean> {
  return fs.access(file).then(() => true, () => false);
}

export async function writeJsonFile(file: string, value: unknown): Promise<void> {
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function bridgeCommandIo(dependencies: BridgeCommandDependencies): Required<BridgeCommandDependencies> {
  return {
    normalizeProjectCwd: dependencies.normalizeProjectCwd ?? normalizeProjectCwd,
    bridgeHealthPayload: dependencies.bridgeHealthPayload ?? defaultBridgeHealthPayload,
    readJsonFile: dependencies.readJsonFile ?? readJsonFile,
    pathExists: dependencies.pathExists ?? pathExists,
    mkdir: dependencies.mkdir ?? fs.mkdir,
    writeJsonFile: dependencies.writeJsonFile ?? writeJsonFile,
    writeFile: dependencies.writeFile ?? fs.writeFile,
    rm: dependencies.rm ?? fs.rm,
    joinPath: dependencies.joinPath ?? path.join,
    resolvePath: dependencies.resolvePath ?? path.resolve,
    currentCwd: dependencies.currentCwd ?? process.cwd
  };
}

async function resolveProjectCwd(cwd: string | undefined, io: Required<BridgeCommandDependencies>): Promise<string> {
  try {
    return await io.normalizeProjectCwd(cwd, { allowMissingPackageJson: true });
  } catch {
    return io.resolvePath(cwd ?? io.currentCwd());
  }
}

async function defaultBridgeHealthPayload() {
  return {
    available: false,
    health: "unavailable",
    reason: "Bridge health payload dependency was not provided."
  };
}

async function removeIgnoringErrors(io: Required<BridgeCommandDependencies>, file: string): Promise<void> {
  try {
    await io.rm(file, { force: true });
  } catch {
    // Legacy ignores remove failures for bridge cleanup.
  }
}

function requireBridgeAction(value: unknown): BridgeAction {
  const action = requireString(value, "action");
  if (isBridgeAction(action)) return action;
  throw new Error(`Unknown bridge action: ${action}`);
}

function isBridgeAction(action: string): action is BridgeAction {
  return ["status", "plan", "health", "domains", "install", "remove"].includes(action);
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

function metadataProperty(metadata: unknown, key: string): unknown {
  return asRecord(metadata)?.[key];
}

function asRecord(value: unknown): JsonRecord | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : undefined;
}
