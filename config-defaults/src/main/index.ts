import { basename, join, resolve } from "node:path";

export const CLI_NAME = "expo-ios";
export const CLI_VERSION = "0.1.0";
export const MAX_OUTPUT = 40_000;
export const EXEC_FILE_TIMEOUT_MS = 60_000;
export const DEFAULT_METRO_PORT = 8081;
export const DEFAULT_STATE_DIR_NAME = ".scratch/expo-ios";
export const DEFAULT_ARTIFACT_DIR_NAME = ".scratch/expo-ios/artifacts";

export const EXPO_IOS_ENV_KEYS = [
  "EXPO_IOS_ROOT",
  "EXPO_IOS_STATE_DIR",
  "EXPO_IOS_METRO_PORT",
  "NO_COLOR",
] as const;

export type ActionCategory = string;
export type RedactionRule = Record<string, unknown>;

export type ExpoIosConfig = {
  schemaVersion: 1;
  defaultPlatform: "ios" | "android";
  metroPort: number;
  artifactDir: string;
  redaction: {
    queryKeys: string[];
    headerKeys: string[];
    bodyKeys?: string[];
    extraRules?: RedactionRule[];
  };
  commands: {
    verifyNativeExperience: string | null;
    typecheck: string | null;
    lint: string | null;
    test: string | null;
  };
  policy?: {
    maxOutputChars?: number;
    contentBoundaries?: boolean;
    allowRuntimeEval?: boolean;
    confirmActions?: ActionCategory[];
    deniedActions?: ActionCategory[];
  };
};

export type ConfigSource =
  | { kind: "flag"; path: string }
  | { kind: "project"; path: string }
  | { kind: "scratch"; path: string }
  | { kind: "defaults" };

export type ResolvedConfig = {
  config: ExpoIosConfig;
  source: ConfigSource;
  projectRoot: string | null;
};

export type ExpoIosEnvironment = Partial<Record<(typeof EXPO_IOS_ENV_KEYS)[number], string>>;

export type ConfigResolveOptions = {
  cwd: string;
  configPath?: string;
  env: ExpoIosEnvironment;
};

export type StateRootArgs = {
  stateDir?: string | null;
  root?: string | null;
  cwd?: string | null;
};

export type CliGlobals = {
  json: boolean;
  plain: boolean;
  quiet: boolean;
  verbose: boolean;
  debug: boolean;
  noColor: boolean;
  noInput: boolean;
  record: boolean;
  version: boolean;
  help: boolean;
  root: string | null;
  stateDir: string | null;
  actionPolicy: string | null;
  maxOutput: string | number | null;
  contentBoundaries: boolean;
  allowRuntimeEval: string | boolean | null;
  confirmActions: string | null;
};

export const DEFAULT_GLOBALS: CliGlobals = {
  json: false,
  plain: false,
  quiet: false,
  verbose: false,
  debug: false,
  noColor: false,
  noInput: false,
  record: false,
  version: false,
  help: false,
  root: null,
  stateDir: null,
  actionPolicy: null,
  maxOutput: null,
  contentBoundaries: false,
  allowRuntimeEval: null,
  confirmActions: null,
};

export const DEFAULT_CONFIG: ExpoIosConfig = {
  schemaVersion: 1,
  defaultPlatform: "ios",
  metroPort: DEFAULT_METRO_PORT,
  artifactDir: DEFAULT_ARTIFACT_DIR_NAME,
  redaction: {
    queryKeys: ["cookie", "token", "authorization", "password", "secret"],
    headerKeys: ["authorization", "cookie", "token", "secret", "api-key", "api_key", "password", "set-cookie"],
    bodyKeys: ["token", "authorization", "cookie", "password", "secret", "apikey", "apiKey"],
  },
  commands: {
    verifyNativeExperience: null,
    typecheck: null,
    lint: null,
    test: null,
  },
  policy: {
    maxOutputChars: MAX_OUTPUT,
    contentBoundaries: false,
    allowRuntimeEval: false,
    confirmActions: [],
    deniedActions: [],
  },
};

export function defaultGlobals(): CliGlobals {
  return { ...DEFAULT_GLOBALS };
}

export function defaultConfig(options: { cwd: string }): ResolvedConfig {
  const projectRoot = resolve(options.cwd);
  return {
    source: { kind: "defaults" },
    projectRoot,
    config: {
      ...cloneConfig(DEFAULT_CONFIG),
      artifactDir: resolveArtifactDir({ cwd: projectRoot }),
    },
  };
}

export function resolveExpoStateRoot(args: StateRootArgs = {}): string {
  if (args.stateDir) {
    const resolved = resolve(args.stateDir);
    return basename(resolved) === "runs" ? resolve(join(resolved, "..")) : resolved;
  }
  const root = resolve(args.root ?? args.cwd ?? ".");
  return join(root, DEFAULT_STATE_DIR_NAME);
}

export function resolveRunRecordDir(args: StateRootArgs = {}): string {
  if (args.stateDir) return resolve(args.stateDir);
  return join(resolveExpoStateRoot(args), "runs");
}

export function resolveArtifactDir(args: StateRootArgs = {}): string {
  return join(resolveExpoStateRoot(args), "artifacts");
}

function cloneConfig(config: ExpoIosConfig): ExpoIosConfig {
  return {
    ...config,
    redaction: {
      ...config.redaction,
      queryKeys: [...config.redaction.queryKeys],
      headerKeys: [...config.redaction.headerKeys],
      bodyKeys: config.redaction.bodyKeys ? [...config.redaction.bodyKeys] : undefined,
      extraRules: config.redaction.extraRules ? config.redaction.extraRules.map((rule) => ({ ...rule })) : undefined,
    },
    commands: { ...config.commands },
    policy: config.policy
      ? {
          ...config.policy,
          confirmActions: config.policy.confirmActions ? [...config.policy.confirmActions] : undefined,
          deniedActions: config.policy.deniedActions ? [...config.policy.deniedActions] : undefined,
        }
      : undefined,
  };
}
