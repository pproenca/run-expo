import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  clampNumber,
  formatError,
  requireString,
  safeToolSection,
  truncate,
} from "../main/index.js";

describe("command-result-helpers legacy characterization", () => {
  it("safeToolSection wraps successful sync and async values", async () => {
    assert.deepEqual(await safeToolSection(() => 123), { ok: true, value: 123 });
    assert.deepEqual(await safeToolSection(async () => ({ ready: true })), {
      ok: true,
      value: { ready: true },
    });
  });

  it("safeToolSection formats thrown errors including stdout and stderr", async () => {
    const error = new Error("failed") as Error & { stdout: string; stderr: string };
    error.stdout = "out";
    error.stderr = "err";

    assert.deepEqual(await safeToolSection(() => {
      throw error;
    }), {
      ok: false,
      error: "failed\n\nstdout:\nout\n\nstderr:\nerr",
    });
  });

  it("requireString trims strings and rejects blank or non-string values", () => {
    assert.equal(requireString(" action ", "action"), "action");
    assert.equal(requireString("\nvalue\t", "field"), "value");
    assert.throws(() => requireString("", "action"), /action must be a non-empty string\./);
    assert.throws(() => requireString("   ", "name"), /name must be a non-empty string\./);
    assert.throws(() => requireString(123, "count"), /count must be a non-empty string\./);
  });

  it("clampNumber coerces finite values and clamps to inclusive bounds", () => {
    assert.equal(clampNumber("5", 1, 10), 5);
    assert.equal(clampNumber(0, 1, 10), 1);
    assert.equal(clampNumber(11, 1, 10), 10);
    assert.equal(clampNumber(7.5, 1, 10), 7.5);
  });

  it("clampNumber rejects non-finite values with legacy messages", () => {
    assert.throws(() => clampNumber("abc", 1, 10), /Expected a finite number, got abc\./);
    assert.throws(() => clampNumber(Number.POSITIVE_INFINITY, 1, 10), /Expected a finite number, got Infinity\./);
    assert.throws(() => clampNumber(undefined, 1, 10), /Expected a finite number, got undefined\./);
  });

  it("truncate stringifies nullish values and appends the legacy truncation marker", () => {
    assert.equal(truncate(null), "");
    assert.equal(truncate(undefined), "");
    assert.equal(truncate("short", 10), "short");
    assert.equal(truncate("abcdef", 3), "abc\n[truncated 3 characters]");
  });

  it("formatError handles missing, primitive, message, stdout, and stderr shapes", () => {
    assert.equal(formatError(null), "Unknown error");
    assert.equal(formatError("plain"), "plain");
    assert.equal(formatError({ message: 123 }), "123");
    assert.equal(formatError({ message: "failed", stdout: "out" }), "failed\n\nstdout:\nout");
    assert.equal(formatError({ message: "failed", stderr: "err" }), "failed\n\nstderr:\nerr");
  });

  it("formatError truncates stdout and stderr with the shared MAX_OUTPUT limit", () => {
    assert.equal(
      formatError({ message: "failed", stdout: "o".repeat(16_385), stderr: "e".repeat(16_386) }),
      [
        "failed",
        `stdout:\n${"o".repeat(16_384)}\n[truncated 1 characters]`,
        `stderr:\n${"e".repeat(16_384)}\n[truncated 2 characters]`,
      ].join("\n\n"),
    );
  });
});
