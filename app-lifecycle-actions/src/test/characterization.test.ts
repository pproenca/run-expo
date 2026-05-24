import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  attachIosCrashEvidence,
  bootSimulator,
  collectAppLogs,
  installApp,
  iosCrashEvidence,
  iosLogPredicate,
  launchApp,
  matchingIosCrashReports,
  readCrashReportMetadata,
  reloadApp,
  resolveBundleId,
  terminateApp,
  truncateSubprocessOutput,
  uninstallApp,
} from "../main/index.js";
import type {
  ActionPolicyDecision,
  AppLifecycleDependencies,
  DiagnosticReportEntry,
  ExecCall,
  ExecResult,
  IosDevice,
  RuntimeSummary,
} from "../main/index.js";

const NOW_MS = Date.parse("2026-05-23T12:00:00.000Z");
const DEFAULT_DEVICE: IosDevice = {
  udid: "SIM-1",
  name: "iPhone 15",
  state: "Booted",
  runtime: "com.apple.CoreSimulator.SimRuntime.iOS-18-0",
  isAvailable: true,
};

const ALLOWED_POLICY: ActionPolicyDecision = {
  checked: true,
  action: "install-app",
  sideEffect: "device",
  allowed: true,
  source: "/work/policy.json",
  reason: "Action allowed by policy.",
};

const DENIED_POLICY: ActionPolicyDecision = {
  checked: true,
  action: "install-app",
  sideEffect: "device",
  allowed: false,
  source: null,
  reason: "No action policy allowed this state-changing operation.",
};

describe("app-lifecycle-actions legacy characterization", () => {
  describe("launchApp", () => {
    it("returns policy-denied launch payload before resolving devices or executing commands", async () => {
      const { deps, calls } = depsWith({
        policyDecision: async () => ({ ...DENIED_POLICY, action: "launch-app" }),
      });

      const payload = await launchApp({ platform: "ios", bundleId: "com.example.fixture" }, deps);

      assert.deepEqual(calls, []);
      assert.deepEqual(payload, {
        available: false,
        domain: "app",
        action: "launch-app",
        source: "policy",
        evidenceSource: "policy",
        code: "policy-denied",
        denied: true,
        reason: "Policy denied action.",
        policy: { ...DENIED_POLICY, action: "launch-app" },
      });
    });

    it("launches Android package/activity with adb am start and reports truncated output", async () => {
      const longStdout = `${"x".repeat(40_000)}overflow`;
      const { deps, calls } = depsWith({ execResults: [{ stdout: longStdout, stderr: "", error: null }] });

      const payload = await launchApp({
        platform: "android",
        device: "emulator-5554",
        packageName: "com.example.fixture",
        activity: "MainActivity",
      }, deps);

      assert.deepEqual(calls, [{
        file: "adb",
        args: ["-s", "emulator-5554", "shell", "am", "start", "-n", "com.example.fixture/MainActivity"],
        options: { timeout: 30_000, rejectOnError: false },
      }]);
      assert.deepEqual(payload, {
        platform: "android",
        packageName: "com.example.fixture",
        stdout: `${"x".repeat(40_000)}\n[truncated 8 characters]`,
        stderr: "",
      });
    });

    it("launches Android package without activity through adb monkey", async () => {
      const { deps, calls } = depsWith({ execResults: [{ stdout: "monkey ok", stderr: "", error: null }] });

      const payload = await launchApp({ platform: "android", packageName: "com.example.fixture" }, deps);

      assert.deepEqual(calls, [{
        file: "adb",
        args: ["shell", "monkey", "-p", "com.example.fixture", "1"],
        options: { timeout: 30_000, rejectOnError: false },
      }]);
      assert.deepEqual(payload, {
        platform: "android",
        packageName: "com.example.fixture",
        stdout: "monkey ok",
        stderr: "",
      });
    });

    it("requires iOS bundleId when bundleId and packageName are absent", async () => {
      const { deps } = depsWith();

      await assert.rejects(
        async () => launchApp({ platform: "ios" }, deps),
        /bundleId must be a non-empty string\./,
      );
    });

    it("launches iOS bundleId with xcrun simctl launch and appends empty crash evidence", async () => {
      const { deps, calls } = depsWith({ execResults: [{ stdout: "com.example.fixture: 1234", stderr: "", error: null }] });

      const payload = await launchApp({
        platform: "ios",
        device: "iPhone 15",
        bundleId: "com.example.fixture",
        crashCheckMs: 0,
      }, deps);

      assert.deepEqual(calls, [{
        file: "xcrun",
        args: ["simctl", "launch", "SIM-1", "com.example.fixture"],
        options: { timeout: 30_000, rejectOnError: false },
      }]);
      assert.deepEqual(payload, {
        platform: "ios",
        device: DEFAULT_DEVICE,
        bundleId: "com.example.fixture",
        available: true,
        stdout: "com.example.fixture: 1234",
        stderr: "",
        error: null,
        crashCheck: {
          action: "launch-app",
          bundleId: "com.example.fixture",
          processName: null,
          since: "2026-05-23T12:00:00.000Z",
          waitedMs: 0,
          reportCount: 0,
        },
        crashReports: [],
      });
    });

    it("marks iOS launch unavailable when xcrun returns an exec error", async () => {
      const error = { message: "Command failed: xcrun simctl launch", code: 1, signal: null };
      const { deps } = depsWith({ execResults: [{ stdout: "", stderr: "failed", error }] });

      const payload = await launchApp({ platform: "ios", bundleId: "com.example.fixture" }, deps);

      assert.deepEqual(payload, {
        platform: "ios",
        device: DEFAULT_DEVICE,
        bundleId: "com.example.fixture",
        available: false,
        stdout: "",
        stderr: "failed",
        error,
        crashCheck: {
          action: "launch-app",
          bundleId: "com.example.fixture",
          processName: null,
          since: "2026-05-23T12:00:00.000Z",
          waitedMs: 0,
          reportCount: 0,
        },
        crashReports: [],
      });
    });

    it("attaches matching iOS crash reports and overrides launch availability", async () => {
      const { deps } = depsWith({
        execResults: [{ stdout: "com.maddie.console: 1234", stderr: "", error: null }],
        reports: [report({
          name: "MaddieConsole-2026-05-23.ips",
          path: "/reports/MaddieConsole-2026-05-23.ips",
          content: "{\"app_name\":\"MaddieConsole\",\"bundleID\":\"com.maddie.console\",\"incident_id\":\"CRASH-1\"}\n{}",
        })],
      });

      const payload = await launchApp({
        platform: "ios",
        bundleId: "com.maddie.console",
        processName: "MaddieConsole",
        crashCheckMs: 1,
      }, deps);

      assert.deepEqual(payload, {
        platform: "ios",
        device: DEFAULT_DEVICE,
        bundleId: "com.maddie.console",
        available: false,
        stdout: "com.maddie.console: 1234",
        stderr: "",
        error: null,
        crashCheck: {
          action: "launch-app",
          bundleId: "com.maddie.console",
          processName: "MaddieConsole",
          since: "2026-05-23T12:00:00.000Z",
          waitedMs: 1,
          reportCount: 1,
        },
        crashReports: [{
          path: "/reports/MaddieConsole-2026-05-23.ips",
          file: "MaddieConsole-2026-05-23.ips",
          mtime: "2026-05-23T12:00:01.000Z",
          appName: "MaddieConsole",
          bundleId: "com.maddie.console",
          incidentId: "CRASH-1",
        }],
        reason: "The app generated 1 matching iOS crash report(s) after launch-app.",
      });
    });
  });

  describe("terminateApp", () => {
    it("returns policy-denied terminate payload before resolving bundle ids or executing commands", async () => {
      const { deps, calls } = depsWith({
        policyDecision: async () => ({ ...DENIED_POLICY, action: "terminate-app" }),
      });

      const payload = await terminateApp({ platform: "android", packageName: "com.example.fixture" }, deps);

      assert.deepEqual(calls, []);
      assert.deepEqual(payload, {
        available: false,
        domain: "app",
        action: "terminate-app",
        source: "policy",
        evidenceSource: "policy",
        code: "policy-denied",
        denied: true,
        reason: "Policy denied action.",
        policy: { ...DENIED_POLICY, action: "terminate-app" },
      });
    });

    it("returns the dryRun terminate payload before shelling out", async () => {
      const { deps, calls } = depsWith();

      const payload = await terminateApp({
        platform: "android",
        packageName: "com.example.fixture",
        dryRun: true,
      }, deps);

      assert.deepEqual(calls, []);
      assert.deepEqual(payload, {
        available: true,
        dryRun: true,
        action: "terminate-app",
        platform: "android",
        bundleId: "com.example.fixture",
      });
    });

    it("terminates Android apps with adb force-stop and packageName output", async () => {
      const { deps, calls } = depsWith({ execResults: [{ stdout: "", stderr: "", error: null }] });

      const payload = await terminateApp({
        platform: "android",
        device: "emulator-5554",
        bundleId: "com.example.fixture",
      }, deps);

      assert.deepEqual(calls, [{
        file: "adb",
        args: ["-s", "emulator-5554", "shell", "am", "force-stop", "com.example.fixture"],
        options: { timeout: 20_000, rejectOnError: false },
      }]);
      assert.deepEqual(payload, {
        available: true,
        action: "terminate-app",
        platform: "android",
        packageName: "com.example.fixture",
        stdout: "",
        stderr: "",
        error: null,
      });
    });

    it("terminates iOS apps with xcrun simctl terminate and preserves exec errors", async () => {
      const error = { message: "Command failed: xcrun simctl terminate", code: 149, signal: null };
      const { deps, calls } = depsWith({ execResults: [{ stdout: "", stderr: "not running", error }] });

      const payload = await terminateApp({ platform: "ios", bundleId: "com.example.fixture" }, deps);

      assert.deepEqual(calls, [{
        file: "xcrun",
        args: ["simctl", "terminate", "SIM-1", "com.example.fixture"],
        options: { timeout: 20_000, rejectOnError: false },
      }]);
      assert.deepEqual(payload, {
        available: false,
        action: "terminate-app",
        platform: "ios",
        device: DEFAULT_DEVICE,
        bundleId: "com.example.fixture",
        stdout: "",
        stderr: "not running",
        error,
      });
    });
  });

  describe("reloadApp", () => {
    it("returns policy-denied reload payload before terminate or launch commands", async () => {
      const { deps, calls } = depsWith({
        policyDecision: async () => ({ ...DENIED_POLICY, action: "reload-app" }),
      });

      const payload = await reloadApp({ bundleId: "com.example.fixture" }, deps);

      assert.deepEqual(calls, []);
      assert.deepEqual(payload, {
        available: false,
        domain: "app",
        action: "reload-app",
        source: "policy",
        evidenceSource: "policy",
        code: "policy-denied",
        denied: true,
        reason: "Policy denied action.",
        policy: { ...DENIED_POLICY, action: "reload-app" },
      });
    });

    it("returns dryRun reload payload after resolving the bundle id", async () => {
      const { deps, calls } = depsWith();

      const payload = await reloadApp({ bundleId: "com.example.fixture", dryRun: true }, deps);

      assert.deepEqual(calls, []);
      assert.deepEqual(payload, {
        available: true,
        dryRun: true,
        action: "reload-app",
        bundleId: "com.example.fixture",
      });
    });

    it("uses terminate-and-launch strategy and nests both payloads", async () => {
      const { deps, calls } = depsWith({
        execResults: [
          { stdout: "", stderr: "", error: null },
          { stdout: "com.example.fixture: 1234", stderr: "", error: null },
        ],
      });

      const payload = await reloadApp({ platform: "ios", bundleId: "com.example.fixture" }, deps);

      assert.deepEqual(calls.map((call) => call.args), [
        ["simctl", "terminate", "SIM-1", "com.example.fixture"],
        ["simctl", "launch", "SIM-1", "com.example.fixture"],
      ]);
      assert.deepEqual(payload, {
        available: true,
        action: "reload-app",
        bundleId: "com.example.fixture",
        strategy: "terminate-and-launch",
        terminated: {
          available: true,
          action: "terminate-app",
          platform: "ios",
          device: DEFAULT_DEVICE,
          bundleId: "com.example.fixture",
          stdout: "",
          stderr: "",
          error: null,
        },
        launched: {
          platform: "ios",
          device: DEFAULT_DEVICE,
          bundleId: "com.example.fixture",
          available: true,
          stdout: "com.example.fixture: 1234",
          stderr: "",
          error: null,
          crashCheck: {
            action: "launch-app",
            bundleId: "com.example.fixture",
            processName: null,
            since: "2026-05-23T12:00:00.000Z",
            waitedMs: 0,
            reportCount: 0,
          },
          crashReports: [],
        },
      });
    });

    it("marks reload unavailable when launch reports unavailable or has an error", async () => {
      const error = { message: "Command failed: xcrun simctl launch", code: 1, signal: null };
      const { deps } = depsWith({
        execResults: [
          { stdout: "", stderr: "", error: null },
          { stdout: "", stderr: "boom", error },
        ],
      });

      const payload = await reloadApp({ platform: "ios", bundleId: "com.example.fixture" }, deps);

      assert.equal(payload.available, false);
      assert.deepEqual(payload.launched, {
        platform: "ios",
        device: DEFAULT_DEVICE,
        bundleId: "com.example.fixture",
        available: false,
        stdout: "",
        stderr: "boom",
        error,
        crashCheck: {
          action: "launch-app",
          bundleId: "com.example.fixture",
          processName: null,
          since: "2026-05-23T12:00:00.000Z",
          waitedMs: 0,
          reportCount: 0,
        },
        crashReports: [],
      });
    });
  });

  describe("iOS crash evidence", () => {
    it("clamps crash evidence delay to 0..30000 and records waitedMs", async () => {
      const low = depsWith();
      const high = depsWith();

      const lowPayload = await iosCrashEvidence({
        bundleId: "com.example.fixture",
        processName: undefined,
        sinceMs: NOW_MS,
        waitMs: -5,
        action: "launch-app",
      }, low.deps);
      const highPayload = await iosCrashEvidence({
        bundleId: "com.example.fixture",
        processName: undefined,
        sinceMs: NOW_MS,
        waitMs: 99_999,
        action: "launch-app",
      }, high.deps);

      assert.deepEqual(low.waits, []);
      assert.deepEqual(lowPayload.crashCheck, {
        action: "launch-app",
        bundleId: "com.example.fixture",
        processName: null,
        since: "2026-05-23T12:00:00.000Z",
        waitedMs: 0,
        reportCount: 0,
      });
      assert.deepEqual(high.waits, [30_000]);
      assert.deepEqual(highPayload.crashCheck, {
        action: "launch-app",
        bundleId: "com.example.fixture",
        processName: null,
        since: "2026-05-23T12:00:00.000Z",
        waitedMs: 30_000,
        reportCount: 0,
      });
    });

    it("coerces numeric string delays and rejects non-finite delay values like legacy clampNumber", async () => {
      const stringDelay = depsWith();
      const badDelay = depsWith();

      const payload = await iosCrashEvidence({
        bundleId: "com.example.fixture",
        sinceMs: NOW_MS,
        waitMs: "5",
        action: "launch-app",
      }, stringDelay.deps);

      assert.deepEqual(stringDelay.waits, [5]);
      assert.deepEqual(payload.crashCheck, {
        action: "launch-app",
        bundleId: "com.example.fixture",
        processName: null,
        since: "2026-05-23T12:00:00.000Z",
        waitedMs: 5,
        reportCount: 0,
      });
      await assert.rejects(
        async () => iosCrashEvidence({
          bundleId: "com.example.fixture",
          sinceMs: NOW_MS,
          waitMs: "bad",
          action: "launch-app",
        }, badDelay.deps),
        /Expected a finite number, got bad\./,
      );
    });


    it("filters iOS crash reports by extension, file type, mtime cutoff, bundleId, and processName", async () => {
      const { deps } = depsWith({
        reports: [
          report({
            name: "NotAReport.txt",
            path: "/reports/NotAReport.txt",
            content: "{\"bundleID\":\"com.example.fixture\"}",
          }),
          report({
            name: "OldFixture.ips",
            path: "/reports/OldFixture.ips",
            mtimeMs: NOW_MS - 1,
            mtimeIso: "2026-05-23T11:59:59.999Z",
            content: "{\"bundleID\":\"com.example.fixture\",\"incident_id\":\"OLD\"}",
          }),
          report({
            name: "FixtureByBundle.ips",
            path: "/reports/b-FixtureByBundle.ips",
            content: "{\"app_name\":\"FixtureApp\",\"bundleID\":\"com.example.fixture\",\"incident_id\":\"BUNDLE\"}\n{}",
          }),
          report({
            name: "FixtureProc.crash",
            path: "/reports/a-FixtureProc.crash",
            content: "{\"procName\":\"FixtureProc\",\"bundleId\":\"com.other.app\",\"incident\":\"PROC\"}\nstack",
          }),
          report({
            name: "Directory.ips",
            path: "/reports/Directory.ips",
            isFile: false,
            content: "{\"bundleID\":\"com.example.fixture\"}",
          }),
        ],
      });

      const matches = await matchingIosCrashReports({
        bundleId: "com.example.fixture",
        processName: "FixtureProc",
        sinceMs: NOW_MS,
      }, deps);

      assert.deepEqual(matches, [
        {
          path: "/reports/a-FixtureProc.crash",
          file: "FixtureProc.crash",
          mtime: "2026-05-23T12:00:01.000Z",
          appName: "FixtureProc",
          bundleId: "com.other.app",
          incidentId: "PROC",
        },
        {
          path: "/reports/b-FixtureByBundle.ips",
          file: "FixtureByBundle.ips",
          mtime: "2026-05-23T12:00:01.000Z",
          appName: "FixtureApp",
          bundleId: "com.example.fixture",
          incidentId: "BUNDLE",
        },
      ]);
    });

    it("returns no crash reports when neither bundleId nor processName is available", async () => {
      const { deps } = depsWith({
        reports: [report({
          name: "Fixture.ips",
          path: "/reports/Fixture.ips",
          content: "{\"bundleID\":\"com.example.fixture\"}",
        })],
      });

      assert.deepEqual(await matchingIosCrashReports({ sinceMs: NOW_MS }, deps), []);
    });

    it("parses only first-line JSON crash metadata and returns null for non-JSON or malformed lines", async () => {
      const { deps } = depsWith({
        reports: [
          report({
            name: "Good.ips",
            path: "/reports/Good.ips",
            content: "{\"app_name\":\"FixtureApp\",\"bundleID\":\"com.example.fixture\"}\nsecond line ignored",
          }),
          report({ name: "Plain.crash", path: "/reports/Plain.crash", content: "Process: FixtureApp" }),
          report({ name: "Bad.ips", path: "/reports/Bad.ips", content: "{\"app_name\":" }),
        ],
      });

      assert.deepEqual(await readCrashReportMetadata("/reports/Good.ips", deps), {
        app_name: "FixtureApp",
        bundleID: "com.example.fixture",
      });
      assert.equal(await readCrashReportMetadata("/reports/Plain.crash", deps), null);
      assert.equal(await readCrashReportMetadata("/reports/Bad.ips", deps), null);
    });

    it("attachIosCrashEvidence is a no-op for non-iOS payloads", async () => {
      const { deps } = depsWith();

      const payload = await attachIosCrashEvidence(
        { platform: "android", available: true },
        { platform: "android", bundleId: "com.example.fixture", sinceMs: NOW_MS, action: "launch-app" },
        deps,
      );

      assert.deepEqual(payload, { platform: "android", available: true });
    });
  });

  describe("installApp and uninstallApp", () => {
    it("returns policy-denied install payload before executing commands", async () => {
      const { deps, calls } = depsWith({
        policyDecision: async () => ({ ...DENIED_POLICY, action: "install-app" }),
      });

      const payload = await installApp({ platform: "android", appPath: "/work/build/app.apk" }, deps);

      assert.deepEqual(calls, []);
      assert.deepEqual(payload, {
        available: false,
        domain: "app",
        action: "install-app",
        source: "policy",
        evidenceSource: "policy",
        code: "policy-denied",
        denied: true,
        reason: "Policy denied action.",
        policy: { ...DENIED_POLICY, action: "install-app" },
      });
    });

    it("returns dryRun install payload after policy approval", async () => {
      const { deps, calls } = depsWith({
        policyDecision: async () => ({ ...ALLOWED_POLICY, action: "install-app" }),
      });

      const payload = await installApp({
        platform: "ios",
        appPath: "/work/build/Fixture.app",
        dryRun: true,
      }, deps);

      assert.deepEqual(calls, []);
      assert.deepEqual(payload, {
        available: true,
        dryRun: true,
        action: "install-app",
        platform: "ios",
        appPath: "/work/build/Fixture.app",
        policy: { ...ALLOWED_POLICY, action: "install-app" },
      });
    });

    it("installs Android apps with adb install -r and preserves unavailable exec payloads", async () => {
      const error = { message: "Command failed: adb install", code: 1, signal: null };
      const { deps, calls } = depsWith({
        execResults: [{ stdout: "", stderr: "INSTALL_FAILED", error }],
        policyDecision: async () => ({ ...ALLOWED_POLICY, action: "install-app" }),
      });

      const payload = await installApp({
        platform: "android",
        device: "emulator-5554",
        appPath: "/work/build/app.apk",
      }, deps);

      assert.deepEqual(calls, [{
        file: "adb",
        args: ["-s", "emulator-5554", "install", "-r", "/work/build/app.apk"],
        options: { timeout: 120_000, rejectOnError: false },
      }]);
      assert.deepEqual(payload, {
        available: false,
        action: "install-app",
        platform: "android",
        appPath: "/work/build/app.apk",
        stdout: "",
        stderr: "INSTALL_FAILED",
        error,
        policy: { ...ALLOWED_POLICY, action: "install-app" },
      });
    });

    it("installs iOS apps with xcrun simctl install", async () => {
      const { deps, calls } = depsWith({
        execResults: [{ stdout: "installed", stderr: "", error: null }],
        policyDecision: async () => ({ ...ALLOWED_POLICY, action: "install-app" }),
      });

      const payload = await installApp({ platform: "ios", appPath: "/work/build/Fixture.app" }, deps);

      assert.deepEqual(calls, [{
        file: "xcrun",
        args: ["simctl", "install", "SIM-1", "/work/build/Fixture.app"],
        options: { timeout: 120_000, rejectOnError: false },
      }]);
      assert.deepEqual(payload, {
        available: true,
        action: "install-app",
        platform: "ios",
        device: DEFAULT_DEVICE,
        appPath: "/work/build/Fixture.app",
        stdout: "installed",
        stderr: "",
        error: null,
        policy: { ...ALLOWED_POLICY, action: "install-app" },
      });
    });

    it("returns policy-denied uninstall payload before resolving devices or executing commands", async () => {
      const { deps, calls } = depsWith({
        policyDecision: async () => ({ ...DENIED_POLICY, action: "uninstall-app" }),
      });

      const payload = await uninstallApp({ platform: "ios", bundleId: "com.example.fixture" }, deps);

      assert.deepEqual(calls, []);
      assert.deepEqual(payload, {
        available: false,
        domain: "app",
        action: "uninstall-app",
        source: "policy",
        evidenceSource: "policy",
        code: "policy-denied",
        denied: true,
        reason: "Policy denied action.",
        policy: { ...DENIED_POLICY, action: "uninstall-app" },
      });
    });

    it("returns dryRun uninstall payload after resolving bundleId and policy", async () => {
      const { deps, calls } = depsWith({
        policyDecision: async () => ({ ...ALLOWED_POLICY, action: "uninstall-app" }),
      });

      const payload = await uninstallApp({
        platform: "android",
        bundleId: "com.example.fixture",
        dryRun: true,
      }, deps);

      assert.deepEqual(calls, []);
      assert.deepEqual(payload, {
        available: true,
        dryRun: true,
        action: "uninstall-app",
        platform: "android",
        bundleId: "com.example.fixture",
        policy: { ...ALLOWED_POLICY, action: "uninstall-app" },
      });
    });

    it("uninstalls Android packages with adb uninstall", async () => {
      const { deps, calls } = depsWith({
        execResults: [{ stdout: "Success", stderr: "", error: null }],
        policyDecision: async () => ({ ...ALLOWED_POLICY, action: "uninstall-app" }),
      });

      const payload = await uninstallApp({
        platform: "android",
        bundleId: "com.example.fixture",
      }, deps);

      assert.deepEqual(calls, [{
        file: "adb",
        args: ["uninstall", "com.example.fixture"],
        options: { timeout: 60_000, rejectOnError: false },
      }]);
      assert.deepEqual(payload, {
        available: true,
        action: "uninstall-app",
        platform: "android",
        packageName: "com.example.fixture",
        stdout: "Success",
        stderr: "",
        error: null,
        policy: { ...ALLOWED_POLICY, action: "uninstall-app" },
      });
    });

    it("uninstalls iOS bundles with xcrun simctl uninstall and reports exec errors", async () => {
      const error = { message: "Command failed: xcrun simctl uninstall", code: 1, signal: null };
      const { deps, calls } = depsWith({
        execResults: [{ stdout: "", stderr: "No such app", error }],
        policyDecision: async () => ({ ...ALLOWED_POLICY, action: "uninstall-app" }),
      });

      const payload = await uninstallApp({
        platform: "ios",
        bundleId: "com.example.fixture",
      }, deps);

      assert.deepEqual(calls, [{
        file: "xcrun",
        args: ["simctl", "uninstall", "SIM-1", "com.example.fixture"],
        options: { timeout: 60_000, rejectOnError: false },
      }]);
      assert.deepEqual(payload, {
        available: false,
        action: "uninstall-app",
        platform: "ios",
        device: DEFAULT_DEVICE,
        bundleId: "com.example.fixture",
        stdout: "",
        stderr: "No such app",
        error,
        policy: { ...ALLOWED_POLICY, action: "uninstall-app" },
      });
    });
  });

  describe("resolveBundleId", () => {
    it("prefers explicit bundleId and trims it", async () => {
      const { deps } = depsWith({
        runtimeSummary: async () => ({ appConfig: { iosBundleIdentifier: "com.inferred.ios" } }),
      });

      assert.equal(await resolveBundleId({ bundleId: "  com.example.explicit  " }, deps), "com.example.explicit");
    });

    it("uses packageName as the explicit fallback", async () => {
      const { deps } = depsWith();

      assert.equal(await resolveBundleId({ packageName: "com.example.android" }, deps), "com.example.android");
    });

    it("infers iosBundleIdentifier before androidPackage from the runtime summary adapter", async () => {
      const { deps } = depsWith({
        runtimeSummary: async (cwd) => {
          assert.equal(cwd, "/work/app");
          return {
            appConfig: {
              iosBundleIdentifier: "com.example.ios",
              androidPackage: "com.example.android",
            },
          };
        },
      });

      assert.equal(await resolveBundleId({ cwd: "/work/app" }, deps), "com.example.ios");
    });

    it("falls back to androidPackage when iosBundleIdentifier is absent", async () => {
      const { deps } = depsWith({
        runtimeSummary: async () => ({ appConfig: { androidPackage: "com.example.android" } }),
      });

      assert.equal(await resolveBundleId({ cwd: "/work/app" }, deps), "com.example.android");
    });

    it("throws when bundleId is not explicit or inferable", async () => {
      const { deps } = depsWith({ runtimeSummary: async () => ({ appConfig: {} }) });

      await assert.rejects(
        async () => resolveBundleId({ cwd: "/work/app" }, deps),
        /bundleId must be provided or inferable from Expo app config\./,
      );
    });
  });

  describe("collectAppLogs", () => {
    it("clamps Android log line count to 1..5000 and passes adb logcat args", async () => {
      const low = depsWith({ execResults: [{ stdout: "one line", stderr: "", error: null }] });
      const high = depsWith({ execResults: [{ stdout: "many lines", stderr: "", error: null }] });

      const lowPayload = await collectAppLogs({ platform: "android", device: "emulator-5554", lines: 0 }, low.deps);
      const highPayload = await collectAppLogs({ platform: "android", lines: 9_999 }, high.deps);

      assert.deepEqual(low.calls, [{
        file: "adb",
        args: ["-s", "emulator-5554", "logcat", "-d", "-t", "1"],
        options: { timeout: 30_000, maxBuffer: 4 * 1024 * 1024, rejectOnError: false },
      }]);
      assert.deepEqual(lowPayload, {
        platform: "android",
        device: "emulator-5554",
        stdout: "one line",
        stderr: "",
      });
      assert.deepEqual(high.calls, [{
        file: "adb",
        args: ["logcat", "-d", "-t", "5000"],
        options: { timeout: 30_000, maxBuffer: 4 * 1024 * 1024, rejectOnError: false },
      }]);
      assert.deepEqual(highPayload, {
        platform: "android",
        device: null,
        stdout: "many lines",
        stderr: "",
      });
    });

    it("coerces numeric string Android log line counts and rejects invalid counts", async () => {
      const { deps, calls } = depsWith({ execResults: [{ stdout: "three", stderr: "", error: null }] });

      const payload = await collectAppLogs({ platform: "android", lines: "3" }, deps);

      assert.deepEqual(calls, [{
        file: "adb",
        args: ["logcat", "-d", "-t", "3"],
        options: { timeout: 30_000, maxBuffer: 4 * 1024 * 1024, rejectOnError: false },
      }]);
      assert.deepEqual(payload, {
        platform: "android",
        device: null,
        stdout: "three",
        stderr: "",
      });
      await assert.rejects(
        async () => collectAppLogs({ platform: "android", lines: "many" }, deps),
        /Expected a finite number, got many\./,
      );
    });


    it("rejects invalid iOS last values with the legacy validation message", async () => {
      const { deps } = depsWith();

      await assert.rejects(
        async () => collectAppLogs({ platform: "ios", bundleId: "com.example.fixture", last: "two-minutes" }, deps),
        /last must look like 30s, 2m, 1h, or 1d\./,
      );
    });

    it("passes explicit iOS log predicates through to xcrun log show", async () => {
      const { deps, calls } = depsWith({ execResults: [{ stdout: "log", stderr: "", error: null }] });

      const payload = await collectAppLogs({
        platform: "ios",
        last: "30s",
        predicate: "subsystem == \"com.example\"",
      }, deps);

      assert.deepEqual(calls, [{
        file: "xcrun",
        args: [
          "simctl",
          "spawn",
          "SIM-1",
          "log",
          "show",
          "--style",
          "compact",
          "--last",
          "30s",
          "--predicate",
          "subsystem == \"com.example\"",
        ],
        options: { timeout: 45_000, maxBuffer: 5 * 1024 * 1024, rejectOnError: false },
      }]);
      assert.deepEqual(payload, {
        platform: "ios",
        device: DEFAULT_DEVICE,
        last: "30s",
        predicate: "subsystem == \"com.example\"",
        stdout: "log",
        stderr: "",
      });
    });

    it("builds iOS log predicates from processName or bundleId with escaping", () => {
      assert.equal(
        iosLogPredicate({ processName: "Fixture \"QA\" \\ Beta" }),
        "process == \"Fixture \\\"QA\\\" \\\\ Beta\"",
      );
      assert.equal(
        iosLogPredicate({ bundleId: "com.example.fixture-app" }),
        "process CONTAINS \"fixture-app\"",
      );
      assert.equal(iosLogPredicate({}), null);
    });

    it("uses generated iOS predicates in xcrun log show args", async () => {
      const { deps, calls } = depsWith({ execResults: [{ stdout: "fixture logs", stderr: "", error: null }] });

      const payload = await collectAppLogs({
        platform: "ios",
        bundleId: "com.example.fixture",
      }, deps);

      assert.deepEqual(calls, [{
        file: "xcrun",
        args: [
          "simctl",
          "spawn",
          "SIM-1",
          "log",
          "show",
          "--style",
          "compact",
          "--last",
          "2m",
          "--predicate",
          "process CONTAINS \"fixture\"",
        ],
        options: { timeout: 45_000, maxBuffer: 5 * 1024 * 1024, rejectOnError: false },
      }]);
      assert.deepEqual(payload, {
        platform: "ios",
        device: DEFAULT_DEVICE,
        last: "2m",
        predicate: "process CONTAINS \"fixture\"",
        stdout: "fixture logs",
        stderr: "",
      });
    });
  });

  describe("bootSimulator", () => {
    it("returns policy-denied boot payload before resolving a simulator or executing commands", async () => {
      const { deps, calls } = depsWith({
        policyDecision: async () => ({ ...DENIED_POLICY, action: "boot-simulator" }),
      });

      const payload = await bootSimulator({ device: "iPhone 15" }, deps);

      assert.deepEqual(calls, []);
      assert.deepEqual(payload, {
        available: false,
        domain: "app",
        action: "boot-simulator",
        source: "policy",
        evidenceSource: "policy",
        code: "policy-denied",
        denied: true,
        reason: "Policy denied action.",
        policy: { ...DENIED_POLICY, action: "boot-simulator" },
      });
    });

    it("boots the resolved iOS simulator and suppresses Simulator.app open when requested", async () => {
      const { deps, calls } = depsWith({ execResults: [{ stdout: "booted SIM-1", stderr: "", error: null }] });

      const payload = await bootSimulator({ device: "iPhone 15", openSimulator: false }, deps);

      assert.deepEqual(calls, [{
        file: "xcrun",
        args: ["simctl", "boot", "SIM-1"],
        options: { timeout: 60_000, rejectOnError: false },
      }]);
      assert.deepEqual(payload, {
        requestedDevice: "iPhone 15",
        device: DEFAULT_DEVICE,
        openSimulator: false,
        stdout: "booted SIM-1",
        stderr: "",
      });
    });

    it("opens Simulator.app by default after simctl boot", async () => {
      const { deps, calls } = depsWith({
        execResults: [
          { stdout: "booted SIM-1", stderr: "", error: null },
          { stdout: "", stderr: "", error: null },
        ],
      });

      const payload = await bootSimulator({}, deps);

      assert.deepEqual(calls, [
        {
          file: "xcrun",
          args: ["simctl", "boot", "SIM-1"],
          options: { timeout: 60_000, rejectOnError: false },
        },
        {
          file: "open",
          args: ["-a", "Simulator"],
          options: { timeout: 10_000, rejectOnError: false },
        },
      ]);
      assert.deepEqual(payload, {
        requestedDevice: null,
        device: DEFAULT_DEVICE,
        openSimulator: true,
        stdout: "booted SIM-1",
        stderr: "",
      });
    });
  });

  describe("output truncation", () => {
    it("truncates subprocess output at 40000 characters with the legacy marker", () => {
      assert.equal(
        truncateSubprocessOutput(`${"a".repeat(40_000)}bcdef`),
        `${"a".repeat(40_000)}\n[truncated 5 characters]`,
      );
    });
  });
});

type DepsOverrides = Partial<AppLifecycleDependencies> & {
  execResults?: ExecResult[];
  reports?: DiagnosticReportEntry[];
  runtimeSummary?: (cwd: string) => Promise<RuntimeSummary | null>;
  policyDecision?: (
    args: Record<string, unknown>,
    action: string,
    sideEffect: "device",
  ) => Promise<ActionPolicyDecision>;
};

function depsWith(overrides: DepsOverrides = {}): {
  deps: AppLifecycleDependencies;
  calls: ExecCall[];
  waits: number[];
} {
  const calls: ExecCall[] = [];
  const waits: number[] = [];
  const execResults = [...(overrides.execResults ?? [{ stdout: "", stderr: "", error: null }])];
  const reports = overrides.reports ?? [];

  const deps: AppLifecycleDependencies = {
    execFile: async (file, args, options) => {
      calls.push({ file, args, options });
      return execResults.shift() ?? { stdout: "", stderr: "", error: null };
    },
    resolveIosDevice: async () => DEFAULT_DEVICE,
    wait: async (ms) => {
      waits.push(ms);
    },
    now: () => NOW_MS,
    policyDecision: async (_args, action, sideEffect) => ({
      ...ALLOWED_POLICY,
      action,
      sideEffect,
    }),
    runtimeSummary: async () => null,
    listDiagnosticReports: async () => reports,
    ...overrides,
  };

  return { deps, calls, waits };
}

function report(overrides: Partial<DiagnosticReportEntry>): DiagnosticReportEntry {
  return {
    name: "Fixture.ips",
    path: "/reports/Fixture.ips",
    isFile: true,
    mtimeMs: NOW_MS + 1_000,
    mtimeIso: "2026-05-23T12:00:01.000Z",
    content: "{\"bundleID\":\"com.example.fixture\",\"incident_id\":\"CRASH\"}\n{}",
    ...overrides,
  };
}
