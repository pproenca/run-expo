import { basename, join, resolve } from "node:path";

export type StateRootArgs = {
  stateDir?: string | null;
  root?: string | null;
  cwd?: string | null;
};

/**
 * RULE-013: legacy `--state-dir .../runs` points session state at the parent
 * expo state directory; otherwise it is itself the state root.
 */
export function resolveExpoStateRoot(args: StateRootArgs = {}): string {
  if (args.stateDir) {
    const resolved = resolve(args.stateDir);
    return basename(resolved) === "runs" ? resolve(join(resolved, "..")) : resolved;
  }
  const root = resolve(args.root ?? args.cwd ?? process.cwd());
  return join(root, ".scratch", "expo-ios");
}

export function sessionDirectory(stateRoot: string, sessionId: string): string {
  return join(stateRoot, "sessions", sessionId);
}

export function sessionJsonPath(stateRoot: string, sessionId: string): string {
  return join(sessionDirectory(stateRoot, sessionId), "session.json");
}
