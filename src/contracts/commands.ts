import type {
  ActionCategory,
  ActionPolicy,
  PolicyDecision,
} from "./policy.js";
import type {
  ArtifactRef,
  CommandOutcome,
  JsonValue,
  SchemaLike,
} from "./primitives.js";
import type { SessionRecord, TargetRecord } from "./records.js";
import type {
  ArtifactStore,
  OutputBoundary,
  Redactor,
  RunRecordStore,
  SchemaValidator,
  ConfigService,
  SessionStore,
  SnapshotStore,
} from "./services.js";

export type CommandName =
  | "install"
  | "upgrade"
  | "doctor"
  | "project-info"
  | "routes"
  | "devices"
  | "boot-simulator"
  | "open-url"
  | "open-route"
  | "launch-app"
  | "terminate-app"
  | "reload-app"
  | "open-dev-menu"
  | "install-app"
  | "uninstall-app"
  | "screenshot"
  | "tap"
  | "long-press"
  | "dbltap"
  | "fill"
  | "type"
  | "focus"
  | "blur"
  | "press"
  | "keyboard"
  | "select"
  | "check"
  | "uncheck"
  | "scroll"
  | "scroll-into-view"
  | "drag"
  | "gesture"
  | "logs"
  | "ux-context"
  | "inspector"
  | "trace"
  | "annotate-screen"
  | "review-overlay"
  | "review-next"
  | "review"
  | "session"
  | "target"
  | "snapshot"
  | "refs"
  | "get"
  | "find"
  | "wait"
  | "batch"
  | "devtools"
  | "console"
  | "errors"
  | "metro"
  | "perf"
  | "skills"
  | "clipboard"
  | "set"
  | "network"
  | "navigation"
  | "storage"
  | "state"
  | "controls"
  | "bridge"
  | "rn"
  | "expo"
  | "diff"
  | "record"
  | "accessibility"
  | "dialog"
  | "sheet"
  | "profiler"
  | "inspect"
  | "highlight"
  | "instrumentation"
  | "dashboard"
  | "policy"
  | "redact";

export type CommandEffect = "read" | "write" | "device" | "runtime" | "sidecar";

export type CommandDefinition<TArgs, TResult> = {
  name: CommandName;
  summary: string;
  inputSchema: SchemaLike;
  effects: CommandEffect[];
  actionCategories: ActionCategory[];
  examples: string[];
  createHandler(dependencies: CommandDependencies): CommandHandler<TArgs, TResult>;
};

export interface CommandHandler<TArgs, TResult> {
  run(args: TArgs, context: CommandContext): Promise<CommandOutcome<TResult>>;
}

export type CommandContext = {
  cwd: string;
  globals: GlobalOptions;
  session: SessionRecord | null;
  target: TargetRecord | null;
  policy: ActionPolicy;
  artifacts: ArtifactSink;
};

export type GlobalOptions = {
  json: boolean;
  plain: boolean;
  quiet: boolean;
  debug: boolean;
  root: string | null;
  stateDir: string | null;
  record: boolean;
  maxOutputChars: number | null;
  contentBoundaries: boolean;
  allowRuntimeEval: boolean;
  actionPolicyPath: string | null;
};

export interface CommandDependencies {
  adapters: AdapterRegistry;
  schemaValidator: SchemaValidator;
  config: ConfigService;
  policy: {
    decide(category: ActionCategory, args: Record<string, JsonValue>): PolicyDecision;
  };
  redactor: Redactor;
  outputBoundary: OutputBoundary;
  artifacts: ArtifactStore;
  runRecords: RunRecordStore;
  sessions: SessionStore;
  snapshots: SnapshotStore;
}

export interface AdapterRegistry {
  [adapterName: string]: unknown;
}

export interface ArtifactSink {
  reserve(kind: ArtifactRef["kind"], nameHint: string): Promise<ArtifactRef>;
  writeJson(nameHint: string, value: JsonValue): Promise<ArtifactRef>;
  writeText(nameHint: string, value: string): Promise<ArtifactRef>;
}
