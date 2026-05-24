import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import path from "node:path";

import type { ToolTextResult } from "../../../../core/tool-json-envelope/src/main/index.ts";
import { createEventsFile, readJson } from "./events.js";

export async function reviewOverlayServer(args: { dir: string; port?: unknown; endpointPath?: unknown }): Promise<ToolTextResult> {
  const dir = path.resolve(args.dir);
  const port = args.port ? clampNumber(args.port, 1, 65535) : await findAvailablePort(17655);
  const endpointPath = normalizeEndpointPath(args.endpointPath);
  await mkdir(dir, { recursive: true });
  await createEventsFile({ outputDir: dir, reset: false });
  const server = createHttpServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", async () => {
      const url = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);
      const eventsPath = path.join(dir, "events.json");
      if (request.method === "GET" && url.pathname === "/events.json") {
        const text = await readFile(eventsPath, "utf8").catch(() => "{\"events\":[]}\n");
        response.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
        response.end(text);
        return;
      }
      if (request.method === "POST" && url.pathname === endpointPath) {
        const current = await readJson(eventsPath).catch(() => ({ version: 1, events: [] }));
        const events = Array.isArray(current.events) ? current.events : [];
        events.push(JSON.parse(body || "{}"));
        const next = { ...current, events, updatedAt: new Date().toISOString() };
        await writeFile(eventsPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
        response.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
        response.end(`${JSON.stringify({ ok: true, eventsPath, eventCount: events.length }, null, 2)}\n`);
        return;
      }
      response.writeHead(404, { "content-type": "application/json; charset=utf-8" });
      response.end("{\"ok\":false,\"error\":\"not found\"}\n");
    });
  });
  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", () => resolve()));
  const payload = { ok: true, url: `http://127.0.0.1:${port}/`, endpoint: `http://127.0.0.1:${port}${endpointPath}`, eventsUrl: `http://127.0.0.1:${port}/events.json`, dir };
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  return await new Promise<never>(() => {});
}

export function normalizeEndpointPath(value: unknown): string {
  const raw = requireOptionalString(value) ?? "/events";
  const endpoint = raw.startsWith("/") ? raw : `/${raw}`;
  if (!/^\/[A-Za-z0-9_./-]+$/.test(endpoint)) throw new Error("endpointPath must be a simple URL path.");
  return endpoint;
}

export function clampNumber(value: unknown, min: number, max: number): number {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) {
    throw new Error(`Expected a finite number, got ${value}.`);
  }
  return Math.min(Math.max(numberValue, min), max);
}

export function findAvailablePort(start: number): Promise<number> {
  return new Promise((resolve) => {
    const tryPort = (port: number) => {
      const server = createNetServer();
      server.once("error", () => tryPort(port + 1));
      server.once("listening", () => {
        server.close(() => resolve(port));
      });
      server.listen(port, "127.0.0.1");
    };
    tryPort(start);
  });
}

function requireOptionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
