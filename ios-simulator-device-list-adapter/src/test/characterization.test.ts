import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { listIosSimulatorDevices } from "../main/index.js";
import type { ExecOptions, ExecResult } from "../main/index.js";

describe("ios-simulator-device-list-adapter legacy characterization", () => {
  it("runs xcrun simctl with legacy command and options", async () => {
    const calls: Array<{ file: string; args: string[]; options: ExecOptions }> = [];
    await listIosSimulatorDevices(20, {
      execFilePromise: (file, args, options) => {
        calls.push({ file, args, options });
        return execResult({ devices: {} });
      },
    });

    assert.deepEqual(calls, [{
      file: "xcrun",
      args: ["simctl", "list", "devices", "available", "--json"],
      options: { timeout: 20_000, maxBuffer: 4 * 1024 * 1024 },
    }]);
  });

  it("flattens runtime device buckets and preserves raw simulator fields", async () => {
    const devices = await listIosSimulatorDevices(10, payload({
      devices: {
        "runtime-a": [
          { name: "iPhone 14", udid: "A", state: "Shutdown", isAvailable: true, extra: "ignored" },
        ],
        "runtime-b": [
          { name: "iPhone 15", udid: "B", state: "Booted", isAvailable: false },
        ],
      },
    }));

    assert.deepEqual(devices, [
      { runtime: "runtime-b", name: "iPhone 15", udid: "B", state: "Booted", isAvailable: false },
      { runtime: "runtime-a", name: "iPhone 14", udid: "A", state: "Shutdown", isAvailable: true },
    ]);
  });

  it("sorts booted devices first and otherwise by name before applying limit", async () => {
    const devices = await listIosSimulatorDevices(3, payload({
      devices: {
        runtime: [
          { name: "Zulu", udid: "Z", state: "Shutdown" },
          { name: "Alpha", udid: "A", state: "Shutdown" },
          { name: "Beta 2", udid: "B2", state: "Booted" },
          { name: "Beta 1", udid: "B1", state: "Booted" },
        ],
      },
    }));

    assert.deepEqual(devices.map((device) => device.udid), ["B1", "B2", "A"]);
  });

  it("returns an empty list when no devices object is present", async () => {
    assert.deepEqual(await listIosSimulatorDevices(10, payload({})), []);
  });

  it("propagates invalid simctl JSON", async () => {
    await assert.rejects(
      () => listIosSimulatorDevices(10, { execFilePromise: () => ({ stdout: "{bad", stderr: "" }) }),
      SyntaxError,
    );
  });
});

function payload(value: unknown): { execFilePromise: () => ExecResult } {
  return {
    execFilePromise: () => execResult(value),
  };
}

function execResult(value: unknown): ExecResult {
  return { stdout: JSON.stringify(value), stderr: "" };
}
