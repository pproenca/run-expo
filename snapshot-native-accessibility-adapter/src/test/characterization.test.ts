import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  SNAPSHOT_AXE_MAX_BUFFER,
  SNAPSHOT_AXE_TIMEOUT_MS,
  commandPath,
  describeNativeUi,
  execFilePromise,
  findAxeCli,
  normalizeExecError,
} from "../main/index.js";
import type { ExecFileAdapter } from "../main/index.js";

describe("snapshot-native-accessibility-adapter legacy characterization", () => {
  it("findAxeCli uses commandPath with legacy shell lookup options", async () => {
    const calls: any[] = [];
    const deps = execDeps((file, args, options, callback) => {
      calls.push({ file, args, options });
      callback(null, " /opt/homebrew/bin/axe \n", "");
      return {};
    });

    assert.equal(await findAxeCli(deps), "/opt/homebrew/bin/axe");
    assert.deepEqual(calls, [{
      file: "sh",
      args: ["-lc", "command -v axe"],
      options: { cwd: "/cwd", env: { TEST_ENV: "1" }, timeout: 5000, maxBuffer: 40_000 },
    }]);
  });

  it("commandPath returns null when lookup stdout is empty", async () => {
    const deps = execDeps((_file, _args, _options, callback) => {
      callback(null, "\n", "");
      return {};
    });

    assert.equal(await commandPath("axe", deps), null);
  });

  it("describeNativeUi runs axe describe-ui with legacy timeout, buffer, and non-rejecting errors", async () => {
    const calls: any[] = [];
    const deps = execDeps((file, args, options, callback) => {
      calls.push({ file, args, options });
      callback(null, "[{\"role\":\"AXButton\"}]", "");
      return {};
    });

    assert.deepEqual(await describeNativeUi("/usr/local/bin/axe", "SIM-123", deps), {
      stdout: "[{\"role\":\"AXButton\"}]",
      stderr: "",
      error: null,
    });
    assert.deepEqual(calls, [{
      file: "/usr/local/bin/axe",
      args: ["describe-ui", "--udid", "SIM-123"],
      options: { cwd: "/cwd", env: { TEST_ENV: "1" }, timeout: SNAPSHOT_AXE_TIMEOUT_MS, maxBuffer: SNAPSHOT_AXE_MAX_BUFFER },
    }]);
  });

  it("describeNativeUi normalizes process errors instead of rejecting", async () => {
    const deps = execDeps((_file, _args, _options, callback) => {
      callback({ message: "failed", code: 70, signal: "SIGTERM" }, "partial", "stderr text");
      return {};
    });

    assert.deepEqual(await describeNativeUi("axe", "SIM-123", deps), {
      stdout: "partial",
      stderr: "stderr text",
      error: { message: "failed", code: 70, signal: "SIGTERM" },
    });
  });

  it("execFilePromise rejects with attached stdout and stderr when rejectOnError is true", async () => {
    const error: Record<string, unknown> = { message: "failed" };
    const deps = execDeps((_file, _args, _options, callback) => {
      callback(error, "stdout text", "stderr text");
      return {};
    });

    await assert.rejects(
      () => execFilePromise("axe", ["bad"], { rejectOnError: true }, deps),
      (rejected: any) => {
        assert.equal(rejected, error);
        assert.equal(rejected.stdout, "stdout text");
        assert.equal(rejected.stderr, "stderr text");
        return true;
      },
    );
  });

  it("execFilePromise forwards optional stdin input and normalizes non-object errors", async () => {
    let inputValue: string | Uint8Array | null | undefined;
    const deps = execDeps((_file, _args, _options, callback) => {
      callback("bad", null, null);
      return { stdin: { end: (input) => { inputValue = input; } } };
    });

    assert.deepEqual(
      await execFilePromise("tool", [], { input: "payload", rejectOnError: false }, deps),
      { stdout: "", stderr: "", error: { message: "bad", code: undefined, signal: undefined } },
    );
    assert.equal(inputValue, "payload");
    assert.deepEqual(normalizeExecError("bad"), { message: "bad", code: undefined, signal: undefined });
  });
});

function execDeps(execFile: ExecFileAdapter) {
  return {
    execFile,
    cwd: () => "/cwd",
    env: () => ({ TEST_ENV: "1" }),
  };
}
