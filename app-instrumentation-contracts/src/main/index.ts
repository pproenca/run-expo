export const APP_INSTRUMENTATION_SCHEMA_VERSION = 1 as const;

export const APP_INSTRUMENTATION_DOMAIN_NAMES = [
  "snapshot",
  "navigation",
  "performance",
  "console",
  "errors",
  "network",
  "storage",
  "controls",
  "app",
] as const;

export const APP_INSTRUMENTATION_SIDE_EFFECTS = [
  "none",
  "read",
  "write",
  "device",
  "network",
] as const;

export const APP_INSTRUMENTATION_INTERFACE_NAMES = [
  "AppInstrumentationBridge",
  "SnapshotInstrumentation",
  "NavigationInstrumentation",
  "PerformanceInstrumentation",
  "AppReadinessInstrumentation",
  "ConsoleInstrumentation",
  "ErrorInstrumentation",
  "NetworkInstrumentation",
  "StorageInstrumentation",
  "ControlsInstrumentation",
] as const;

export const CONSOLE_LEVELS = ["log", "info", "warn", "error", "debug"] as const;

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export type SchemaLike = JsonValue;
export type AppInstrumentationDomainName = (typeof APP_INSTRUMENTATION_DOMAIN_NAMES)[number];
export type AppInstrumentationSideEffect = (typeof APP_INSTRUMENTATION_SIDE_EFFECTS)[number];
export type ConsoleLevel = (typeof CONSOLE_LEVELS)[number];

export type DevToolsCapability = {
  name: string;
  source: string;
  available: boolean;
  readCommands: string[];
  writeCommands: string[];
  artifactTypes: string[];
  limitations: string[];
};

export type PerformanceResult = {
  metric: string;
  value: number;
  unit: string;
  source: string;
  confidence?: string;
  context?: JsonValue;
  artifacts?: string[];
  limitations?: string[];
};

export type TargetRecord = {
  id: string;
  platform?: string;
  [key: string]: unknown;
};

export type RefRecord = {
  ref: string;
  [key: string]: unknown;
};

export type SnapshotResult = {
  snapshotId: string;
  refs?: RefRecord[];
  [key: string]: unknown;
};

export type AppInstrumentationManifest = {
  schemaVersion: typeof APP_INSTRUMENTATION_SCHEMA_VERSION;
  enabled: boolean;
  developmentOnly: true;
  domains: AppInstrumentationDomain[];
};

export type AppInstrumentationDomain = {
  name: AppInstrumentationDomainName;
  capabilities: DevToolsCapability[];
  tools: AppInstrumentationTool[];
};

export type AppInstrumentationTool = {
  name: string;
  description: string;
  inputSchema: SchemaLike;
  sideEffects: AppInstrumentationSideEffect;
};

export interface AppInstrumentationBridge {
  manifest(target: TargetRecord): Promise<AppInstrumentationManifest>;
  callTool<TArgs extends JsonValue, TResult extends JsonValue>(
    target: TargetRecord,
    domain: string,
    tool: string,
    args: TArgs,
  ): Promise<TResult>;
}

export interface SnapshotInstrumentation {
  capture(target: TargetRecord): Promise<SnapshotResult>;
  resolve(ref: RefRecord["ref"]): Promise<RefRecord | null>;
}

export interface NavigationInstrumentation {
  state(target: TargetRecord): Promise<JsonValue>;
  back(target: TargetRecord): Promise<JsonValue>;
  popToRoot(target: TargetRecord): Promise<JsonValue>;
  tab(target: TargetRecord, tab: string | number): Promise<JsonValue>;
}

export interface PerformanceInstrumentation {
  marks(target: TargetRecord): Promise<PerformanceResult[]>;
  clearMarks(target: TargetRecord): Promise<JsonValue>;
}

export interface AppReadinessInstrumentation {
  ready(target: TargetRecord): Promise<AppReadyState>;
  waitUntilReady(target: TargetRecord, timeoutMs: number): Promise<AppReadyState>;
}

export type AppReadyState = {
  ready: boolean;
  route: string | null;
  reason?: string;
  marks: PerformanceResult[];
};

export interface ConsoleInstrumentation {
  messages(target: TargetRecord, options: InstrumentationReadOptions): Promise<ConsoleMessage[]>;
  clear(target: TargetRecord): Promise<JsonValue>;
}

export type ConsoleMessage = {
  messageId: string;
  level: ConsoleLevel;
  text: string;
  timestamp: string;
  stack?: string;
};

export interface ErrorInstrumentation {
  errors(target: TargetRecord, options: InstrumentationReadOptions): Promise<RuntimeError[]>;
  clear(target: TargetRecord): Promise<JsonValue>;
}

export type RuntimeError = {
  errorId: string;
  message: string;
  name: string | null;
  stack: string | null;
  timestamp: string;
  handled: boolean | null;
};

export interface NetworkInstrumentation {
  requests(target: TargetRecord, options: InstrumentationReadOptions): Promise<JsonValue[]>;
  clear(target: TargetRecord): Promise<JsonValue>;
}

export interface StorageInstrumentation {
  list(target: TargetRecord, store: string): Promise<JsonValue[]>;
  get(target: TargetRecord, store: string, key: string): Promise<JsonValue | null>;
  set(target: TargetRecord, store: string, key: string, value: JsonValue): Promise<JsonValue>;
  clear(target: TargetRecord, store: string, keyPrefix?: string): Promise<JsonValue>;
}

export interface ControlsInstrumentation {
  list(target: TargetRecord): Promise<JsonValue[]>;
  get(target: TargetRecord, name: string): Promise<JsonValue>;
  set(target: TargetRecord, name: string, value: JsonValue): Promise<JsonValue>;
  press(target: TargetRecord, name: string): Promise<JsonValue>;
}

export type InstrumentationReadOptions = {
  since?: string;
  limit?: number;
};

export function isAppInstrumentationDomainName(
  value: string,
): value is AppInstrumentationDomainName {
  return (APP_INSTRUMENTATION_DOMAIN_NAMES as readonly string[]).includes(value);
}

export function createAppInstrumentationManifest(
  enabled: boolean,
  domains: AppInstrumentationDomain[],
): AppInstrumentationManifest {
  return {
    schemaVersion: APP_INSTRUMENTATION_SCHEMA_VERSION,
    enabled,
    developmentOnly: true,
    domains: domains.map((domain) => ({
      name: domain.name,
      capabilities: domain.capabilities.map((capability) => ({ ...capability })),
      tools: domain.tools.map((tool) => ({ ...tool })),
    })),
  };
}

export function getInstrumentationDomain(
  manifest: AppInstrumentationManifest,
  name: AppInstrumentationDomainName,
): AppInstrumentationDomain | null {
  const domain = manifest.domains.find((candidate) => candidate.name === name);
  if (domain === undefined) {
    return null;
  }
  return {
    name: domain.name,
    capabilities: domain.capabilities.map((capability) => ({ ...capability })),
    tools: domain.tools.map((tool) => ({ ...tool })),
  };
}
