import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  clampNumber,
  listDevices,
  listIosPhysicalDevices,
  safeToolSection,
} from "../main/index.js";
import type {
  DeviceListingDependencies,
  ExecFileOptions,
  ExecFileResult,
  ToolTextResult,
} from "../main/index.js";

const IOS_SIMULATORS_JSON = JSON.stringify({
  devices: {
    "com.apple.CoreSimulator.SimRuntime.iOS-17-5": [
      { name: "iPhone 15", udid: "SIM-15", state: "Shutdown", isAvailable: true },
      { name: "iPhone SE", udid: "SIM-SE", state: "Booted", isAvailable: true },
    ],
    "com.apple.CoreSimulator.SimRuntime.iOS-16-4": [
      { name: "iPhone 14", udid: "SIM-14", state: "Booted", isAvailable: true },
      { name: "iPad Air", udid: "SIM-IPAD", state: "Shutdown", isAvailable: false },
    ],
  },
});

const IOS_PHYSICAL_RESULT_ROOT_JSON = JSON.stringify({
  result: {
    devices: [
      {
        identifier: "00008110-RESULT",
        deviceProperties: { name: "Pedro's iPhone", platform: "iOS" },
        hardwareProperties: { marketingName: "iPhone 15 Pro" },
        connectionProperties: { transportType: "USB", pairingState: "paired" },
      },
      {
        udid: "LEGACY-RESULT-UDID",
        name: "Fallback iPad",
        platform: "iPadOS",
        model: "iPad mini",
        connectionType: "network",
        state: "available",
      },
    ],
  },
});

const IOS_PHYSICAL_DEVICES_ROOT_JSON = JSON.stringify({
  devices: [
    {
      udid: "ROOT-UDID",
      name: "Root iPhone",
      platform: "iOS",
      model: "iPhone 14",
      connectionType: "USB",
      state: "paired",
    },
  ],
});

const ANDROID_DEVICES_OUTPUT = [
  "List of devices attached",
  "emulator-5554 device product:sdk_gphone64_arm64 model:sdk_gphone64_arm64 device:emu64a transport_id:1",
  "R5CT123456 offline usb:336592896X product:a34 model:SM_A346B device:a34x transport_id:2",
  "",
].join("\n");

describe("device-listing legacy characterization", () => {
  describe("numeric coercion and limit bounds", () => {
    it("clamps finite numeric values to the inclusive legacy range", () => {
      assert.equal(clampNumber(0, 1, 200), 1);
      assert.equal(clampNumber("201", 1, 200), 200);
      assert.equal(clampNumber("7", 1, 200), 7);
      assert.equal(clampNumber(true, 1, 200), 1);
      assert.equal(clampNumber(12.5, 1, 200), 12.5);
    });

    it("rejects values that cannot coerce to a finite number with the legacy message", () => {
      assert.throws(() => clampNumber("many", 1, 200), /Expected a finite number, got many\./);
      assert.throws(() => clampNumber(Number.POSITIVE_INFINITY, 1, 200), /Expected a finite number, got Infinity\./);
    });
  });

  describe("safeToolSection", () => {
    it("wraps successful values in an ok section", async () => {
      assert.deepEqual(await safeToolSection(async () => ["device-a", "device-b"]), {
        ok: true,
        value: ["device-a", "device-b"],
      });
    });

    it("captures malformed JSON errors instead of throwing", async () => {
      const section = await safeToolSection(() => JSON.parse("{bad json"));

      assert.equal(section.ok, false);
      if (!section.ok) {
        assert.match(section.error, /Unexpected token|Expected property name/);
      }
    });

    it("captures command failure message, stdout, and stderr blocks", async () => {
      const error = Object.assign(new Error("xcrun failed with code 72"), {
        stdout: "partial stdout",
        stderr: "tool stderr",
      });
      const section = await safeToolSection(() => {
        throw error;
      });

      assert.deepEqual(section, {
        ok: false,
        error: "xcrun failed with code 72\n\nstdout:\npartial stdout\n\nstderr:\ntool stderr",
      });
    });

    it("truncates captured stdout and stderr with the legacy overflow marker", async () => {
      const error = Object.assign(new Error("tool failed"), {
        stdout: `${"o".repeat(40_000)}abc`,
        stderr: `${"e".repeat(40_000)}xyz`,
      });

      const section = await safeToolSection(() => {
        throw error;
      });

      assert.equal(section.ok, false);
      if (!section.ok) {
        assert.match(section.error, /\[truncated 3 characters\]/);
        assert.equal(section.error.includes(`${"o".repeat(40_000)}abc`), false);
        assert.equal(section.error.includes(`${"e".repeat(40_000)}xyz`), false);
      }
    });
  });

  describe("iOS simulator listing", () => {
    it("flattens runtime buckets, keeps simulator fields, sorts Booted first then by name, and applies limit", async () => {
      const payload = parseToolJson(await listDevices({ platform: "ios", limit: 3 }, fakeDependencies({
        xcrunSimctl: IOS_SIMULATORS_JSON,
        xcrunDevicectl: IOS_PHYSICAL_RESULT_ROOT_JSON,
      })));

      assert.deepEqual(payload, {
        ios: {
          ok: true,
          value: [
            {
              runtime: "com.apple.CoreSimulator.SimRuntime.iOS-16-4",
              name: "iPhone 14",
              udid: "SIM-14",
              state: "Booted",
              isAvailable: true,
            },
            {
              runtime: "com.apple.CoreSimulator.SimRuntime.iOS-17-5",
              name: "iPhone SE",
              udid: "SIM-SE",
              state: "Booted",
              isAvailable: true,
            },
            {
              runtime: "com.apple.CoreSimulator.SimRuntime.iOS-16-4",
              name: "iPad Air",
              udid: "SIM-IPAD",
              state: "Shutdown",
              isAvailable: false,
            },
          ],
        },
        iosPhysical: {
          ok: true,
          value: [
            {
              name: "Pedro's iPhone",
              identifier: "00008110-RESULT",
              platform: "iOS",
              model: "iPhone 15 Pro",
              connectionType: "USB",
              state: "paired",
            },
            {
              name: "Fallback iPad",
              identifier: "LEGACY-RESULT-UDID",
              platform: "iPadOS",
              model: "iPad mini",
              connectionType: "network",
              state: "available",
            },
          ],
        },
      });
    });

    it("returns an error section for malformed simulator JSON while physical listing still succeeds", async () => {
      const payload = parseToolJson(await listDevices({ platform: "ios" }, fakeDependencies({
        xcrunSimctl: "{bad json",
        xcrunDevicectl: IOS_PHYSICAL_DEVICES_ROOT_JSON,
      })));

      assert.deepEqual(payload, {
        ios: {
          ok: false,
          error: expectedJsonParseError("{bad json"),
        },
        iosPhysical: {
          ok: true,
          value: [
            {
              name: "Root iPhone",
              identifier: "ROOT-UDID",
              platform: "iOS",
              model: "iPhone 14",
              connectionType: "USB",
              state: "paired",
            },
          ],
        },
      });
    });

    it("returns an error section for malformed simulator runtime buckets instead of a false empty success", async () => {
      const payload = parseToolJson(await listDevices({ platform: "ios" }, fakeDependencies({
        xcrunSimctl: JSON.stringify({ devices: { "com.apple.CoreSimulator.SimRuntime.iOS-18-0": { name: "not-array" } } }),
        xcrunDevicectl: IOS_PHYSICAL_DEVICES_ROOT_JSON,
      })));

      assert.equal(isSectionOk(payload, "ios"), false);
      assert.match(sectionError(payload, "ios"), /devices\.com\.apple\.CoreSimulator\.SimRuntime\.iOS-18-0 must be an array\./);
      assert.equal(isSectionOk(payload, "iosPhysical"), true);
    });
  });

  describe("iOS physical devicectl normalization", () => {
    it("normalizes nested result.devices records and fallback root-level fields", async () => {
      assert.deepEqual(await listIosPhysicalDevices(10, fakeDependencies({
        xcrunDevicectl: IOS_PHYSICAL_RESULT_ROOT_JSON,
      })), [
        {
          name: "Pedro's iPhone",
          identifier: "00008110-RESULT",
          platform: "iOS",
          model: "iPhone 15 Pro",
          connectionType: "USB",
          state: "paired",
        },
        {
          name: "Fallback iPad",
          identifier: "LEGACY-RESULT-UDID",
          platform: "iPadOS",
          model: "iPad mini",
          connectionType: "network",
          state: "available",
        },
      ]);
    });

    it("normalizes devices root records and applies the requested limit before mapping", async () => {
      assert.deepEqual(await listIosPhysicalDevices(1, fakeDependencies({
        xcrunDevicectl: IOS_PHYSICAL_DEVICES_ROOT_JSON,
      })), [
        {
          name: "Root iPhone",
          identifier: "ROOT-UDID",
          platform: "iOS",
          model: "iPhone 14",
          connectionType: "USB",
          state: "paired",
        },
      ]);
    });

    it("throws for missing or malformed physical device arrays like legacy devicectl mapping", async () => {
      await assert.rejects(
        async () => listIosPhysicalDevices(10, fakeDependencies({
          xcrunDevicectl: JSON.stringify({ result: { devices: { identifier: "not-array" } } }),
        })),
        /physical devices must be an array\./,
      );
      await assert.rejects(
        async () => listIosPhysicalDevices(10, fakeDependencies({
          xcrunDevicectl: JSON.stringify({ result: { devices: ["not-object"] } }),
        })),
        /physical device entry must be an object\./,
      );
    });
  });

  describe("Android adb parsing", () => {
    it("skips the adb header, parses serial/state/details, and applies limit", async () => {
      const payload = parseToolJson(await listDevices({ platform: "android", limit: 1 }, fakeDependencies({
        adbDevices: ANDROID_DEVICES_OUTPUT,
      })));

      assert.deepEqual(payload, {
        android: {
          ok: true,
          value: [
            {
              serial: "emulator-5554",
              state: "device",
              details: "product:sdk_gphone64_arm64 model:sdk_gphone64_arm64 device:emu64a transport_id:1",
            },
          ],
        },
      });
    });

    it("returns an error section when adb command execution fails", async () => {
      const payload = parseToolJson(await listDevices({ platform: "android" }, failingDependencies(
        "adb",
        Object.assign(new Error("adb failed with code 1"), { stderr: "no devices/emulators found" }),
      )));

      assert.deepEqual(payload, {
        android: {
          ok: false,
          error: "adb failed with code 1\n\nstderr:\nno devices/emulators found",
        },
      });
    });
  });

  describe("listDevices platform selection and result envelope", () => {
    it("defaults to all platforms with limit 40 and returns legacy toolJson text shape", async () => {
      const calls: ExecCall[] = [];
      const result = await listDevices({}, fakeDependencies({
        calls,
        xcrunSimctl: IOS_SIMULATORS_JSON,
        xcrunDevicectl: IOS_PHYSICAL_RESULT_ROOT_JSON,
        adbDevices: ANDROID_DEVICES_OUTPUT,
      }));

      assert.equal(result.isError, false);
      assert.equal(result.content.length, 1);
      assert.equal(result.content[0]?.type, "text");
      assert.equal(result.content[0]?.text.endsWith("\n"), true);

      assert.deepEqual(calls.map((call) => [call.file, call.args]), [
        ["xcrun", ["simctl", "list", "devices", "available", "--json"]],
        ["xcrun", ["devicectl", "list", "devices", "--json-output", "-"]],
        ["adb", ["devices", "-l"]],
      ]);

      assert.deepEqual(parseToolJson(result), {
        ios: {
          ok: true,
          value: [
            {
              runtime: "com.apple.CoreSimulator.SimRuntime.iOS-16-4",
              name: "iPhone 14",
              udid: "SIM-14",
              state: "Booted",
              isAvailable: true,
            },
            {
              runtime: "com.apple.CoreSimulator.SimRuntime.iOS-17-5",
              name: "iPhone SE",
              udid: "SIM-SE",
              state: "Booted",
              isAvailable: true,
            },
            {
              runtime: "com.apple.CoreSimulator.SimRuntime.iOS-16-4",
              name: "iPad Air",
              udid: "SIM-IPAD",
              state: "Shutdown",
              isAvailable: false,
            },
            {
              runtime: "com.apple.CoreSimulator.SimRuntime.iOS-17-5",
              name: "iPhone 15",
              udid: "SIM-15",
              state: "Shutdown",
              isAvailable: true,
            },
          ],
        },
        iosPhysical: {
          ok: true,
          value: [
            {
              name: "Pedro's iPhone",
              identifier: "00008110-RESULT",
              platform: "iOS",
              model: "iPhone 15 Pro",
              connectionType: "USB",
              state: "paired",
            },
            {
              name: "Fallback iPad",
              identifier: "LEGACY-RESULT-UDID",
              platform: "iPadOS",
              model: "iPad mini",
              connectionType: "network",
              state: "available",
            },
          ],
        },
        android: {
          ok: true,
          value: [
            {
              serial: "emulator-5554",
              state: "device",
              details: "product:sdk_gphone64_arm64 model:sdk_gphone64_arm64 device:emu64a transport_id:1",
            },
            {
              serial: "R5CT123456",
              state: "offline",
              details: "usb:336592896X product:a34 model:SM_A346B device:a34x transport_id:2",
            },
          ],
        },
      });
    });

    it("platform ios calls only simulator and physical iOS tools", async () => {
      const calls: ExecCall[] = [];
      await listDevices({ platform: "ios", limit: "1" }, fakeDependencies({
        calls,
        xcrunSimctl: IOS_SIMULATORS_JSON,
        xcrunDevicectl: IOS_PHYSICAL_RESULT_ROOT_JSON,
        adbDevices: ANDROID_DEVICES_OUTPUT,
      }));

      assert.deepEqual(calls.map((call) => call.file), ["xcrun", "xcrun"]);
    });

    it("platform android calls only adb", async () => {
      const calls: ExecCall[] = [];
      await listDevices({ platform: "android", limit: 2000 }, fakeDependencies({
        calls,
        xcrunSimctl: IOS_SIMULATORS_JSON,
        xcrunDevicectl: IOS_PHYSICAL_RESULT_ROOT_JSON,
        adbDevices: ANDROID_DEVICES_OUTPUT,
      }));

      assert.deepEqual(calls.map((call) => call.file), ["adb"]);
    });
  });
});

interface ExecCall {
  file: string;
  args: string[];
  options?: ExecFileOptions;
}

interface FakeOutputs {
  calls?: ExecCall[];
  xcrunSimctl?: string;
  xcrunDevicectl?: string;
  adbDevices?: string;
}

function fakeDependencies(outputs: FakeOutputs): DeviceListingDependencies {
  return {
    execFile: async (file, args, options): Promise<ExecFileResult> => {
      outputs.calls?.push({ file, args, options });
      const command = [file, ...args].join(" ");
      if (command === "xcrun simctl list devices available --json") {
        return { stdout: outputs.xcrunSimctl ?? JSON.stringify({ devices: {} }) };
      }
      if (command === "xcrun devicectl list devices --json-output -") {
        return { stdout: outputs.xcrunDevicectl ?? JSON.stringify({ result: { devices: [] } }) };
      }
      if (command === "adb devices -l") {
        return { stdout: outputs.adbDevices ?? "List of devices attached\n" };
      }
      throw new Error(`Unexpected command: ${command}`);
    },
  };
}

function failingDependencies(failingFile: string, error: Error): DeviceListingDependencies {
  return {
    execFile: async (file): Promise<ExecFileResult> => {
      if (file === failingFile) throw error;
      return { stdout: "" };
    },
  };
}

function parseToolJson(result: ToolTextResult): unknown {
  assert.equal(result.isError, false);
  assert.equal(result.content.length, 1);
  const text = result.content[0]?.text;
  assert.equal(typeof text, "string");
  return JSON.parse(text ?? "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSectionOk(payload: unknown, key: string): boolean {
  assert.equal(isRecord(payload), true);
  const section = (payload as Record<string, unknown>)[key];
  assert.equal(isRecord(section), true);
  return Boolean((section as Record<string, unknown>).ok);
}

function sectionError(payload: unknown, key: string): string {
  assert.equal(isRecord(payload), true);
  const section = (payload as Record<string, unknown>)[key];
  assert.equal(isRecord(section), true);
  const error = (section as Record<string, unknown>).error;
  assert.equal(typeof error, "string");
  return String(error);
}

function expectedJsonParseError(source: string): string {
  try {
    JSON.parse(source);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error("expected JSON.parse to fail");
}
