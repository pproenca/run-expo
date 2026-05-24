import type { ToolTextResult } from "../../../../core/tool-json-envelope/src/main/index.ts";

export type { ToolTextResult };

export const EXPO_IOS_BRIDGE_VERSION = "1.0.0";

export const PERF_ACTIONS = ["summary", "startup", "action", "bundle", "mark", "measure", "compare", "budget", "js-thread", "frames", "memory", "ettrace", "memgraph", "interaction", "report"];

export interface PerfDependencies {
  normalizeProjectCwd?: (cwd: unknown, options: { allowMissingPackageJson: true }) => Promise<string> | string;
  expoProjectRuntimeSummary?: (cwd: string) => Promise<Record<string, any>> | Record<string, any>;
  metroStatusPayload?: (args: { metroPort: number }) => Promise<Record<string, any>> | Record<string, any>;
  metroTargets?: (metroPort: number) => Promise<Array<Record<string, any>>> | Array<Record<string, any>>;
  evaluateHermesExpression?: (url: string, expression: string, options: { timeoutMs: number }) => Promise<Record<string, any>> | Record<string, any>;
  findUp?: (cwd: string, name: string) => Promise<string | null> | string | null;
  readJsonFile?: (file: string) => Promise<any> | any;
  writeFile?: (file: string, data: string, encoding: "utf8") => Promise<void> | void;
  mkdir?: (path: string, options: { recursive: true }) => Promise<void> | void;
  pathExists?: (path: string) => Promise<boolean> | boolean;
  stat?: (path: string) => Promise<{ isFile(): boolean; size: number } | null> | { isFile(): boolean; size: number } | null;
  now?: () => Date;
}

export interface StateRootArgs extends Record<string, unknown> {
  stateDir?: string | null;
  root?: string | null;
  cwd?: string | null;
}
