import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  MAX_OUTPUT,
  createAppLifecycleExecFile,
  execFilePromise,
  normalizeExecError,
} from "../main/index.js";
import type { NodeExecFileAdapter } from "../main/index.js";

describe("app-lifecycle-process-adapter legacy characterization", () => {
  it("creates a lifecycle-shaped execFile dependency with explicit options", async () => {
    const calls: unknown[] = [];
    const execFile = createAppLifecycleExecFile(deps((file, args, options, callback) => {
      calls.push({ file, args, options });
      callback(null, "booted", "");
      return {};
    }));

    assert.deepEqual(await execFile("xcrun", ["simctl", "boot", "SIM-1"], { timeout: 60_000, rejectOnError: false }), {
      stdout: "booted",
      stderr: "",
      error: null,
    });
    assert.deepEqual(calls, [{
      file: "xcrun",
      args: ["simctl", "boot", "SIM-1"],
      options: { cwd: "/repo", env: { PATH: "/bin" }, timeout: 60_000, maxBuffer: MAX_OUTPUT },
    }]);
  });

  it("preserves legacy defaults for cwd, env, timeout, maxBuffer, and strings", async () => {
    const calls: unknown[] = [];
    const result = await execFilePromise("adb", ["devices"], {}, deps((file, args, options, callback) => {
      calls.push({ file, args, options });
      callback(null, null, undefined);
      return {};
    }));

    assert.deepEqual(calls, [{
      file: "adb",
      args: ["devices"],
      options: { cwd: "/repo", env: { PATH: "/bin" }, timeout: 60_000, maxBuffer: MAX_OUTPUT },
    }]);
    assert.deepEqual(result, { stdout: "", stderr: "", error: null });
  });

  it("allows explicit cwd, env, timeout, and maxBuffer overrides", async () => {
    await execFilePromise("xcrun", ["log", "show"], {
      cwd: "/tmp/project",
      env: { CUSTOM: "1" },
      timeout: 20_000,
      maxBuffer: 12_345,
    }, deps((file, args, options, callback) => {
      assert.equal(file, "xcrun");
      assert.deepEqual(args, ["log", "show"]);
      assert.deepEqual(options, { cwd: "/tmp/project", env: { CUSTOM: "1" }, timeout: 20_000, maxBuffer: 12_345 });
      callback(null, "", "");
      return {};
    }));
  });

  it("rejects with stdout and stderr attached when rejectOnError is true", async () => {
    const error: Record<string, unknown> = { message: "failed" };

    await assert.rejects(
      () => execFilePromise("xcrun", ["bad"], {}, deps((_file, _args, _options, callback) => {
        callback(error, "stdout text", "stderr text");
        return {};
      })),
      (rejected: any) => {
        assert.equal(rejected, error);
        assert.equal(rejected.stdout, "stdout text");
        assert.equal(rejected.stderr, "stderr text");
        return true;
      },
    );
  });

  it("resolves normalized errors when rejectOnError is false", async () => {
    const result = await execFilePromise("adb", ["install"], {
      rejectOnError: false,
    }, deps((_file, _args, _options, callback) => {
      callback({ message: "install failed", code: 1, signal: "SIGTERM" }, "out", "err");
      return {};
    }));

    assert.deepEqual(result, {
      stdout: "out",
      stderr: "err",
      error: { message: "install failed", code: 1, signal: "SIGTERM" },
    });
  });

  it("forwards optional stdin and normalizes non-object errors", async () => {
    let inputValue: string | Uint8Array | null | undefined;
    const result = await execFilePromise("xcrun", ["simctl", "pbcopy", "SIM-1"], {
      input: "clipboard text",
      rejectOnError: false,
    }, deps((_file, _args, _options, callback) => {
      callback("bad", null, null);
      return { stdin: { end: (input) => { inputValue = input; } } };
    }));

    assert.equal(inputValue, "clipboard text");
    assert.deepEqual(result, { stdout: "", stderr: "", error: { message: "bad", code: undefined, signal: undefined } });
    assert.deepEqual(normalizeExecError("bad"), { message: "bad", code: undefined, signal: undefined });
  });
});

function deps(execFile: NodeExecFileAdapter) {
  return {
    execFile,
    cwd: () => "/repo",
    env: () => ({ PATH: "/bin" }),
  };
}
