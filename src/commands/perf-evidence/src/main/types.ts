import type { ToolTextResult } from "../../../../core/tool-json-envelope/src/main/index.ts";

export type { ToolTextResult };

export const EXPO98_BRIDGE_VERSION = "1.0.0";

export const PERF_ACTIONS = [
  "summary",
  "startup",
  "action",
  "bundle",
  "mark",
  "measure",
  "compare",
  "budget",
  "js-thread",
  "frames",
  "memory",
  "ettrace",
  "memgraph",
  "interaction",
  "report",
];

export interface PerfDependencies {
  normalizeProjectCwd?: (
    cwd: unknown,
    options: { allowMissingPackageJson: true },
  ) => Promise<string> | string;
  expoProjectRuntimeSummary?: (cwd: string) => Promise<PerfProjectSummary> | PerfProjectSummary;
  metroStatusPayload?: (args: { metroPort: number }) => Promise<PerfMetroStatus> | PerfMetroStatus;
  metroTargets?: (metroPort: number) => Promise<PerfMetroTarget[]> | PerfMetroTarget[];
  evaluateHermesExpression?: (
    url: string,
    expression: string,
    options: { timeoutMs: number },
  ) => Promise<PerfHermesEvaluation> | PerfHermesEvaluation;
  findUp?: (cwd: string, name: string) => Promise<string | null> | string | null;
  readJsonFile?: (file: string) => Promise<unknown> | unknown;
  writeFile?: (file: string, data: string, encoding: "utf8") => Promise<void> | void;
  mkdir?: (path: string, options: { recursive: true }) => Promise<void> | void;
  pathExists?: (path: string) => Promise<boolean> | boolean;
  stat?: (path: string) => Promise<PerfFileStat | null> | PerfFileStat | null;
  now?: () => Date;
}

export interface PerfProjectSummary extends Record<string, unknown> {
  projectRoot: string;
}

export interface PerfMetroTarget extends Record<string, unknown> {
  id?: string | null;
  deviceName?: string | null;
  webSocketDebuggerUrl?: string | null;
  capabilities?: Record<string, unknown>;
}

export interface PerfMetroStatus extends Record<string, unknown> {
  available: boolean;
  metroPort?: number;
  targetCount?: number;
  reason?: string | null;
  targets?: PerfMetroTarget[];
}

export interface PerfHermesEvaluation extends Record<string, unknown> {
  result?: { result?: { value?: unknown }; exceptionDetails?: unknown };
  diagnostics?: unknown;
  cdp?: unknown;
  error?: unknown;
}

export interface PerfFileStat {
  isFile(): boolean;
  size: number;
}

export interface PerfExecResult {
  stdout: string;
  stderr: string;
  error: null | { message: string; code?: number | string | null; signal?: string | null };
}

export interface StateRootArgs extends Record<string, unknown> {
  stateDir?: string | null;
  root?: string | null;
  cwd?: string | null;
}

export type PerfConfidence = "low" | "medium" | "high";

export interface PerfArgs extends StateRootArgs {
  action?: unknown;
  subaction?: unknown;
  label?: unknown;
  interaction?: unknown;
  bundleArtifact?: unknown;
  baseline?: unknown;
  candidate?: unknown;
  file?: unknown;
  nativeArtifact?: unknown;
  outputPath?: unknown;
  buildKind?: unknown;
  samples?: unknown;
  seconds?: unknown;
  pid?: unknown;
  metroPort?: unknown;
  platform?: unknown;
  [key: string]: unknown;
}

export interface PerfMetric {
  name: string;
  value: unknown;
  unit: string | null;
  source: string;
  confidence: PerfConfidence;
}

export interface PerfPayload extends Record<string, unknown> {
  available?: boolean;
  action?: string;
  metrics?: PerfMetric[];
  confidence?: PerfConfidence;
  limitations?: string[];
}

export interface PerfRuntimePayload extends Record<string, unknown> {
  network?: { requests?: PerfNetworkRequest[] };
  renders?: { commits?: PerfRenderCommit[] };
  frames?: {
    samples?: PerfFrameSample[];
    droppedFrameCount?: number;
    worstFrameMs?: number | null;
  };
}

export interface PerfNetworkRequest extends Record<string, unknown> {
  method?: string;
  url?: string;
  status?: number | null;
  durationMs?: number | null;
}

export interface PerfRenderCommit extends Record<string, unknown> {
  durationMs?: number | null;
  actualDuration?: number | null;
}

export interface PerfFrameSample extends Record<string, unknown> {
  deltaMs?: number | null;
}

export interface PerfNativeSummary extends Record<string, unknown> {
  available?: boolean;
  bytes?: number;
  physicalFootprintMb?: number | null;
  peakFootprintMb?: number | null;
  buckets?: Record<string, unknown>;
}

export interface PerfFinding {
  type: string;
  severity: "info" | "medium" | "high";
  summary: string;
  evidence?: unknown;
}

export interface PerfReport extends PerfPayload {
  available: boolean;
  sources: string[];
  runtime: PerfRuntimePayload | null;
  findings: PerfFinding[];
  metrics: PerfMetric[];
  confidence: PerfConfidence;
  limitations: string[];
}

export interface PerfBudgetRule {
  metric: string;
  min?: number | null;
  max?: number | null;
}

export interface PerfBudgetArtifact extends Record<string, unknown> {
  budgets?: PerfBudgetRule[];
}

export interface PerfBudgetCheck {
  metric: string;
  value: number | null;
  min: number | null;
  max: number | null;
  passed: boolean;
  unit: string | null;
}

export interface PerfComparisonDelta {
  metric: string;
  baseline: number;
  candidate: number;
  delta: number;
  unit: string | null;
  improved: boolean;
  confidence: PerfConfidence;
}
