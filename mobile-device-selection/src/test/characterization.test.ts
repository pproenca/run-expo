import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  androidDeviceArgs,
  escapePredicateValue,
  iosLogPredicate,
  resolveIosDevice,
} from "../main/index.js";
import type { ExecOptions, ExecResult } from "../main/index.js";

const DEVICES = {
  devices: {
    "com.apple.CoreSimulator.SimRuntime.iOS-17-5": [
      { udid: "IPHONE-14", name: "iPhone 14", state: "Shutdown" },
      { udid: "IPAD-1", name: "iPad Pro", state: "Shutdown" },
    ],
    "com.apple.CoreSimulator.SimRuntime.iOS-18-0": [
      { udid: "IPHONE-15", name: "iPhone 15", state: "Booted" },
      { udid: "IPHONE-SE", name: "iPhone SE", state: "Shutdown" },
    ],
  },
};

describe("mobile-device-selection legacy characterization", () => {
  it("returns long UDID-like requests directly without running simctl", async () => {
    const requested = "12345678-ABCD-1234-ABCD-1234567890AB";
    const device = await resolveIosDevice(requested, {}, {
      execFilePromise: () => {
        throw new Error("simctl should not run");
      },
    });

    assert.deepEqual(device, { udid: requested, name: requested, state: "unknown" });
  });

  it("runs simctl with legacy arguments and returns exact UDID or name matches", async () => {
    const calls: Array<{ file: string; args: string[]; options: ExecOptions }> = [];
    const deps = {
      execFilePromise: (file: string, args: string[], options: ExecOptions): ExecResult => {
        calls.push({ file, args, options });
        return { stdout: JSON.stringify(DEVICES), stderr: "" };
      },
    };

    assert.deepEqual(await resolveIosDevice("IPHONE-14", {}, deps), {
      udid: "IPHONE-14",
      name: "iPhone 14",
      state: "Shutdown",
      runtime: "com.apple.CoreSimulator.SimRuntime.iOS-17-5",
    });
    assert.deepEqual(await resolveIosDevice("iPhone 15", {}, deps), {
      udid: "IPHONE-15",
      name: "iPhone 15",
      state: "Booted",
      runtime: "com.apple.CoreSimulator.SimRuntime.iOS-18-0",
    });
    assert.deepEqual(calls[0], {
      file: "xcrun",
      args: ["simctl", "list", "devices", "available", "--json"],
      options: { timeout: 20_000, maxBuffer: 4 * 1024 * 1024 },
    });
  });

  it("uses case-insensitive partial name matching after exact matching fails", async () => {
    assert.equal((await resolveIosDevice("se", {}, simctlDevices(DEVICES))).udid, "IPHONE-SE");
  });

  it("prefers the first booted device when requested is absent and preferBooted is true", async () => {
    assert.equal((await resolveIosDevice(undefined, { preferBooted: true }, simctlDevices(DEVICES))).udid, "IPHONE-15");
  });

  it("otherwise picks the last iPhone in simulator-list order, then the first non-iPhone", async () => {
    assert.equal((await resolveIosDevice(undefined, {}, simctlDevices(DEVICES))).udid, "IPHONE-SE");
    assert.equal((await resolveIosDevice(undefined, {}, simctlDevices({
      devices: {
        runtime: [
          { udid: "WATCH-1", name: "Apple Watch", state: "Shutdown" },
          { udid: "TV-1", name: "Apple TV", state: "Shutdown" },
        ],
      },
    }))).udid, "WATCH-1");
  });

  it("throws legacy errors for no requested match or no available simulators", async () => {
    await assert.rejects(
      () => resolveIosDevice("missing", {}, simctlDevices(DEVICES)),
      /No available iOS simulator matched: missing/,
    );
    await assert.rejects(
      () => resolveIosDevice(undefined, {}, simctlDevices({ devices: {} })),
      /No available iOS simulators found\./,
    );
  });

  it("prepends Android -s only when a device value is truthy", () => {
    assert.deepEqual(androidDeviceArgs("emulator-5554", ["shell", "input", "tap", 1, 2]), [
      "-s",
      "emulator-5554",
      "shell",
      "input",
      "tap",
      1,
      2,
    ]);
    assert.deepEqual(androidDeviceArgs("", ["shell"]), ["shell"]);
    assert.deepEqual(androidDeviceArgs(null, ["shell"]), ["shell"]);
  });

  it("builds iOS log predicates from processName before bundleId and escapes predicate values", () => {
    assert.equal(
      iosLogPredicate({ processName: 'Expo "Go"\\Beta', bundleId: "host.exp.Exponent" }),
      'process == "Expo \\"Go\\"\\\\Beta"',
    );
    assert.equal(
      iosLogPredicate({ bundleId: 'com.example.My"App' }),
      'process CONTAINS "My\\"App"',
    );
    assert.equal(iosLogPredicate({ bundleId: "com.example." }), null);
    assert.equal(iosLogPredicate({}), null);
  });

  it("escapePredicateValue stringifies values before escaping backslashes and quotes", () => {
    assert.equal(escapePredicateValue(123), "123");
    assert.equal(escapePredicateValue('a\\b"c'), 'a\\\\b\\"c');
  });
});

function simctlDevices(payload: unknown): { execFilePromise: () => ExecResult } {
  return {
    execFilePromise: () => ({ stdout: JSON.stringify(payload), stderr: "" }),
  };
}
