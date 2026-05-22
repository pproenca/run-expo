import type { ActionCategory } from "./policy.js";
import type { JsonValue, Platform, SnapshotRef } from "./primitives.js";

export type CwdArgs = {
  cwd?: string;
};

export type InstallArgs = {
  checkOnly?: boolean;
  fix?: boolean;
};

export type UpgradeArgs = {
  version?: string;
  dryRun?: boolean;
};

export type DoctorArgs = CwdArgs;

export type ProjectInfoArgs = CwdArgs;

export type RoutesArgs = CwdArgs & {
  appDir?: string;
};

export type DevicesArgs = {
  platform?: Platform | "all";
  limit?: number;
};

export type BootSimulatorArgs = {
  device?: string;
  openSimulator?: boolean;
};

export type OpenUrlArgs = {
  platform?: Platform;
  device?: string;
  url: string;
};

export type OpenRouteArgs = CwdArgs & {
  device?: string;
  url?: string;
  scheme?: string;
  route?: string;
  query?: string;
  authCookie?: string;
};

export type LaunchAppArgs = {
  platform?: Platform;
  device?: string;
  bundleId?: string;
  packageName?: string;
  activity?: string;
};

export type AppLifecycleArgs =
  | { action: "terminate"; platform?: Platform; device?: string; bundleId?: string; packageName?: string }
  | { action: "reload"; targetId?: string; metroPort?: number }
  | { action: "open-dev-menu"; device?: string }
  | { action: "install"; path: string; device?: string }
  | { action: "uninstall"; bundleId?: string; packageName?: string; device?: string };

export type LogsArgs = {
  platform?: Platform;
  device?: string;
  last?: string;
  lines?: number;
  bundleId?: string;
  processName?: string;
  predicate?: string;
};

export type TapArgs = {
  platform?: Platform;
  device?: string;
  x: number;
  y: number;
};

export type GestureArgs = {
  platform?: Platform;
  device?: string;
  gesture: "tap" | "long-press" | "tap-and-hold" | "drag" | "swipe";
  x?: number;
  y?: number;
  startX?: number;
  startY?: number;
  endX?: number;
  endY?: number;
  durationMs?: number;
  holdMs?: number;
  repeat?: number;
  intervalMs?: number;
  dryRun?: boolean;
  captureBeforeAfter?: boolean;
  outputDir?: string;
  includeTrace?: boolean;
  cwd?: string;
  metroPort?: number;
  componentFilter?: string;
  maxEvents?: number;
};

export type UxContextArgs = CwdArgs & {
  device?: string;
  bundleId?: string;
  processName?: string;
  metroPort?: number;
  outputPath?: string;
  includeScreenshot?: boolean;
  includeImageAnalysis?: boolean;
  includeHierarchy?: boolean;
  includeRuntime?: boolean;
  includeComponents?: boolean;
  componentFilter?: string;
  includeLogs?: boolean;
  logsLast?: string;
};

export type InspectorArgs = CwdArgs & {
  device?: string;
  metroPort?: number;
  action?: "probe" | "toggle" | "install-comment-menu" | "read-comments" | "clear-comments" | "open-dev-menu";
  commentTitle?: string;
  maxComments?: number;
};

export type TraceArgs = CwdArgs & {
  metroPort?: number;
  action: "start" | "read" | "stop" | "clear";
  componentFilter?: string;
  maxEvents?: number;
  includeEvents?: boolean;
};

export type AnnotateScreenArgs = CwdArgs & {
  device?: string;
  bundleId?: string;
  metroPort?: number;
  screenshotPath?: string;
  outputDir?: string;
  title?: string;
  serve?: boolean;
  port?: number;
  includeUxContext?: boolean;
};

export type ReviewOverlayArgs = CwdArgs & {
  action?: "prepare" | "scaffold" | "server" | "read" | "clear";
  outputDir?: string;
  overlayDir?: string;
  endpointPath?: string;
  metroPort?: number;
  title?: string;
  port?: number;
  serve?: boolean;
  force?: boolean;
};

export type ReviewNextArgs = CwdArgs & {
  surface?: "calendar" | "timeline" | "form" | "list" | "navigation" | "editor" | "generic";
  stage?: "intake" | "pre-patch" | "post-patch" | "verifier-failed" | "interaction" | "handoff";
  issue?: string;
  componentFilter?: string;
  metroPort?: number;
  verifierRule?: string;
  hasAcceptanceContract?: boolean;
  hasScreenshot?: boolean;
  hasInteractionProof?: boolean;
  hasStaticVerifier?: boolean;
  changedGesture?: boolean;
  changedChrome?: boolean;
  changedNavigation?: boolean;
  addedVisibleControls?: boolean;
};

export type ReviewArgs =
  | { action: "report"; sessionId?: string; outputPath?: string }
  | { action: "matrix"; sessionId?: string; acceptancePath?: string; outputPath?: string };

export type SessionArgs =
  | { action: "list" }
  | { action: "show"; nameOrId?: string }
  | { action: "new"; name?: string }
  | { action: "close"; nameOrId?: string }
  | { action: "clean"; olderThanDays?: number };

export type TargetArgs =
  | { action: "list"; platform?: Platform | "all"; limit?: number }
  | { action: "select"; targetId: string }
  | { action: "current" };

export type SnapshotArgs = {
  targetId?: string;
  interactive?: boolean;
  compact?: boolean;
  depth?: number;
  source?: boolean;
  bounds?: boolean;
  metroPort?: number;
  testid?: boolean;
};

export type RefGetArgs = {
  ref: SnapshotRef;
  field: "text" | "props" | "box" | "style" | "source";
};

export type FindArgs = {
  kind: "role" | "text" | "label" | "placeholder" | "testid" | "source" | "first" | "last" | "nth";
  value: string;
  name?: string;
  index?: number;
  exact?: boolean;
  action?: RefActionArgs;
};

export type RefActionArgs =
  | { action: "tap" | "long-press" | "focus" | "scroll-into-view"; ref: SnapshotRef }
  | { action: "dbltap" | "blur" | "check" | "uncheck"; ref: SnapshotRef }
  | { action: "fill"; ref: SnapshotRef; value: string }
  | { action: "type"; value: string }
  | { action: "select"; ref: SnapshotRef; value: string }
  | { action: "drag"; sourceRef: SnapshotRef; targetRef: SnapshotRef }
  | { action: "press"; key: string }
  | { action: "keyboard"; input: "type" | "press"; value: string }
  | { action: "scroll"; ref?: SnapshotRef; direction: "up" | "down" | "left" | "right"; distance: number };

export type WaitArgs =
  | { kind: "time"; ms: number }
  | { kind: "ref"; ref: SnapshotRef; state: "visible" | "hidden" | "enabled" | "disabled"; timeoutMs?: number }
  | { kind: "text"; text: string; timeoutMs?: number }
  | { kind: "route"; route: string; timeoutMs?: number }
  | { kind: "metro-ready"; timeoutMs?: number }
  | { kind: "app-ready"; timeoutMs?: number }
  | { kind: "fn"; expression: string; timeoutMs?: number };

export type BatchArgs = {
  steps: BatchStep[];
  bail: boolean;
};

export type BatchStep = {
  command: string;
  args: Record<string, JsonValue>;
};

export type ScreenshotArgs = {
  outputPath?: string;
  annotate?: boolean;
  full?: boolean;
  snapshotId?: string;
};

export type DevToolsArgs =
  | { action: "status" | "open" | "panels" | "capabilities" }
  | { action: "events"; eventAction: "start" | "read" | "stop" };

export type PerfArgs =
  | { action: "summary" }
  | { action: "startup"; route?: string; samples?: number; coldStart?: boolean }
  | { action: "action"; name: string; steps: BatchStep[]; capture?: string[] }
  | { action: "bundle"; build?: "dev" | "preview" | "release"; existingArtifact?: string; runExport?: boolean }
  | { action: "mark-list" | "mark-clear" }
  | { action: "measure-start" | "measure-stop"; name: string }
  | { action: "compare"; baseline: string; candidate: string }
  | { action: "budget-check"; file: string }
  | { action: "startup-modules"; outputDir?: string }
  | { action: "js-thread" | "frames" | "memory"; samples?: number }
  | { action: "ettrace-start" | "ettrace-stop"; sessionId?: string; outputDir?: string }
  | { action: "memgraph-capture"; outputPath?: string; note?: string };

export type SkillsArgs =
  | { action: "list" }
  | { action: "get"; name: string };

export type ClipboardArgs =
  | { action: "read" | "paste" }
  | { action: "write"; text: string };

export type EnvironmentSetArgs =
  | { category: "appearance"; value: "dark" | "light" }
  | { category: "content-size"; value: string }
  | { category: "locale"; value: string }
  | { category: "timezone"; value: string }
  | { category: "location"; latitude: number; longitude: number }
  | { category: "network"; value: "online" | "offline" }
  | { category: "permissions"; permission: string; value: "granted" | "denied" | "unset" }
  | { category: "orientation"; value: "portrait" | "landscape-left" | "landscape-right" }
  | { category: "keyboard"; value: "software" | "hardware" };

export type NetworkArgs =
  | { action: "status" | "clear" }
  | { action: "requests"; since?: string; limit?: number; includeBodies?: boolean }
  | { action: "request"; requestId: string }
  | { action: "har-start" | "har-stop"; outputPath?: string };

export type NavigationArgs =
  | { action: "state" }
  | { action: "back" | "pop-to-root"; actionPolicy?: string }
  | { action: "tab"; tab: string | number; actionPolicy?: string }
  | { action: "deep-link"; route: string; query?: string };

export type StorageArgs =
  | { action: "list"; store: "async" | "mmkv" | "secure-store" | "sqlite" }
  | { action: "get"; store: "async" | "mmkv" | "secure-store" | "sqlite"; key: string }
  | { action: "set"; store: "async" | "mmkv" | "secure-store" | "sqlite"; key: string; value: JsonValue }
  | { action: "clear"; store: "async" | "mmkv" | "secure-store" | "sqlite"; keyPrefix?: string; allowAll?: boolean }
  | { action: "trace"; since?: string; limit?: number };

export type StateArgs =
  | { action: "save"; name: string }
  | { action: "load"; name: string }
  | { action: "list" }
  | { action: "clear"; name: string };

export type ControlsArgs =
  | { action: "list" }
  | { action: "get" | "press"; name: string }
  | { action: "set"; name: string; value: JsonValue };

export type BridgeArgs =
  | { action: "status" | "plan"; cwd?: string }
  | { action: "health"; cwd?: string; metroPort?: number }
  | { action: "domains"; cwd?: string; metroPort?: number; domain?: string; command?: string; actionPolicy?: string }
  | { action: "install" | "remove"; cwd?: string; confirmActions?: string };

export type RnArgs =
  | { action: "tree"; depth?: number; source?: boolean }
  | { action: "inspect"; ref: SnapshotRef }
  | { action: "renders-start" | "renders-stop" }
  | { action: "fiber"; ref: SnapshotRef };

export type ExpoArgs =
  | { action: "modules" | "config" | "doctor" | "upstream-policy" | "prebuild-plan"; cwd?: string };

export type DiffArgs =
  | { action: "snapshot"; before: string; after: string }
  | { action: "screenshot"; beforePath: string; afterPath: string }
  | { action: "route"; beforeRoute: string; afterRoute: string };

export type RecordArgs =
  | { action: "start"; kind?: "video" | "trace"; outputPath?: string }
  | { action: "stop"; outputPath?: string }
  | { action: "status" };

export type AccessibilityArgs =
  | { action: "tree" | "audit"; metroPort?: number }
  | { action: "inspect" | "focus"; ref: SnapshotRef };

export type DialogArgs =
  | { action: "status" | "dismiss" }
  | { action: "accept"; text?: string };

export type SheetArgs =
  | { action: "status" | "dismiss" };

export type DashboardArgs =
  | { action: "start"; port?: number; sessionId?: string }
  | { action: "stop" | "status" };

export type ProfilerArgs =
  | { action: "start"; kind?: "react" | "hermes" | "native"; outputDir?: string }
  | { action: "stop"; sessionId?: string; outputPath?: string };

export type InspectArgs = {
  ref: SnapshotRef;
  includeProps?: boolean;
  includeSource?: boolean;
  includeLogs?: boolean;
};

export type HighlightArgs = {
  ref: SnapshotRef;
  durationMs?: number;
};

export type InstrumentationArgs =
  | { action: "status" | "manifest" }
  | { action: "install"; cwd: string; force?: boolean }
  | { action: "remove"; cwd: string }
  | { action: "call"; domain: string; tool: string; args?: Record<string, JsonValue> };

export type PolicyArgs =
  | { action: "show" }
  | { action: "check"; category: ActionCategory; command: string; args?: Record<string, JsonValue> }
  | { action: "redact"; file: string };

export type CommandArgsByName = {
  install: InstallArgs;
  upgrade: UpgradeArgs;
  doctor: DoctorArgs;
  "project-info": ProjectInfoArgs;
  routes: RoutesArgs;
  devices: DevicesArgs;
  "boot-simulator": BootSimulatorArgs;
  "open-url": OpenUrlArgs;
  "open-route": OpenRouteArgs;
  "launch-app": LaunchAppArgs;
  "terminate-app": Extract<AppLifecycleArgs, { action: "terminate" }>;
  "reload-app": Extract<AppLifecycleArgs, { action: "reload" }>;
  "open-dev-menu": Extract<AppLifecycleArgs, { action: "open-dev-menu" }>;
  "install-app": Extract<AppLifecycleArgs, { action: "install" }>;
  "uninstall-app": Extract<AppLifecycleArgs, { action: "uninstall" }>;
  screenshot: ScreenshotArgs;
  tap: TapArgs;
  "long-press": RefActionArgs;
  dbltap: RefActionArgs;
  fill: RefActionArgs;
  type: RefActionArgs;
  focus: RefActionArgs;
  blur: RefActionArgs;
  press: RefActionArgs;
  keyboard: RefActionArgs;
  select: RefActionArgs;
  check: RefActionArgs;
  uncheck: RefActionArgs;
  scroll: RefActionArgs;
  "scroll-into-view": RefActionArgs;
  drag: RefActionArgs;
  gesture: GestureArgs;
  logs: LogsArgs;
  "ux-context": UxContextArgs;
  inspector: InspectorArgs;
  trace: TraceArgs;
  "annotate-screen": AnnotateScreenArgs;
  "review-overlay": ReviewOverlayArgs;
  "review-next": ReviewNextArgs;
  review: ReviewArgs;
  session: SessionArgs;
  target: TargetArgs;
  snapshot: SnapshotArgs;
  refs: { snapshotId?: string };
  get: RefGetArgs;
  find: FindArgs;
  wait: WaitArgs;
  batch: BatchArgs;
  devtools: DevToolsArgs;
  console: { since?: string; limit?: number; clear?: boolean };
  errors: { since?: string; limit?: number; clear?: boolean };
  metro: { action: "status" | "reload" | "symbolicate"; port?: number; stack?: string };
  perf: PerfArgs;
  skills: SkillsArgs;
  clipboard: ClipboardArgs;
  set: EnvironmentSetArgs;
  network: NetworkArgs;
  navigation: NavigationArgs;
  storage: StorageArgs;
  state: StateArgs;
  controls: ControlsArgs;
  bridge: BridgeArgs;
  rn: RnArgs;
  expo: ExpoArgs;
  diff: DiffArgs;
  record: RecordArgs;
  accessibility: AccessibilityArgs;
  dialog: DialogArgs;
  sheet: SheetArgs;
  profiler: ProfilerArgs;
  inspect: InspectArgs;
  highlight: HighlightArgs;
  instrumentation: InstrumentationArgs;
  dashboard: DashboardArgs;
  policy: PolicyArgs;
  redact: Extract<PolicyArgs, { action: "redact" }>;
};
