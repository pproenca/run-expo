import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { listIosPhysicalDevices } from "../main/index.js";
import type { ExecOptions, ExecResult } from "../main/index.js";

describe("ios-physical-device-adapter legacy characterization", () => {
  it("runs xcrun devicectl with legacy JSON-output command and options", async () => {
    const calls: Array<{ file: string; args: string[]; options: ExecOptions }> = [];
    await listIosPhysicalDevices(10, {
      execFilePromise: (file, args, options) => {
        calls.push({ file, args, options });
        return execResult({ devices: [] });
      },
    });

    assert.deepEqual(calls, [{
      file: "xcrun",
      args: ["devicectl", "list", "devices", "--json-output", "-"],
      options: { timeout: 20_000, maxBuffer: 4 * 1024 * 1024 },
    }]);
  });

  it("reads devices from result.devices and projects nested devicectl properties first", async () => {
    const devices = await listIosPhysicalDevices(5, payload({
      result: {
        devices: [{
          deviceProperties: { name: "Pedro iPhone", platform: "iOS" },
          identifier: "DEVICE-1",
          hardwareProperties: { marketingName: "iPhone 15 Pro" },
          connectionProperties: { transportType: "usb", pairingState: "paired" },
          name: "fallback name",
          udid: "fallback id",
          platform: "fallback platform",
          model: "fallback model",
          connectionType: "fallback connection",
          state: "fallback state",
        }],
      },
    }));

    assert.deepEqual(devices, [{
      name: "Pedro iPhone",
      identifier: "DEVICE-1",
      platform: "iOS",
      model: "iPhone 15 Pro",
      connectionType: "usb",
      state: "paired",
    }]);
  });

  it("falls back to flat device fields and nulls for missing values", async () => {
    const devices = await listIosPhysicalDevices(5, payload({
      devices: [
        {
          name: "Flat iPhone",
          udid: "UDID-1",
          platform: "iOS",
          model: "iPhone",
          connectionType: "network",
          state: "available",
        },
        {},
      ],
    }));

    assert.deepEqual(devices, [
      {
        name: "Flat iPhone",
        identifier: "UDID-1",
        platform: "iOS",
        model: "iPhone",
        connectionType: "network",
        state: "available",
      },
      {
        name: null,
        identifier: null,
        platform: null,
        model: null,
        connectionType: null,
        state: null,
      },
    ]);
  });

  it("applies the limit before projection", async () => {
    const devices = await listIosPhysicalDevices(1, payload({
      devices: [
        { name: "First", identifier: "1" },
        { name: "Second", identifier: "2" },
      ],
    }));

    assert.deepEqual(devices, [{
      name: "First",
      identifier: "1",
      platform: null,
      model: null,
      connectionType: null,
      state: null,
    }]);
  });

  it("returns an empty list when neither payload shape has devices", async () => {
    assert.deepEqual(await listIosPhysicalDevices(10, payload({ result: {} })), []);
    assert.deepEqual(await listIosPhysicalDevices(10, payload({})), []);
  });

  it("propagates invalid devicectl JSON", async () => {
    await assert.rejects(
      () => listIosPhysicalDevices(10, { execFilePromise: () => ({ stdout: "{bad", stderr: "" }) }),
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
