import type {
  ArtifactRef,
  Availability,
  BuildContext,
  Platform,
  SourceConfidence,
} from "./primitives.js";
import type {
  DeviceSummary,
  RefRecord,
  TargetRecord,
} from "./records.js";
import type { RouteRecord } from "./shared.js";

export type DoctorResult = {
  cli: { name: "expo-ios"; version: string };
  cwd: string;
  auth: { required: false; source: "not-required" };
  commands: Record<string, string | null>;
  capabilities: {
    iosSimulator: boolean;
    androidDevice: boolean;
    screenshots: boolean;
    taps: boolean;
    gestures: boolean;
    accessibilityHierarchy: boolean;
    metroRuntime: boolean;
  };
  project: ProjectInfoResult | null;
};

export type ProjectInfoResult = {
  projectRoot: string;
  packageManager: "npm" | "yarn" | "pnpm" | "bun" | "unknown";
  expoDependency: string | null;
  reactNativeDependency: string | null;
  expoRouterDependency: string | null;
  scripts: Record<string, string>;
  appConfig: AppConfigSummary | null;
};

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

export type UxContextResult = {
  runId?: string;
  cwd: string;
  device: DeviceSummary | null;
  screenshot: {
    path: string | null;
    width: number | null;
    height: number | null;
    analysis: unknown | null;
  };
  routeContext: {
    routes: RouteRecord[];
    currentRouteHint: string | null;
  } | null;
  accessibility: Availability & {
    hierarchy?: unknown;
    error?: string;
  };
  runtime: Availability & {
    metro?: MetroSummary | null;
    hermes?: HermesSummary | null;
    componentHierarchy?: unknown | null;
    error?: string;
  };
  logs: {
    included: boolean;
    excerpt: string | null;
    artifactPath: string | null;
  };
};

export type MetroSummary = {
  port: number;
  status: string;
  targetCount: number;
  targets: TargetRecord[];
};

export type HermesSummary = {
  available: boolean;
  heap?: unknown;
  globals?: unknown;
  limitations: string[];
};

export type DevToolsCapability = {
  name: string;
  source:
    | "metro"
    | "hermes"
    | "react-devtools-hook"
    | "react-native-devtools"
    | "app-instrumentation"
    | "simulator"
    | "native-profiler";
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
  unit: "ms" | "bytes" | "count" | "fps" | "percent";
  source:
    | "expo-atlas"
    | "metro"
    | "hermes"
    | "react-devtools-hook"
    | "app-performance-mark"
    | "simulator"
    | "xctrace"
    | "memgraph";
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
