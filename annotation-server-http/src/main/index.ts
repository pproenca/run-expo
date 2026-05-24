export interface AnnotationRequest {
  method?: string;
  url?: string | null;
  body?: string;
}

export interface AnnotationServerOptions {
  dir: string;
  port: number;
}

export interface AnnotationServerDependencies {
  joinPath: (...parts: string[]) => string;
  readFile: (file: string) => Promise<string> | string;
  writeFile: (file: string, data: string, encoding: "utf8") => Promise<unknown> | unknown;
  now?: () => Date;
}

export interface AnnotationServerArgs {
  dir?: unknown;
  port?: unknown;
}

export type AnnotationRequestHandler = (request: AnnotationRequest) => Promise<HttpPayload>;

export interface AnnotationServerCommandDependencies extends AnnotationServerDependencies {
  resolvePath: (path: string) => string;
  listen: (options: {
    host: "127.0.0.1";
    port: number;
    handler: AnnotationRequestHandler;
  }) => Promise<unknown> | unknown;
  stdout?: (text: string) => void;
  waitForever?: () => Promise<never>;
}

export interface HttpPayload {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export const ANNOTATION_BODY_LIMIT = 2 * 1024 * 1024;

export async function annotationServer(
  args: AnnotationServerArgs = {},
  deps: AnnotationServerCommandDependencies,
): Promise<Record<string, unknown>> {
  const dir = deps.resolvePath(requireString(args.dir, "dir"));
  const port = clampNumber(args.port ?? 17654, 1, 65535);
  await deps.listen({
    host: "127.0.0.1",
    port,
    handler: (request) => handleAnnotationRequest(request, { dir, port }, deps),
  });
  const payload = annotationServerStartupPayload(dir, port);
  deps.stdout?.(`${JSON.stringify(payload, null, 2)}\n`);
  if (deps.waitForever) {
    await deps.waitForever();
  }
  return payload;
}

export async function handleAnnotationRequest(
  request: AnnotationRequest,
  options: AnnotationServerOptions,
  deps: AnnotationServerDependencies,
): Promise<HttpPayload> {
  try {
    const url = new URL(request.url ?? "/", `http://127.0.0.1:${options.port}`);
    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/annotate.html")) {
      return sendFilePayload(await deps.readFile(deps.joinPath(options.dir, "annotate.html")), "text/html; charset=utf-8");
    }
    if (request.method === "GET" && url.pathname === "/screenshot.png") {
      return sendFilePayload(await deps.readFile(deps.joinPath(options.dir, "screenshot.png")), "image/png");
    }
    if (request.method === "GET" && url.pathname === "/context.json") {
      return sendFilePayload(await deps.readFile(deps.joinPath(options.dir, "context.json")), "application/json; charset=utf-8");
    }
    if (request.method === "GET" && url.pathname === "/annotations.json") {
      return sendFilePayload(await deps.readFile(deps.joinPath(options.dir, "annotations.json")), "application/json; charset=utf-8");
    }
    if (request.method === "POST" && url.pathname === "/annotations") {
      const body = await readRequestBodyText(request.body ?? "", ANNOTATION_BODY_LIMIT);
      const payload = JSON.parse(body || "{}");
      if (!payload || !Array.isArray(payload.comments)) throw new Error("annotations payload must include comments array");
      payload.savedAt = now(deps).toISOString();
      const annotationsPath = deps.joinPath(options.dir, "annotations.json");
      await deps.writeFile(annotationsPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
      return sendJsonPayload({ ok: true, annotationsPath, savedAt: payload.savedAt });
    }
    return sendJsonPayload({ ok: false, error: "not found" }, 404);
  } catch (error) {
    return sendJsonPayload({ ok: false, error: formatError(error) }, 500);
  }
}

export function sendFilePayload(body: string, contentType: string): HttpPayload {
  return {
    status: 200,
    headers: {
      "content-type": contentType,
      "cache-control": "no-store",
    },
    body,
  };
}

export function sendJsonPayload(payload: unknown, status = 200): HttpPayload {
  return {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
    body: `${JSON.stringify(payload, null, 2)}\n`,
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

export function annotationServerStartupPayload(dir: string, port: number): Record<string, unknown> {
  return { ok: true, url: `http://127.0.0.1:${port}/`, dir };
}

export function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${field} must be a non-empty string.`);
  }
  return value.trim();
}

export function clampNumber(value: unknown, min: number, max: number): number {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) {
    throw new Error(`Expected a finite number, got ${value}.`);
  }
  return Math.min(Math.max(numberValue, min), max);
}

function chunks(text: string): string[] {
  const result = [];
  for (let index = 0; index < text.length; index += 64 * 1024) {
    result.push(text.slice(index, index + 64 * 1024));
  }
  if (result.length === 0) result.push("");
  return result;
}

function now(deps: AnnotationServerDependencies): Date {
  return deps.now?.() ?? new Date();
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
