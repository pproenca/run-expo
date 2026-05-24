import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  readRequestBody,
  sendFile,
  sendJson,
} from "../main/index.js";
import type {
  HttpResponseLike,
  RequestLike,
} from "../main/index.js";

describe("http-response-stream-helpers legacy characterization", () => {
  it("sendFile reads bytes, writes 200 content type and no-store headers, then ends with bytes", async () => {
    const response = new FakeResponse();

    await sendFile(response, "/tmp/events.json", "application/json; charset=utf-8", {
      readFile: async (file) => {
        assert.equal(file, "/tmp/events.json");
        return new Uint8Array([1, 2, 3]);
      },
    });

    assert.deepEqual(response.calls, [
      ["writeHead", 200, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      }],
      ["end", new Uint8Array([1, 2, 3])],
    ]);
  });

  it("sendJson defaults to status 200 and writes pretty JSON with trailing newline", () => {
    const response = new FakeResponse();

    sendJson(response, { ok: true, nested: { count: 1 } });

    assert.deepEqual(response.calls, [
      ["writeHead", 200, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      }],
      ["end", "{\n  \"ok\": true,\n  \"nested\": {\n    \"count\": 1\n  }\n}\n"],
    ]);
  });

  it("sendJson preserves explicit status codes", () => {
    const response = new FakeResponse();

    sendJson(response, { ok: false, error: "not found" }, 404);

    assert.deepEqual(response.calls[0], ["writeHead", 404, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    }]);
  });

  it("readRequestBody sets utf8 encoding, concatenates chunks, and resolves on end", async () => {
    const request = new FakeRequest();
    const promise = readRequestBody(request, 20);

    request.emitData("hello");
    request.emitData(" ");
    request.emitData("world");
    request.emitEnd();

    assert.equal(await promise, "hello world");
    assert.equal(request.encoding, "utf8");
    assert.equal(request.destroyed, false);
  });

  it("readRequestBody rejects and destroys the request after the body exceeds the limit", async () => {
    const request = new FakeRequest();
    const promise = readRequestBody(request, 5);

    request.emitData("hello");
    request.emitData("!");

    await assert.rejects(promise, /request body too large/);
    assert.equal(request.destroyed, true);
  });

  it("readRequestBody rejects with request error events", async () => {
    const request = new FakeRequest();
    const promise = readRequestBody(request, 20);
    const error = new Error("socket failed");

    request.emitError(error);

    await assert.rejects(promise, (actual: unknown) => actual === error);
  });
});

class FakeResponse implements HttpResponseLike {
  readonly calls: unknown[][] = [];

  writeHead(status: number, headers: Record<string, string>): void {
    this.calls.push(["writeHead", status, headers]);
  }

  end(body: unknown): void {
    this.calls.push(["end", body]);
  }
}

class FakeRequest implements RequestLike {
  encoding: string | null = null;
  destroyed = false;
  private dataListeners: Array<(chunk: unknown) => void> = [];
  private endListeners: Array<() => void> = [];
  private errorListeners: Array<(error: unknown) => void> = [];

  setEncoding(encoding: "utf8"): void {
    this.encoding = encoding;
  }

  on(event: "data" | "end" | "error", listener: ((chunk: unknown) => void) | (() => void)): void {
    if (event === "data") this.dataListeners.push(listener as (chunk: unknown) => void);
    if (event === "end") this.endListeners.push(listener as () => void);
    if (event === "error") this.errorListeners.push(listener as (error: unknown) => void);
  }

  destroy(): void {
    this.destroyed = true;
  }

  emitData(chunk: unknown): void {
    for (const listener of this.dataListeners) listener(chunk);
  }

  emitEnd(): void {
    for (const listener of this.endListeners) listener();
  }

  emitError(error: unknown): void {
    for (const listener of this.errorListeners) listener(error);
  }
}
