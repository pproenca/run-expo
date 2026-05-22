import type {
  ArtifactRef,
  Availability,
  JsonValue,
  SnapshotRef,
} from "../contracts/primitives.js";
import type {
  RefRecord,
  SnapshotResult,
  TargetRecord,
} from "../contracts/records.js";

export interface NavigationAdapter {
  state(target: TargetRecord): Promise<NavigationStateResult>;
  back(target: TargetRecord): Promise<Availability>;
  popToRoot(target: TargetRecord): Promise<Availability>;
  tab(target: TargetRecord, tab: string | number): Promise<Availability>;
  deepLink(target: TargetRecord, route: string, query?: string): Promise<Availability>;
}

export type NavigationStateResult = {
  available: boolean;
  route: string | null;
  tree: JsonValue | null;
  source: "expo-router" | "react-navigation" | "deep-link" | "unknown";
  limitations: string[];
};

export interface NetworkAdapter {
  status(target: TargetRecord): Promise<Availability>;
  requests(target: TargetRecord, options: NetworkReadOptions): Promise<NetworkRequestSummary[]>;
  request(target: TargetRecord, requestId: string): Promise<NetworkRequestDetail | null>;
  clear(target: TargetRecord): Promise<Availability>;
  startHar(target: TargetRecord): Promise<ArtifactRef>;
  stopHar(target: TargetRecord): Promise<ArtifactRef>;
}

export type NetworkReadOptions = {
  since?: string;
  limit?: number;
  includeBodies?: boolean;
};

export type NetworkRequestSummary = {
  requestId: string;
  method: string;
  url: string;
  status: number | null;
  startedAt: string;
  durationMs: number | null;
  source: "fetch" | "xhr" | "native" | "unknown";
};

export type NetworkRequestDetail = NetworkRequestSummary & {
  requestHeaders: Record<string, string>;
  responseHeaders: Record<string, string>;
  requestBodyArtifact: ArtifactRef | null;
  responseBodyArtifact: ArtifactRef | null;
  redacted: boolean;
};

export interface StorageAdapter {
  list(target: TargetRecord, store: StorageKind): Promise<StorageKeySummary[]>;
  get(target: TargetRecord, store: StorageKind, key: string): Promise<JsonValue | null>;
  set(target: TargetRecord, store: StorageKind, key: string, value: JsonValue): Promise<Availability>;
  clear(target: TargetRecord, store: StorageKind, options: StorageClearOptions): Promise<Availability>;
  trace(target: TargetRecord, options: StorageTraceOptions): Promise<ArtifactRef>;
}

export interface AppStateAdapter {
  save(target: TargetRecord, name: string): Promise<StateSnapshot>;
  load(target: TargetRecord, name: string): Promise<Availability>;
  list(target: TargetRecord): Promise<StateSnapshot[]>;
  clear(target: TargetRecord, name: string): Promise<Availability>;
}

export type StateSnapshot = {
  name: string;
  createdAt: string;
  artifact: ArtifactRef;
  summary: JsonValue;
};

export type StorageKind = "async" | "mmkv" | "secure-store" | "sqlite";

export type StorageKeySummary = {
  store: StorageKind;
  key: string;
  bytes: number | null;
  redacted: boolean;
};

export type StorageClearOptions = {
  keyPrefix?: string;
  allowAll: boolean;
};

export type StorageTraceOptions = {
  since?: string;
  limit?: number;
};

export interface ControlsAdapter {
  list(target: TargetRecord): Promise<AppControl[]>;
  get(target: TargetRecord, name: string): Promise<JsonValue>;
  set(target: TargetRecord, name: string, value: JsonValue): Promise<Availability>;
  press(target: TargetRecord, name: string): Promise<Availability>;
}

export type AppControl = {
  name: string;
  description: string;
  value: JsonValue;
  writable: boolean;
  sideEffects: string[];
};

export interface AccessibilityAdapter {
  tree(target: TargetRecord): Promise<AccessibilityTreeResult>;
  inspect(target: TargetRecord, ref: SnapshotRef): Promise<JsonValue>;
  audit(target: TargetRecord, snapshot?: SnapshotResult): Promise<AccessibilityFinding[]>;
  focus(target: TargetRecord, ref: SnapshotRef): Promise<Availability>;
}

export type AccessibilityTreeResult = {
  available: boolean;
  source: "native" | "snapshot" | "unavailable";
  nodes: JsonValue[];
  artifacts: ArtifactRef[];
  limitations: string[];
};

export type AccessibilityFinding = {
  rule: string;
  severity: "error" | "warning" | "advisory";
  ref: SnapshotRef | null;
  message: string;
  fix?: string;
};

export interface DialogAdapter {
  status(target: TargetRecord): Promise<DialogState>;
  accept(target: TargetRecord, text?: string): Promise<Availability>;
  dismiss(target: TargetRecord): Promise<Availability>;
}

export type DialogState = {
  visible: boolean;
  kind: "alert" | "action-sheet" | "modal" | "sheet" | "unknown";
  title: string | null;
  message: string | null;
  actions: string[];
};

export interface RecordingAdapter {
  start(target: TargetRecord, options: RecordingOptions): Promise<ArtifactRef>;
  stop(target: TargetRecord, outputPath?: string): Promise<ArtifactRef>;
  status(target: TargetRecord): Promise<Availability>;
}

export type RecordingOptions = {
  kind: "video" | "trace";
  outputPath?: string;
};

export interface DiffAdapter {
  snapshot(before: SnapshotResult, after: SnapshotResult): Promise<DiffResult>;
  screenshot(beforePath: string, afterPath: string): Promise<DiffResult>;
  route(beforeRoute: string, afterRoute: string): Promise<DiffResult>;
}

export type DiffResult = {
  changed: boolean;
  summary: string;
  artifacts: ArtifactRef[];
  details: JsonValue;
};

export interface DashboardAdapter {
  start(options: DashboardOptions): Promise<DashboardStatus>;
  stop(): Promise<DashboardStatus>;
  status(): Promise<DashboardStatus>;
}

export type DashboardOptions = {
  port?: number;
  sessionId?: string;
};

export type DashboardStatus = {
  running: boolean;
  url: string | null;
  port: number | null;
  sessionId: string | null;
};

export interface SkillsAdapter {
  list(): Promise<SkillSummary[]>;
  get(name: string): Promise<SkillDocument | null>;
}

export type SkillSummary = {
  name: string;
  path: string;
  description: string;
};

export type SkillDocument = SkillSummary & {
  markdown: string;
};

export interface SetupAdapter {
  install(options: SetupInstallOptions): Promise<SetupResult>;
  upgrade(options: SetupUpgradeOptions): Promise<SetupResult>;
}

export type SetupInstallOptions = {
  checkOnly: boolean;
  fix: boolean;
};

export type SetupUpgradeOptions = {
  version?: string;
  dryRun: boolean;
};

export type SetupResult = {
  ok: boolean;
  changed: boolean;
  checked: string[];
  actions: string[];
  limitations: string[];
};

export interface ClipboardAdapter {
  read(target: TargetRecord): Promise<string>;
  write(target: TargetRecord, text: string): Promise<Availability>;
  paste(target: TargetRecord): Promise<Availability>;
}

export interface EnvironmentAdapter {
  set(target: TargetRecord, setting: EnvironmentSetting): Promise<Availability>;
}

export type EnvironmentSetting =
  | { category: "appearance"; value: "dark" | "light" }
  | { category: "content-size"; value: string }
  | { category: "locale"; value: string }
  | { category: "timezone"; value: string }
  | { category: "location"; latitude: number; longitude: number }
  | { category: "network"; value: "online" | "offline" }
  | { category: "permissions"; permission: string; value: "granted" | "denied" | "unset" }
  | { category: "orientation"; value: "portrait" | "landscape-left" | "landscape-right" }
  | { category: "keyboard"; value: "software" | "hardware" };

export interface ExpoIntrospectionAdapter {
  modules(cwd: string): Promise<JsonValue>;
  config(cwd: string): Promise<JsonValue>;
  doctor(cwd: string): Promise<JsonValue>;
  prebuildPlan(cwd: string): Promise<JsonValue>;
}

export interface InstrumentationAdapter {
  status(target: TargetRecord): Promise<Availability>;
  manifest(target: TargetRecord): Promise<JsonValue>;
  install(cwd: string, options: { force: boolean }): Promise<Availability>;
  remove(cwd: string): Promise<Availability>;
  call(target: TargetRecord, domain: string, tool: string, args: JsonValue): Promise<JsonValue>;
}
