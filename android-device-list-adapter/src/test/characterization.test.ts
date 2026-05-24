import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { listAndroidDevices, parseAdbDevices } from "../main/index.js";
import type { ExecOptions, ExecResult } from "../main/index.js";

describe("android-device-list-adapter legacy characterization", () => {
  it("runs adb devices -l with the legacy timeout", async () => {
    const calls: Array<{ file: string; args: string[]; options: ExecOptions }> = [];
    await listAndroidDevices(10, {
      execFilePromise: (file, args, options) => {
        calls.push({ file, args, options });
        return execResult("List of devices attached\n");
      },
    });

    assert.deepEqual(calls, [{
      file: "adb",
      args: ["devices", "-l"],
      options: { timeout: 20_000 },
    }]);
  });

  it("skips the adb header, trims blank lines, and parses serial state and details", () => {
    assert.deepEqual(parseAdbDevices([
      "List of devices attached",
      "emulator-5554   device product:sdk_gphone model:sdk_gphone_x86 transport_id:1",
      "",
      "R58M123 offline usb:337641472X",
      "unauthorized-device unauthorized",
      "",
    ].join("\n")), [
      {
        serial: "emulator-5554",
        state: "device",
        details: "product:sdk_gphone model:sdk_gphone_x86 transport_id:1",
      },
      {
        serial: "R58M123",
        state: "offline",
        details: "usb:337641472X",
      },
      {
        serial: "unauthorized-device",
        state: "unauthorized",
        details: "",
      },
    ]);
  });

  it("handles CRLF output and applies the limit after parsing", async () => {
    const stdout = "List of devices attached\r\nA device detail:a\r\nB offline detail:b\r\n";
    assert.deepEqual(await listAndroidDevices(1, { execFilePromise: () => execResult(stdout) }), [
      { serial: "A", state: "device", details: "detail:a" },
    ]);
  });

  it("returns an empty list for header-only output", () => {
    assert.deepEqual(parseAdbDevices("List of devices attached\n\n"), []);
  });

  it("preserves legacy sparse-line parsing for malformed nonblank rows", () => {
    assert.deepEqual(parseAdbDevices("List of devices attached\nserial-only\n"), [
      { serial: "serial-only", state: undefined, details: "" },
    ]);
  });
});

function execResult(stdout: string): ExecResult {
  return { stdout, stderr: "" };
}
