import type { ArtifactRef, Availability, JsonValue } from "../contracts/primitives.js";
import type { TargetRecord } from "../contracts/records.js";

export interface NativeProfilerAdapter {
  profilerStart(target: TargetRecord, options: GenericProfilerOptions): Promise<NativeProfileSession>;
  profilerStop(sessionId: string, outputPath?: string): Promise<NativeProfileArtifact>;
  ettraceStart(target: TargetRecord, options: EttraceOptions): Promise<NativeProfileSession>;
  ettraceStop(sessionId: string): Promise<NativeProfileArtifact>;
  memgraphCapture(target: TargetRecord, options: MemgraphOptions): Promise<NativeProfileArtifact>;
  processMemory(target: TargetRecord): Promise<ProcessMemoryResult>;
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
