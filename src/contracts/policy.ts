import type { JsonValue } from "./primitives.js";

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

export type PolicyDecision =
  | { allowed: true; reason?: string }
  | { allowed: false; reason: string; hint?: string };

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

export interface PolicyEngine {
  decide(request: PolicyRequest): PolicyDecision;
}
