import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  appendReviewOverlayEvent,
  createReviewOverlayEventsFile,
  normalizeEndpointPath,
  parseComponentStackFrames,
  persistAnnotationPayload,
  readReviewOverlayEvents,
  sendJsonPayload,
} from "../main/index.js";
import type { ReviewSidecarDependencies } from "../main/index.js";

describe("review-sidecar-state legacy characterization", () => {
  it("normalizes endpoint paths with the legacy default, slash prefix, and simple path validation", () => {
    assert.equal(normalizeEndpointPath(undefined), "/events");
    assert.equal(normalizeEndpointPath(""), "/events");
    assert.equal(normalizeEndpointPath("events/v1"), "/events/v1");
    assert.equal(normalizeEndpointPath("/events.v1_ok-2"), "/events.v1_ok-2");
    assert.throws(() => normalizeEndpointPath("/events?x=1"), /endpointPath must be a simple URL path/);
  });

  it("creates review overlay events files, reuses existing files unless reset, and preserves title defaults", async () => {
    const writes: Array<{ file: string; data: string }> = [];
    const deps = memoryDeps({
      exists: new Set<string>(),
      writes,
      now: () => new Date("2026-05-23T10:00:00.000Z"),
    });

    const created = await createReviewOverlayEventsFile({ outputDir: "/tmp/overlay", title: "Review", reset: false }, deps);
    assert.deepEqual(created, {
      version: 1,
      title: "Review",
      createdAt: "2026-05-23T10:00:00.000Z",
      events: [],
    });
    assert.equal(writes[0]?.file, "/tmp/overlay/events.json");
    assert.match(writes[0]?.data ?? "", /"title": "Review"/);

    const existingDeps = memoryDeps({
      exists: new Set(["/tmp/overlay/events.json"]),
      files: { "/tmp/overlay/events.json": JSON.stringify({ version: 1, title: "Existing", events: [{ id: "a" }] }) },
    });
    assert.deepEqual(await createReviewOverlayEventsFile({ outputDir: "/tmp/overlay", title: "Ignored", reset: false }, existingDeps), {
      version: 1,
      title: "Existing",
      events: [{ id: "a" }],
    });
    assert.equal((await createReviewOverlayEventsFile({ outputDir: "/tmp/overlay", title: undefined, reset: true }, deps)).title, "Codex in-app review");
  });

  it("returns missing overlay events, normalizes malformed events arrays, and symbolicates component stacks", async () => {
    const missing = await readReviewOverlayEvents("/tmp/missing/events.json", undefined, memoryDeps({ exists: new Set<string>() }));
    assert.deepEqual(missing, {
      version: 1,
      title: "Codex in-app review",
      createdAt: null,
      events: [],
      missing: true,
    });

    const event = { element: { componentStack: "    at DayCell (http://localhost:8081/index.bundle:10:20)\n    at NativeView (file.js:1:2)" } };
    const data = await readReviewOverlayEvents("/tmp/events.json", { metroPort: 19000 }, memoryDeps({
      exists: new Set(["/tmp/events.json"]),
      files: { "/tmp/events.json": JSON.stringify({ version: 1, title: "T", events: [event] }) },
      symbolicate: async (port, frames) => ({
        available: true,
        value: {
          port,
          stack: [
            { methodName: "DayCell", file: "/app/DayCell.tsx", lineNumber: 42, column: 7 },
            { methodName: "React", file: "/app/node_modules/react/index.js", lineNumber: 1, column: 1 },
          ],
        },
      }),
    }));

    assert.deepEqual(data.symbolication, { metroPort: 19000, attempted: 1, enriched: 1, errors: [] });
    assert.deepEqual(data.events[0].element.sourceLinks, [{
      methodName: "DayCell",
      fileName: "/app/DayCell.tsx",
      lineNumber: 42,
      columnNumber: 7,
    }]);
    assert.deepEqual(parseComponentStackFrames(event.element.componentStack), [{
      methodName: "DayCell",
      file: "http://localhost:8081/index.bundle",
      lineNumber: 10,
      column: 20,
    }]);
  });

  it("appends single or batched overlay events, skips non-object entries, and lets event fields override generated defaults", async () => {
    const writes: Array<{ file: string; data: string }> = [];
    const deps = memoryDeps({
      exists: new Set(["/tmp/events.json"]),
      files: { "/tmp/events.json": JSON.stringify({ version: 1, title: "T", events: [] }) },
      writes,
      now: () => new Date("2026-05-23T10:30:00.000Z"),
      random: () => 0.5,
    });

    const data = await appendReviewOverlayEvent("/tmp/events.json", {
      events: [null, "bad", { id: "event-explicit", receivedAt: "legacy-keeps-this", type: "tap" }],
    }, deps);

    assert.equal(data.events.length, 1);
    assert.deepEqual(data.events[0], { id: "event-explicit", receivedAt: "legacy-keeps-this", type: "tap" });
    assert.equal(data.savedAt, "2026-05-23T10:30:00.000Z");
    assert.match(writes.at(-1)?.data ?? "", /"savedAt": "2026-05-23T10:30:00.000Z"/);

    const generated = await appendReviewOverlayEvent("/tmp/events.json", { type: "comment" }, deps);
    assert.match(generated.events.at(-1)?.id, /^event-1779532200000-/);
  });

  it("persists annotation payloads only when comments is an array and adds savedAt", async () => {
    const writes: Array<{ file: string; data: string }> = [];
    const deps = memoryDeps({
      writes,
      now: () => new Date("2026-05-23T11:00:00.000Z"),
    });

    const saved = await persistAnnotationPayload("/tmp/annotation", { title: "A", comments: [{ text: "note" }] }, deps);
    assert.deepEqual(saved, {
      ok: true,
      annotationsPath: "/tmp/annotation/annotations.json",
      savedAt: "2026-05-23T11:00:00.000Z",
    });
    assert.match(writes[0]?.data ?? "", /"savedAt": "2026-05-23T11:00:00.000Z"/);
    await assert.rejects(() => persistAnnotationPayload("/tmp/annotation", { comments: "bad" }, deps), /annotations payload must include comments array/);
  });

  it("formats JSON responses with legacy headers and trailing newline", () => {
    assert.deepEqual(sendJsonPayload({ ok: true }, 201), {
      status: 201,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      },
      body: "{\n  \"ok\": true\n}\n",
    });
  });
});

function memoryDeps(options: {
  exists?: Set<string>;
  files?: Record<string, string>;
  writes?: Array<{ file: string; data: string }>;
  now?: () => Date;
  random?: () => number;
  symbolicate?: ReviewSidecarDependencies["symbolicateStack"];
} = {}): ReviewSidecarDependencies {
  const exists = options.exists ?? new Set<string>();
  const files = options.files ?? {};
  const writes = options.writes ?? [];
  return {
    mkdir: async () => undefined,
    pathExists: async (file) => exists.has(file),
    readFile: async (file) => files[file] ?? "{}",
    writeFile: async (file, data) => {
      writes.push({ file, data });
      files[file] = data;
      exists.add(file);
    },
    join: (...parts) => parts.join("/").replace(/\/+/g, "/"),
    now: options.now,
    random: options.random,
    symbolicateStack: options.symbolicate,
  };
}
