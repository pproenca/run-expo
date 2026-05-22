import type { JsonValue, Platform } from "./primitives.js";

export type RouteRecord = {
  route: string;
  file: string;
  segments: RouteSegment[];
};

export type RouteSegment = {
  raw: string;
  kind: "static" | "dynamic" | "catch-all" | "optional-catch-all" | "group";
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
