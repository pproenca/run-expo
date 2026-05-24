import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";

import {
  MAX_OUTPUT,
  automationGesture,
  automationTap,
  axeGestureCommandFromPlan,
  captureGestureScreenshot,
  clampNumber,
  clipboardCommand,
  createRefActionAdapter,
  defaultGestureDurationMs,
  executeGesturePlan,
  executeRepeatedCommand,
  gestureCommandPlan,
  keyCodeFor,
  keyboardCommand,
  normalizeGesture,
  normalizeGestureCoordinates,
  refActionCommand,
  requireString,
  setEnvironmentCommand,
  setEnvironmentPlan,
  toolJson,
  truncate,
} from "../main/index.js";
import type {
  ActionPolicyDecision,
  ExecCall,
  ExecResult,
  InteractionDependencies,
  IosDevice,
} from "../main/index.js";

const DEVICE: IosDevice = {
  udid: "SIM-1",
  name: "iPhone 15",
  state: "Booted",
  runtime: "com.apple.CoreSimulator.SimRuntime.iOS-18-0",
  isAvailable: true,
};

const ALLOWED_POLICY: ActionPolicyDecision = {
  checked: true,
  action: "set.appearance",
  sideEffect: "device",
  allowed: true,
  source: "/work/policy.json",
  reason: "Action allowed by policy.",
};

const DENIED_POLICY: ActionPolicyDecision = {
  checked: true,
  action: "set.appearance",
  sideEffect: "device",
  allowed: false,
  source: null,
  reason: "No action policy allowed this state-changing operation.",
};

describe("interaction-actions legacy characterization", () => {
  describe("shared helpers and coordinate taps", () => {
    it("wraps pretty JSON text exactly like legacy toolJson", () => {
      assert.deepEqual(toolJson({ available: true, x: 12 }), {
        content: [{ type: "text", text: "{\n  \"available\": true,\n  \"x\": 12\n}\n" }],
        isError: false,
      });
    });

    it("trims required strings, clamps finite numbers, and rejects invalid inputs", () => {
      assert.equal(requireString("  tap  ", "command"), "tap");
      assert.equal(clampNumber("-5", 0, 10), 0);
      assert.equal(clampNumber("12", 0, 10), 10);
      assert.throws(() => requireString(" ", "ref"), /ref must be a non-empty string\./);
      assert.throws(() => clampNumber("NaN", 0, 10), /Expected a finite number, got NaN\./);
    });

    it("RULE-021 truncates command output with the explicit overflow marker", () => {
      assert.equal(truncate(null), "");
      assert.equal(truncate("short", 10), "short");
      assert.equal(truncate(`${"x".repeat(5)}overflow`, 5), "xxxxx\n[truncated 8 characters]");
      assert.equal(truncate(`${"y".repeat(MAX_OUTPUT)}tail`), `${"y".repeat(MAX_OUTPUT)}\n[truncated 4 characters]`);
    });

    it("dry-runs iOS coordinate taps as idb commands without resolving a device", async () => {
      const { deps, calls } = depsWith();

      const payload = await automationTap({ x: 12, y: 34, dryRun: true }, deps);

      assert.deepEqual(calls, []);
      assert.deepEqual(payload, {
        available: true,
        dryRun: true,
        platform: "ios",
        device: null,
        tool: "idb",
        point: { x: 12, y: 34 },
        command: ["idb", "ui", "tap", "12", "34", "--udid", "<booted-device>"],
      });
    });

    it("dry-runs Android coordinate taps with optional -s device selection", async () => {
      const { deps } = depsWith();

      assert.deepEqual(await automationTap({ platform: "android", device: "emulator-5554", x: 12, y: 34, dryRun: true }, deps), {
        available: true,
        dryRun: true,
        platform: "android",
        device: "emulator-5554",
        tool: "adb",
        point: { x: 12, y: 34 },
        command: ["adb", "-s", "emulator-5554", "shell", "input", "tap", "12", "34"],
      });
    });

    it("executes iOS coordinate taps with idb first, resolved booted device, and truncated output", async () => {
      const longStderr = `${"e".repeat(MAX_OUTPUT)}overflow`;
      const { deps, calls } = depsWith({
        commandPaths: { idb: "/bin/idb", axe: "/bin/axe" },
        execResults: [{ stdout: "tapped\n", stderr: longStderr, error: null }],
      });

      const payload = await automationTap({ x: 12.8, y: -4 }, deps);

      assert.deepEqual(calls, [{
        file: "/bin/idb",
        args: ["ui", "tap", "12.8", "0", "--udid", "SIM-1"],
        options: { timeout: 20_000, rejectOnError: false },
      }]);
      assert.deepEqual(payload, {
        platform: "ios",
        device: DEVICE,
        tool: "idb",
        x: 12.8,
        y: 0,
        stdout: "tapped\n",
        stderr: `${"e".repeat(MAX_OUTPUT)}\n[truncated 8 characters]`,
      });
    });

    it("falls back to axe for iOS coordinate taps when idb is unavailable", async () => {
      const { deps, calls } = depsWith({
        commandPaths: { axe: "/bin/axe" },
        execResults: [{ stdout: "axe tapped", stderr: "", error: null }],
      });

      const payload = await automationTap({ x: 12, y: 34 }, deps);

      assert.deepEqual(calls[0], {
        file: "/bin/axe",
        args: ["tap", "-x", "12", "-y", "34", "--udid", "SIM-1"],
        options: { timeout: 20_000, rejectOnError: false },
      });
      assert.equal(payload.tool, "axe");
    });

    it("throws the legacy missing-tool message when neither idb nor axe exists", async () => {
      const { deps } = depsWith({ commandPaths: {} });

      await assert.rejects(
        async () => automationTap({ x: 12, y: 34 }, deps),
        /iOS coordinate taps require the idb or axe CLI, but neither is installed or on PATH\. Install idb or axe for iOS coordinate automation\./,
      );
    });

    it("RULE-022 policy-denies coordinate taps before device/tool execution", async () => {
      const { deps, calls } = depsWith({
        policyDecision: async () => ({ ...DENIED_POLICY, action: "tap" }),
      });

      assert.deepEqual(await automationTap({ x: 12, y: 34 }, deps), {
        available: false,
        domain: "interaction",
        action: "tap",
        source: "policy",
        evidenceSource: "policy",
        code: "policy-denied",
        denied: true,
        reason: "Policy denied action.",
        policy: { ...DENIED_POLICY, action: "tap" },
      });
      assert.deepEqual(calls, []);
    });

    it("setEnvironmentCommand executes allowed plans and returns unavailable planned domains without shelling out", async () => {
      const { deps, calls } = depsWith({
        execResults: [{ stdout: "changed", stderr: "warning", error: null }],
        policyDecision: async () => ({ ...ALLOWED_POLICY, action: "set.appearance" }),
      });

      assert.deepEqual(await setEnvironmentCommand({ domain: "appearance", value: "dark" }, deps), {
        available: true,
        action: "appearance",
        device: DEVICE,
        command: ["xcrun", "simctl", "ui", "SIM-1", "appearance", "dark"],
        stdout: "changed",
        stderr: "warning",
        error: null,
        policy: { ...ALLOWED_POLICY, action: "set.appearance" },
      });
      assert.deepEqual(calls, [{
        file: "xcrun",
        args: ["simctl", "ui", "SIM-1", "appearance", "dark"],
        options: { timeout: 20_000, rejectOnError: false },
      }]);

      assert.deepEqual(await setEnvironmentCommand({ domain: "network", value: "offline" }, deps), {
        available: false,
        action: "network",
        reason: "network mutation is not exposed by stable simctl/axe commands in this CLI yet.",
        requestedValue: "offline",
        device: DEVICE,
        dryRun: false,
        policy: { ...ALLOWED_POLICY, action: "set.appearance" },
      });
      assert.equal(calls.length, 1);
    });
  });

  describe("ref actions", () => {
    it("ref tap delegates to planRefAction and returns the dry-run plan", async () => {
      const { deps, refPlanCalls } = depsWith({
        refPlans: [{ available: true, dryRun: true, plan: { action: "tap", ref: "@e1", point: { x: 60, y: 40 } } }],
      });

      const payload = await automationTap({ ref: "@e1", dryRun: true }, deps);

      assert.deepEqual(refPlanCalls, [{ ref: "@e1", dryRun: true, action: "tap" }]);
      assert.deepEqual(payload, { available: true, dryRun: true, plan: { action: "tap", ref: "@e1", point: { x: 60, y: 40 } } });
    });

    it("ref tap returns unavailable plans and does not recurse into coordinate tapping", async () => {
      const unavailable = { available: false, reason: "Ref not found in the latest snapshot.", ref: "@missing" };
      const { deps, calls } = depsWith({ refPlans: [unavailable] });

      assert.deepEqual(await automationTap({ ref: "@missing" }, deps), unavailable);
      assert.deepEqual(calls, []);
    });

    it("ref tap recurses executable plans to the calculated coordinate tap", async () => {
      const { deps, calls } = depsWith({
        commandPaths: { idb: "/bin/idb" },
        refPlans: [{ available: true, plan: { point: { x: 60, y: 40 } } }],
        execResults: [{ stdout: "ok", stderr: "", error: null }],
      });

      const payload = await automationTap({ ref: "@e1" }, deps);

      assert.deepEqual(calls[0]?.args, ["ui", "tap", "60", "40", "--udid", "SIM-1"]);
      assert.equal(payload.x, 60);
      assert.equal(payload.y, 40);
    });

    it("ref tap returns unavailable when the plan lacks a point", async () => {
      const { deps } = depsWith({ refPlans: [{ available: true, plan: { action: "tap", ref: "@e1", point: null } }] });

      assert.deepEqual(await automationTap({ ref: "@e1" }, deps), {
        available: false,
        reason: "Ref does not include tappable bounds.",
        ref: "@e1",
      });
    });

    it("refActionCommand scroll-into-view returns current ref payload", async () => {
      const record = { ref: "@e1", role: "button", box: { x: 10, y: 20, width: 100, height: 40 } };
      const { deps } = depsWith({ readRefRecords: [{ available: true, record, cache: { refs: [record] } }] });

      assert.deepEqual(await refActionCommand({ command: "scroll-into-view", ref: "@e1" }, deps), {
        available: true,
        action: "scroll-into-view",
        ref: "@e1",
        reason: "Ref is present in the current snapshot.",
        record,
      });
    });

    it("refActionCommand blur delegates to keyboard Enter", async () => {
      const { deps, calls } = depsWith({
        commandPaths: { axe: "/bin/axe" },
        execResults: [{ stdout: "pressed", stderr: "", error: null }],
      });

      const payload = await refActionCommand({ command: "blur", device: "SIM-1" }, deps);

      assert.deepEqual(calls[0]?.args, ["key", "40", "--udid", "SIM-1"]);
      assert.equal(payload.key, "Enter");
      assert.equal(payload.keycode, 40);
    });

    it("focus/check/uncheck/select wrap tap output with action, ref, and value", async () => {
      const { deps } = depsWith({ refPlans: [{ available: true, dryRun: true, plan: { point: { x: 60, y: 40 } } }] });

      assert.deepEqual(await refActionCommand({ command: "select", ref: "@e1", text: "Choice", dryRun: true }, deps), {
        available: true,
        dryRun: true,
        plan: { point: { x: 60, y: 40 } },
        action: "select",
        ref: "@e1",
        value: "Choice",
      });
    });

    it("fill dry-run describes tap and type sequencing", async () => {
      const { deps } = depsWith();

      assert.deepEqual(await refActionCommand({ command: "fill", ref: "@e3", text: "Ada", dryRun: true }, deps), {
        available: true,
        dryRun: true,
        action: "fill",
        ref: "@e3",
        textLength: 3,
        steps: ["tap ref", "type text"],
      });
    });

    it("fill execution taps then types and reports nested payloads", async () => {
      const { deps, calls } = depsWith({
        commandPaths: { idb: "/bin/idb", axe: "/bin/axe" },
        refPlans: [{ available: true, plan: { point: { x: 60, y: 40 } } }],
        execResults: [
          { stdout: "tap", stderr: "", error: null },
          { stdout: "typed", stderr: "", error: null },
        ],
      });

      const payload = await refActionCommand({ command: "fill", ref: "@e3", text: "Ada" }, deps);

      assert.deepEqual(calls.map((call) => call.args), [
        ["ui", "tap", "60", "40", "--udid", "SIM-1"],
        ["type", "Ada", "--udid", "SIM-1"],
      ]);
      assert.equal(payload.available, true);
      assert.equal(payload.action, "fill");
      assert.equal(payload.ref, "@e3");
    });

    it("long-press, dbltap, drag, and scroll delegate to gesture-shaped payloads", async () => {
      const { deps } = depsWith({
        refPoints: [
          { available: true, ref: "@e1", point: { x: 60, y: 40 } },
          { available: true, ref: "@e1", point: { x: 60, y: 40 } },
          { available: true, ref: "@e1", point: { x: 60, y: 40 } },
          { available: true, ref: "@e2", point: { x: 200, y: 300 } },
        ],
        scrollPlans: [{ available: true, dryRun: true, action: "scroll", coordinates: { startX: 60, startY: 40, endX: 60, endY: -560 } }],
      });

      const longPress = await refActionCommand({ command: "long-press", ref: "@e1", dryRun: true }, deps);
      assert.equal(longPress.gesture, "long-press");
      assert.deepEqual(longPress.coordinates, { x: 60, y: 40 });
      assert.equal(longPress.repeat, 1);
      assert.equal(longPress.dryRun, true);

      const dbltap = await refActionCommand({ command: "dbltap", ref: "@e1", dryRun: true }, deps);
      assert.equal(dbltap.gesture, "tap");
      assert.deepEqual(dbltap.coordinates, { x: 60, y: 40 });
      assert.equal(dbltap.repeat, 2);
      assert.equal(dbltap.intervalMs, 80);

      const drag = await refActionCommand({ command: "drag", ref: "@e1", targetRef: "@e2", dryRun: true }, deps);
      assert.equal(drag.gesture, "drag");
      assert.deepEqual(drag.coordinates, { startX: 60, startY: 40, endX: 200, endY: 300 });
      assert.equal(drag.durationMs, 600);
      assert.deepEqual(await refActionCommand({ command: "scroll", ref: "@e1", targetRef: "down", dryRun: true }, deps), {
        available: true,
        dryRun: true,
        action: "scroll",
        coordinates: { startX: 60, startY: 40, endX: 60, endY: -560 },
      });
    });

    it("drag reports targetRef role when the target ref cannot resolve", async () => {
      const targetMissing = { available: false, reason: "Ref not found in the latest snapshot.", ref: "@missing" };
      const { deps } = depsWith({
        refPoints: [{ available: true, ref: "@e1", point: { x: 60, y: 40 } }, targetMissing],
      });

      assert.deepEqual(await refActionCommand({ command: "drag", ref: "@e1", targetRef: "@missing" }, deps), {
        ...targetMissing,
        role: "targetRef",
      });
    });
  });

  describe("clipboard and keyboard", () => {
    it("clipboard rejects unknown actions", async () => {
      const { deps } = depsWith();
      await assert.rejects(async () => clipboardCommand({ action: "clear" }, deps), /Unknown clipboard action: clear/);
    });

    it("clipboard dry-run resolves the booted device and reports action", async () => {
      const { deps, calls } = depsWith();

      assert.deepEqual(await clipboardCommand({ action: "read", dryRun: true }, deps), {
        available: true,
        dryRun: true,
        action: "clipboard.read",
        device: DEVICE,
      });
      assert.deepEqual(calls, []);
    });

    it("clipboard read and write use simctl pbpaste/pbcopy with write stdin", async () => {
      const { deps, calls } = depsWith({
        execResults: [
          { stdout: "copied text", stderr: "", error: null },
          { stdout: "", stderr: "warn", error: null },
        ],
      });

      assert.deepEqual(await clipboardCommand({ action: "read" }, deps), {
        available: true,
        action: "read",
        device: DEVICE,
        text: "copied text",
        stderr: "",
        error: null,
      });
      assert.deepEqual(await clipboardCommand({ action: "write", text: "Ada" }, deps), {
        available: true,
        action: "write",
        device: DEVICE,
        textLength: 3,
        stdout: "",
        stderr: "warn",
        error: null,
      });
      assert.deepEqual(calls, [
        { file: "xcrun", args: ["simctl", "pbpaste", "SIM-1"], options: { timeout: 10_000, rejectOnError: false } },
        { file: "xcrun", args: ["simctl", "pbcopy", "SIM-1"], options: { input: "Ada", timeout: 10_000, rejectOnError: false } },
      ]);
    });

    it("clipboard paste is unavailable without axe and executes axe key-combo when present", async () => {
      const unavailable = await clipboardCommand({ action: "paste" }, depsWith({ commandPaths: {} }).deps);
      assert.deepEqual(unavailable, {
        available: false,
        action: "paste",
        reason: "clipboard paste requires axe key-combo support.",
        device: DEVICE,
      });

      const { deps, calls } = depsWith({
        commandPaths: { axe: "/bin/axe" },
        execResults: [{ stdout: "pasted", stderr: "", error: null }],
      });
      assert.equal((await clipboardCommand({ action: "paste" }, deps)).tool, "axe");
      assert.deepEqual(calls[0]?.args, ["key-combo", "--modifiers", "227", "--key", "25", "--udid", "SIM-1"]);
    });

    it("keyboard rejects unknown actions and reports unavailable without axe", async () => {
      const { deps } = depsWith({ commandPaths: {} });

      await assert.rejects(async () => keyboardCommand({ action: "delete" }, deps), /Unknown keyboard action: delete/);
      assert.deepEqual(await keyboardCommand({ action: "type", text: "Ada" }, deps), {
        available: false,
        action: "type",
        reason: "keyboard commands require the axe CLI.",
        device: DEVICE,
      });
    });

    it("RULE-022 policy-denies clipboard writes and keyboard presses before device execution", async () => {
      const { deps, calls } = depsWith({
        policyDecision: async (_args, action) => ({ ...DENIED_POLICY, action }),
      });

      assert.deepEqual(await clipboardCommand({ action: "write", text: "Ada" }, deps), {
        available: false,
        domain: "clipboard",
        action: "clipboard.write",
        source: "policy",
        evidenceSource: "policy",
        code: "policy-denied",
        denied: true,
        reason: "Policy denied action.",
        policy: { ...DENIED_POLICY, action: "clipboard.write" },
      });
      assert.deepEqual(await keyboardCommand({ action: "press", key: "Enter" }, deps), {
        available: false,
        domain: "keyboard",
        action: "keyboard.press",
        source: "policy",
        evidenceSource: "policy",
        code: "policy-denied",
        denied: true,
        reason: "Policy denied action.",
        policy: { ...DENIED_POLICY, action: "keyboard.press" },
      });
      assert.deepEqual(calls, []);
    });

    it("keyboard dry-run reports action, resolved device, and axe tool", async () => {
      const { deps } = depsWith({ commandPaths: { axe: "/bin/axe" } });

      assert.deepEqual(await keyboardCommand({ action: "press", key: "Enter", dryRun: true }, deps), {
        available: true,
        dryRun: true,
        action: "keyboard.press",
        device: DEVICE,
        tool: "axe",
      });
    });

    it("keyboard type and press execute axe type/key with aliases and truncated output", async () => {
      const { deps, calls } = depsWith({
        commandPaths: { axe: "/bin/axe" },
        execResults: [
          { stdout: "typed", stderr: "", error: null },
          { stdout: "pressed", stderr: `${"e".repeat(MAX_OUTPUT)}tail`, error: null },
        ],
      });

      assert.equal((await keyboardCommand({ action: "type", text: "Ada" }, deps)).textLength, 3);
      assert.deepEqual(await keyboardCommand({ action: "press", key: "esc" }, deps), {
        available: true,
        action: "press",
        device: DEVICE,
        tool: "axe",
        key: "esc",
        keycode: 41,
        stdout: "pressed",
        stderr: `${"e".repeat(MAX_OUTPUT)}\n[truncated 4 characters]`,
        error: null,
      });
      assert.deepEqual(calls.map((call) => call.args), [
        ["type", "Ada", "--udid", "SIM-1"],
        ["key", "41", "--udid", "SIM-1"],
      ]);
    });

    it("keyCodeFor supports aliases, clamped numeric codes, letters, and unknown-key errors", () => {
      assert.equal(keyCodeFor("enter"), 40);
      assert.equal(keyCodeFor("return"), 40);
      assert.equal(keyCodeFor("tab"), 43);
      assert.equal(keyCodeFor("space"), 44);
      assert.equal(keyCodeFor("backspace"), 42);
      assert.equal(keyCodeFor("delete"), 42);
      assert.equal(keyCodeFor("escape"), 41);
      assert.equal(keyCodeFor("300"), 255);
      assert.equal(keyCodeFor("a"), 4);
      assert.equal(keyCodeFor("z"), 29);
      assert.throws(() => keyCodeFor("Home"), /Unknown key: Home/);
    });
  });

  describe("set environment", () => {
    it("plans appearance, content-size, location, and permissions commands", () => {
      assert.deepEqual(setEnvironmentPlan("appearance", { value: "dark" }, DEVICE), {
        available: true,
        action: "appearance",
        device: DEVICE,
        command: ["xcrun", "simctl", "ui", "SIM-1", "appearance", "dark"],
      });
      assert.deepEqual(setEnvironmentPlan("content-size", { value: "accessibility" }, DEVICE).command, ["xcrun", "simctl", "ui", "SIM-1", "content_size", "accessibility-large"]);
      assert.deepEqual(setEnvironmentPlan("location", { value: "51.5", extra: ["-0.12"] }, DEVICE).command, ["xcrun", "simctl", "location", "SIM-1", "set", "51.5,-0.12"]);
      assert.deepEqual(setEnvironmentPlan("permissions", { value: "camera=denied", bundleId: "com.example" }, DEVICE).command, ["xcrun", "simctl", "privacy", "SIM-1", "revoke", "camera", "com.example"]);
      assert.deepEqual(setEnvironmentPlan("permissions", { value: "camera=reset", extra: ["com.example"] }, DEVICE).command, ["xcrun", "simctl", "privacy", "SIM-1", "reset", "camera", "com.example"]);
    });

    it("returns unavailable for unsupported stable domains and errors for unknown domains", () => {
      assert.deepEqual(setEnvironmentPlan("network", { value: "offline" }, DEVICE), {
        available: false,
        action: "network",
        reason: "network mutation is not exposed by stable simctl/axe commands in this CLI yet.",
        requestedValue: "offline",
        device: DEVICE,
      });
      assert.throws(() => setEnvironmentPlan("widgets", { value: "x" }, DEVICE), /Unknown set domain: widgets/);
    });

    it("setEnvironmentCommand denies policy before executing and dry-runs allowed plans", async () => {
      const deniedDeps = depsWith({ policyDecision: async () => ({ ...DENIED_POLICY, action: "set.appearance" }) }).deps;
      assert.deepEqual(await setEnvironmentCommand({ domain: "appearance", value: "dark" }, deniedDeps), {
        available: false,
        domain: "set",
        action: "appearance",
        source: "policy",
        evidenceSource: "policy",
        code: "policy-denied",
        denied: true,
        reason: "Policy denied action.",
        policy: { ...DENIED_POLICY, action: "set.appearance" },
      });

      const { deps, calls } = depsWith({ policyDecision: async () => ({ ...ALLOWED_POLICY, action: "set.appearance" }) });
      assert.deepEqual(await setEnvironmentCommand({ domain: "appearance", value: "light", dryRun: true }, deps), {
        available: true,
        action: "appearance",
        device: DEVICE,
        command: ["xcrun", "simctl", "ui", "SIM-1", "appearance", "light"],
        dryRun: true,
        policy: { ...ALLOWED_POLICY, action: "set.appearance" },
      });
      assert.deepEqual(calls, []);
    });
  });

  describe("gestures", () => {
    it("normalizes gestures, default durations, and coordinate validation", () => {
      assert.equal(normalizeGesture("tap-and-hold"), "long-press");
      assert.equal(normalizeGesture("swipe"), "swipe");
      assert.throws(() => normalizeGesture("pinch"), /Unknown gesture: pinch/);
      assert.deepEqual([
        defaultGestureDurationMs("tap"),
        defaultGestureDurationMs("long-press"),
        defaultGestureDurationMs("drag"),
        defaultGestureDurationMs("swipe"),
      ], [80, 900, 900, 250]);
      assert.deepEqual(normalizeGestureCoordinates("tap", { x: -1, y: "34" }), { x: 0, y: 34 });
      assert.deepEqual(normalizeGestureCoordinates("drag", { startX: 1, startY: 2, endX: 3, endY: 4 }), { startX: 1, startY: 2, endX: 3, endY: 4 });
    });

    it("dry-run payload includes review questions, evidence flags, and an iOS idb plan", async () => {
      const { deps } = depsWith();

      const payload = await automationGesture({
        gesture: "long-press",
        x: 100,
        y: 240,
        captureBeforeAfter: true,
        includeTrace: true,
        dryRun: true,
      }, deps);

      assert.equal(payload.available, true);
      assert.equal(payload.dryRun, true);
      assert.equal(payload.captureBeforeAfter, true);
      assert.equal(payload.includeTrace, true);
      assert.deepEqual(payload.plan, {
        tool: "idb",
        command: ["idb", "ui", "tap", "100", "240", "--duration", "0.9", "--udid", "<resolved-booted-simulator-udid>"],
        repeat: 1,
        intervalMs: 250,
        notes: [],
      });
      assert.ok(Array.isArray(payload.reviewQuestionsThisCanAnswer));
    });

    it("RULE-022 policy-denies gestures before dry-run or execution planning", async () => {
      const { deps, calls } = depsWith({
        policyDecision: async () => ({ ...DENIED_POLICY, action: "gesture.tap" }),
      });

      assert.deepEqual(await automationGesture({ gesture: "tap", x: 10, y: 20, dryRun: true }, deps), {
        available: false,
        domain: "gesture",
        action: "gesture.tap",
        source: "policy",
        evidenceSource: "policy",
        code: "policy-denied",
        denied: true,
        reason: "Policy denied action.",
        policy: { ...DENIED_POLICY, action: "gesture.tap" },
      });
      assert.deepEqual(calls, []);
    });

    it("plans Android and iOS gesture command arrays", () => {
      assert.deepEqual(gestureCommandPlan({
        platform: "android",
        gesture: "long-press",
        coordinates: { x: 100, y: 240 },
        durationMs: 900,
        holdMs: null,
        repeat: 1,
        intervalMs: 250,
        device: "emulator-5554",
      }), {
        tool: "adb",
        command: ["adb", "-s", "emulator-5554", "shell", "input", "swipe", "100", "240", "100", "240", "900"],
        repeat: 1,
        intervalMs: 250,
        notes: [],
      });
      assert.deepEqual(gestureCommandPlan({
        platform: "ios",
        gesture: "drag",
        coordinates: { startX: 180, startY: 900, endX: 180, endY: 1200 },
        durationMs: 1100,
        holdMs: 100,
        repeat: 2,
        intervalMs: 80,
      }), {
        tool: "idb",
        command: ["idb", "ui", "swipe", "180", "900", "180", "1200", "--duration", "1.1", "--udid", "<resolved-booted-simulator-udid>"],
        repeat: 2,
        intervalMs: 80,
        notes: ["Current idb plan records holdMs as intent; idb swipe supports duration but not a separate hold-before-move flag in this wrapper."],
      });
    });

    it("converts iOS idb plans into axe tap, long-press, drag, and swipe commands", () => {
      assert.deepEqual(axeGestureCommandFromPlan({ gesture: "tap", plan: { command: ["idb", "ui", "tap", "1", "2"] }, udid: "SIM-1" }), ["axe", "tap", "-x", "1", "-y", "2", "--udid", "SIM-1"]);
      assert.deepEqual(axeGestureCommandFromPlan({ gesture: "long-press", plan: { command: ["idb", "ui", "tap", "1", "2", "--duration", "0.9"] }, udid: "SIM-1" }), ["axe", "touch", "-x", "1", "-y", "2", "--down", "--up", "--delay", "0.9", "--udid", "SIM-1"]);
      assert.deepEqual(axeGestureCommandFromPlan({ gesture: "drag", plan: { command: ["idb", "ui", "swipe", "1", "2", "3", "4", "--duration", "1.1"] }, udid: "SIM-1" }), ["axe", "drag", "--start-x", "1", "--start-y", "2", "--end-x", "3", "--end-y", "4", "--duration", "1.1", "--udid", "SIM-1"]);
      assert.deepEqual(axeGestureCommandFromPlan({ gesture: "swipe", plan: { command: ["idb", "ui", "swipe", "1", "2", "3", "4"] }, udid: "SIM-1" }), ["axe", "swipe", "--start-x", "1", "--start-y", "2", "--end-x", "3", "--end-y", "4", "--udid", "SIM-1"]);
    });

    it("executeGesturePlan returns unavailable for missing Android adb and runs repeated Android commands", async () => {
      const androidPlan = { tool: "adb", command: ["adb", "-s", "emulator-5554", "shell", "input", "tap", "10", "20"], repeat: 2, intervalMs: 5, notes: [] };
      assert.deepEqual(await executeGesturePlan({ platform: "android", plan: androidPlan, repeat: 2, intervalMs: 5 }, depsWith({ commandPaths: {} }).deps), {
        available: false,
        reason: "Android gestures require adb, which is not installed or not on PATH.",
        plan: androidPlan,
      });

      const { deps, calls, sleeps } = depsWith({
        commandPaths: { adb: "/bin/adb" },
        execResults: [
          { stdout: "one", stderr: "", error: null },
          { stdout: "two", stderr: "", error: null },
        ],
      });
      const execution = await executeGesturePlan({ platform: "android", plan: androidPlan, repeat: 2, intervalMs: 5 }, deps);
      assert.equal(execution.available, true);
      assert.deepEqual(calls.map((call) => call.args), [
        ["-s", "emulator-5554", "shell", "input", "tap", "10", "20"],
        ["-s", "emulator-5554", "shell", "input", "tap", "10", "20"],
      ]);
      assert.deepEqual(sleeps, [5]);
    });

    it("RULE-022 policy-denies direct executeGesturePlan and executeRepeatedCommand calls", async () => {
      const plan = { tool: "adb", command: ["adb", "shell", "input", "tap", "10", "20"], repeat: 1, intervalMs: 0, notes: [] };
      const { deps, calls } = depsWith({
        policyDecision: async (_args, action) => ({ ...DENIED_POLICY, action }),
      });

      assert.deepEqual(await executeGesturePlan({ platform: "android", gesture: "tap", plan, repeat: 1, intervalMs: 0 }, deps), {
        available: false,
        domain: "gesture",
        action: "gesture.tap",
        source: "policy",
        evidenceSource: "policy",
        code: "policy-denied",
        denied: true,
        reason: "Policy denied action.",
        policy: { ...DENIED_POLICY, action: "gesture.tap" },
      });
      assert.deepEqual(await executeRepeatedCommand("/bin/idb", ["ui", "tap", "1", "2"], { repeat: 1, intervalMs: 0 }, deps), {
        available: false,
        domain: "interaction",
        action: "execute-command",
        source: "policy",
        evidenceSource: "policy",
        code: "policy-denied",
        denied: true,
        reason: "Policy denied action.",
        policy: { ...DENIED_POLICY, action: "execute-command" },
      });
      assert.deepEqual(calls, []);
    });

    it("executeGesturePlan returns iOS missing-tools payload and replaces resolved UDID for idb and axe", async () => {
      const plan = {
        tool: "idb",
        command: ["idb", "ui", "tap", "10", "20", "--udid", "<resolved-booted-simulator-udid>"],
        repeat: 1,
        intervalMs: 0,
        notes: [],
      };
      assert.deepEqual(await executeGesturePlan({ platform: "ios", gesture: "tap", plan, repeat: 1, intervalMs: 0 }, depsWith({ commandPaths: {} }).deps), {
        available: false,
        reason: "iOS complex gestures require the idb or axe CLI, but neither is installed or on PATH.",
        installHint: "Install idb or axe and rerun this command, or use dryRun=true to inspect the intended gesture plan.",
        plan,
      });

      const idb = depsWith({ commandPaths: { idb: "/bin/idb" }, execResults: [{ stdout: "ok", stderr: "", error: null }] });
      assert.deepEqual((await executeGesturePlan({ platform: "ios", gesture: "tap", plan, repeat: 1, intervalMs: 0 }, idb.deps)).command, ["idb", "ui", "tap", "10", "20", "--udid", "SIM-1"]);
      const axe = depsWith({ commandPaths: { axe: "/bin/axe" }, execResults: [{ stdout: "ok", stderr: "", error: null }] });
      assert.deepEqual((await executeGesturePlan({ platform: "ios", gesture: "tap", plan, repeat: 1, intervalMs: 0 }, axe.deps)).command, ["axe", "tap", "-x", "10", "-y", "20", "--udid", "SIM-1"]);
    });

    it("executeRepeatedCommand records each run, truncates output, and reports basename tool", async () => {
      const { deps, sleeps } = depsWith({
        execResults: [
          { stdout: `${"x".repeat(MAX_OUTPUT)}tail`, stderr: "", error: null },
          { stdout: "ok", stderr: "warn", error: { message: "exit 7", code: 7 } },
        ],
      });

      assert.deepEqual(await executeRepeatedCommand("/bin/idb", ["ui", "tap", "1", "2"], { repeat: 2, intervalMs: 10 }, deps), {
        available: true,
        device: null,
        tool: "idb",
        command: ["idb", "ui", "tap", "1", "2"],
        runs: [
          { index: 1, command: ["/bin/idb", "ui", "tap", "1", "2"], exitCode: 0, stdout: `${"x".repeat(MAX_OUTPUT)}\n[truncated 4 characters]`, stderr: "" },
          { index: 2, command: ["/bin/idb", "ui", "tap", "1", "2"], exitCode: 7, stdout: "ok", stderr: "warn" },
        ],
      });
      assert.deepEqual(sleeps, [10]);
    });

    it("creates a ref-actions-wait compatible adapter without requiring private readRefRecord exports", async () => {
      const moduleCalls: Array<Record<string, unknown>> = [];
      const refDeps = {
        readLatestRefCache: async () => ({
          refs: [
            { ref: "@e1", actions: ["tap"], box: { x: 10, y: 20, width: 100, height: 40 } },
            { ref: "@stale", stale: true, actions: ["tap"], box: { x: 0, y: 0, width: 1, height: 1 } },
          ],
        }),
      };
      const adapter = createRefActionAdapter(refDeps, {
        planRefAction: async (args, deps) => {
          moduleCalls.push({ kind: "plan", args, hasDeps: typeof deps.readLatestRefCache === "function" });
          return { available: true, plan: { point: { x: 60, y: 40 } } };
        },
        refPoint: async (ref, deps) => {
          moduleCalls.push({ kind: "point", ref, hasDeps: typeof deps.readLatestRefCache === "function" });
          return { available: true, ref, point: { x: 60, y: 40 } };
        },
        scrollPlan: async (args, deps) => {
          moduleCalls.push({ kind: "scroll", args, hasDeps: typeof deps.readLatestRefCache === "function" });
          return { available: true, dryRun: true, action: "scroll" };
        },
      });

      assert.deepEqual(await adapter.readRefRecord("@e1", {}), {
        available: true,
        record: { ref: "@e1", actions: ["tap"], box: { x: 10, y: 20, width: 100, height: 40 } },
        cache: {
          refs: [
            { ref: "@e1", actions: ["tap"], box: { x: 10, y: 20, width: 100, height: 40 } },
            { ref: "@stale", stale: true, actions: ["tap"], box: { x: 0, y: 0, width: 1, height: 1 } },
          ],
        },
      });
      assert.deepEqual(await adapter.readRefRecord("@stale", {}), {
        available: false,
        reason: "Ref is stale. Capture a new snapshot before acting.",
        ref: "@stale",
      });
      assert.deepEqual(await adapter.planRefAction({ ref: "@e1", action: "tap" }), {
        available: true,
        plan: { point: { x: 60, y: 40 } },
      });
      assert.deepEqual(moduleCalls[0], { kind: "plan", args: { ref: "@e1", action: "tap" }, hasDeps: true });
    });

    it("captureGestureScreenshot delegates screenshot adapter with default and provided output directories", async () => {
      const { deps, screenshotCalls, mkdirs } = depsWith({ now: () => new Date("2026-05-23T12:34:56.789Z") });

      assert.deepEqual(await captureGestureScreenshot({ platform: "ios", device: "SIM-1", label: "before" }, deps), {
        platform: "ios",
        device: "SIM-1",
        outputPath: "/tmp/expo-ios-gestures/before-2026-05-23T12-34-56-789Z.png",
      });
      assert.deepEqual(await captureGestureScreenshot({ platform: "android", device: "emulator-5554", outputDir: "/work/evidence", label: "after" }, deps), {
        platform: "android",
        device: "emulator-5554",
        outputPath: "/work/evidence/after-2026-05-23T12-34-56-789Z.png",
      });
      assert.deepEqual(mkdirs, ["/tmp/expo-ios-gestures", "/work/evidence"]);
      assert.deepEqual(screenshotCalls.map((call) => call.outputPath), [
        "/tmp/expo-ios-gestures/before-2026-05-23T12-34-56-789Z.png",
        "/work/evidence/after-2026-05-23T12-34-56-789Z.png",
      ]);
    });
  });
});

function depsWith(options: {
  commandPaths?: Record<string, string | null>;
  execResults?: ExecResult[];
  refPlans?: Record<string, unknown>[];
  readRefRecords?: Record<string, unknown>[];
  refPoints?: Record<string, unknown>[];
  scrollPlans?: Record<string, unknown>[];
  policyDecision?: InteractionDependencies["policyDecision"];
  now?: () => Date;
} = {}): {
  deps: InteractionDependencies;
  calls: ExecCall[];
  sleeps: number[];
  refPlanCalls: Array<Record<string, unknown>>;
  screenshotCalls: Array<Record<string, unknown>>;
  mkdirs: string[];
} {
  const calls: ExecCall[] = [];
  const sleeps: number[] = [];
  const refPlanCalls: Array<Record<string, unknown>> = [];
  const screenshotCalls: Array<Record<string, unknown>> = [];
  const mkdirs: string[] = [];
  const execResults = [...(options.execResults ?? [])];
  const refPlans = [...(options.refPlans ?? [])];
  const readRefRecords = [...(options.readRefRecords ?? [])];
  const refPoints = [...(options.refPoints ?? [])];
  const scrollPlans = [...(options.scrollPlans ?? [])];
  const commandPaths = options.commandPaths ?? { idb: "/bin/idb", axe: "/bin/axe", adb: "/bin/adb" };

  return {
    calls,
    sleeps,
    refPlanCalls,
    screenshotCalls,
    mkdirs,
    deps: {
      commandPath: async (command) => commandPaths[command] ?? null,
      execFile: async (file, args, execOptions) => {
        calls.push({ file, args, options: execOptions });
        return execResults.shift() ?? { stdout: "", stderr: "", error: null };
      },
      resolveIosDevice: async (requested) => requested ? { ...DEVICE, udid: requested } : DEVICE,
      planRefAction: async (args) => {
        refPlanCalls.push(args);
        return refPlans.shift() ?? { available: true, dryRun: true, plan: { point: { x: 60, y: 40 } } };
      },
      readRefRecord: async (ref) => readRefRecords.shift() ?? { available: false, reason: "Ref not found in the latest snapshot.", ref },
      refPoint: async (ref) => refPoints.shift() ?? { available: true, ref, point: { x: 60, y: 40 } },
      scrollPlan: async () => scrollPlans.shift() ?? { available: true, dryRun: true, action: "scroll", coordinates: { startX: 200, startY: 700, endX: 200, endY: 100 } },
      policyDecision: options.policyDecision ?? (async (_args, action, sideEffect) => ({ ...ALLOWED_POLICY, action, sideEffect })),
      captureScreenshot: async (args) => {
        screenshotCalls.push(args);
        return { platform: args.platform, device: args.device, outputPath: args.outputPath };
      },
      traceInteraction: async (args) => ({ available: true, action: args.action }),
      wait: async (ms) => {
        sleeps.push(ms);
      },
      now: options.now ?? (() => new Date("2026-05-23T12:34:56.789Z")),
      tmpdir: () => "/tmp",
      mkdir: async (path) => {
        mkdirs.push(path);
      },
      joinPath: (...parts) => join(...parts),
    },
  };
}
