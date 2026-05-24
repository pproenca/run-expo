import type { ToolTextResult } from "../../../../core/tool-json-envelope/src/main/index.ts";

export type { ToolTextResult };

export interface RefBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RefRecord {
  ref: string;
  snapshotId?: string;
  targetId?: string;
  stale?: boolean;
  role?: string | null;
  label?: string | null;
  text?: string | null;
  placeholder?: string | null;
  testID?: string | null;
  nativeID?: string | null;
  component?: string | null;
  source?: { file?: string | null } | null;
  box?: RefBox | null;
  actions: string[];
}

export interface RefCache {
  snapshotId?: string | null;
  targetId?: string | null;
  refs: RefRecord[];
}

export interface RefActionDependencies {
  readLatestRefCache(args?: Record<string, unknown>): Promise<RefCache | null>;
  planFinderAction?(args: Record<string, unknown>): Promise<unknown>;
  waitRuntimePredicate?(
    predicate: Extract<WaitPredicate, { kind: "metro-ready" | "app-ready" | "fn" }>,
    args: Record<string, unknown>,
    timing: WaitTiming,
  ): Promise<Record<string, unknown>>;
  now?(): number;
  sleep?(ms: number): Promise<void>;
}

export type WaitPredicate =
  | { kind: "metro-ready" }
  | { kind: "app-ready" }
  | { kind: "fn"; expression: string }
  | { kind: "route"; route: string }
  | { kind: "no-spinner" }
  | { kind: "text"; text: string }
  | { kind: "ref-state"; ref: string; state: string };

export type WaitTiming = {
  started: number;
  timeoutMs: number;
  intervalMs: number;
};

export type WaitEvaluation = {
  matched: boolean;
  final: boolean;
  payload?: Record<string, unknown>;
};
