export type SnapshotFilters = {
  interactiveOnly: boolean;
  compact: boolean;
  depth: number | null;
  includeSource: boolean;
  includeBounds: boolean;
};

export type SnapshotArgs = {
  stateRoot?: string;
  interactive?: boolean;
  compact?: boolean;
  depth?: unknown;
  source?: boolean;
  bounds?: boolean;
  metroPort?: unknown;
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
  sidecars: unknown[];
};

export type DeviceSummary = {
  id: string;
  name: string | null;
  state: string;
};

export type TargetRecord = {
  targetId: string;
  platform: string;
  device: DeviceSummary;
  app: Record<string, unknown>;
  metro: Record<string, unknown>;
  selected: boolean;
  stale: boolean;
};

export type ScreenBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type SourceLocation = {
  file: string | null;
  line: number | null;
  column: number | null;
};

export type NormalizedAccessibilityNode = {
  role: string | null;
  label: string | null;
  text: string | null;
  placeholder: string | null;
  testID: string | null;
  nativeID: string | null;
  component: string | null;
  source: unknown;
  box: ScreenBox | null;
  actions: string[];
  raw: unknown;
};

export type RefRecord = {
  ref: string;
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
  source: unknown;
  box: ScreenBox | null;
  actions: string[];
  disabled?: boolean;
  raw?: unknown;
};

export type SnapshotNode = {
  ref: string;
  role: string | null;
  label: string | null;
  text: string | null;
  testID: string | null;
  source: unknown;
  box: ScreenBox | null;
  actions: string[];
};

export type SemanticBridgeSnapshot = {
  available: true;
  source: string;
  bridgeVersion?: string | null;
  routeHint: string | null;
  refs: Array<Partial<RefRecord> & { raw?: unknown }>;
  rawCount?: number;
  metroPort?: number;
  transport?: unknown;
  limitations: string[];
};

export type SnapshotResult = {
  snapshotId: string;
  targetId: string;
  routeHint: string | null;
  source: string[];
  semanticBridge?: unknown;
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

export type RefCache = {
  snapshotId: string;
  targetId: string;
  source: string[];
  semanticBridge?: unknown;
  refs: RefRecord[];
};

export type SnapshotPersistenceDependencies = {
  now(): Date;
  randomSuffix(): string;
  ensureDirectory(path: string): Promise<void>;
  writeJsonFile(path: string, value: unknown): Promise<void>;
  updateSessionRecord(stateRoot: string, record: SessionRecord): Promise<SessionRecord>;
};

export type SnapshotCommandDependencies = SnapshotPersistenceDependencies & {
  readLatestSession(stateRoot: string): Promise<SessionRecord | null>;
  readSelectedTarget(stateRoot: string, session: SessionRecord): Promise<TargetRecord | null>;
  captureSemanticBridge(args: SnapshotArgs, context: {
    stateRoot: string;
    session: SessionRecord;
    filters: SnapshotFilters;
  }): Promise<SemanticBridgeSnapshot | { available: false; [key: string]: unknown }>;
  findAxeCli(): Promise<string | null>;
  describeNativeUi(axePath: string, deviceId: string): Promise<{ stdout: string; stderr: string; error?: unknown }>;
};

export type RefCommandDependencies = {
  readLatestSession(stateRoot: string): Promise<SessionRecord | null>;
  readJsonFile(path: string): Promise<RefCache>;
};
