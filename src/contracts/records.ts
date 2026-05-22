import type {
  ArtifactRef,
  CommandExitCode,
  CommandFailure,
  JsonValue,
  Platform,
  SnapshotRef,
  TimeRange,
} from "./primitives.js";

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
  status: "running" | "stale" | "stopped" | "unknown";
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

export type DeviceSummary = {
  id: string;
  name: string | null;
  state: "booted" | "shutdown" | "connected" | "unknown";
};

export type AppProcessSummary = {
  bundleId: string | null;
  processName: string | null;
  running: boolean | null;
};

export type MetroTargetSummary = {
  port: number | null;
  status: "available" | "unavailable" | "unknown";
  targetId: string | null;
  title: string | null;
  appId: string | null;
  debuggerUrl: string | null;
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

export type SnapshotSource =
  | "native-accessibility"
  | "react-devtools-hook"
  | "hermes-fiber"
  | "app-instrumentation";

export type SnapshotFilters = {
  interactiveOnly: boolean;
  compact: boolean;
  depth: number | null;
  includeSource: boolean;
  includeBounds: boolean;
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

export type RefAction =
  | "tap"
  | "long-press"
  | "fill"
  | "focus"
  | "press"
  | "scroll"
  | "inspect";

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

export type EvidencePacket = {
  packetId: string;
  targetId: string | null;
  timeRange: TimeRange;
  artifacts: ArtifactRef[];
  summary: JsonValue;
  limitations: string[];
};
