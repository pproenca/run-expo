import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  ANNOTATION_BODY_LIMIT,
  annotationServer,
  annotationServerStartupPayload,
  clampNumber,
  handleAnnotationRequest,
  readRequestBodyText,
  requireString,
  sendJsonPayload,
} from "../main/index.js";
import type {
  AnnotationRequestHandler,
  AnnotationServerCommandDependencies,
  AnnotationServerDependencies,
} from "../main/index.js";

describe("annotation-server-http legacy characterization", () => {
  it("starts the annotation server command on loopback and prints the startup payload", async () => {
    const stdout: string[] = [];
    const listens: Array<{ host: string; port: number; handler: AnnotationRequestHandler }> = [];
    const deps = commandDeps({
      files: { "/abs/ann/annotate.html": "<html>" },
      stdout,
      listens,
    });

    assert.deepEqual(await annotationServer({ dir: "ann" }, deps), {
      ok: true,
      url: "http://127.0.0.1:17654/",
      dir: "/abs/ann",
    });
    assert.equal(listens.length, 1);
    assert.deepEqual({ host: listens[0]?.host, port: listens[0]?.port }, { host: "127.0.0.1", port: 17654 });
    assert.equal(stdout[0], `${JSON.stringify({ ok: true, url: "http://127.0.0.1:17654/", dir: "/abs/ann" }, null, 2)}\n`);
    assert.deepEqual(await listens[0]?.handler({ method: "GET", url: "/" }), fileResponse("<html>", "text/html; charset=utf-8"));
  });

  it("clamps the annotation server command port and requires a directory", async () => {
    const listens: Array<{ host: string; port: number; handler: AnnotationRequestHandler }> = [];

    assert.deepEqual(await annotationServer({ dir: "/tmp/ann", port: 70_000 }, commandDeps({ listens })), {
      ok: true,
      url: "http://127.0.0.1:65535/",
      dir: "/tmp/ann",
    });
    assert.equal(listens[0]?.port, 65535);
    await assert.rejects(() => annotationServer({ port: 17654 }, commandDeps()), /dir must be a non-empty string/);
  });

  it("can delegate the legacy forever wait after server startup", async () => {
    const forever = new Error("stop test wait");

    await assert.rejects(
      () => annotationServer({ dir: "/tmp/ann" }, commandDeps({
        waitForever: async () => {
          throw forever;
        },
      })),
      forever,
    );
  });

  it("serves annotation HTML, screenshot, context, and annotations files with no-store headers", async () => {
    const deps = memoryDeps({ files: {
      "/tmp/ann/annotate.html": "<html>",
      "/tmp/ann/screenshot.png": "PNG",
      "/tmp/ann/context.json": "{}",
      "/tmp/ann/annotations.json": "{\"comments\":[]}",
    } });

    assert.deepEqual(await handleAnnotationRequest({ method: "GET", url: "/" }, { dir: "/tmp/ann", port: 17654 }, deps), fileResponse("<html>", "text/html; charset=utf-8"));
    assert.deepEqual(await handleAnnotationRequest({ method: "GET", url: "/annotate.html" }, { dir: "/tmp/ann", port: 17654 }, deps), fileResponse("<html>", "text/html; charset=utf-8"));
    assert.deepEqual(await handleAnnotationRequest({ method: "GET", url: "/screenshot.png" }, { dir: "/tmp/ann", port: 17654 }, deps), fileResponse("PNG", "image/png"));
    assert.deepEqual(await handleAnnotationRequest({ method: "GET", url: "/context.json" }, { dir: "/tmp/ann", port: 17654 }, deps), fileResponse("{}", "application/json; charset=utf-8"));
    assert.deepEqual(await handleAnnotationRequest({ method: "GET", url: "/annotations.json" }, { dir: "/tmp/ann", port: 17654 }, deps), fileResponse("{\"comments\":[]}", "application/json; charset=utf-8"));
  });

  it("persists POST /annotations payloads with comments arrays and savedAt", async () => {
    const writes: Array<{ file: string; data: string }> = [];
    const response = await handleAnnotationRequest({
      method: "POST",
      url: "/annotations",
      body: JSON.stringify({ title: "T", comments: [{ text: "note" }] }),
    }, { dir: "/tmp/ann", port: 17654 }, memoryDeps({
      writes,
      now: () => new Date("2026-05-23T10:00:00.000Z"),
    }));

    assert.equal(response.status, 200);
    assert.deepEqual(JSON.parse(response.body), {
      ok: true,
      annotationsPath: "/tmp/ann/annotations.json",
      savedAt: "2026-05-23T10:00:00.000Z",
    });
    assert.equal(writes[0]?.file, "/tmp/ann/annotations.json");
    assert.deepEqual(JSON.parse(writes[0]?.data ?? "{}"), {
      title: "T",
      comments: [{ text: "note" }],
      savedAt: "2026-05-23T10:00:00.000Z",
    });
  });

  it("returns 404 JSON for unsupported routes and 500 JSON for malformed annotation payloads", async () => {
    const missing = await handleAnnotationRequest({ method: "GET", url: "/missing" }, { dir: "/tmp/ann", port: 17654 }, memoryDeps());
    const malformed = await handleAnnotationRequest({ method: "POST", url: "/annotations", body: "{\"comments\":\"bad\"}" }, { dir: "/tmp/ann", port: 17654 }, memoryDeps());
    const badJson = await handleAnnotationRequest({ method: "POST", url: "/annotations", body: "{" }, { dir: "/tmp/ann", port: 17654 }, memoryDeps());

    assert.deepEqual(missing, sendJsonPayload({ ok: false, error: "not found" }, 404));
    assert.equal(malformed.status, 500);
    assert.deepEqual(JSON.parse(malformed.body), { ok: false, error: "annotations payload must include comments array" });
    assert.equal(badJson.status, 500);
    assert.match(JSON.parse(badJson.body).error, /Expected property name|JSON/);
  });

  it("enforces the legacy request body size limit and preserves startup/helper contracts", async () => {
    const tooLarge = await handleAnnotationRequest({ method: "POST", url: "/annotations", body: "x".repeat(ANNOTATION_BODY_LIMIT + 1) }, { dir: "/tmp/ann", port: 17654 }, memoryDeps());

    assert.equal(tooLarge.status, 500);
    assert.deepEqual(JSON.parse(tooLarge.body), { ok: false, error: "request body too large" });
    assert.equal(await readRequestBodyText("", 5), "");
    await assert.rejects(() => readRequestBodyText("abcdef", 5), /request body too large/);
    assert.deepEqual(annotationServerStartupPayload("/tmp/ann", 17654), { ok: true, url: "http://127.0.0.1:17654/", dir: "/tmp/ann" });
    assert.equal(requireString(" dir ", "dir"), "dir");
    assert.throws(() => requireString("", "dir"), /dir must be a non-empty string/);
    assert.equal(clampNumber("70000", 1, 65535), 65535);
    assert.throws(() => clampNumber("bad", 1, 65535), /Expected a finite number, got bad/);
  });
});

function memoryDeps(options: {
  files?: Record<string, string>;
  writes?: Array<{ file: string; data: string }>;
  now?: () => Date;
} = {}): AnnotationServerDependencies {
  const files = options.files ?? {};
  const writes = options.writes ?? [];
  return {
    joinPath: (...parts) => parts.join("/").replace(/\/+/g, "/"),
    readFile: async (file) => files[file] ?? "",
    writeFile: async (file, data) => {
      writes.push({ file, data });
      files[file] = data;
    },
    now: options.now,
  };
}

function commandDeps(options: {
  files?: Record<string, string>;
  writes?: Array<{ file: string; data: string }>;
  stdout?: string[];
  listens?: Array<{ host: string; port: number; handler: AnnotationRequestHandler }>;
  waitForever?: () => Promise<never>;
} = {}): AnnotationServerCommandDependencies {
  const stdout = options.stdout ?? [];
  const listens = options.listens ?? [];
  return {
    ...memoryDeps(options),
    resolvePath: (value) => value.startsWith("/") ? value : `/abs/${value}`,
    listen: (listenOptions) => {
      listens.push(listenOptions);
    },
    stdout: (text) => stdout.push(text),
    waitForever: options.waitForever,
  };
}

function fileResponse(body: string, contentType: string) {
  return {
    status: 200,
    headers: {
      "content-type": contentType,
      "cache-control": "no-store",
    },
    body,
  };
}
