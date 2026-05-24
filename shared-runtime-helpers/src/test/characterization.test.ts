import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  processNameFromBundleId,
  redactUrlAuthCookie,
  requireOptionalString,
  withTimeout,
} from "../main/index.js";

describe("shared-runtime-helpers legacy characterization", () => {
  it("requireOptionalString trims non-empty strings and returns null otherwise", () => {
    assert.equal(requireOptionalString(" value "), "value");
    assert.equal(requireOptionalString("\n\tvalue\t"), "value");
    assert.equal(requireOptionalString(""), null);
    assert.equal(requireOptionalString("   "), null);
    assert.equal(requireOptionalString(123), null);
    assert.equal(requireOptionalString(null), null);
    assert.equal(requireOptionalString({ value: "x" }), null);
  });

  it("processNameFromBundleId uses the last non-empty segment and strips unsupported characters", () => {
    assert.equal(processNameFromBundleId("host.exp.Exponent"), "Exponent");
    assert.equal(processNameFromBundleId("com.example.My-App_1"), "My-App_1");
    assert.equal(processNameFromBundleId("com.example.My App!"), "MyApp");
    assert.equal(processNameFromBundleId("com.example."), "example");
    assert.equal(processNameFromBundleId(".only"), "only");
    assert.equal(processNameFromBundleId("..."), null);
    assert.equal(processNameFromBundleId(""), null);
    assert.equal(processNameFromBundleId(null), null);
    assert.equal(processNameFromBundleId(123), "123");
  });

  it("redactUrlAuthCookie redacts only the cookie query parameter on parseable URLs", () => {
    assert.equal(
      redactUrlAuthCookie("https://example.test/path?cookie=secret&x=1"),
      "https://example.test/path?cookie=%5Bredacted%5D&x=1",
    );
    assert.equal(
      redactUrlAuthCookie("https://example.test/path?x=1&cookie=secret"),
      "https://example.test/path?x=1&cookie=%5Bredacted%5D",
    );
    assert.equal(
      redactUrlAuthCookie("https://example.test/path?authCookie=secret&x=1"),
      "https://example.test/path?authCookie=secret&x=1",
    );
  });

  it("redactUrlAuthCookie uses the legacy case-insensitive regex fallback for invalid URLs", () => {
    assert.equal(redactUrlAuthCookie("not-a-url?cookie=secret&x=1"), "not-a-url?cookie=[redacted]&x=1");
    assert.equal(redactUrlAuthCookie("not-a-url?Cookie=secret&x=1"), "not-a-url?Cookie=[redacted]&x=1");
    assert.equal(redactUrlAuthCookie("not-a-url?x=1&cookie=secret"), "not-a-url?x=1&cookie=[redacted]");
    assert.equal(redactUrlAuthCookie("not-a-url?authCookie=secret"), "not-a-url?authCookie=secret");
  });

  it("withTimeout resolves the original promise when it wins the race", async () => {
    assert.equal(await withTimeout(Promise.resolve("done"), 50, "fallback"), "done");
  });

  it("withTimeout returns the fallback when the timer wins the race", async () => {
    assert.equal(await withTimeout(delay(25).then(() => "late"), 1, "fallback"), "fallback");
  });

  it("withTimeout propagates original promise rejection when it wins the race", async () => {
    await assert.rejects(
      () => withTimeout(Promise.reject(new Error("boom")), 50, "fallback"),
      /boom/,
    );
  });
});

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
