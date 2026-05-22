import type { ActionPolicy, PolicyRequest, PolicyDecision } from "./policy.js";
import type { ConfigResolveOptions, ResolvedConfig } from "./config.js";
import type {
  ArtifactRef,
  CommandFailure,
  JsonValue,
  RedactionRule,
  SchemaLike,
} from "./primitives.js";
import type { RunRecord, SessionRecord, SnapshotResult } from "./records.js";

export interface SchemaValidator {
  validate(schema: SchemaLike, value: unknown): ValidationResult;
}

export type ValidationResult =
  | { valid: true; value: JsonValue }
  | { valid: false; error: CommandFailure };

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

export interface EventStream<TEvent extends JsonValue = JsonValue> {
  start(): Promise<EventStreamHandle>;
  read(handle: EventStreamHandle): Promise<TEvent[]>;
  stop(handle: EventStreamHandle): Promise<ArtifactRef>;
}

export type EventStreamHandle = {
  streamId: string;
  artifact: ArtifactRef;
  startedAt: string;
};

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
