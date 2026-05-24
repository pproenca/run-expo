export interface ExecResult {
  stdout: string;
  stderr: string;
  error: unknown | null;
}

export interface NativeContextDependencies {
  execFile: (command: string, args: string[], options: { timeout: number; maxBuffer?: number; rejectOnError?: boolean }) => Promise<ExecResult>;
  joinPath: (...parts: string[]) => string;
  truncate?: (value: unknown, limit?: number) => string;
}

export interface FilteredLogOptions {
  last: string;
  bundleId?: string | null;
  processName?: string | null;
}

export async function collectFilteredIosLogs(
  udid: string,
  options: FilteredLogOptions,
  deps: NativeContextDependencies,
): Promise<Record<string, unknown>> {
  const predicate = options.processName
    ? `process == "${escapePredicateValue(options.processName)}"`
    : options.bundleId
      ? `process CONTAINS "${escapePredicateValue(processNameFromBundleId(options.bundleId))}"`
      : null;
  const args = ["simctl", "spawn", udid, "log", "show", "--style", "compact", "--last", options.last];
  if (predicate) args.push("--predicate", predicate);
  const result = await deps.execFile("xcrun", args, {
    timeout: 45_000,
    maxBuffer: 5 * 1024 * 1024,
    rejectOnError: false,
  });
  const lines = result.stdout.split(/\r?\n/).filter(Boolean);
  const important = lines.filter((line) => /error|warn|exception|fatal|response_status|api\/|openurl|reload|bundle|metro/i.test(line));
  const truncateFn = deps.truncate ?? truncate;
  return {
    last: options.last,
    predicate,
    totalLines: lines.length,
    importantLineCount: important.length,
    importantLines: important.slice(-160),
    stdout: important.length ? undefined : truncateFn(result.stdout, 12000),
    stderr: truncateFn(result.stderr),
    error: result.error,
  };
}

export async function iosInstalledAppInfo(
  udid: string,
  bundleId: string,
  deps: NativeContextDependencies,
): Promise<Record<string, unknown>> {
  const appPath = await deps.execFile("xcrun", ["simctl", "get_app_container", udid, bundleId, "app"], {
    timeout: 10_000,
  });
  const dataPath = await deps.execFile("xcrun", ["simctl", "get_app_container", udid, bundleId, "data"], {
    timeout: 10_000,
    rejectOnError: false,
  });
  const infoPlist = deps.joinPath(appPath.stdout.trim(), "Info.plist");
  const plist = await safeToolSection(() => readInfoPlistFields(infoPlist, deps));
  return {
    bundleId,
    appPath: appPath.stdout.trim(),
    dataPath: dataPath.stdout.trim() || null,
    infoPlist: plist.ok ? plist.value : plist,
  };
}

export async function readInfoPlistFields(
  infoPlist: string,
  deps: Pick<NativeContextDependencies, "execFile">,
): Promise<Record<string, string>> {
  const fields: Record<string, string> = {};
  for (const field of ["CFBundleDisplayName", "CFBundleName", "CFBundleVersion", "CFBundleShortVersionString", "RCTNewArchEnabled", "UIUserInterfaceStyle"]) {
    const result = await deps.execFile("plutil", ["-extract", field, "raw", "-o", "-", infoPlist], {
      timeout: 5000,
      rejectOnError: false,
    });
    if (!result.error && result.stdout.trim()) fields[field] = result.stdout.trim();
  }
  return fields;
}

export async function safeToolSection<T>(fn: () => Promise<T> | T): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
  try {
    return { ok: true, value: await fn() };
  } catch (error) {
    return { ok: false, error: formatError(error) };
  }
}

export function processNameFromBundleId(bundleId: unknown): string | null {
  if (!bundleId) return null;
  const last = String(bundleId).split(".").filter(Boolean).at(-1);
  return last ? last.replace(/[^a-zA-Z0-9_-]/g, "") : null;
}

export function escapePredicateValue(value: unknown): string {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export function truncate(value: unknown, limit = 40_000): string {
  const text = String(value ?? "");
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}\n[truncated ${text.length - limit} characters]`;
}

export function formatError(error: unknown): string {
  if (!error) return "Unknown error";
  const record = error as { message?: unknown; stdout?: unknown; stderr?: unknown };
  const parts = [record.message ?? String(error)];
  if (record.stdout) parts.push(`stdout:\n${truncate(record.stdout)}`);
  if (record.stderr) parts.push(`stderr:\n${truncate(record.stderr)}`);
  return parts.join("\n\n");
}

