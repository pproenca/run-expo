import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  OVERLAY_BODY_LIMIT,
  handleReviewOverlayRequest,
  normalizeEndpointPath,
  readRequestBodyText,
  readSimulatorPointer,
  reviewOverlayServerStartupPayload,
  sendJsonPayload,
  setCorsHeaders,
} from "../main/index.js";
import type { ReviewOverlayServerDependencies } from "../main/index.js";

describe("review-overlay-server-http legacy characterization", () => {
  it("adds legacy wildcard CORS headers and handles OPTIONS with empty 204", async () => {
    assert.deepEqual(setCorsHeaders({}), {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,POST,DELETE,OPTIONS",
      "access-control-allow-headers": "content-type",
    });
    assert.deepEqual(await handleReviewOverlayRequest({ method: "OPTIONS", url: "/anything" }, baseOptions(), deps()), {
      status: 204,
      headers: setCorsHeaders({}),
      body: "",
    });
  });

  it("serves health, pointer defaults, copy, and events.json routes", async () => {
    const writes: string[] = [];
    const health = await handleReviewOverlayRequest({ method: "GET", url: "/health" }, baseOptions(), deps());
    const pointer = await handleReviewOverlayRequest({ method: "GET", url: "/pointer?viewportWidth=bad&viewportHeight=0" }, baseOptions(), deps({
      readPointer: async (args) => ({ ok: true, args }),
    }));
    const copy = await handleReviewOverlayRequest({ method: "POST", url: "/copy", body: JSON.stringify({ text: "hello" }) }, baseOptions(), deps({
      writeClipboard: async (text) => {
        writes.push(text);
        return true;
      },
    }));
    const events = await handleReviewOverlayRequest({ method: "GET", url: "/events.json" }, baseOptions(), deps({ files: { "/tmp/overlay/events.json": "{\"events\":[]}" } }));

    assert.deepEqual(JSON.parse(health.body), { ok: true, endpoint: "/events", eventsPath: "/tmp/overlay/events.json" });
    assert.deepEqual(JSON.parse(pointer.body), { ok: true, args: { viewportWidth: 393, viewportHeight: 852 } });
    assert.deepEqual(writes, ["hello"]);
    assert.deepEqual(JSON.parse(copy.body), { ok: true, copied: true });
    assert.deepEqual(events, {
      status: 200,
      headers: { ...setCorsHeaders({}), "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
      body: "{\"events\":[]}",
    });
  });

  it("handles configured event endpoint GET, POST append, DELETE clear, and missing routes", async () => {
    const appended: Array<{ path: string; payload: unknown }> = [];
    const read = await handleReviewOverlayRequest({ method: "GET", url: "/events" }, baseOptions(), deps({
      readEvents: async () => ({ version: 1, events: [{ id: "a" }] }),
    }));
    const post = await handleReviewOverlayRequest({ method: "POST", url: "/events", body: JSON.stringify({ type: "tap" }) }, baseOptions(), deps({
      appendEvent: async (path, payload) => {
        appended.push({ path, payload });
        return { events: [{ id: "a" }, { id: "b" }] };
      },
    }));
    const deleted = await handleReviewOverlayRequest({ method: "DELETE", url: "/events" }, baseOptions(), deps({
      createEventsFile: async () => ({ events: [] }),
    }));
    const missing = await handleReviewOverlayRequest({ method: "GET", url: "/nope" }, baseOptions(), deps());

    assert.deepEqual(JSON.parse(read.body), { version: 1, events: [{ id: "a" }] });
    assert.deepEqual(appended, [{ path: "/tmp/overlay/events.json", payload: { type: "tap" } }]);
    assert.deepEqual(JSON.parse(post.body), { ok: true, eventCount: 2, eventsPath: "/tmp/overlay/events.json" });
    assert.deepEqual(JSON.parse(deleted.body), { ok: true, cleared: true, eventCount: 0, eventsPath: "/tmp/overlay/events.json" });
    assert.deepEqual(missing, sendJsonPayload({ ok: false, error: "not found" }, 404, setCorsHeaders({})));
  });

  it("wraps malformed requests and body-limit failures as JSON 500", async () => {
    const malformed = await handleReviewOverlayRequest({ method: "POST", url: "/events", body: "{" }, baseOptions(), deps());
    const tooLarge = await handleReviewOverlayRequest({ method: "POST", url: "/copy", body: "x".repeat(OVERLAY_BODY_LIMIT + 1) }, baseOptions(), deps());

    assert.equal(malformed.status, 500);
    assert.match(JSON.parse(malformed.body).error, /Expected property name|JSON/);
    assert.deepEqual(JSON.parse(tooLarge.body), { ok: false, error: "request body too large" });
    assert.equal(await readRequestBodyText("", 5), "");
    await assert.rejects(() => readRequestBodyText("abcdef", 5), /request body too large/);
  });

  it("maps simulator pointer coordinates and preserves startup/endpoint helper contracts", async () => {
    const pointer = await readSimulatorPointer({
      viewportWidth: 400,
      viewportHeight: 800,
      platform: "darwin",
      readCursor: async () => ({ x: 150, y: 300 }),
      readWindow: async () => ({ x: 50, y: 100, width: 200, height: 400 }),
    });
    const unavailable = await readSimulatorPointer({
      viewportWidth: 400,
      viewportHeight: 800,
      platform: "linux",
      readCursor: async () => ({ x: 0, y: 0 }),
      readWindow: async () => ({ x: 0, y: 0, width: 1, height: 1 }),
    });

    assert.deepEqual(pointer, {
      ok: true,
      inside: true,
      point: { x: 200, y: 400 },
      cursor: { x: 150, y: 300 },
      simulatorWindow: { x: 50, y: 100, width: 200, height: 400 },
      mapping: "mac-cursor-to-simulator-window",
    });
    assert.deepEqual(unavailable, { ok: false, inside: false, error: "pointer bridge requires macOS Simulator" });
    assert.deepEqual(reviewOverlayServerStartupPayload({ port: 17655, endpointPath: "/events", eventsPath: "/tmp/overlay/events.json" }), {
      ok: true,
      url: "http://127.0.0.1:17655/",
      endpoint: "http://127.0.0.1:17655/events",
      eventsPath: "/tmp/overlay/events.json",
    });
    assert.equal(normalizeEndpointPath(undefined), "/events");
    assert.equal(normalizeEndpointPath("custom"), "/custom");
    assert.throws(() => normalizeEndpointPath("/bad?x=1"), /endpointPath must be a simple URL path/);
  });
});

function baseOptions() {
  return { dir: "/tmp/overlay", port: 17655, endpointPath: "/events", eventsPath: "/tmp/overlay/events.json" };
}

function deps(overrides: Partial<ReviewOverlayServerDependencies> & { files?: Record<string, string> } = {}): ReviewOverlayServerDependencies {
  const files = overrides.files ?? {};
  return {
    joinPath: (...parts) => parts.join("/").replace(/\/+/g, "/"),
    readFile: async (file) => files[file] ?? "",
    createEventsFile: async () => ({ events: [] }),
    readEvents: async () => ({ events: [] }),
    appendEvent: async () => ({ events: [] }),
    readPointer: async (args) => ({ ok: true, args }),
    writeClipboard: async () => false,
    ...overrides,
  };
}
