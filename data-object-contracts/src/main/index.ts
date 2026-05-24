export const COMMAND_EXIT_CODES = [0, 1, 2] as const;
export const COMMAND_FAILURE_TYPES = [
  "usage",
  "runtime",
  "tool-missing",
  "unavailable",
  "policy-denied",
  "unexpected",
] as const;
export const ARTIFACT_KINDS = ["json", "png", "jpeg", "text", "har", "trace", "video", "memgraph", "directory"] as const;
export const SOURCE_CONFIDENCE_VALUES = ["high", "medium", "low"] as const;
export const BUILD_CONTEXTS = ["expo-go", "dev-build", "preview", "release-export", "unknown"] as const;

export const SIDECAR_STATUSES = ["running", "stale", "stopped", "unknown"] as const;
export const DEVICE_STATES = ["booted", "shutdown", "connected", "unknown"] as const;
export const METRO_TARGET_STATUSES = ["available", "unavailable", "unknown"] as const;
export const SNAPSHOT_SOURCES = [
  "native-accessibility",
  "react-devtools-hook",
  "hermes-fiber",
  "app-instrumentation",
] as const;
export const REF_ACTIONS = ["tap", "long-press", "fill", "focus", "press", "scroll", "inspect"] as const;

export const PACKAGE_MANAGERS = ["npm", "yarn", "pnpm", "bun", "unknown"] as const;
export const DEVTOOLS_CAPABILITY_SOURCES = [
  "metro",
  "hermes",
  "react-devtools-hook",
  "react-native-devtools",
  "app-instrumentation",
  "simulator",
  "native-profiler",
] as const;
export const PERFORMANCE_UNITS = ["ms", "bytes", "count", "fps", "percent"] as const;
export const PERFORMANCE_SOURCES = [
  "expo-atlas",
  "metro",
  "hermes",
  "react-devtools-hook",
  "app-performance-mark",
  "simulator",
  "xctrace",
  "memgraph",
] as const;

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };
export type Platform = "ios" | "android";
export type CommandExitCode = (typeof COMMAND_EXIT_CODES)[number];
export type CommandFailureType = (typeof COMMAND_FAILURE_TYPES)[number];
export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];
export type SourceConfidence = (typeof SOURCE_CONFIDENCE_VALUES)[number];
export type BuildContext = (typeof BUILD_CONTEXTS)[number];
export type SnapshotRef = `@e${number}`;

export type Availability =
  | { available: true }
  | {
      available: false;
      reason: string;
      hint?: string;
    };

export type CommandFailure = {
  type: CommandFailureType;
  message: string;
  command?: string;
  hint?: string;
  debug?: JsonValue;
};

export type CommandWarning = {
  code: string;
  message: string;
  source?: string;
};

export type CommandOutcome<T> =
  | { ok: true; data: T; warnings?: CommandWarning[] }
  | { ok: false; error: CommandFailure; warnings?: CommandWarning[] };

export type ArtifactRef = {
  kind: ArtifactKind;
  path: string;
  description?: string;
  bytes?: number;
};

export type TimeRange = {
  startedAt: string;
  finishedAt: string | null;
  durationMs?: number;
};

export type SchemaLike = {
  type: string;
  properties?: Record<string, SchemaLike>;
  items?: SchemaLike;
  required?: string[];
  enum?: string[];
  description?: string;
  additionalProperties?: boolean;
};

export type RedactionRule = {
  kind: "query-key" | "header-key" | "body-key" | "regex";
  pattern: string;
  replacement?: string;
};

export type RunRecord = {
  schemaVersion: 1;
  runId: string;
  command: string;
  args: Record<string, JsonValue>;
  globals: {
    json: boolean;
    plain: boolean;
    quiet: boolean;
    debug: boolean;
    root: string | null;
    stateDir: string | null;
  };
  cwd: string;
  startedAt: string;
  finishedAt: string | null;
  status: "running" | "completed" | "failed";
  exitCode: CommandExitCode | null;
  payload: JsonValue | null;
  error: CommandFailure | null;
};

export type SessionRecord = {
  schemaVersion: 1;
  sessionId: string;
  name: string;
  artifactDir: string;
  createdAt: string;
  updatedAt: string;
  activeTargetId: string | null;
  lastSnapshotId: string | null;
  sidecars: SidecarRecord[];
};

export type SidecarRecord = {
  name: string;
  pid: number | null;
  port: number | null;
  status: (typeof SIDECAR_STATUSES)[number];
};

export type DeviceSummary = {
  id: string;
  name: string | null;
  state: (typeof DEVICE_STATES)[number];
};

export type AppProcessSummary = {
  bundleId: string | null;
  processName: string | null;
  running: boolean | null;
};

export type MetroTargetSummary = {
  port: number | null;
  status: (typeof METRO_TARGET_STATUSES)[number];
  targetId: string | null;
  title: string | null;
  appId: string | null;
  debuggerUrl: string | null;
};

export type TargetRecord = {
  targetId: string;
  platform: Platform;
  device: DeviceSummary;
  app: AppProcessSummary;
  metro: MetroTargetSummary;
  selected: boolean;
  stale: boolean;
};

export type SnapshotSource = (typeof SNAPSHOT_SOURCES)[number];
export type SnapshotFilters = {
  interactiveOnly: boolean;
  compact: boolean;
  depth: number | null;
  includeSource: boolean;
  includeBounds: boolean;
};

export type SnapshotResult = {
  snapshotId: string;
  targetId: string;
  routeHint: string | null;
  source: SnapshotSource[];
  generatedAt: string;
  filters: SnapshotFilters;
  refs: RefRecord[];
  tree: SnapshotNode[];
  artifacts: {
    json: string;
    screenshot: string | null;
    annotatedScreenshot: string | null;
  };
  limitations: string[];
};

export type RefAction = (typeof REF_ACTIONS)[number];
export type SourceLocation = {
  file: string | null;
  line: number | null;
  column: number | null;
};
export type ScreenBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};
export type RefRecord = {
  ref: SnapshotRef;
  snapshotId: string;
  targetId: string;
  stale: boolean;
  role: string | null;
  label: string | null;
  text: string | null;
  placeholder: string | null;
  testID: string | null;
  nativeID: string | null;
  component: string | null;
  source: SourceLocation | null;
  box: ScreenBox | null;
  actions: RefAction[];
};
export type SnapshotNode = {
  ref: SnapshotRef | null;
  parentRef: SnapshotRef | null;
  depth: number;
  role: string | null;
  label: string | null;
  component: string | null;
  source: SourceLocation | null;
  box: ScreenBox | null;
  children: SnapshotRef[];
};
export type EvidencePacket = {
  packetId: string;
  targetId: string | null;
  timeRange: TimeRange;
  artifacts: ArtifactRef[];
  summary: JsonValue;
  limitations: string[];
};

export type PackageManager = (typeof PACKAGE_MANAGERS)[number];
export type AppConfigSummary = {
  source: string;
  name: string | null;
  slug: string | null;
  scheme: string | null;
  iosBundleIdentifier: string | null;
  androidPackage: string | null;
  userInterfaceStyle: string | null;
  dynamic?: boolean;
};
export type ProjectInfoResult = {
  projectRoot: string;
  packageManager: PackageManager;
  expoDependency: string | null;
  reactNativeDependency: string | null;
  expoRouterDependency: string | null;
  scripts: Record<string, string>;
  appConfig: AppConfigSummary | null;
};
export type DoctorResult = {
  cli: { name: "expo-ios"; version: string };
  cwd: string;
  auth: { required: false; source: "not-required" };
  commands: Record<string, string | null>;
  capabilities: Record<string, boolean>;
  project: ProjectInfoResult | null;
};
export type DevToolsCapability = {
  name: string;
  source: (typeof DEVTOOLS_CAPABILITY_SOURCES)[number];
  available: boolean;
  readCommands: string[];
  writeCommands: string[];
  artifactTypes: string[];
  limitations: string[];
};
export type DevToolsStatusResult = {
  targetId: string | null;
  capabilities: DevToolsCapability[];
  debuggerConnection: {
    attached: boolean;
    mayDisconnectReactNativeDevTools: boolean;
  };
};
export type PerformanceResult = {
  metric: string;
  value: number;
  unit: (typeof PERFORMANCE_UNITS)[number];
  source: (typeof PERFORMANCE_SOURCES)[number];
  confidence: SourceConfidence;
  context: {
    build: BuildContext;
    platform: Platform;
    device: string | null;
    metroDevMode: boolean | null;
    coldStart: boolean | null;
    samples: number;
  };
  artifacts: string[];
  limitations: string[];
};
export type PerformanceReport = {
  reportId: string;
  targetId: string | null;
  metrics: PerformanceResult[];
  artifacts: ArtifactRef[];
  refs?: RefRecord[];
  limitations: string[];
};

export function ok<T>(data: T, warnings?: CommandWarning[]): CommandOutcome<T> {
  return warnings === undefined ? { ok: true, data } : { ok: true, data, warnings };
}

export function failure(
  type: CommandFailureType,
  message: string,
  options: Omit<CommandFailure, "type" | "message"> = {},
): CommandOutcome<never> {
  return {
    ok: false,
    error: {
      type,
      message,
      ...options,
    },
  };
}

export function createArtifactRef(
  kind: ArtifactKind,
  path: string,
  options: Omit<ArtifactRef, "kind" | "path"> = {},
): ArtifactRef {
  return {
    kind,
    path,
    ...options,
  };
}

export function createEvidencePacket(input: {
  packetId: string;
  targetId: string | null;
  startedAt: string;
  finishedAt: string | null;
  durationMs?: number;
  artifacts: ArtifactRef[];
  summary: JsonValue;
  limitations: string[];
}): EvidencePacket {
  return {
    packetId: input.packetId,
    targetId: input.targetId,
    timeRange: input.durationMs === undefined
      ? { startedAt: input.startedAt, finishedAt: input.finishedAt }
      : { startedAt: input.startedAt, finishedAt: input.finishedAt, durationMs: input.durationMs },
    artifacts: input.artifacts.map((artifact) => ({ ...artifact })),
    summary: cloneJson(input.summary),
    limitations: [...input.limitations],
  };
}

function cloneJson<T extends JsonValue>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
