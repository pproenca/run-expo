import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  androidDeviceArgs,
  buildExpoRouteUrl,
  inferExpoScheme,
  openExpoRoute,
  openUrl,
  processNameFromBundleId,
  redactUrlAuthCookie,
  requireOptionalString,
  requireString,
  resolveIosDevice,
} from "../main/index.js";
import type { ExecErrorResult, ExecFile, ToolTextResult } from "../main/index.js";

const SIMULATORS_JSON = JSON.stringify({
  devices: {
    "com.apple.CoreSimulator.SimRuntime.iOS-18-0": [
      { name: "iPad Pro 13-inch", udid: "IPAD-1", state: "Shutdown", isAvailable: true },
      { name: "iPhone 14", udid: "SIM-14", state: "Shutdown", isAvailable: true },
      { name: "iPhone 15", udid: "SIM-15", state: "Booted", isAvailable: true },
    ],
    "com.apple.CoreSimulator.SimRuntime.iOS-18-1": [
      { name: "iPhone 16 Pro", udid: "SIM-16", state: "Shutdown", isAvailable: true },
    ],
  },
});

type ExecCall = {
  file: string;
  args: readonly string[];
  options?: Record<string, unknown>;
};

describe("route-url-actions legacy characterization", () => {
  describe("route URL string validation", () => {
    it("trims required non-empty strings", () => {
      assert.equal(requireString("  fixture:///customers  ", "url"), "fixture:///customers");
      assert.equal(requireString("\n/customers\t", "route"), "/customers");
    });

    it("rejects missing, blank, or non-string required values with the field name", async () => {
      assert.throws(() => requireString(undefined, "url"), /url must be a non-empty string\./);
      assert.throws(() => requireString("   ", "route"), /route must be a non-empty string\./);
      assert.throws(() => requireString(123, "scheme"), /scheme must be a non-empty string\./);
    });

    it("trims optional strings and returns null for blanks or non-strings", () => {
      assert.equal(requireOptionalString("  fixture  "), "fixture");
      assert.equal(requireOptionalString(" \n\t "), null);
      assert.equal(requireOptionalString(null), null);
      assert.equal(requireOptionalString(123), null);
    });
  });

  describe("Expo route URL construction", () => {
    it("uses explicit trimmed scheme and defaults the route to '/'", async () => {
      const cwd = await tempProject();
      try {
        assert.equal(await buildExpoRouteUrl(cwd, { scheme: " fixture " }), "fixture:///");
      } finally {
        await rm(cwd, { recursive: true, force: true });
      }
    });

    it("trims one leading route slash and preserves URLSearchParams query encoding", async () => {
      const cwd = await tempProject();
      try {
        assert.equal(
          await buildExpoRouteUrl(cwd, {
            scheme: "fixture",
            route: " /customers/42 ",
            query: "tab=activity&space=two words",
          }),
          "fixture:///customers/42?tab=activity&space=two+words",
        );
      } finally {
        await rm(cwd, { recursive: true, force: true });
      }
    });

    it("sets or overrides the cookie query from authCookie without redacting other sensitive keys", async () => {
      const cwd = await tempProject();
      try {
        assert.equal(
          await buildExpoRouteUrl(cwd, {
            scheme: "fixture",
            route: "/customers",
            query: "token=keep&cookie=old&authorization=Bearer%20raw",
            authCookie: "session=abc 123",
          }),
          "fixture:///customers?token=keep&cookie=session%3Dabc+123&authorization=Bearer+raw",
        );
      } finally {
        await rm(cwd, { recursive: true, force: true });
      }
    });

    it("infers the scheme from app.json when no explicit scheme is passed", async () => {
      const cwd = await tempProject({
        "app.json": JSON.stringify({ expo: { scheme: " fixture-app " }, scheme: "top-level" }),
      });
      try {
        assert.equal(await buildExpoRouteUrl(cwd, { route: "/orders" }), "fixture-app:///orders");
      } finally {
        await rm(cwd, { recursive: true, force: true });
      }
    });

    it("throws when neither explicit nor inferred scheme is available", async () => {
      const cwd = await tempProject();
      try {
        await assert.rejects(
          () => buildExpoRouteUrl(cwd, { route: "/customers" }),
          /Could not infer Expo scheme\. Pass scheme or url\./,
        );
      } finally {
        await rm(cwd, { recursive: true, force: true });
      }
    });
  });

  describe("Expo scheme inference", () => {
    it("prefers app.json expo.scheme over top-level scheme and trims it", async () => {
      const cwd = await tempProject({
        "app.json": JSON.stringify({ expo: { scheme: "  expo-scheme  " }, scheme: "top-scheme" }),
      });
      try {
        assert.equal(await inferExpoScheme(cwd), "expo-scheme");
      } finally {
        await rm(cwd, { recursive: true, force: true });
      }
    });

    it("uses top-level app.json scheme when expo.scheme is absent", async () => {
      const cwd = await tempProject({
        "app.json": JSON.stringify({ name: "fixture", scheme: "  top-scheme  " }),
      });
      try {
        assert.equal(await inferExpoScheme(cwd), "top-scheme");
      } finally {
        await rm(cwd, { recursive: true, force: true });
      }
    });

    it("extracts a static app.config scheme with the legacy regex", async () => {
      const cwd = await tempProject({
        "app.config.ts": "export default { expo: { name: 'Fixture', scheme: `config-scheme` } };\n",
      });
      try {
        assert.equal(await inferExpoScheme(cwd), "config-scheme");
      } finally {
        await rm(cwd, { recursive: true, force: true });
      }
    });

    it("returns null when no app.json or static config scheme is present", async () => {
      const cwd = await tempProject({
        "app.config.js": "export default ({ config }) => ({ ...config, name: 'Fixture' });\n",
      });
      try {
        assert.equal(await inferExpoScheme(cwd), null);
      } finally {
        await rm(cwd, { recursive: true, force: true });
      }
    });
  });

  describe("auth cookie redaction", () => {
    it("uses URL parsing to redact sensitive query values", () => {
      assert.equal(
        redactUrlAuthCookie("fixture:///customers?cookie=session123&token=abc&authorization=Bearer%20raw&password=secret&visible=yes"),
        "fixture:///customers?cookie=%5Bredacted%5D&token=%5Bredacted%5D&authorization=%5Bredacted%5D&password=%5Bredacted%5D&visible=yes",
      );
    });

    it("leaves URLs without sensitive query values unchanged apart from URL parser normalization", () => {
      assert.equal(
        redactUrlAuthCookie("fixture:///customers?visible=yes&api_key=legacy-visible"),
        "fixture:///customers?visible=yes&api_key=legacy-visible",
      );
    });

    it("uses the regex fallback for malformed URL strings", () => {
      assert.equal(
        redactUrlAuthCookie("http://[broken]?cookie=session123&token=abc&secret=raw"),
        "http://[broken]?cookie=[redacted]&token=[redacted]&secret=[redacted]",
      );
    });
  });

  describe("iOS and Android device argument resolution", () => {
    it("returns a UDID-looking requested device directly without shelling out", async () => {
      const calls: ExecCall[] = [];
      const device = await resolveIosDevice("ABCDEF1234567890ABCD", { preferBooted: true }, { execFile: recordingExec(calls) });

      assert.deepEqual(device, {
        udid: "ABCDEF1234567890ABCD",
        name: "ABCDEF1234567890ABCD",
        state: "unknown",
      });
      assert.deepEqual(calls, []);
    });

    it("prefers the first booted simulator when requested", async () => {
      const calls: ExecCall[] = [];
      const device = await resolveIosDevice(null, { preferBooted: true }, { execFile: recordingExec(calls) });

      assert.equal(device.udid, "SIM-15");
      assert.equal(device.name, "iPhone 15");
      assert.equal(device.runtime, "com.apple.CoreSimulator.SimRuntime.iOS-18-0");
      assert.deepEqual(calls[0]?.args, ["simctl", "list", "devices", "available", "--json"]);
    });

    it("matches requested simulator by exact UDID, exact name, then partial case-insensitive name", async () => {
      assert.equal((await resolveIosDevice("SIM-14", {}, { execFile: recordingExec([]) })).name, "iPhone 14");
      assert.equal((await resolveIosDevice("iPad Pro 13-inch", {}, { execFile: recordingExec([]) })).udid, "IPAD-1");
      assert.equal((await resolveIosDevice("16 pro", {}, { execFile: recordingExec([]) })).udid, "SIM-16");
    });

    it("throws when a non-UDID requested simulator does not match", async () => {
      await assert.rejects(
        () => resolveIosDevice("Missing Phone", {}, { execFile: recordingExec([]) }),
        /No available iOS simulator matched: Missing Phone/,
      );
    });

    it("falls back to the last iPhone, then the first available non-iPhone, then errors for no simulators", async () => {
      assert.equal((await resolveIosDevice(null, {}, { execFile: recordingExec([]) })).udid, "SIM-16");
      assert.equal(
        (await resolveIosDevice(null, {}, { execFile: recordingExec([], JSON.stringify({
          devices: { runtime: [{ name: "iPad Air", udid: "IPAD-AIR", state: "Shutdown" }] },
        })) })).udid,
        "IPAD-AIR",
      );
      await assert.rejects(
        () => resolveIosDevice(null, {}, { execFile: recordingExec([], JSON.stringify({ devices: {} })) }),
        /No available iOS simulators found\./,
      );
    });

    it("prefixes Android adb args only when a device is provided", () => {
      assert.deepEqual(androidDeviceArgs("emulator-5554", ["shell", "am", "start"]), [
        "-s",
        "emulator-5554",
        "shell",
        "am",
        "start",
      ]);
      assert.deepEqual(androidDeviceArgs(null, ["shell", "am", "start"]), ["shell", "am", "start"]);
    });
  });

  describe("open-url action", () => {
    it("rejects URLs containing whitespace before opening platform tooling", async () => {
      await assert.rejects(
        () => openUrl({ url: "fixture://customers/one two" }, { execFile: recordingExec([]) }),
        /url must not contain whitespace\./,
      );
    });

    it("opens iOS URLs through xcrun simctl openurl with the booted device", async () => {
      const calls: ExecCall[] = [];
      const result = await openUrl({ url: "fixture://customers/1?token=secret&cookie=session" }, { execFile: recordingExec(calls) });

      assert.deepEqual(calls[1], {
        file: "xcrun",
        args: ["simctl", "openurl", "SIM-15", "fixture://customers/1?token=secret&cookie=session"],
        options: { timeout: 30_000, rejectOnError: false },
      });
      assert.deepEqual(parseToolJson(result), {
        platform: "ios",
        device: {
          name: "iPhone 15",
          udid: "SIM-15",
          state: "Booted",
          isAvailable: true,
          runtime: "com.apple.CoreSimulator.SimRuntime.iOS-18-0",
        },
        stdout: "opened SIM-15 fixture://customers/1?token=[redacted]&cookie=[redacted]",
        stderr: "",
      });
    });

    it("opens Android URLs with adb VIEW intent args and preserves the requested device", async () => {
      const calls: ExecCall[] = [];
      const result = await openUrl(
        { platform: "android", device: "emulator-5554", url: "fixture://customers/1?authorization=Bearer-secret" },
        { execFile: recordingExec(calls) },
      );

      assert.deepEqual(calls, [
        {
          file: "adb",
          args: [
            "-s",
            "emulator-5554",
            "shell",
            "am",
            "start",
            "-a",
            "android.intent.action.VIEW",
            "-d",
            "fixture://customers/1?authorization=Bearer-secret",
          ],
          options: { timeout: 30_000, rejectOnError: false },
        },
      ]);
      assert.deepEqual(parseToolJson(result), {
        platform: "android",
        device: "emulator-5554",
        stdout: "android opened fixture://customers/1?authorization=[redacted]",
        stderr: "",
      });
    });
  });

  describe("open-route action", () => {
    it("validates cwd before device resolution", async () => {
      const missing = join(tmpdir(), `expo98-route-missing-${Date.now()}`);
      const calls: ExecCall[] = [];

      await assert.rejects(
        () => openExpoRoute({ cwd: missing, scheme: "fixture", route: "/customers" }, { execFile: recordingExec(calls) }),
        new RegExp(`Directory does not exist: ${escapeRegExp(resolve(missing))}`),
      );
      assert.deepEqual(calls, []);
    });

    it("uses an explicit URL, rejects whitespace, redacts returned cookie, includes exec error, and calls simctl openurl", async () => {
      const cwd = await tempProject();
      const calls: ExecCall[] = [];
      try {
        await assert.rejects(
          () => openExpoRoute({ cwd, url: "fixture:///customers bad" }, { execFile: recordingExec(calls) }),
          /url must not contain whitespace\./,
        );

        const result = await openExpoRoute(
          { cwd, url: "fixture:///customers?cookie=secret&token=keep&password=raw" },
          { execFile: recordingExec(calls, SIMULATORS_JSON, { code: 64, message: "fixture failure fixture:///customers?secret=raw" }) },
        );

        assert.deepEqual(calls.at(-1), {
          file: "xcrun",
          args: ["simctl", "openurl", "SIM-15", "fixture:///customers?cookie=secret&token=keep&password=raw"],
          options: { timeout: 30_000, rejectOnError: false },
        });
        assert.deepEqual(parseToolJson(result), {
          platform: "ios",
          device: {
            name: "iPhone 15",
            udid: "SIM-15",
            state: "Booted",
            isAvailable: true,
            runtime: "com.apple.CoreSimulator.SimRuntime.iOS-18-0",
          },
          url: "fixture:///customers?cookie=[redacted]&token=[redacted]&password=[redacted]",
          stdout: "opened SIM-15 fixture:///customers?cookie=[redacted]&token=[redacted]&password=[redacted]",
          stderr: "",
          error: { code: 64, message: "fixture failure fixture:///customers?secret=[redacted]", signal: null },
        });
      } finally {
        await rm(cwd, { recursive: true, force: true });
      }
    });

    it("builds the route URL from inferred scheme, route, query, and authCookie", async () => {
      const cwd = await tempProject({
        "app.json": JSON.stringify({ expo: { scheme: "fixture" } }),
      });
      const calls: ExecCall[] = [];
      try {
        const result = await openExpoRoute(
          {
            cwd,
            route: "/customers",
            query: "token=keep&cookie=old",
            authCookie: "session=abc",
          },
          { execFile: recordingExec(calls) },
        );

        assert.deepEqual(calls.at(-1)?.args, [
          "simctl",
          "openurl",
          "SIM-15",
          "fixture:///customers?token=keep&cookie=session%3Dabc",
        ]);
        assert.equal(
          parseToolJson(result).url,
          "fixture:///customers?token=[redacted]&cookie=[redacted]",
        );
      } finally {
        await rm(cwd, { recursive: true, force: true });
      }
    });
  });

  describe("process name extraction", () => {
    it("returns null for missing bundle IDs and sanitizes the last dotted segment", () => {
      assert.equal(processNameFromBundleId(null), null);
      assert.equal(processNameFromBundleId(""), null);
      assert.equal(processNameFromBundleId("com.example.Expo-App_1"), "Expo-App_1");
      assert.equal(processNameFromBundleId("com.example.$Bad!Name"), "BadName");
      assert.equal(processNameFromBundleId("com.example."), "example");
    });
  });
});

async function tempProject(files: Record<string, string> = {}): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "expo98-route-url-actions-"));
  for (const [relativePath, contents] of Object.entries(files)) {
    const filePath = join(dir, relativePath);
    const parent = filePath.slice(0, filePath.lastIndexOf("/"));
    await mkdir(parent, { recursive: true });
    await writeFile(filePath, contents);
  }
  return dir;
}

function recordingExec(calls: ExecCall[], devicesJson = SIMULATORS_JSON, openError: ExecErrorResult | undefined = undefined): ExecFile {
  return async (file, args, options) => {
    calls.push({ file, args: [...args], options });

    if (file === "xcrun" && args.join(" ") === "simctl list devices available --json") {
      return { stdout: devicesJson, stderr: "" };
    }

    if (file === "xcrun" && args[0] === "simctl" && args[1] === "openurl") {
      return {
        stdout: `opened ${String(args[2])} ${String(args[3])}`,
        stderr: "",
        error: openError,
      };
    }

    if (file === "adb" && args.includes("android.intent.action.VIEW")) {
      return {
        stdout: `android opened ${String(args.at(-1))}`,
        stderr: "",
      };
    }

    throw new Error(`unexpected exec call: ${file} ${args.join(" ")}`);
  };
}

function parseToolJson(result: ToolTextResult): Record<string, unknown> {
  assert.equal(result.content[0]?.type, "text");
  return JSON.parse(result.content[0]?.text ?? "{}") as Record<string, unknown>;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
