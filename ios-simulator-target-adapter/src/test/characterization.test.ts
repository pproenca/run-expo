import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  listIosSimulatorTargets,
  normalizeDeviceState,
} from "../main/index.js";
import type { ExecOptions, ExecResult } from "../main/index.js";

describe("ios-simulator-target-adapter legacy characterization", () => {
  it("runs xcrun simctl with the legacy available-devices JSON command and options", async () => {
    const calls: Array<{ file: string; args: string[]; options: ExecOptions }> = [];
    await listIosSimulatorTargets({
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

  it("flattens runtime groups and preserves runtime, id, name fallback, and normalized state", async () => {
    const targets = await listIosSimulatorTargets(simctlPayload({
      devices: {
        "com.apple.CoreSimulator.SimRuntime.iOS-17-5": [
          { udid: "IPHONE-14", name: "iPhone 14", state: "Shutdown" },
          { udid: "NO-NAME", state: "connected" },
        ],
        "com.apple.CoreSimulator.SimRuntime.iOS-18-0": [
          { udid: "IPHONE-15", name: "iPhone 15", state: "Booted" },
          { udid: "WATCH-1", name: "Apple Watch", state: "Creating" },
        ],
      },
    }));

    assert.deepEqual(targets, [
      {
        runtime: "com.apple.CoreSimulator.SimRuntime.iOS-18-0",
        id: "IPHONE-15",
        name: "iPhone 15",
        state: "booted",
      },
      {
        runtime: "com.apple.CoreSimulator.SimRuntime.iOS-18-0",
        id: "WATCH-1",
        name: "Apple Watch",
        state: "unknown",
      },
      {
        runtime: "com.apple.CoreSimulator.SimRuntime.iOS-17-5",
        id: "IPHONE-14",
        name: "iPhone 14",
        state: "shutdown",
      },
      {
        runtime: "com.apple.CoreSimulator.SimRuntime.iOS-17-5",
        id: "NO-NAME",
        name: "NO-NAME",
        state: "connected",
      },
    ]);
  });

  it("sorts booted devices first and otherwise by localeCompare name", async () => {
    const targets = await listIosSimulatorTargets(simctlPayload({
      devices: {
        runtime: [
          { udid: "Z", name: "Zulu", state: "Shutdown" },
          { udid: "A", name: "Alpha", state: "Shutdown" },
          { udid: "B2", name: "Beta 2", state: "Booted" },
          { udid: "B1", name: "Beta 1", state: "Booted" },
        ],
      },
    }));

    assert.deepEqual(targets.map((target) => target.id), ["B1", "B2", "A", "Z"]);
  });

  it("returns an empty list when the simctl devices object is missing", async () => {
    assert.deepEqual(await listIosSimulatorTargets(simctlPayload({})), []);
  });

  it("propagates invalid simctl JSON", async () => {
    await assert.rejects(
      () => listIosSimulatorTargets({ execFilePromise: () => ({ stdout: "{bad", stderr: "" }) }),
      SyntaxError,
    );
  });

  it("normalizes device states exactly like the target helper", () => {
    assert.equal(normalizeDeviceState("Booted"), "booted");
    assert.equal(normalizeDeviceState("Shutdown"), "shutdown");
    assert.equal(normalizeDeviceState("connected"), "connected");
    assert.equal(normalizeDeviceState("Creating"), "unknown");
    assert.equal(normalizeDeviceState(undefined), "unknown");
  });
});

function simctlPayload(payload: unknown): { execFilePromise: () => ExecResult } {
  return {
    execFilePromise: () => execResult(payload),
  };
}

function execResult(payload: unknown): ExecResult {
  return { stdout: JSON.stringify(payload), stderr: "" };
}
