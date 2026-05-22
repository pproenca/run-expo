import type {
  AppConfigSummary,
  DevToolsCapability,
  DoctorResult,
  PerformanceReport,
  ProjectInfoResult,
  UxContextResult,
} from "../contracts/results.js";
import type {
  ArtifactRef,
  Availability,
  JsonValue,
  Platform,
  SnapshotRef,
} from "../contracts/primitives.js";
import type {
  RefRecord,
  SessionRecord,
  SnapshotResult,
  TargetRecord,
} from "../contracts/records.js";
import type {
  ActionEvidence,
  CommandPlan,
  RouteRecord,
} from "../contracts/shared.js";

export interface CommandRunnerAdapter {
  plan(command: string, args: string[], options?: RunOptions): CommandPlan;
  run(plan: CommandPlan, options?: RunOptions): Promise<RunResult>;
}

export type RunOptions = {
  cwd?: string;
  timeoutMs?: number;
  rejectOnError?: boolean;
  maxOutputChars?: number;
};

export type RunResult = {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  error: string | null;
  durationMs: number;
};

export interface ProjectAdapter {
  doctor(cwd: string): Promise<DoctorResult>;
  projectInfo(cwd: string): Promise<ProjectInfoResult>;
  readAppConfig(projectRoot: string): Promise<AppConfigSummary | null>;
  routes(cwd: string, appDir?: string): Promise<RouteRecord[]>;
}

export interface DeviceAdapter {
  list(platform: Platform | "all", limit?: number): Promise<TargetRecord[]>;
  bootSimulator(device?: string): Promise<TargetRecord>;
  launchApp(target: TargetRecord, bundleId: string): Promise<Availability>;
  terminateApp(target: TargetRecord, bundleId: string): Promise<Availability>;
  reloadApp(target: TargetRecord): Promise<Availability>;
  installApp(target: TargetRecord, appPath: string): Promise<Availability>;
  uninstallApp(target: TargetRecord, bundleId: string): Promise<Availability>;
  openDevMenu(target: TargetRecord): Promise<Availability>;
  openUrl(target: TargetRecord, url: string): Promise<Availability>;
  screenshot(target: TargetRecord, outputPath?: string): Promise<ArtifactRef>;
}

export interface GestureAdapter {
  plan(action: GestureAction): CommandPlan;
  run(action: GestureAction, options: GestureRunOptions): Promise<ActionEvidence>;
}

export type GestureAction =
  | {
      kind: "tap" | "long-press";
      target: TargetRecord;
      x: number;
      y: number;
      durationMs?: number;
    }
  | {
      kind: "drag" | "swipe";
      target: TargetRecord;
      startX: number;
      startY: number;
      endX: number;
      endY: number;
      durationMs?: number;
    }
  | {
      kind: "ref-action";
      target: TargetRecord;
      ref: SnapshotRef;
      action: "tap" | "long-press" | "fill" | "focus" | "scroll";
      value?: string;
    };

export type GestureRunOptions = {
  dryRun: boolean;
  captureBeforeAfter: boolean;
  includeTrace: boolean;
};

export interface MetroAdapter {
  status(port: number): Promise<MetroStatus>;
  targets(port: number): Promise<TargetRecord[]>;
  symbolicate(port: number, stack: string): Promise<string>;
}

export type MetroStatus = {
  port: number;
  status: "available" | "unavailable";
  version: JsonValue | null;
  targets: TargetRecord[];
};

export interface HermesAdapter {
  evaluate<T extends JsonValue>(
    target: TargetRecord,
    expression: string,
    options: RuntimeEvalOptions,
  ): Promise<T>;
  inspectRuntime(target: TargetRecord): Promise<JsonValue>;
}

export type RuntimeEvalOptions = {
  timeoutMs: number;
  returnByValue: boolean;
  reason: string;
};

export interface SnapshotAdapter {
  capture(target: TargetRecord, options: SnapshotOptions): Promise<SnapshotResult>;
  refs(snapshotId: string): Promise<RefRecord[]>;
  get(ref: SnapshotRef, field: RefField): Promise<JsonValue>;
  find(locator: RefLocator): Promise<RefRecord[]>;
}

export type SnapshotOptions = {
  interactiveOnly: boolean;
  compact: boolean;
  depth: number | null;
  includeSource: boolean;
  includeBounds: boolean;
};

export type RefField = "text" | "props" | "box" | "style" | "source";

export type RefLocator =
  | { kind: "role"; value: string; name?: string; exact?: boolean }
  | { kind: "text" | "label" | "placeholder" | "testid" | "source"; value: string; exact?: boolean }
  | { kind: "first" | "last" | "nth"; value: string; index?: number };

export interface DevToolsAdapter {
  status(target: TargetRecord): Promise<DevToolsStatus>;
  capabilities(target: TargetRecord): Promise<DevToolsCapability[]>;
  startEvents(target: TargetRecord): Promise<ArtifactRef>;
  readEvents(target: TargetRecord): Promise<JsonValue>;
  stopEvents(target: TargetRecord): Promise<ArtifactRef>;
}

export type DevToolsStatus = {
  targetId: string | null;
  capabilities: DevToolsCapability[];
  attached: boolean;
  mayDisconnectReactNativeDevTools: boolean;
};

export interface RuntimeEvidenceAdapter {
  uxContext(target: TargetRecord, options: UxContextOptions): Promise<UxContextResult>;
  console(target: TargetRecord, options: LogReadOptions): Promise<JsonValue>;
  errors(target: TargetRecord, options: LogReadOptions): Promise<JsonValue>;
  logs(target: TargetRecord, options: LogReadOptions): Promise<ArtifactRef>;
}

export type UxContextOptions = {
  includeScreenshot: boolean;
  includeImageAnalysis: boolean;
  includeHierarchy: boolean;
  includeRuntime: boolean;
  includeComponents: boolean;
  includeLogs: boolean;
};

export type LogReadOptions = {
  since?: string;
  limit?: number;
  clear?: boolean;
};

export interface PerformanceAdapter {
  summary(target: TargetRecord): Promise<PerformanceReport>;
  startup(target: TargetRecord, options: StartupMeasureOptions): Promise<PerformanceReport>;
  action(target: TargetRecord, options: ActionMeasureOptions): Promise<PerformanceReport>;
  bundle(cwd: string, options: BundleMeasureOptions): Promise<PerformanceReport>;
}

export type StartupMeasureOptions = {
  route?: string;
  samples: number;
  coldStart: boolean;
};

export type ActionMeasureOptions = {
  name: string;
  steps: JsonValue[];
  capture: Array<"screenshot" | "trace" | "network" | "snapshot">;
};

export type BundleMeasureOptions = {
  build: "dev" | "preview" | "release";
  existingArtifact?: string;
  runExport: boolean;
};

export interface SessionStoreAdapter {
  list(): Promise<SessionRecord[]>;
  show(nameOrId: string): Promise<SessionRecord | null>;
  create(name?: string): Promise<SessionRecord>;
  update(record: SessionRecord): Promise<SessionRecord>;
  close(nameOrId: string): Promise<SessionRecord>;
  clean(options: { olderThanDays?: number }): Promise<SessionRecord[]>;
}
