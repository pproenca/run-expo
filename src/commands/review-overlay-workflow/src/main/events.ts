import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export async function createEventsFile(args: { outputDir: string; title?: unknown; reset: boolean }): Promise<Record<string, any>> {
  await mkdir(args.outputDir, { recursive: true });
  const eventsPath = path.join(args.outputDir, "events.json");
  const existing = await readJson(eventsPath).catch(() => null);
  const payload = args.reset || !existing
    ? {
      version: 1,
      title: requireOptionalString(args.title) ?? "Codex in-app review",
      createdAt: new Date().toISOString(),
      events: [],
    }
    : existing;
  await writeFile(eventsPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return { eventsPath, eventCount: Array.isArray(payload.events) ? payload.events.length : 0, title: payload.title ?? null };
}

export async function readEvents(eventsPath: string, options: { metroPort?: unknown } = {}): Promise<Record<string, any>> {
  const payload = await readJson(eventsPath).catch(() => null);
  if (!payload) {
    return { available: false, reason: "No review overlay events file exists.", eventCount: 0, events: [], metroPort: options.metroPort ?? null };
  }
  const events = Array.isArray(payload.events) ? payload.events : [];
  return { available: true, eventCount: events.length, events, title: payload.title ?? null, metroPort: options.metroPort ?? null };
}

export async function readJson(file: string): Promise<Record<string, any>> {
  return JSON.parse(await readFile(file, "utf8"));
}

function requireOptionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
