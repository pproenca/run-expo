import { execFile as nodeExecFile } from "node:child_process";

declare const process: { platform: string };

export interface ScreenPoint {
  x: number;
  y: number;
}

export interface WindowBounds extends ScreenPoint {
  width: number;
  height: number;
}

export interface ExecFileOptions {
  timeout: number;
  rejectOnError: false;
  input?: string | null;
}

export interface ExecFileResult {
  stdout: string;
  stderr?: string;
  error?: unknown;
}

export interface MacSimulatorBridgeDependencies {
  platform?: string;
  now?: () => number;
  commandPath: (command: string) => Promise<string | null> | string | null;
  execFilePromise: (file: string, args: string[], options: ExecFileOptions) => Promise<ExecFileResult> | ExecFileResult;
}

interface WindowCache {
  readAt: number;
  value: WindowBounds | null;
}

const defaultDependencies: MacSimulatorBridgeDependencies = {
  platform: typeof process === "undefined" ? "unknown" : process.platform,
  commandPath: defaultCommandPath,
  execFilePromise: defaultExecFilePromise,
};

let simulatorWindowCache: WindowCache = { readAt: 0, value: null };

export async function readMacCursorPosition(
  deps: MacSimulatorBridgeDependencies = defaultDependencies,
): Promise<ScreenPoint | null> {
  const cliclick = await deps.commandPath("cliclick");
  if (!cliclick) return null;
  const result = await deps.execFilePromise(cliclick, ["p"], { timeout: 1500, rejectOnError: false });
  const match = /(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/.exec(result.stdout.trim());
  if (!match) return null;
  return { x: Number(match[1]), y: Number(match[2]) };
}

export async function writeMacClipboard(
  text: string,
  deps: MacSimulatorBridgeDependencies = defaultDependencies,
): Promise<boolean> {
  if ((deps.platform ?? defaultDependencies.platform) !== "darwin" || !text) return false;
  const pbcopy = await deps.commandPath("pbcopy");
  if (!pbcopy) return false;
  const result = await deps.execFilePromise(pbcopy, [], { input: text, timeout: 1500, rejectOnError: false });
  return !result.error;
}

export async function readSimulatorWindowBounds(
  deps: MacSimulatorBridgeDependencies = defaultDependencies,
): Promise<WindowBounds | null> {
  const now = deps.now?.() ?? Date.now();
  if (simulatorWindowCache.value && now - simulatorWindowCache.readAt < 500) {
    return simulatorWindowCache.value;
  }

  const result = await deps.execFilePromise("osascript", ["-e", simulatorWindowBoundsAppleScript()], {
    timeout: 2000,
    rejectOnError: false,
  });
  const values = result.stdout.trim().split(",").map((value) => Number(value.trim()));
  if (values.length !== 4 || values.some((value) => !Number.isFinite(value))) return null;
  const [x, y, width, height] = values as [number, number, number, number];
  simulatorWindowCache = {
    readAt: now,
    value: { x, y, width, height },
  };
  return simulatorWindowCache.value;
}

export function simulatorWindowBoundsAppleScript(): string {
  return [
    'tell application "System Events"',
    '  tell application process "Simulator"',
    '    set windowPosition to position of first window',
    '    set windowSize to size of first window',
    '    return (item 1 of windowPosition as text) & "," & (item 2 of windowPosition as text) & "," & (item 1 of windowSize as text) & "," & (item 2 of windowSize as text)',
    '  end tell',
    'end tell',
  ].join("\n");
}

export function resetSimulatorWindowBoundsCache(): void {
  simulatorWindowCache = { readAt: 0, value: null };
}

async function defaultCommandPath(command: string): Promise<string | null> {
  const result = await defaultExecFilePromise("sh", ["-lc", `command -v ${command}`], {
    timeout: 5000,
    rejectOnError: false,
  });
  return result.stdout.trim() || null;
}

function defaultExecFilePromise(file: string, args: string[], options: ExecFileOptions): Promise<ExecFileResult> {
  return new Promise((resolve) => {
    const child = nodeExecFile(file, args, { timeout: options.timeout }, (error: unknown, stdout: unknown, stderr: unknown) => {
      resolve({
        stdout: String(stdout ?? ""),
        stderr: String(stderr ?? ""),
        error: error ?? null,
      });
    });
    if (options.input !== null && options.input !== undefined) {
      child.stdin?.end(options.input);
    }
  });
}
