import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface ReviewSidecarDependencies {
  mkdir?: (dir: string, options: { recursive: true }) => Promise<unknown>;
  pathExists?: (file: string) => Promise<boolean>;
  readFile?: (file: string, encoding: "utf8") => Promise<string>;
  writeFile?: (file: string, data: string, encoding: "utf8") => Promise<unknown>;
  join?: (...parts: string[]) => string;
  now?: () => Date;
  random?: () => number;
  symbolicateStack?: (metroPort: number, frames: ComponentStackFrame[]) => Promise<MetroSymbolicateResult>;
}

export interface ReviewOverlayEventData {
  version: number;
  title: string;
  createdAt: string | null;
  events: Array<Record<string, any>>;
  missing?: boolean;
  savedAt?: string;
  symbolication?: SymbolicationSummary;
}

export interface ComponentStackFrame {
  methodName: string;
  file: string;
  lineNumber: number;
  column: number;
}

export interface MetroSymbolicateResult {
  available: boolean;
  value?: {
    stack?: Array<{
      methodName?: string | null;
      file?: string | null;
      lineNumber?: number | null;
      column?: number | null;
    } | null>;
  };
  reason?: string;
}

export interface SymbolicationSummary {
  metroPort: number;
  attempted: number;
  enriched: number;
  errors: string[];
}

export interface JsonResponsePayload {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export function normalizeEndpointPath(value: unknown): string {
  const raw = requireOptionalString(value) ?? "/events";
  const endpoint = raw.startsWith("/") ? raw : `/${raw}`;
  if (!/^\/[A-Za-z0-9_./-]+$/.test(endpoint)) throw new Error("endpointPath must be a simple URL path.");
  return endpoint;
}

export async function createReviewOverlayEventsFile(
  args: { outputDir: string; title?: unknown; reset: boolean },
  deps: ReviewSidecarDependencies = {},
): Promise<ReviewOverlayEventData> {
  const io = sidecarIo(deps);
  await io.mkdir(args.outputDir, { recursive: true });
  const eventsPath = io.join(args.outputDir, "events.json");
  if (!args.reset && await io.pathExists(eventsPath)) {
    return readReviewOverlayEvents(eventsPath, undefined, deps);
  }
  const data: ReviewOverlayEventData = {
    version: 1,
    title: requireOptionalString(args.title) ?? "Codex in-app review",
    createdAt: nowIso(deps),
    events: [],
  };
  await io.writeFile(eventsPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  return data;
}

export async function readReviewOverlayEvents(
  eventsPath: string,
  options: { metroPort?: unknown } = {},
  deps: ReviewSidecarDependencies = {},
): Promise<ReviewOverlayEventData> {
  const io = sidecarIo(deps);
  if (!(await io.pathExists(eventsPath))) {
    return {
      version: 1,
      title: "Codex in-app review",
      createdAt: null,
      events: [],
      missing: true,
    };
  }
  const data = JSON.parse(await io.readFile(eventsPath, "utf8")) as ReviewOverlayEventData;
  if (!Array.isArray(data.events)) data.events = [];
  if (options.metroPort) {
    data.symbolication = await symbolicateReviewOverlayEvents(data.events, clampNumber(options.metroPort, 1, 65535), deps);
  }
  return data;
}

export async function appendReviewOverlayEvent(
  eventsPath: string,
  payload: unknown,
  deps: ReviewSidecarDependencies = {},
): Promise<ReviewOverlayEventData> {
  const io = sidecarIo(deps);
  const data = await readReviewOverlayEvents(eventsPath, undefined, deps);
  const record = asRecord(payload);
  const events = Array.isArray(record?.events) ? record.events : [payload];
  for (const event of events) {
    if (!event || typeof event !== "object" || Array.isArray(event)) continue;
    data.events.push({
      id: `event-${nowMs(deps)}-${randomSuffix(deps)}`,
      receivedAt: nowIso(deps),
      ...(event as Record<string, any>),
    });
  }
  data.savedAt = nowIso(deps);
  await io.writeFile(eventsPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  return data;
}

export async function persistAnnotationPayload(
  outputDir: string,
  payload: unknown,
  deps: ReviewSidecarDependencies = {},
): Promise<{ ok: true; annotationsPath: string; savedAt: string }> {
  const io = sidecarIo(deps);
  const annotations = asRecord(payload);
  if (!annotations || !Array.isArray(annotations.comments)) {
    throw new Error("annotations payload must include comments array");
  }
  const savedAt = nowIso(deps);
  const annotationsPath = io.join(outputDir, "annotations.json");
  await io.writeFile(annotationsPath, `${JSON.stringify({ ...annotations, savedAt }, null, 2)}\n`, "utf8");
  return { ok: true, annotationsPath, savedAt };
}

export function sendJsonPayload(payload: unknown, status = 200): JsonResponsePayload {
  return {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
    body: `${JSON.stringify(payload, null, 2)}\n`,
  };
}

export async function symbolicateReviewOverlayEvents(
  events: Array<Record<string, any>>,
  metroPort: number,
  deps: ReviewSidecarDependencies = {},
): Promise<SymbolicationSummary> {
  const summary: SymbolicationSummary = { metroPort, attempted: 0, enriched: 0, errors: [] };
  for (const event of events) {
    const element = asRecord(event.element);
    const stack = element?.componentStack;
    if (typeof stack !== "string" || !stack.trim()) continue;
    const frames = parseComponentStackFrames(stack);
    if (frames.length === 0) continue;
    summary.attempted += 1;
    try {
      const result = await postMetroSymbolicate(metroPort, frames.slice(0, 80), deps);
      const sourceLinks = (Array.isArray(result.stack) ? result.stack : [])
        .filter((frame) => frame && frame.file && !/node_modules/.test(frame.file))
        .map((frame) => ({
          methodName: frame?.methodName || null,
          fileName: frame?.file,
          lineNumber: typeof frame?.lineNumber === "number" ? frame.lineNumber : null,
          columnNumber: typeof frame?.column === "number" ? frame.column : null,
        }))
        .slice(0, 12);
      if (sourceLinks.length > 0 && element) {
        element.sourceLinks = sourceLinks;
        if (!element.source) element.source = sourceLinks[0];
        summary.enriched += 1;
      }
    } catch (error) {
      summary.errors.push(formatError(error));
    }
  }
  return summary;
}

export function parseComponentStackFrames(stack: string): ComponentStackFrame[] {
  const frames: ComponentStackFrame[] = [];
  for (const line of String(stack).split("\n")) {
    const match = /^\s*at\s+(.*?)\s+\((http.*):(\d+):(\d+)\)$/.exec(line);
    if (!match) continue;
    frames.push({
      methodName: match[1]?.trim() || "<anonymous>",
      file: match[2] ?? "",
      lineNumber: Number(match[3]),
      column: Number(match[4]),
    });
  }
  return frames;
}

async function postMetroSymbolicate(
  metroPort: number,
  stack: ComponentStackFrame[],
  deps: ReviewSidecarDependencies,
): Promise<NonNullable<MetroSymbolicateResult["value"]>> {
  if (!deps.symbolicateStack) throw new Error("Metro symbolication failed.");
  const result = await deps.symbolicateStack(metroPort, stack);
  if (!result.available) throw new Error(result.reason ?? "Metro symbolication failed.");
  return result.value ?? {};
}

function sidecarIo(deps: ReviewSidecarDependencies) {
  return {
    mkdir: deps.mkdir ?? mkdir,
    pathExists: deps.pathExists ?? defaultPathExists,
    readFile: deps.readFile ?? readFile,
    writeFile: deps.writeFile ?? writeFile,
    join: deps.join ?? join,
  };
}

async function defaultPathExists(file: string): Promise<boolean> {
  try {
    await readFile(file);
    return true;
  } catch {
    return false;
  }
}

function requireOptionalString(value: unknown): string | undefined {
  if (value == null) return undefined;
  if (typeof value !== "string") throw new Error("Expected optional string.");
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function clampNumber(value: unknown, min: number, max: number): number {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return min;
  return Math.max(min, Math.min(max, Math.trunc(numberValue)));
}

function nowIso(deps: ReviewSidecarDependencies): string {
  return (deps.now?.() ?? new Date()).toISOString();
}

function nowMs(deps: ReviewSidecarDependencies): number {
  return (deps.now?.() ?? new Date()).getTime();
}

function randomSuffix(deps: ReviewSidecarDependencies): string {
  return (deps.random?.() ?? Math.random()).toString(36).slice(2, 8);
}

function asRecord(value: unknown): Record<string, any> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : null;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
