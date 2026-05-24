import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  MAX_OUTPUT,
  createPluginReleaseExecFile,
  createPluginSelfManagementRuntimeDependencies,
  execFilePromise,
  normalizeExecError,
} from "../main/index.js";
import type {
  NodeExecFileAdapter,
  PluginSelfManagementProcessDependencies,
} from "../main/index.js";

describe("plugin-self-management-process-adapter legacy characterization", () => {
  it("creates the release execFile dependency expected by plugin self-management", async () => {
    const calls: unknown[] = [];
    const execFile = createPluginReleaseExecFile(deps((file, args, options, callback) => {
      calls.push({ file, args, options });
      callback(null, "0.1.0\n", "");
      return {};
    }));

    assert.deepEqual(await execFile("/usr/local/bin/node", ["/plugin/cli/expo-ios.mjs", "--version"], {
      cwd: "/outside",
      timeout: 20_000,
      rejectOnError: false,
    }), {
      stdout: "0.1.0\n",
      stderr: "",
      error: null,
    });
    assert.deepEqual(calls, [{
      file: "/usr/local/bin/node",
      args: ["/plugin/cli/expo-ios.mjs", "--version"],
      options: { cwd: "/outside", env: { PATH: "/bin" }, timeout: 20_000, maxBuffer: MAX_OUTPUT },
    }]);
  });

  it("preserves release check cwd, timeout, maxBuffer override, and string coercion", async () => {
    const result = await execFilePromise("node", ["cli", "--help"], {
      cwd: "/tmp/release",
      timeout: 20_000,
      rejectOnError: false,
    }, {
      execFile: (file, args, options, callback) => {
        assert.equal(file, "node");
        assert.deepEqual(args, ["cli", "--help"]);
        assert.deepEqual(options, {
          cwd: "/tmp/release",
          env: { EXPO_DEBUG: "1" },
          timeout: 20_000,
          maxBuffer: 8192,
        });
        callback(null, null, undefined);
        return {};
      },
      env: () => ({ EXPO_DEBUG: "1" }),
      maxBuffer: 8192,
    });

    assert.deepEqual(result, { stdout: "", stderr: "", error: null });
  });

  it("resolves normalized process errors for release checks because rejectOnError is false", async () => {
    const error = Object.assign(new Error("exit 1"), { code: 1, signal: "SIGTERM" });

    const result = await execFilePromise("node", ["cli", "doctor"], {
      cwd: "/outside",
      timeout: 20_000,
      rejectOnError: false,
    }, deps((_file, _args, _options, callback) => {
      callback(error, "{\"ok\":false}", "doctor failed");
      return {};
    }));

    assert.deepEqual(result, {
      stdout: "{\"ok\":false}",
      stderr: "doctor failed",
      error: { message: "exit 1", code: 1, signal: "SIGTERM" },
    });
  });

  it("keeps rejecting error behavior available for adapter parity", async () => {
    const error: Record<string, unknown> = { message: "failed" };

    await assert.rejects(
      () => execFilePromise("node", ["cli"], {
        cwd: "/outside",
        timeout: 20_000,
        rejectOnError: true,
      }, deps((_file, _args, _options, callback) => {
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

  it("composes the full plugin self-management runtime dependency object", async () => {
    const runtime = createPluginSelfManagementRuntimeDependencies(deps((_file, _args, _options, callback) => {
      callback(null, "help perf dashboard", "");
      return {};
    }), {
      pluginRoot: "/plugin",
      homeDir: "/home/user",
      tmpDir: "/tmp",
    });

    assert.equal(runtime.pluginRoot, "/plugin");
    assert.equal(runtime.homeDir, "/home/user");
    assert.equal(runtime.tmpDir, "/tmp");
    assert.deepEqual(await runtime.execFile("node", ["/plugin/cli/expo-ios.mjs", "--help"], {
      cwd: "/tmp/release",
      timeout: 20_000,
      rejectOnError: false,
    }), {
      stdout: "help perf dashboard",
      stderr: "",
      error: null,
    });
  });

  it("normalizes non-object process errors consistently with the legacy helper", () => {
    assert.deepEqual(normalizeExecError("bad"), {
      message: "bad",
      code: undefined,
      signal: undefined,
    });
  });
});

function deps(execFile: NodeExecFileAdapter): PluginSelfManagementProcessDependencies {
  return {
    execFile,
    env: () => ({ PATH: "/bin" }),
  };
}
