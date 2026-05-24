import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  fetchLocalJson,
  fetchLocalLoopback,
  fetchLocalText,
  fetchLocalTextDirect,
  loopbackUrlCandidates,
} from "../main/index.js";
import type { FetchLike, FetchResponseLike } from "../main/index.js";

describe("local-loopback-fetch legacy characterization", () => {
  it("expands loopback URLs in the legacy host fallback order", () => {
    assert.deepEqual(loopbackUrlCandidates("http://127.0.0.1:8081/status"), [
      "http://127.0.0.1:8081/status",
      "http://localhost:8081/status",
      "http://[::1]:8081/status",
    ]);
    assert.deepEqual(loopbackUrlCandidates("http://localhost:19000/json/list?device=iPhone"), [
      "http://127.0.0.1:19000/json/list?device=iPhone",
      "http://localhost:19000/json/list?device=iPhone",
      "http://[::1]:19000/json/list?device=iPhone",
    ]);
    assert.deepEqual(loopbackUrlCandidates("http://[::1]:8081/status"), [
      "http://127.0.0.1:8081/status",
      "http://localhost:8081/status",
      "http://[::1]:8081/status",
    ]);
  });

  it("leaves non-loopback and invalid URLs untouched", () => {
    assert.deepEqual(loopbackUrlCandidates("https://expo.dev/status"), ["https://expo.dev/status"]);
    assert.deepEqual(loopbackUrlCandidates("not a url"), ["not a url"]);
  });

  it("retries candidates until a fetch succeeds and removes timeoutMs from fetch options", async () => {
    const calls: Array<{ url: string; method: string | undefined; hasSignal: boolean; hasTimeoutMs: boolean }> = [];
    const fetcher: FetchLike = async (url, init) => {
      calls.push({
        url,
        method: init.method,
        hasSignal: init.signal instanceof AbortSignal,
        hasTimeoutMs: "timeoutMs" in init,
      });
      if (url.includes("127.0.0.1")) throw new Error("connection refused");
      return response(true, 204, "ok");
    };

    const result = await fetchLocalLoopback("http://127.0.0.1:8081/symbolicate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
      timeoutMs: 25,
    }, { fetch: fetcher });

    assert.equal(result.status, 204);
    assert.deepEqual(calls, [
      {
        url: "http://127.0.0.1:8081/symbolicate",
        method: "POST",
        hasSignal: true,
        hasTimeoutMs: false,
      },
      {
        url: "http://localhost:8081/symbolicate",
        method: "POST",
        hasSignal: true,
        hasTimeoutMs: false,
      },
    ]);
  });

  it("throws the last fetch error after every loopback candidate fails", async () => {
    const calls: string[] = [];
    const fetcher: FetchLike = async (url) => {
      calls.push(url);
      throw new Error(`failed ${calls.length}`);
    };

    await assert.rejects(
      () => fetchLocalLoopback("http://localhost:8081/status", { timeoutMs: 10 }, { fetch: fetcher }),
      /failed 3/,
    );
    assert.deepEqual(calls, [
      "http://127.0.0.1:8081/status",
      "http://localhost:8081/status",
      "http://[::1]:8081/status",
    ]);
  });

  it("aborts a hanging request when the timeout elapses", async () => {
    const aborted: string[] = [];
    const fetcher: FetchLike = (url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => {
        aborted.push(url);
        reject(new Error(`aborted ${url}`));
      }, { once: true });
    });

    await assert.rejects(
      () => fetchLocalLoopback("bad-url", { timeoutMs: 1 }, { fetch: fetcher }),
      /aborted bad-url/,
    );
    assert.deepEqual(aborted, ["bad-url"]);
  });

  it("converts HTTP responses to text and JSON exactly like the legacy helpers", async () => {
    const fetcher: FetchLike = async (url) => {
      if (url.endsWith("/ok")) return response(true, 200, "{\"available\":true}");
      return response(false, 503, "down");
    };

    assert.equal(await fetchLocalText("http://localhost:8081/ok", { timeoutMs: 25 }, { fetch: fetcher }), "{\"available\":true}");
    assert.deepEqual(await fetchLocalJson("http://localhost:8081/ok", { timeoutMs: 25 }, { fetch: fetcher }), {
      available: true,
    });
    await assert.rejects(
      () => fetchLocalText("http://localhost:8081/down", { timeoutMs: 25 }, { fetch: fetcher }),
      /HTTP 503/,
    );
  });

  it("fetchLocalTextDirect never applies loopback fallback", async () => {
    const calls: string[] = [];
    const fetcher: FetchLike = async (url) => {
      calls.push(url);
      return response(false, 404, "missing");
    };

    await assert.rejects(
      () => fetchLocalTextDirect("http://localhost:8081/status", { timeoutMs: 25 }, { fetch: fetcher }),
      /HTTP 404/,
    );
    assert.deepEqual(calls, ["http://localhost:8081/status"]);
  });
});

function response(ok: boolean, status: number, body: string): FetchResponseLike {
  return {
    ok,
    status,
    async text() {
      return body;
    },
  };
}
