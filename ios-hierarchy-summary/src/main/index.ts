import { execFile } from "node:child_process";

declare const process: { cwd(): string; env: Record<string, string | undefined> };

export interface ExecResult {
  stdout: string;
  stderr: string;
  error: { message?: string; code?: unknown; signal?: unknown } | null;
}

export interface ExecOptions {
  timeout: number;
  maxBuffer: number;
  rejectOnError: boolean;
}

export interface IosHierarchyDependencies {
  commandPath?: (command: string) => Promise<string | null> | string | null;
  execFilePromise?: (file: string, args: string[], options: ExecOptions) => Promise<ExecResult> | ExecResult;
}

export interface HierarchyFrame {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface HierarchyLabel {
  label: unknown;
  role: string;
  frame: unknown;
}

export interface HierarchySummary {
  available: true;
  totalElements: number;
  maxDepth: number;
  emptyApplicationOnly: boolean;
  nonZeroFrames: number;
  contentBounds: HierarchyFrame | null;
  roles: Record<string, number>;
  sampleLabels: HierarchyLabel[];
  insight: string;
}

const MAX_OUTPUT = 16_384;
const EMPTY_APP_INSIGHT =
  "Visible UI may exist, but the simulator hierarchy only exposes the app shell. Use screenshot, source, Metro runtime, and coordinate interactions for UX review.";
const HIERARCHY_INSIGHT = "Hierarchy can help compare visible composition with semantic/structural UI frames.";

export async function describeIosHierarchy(
  udid: string,
  dependencies: IosHierarchyDependencies = {},
): Promise<HierarchySummary | { available: false; reason: string } | { available: false; error: unknown; stderr: string; stdout: string }> {
  const commandLocator = dependencies.commandPath ?? commandPath;
  const axe = await commandLocator("axe");
  if (!axe) {
    return { available: false, reason: "axe CLI is not installed or not on PATH." };
  }

  const run = dependencies.execFilePromise ?? execFilePromise;
  const result = await run(axe, ["describe-ui", "--udid", udid], {
    timeout: 12_000,
    maxBuffer: 4 * 1024 * 1024,
    rejectOnError: false,
  });
  if (result.error) {
    return {
      available: false,
      error: result.error,
      stderr: truncate(result.stderr),
      stdout: truncate(result.stdout),
    };
  }

  const tree = JSON.parse(result.stdout || "[]");
  return summarizeHierarchy(tree);
}

export function summarizeHierarchy(tree: unknown): HierarchySummary {
  const roots = Array.isArray(tree) ? tree : [tree];
  const roles: Record<string, number> = {};
  const labels: HierarchyLabel[] = [];
  let totalElements = 0;
  let maxDepth = 0;
  let nonZeroFrames = 0;
  const bounds = { minX: Infinity, minY: Infinity, maxX: 0, maxY: 0 };

  function visit(node: unknown, depth: number): void {
    if (!node || typeof node !== "object") return;
    const record = node as Record<string, any>;
    totalElements += 1;
    maxDepth = Math.max(maxDepth, depth);
    const role = String(record.role_description ?? record.role ?? record.type ?? "unknown");
    roles[role] = (roles[role] ?? 0) + 1;

    if (record.AXLabel || record.title || record.AXValue) {
      labels.push({ label: record.AXLabel ?? record.title ?? record.AXValue, role, frame: record.frame ?? null });
    }

    const frame = record.frame;
    if (frame?.width > 0 && frame?.height > 0) {
      nonZeroFrames += 1;
      bounds.minX = Math.min(bounds.minX, frame.x);
      bounds.minY = Math.min(bounds.minY, frame.y);
      bounds.maxX = Math.max(bounds.maxX, frame.x + frame.width);
      bounds.maxY = Math.max(bounds.maxY, frame.y + frame.height);
    }

    for (const child of record.children ?? []) visit(child, depth + 1);
  }

  for (const root of roots) visit(root, 0);

  const firstRoot = roots[0] as Record<string, any> | undefined;
  const emptyApplicationOnly =
    totalElements === 1 &&
    firstRoot?.role === "AXApplication" &&
    (!firstRoot.children || firstRoot.children.length === 0);

  return {
    available: true,
    totalElements,
    maxDepth,
    emptyApplicationOnly,
    nonZeroFrames,
    contentBounds: nonZeroFrames
      ? { x: bounds.minX, y: bounds.minY, width: bounds.maxX - bounds.minX, height: bounds.maxY - bounds.minY }
      : null,
    roles,
    sampleLabels: labels.slice(0, 80),
    insight: emptyApplicationOnly ? EMPTY_APP_INSIGHT : HIERARCHY_INSIGHT,
  };
}

export function truncate(value: unknown, limit = MAX_OUTPUT): string {
  const text = String(value ?? "");
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}\n[truncated ${text.length - limit} characters]`;
}

async function commandPath(command: string): Promise<string | null> {
  const result = await execFilePromise("sh", ["-lc", `command -v ${command}`], {
    timeout: 5000,
    maxBuffer: MAX_OUTPUT,
    rejectOnError: false,
  });
  return result.stdout.trim() || null;
}

function execFilePromise(file: string, args: string[], options: ExecOptions): Promise<ExecResult> {
  const { timeout, maxBuffer, rejectOnError } = options;
  return new Promise((resolve, reject) => {
    execFile(file, args, { cwd: process.cwd(), env: process.env, timeout, maxBuffer }, (error: any, stdout: unknown, stderr: unknown) => {
      if (error && rejectOnError) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
        return;
      }
      resolve({
        stdout: String(stdout ?? ""),
        stderr: String(stderr ?? ""),
        error: error ? { message: error.message, code: error.code, signal: error.signal } : null,
      });
    });
  });
}
