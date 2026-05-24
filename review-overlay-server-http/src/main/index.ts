export interface ReviewOverlayRequest {
  method?: string;
  url?: string | null;
  body?: string;
}

export interface ReviewOverlayServerOptions {
  dir: string;
  port: number;
  endpointPath: string;
  eventsPath: string;
}

export interface ReviewOverlayServerDependencies {
  joinPath: (...parts: string[]) => string;
  readFile: (file: string) => Promise<string> | string;
  createEventsFile: (args: { outputDir: string; title: string; reset: boolean }) => Promise<Record<string, any>>;
  readEvents: (eventsPath: string) => Promise<Record<string, any>>;
  appendEvent: (eventsPath: string, payload: unknown) => Promise<{ events: unknown[] }>;
  readPointer: (args: { viewportWidth: number; viewportHeight: number }) => Promise<unknown>;
  writeClipboard: (text: string) => Promise<boolean>;
}

export interface HttpPayload {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export interface PointerBridgeDependencies {
  viewportWidth: number;
  viewportHeight: number;
  platform: string;
  readCursor: () => Promise<{ x: number; y: number } | null>;
  readWindow: () => Promise<{ x: number; y: number; width: number; height: number } | null>;
}

export const OVERLAY_BODY_LIMIT = 2 * 1024 * 1024;

export async function handleReviewOverlayRequest(
  request: ReviewOverlayRequest,
  options: ReviewOverlayServerOptions,
  deps: ReviewOverlayServerDependencies,
): Promise<HttpPayload> {
  const corsHeaders = setCorsHeaders({});
  try {
    if (request.method === "OPTIONS") {
      return { status: 204, headers: corsHeaders, body: "" };
    }
    const url = new URL(request.url ?? "/", `http://127.0.0.1:${options.port}`);
    if (request.method === "GET" && url.pathname === "/health") {
      return sendJsonPayload({ ok: true, endpoint: options.endpointPath, eventsPath: options.eventsPath }, 200, corsHeaders);
    }
    if (request.method === "GET" && url.pathname === "/pointer") {
      const viewportWidth = Number(url.searchParams.get("viewportWidth"));
      const viewportHeight = Number(url.searchParams.get("viewportHeight"));
      return sendJsonPayload(await deps.readPointer({
        viewportWidth: Number.isFinite(viewportWidth) && viewportWidth > 0 ? viewportWidth : 393,
        viewportHeight: Number.isFinite(viewportHeight) && viewportHeight > 0 ? viewportHeight : 852,
      }), 200, corsHeaders);
    }
    if (request.method === "POST" && url.pathname === "/copy") {
      const body = await readRequestBodyText(request.body ?? "", OVERLAY_BODY_LIMIT);
      const payload = JSON.parse(body || "{}");
      const copied = await deps.writeClipboard(String(payload.text || ""));
      return sendJsonPayload({ ok: copied, copied }, 200, corsHeaders);
    }
    if (request.method === "GET" && url.pathname === "/events.json") {
      return sendFilePayload(await deps.readFile(options.eventsPath), "application/json; charset=utf-8", corsHeaders);
    }
    if (request.method === "GET" && url.pathname === options.endpointPath) {
      return sendJsonPayload(await deps.readEvents(options.eventsPath), 200, corsHeaders);
    }
    if (request.method === "POST" && url.pathname === options.endpointPath) {
      const body = await readRequestBodyText(request.body ?? "", OVERLAY_BODY_LIMIT);
      const payload = JSON.parse(body || "{}");
      const data = await deps.appendEvent(options.eventsPath, payload);
      return sendJsonPayload({ ok: true, eventCount: data.events.length, eventsPath: options.eventsPath }, 200, corsHeaders);
    }
    if (request.method === "DELETE" && url.pathname === options.endpointPath) {
      const data = await deps.createEventsFile({ outputDir: options.dir, title: "Codex in-app review", reset: true });
      const events = Array.isArray(data.events) ? data.events : [];
      return sendJsonPayload({ ok: true, cleared: true, eventCount: events.length, eventsPath: options.eventsPath }, 200, corsHeaders);
    }
    return sendJsonPayload({ ok: false, error: "not found" }, 404, corsHeaders);
  } catch (error) {
    return sendJsonPayload({ ok: false, error: formatError(error) }, 500, corsHeaders);
  }
}

export function sendFilePayload(body: string, contentType: string, baseHeaders: Record<string, string> = {}): HttpPayload {
  return {
    status: 200,
    headers: {
      ...baseHeaders,
      "content-type": contentType,
      "cache-control": "no-store",
    },
    body,
  };
}

export function sendJsonPayload(payload: unknown, status = 200, baseHeaders: Record<string, string> = {}): HttpPayload {
  return {
    status,
    headers: {
      ...baseHeaders,
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
    body: `${JSON.stringify(payload, null, 2)}\n`,
  };
}

export function setCorsHeaders(headers: Record<string, string>): Record<string, string> {
  return {
    ...headers,
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,DELETE,OPTIONS",
    "access-control-allow-headers": "content-type",
  };
}

export async function readRequestBodyText(body: string, limit: number): Promise<string> {
  let text = "";
  for (const chunk of chunks(String(body))) {
    text += chunk;
    if (text.length > limit) {
      throw new Error("request body too large");
    }
  }
  return text;
}

export async function readSimulatorPointer(deps: PointerBridgeDependencies): Promise<Record<string, unknown>> {
  if (deps.platform !== "darwin") {
    return { ok: false, inside: false, error: "pointer bridge requires macOS Simulator" };
  }
  const [cursor, window] = await Promise.all([deps.readCursor(), deps.readWindow()]);
  if (!cursor || !window) {
    return { ok: false, inside: false, error: "unable to read mouse cursor or Simulator window bounds" };
  }
  const relativeX = cursor.x - window.x;
  const relativeY = cursor.y - window.y;
  const inside = relativeX >= 0 && relativeY >= 0 && relativeX <= window.width && relativeY <= window.height;
  const x = Math.max(0, Math.min(deps.viewportWidth, relativeX / window.width * deps.viewportWidth));
  const y = Math.max(0, Math.min(deps.viewportHeight, relativeY / window.height * deps.viewportHeight));
  return {
    ok: true,
    inside,
    point: { x, y },
    cursor,
    simulatorWindow: window,
    mapping: "mac-cursor-to-simulator-window",
  };
}

export function reviewOverlayServerStartupPayload(args: {
  port: number;
  endpointPath: string;
  eventsPath: string;
}): Record<string, unknown> {
  return {
    ok: true,
    url: `http://127.0.0.1:${args.port}/`,
    endpoint: `http://127.0.0.1:${args.port}${args.endpointPath}`,
    eventsPath: args.eventsPath,
  };
}

export function normalizeEndpointPath(value: unknown): string {
  const raw = requireOptionalString(value) ?? "/events";
  const endpoint = raw.startsWith("/") ? raw : `/${raw}`;
  if (!/^\/[A-Za-z0-9_./-]+$/.test(endpoint)) throw new Error("endpointPath must be a simple URL path.");
  return endpoint;
}

export function requireOptionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function chunks(text: string): string[] {
  const result = [];
  for (let index = 0; index < text.length; index += 64 * 1024) {
    result.push(text.slice(index, index + 64 * 1024));
  }
  if (result.length === 0) result.push("");
  return result;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
