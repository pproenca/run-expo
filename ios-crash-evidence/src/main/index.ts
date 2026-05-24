import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

declare const process: { env: Record<string, string | undefined> };

export interface CrashEvidenceOptions {
  platform?: unknown;
  bundleId?: unknown;
  processName?: unknown;
  sinceMs: number;
  waitMs?: unknown;
  action: unknown;
}

export interface CrashReportEvidence {
  path: string;
  file: string;
  mtime: string;
  appName: unknown;
  bundleId: unknown;
  incidentId: unknown;
}

export interface CrashEvidence {
  crashCheck: {
    action: unknown;
    bundleId: unknown;
    processName: unknown;
    since: string;
    waitedMs: number;
    reportCount: number;
  };
  crashReports: CrashReportEvidence[];
}

export interface DirentLike {
  name: string;
  isFile(): boolean;
}

export interface StatLike {
  mtimeMs: number;
  mtime: Date;
}

export interface IosCrashEvidenceDependencies {
  reportsDir?: string;
  readdir?: (dir: string, options: { withFileTypes: true }) => Promise<DirentLike[]>;
  stat?: (file: string) => Promise<StatLike>;
  readFile?: (file: string, encoding: "utf8") => Promise<string>;
  wait?: (ms: number) => Promise<void>;
}

export async function attachIosCrashEvidence<T extends Record<string, unknown>>(
  payload: T,
  options: CrashEvidenceOptions,
  dependencies: IosCrashEvidenceDependencies = {},
): Promise<T | (T & CrashEvidence & { available?: false; reason?: string })> {
  if (options.platform !== "ios") return payload;
  const evidence = await iosCrashEvidence(options, dependencies);
  if (!evidence.crashReports?.length) return { ...payload, ...evidence };
  return {
    ...payload,
    ...evidence,
    available: false,
    reason: `The app generated ${evidence.crashReports.length} matching iOS crash report(s) after ${String(options.action)}.`,
  };
}

export async function iosCrashEvidence(
  options: CrashEvidenceOptions,
  dependencies: IosCrashEvidenceDependencies = {},
): Promise<CrashEvidence> {
  const delay = clampNumber(options.waitMs ?? 0, 0, 30_000);
  if (delay > 0) await (dependencies.wait ?? wait)(delay);
  const crashReports = await matchingIosCrashReports(options, dependencies);
  return {
    crashCheck: {
      action: options.action,
      bundleId: options.bundleId ?? null,
      processName: options.processName ?? null,
      since: new Date(options.sinceMs).toISOString(),
      waitedMs: delay,
      reportCount: crashReports.length,
    },
    crashReports,
  };
}

export async function matchingIosCrashReports(
  options: Pick<CrashEvidenceOptions, "bundleId" | "processName" | "sinceMs">,
  dependencies: IosCrashEvidenceDependencies = {},
): Promise<CrashReportEvidence[]> {
  if (!options.bundleId && !options.processName) return [];

  const reportsDir = dependencies.reportsDir ??
    process.env.EXPO_IOS_DIAGNOSTIC_REPORTS_DIR ??
    path.join(os.homedir(), "Library", "Logs", "DiagnosticReports");
  const readdir = dependencies.readdir ?? fs.readdir;
  const entries = await readdir(reportsDir, { withFileTypes: true }).catch(() => []);
  const matches: CrashReportEvidence[] = [];
  const wantedProcess = options.processName ? String(options.processName).toLowerCase() : null;

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!/(\.ips|\.crash)$/.test(entry.name)) continue;
    const reportPath = path.join(reportsDir, entry.name);
    const stat = await (dependencies.stat ?? fs.stat)(reportPath).catch(() => null);
    if (!stat || stat.mtimeMs < options.sinceMs) continue;
    const metadata = await readCrashReportMetadata(reportPath, dependencies);
    const metadataBundle = metadata?.bundleID ?? metadata?.bundleId ?? null;
    const metadataName = metadata?.app_name ?? metadata?.name ?? metadata?.procName ?? null;
    const nameMatches = wantedProcess
      ? entry.name.toLowerCase().includes(wantedProcess) || String(metadataName ?? "").toLowerCase() === wantedProcess
      : false;

    if ((options.bundleId && metadataBundle === options.bundleId) || nameMatches) {
      matches.push({
        path: reportPath,
        file: entry.name,
        mtime: stat.mtime.toISOString(),
        appName: metadataName,
        bundleId: metadataBundle,
        incidentId: metadata?.incident_id ?? metadata?.incident ?? null,
      });
    }
  }

  return matches.sort((left, right) => left.path.localeCompare(right.path));
}

export async function readCrashReportMetadata(
  reportPath: string,
  dependencies: Pick<IosCrashEvidenceDependencies, "readFile"> = {},
): Promise<Record<string, unknown> | null> {
  const readFile = dependencies.readFile ?? fs.readFile;
  const content = await readFile(reportPath, "utf8").catch(() => "");
  const firstLine = content.split(/\r?\n/, 1)[0]?.trim();
  if (!firstLine?.startsWith("{")) return null;
  try {
    return JSON.parse(firstLine);
  } catch {
    return null;
  }
}

export function clampNumber(value: unknown, min: number, max: number): number {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`Expected a finite number, got ${String(value)}.`);
  return Math.min(Math.max(number, min), max);
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
