export type JsonPrimitive = string | number | boolean | null;

export type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | { [key: string]: JsonValue };

export type JsonObject = { [key: string]: JsonValue };

export type Platform = "ios" | "android";

export type Availability =
  | { available: true }
  | {
      available: false;
      reason: string;
      hint?: string;
    };

export type SourceConfidence = "high" | "medium" | "low";

export type BuildContext =
  | "expo-go"
  | "dev-build"
  | "preview"
  | "release-export"
  | "unknown";

export type CommandExitCode = 0 | 1 | 2;

export type CommandFailureType =
  | "usage"
  | "runtime"
  | "tool-missing"
  | "unavailable"
  | "policy-denied"
  | "unexpected";

export type CommandFailure = {
  type: CommandFailureType;
  message: string;
  command?: string;
  hint?: string;
  debug?: JsonValue;
};

export type CommandOutcome<T> =
  | { ok: true; data: T; warnings?: CommandWarning[] }
  | { ok: false; error: CommandFailure; warnings?: CommandWarning[] };

export type CommandWarning = {
  code: string;
  message: string;
  source?: string;
};

export type ArtifactRef = {
  kind:
    | "json"
    | "png"
    | "jpeg"
    | "text"
    | "har"
    | "trace"
    | "video"
    | "memgraph"
    | "directory";
  path: string;
  description?: string;
  bytes?: number;
};

export type TimeRange = {
  startedAt: string;
  finishedAt: string | null;
  durationMs?: number;
};

export type SchemaLike = {
  type: string;
  properties?: Record<string, SchemaLike>;
  items?: SchemaLike;
  required?: string[];
  enum?: string[];
  description?: string;
  additionalProperties?: boolean;
};

export type RedactionRule = {
  kind: "query-key" | "header-key" | "body-key" | "regex";
  pattern: string;
  replacement?: string;
};

export type SnapshotRef = `@e${number}`;
