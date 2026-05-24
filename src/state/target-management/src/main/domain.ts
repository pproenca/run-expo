export type Platform = "ios" | "android";

export type DeviceState = "booted" | "shutdown" | "connected" | "unknown";

export type DeviceSummary = {
  id: string;
  name: string | null;
  state: DeviceState;
};

export type MetroTarget = {
  id: string | null;
  title: string | null;
  appId: string | null;
  webSocketDebuggerUrl: string | null;
  deviceName: string | null;
};

export type TargetRecord = {
  targetId: string;
  platform: Platform;
  device: DeviceSummary;
  app: {
    bundleId: string | null;
    processName: string | null;
    running: boolean | null;
  };
  metro: {
    port: number | null;
    status: "available" | "unavailable" | "unknown";
    targetId: string | null;
    title: string | null;
    appId: string | null;
    debuggerUrl: string | null;
  };
  selected: boolean;
  stale: boolean;
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

export type TargetDependencies = {
  readLatestSession(stateRoot: string): Promise<SessionRecord | null>;
  updateSessionRecord(stateRoot: string, record: SessionRecord): Promise<SessionRecord>;
  readPersistedTarget(stateRoot: string, sessionId: string): Promise<TargetRecord | null>;
  writePersistedTarget(stateRoot: string, sessionId: string, target: TargetRecord): Promise<void>;
  listIosSimulatorTargets(): Promise<DeviceSummary[]>;
  fetchMetroTargets(port: number): Promise<unknown>;
};

export type TargetAction = "list" | "select" | "current";
export type DiscoveryPlatform = "ios" | "android" | "all";

export type TargetCommandArgs = {
  action?: string;
  targetId?: string;
  platform?: string;
  metroPort?: unknown;
  stateRoot: string;
  now?: () => Date;
};

export type DiscoverTargetsArgs = {
  platform?: DiscoveryPlatform | string;
  metroPort?: unknown;
  selectedTargetId?: string | null;
};

export type DiscoveryDependencies = {
  listIosSimulatorTargets(): Promise<DeviceSummary[]>;
  fetchMetroTargets(port: number): Promise<unknown>;
};

export type TargetListResult = {
  available: boolean;
  targets: TargetRecord[];
};

export type TargetUnavailableResult = {
  available: false;
  reason: string;
  sessionId?: string;
  targetId?: string;
  targets?: TargetRecord[];
  target?: TargetRecord | { targetId: string; selected: true; stale: true };
};

export type TargetCurrentResult =
  | { available: true; sessionId: string; target: TargetRecord }
  | TargetUnavailableResult;

export type TargetCommandResult =
  | TargetListResult
  | TargetRecord
  | TargetCurrentResult
  | TargetUnavailableResult;
