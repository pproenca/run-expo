import type { ActionCategory } from "./policy.js";
import type { RedactionRule } from "./primitives.js";

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

export type ExpoIosEnvironment = {
  EXPO_IOS_ROOT?: string;
  EXPO_IOS_STATE_DIR?: string;
  EXPO_IOS_METRO_PORT?: string;
  NO_COLOR?: string;
};

export interface ConfigResolver {
  resolve(options: ConfigResolveOptions): Promise<ResolvedConfig>;
}

export type ConfigResolveOptions = {
  cwd: string;
  configPath?: string;
  env: ExpoIosEnvironment;
};
