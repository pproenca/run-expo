export const MAX_OUTPUT = 40_000;

export type Platform = "ios" | "android";

export type ExecError = {
  message: string;
  code?: number | string | null;
  signal?: string | null;
};

export type ExecResult = {
  stdout?: string | null;
  stderr?: string | null;
  error?: ExecError | null;
};

export type ExecOptions = {
  timeout?: number;
  maxBuffer?: number;
  rejectOnError?: boolean;
  input?: string;
};

export type ExecCall = {
  file: string;
  args: string[];
  options: ExecOptions;
};

export type IosDevice = {
  udid: string;
  name?: string;
  state?: string;
  runtime?: string;
  isAvailable?: boolean;
};

export type ActionPolicyDecision = {
  checked: true;
  action: string;
  sideEffect: "read" | "device" | "write" | "runtime-eval";
  allowed: boolean;
  source: string | null;
  reason: string;
};

export type RefBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type RefRecord = {
  ref: string;
  targetId?: string;
  stale?: boolean;
  role?: string;
  label?: string;
  text?: string;
  box?: RefBox;
  actions?: string[];
};

export type RefCache = {
  refs: RefRecord[];
};

export type ToolTextResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

export type GesturePlan = {
  tool: string;
  command: string[];
  repeat: number;
  intervalMs: number;
  notes: string[];
};

export type InteractionDependencies = {
  commandPath(command: string): Promise<string | null>;
  execFile(file: string, args: string[], options: ExecOptions): Promise<ExecResult>;
  resolveIosDevice(requested: string | undefined, options: { preferBooted: true }): Promise<IosDevice>;
  planRefAction(args: Record<string, unknown>): Promise<Record<string, unknown>>;
  readRefRecord(ref: unknown, args: Record<string, unknown>): Promise<Record<string, unknown>>;
  refPoint(ref: unknown, args: Record<string, unknown>): Promise<Record<string, unknown>>;
  scrollPlan(args: Record<string, unknown>): Promise<Record<string, unknown>>;
  policyDecision(args: Record<string, unknown>, action: string, sideEffect: "device"): Promise<ActionPolicyDecision>;
  captureScreenshot(args: Record<string, unknown>): Promise<ToolTextResult | Record<string, unknown>>;
  traceInteraction(args: Record<string, unknown>): Promise<ToolTextResult | Record<string, unknown>>;
  wait(ms: number): Promise<void>;
  now(): Date;
  tmpdir(): string;
  mkdir(path: string, options: { recursive: true }): Promise<unknown>;
  joinPath(...parts: string[]): string;
};

export type RefActionAdapterDependencies = {
  readLatestRefCache(args?: Record<string, unknown>): Promise<{ refs: RefRecord[] } | null>;
};

export type RefActionModule = {
  planRefAction(args: Record<string, unknown>, deps: RefActionAdapterDependencies): Promise<Record<string, unknown>>;
  refPoint(ref: unknown, deps: RefActionAdapterDependencies): Promise<Record<string, unknown>>;
  scrollPlan(args: Record<string, unknown>, deps: RefActionAdapterDependencies): Promise<Record<string, unknown>>;
};

export type InteractionArgs = Record<string, unknown>;
export type InteractionPayload = Record<string, unknown>;
