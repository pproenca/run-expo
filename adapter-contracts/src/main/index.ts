export const CORE_ADAPTERS = [
  "commandRunner",
  "project",
  "device",
  "gesture",
  "metro",
  "hermes",
  "snapshot",
  "devTools",
  "runtimeEvidence",
  "performance",
  "sessionStore",
] as const;

export const DOMAIN_ADAPTERS = [
  "navigation",
  "network",
  "storage",
  "appState",
  "controls",
  "accessibility",
  "dialog",
  "recording",
  "diff",
  "dashboard",
  "skills",
  "setup",
  "clipboard",
  "environment",
  "expoIntrospection",
  "instrumentation",
] as const;

export const NATIVE_PROFILER_ADAPTERS = ["nativeProfiler"] as const;

export const REVIEW_ADAPTERS = [
  "inspector",
  "trace",
  "annotation",
  "reviewOverlay",
  "reviewGuidance",
  "reviewReport",
] as const;

export const GESTURE_ACTION_KINDS = [
  "tap",
  "long-press",
  "drag",
  "swipe",
  "ref-action",
] as const;

export const REF_ACTION_KINDS = [
  "tap",
  "long-press",
  "fill",
  "focus",
  "scroll",
] as const;

export const STORAGE_KINDS = ["async", "mmkv", "secure-store", "sqlite"] as const;

export const ENVIRONMENT_SETTING_CATEGORIES = [
  "appearance",
  "content-size",
  "locale",
  "timezone",
  "location",
  "network",
  "permissions",
  "orientation",
  "keyboard",
] as const;

export type CoreAdapterName = (typeof CORE_ADAPTERS)[number];
export type DomainAdapterName = (typeof DOMAIN_ADAPTERS)[number];
export type NativeProfilerAdapterName = (typeof NATIVE_PROFILER_ADAPTERS)[number];
export type ReviewAdapterName = (typeof REVIEW_ADAPTERS)[number];
export type AdapterName =
  | CoreAdapterName
  | DomainAdapterName
  | NativeProfilerAdapterName
  | ReviewAdapterName;
export type AdapterGroup = "core" | "domain" | "native-profiler" | "review";

export type AdapterContract = {
  name: AdapterName;
  group: AdapterGroup;
  sourceFile:
    | "src/adapters/interfaces.ts"
    | "src/adapters/domains.ts"
    | "src/adapters/native-profilers.ts"
    | "src/adapters/review.ts";
  capability: string;
};

export type AdapterImplementationSource = {
  adapterName: AdapterName;
  packageName: `@expo98/${string}`;
  exportName: string;
  responsibility: string;
};

export const ADAPTER_CATALOG = [
  core("commandRunner", "Command planning and subprocess execution"),
  core("project", "Project doctor, project info, app config, and route discovery"),
  core("device", "Device listing, app lifecycle, URL opening, and screenshots"),
  core("gesture", "Gesture planning and execution"),
  core("metro", "Metro status, target discovery, and stack symbolication"),
  core("hermes", "Hermes runtime evaluation and inspection"),
  core("snapshot", "Snapshot capture, ref lookup, and ref field access"),
  core("devTools", "React Native DevTools status, capability, and event access"),
  core("runtimeEvidence", "UX context, console, error, and log evidence"),
  core("performance", "Performance summary and measurement reports"),
  core("sessionStore", "Session list, show, create, update, close, and clean"),
  domain("navigation", "Navigation state and route mutation"),
  domain("network", "Network status, request detail, clear, and HAR capture"),
  domain("storage", "Application storage list, get, set, clear, and trace"),
  domain("appState", "Named app state save, load, list, and clear"),
  domain("controls", "Debug controls list, read, write, and press"),
  domain("accessibility", "Accessibility tree, inspect, audit, and focus"),
  domain("dialog", "Dialog status, accept, and dismiss"),
  domain("recording", "Video or trace recording start, stop, and status"),
  domain("diff", "Snapshot, screenshot, and route diffs"),
  domain("dashboard", "Dashboard start, stop, and status"),
  domain("skills", "Skill listing and document reads"),
  domain("setup", "Install and upgrade setup checks"),
  domain("clipboard", "Clipboard read, write, and paste"),
  domain("environment", "Runtime environment setting mutation"),
  domain("expoIntrospection", "Expo module, config, doctor, and prebuild introspection"),
  domain("instrumentation", "App instrumentation status, manifest, install, remove, and calls"),
  nativeProfiler("nativeProfiler", "Native profile sessions, traces, memgraphs, and memory reads"),
  review("inspector", "Inspector probing, toggling, comments, and developer menu access"),
  review("trace", "Review trace start, read, stop, and clear"),
  review("annotation", "Annotation board create, serve, and read"),
  review("reviewOverlay", "Review overlay scaffold, preparation, read, and clear operations"),
  review("reviewGuidance", "Review next-step guidance"),
  review("reviewReport", "Review report and acceptance matrix generation"),
] as const satisfies readonly AdapterContract[];

export const ADAPTER_IMPLEMENTATION_SOURCES = [
  adapterSource("commandRunner", "@expo98/command-runner-adapter", "execFilePromise", "Subprocess execution with normalized errors and output bounds"),
  adapterSource("project", "@expo98/project-info-doctor", "projectInfo", "Project doctor and dependency summary payloads"),
  adapterSource("project", "@expo98/project-filesystem-helpers", "normalizeProjectCwd", "Project root validation and package-manager discovery"),
  adapterSource("project", "@expo98/static-expo-config-reader", "readExpoConfigSummary", "Static Expo app config reads"),
  adapterSource("project", "@expo98/router-sitemap", "expoRouteContext", "Expo Router route discovery"),
  adapterSource("device", "@expo98/device-listing", "listDevices", "Cross-platform target listing"),
  adapterSource("device", "@expo98/app-lifecycle-actions", "bootSimulator", "Simulator boot orchestration"),
  adapterSource("device", "@expo98/app-lifecycle-actions", "launchApp", "Application launch"),
  adapterSource("device", "@expo98/app-lifecycle-actions", "terminateApp", "Application termination"),
  adapterSource("device", "@expo98/app-lifecycle-actions", "reloadApp", "Application reload"),
  adapterSource("device", "@expo98/app-lifecycle-actions", "installApp", "Application install"),
  adapterSource("device", "@expo98/app-lifecycle-actions", "uninstallApp", "Application uninstall"),
  adapterSource("device", "@expo98/runtime-inspector-actions", "openIosDevMenu", "Native developer menu opening"),
  adapterSource("device", "@expo98/route-url-actions", "openUrl", "Device URL opening"),
  adapterSource("device", "@expo98/screenshot-capture", "automationTakeScreenshot", "Screenshot capture"),
  adapterSource("gesture", "@expo98/interaction-actions", "gestureCommandPlan", "Gesture command planning"),
  adapterSource("gesture", "@expo98/interaction-actions", "executeGesturePlan", "Gesture execution"),
  adapterSource("gesture", "@expo98/interaction-actions", "createRefActionAdapter", "Ref-based interaction adapter"),
  adapterSource("metro", "@expo98/metro-probes", "MetroInspectorClient", "Metro status, targets, and symbolication transport"),
  adapterSource("metro", "@expo98/metro-target-list-adapter", "fetchMetroTargets", "Metro target list discovery"),
  adapterSource("hermes", "@expo98/hermes-runtime-diagnostics", "evaluateHermesExpression", "Hermes Runtime.evaluate execution"),
  adapterSource("hermes", "@expo98/hermes-runtime-diagnostics", "inspectHermesRuntime", "Hermes runtime inspection diagnostics"),
  adapterSource("snapshot", "@expo98/snapshot-evidence", "snapshotCommand", "Snapshot capture command boundary"),
  adapterSource("snapshot", "@expo98/snapshot-evidence", "refsCommand", "Snapshot refs listing"),
  adapterSource("snapshot", "@expo98/snapshot-evidence", "getRefCommand", "Snapshot ref field reads"),
  adapterSource("snapshot", "@expo98/ref-actions-wait", "findCommand", "Snapshot ref lookup"),
  adapterSource("devTools", "@expo98/devtools-diagnostics", "devtoolsStatusPayload", "React Native DevTools status and capabilities"),
  adapterSource("devTools", "@expo98/devtools-diagnostics", "consoleCommand", "Console event reads"),
  adapterSource("devTools", "@expo98/devtools-diagnostics", "errorsCommand", "Runtime error reads"),
  adapterSource("runtimeEvidence", "@expo98/ux-context-capture", "captureUxContext", "UX evidence aggregation"),
  adapterSource("runtimeEvidence", "@expo98/ios-native-context-probes", "collectFilteredIosLogs", "Native log evidence"),
  adapterSource("runtimeEvidence", "@expo98/ios-hierarchy-summary", "describeIosHierarchy", "Native hierarchy evidence"),
  adapterSource("runtimeEvidence", "@expo98/ios-crash-evidence", "iosCrashEvidence", "Crash report evidence"),
  adapterSource("performance", "@expo98/perf-evidence", "perfSummaryPayload", "Performance summary reports"),
  adapterSource("performance", "@expo98/perf-evidence", "perfNativeProfilerPayload", "Native profiler performance payloads"),
  adapterSource("performance", "@expo98/perf-evidence", "perfBundlePayload", "Bundle-size performance payloads"),
  adapterSource("sessionStore", "@expo98/session-run-records", "listSessions", "Session listing"),
  adapterSource("sessionStore", "@expo98/session-run-records", "showSession", "Session lookup"),
  adapterSource("sessionStore", "@expo98/session-run-records", "createSession", "Session creation"),
  adapterSource("sessionStore", "@expo98/session-run-records", "closeSession", "Session close"),
  adapterSource("sessionStore", "@expo98/session-run-records", "cleanSessions", "Session cleanup"),
  adapterSource("navigation", "@expo98/navigation-deeplinks", "navigationCommand", "Runtime navigation state and mutation"),
  adapterSource("navigation", "@expo98/route-url-actions", "openExpoRoute", "Deep-link route opening"),
  adapterSource("network", "@expo98/network-evidence", "networkCommand", "Network status, request reads, clear, and HAR capture"),
  adapterSource("storage", "@expo98/bridge-domain-actions", "storageCommand", "Storage list, get, set, clear, and trace"),
  adapterSource("appState", "@expo98/bridge-domain-actions", "stateCommand", "Named app-state save, load, list, and clear"),
  adapterSource("controls", "@expo98/bridge-domain-actions", "controlsCommand", "Debug control list, read, write, and press"),
  adapterSource("accessibility", "@expo98/accessibility-actions", "accessibilityCommand", "Accessibility tree, inspect, audit, and focus"),
  adapterSource("dialog", "@expo98/modal-blocker-actions", "dialogCommand", "Dialog status, accept, and dismiss"),
  adapterSource("dialog", "@expo98/modal-blocker-actions", "sheetCommand", "Sheet status and dismiss"),
  adapterSource("recording", "@expo98/record-artifacts", "recordCommand", "Recording artifact start, stop, and status"),
  adapterSource("diff", "@expo98/review-evidence-reports", "diffCommand", "Snapshot, screenshot, and route diff payloads"),
  adapterSource("dashboard", "@expo98/dashboard-observability", "dashboardCommand", "Dashboard start, stop, and status"),
  adapterSource("skills", "@expo98/plugin-self-management", "skillsCommand", "Bundled skill listing and reads"),
  adapterSource("setup", "@expo98/plugin-self-management", "installCommand", "Setup install checks"),
  adapterSource("setup", "@expo98/plugin-self-management", "upgradeCommand", "Setup upgrade checks"),
  adapterSource("clipboard", "@expo98/interaction-actions", "clipboardCommand", "Clipboard read, write, and paste"),
  adapterSource("environment", "@expo98/interaction-actions", "setEnvironmentCommand", "Runtime environment setting mutation"),
  adapterSource("expoIntrospection", "@expo98/expo-introspection-actions", "expoCommand", "Expo module, config, doctor, and prebuild introspection"),
  adapterSource("instrumentation", "@expo98/bridge-command-adapter", "bridgeCommand", "App instrumentation status, manifest, install, remove, and calls"),
  adapterSource("nativeProfiler", "@expo98/perf-evidence", "perfNativeProfilerPayload", "Native profile sessions and traces"),
  adapterSource("inspector", "@expo98/runtime-inspector-actions", "runtimeInspector", "Inspector probing and developer-menu access"),
  adapterSource("inspector", "@expo98/debug-inspect-highlight", "debugInspectCommand", "Inspector ref reads"),
  adapterSource("trace", "@expo98/interaction-trace-expression", "traceInteraction", "Review interaction trace expression"),
  adapterSource("annotation", "@expo98/annotate-screen-artifacts", "annotateScreen", "Annotation board creation"),
  adapterSource("annotation", "@expo98/annotation-server-http", "annotationServer", "Annotation board serving"),
  adapterSource("reviewOverlay", "@expo98/review-overlay-workflow", "reviewOverlay", "Review overlay scaffold and preparation"),
  adapterSource("reviewOverlay", "@expo98/review-sidecar-state", "readReviewOverlayEvents", "Review overlay event reads"),
  adapterSource("reviewGuidance", "@expo98/review-next-guidance", "reviewNextStep", "Review next-step guidance"),
  adapterSource("reviewReport", "@expo98/review-evidence-reports", "reviewCommand", "Review report command boundary"),
  adapterSource("reviewReport", "@expo98/review-evidence-reports", "reviewReportPayload", "Review report payload generation"),
  adapterSource("reviewReport", "@expo98/review-evidence-reports", "reviewMatrixPayload", "Review acceptance matrix generation"),
] as const satisfies readonly AdapterImplementationSource[];

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export type Platform = "ios" | "android";
export type AvailabilityStatus = "available" | "unavailable" | "degraded";
export type Availability = {
  status: AvailabilityStatus;
  reason?: string;
  limitations?: string[];
};
export type ArtifactRef = {
  kind: string;
  path: string;
  description?: string;
};
export type SnapshotRef = string;
export type CommandPlan = {
  command: string;
  args: string[];
  cwd?: string;
};
export type TargetRecord = {
  id: string;
  platform: Platform;
  name?: string;
  [key: string]: unknown;
};
export type RefRecord = {
  ref: SnapshotRef;
  [key: string]: unknown;
};
export type SessionRecord = {
  sessionId: string;
  [key: string]: unknown;
};
export type SnapshotResult = {
  snapshotId: string;
  refs?: RefRecord[];
  [key: string]: unknown;
};
export type RouteRecord = {
  route: string;
  [key: string]: unknown;
};
export type ActionEvidence = {
  action: string;
  available?: boolean;
  artifacts?: ArtifactRef[];
  [key: string]: unknown;
};

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

export interface CommandRunnerAdapter {
  plan(command: string, args: string[], options?: RunOptions): CommandPlan;
  run(plan: CommandPlan, options?: RunOptions): Promise<RunResult>;
}

export interface ProjectAdapter {
  doctor(cwd: string): Promise<JsonValue>;
  projectInfo(cwd: string): Promise<JsonValue>;
  readAppConfig(projectRoot: string): Promise<JsonValue | null>;
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
      action: (typeof REF_ACTION_KINDS)[number];
      value?: string;
    };

export type GestureRunOptions = {
  dryRun: boolean;
  captureBeforeAfter: boolean;
  includeTrace: boolean;
};

export interface GestureAdapter {
  plan(action: GestureAction): CommandPlan;
  run(action: GestureAction, options: GestureRunOptions): Promise<ActionEvidence>;
}

export type MetroStatus = {
  port: number;
  status: "available" | "unavailable";
  version: JsonValue | null;
  targets: TargetRecord[];
};

export interface MetroAdapter {
  status(port: number): Promise<MetroStatus>;
  targets(port: number): Promise<TargetRecord[]>;
  symbolicate(port: number, stack: string): Promise<string>;
}

export type RuntimeEvalOptions = {
  timeoutMs: number;
  returnByValue: boolean;
  reason: string;
};

export interface HermesAdapter {
  evaluate<T extends JsonValue>(
    target: TargetRecord,
    expression: string,
    options: RuntimeEvalOptions,
  ): Promise<T>;
  inspectRuntime(target: TargetRecord): Promise<JsonValue>;
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
  | {
      kind: "text" | "label" | "placeholder" | "testid" | "source";
      value: string;
      exact?: boolean;
    }
  | { kind: "first" | "last" | "nth"; value: string; index?: number };

export interface SnapshotAdapter {
  capture(target: TargetRecord, options: SnapshotOptions): Promise<SnapshotResult>;
  refs(snapshotId: string): Promise<RefRecord[]>;
  get(ref: SnapshotRef, field: RefField): Promise<JsonValue>;
  find(locator: RefLocator): Promise<RefRecord[]>;
}

export type DevToolsStatus = {
  targetId: string | null;
  capabilities: JsonValue[];
  attached: boolean;
  mayDisconnectReactNativeDevTools: boolean;
};

export interface DevToolsAdapter {
  status(target: TargetRecord): Promise<DevToolsStatus>;
  capabilities(target: TargetRecord): Promise<JsonValue[]>;
  startEvents(target: TargetRecord): Promise<ArtifactRef>;
  readEvents(target: TargetRecord): Promise<JsonValue>;
  stopEvents(target: TargetRecord): Promise<ArtifactRef>;
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

export interface RuntimeEvidenceAdapter {
  uxContext(target: TargetRecord, options: UxContextOptions): Promise<JsonValue>;
  console(target: TargetRecord, options: LogReadOptions): Promise<JsonValue>;
  errors(target: TargetRecord, options: LogReadOptions): Promise<JsonValue>;
  logs(target: TargetRecord, options: LogReadOptions): Promise<ArtifactRef>;
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

export interface PerformanceAdapter {
  summary(target: TargetRecord): Promise<JsonValue>;
  startup(target: TargetRecord, options: StartupMeasureOptions): Promise<JsonValue>;
  action(target: TargetRecord, options: ActionMeasureOptions): Promise<JsonValue>;
  bundle(cwd: string, options: BundleMeasureOptions): Promise<JsonValue>;
}

export interface SessionStoreAdapter {
  list(): Promise<SessionRecord[]>;
  show(nameOrId: string): Promise<SessionRecord | null>;
  create(name?: string): Promise<SessionRecord>;
  update(record: SessionRecord): Promise<SessionRecord>;
  close(nameOrId: string): Promise<SessionRecord>;
  clean(options: { olderThanDays?: number }): Promise<SessionRecord[]>;
}

export type StorageKind = (typeof STORAGE_KINDS)[number];
export type NavigationStateResult = {
  available: boolean;
  route: string | null;
  tree: JsonValue | null;
  source: "expo-router" | "react-navigation" | "deep-link" | "unknown";
  limitations: string[];
};

export interface NavigationAdapter {
  state(target: TargetRecord): Promise<NavigationStateResult>;
  back(target: TargetRecord): Promise<Availability>;
  popToRoot(target: TargetRecord): Promise<Availability>;
  tab(target: TargetRecord, tab: string | number): Promise<Availability>;
  deepLink(target: TargetRecord, route: string, query?: string): Promise<Availability>;
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
export interface NetworkAdapter {
  status(target: TargetRecord): Promise<Availability>;
  requests(target: TargetRecord, options: NetworkReadOptions): Promise<NetworkRequestSummary[]>;
  request(target: TargetRecord, requestId: string): Promise<NetworkRequestDetail | null>;
  clear(target: TargetRecord): Promise<Availability>;
  startHar(target: TargetRecord): Promise<ArtifactRef>;
  stopHar(target: TargetRecord): Promise<ArtifactRef>;
}

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
export interface StorageAdapter {
  list(target: TargetRecord, store: StorageKind): Promise<StorageKeySummary[]>;
  get(target: TargetRecord, store: StorageKind, key: string): Promise<JsonValue | null>;
  set(target: TargetRecord, store: StorageKind, key: string, value: JsonValue): Promise<Availability>;
  clear(target: TargetRecord, store: StorageKind, options: StorageClearOptions): Promise<Availability>;
  trace(target: TargetRecord, options: StorageTraceOptions): Promise<ArtifactRef>;
}

export type StateSnapshot = {
  name: string;
  createdAt: string;
  artifact: ArtifactRef;
  summary: JsonValue;
};
export interface AppStateAdapter {
  save(target: TargetRecord, name: string): Promise<StateSnapshot>;
  load(target: TargetRecord, name: string): Promise<Availability>;
  list(target: TargetRecord): Promise<StateSnapshot[]>;
  clear(target: TargetRecord, name: string): Promise<Availability>;
}

export type AppControl = {
  name: string;
  description: string;
  value: JsonValue;
  writable: boolean;
  sideEffects: string[];
};
export interface ControlsAdapter {
  list(target: TargetRecord): Promise<AppControl[]>;
  get(target: TargetRecord, name: string): Promise<JsonValue>;
  set(target: TargetRecord, name: string, value: JsonValue): Promise<Availability>;
  press(target: TargetRecord, name: string): Promise<Availability>;
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
export interface AccessibilityAdapter {
  tree(target: TargetRecord): Promise<AccessibilityTreeResult>;
  inspect(target: TargetRecord, ref: SnapshotRef): Promise<JsonValue>;
  audit(target: TargetRecord, snapshot?: SnapshotResult): Promise<AccessibilityFinding[]>;
  focus(target: TargetRecord, ref: SnapshotRef): Promise<Availability>;
}

export type DialogState = {
  visible: boolean;
  kind: "alert" | "action-sheet" | "modal" | "sheet" | "unknown";
  title: string | null;
  message: string | null;
  actions: string[];
};
export interface DialogAdapter {
  status(target: TargetRecord): Promise<DialogState>;
  accept(target: TargetRecord, text?: string): Promise<Availability>;
  dismiss(target: TargetRecord): Promise<Availability>;
}

export type RecordingOptions = {
  kind: "video" | "trace";
  outputPath?: string;
};
export interface RecordingAdapter {
  start(target: TargetRecord, options: RecordingOptions): Promise<ArtifactRef>;
  stop(target: TargetRecord, outputPath?: string): Promise<ArtifactRef>;
  status(target: TargetRecord): Promise<Availability>;
}

export type DiffResult = {
  changed: boolean;
  summary: string;
  artifacts: ArtifactRef[];
  details: JsonValue;
};
export interface DiffAdapter {
  snapshot(before: SnapshotResult, after: SnapshotResult): Promise<DiffResult>;
  screenshot(beforePath: string, afterPath: string): Promise<DiffResult>;
  route(beforeRoute: string, afterRoute: string): Promise<DiffResult>;
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
export interface DashboardAdapter {
  start(options: DashboardOptions): Promise<DashboardStatus>;
  stop(): Promise<DashboardStatus>;
  status(): Promise<DashboardStatus>;
}

export type SkillSummary = {
  name: string;
  path: string;
  description: string;
};
export type SkillDocument = SkillSummary & {
  markdown: string;
};
export interface SkillsAdapter {
  list(): Promise<SkillSummary[]>;
  get(name: string): Promise<SkillDocument | null>;
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
export interface SetupAdapter {
  install(options: SetupInstallOptions): Promise<SetupResult>;
  upgrade(options: SetupUpgradeOptions): Promise<SetupResult>;
}

export interface ClipboardAdapter {
  read(target: TargetRecord): Promise<string>;
  write(target: TargetRecord, text: string): Promise<Availability>;
  paste(target: TargetRecord): Promise<Availability>;
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

export interface EnvironmentAdapter {
  set(target: TargetRecord, setting: EnvironmentSetting): Promise<Availability>;
}

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

export type GenericProfilerOptions = {
  kind: "react" | "hermes" | "native";
  outputDir?: string;
};
export type EttraceOptions = {
  outputDir?: string;
  durationMs?: number;
  symbolicate: boolean;
};
export type MemgraphOptions = {
  outputPath?: string;
  note?: string;
};
export type NativeProfileSession = {
  sessionId: string;
  targetId: string;
  startedAt: string;
  artifactDir: string;
  availability: Availability;
};
export type NativeProfileArtifact = {
  profileId: string;
  targetId: string | null;
  artifact: ArtifactRef;
  summary: JsonValue;
  limitations: string[];
};
export type ProcessMemoryResult = {
  targetId: string;
  residentBytes: number | null;
  virtualBytes: number | null;
  source: "simctl" | "ps" | "xctrace" | "unknown";
  limitations: string[];
};
export interface NativeProfilerAdapter {
  profilerStart(target: TargetRecord, options: GenericProfilerOptions): Promise<NativeProfileSession>;
  profilerStop(sessionId: string, outputPath?: string): Promise<NativeProfileArtifact>;
  ettraceStart(target: TargetRecord, options: EttraceOptions): Promise<NativeProfileSession>;
  ettraceStop(sessionId: string): Promise<NativeProfileArtifact>;
  memgraphCapture(target: TargetRecord, options: MemgraphOptions): Promise<NativeProfileArtifact>;
  processMemory(target: TargetRecord): Promise<ProcessMemoryResult>;
}

export type ReviewComment = {
  commentId: string;
  text: string;
  createdAt: string;
  source: "inspector" | "overlay" | "annotation-board";
  coordinates?: { x: number; y: number };
  element?: JsonValue;
};
export type InspectorProbeResult = {
  available: boolean;
  targetId: string | null;
  hooks: {
    nativeDevSettings: boolean;
    devSettingsMenu: boolean;
    alertPrompt: boolean;
    reactDevToolsHook: boolean;
  };
  limitations: string[];
};
export type CommentMenuOptions = {
  title: string;
  maxComments: number;
};
export type ReadCommentsOptions = {
  maxComments: number;
  symbolicate: boolean;
};
export interface InspectorAdapter {
  probe(target: TargetRecord): Promise<InspectorProbeResult>;
  toggle(target: TargetRecord): Promise<Availability>;
  installCommentMenu(target: TargetRecord, options: CommentMenuOptions): Promise<Availability>;
  openDevMenu(target: TargetRecord): Promise<Availability>;
  readComments(target: TargetRecord, options: ReadCommentsOptions): Promise<ReviewComment[]>;
  clearComments(target: TargetRecord): Promise<Availability>;
}

export type TraceOptions = {
  componentFilter?: string;
  maxEvents: number;
  includeEvents: boolean;
};
export type TraceReadOptions = {
  maxEvents: number;
  includeEvents: boolean;
};
export type TraceResult = {
  available: boolean;
  action: "start" | "read" | "stop" | "clear";
  artifact: ArtifactRef | null;
  summary: JsonValue;
  limitations: string[];
};
export interface TraceAdapter {
  start(target: TargetRecord, options: TraceOptions): Promise<TraceResult>;
  read(target: TargetRecord, options: TraceReadOptions): Promise<TraceResult>;
  stop(target: TargetRecord): Promise<TraceResult>;
  clear(target: TargetRecord): Promise<TraceResult>;
}

export type AnnotationOptions = {
  screenshotPath: string;
  outputDir: string;
  title?: string;
  context?: JsonValue;
};
export type AnnotationServeOptions = {
  port?: number;
};
export type AnnotationBoard = {
  boardId: string;
  outputDir: string;
  html: ArtifactRef;
  annotations: ArtifactRef;
  context: ArtifactRef;
  screenshot: ArtifactRef;
  serverUrl: string | null;
};
export interface AnnotationAdapter {
  create(options: AnnotationOptions): Promise<AnnotationBoard>;
  serve(board: AnnotationBoard, options: AnnotationServeOptions): Promise<AnnotationBoard>;
  read(boardDir: string): Promise<ReviewComment[]>;
}

export type ReviewOverlayScaffoldOptions = {
  cwd: string;
  overlayDir: string;
  force: boolean;
};
export type ReviewOverlayPrepareOptions = {
  cwd: string;
  outputDir: string;
  endpointPath: string;
  port?: number;
  serve: boolean;
};
export type ReviewOverlayReadOptions = {
  cwd: string;
  outputDir: string;
  metroPort?: number;
};
export type ReviewOverlayClearOptions = {
  outputDir: string;
};
export type ReviewOverlayResult = {
  available: boolean;
  artifacts: ArtifactRef[];
  endpointUrl: string | null;
  instructions: string[];
};
export type ReviewOverlayReadResult = {
  comments: ReviewComment[];
  artifacts: ArtifactRef[];
  limitations: string[];
};
export interface ReviewOverlayAdapter {
  scaffold(options: ReviewOverlayScaffoldOptions): Promise<ReviewOverlayResult>;
  prepare(options: ReviewOverlayPrepareOptions): Promise<ReviewOverlayResult>;
  read(options: ReviewOverlayReadOptions): Promise<ReviewOverlayReadResult>;
  clear(options: ReviewOverlayClearOptions): Promise<Availability>;
}

export type ReviewGuidanceArgs = {
  surface: "calendar" | "timeline" | "form" | "list" | "navigation" | "editor" | "generic";
  stage: "intake" | "pre-patch" | "post-patch" | "verifier-failed" | "interaction" | "handoff";
  issue?: string;
  flags: Record<string, boolean | string | number | null>;
};
export type ReviewNextResult = {
  constraint: JsonValue;
  nextStep: string;
  requiredFlows: JsonValue;
  suggestedCommands: string[];
  stopConditions: string[];
};
export interface ReviewGuidanceAdapter {
  nextStep(args: ReviewGuidanceArgs): Promise<ReviewNextResult>;
}

export type ReviewReportOptions = {
  sessionId?: string;
  outputPath?: string;
};
export type ReviewMatrixOptions = {
  sessionId?: string;
  acceptancePath?: string;
  outputPath?: string;
};
export type ReviewReportResult = {
  reportId: string;
  artifact: ArtifactRef;
  evidence: ArtifactRef[];
  limitations: string[];
};
export interface ReviewReportAdapter {
  report(options: ReviewReportOptions): Promise<ReviewReportResult>;
  matrix(options: ReviewMatrixOptions): Promise<ReviewReportResult>;
}

export interface AdapterRegistry {
  list(): AdapterName[];
  get<TAdapter = unknown>(name: AdapterName): TAdapter | null;
  require<TAdapter = unknown>(name: AdapterName): TAdapter;
  register<TAdapter>(name: AdapterName, adapter: TAdapter): void;
}

export function listAdapterContracts(group?: AdapterGroup): AdapterContract[] {
  const contracts =
    group === undefined
      ? ADAPTER_CATALOG
      : ADAPTER_CATALOG.filter((contract) => contract.group === group);
  return [...contracts];
}

export function getAdapterContract(name: string): AdapterContract | null {
  return ADAPTER_CATALOG.find((contract) => contract.name === name) ?? null;
}

export function adapterImplementationSources(name?: AdapterName): AdapterImplementationSource[] {
  const sources =
    name === undefined
      ? ADAPTER_IMPLEMENTATION_SOURCES
      : ADAPTER_IMPLEMENTATION_SOURCES.filter((source) => source.adapterName === name);
  return sources.map((source) => ({ ...source }));
}

export function adapterImplementationSourcesByPackage(packageName: string): AdapterImplementationSource[] {
  return ADAPTER_IMPLEMENTATION_SOURCES
    .filter((source) => source.packageName === packageName)
    .map((source) => ({ ...source }));
}

export function adapterImplementationSourcesByExport(exportName: string): AdapterImplementationSource[] {
  return ADAPTER_IMPLEMENTATION_SOURCES
    .filter((source) => source.exportName === exportName)
    .map((source) => ({ ...source }));
}

export function implementedAdapterNames(): AdapterName[] {
  const implemented = new Set(ADAPTER_IMPLEMENTATION_SOURCES.map((source) => source.adapterName));
  return ADAPTER_CATALOG
    .filter((contract) => implemented.has(contract.name))
    .map((contract) => contract.name);
}

export function assertAdapterImplementationSourcesCover(names: readonly string[]): void {
  const implemented = new Set(ADAPTER_IMPLEMENTATION_SOURCES.map((source) => source.adapterName));
  const missing = names.filter((name) => !implemented.has(name as AdapterName));
  if (missing.length > 0) {
    throw new Error(`Missing adapter implementation sources: ${missing.join(", ")}`);
  }
}

export function createAdapterRegistry(
  initial: Partial<Record<AdapterName, unknown>> = {},
): AdapterRegistry {
  const adapters = new Map<AdapterName, unknown>();

  for (const [name, adapter] of Object.entries(initial)) {
    if (adapter !== undefined) {
      adapters.set(assertAdapterName(name), adapter);
    }
  }

  return {
    list() {
      return [...adapters.keys()];
    },
    get<TAdapter = unknown>(name: AdapterName): TAdapter | null {
      return (adapters.get(name) as TAdapter | undefined) ?? null;
    },
    require<TAdapter = unknown>(name: AdapterName): TAdapter {
      const adapter = adapters.get(name);
      if (adapter === undefined) {
        throw new Error(`Adapter not registered: ${name}`);
      }
      return adapter as TAdapter;
    },
    register<TAdapter>(name: AdapterName, adapter: TAdapter): void {
      adapters.set(name, adapter);
    },
  };
}

function core(name: CoreAdapterName, capability: string): AdapterContract {
  return {
    name,
    group: "core",
    sourceFile: "src/adapters/interfaces.ts",
    capability,
  };
}

function domain(name: DomainAdapterName, capability: string): AdapterContract {
  return {
    name,
    group: "domain",
    sourceFile: "src/adapters/domains.ts",
    capability,
  };
}

function nativeProfiler(
  name: NativeProfilerAdapterName,
  capability: string,
): AdapterContract {
  return {
    name,
    group: "native-profiler",
    sourceFile: "src/adapters/native-profilers.ts",
    capability,
  };
}

function review(name: ReviewAdapterName, capability: string): AdapterContract {
  return {
    name,
    group: "review",
    sourceFile: "src/adapters/review.ts",
    capability,
  };
}

function adapterSource(
  adapterName: AdapterName,
  packageName: `@expo98/${string}`,
  exportName: string,
  responsibility: string,
): AdapterImplementationSource {
  return { adapterName, packageName, exportName, responsibility };
}

function assertAdapterName(name: string): AdapterName {
  if (getAdapterContract(name) === null) {
    throw new Error(`Unknown adapter contract: ${name}`);
  }
  return name as AdapterName;
}
