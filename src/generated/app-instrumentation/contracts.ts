import type {
  DevToolsCapability,
  PerformanceResult,
} from "../../contracts/results.js";
import type {
  RefRecord,
  SnapshotResult,
  TargetRecord,
} from "../../contracts/records.js";
import type { JsonValue, SchemaLike } from "../../contracts/primitives.js";

export type AppInstrumentationManifest = {
  schemaVersion: 1;
  enabled: boolean;
  developmentOnly: true;
  domains: AppInstrumentationDomain[];
};

export type AppInstrumentationDomain = {
  name:
    | "snapshot"
    | "navigation"
    | "performance"
    | "console"
    | "errors"
    | "network"
    | "storage"
    | "controls"
    | "app";
  capabilities: DevToolsCapability[];
  tools: AppInstrumentationTool[];
};

export type AppInstrumentationTool = {
  name: string;
  description: string;
  inputSchema: SchemaLike;
  sideEffects: "none" | "read" | "write" | "device" | "network";
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
  level: "log" | "info" | "warn" | "error" | "debug";
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
