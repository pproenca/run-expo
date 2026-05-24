import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  fetchMetroTargets,
  fetchMetroTargetsForDiscovery,
} from "../main/index.js";

describe("metro-target-list-adapter legacy characterization", () => {
  it("fetches the legacy Metro /json/list loopback URL with the target discovery timeout", async () => {
    const calls: Array<{ url: string; timeoutMs: number }> = [];
    const result = await fetchMetroTargets(19000, {
      fetchLocalJson: (url, options) => {
        calls.push({ url, timeoutMs: options.timeoutMs });
        return [{ id: "target-1" }];
      },
    });

    assert.deepEqual(result, [{ id: "target-1" }]);
    assert.deepEqual(calls, [{
      url: "http://127.0.0.1:19000/json/list",
      timeoutMs: 1000,
    }]);
  });

  it("preserves the raw Metro payload shape for the domain normalizer", async () => {
    const objectPayload = { unexpected: true };
    assert.equal(await fetchMetroTargets(8081, {
      fetchLocalJson: () => objectPayload,
    }), objectPayload);
    assert.equal(await fetchMetroTargets(8081, {
      fetchLocalJson: () => "not an array",
    }), "not an array");
  });

  it("lets direct fetch failures propagate when called outside discovery fallback", async () => {
    await assert.rejects(
      () => fetchMetroTargets(8081, {
        fetchLocalJson: () => {
          throw new Error("connection refused");
        },
      }),
      /connection refused/,
    );
  });

  it("converts Metro fetch failures to an empty list for legacy target discovery", async () => {
    const result = await fetchMetroTargetsForDiscovery(8081, {
      fetchLocalJson: () => {
        throw new Error("connection refused");
      },
    });

    assert.deepEqual(result, []);
  });

  it("also handles rejected async fetch failures in the discovery fallback", async () => {
    const result = await fetchMetroTargetsForDiscovery(8081, {
      fetchLocalJson: async () => {
        throw new Error("timeout");
      },
    });

    assert.deepEqual(result, []);
  });
});
