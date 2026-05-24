export const ROUTE_SEGMENT_KINDS = [
  "static",
  "dynamic",
  "catch-all",
  "optional-catch-all",
  "group",
] as const;

export const SERVICE_METHODS = {
  schemaValidator: ["validate"],
  redactor: ["redactText", "redactJson", "rules"],
  artifactStore: ["reserve", "writeJson", "writeText", "writeBytes", "readJson", "list"],
  runRecordStore: ["start", "finish", "list"],
  snapshotStore: ["write", "read", "latest", "markStale"],
  sessionStore: ["list", "show", "create", "update", "close", "clean"],
  eventStream: ["start", "read", "stop"],
  policyService: ["current", "decide"],
  outputBoundary: ["bound", "wrapUntrustedText"],
  configService: ["resolve"],
} as const;

export type RouteSegmentKind = (typeof ROUTE_SEGMENT_KINDS)[number];

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export type Platform = "ios" | "android";
export type SchemaLike = JsonValue;
export type RedactionRule = {
  name: string;
  pattern?: string;
  replacement?: string;
};

export type ArtifactRef = {
  kind: "json" | "text" | "image" | "video" | "trace" | "profile" | "other";
  path: string;
  description?: string;
};

export type CommandFailure = {
  type: "usage" | "runtime" | "tool-missing" | "unavailable" | "policy-denied" | "unexpected";
  message: string;
  command?: string;
  hint?: string;
  debug?: unknown;
};

export type RouteRecord = {
  route: string;
  file: string;
  segments: RouteSegment[];
};

export type RouteSegment = {
  raw: string;
  kind: RouteSegmentKind;
  name: string;
};

export type CommandPlan = {
  platform: Platform;
  command: string[];
  cwd?: string;
  env?: Record<string, string>;
};

export type ActionEvidence = {
  beforeArtifacts: string[];
  afterArtifacts: string[];
  traceArtifact: string | null;
  summary: JsonValue;
};

export type RunRecord = {
  runId: string;
  status: "running" | "completed" | "failed";
  [key: string]: unknown;
};

export type SessionRecord = {
  sessionId: string;
  [key: string]: unknown;
};

export type SnapshotResult = {
  snapshotId: string;
  [key: string]: unknown;
};

export type ActionCategory =
  | "runtime-eval"
  | "device-mutation"
  | "app-install"
  | "storage-write"
  | "storage-clear"
  | "network-mutation"
  | "file-write"
  | "sidecar-start"
  | "native-profiler";

export type ActionPolicy = {
  maxOutputChars: number;
  contentBoundaries: boolean;
  allowRuntimeEval: boolean;
  confirmActions: ActionCategory[];
  deniedActions: ActionCategory[];
  redactionEnabled: boolean;
};

export type PolicyRequest = {
  category: ActionCategory;
  command: string;
  targetId?: string;
  args: Record<string, JsonValue>;
};

export type PolicyDecision =
  | { allowed: true; reason?: string }
  | { allowed: false; reason: string; hint?: string };

export type ConfigResolveOptions = Record<string, unknown>;
export type ResolvedConfig = Record<string, unknown>;

export type ValidationResult =
  | { valid: true; value: JsonValue }
  | { valid: false; error: CommandFailure };

export interface SchemaValidator {
  validate(schema: SchemaLike, value: unknown): ValidationResult;
}

export interface Redactor {
  redactText(value: string): string;
  redactJson<T extends JsonValue>(value: T): T;
  rules(): RedactionRule[];
}

export interface ArtifactStore {
  reserve(kind: ArtifactRef["kind"], nameHint: string): Promise<ArtifactRef>;
  writeJson(nameHint: string, value: JsonValue): Promise<ArtifactRef>;
  writeText(nameHint: string, value: string): Promise<ArtifactRef>;
  writeBytes(nameHint: string, bytes: Uint8Array, kind: ArtifactRef["kind"]): Promise<ArtifactRef>;
  readJson(path: string): Promise<JsonValue>;
  list(kind?: ArtifactRef["kind"]): Promise<ArtifactRef[]>;
}

export interface RunRecordStore {
  start(record: RunRecord): Promise<RunRecord>;
  finish(record: RunRecord): Promise<RunRecord>;
  list(sessionId?: string): Promise<RunRecord[]>;
}

export interface SnapshotStore {
  write(snapshot: SnapshotResult): Promise<SnapshotResult>;
  read(snapshotId: string): Promise<SnapshotResult | null>;
  latest(sessionId?: string): Promise<SnapshotResult | null>;
  markStale(snapshotId: string, reason: string): Promise<SnapshotResult>;
}

export interface SessionStore {
  list(): Promise<SessionRecord[]>;
  show(nameOrId: string): Promise<SessionRecord | null>;
  create(name?: string): Promise<SessionRecord>;
  update(record: SessionRecord): Promise<SessionRecord>;
  close(nameOrId: string): Promise<SessionRecord>;
  clean(options: { olderThanDays?: number }): Promise<SessionRecord[]>;
}

export type EventStreamHandle = {
  streamId: string;
  artifact: ArtifactRef;
  startedAt: string;
};

export interface EventStream<TEvent extends JsonValue = JsonValue> {
  start(): Promise<EventStreamHandle>;
  read(handle: EventStreamHandle): Promise<TEvent[]>;
  stop(handle: EventStreamHandle): Promise<ArtifactRef>;
}

export interface PolicyService {
  current(): ActionPolicy;
  decide(request: PolicyRequest): PolicyDecision;
}

export interface OutputBoundary {
  bound(value: JsonValue, maxChars: number): JsonValue;
  wrapUntrustedText(value: string): string;
}

export interface ConfigService {
  resolve(options: ConfigResolveOptions): Promise<ResolvedConfig>;
}

export function valid(value: JsonValue): ValidationResult {
  return { valid: true, value };
}

export function invalid(message: string, command?: string): ValidationResult {
  return {
    valid: false,
    error: command === undefined
      ? { type: "usage", message }
      : { type: "usage", message, command },
  };
}

export function createSimpleSchemaValidator(): SchemaValidator {
  return {
    validate(schema, value) {
      if (!isRecord(schema) || typeof schema.type !== "string") {
        return valid(toJsonValue(value));
      }

      if (schema.type === "object") {
        return isPlainObject(value) ? valid(toJsonValue(value)) : invalid("Expected object");
      }
      if (schema.type === "array") {
        return Array.isArray(value) ? valid(toJsonValue(value)) : invalid("Expected array");
      }
      if (schema.type === "string") {
        return typeof value === "string" ? valid(value) : invalid("Expected string");
      }
      if (schema.type === "number") {
        return typeof value === "number" ? valid(value) : invalid("Expected number");
      }
      if (schema.type === "boolean") {
        return typeof value === "boolean" ? valid(value) : invalid("Expected boolean");
      }

      return valid(toJsonValue(value));
    },
  };
}

export function createTruncatingOutputBoundary(): OutputBoundary {
  return {
    bound(value, maxChars) {
      return boundValue(value, maxChars);
    },
    wrapUntrustedText(value) {
      return `<<<${value}>>>`;
    },
  };
}

export function createEventStreamHandle(
  streamId: string,
  path: string,
  startedAt: string,
): EventStreamHandle {
  return {
    streamId,
    artifact: {
      kind: "json",
      path,
    },
    startedAt,
  };
}

function boundValue(value: JsonValue, maxChars: number): JsonValue {
  if (typeof value === "string") {
    return truncate(value, maxChars);
  }
  if (Array.isArray(value)) {
    return value.map((item) => boundValue(item, maxChars));
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, boundValue(item, maxChars)]),
    );
  }
  return value;
}

function truncate(value: string, maxChars: number): string {
  if (maxChars <= 0) {
    return "";
  }
  if (value.length <= maxChars) {
    return value;
  }
  if (maxChars <= 3) {
    return ".".repeat(maxChars);
  }
  return `${value.slice(0, maxChars - 3)}...`;
}

function toJsonValue(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return isRecord(value);
}
