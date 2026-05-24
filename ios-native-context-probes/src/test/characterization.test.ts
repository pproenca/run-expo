import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  collectFilteredIosLogs,
  escapePredicateValue,
  formatError,
  iosInstalledAppInfo,
  processNameFromBundleId,
  readInfoPlistFields,
  safeToolSection,
  truncate,
} from "../main/index.js";
import type { NativeContextDependencies, ExecResult } from "../main/index.js";

function deps(responder: (command: string, args: string[], options: Record<string, unknown>) => ExecResult | Promise<ExecResult>): NativeContextDependencies {
  return {
    execFile: async (command, args, options) => responder(command, args, options),
    joinPath: (...parts) => parts.join("/").replaceAll(/\/+/g, "/"),
  };
}

describe("ios-native-context-probes legacy characterization", () => {
  it("collects filtered iOS logs with explicit process predicate and important-line filtering", async () => {
    const calls: unknown[] = [];
    const payload = await collectFilteredIosLogs("SIM-1", {
      last: "60s",
      processName: 'App "Main"\\Process',
      bundleId: "com.example.ignored",
    }, deps((command, args, options) => {
      calls.push({ command, args, options });
      return {
        stdout: [
          "plain launch line",
          "warning: response_status=500 api/users",
          "Metro reload complete",
          "normal again",
        ].join("\n"),
        stderr: "stderr",
        error: null,
      };
    }));

    assert.deepEqual(calls, [{
      command: "xcrun",
      args: [
        "simctl",
        "spawn",
        "SIM-1",
        "log",
        "show",
        "--style",
        "compact",
        "--last",
        "60s",
        "--predicate",
        'process == "App \\"Main\\"\\\\Process"',
      ],
      options: {
        timeout: 45_000,
        maxBuffer: 5 * 1024 * 1024,
        rejectOnError: false,
      },
    }]);
    assert.deepEqual(payload, {
      last: "60s",
      predicate: 'process == "App \\"Main\\"\\\\Process"',
      totalLines: 4,
      importantLineCount: 2,
      importantLines: [
        "warning: response_status=500 api/users",
        "Metro reload complete",
      ],
      stdout: undefined,
      stderr: "stderr",
      error: null,
    });
  });

  it("uses bundle-derived process CONTAINS predicate and includes truncated stdout when no important lines exist", async () => {
    const payload = await collectFilteredIosLogs("SIM-1", {
      last: "2m",
      bundleId: "com.example.My-App!",
    }, {
      ...deps(() => ({ stdout: "a".repeat(12), stderr: "b".repeat(5), error: { code: 1 } })),
      truncate: (value, limit = 40_000) => `${String(value).slice(0, 3)}:${limit}`,
    });

    assert.deepEqual(payload, {
      last: "2m",
      predicate: 'process CONTAINS "My-App"',
      totalLines: 1,
      importantLineCount: 0,
      importantLines: [],
      stdout: "aaa:12000",
      stderr: "bbb:40000",
      error: { code: 1 },
    });
  });

  it("omits predicate when neither processName nor bundleId is available", async () => {
    let argsSeen: string[] = [];
    await collectFilteredIosLogs("SIM-2", { last: "1h" }, deps((_command, args) => {
      argsSeen = args;
      return { stdout: "", stderr: "", error: null };
    }));
    assert.deepEqual(argsSeen, ["simctl", "spawn", "SIM-2", "log", "show", "--style", "compact", "--last", "1h"]);
  });

  it("reads installed app, data container, and selected Info.plist fields", async () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    const values: Record<string, ExecResult> = {
      "get_app_container-app": { stdout: "/Containers/App/My.app\n", stderr: "", error: null },
      "get_app_container-data": { stdout: "/Containers/Data\n", stderr: "", error: null },
      CFBundleDisplayName: { stdout: "Fixture App\n", stderr: "", error: null },
      CFBundleName: { stdout: "", stderr: "", error: null },
      CFBundleVersion: { stdout: "42\n", stderr: "", error: null },
      CFBundleShortVersionString: { stdout: "1.2.3\n", stderr: "", error: null },
      RCTNewArchEnabled: { stdout: "true\n", stderr: "", error: null },
      UIUserInterfaceStyle: { stdout: "", stderr: "missing", error: { message: "not found" } },
    };

    const payload = await iosInstalledAppInfo("SIM-1", "com.example.app", deps((command, args) => {
      calls.push({ command, args });
      if (command === "xcrun") {
        return values[`get_app_container-${args[4]}`] ?? { stdout: "", stderr: "", error: null };
      }
      return values[args[1]] ?? { stdout: "", stderr: "", error: null };
    }));

    assert.deepEqual(payload, {
      bundleId: "com.example.app",
      appPath: "/Containers/App/My.app",
      dataPath: "/Containers/Data",
      infoPlist: {
        CFBundleDisplayName: "Fixture App",
        CFBundleVersion: "42",
        CFBundleShortVersionString: "1.2.3",
        RCTNewArchEnabled: "true",
      },
    });
    assert.deepEqual(calls.slice(0, 2), [
      { command: "xcrun", args: ["simctl", "get_app_container", "SIM-1", "com.example.app", "app"] },
      { command: "xcrun", args: ["simctl", "get_app_container", "SIM-1", "com.example.app", "data"] },
    ]);
    assert.equal(calls.filter((call) => call.command === "plutil").length, 6);
  });

  it("returns null dataPath and safe infoPlist error when plist reads throw", async () => {
    const payload = await iosInstalledAppInfo("SIM-1", "com.example.app", deps((command, args) => {
      if (command === "xcrun" && args[4] === "app") return { stdout: "/App\n", stderr: "", error: null };
      if (command === "xcrun" && args[4] === "data") return { stdout: "\n", stderr: "no data", error: { code: 1 } };
      throw new Error("plutil unavailable");
    }));

    assert.deepEqual(payload, {
      bundleId: "com.example.app",
      appPath: "/App",
      dataPath: null,
      infoPlist: { ok: false, error: "plutil unavailable" },
    });
  });

  it("reads only non-empty successful plist fields", async () => {
    assert.deepEqual(await readInfoPlistFields("/App/Info.plist", deps((_command, args) => {
      if (args[1] === "CFBundleName") return { stdout: "Fixture\n", stderr: "", error: null };
      if (args[1] === "CFBundleVersion") return { stdout: "  \n", stderr: "", error: null };
      return { stdout: "ignored\n", stderr: "", error: { message: "missing" } };
    })), {
      CFBundleName: "Fixture",
    });
  });

  it("preserves helper behavior for process names, escaping, truncation, errors, and safe sections", async () => {
    assert.equal(processNameFromBundleId("com.example.My-App!"), "My-App");
    assert.equal(processNameFromBundleId(""), null);
    assert.equal(escapePredicateValue('A "quote" \\ slash'), 'A \\"quote\\" \\\\ slash');
    assert.equal(truncate("abcdef", 3), "abc\n[truncated 3 characters]");
    assert.equal(formatError(Object.assign(new Error("failed"), { stdout: "out", stderr: "err" })), "failed\n\nstdout:\nout\n\nstderr:\nerr");
    assert.deepEqual(await safeToolSection(() => 42), { ok: true, value: 42 });
    assert.deepEqual(await safeToolSection(() => {
      throw new Error("bad");
    }), { ok: false, error: "bad" });
  });
});

