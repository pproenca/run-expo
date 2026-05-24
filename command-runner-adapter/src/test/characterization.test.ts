import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  MAX_OUTPUT,
  commandPath,
  execFilePromise,
  normalizeExecError,
} from "../main/index.js";
import type {
  CommandRunnerDependencies,
  ExecFileAdapter,
} from "../main/index.js";

function deps(execFile: ExecFileAdapter): CommandRunnerDependencies {
  return {
    execFile,
    cwd: () => "/repo",
    env: () => ({ PATH: "/bin" }),
  };
}

describe("command-runner-adapter legacy characterization", () => {
  it("uses legacy exec defaults and resolves stdout/stderr strings on success", async () => {
    const calls: unknown[] = [];
    const result = await execFilePromise("xcrun", ["simctl", "list"], {}, deps((file, args, options, callback) => {
      calls.push({ file, args, options });
      callback(null, "stdout", "stderr");
      return {};
    }));

    assert.deepEqual(calls, [{
      file: "xcrun",
      args: ["simctl", "list"],
      options: {
        cwd: "/repo",
        env: { PATH: "/bin" },
        timeout: 60_000,
        maxBuffer: MAX_OUTPUT,
      },
    }]);
    assert.deepEqual(result, { stdout: "stdout", stderr: "stderr", error: null });
  });

  it("preserves explicit cwd, env, timeout, maxBuffer, and stdin input", async () => {
    const stdinWrites: unknown[] = [];
    const result = await execFilePromise("pbcopy", [], {
      cwd: "/tmp",
      env: { CUSTOM: "1" },
      timeout: 1500,
      maxBuffer: 99,
      input: "hello",
    }, deps((file, args, options, callback) => {
      assert.equal(file, "pbcopy");
      assert.deepEqual(args, []);
      assert.deepEqual(options, {
        cwd: "/tmp",
        env: { CUSTOM: "1" },
        timeout: 1500,
        maxBuffer: 99,
      });
      callback(null, null, undefined);
      return { stdin: { end: (input) => stdinWrites.push(input) } };
    }));

    assert.deepEqual(stdinWrites, ["hello"]);
    assert.deepEqual(result, { stdout: "", stderr: "", error: null });
  });

  it("rejects with stdout and stderr attached when rejectOnError is true", async () => {
    const error = Object.assign(new Error("failed"), { code: 7 });

    await assert.rejects(
      () => execFilePromise("xcrun", ["bad"], {}, deps((_file, _args, _options, callback) => {
        callback(error, "captured stdout", "captured stderr");
        return {};
      })),
      (actual: unknown) => actual === error &&
        (actual as { stdout?: unknown }).stdout === "captured stdout" &&
        (actual as { stderr?: unknown }).stderr === "captured stderr",
    );
  });

  it("resolves normalized errors when rejectOnError is false", async () => {
    const error = Object.assign(new Error("failed"), { code: 7, signal: "SIGTERM" });
    const result = await execFilePromise("xcrun", ["bad"], {
      rejectOnError: false,
    }, deps((_file, _args, _options, callback) => {
      callback(error, "out", "err");
      return {};
    }));

    assert.deepEqual(result, {
      stdout: "out",
      stderr: "err",
      error: { message: "failed", code: 7, signal: "SIGTERM" },
    });
  });

  it("finds command paths through sh -lc command -v and returns null for blank stdout", async () => {
    const calls: unknown[] = [];
    assert.equal(await commandPath("axe", deps((file, args, options, callback) => {
      calls.push({ file, args, options });
      callback(null, "/usr/local/bin/axe\n", "");
      return {};
    })), "/usr/local/bin/axe");

    assert.equal(await commandPath("missing", deps((_file, _args, _options, callback) => {
      callback(null, "  \n", "");
      return {};
    })), null);

    assert.deepEqual(calls, [{
      file: "sh",
      args: ["-lc", "command -v axe"],
      options: {
        cwd: "/repo",
        env: { PATH: "/bin" },
        timeout: 5000,
        maxBuffer: MAX_OUTPUT,
      },
    }]);
  });

  it("normalizes non-Error values consistently with the legacy object shape", () => {
    assert.deepEqual(normalizeExecError({ message: "bad", code: 1, signal: null }), {
      message: "bad",
      code: 1,
      signal: null,
    });
    assert.deepEqual(normalizeExecError("failed"), {
      message: "failed",
      code: undefined,
      signal: undefined,
    });
  });
});

