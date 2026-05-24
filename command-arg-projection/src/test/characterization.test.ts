import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { commandArgs, pickDefined } from "../main/index.js";
import type { CliArgs, CliGlobals } from "../main/index.js";

describe("command-arg-projection legacy characterization", () => {
  it("picks cwd from args first and otherwise falls back to global root", () => {
    assert.deepEqual(commandArgs("doctor", args({ cwd: "/explicit", fix: true }), globals()), {
      cwd: "/explicit",
      fix: true,
    });
    assert.deepEqual(commandArgs("project-info", args({}), globals()), {
      cwd: "/repo/app",
    });
    assert.deepEqual(commandArgs("routes", args({ appDir: "src/app" }), globals()), {
      cwd: "/repo/app",
      appDir: "src/app",
    });
    assert.deepEqual(commandArgs("devices", args({ platform: "ios", limit: 2 }), globals()), {
      platform: "ios",
      limit: 2,
    });
  });

  it("preserves session, target, snapshot, refs, get, find, wait, and batch state propagation", () => {
    assert.deepEqual(commandArgs("session", args({ _: ["new", "review"], olderThan: "7d" }), globals()), {
      action: "new",
      name: "review",
      olderThan: "7d",
      cwd: "/repo/app",
      root: "/repo/app",
      stateDir: "/tmp/expo-state",
    });
    assert.deepEqual(commandArgs("target", args({ _: ["select", "ios-sim"], platform: "ios" }), globals()), {
      action: "select",
      targetId: "ios-sim",
      platform: "ios",
      cwd: "/repo/app",
      root: "/repo/app",
      stateDir: "/tmp/expo-state",
    });
    assert.deepEqual(commandArgs("snapshot", args({ interactive: true, depth: 3, bounds: false }), globals()), {
      interactive: true,
      depth: 3,
      bounds: false,
      cwd: "/repo/app",
      root: "/repo/app",
      stateDir: "/tmp/expo-state",
    });
    assert.deepEqual(commandArgs("refs", args({}), globals()), {
      cwd: "/repo/app",
      root: "/repo/app",
      stateDir: "/tmp/expo-state",
    });
    assert.deepEqual(commandArgs("get", args({ _: ["text", "@e1"] }), globals()), {
      field: "text",
      ref: "@e1",
      cwd: "/repo/app",
      root: "/repo/app",
      stateDir: "/tmp/expo-state",
    });
    assert.deepEqual(commandArgs("find", args({ _: ["nth", "2", "Submit"], action: "tap", dryRun: true }), globals()), {
      kind: "nth",
      value: "2",
      action: "tap",
      name: "Submit",
      dryRun: true,
      cwd: "/repo/app",
      root: "/repo/app",
      stateDir: "/tmp/expo-state",
    });
    assert.deepEqual(commandArgs("wait", args({ _: ["@e7"], fn: "() => true", timeoutMs: 500 }), globals()), {
      ref: "@e7",
      fn: "() => true",
      allowRuntimeEval: "never",
      actionPolicy: "prompt",
      timeoutMs: 500,
      cwd: "/repo/app",
      root: "/repo/app",
      stateDir: "/tmp/expo-state",
    });
    assert.deepEqual(commandArgs("wait", args({ _: ["250"] }), globals()), {
      ms: 250,
      allowRuntimeEval: "never",
      actionPolicy: "prompt",
      cwd: "/repo/app",
      root: "/repo/app",
      stateDir: "/tmp/expo-state",
    });
    assert.deepEqual(commandArgs("batch", args({ _: [["session", "new"]], bail: true }), globals()), {
      steps: [["session", "new"]],
      bail: true,
      cwd: "/repo/app",
      root: "/repo/app",
      stateDir: "/tmp/expo-state",
    });
  });

  it("preserves device/app lifecycle and shared common args", () => {
    assert.deepEqual(commandArgs("boot-simulator", args({ device: "iPhone 15", openSimulator: true }), globals()), {
      device: "iPhone 15",
      openSimulator: true,
    });
    assert.deepEqual(commandArgs("open-url", args({ _: ["myapp://home"], platform: "ios", device: "sim" }), globals()), {
      platform: "ios",
      device: "sim",
      url: "myapp://home",
    });
    assert.deepEqual(commandArgs("launch-app", commonArgs({ packageName: "com.acme.app", activity: "Main" }), globals()), {
      cwd: "/repo/app",
      device: "sim",
      platform: "ios",
      metroPort: 8081,
      bundleId: "com.acme.app",
      processName: "Acme",
      devClientUrl: "exp://127.0.0.1:8081",
      restartDevClient: true,
      crashCheckMs: 1000,
      packageName: "com.acme.app",
      activity: "Main",
    });
    assert.deepEqual(commandArgs("install-app", commonArgs({ _: ["/tmp/app.app"], actionPolicy: "allow", dryRun: true }), globals()), {
      cwd: "/repo/app",
      device: "sim",
      platform: "ios",
      metroPort: 8081,
      bundleId: "com.acme.app",
      processName: "Acme",
      devClientUrl: "exp://127.0.0.1:8081",
      restartDevClient: true,
      crashCheckMs: 1000,
      appPath: "/tmp/app.app",
      actionPolicy: "allow",
      dryRun: true,
    });
    assert.deepEqual(commandArgs("open-dev-menu", commonArgs({}), globals()), {
      cwd: "/repo/app",
      device: "sim",
      platform: "ios",
      metroPort: 8081,
      bundleId: "com.acme.app",
      processName: "Acme",
      devClientUrl: "exp://127.0.0.1:8081",
      restartDevClient: true,
      crashCheckMs: 1000,
      action: "open-dev-menu",
    });
  });

  it("preserves ref, keyboard, clipboard, set, screenshot, tap, gesture, and route projections", () => {
    assert.deepEqual(commandArgs("fill", commonArgs({ _: ["@e1", "hello"], dryRun: true }), globals()), {
      cwd: "/repo/app",
      device: "sim",
      platform: "ios",
      metroPort: 8081,
      bundleId: "com.acme.app",
      processName: "Acme",
      devClientUrl: "exp://127.0.0.1:8081",
      restartDevClient: true,
      crashCheckMs: 1000,
      command: "fill",
      ref: "@e1",
      text: "hello",
      dryRun: true,
      root: "/repo/app",
      stateDir: "/tmp/expo-state",
    });
    assert.deepEqual(commandArgs("scroll", commonArgs({ _: ["@e2", "down", "page"] }), globals()), {
      cwd: "/repo/app",
      device: "sim",
      platform: "ios",
      metroPort: 8081,
      bundleId: "com.acme.app",
      processName: "Acme",
      devClientUrl: "exp://127.0.0.1:8081",
      restartDevClient: true,
      crashCheckMs: 1000,
      command: "scroll",
      ref: "@e2",
      direction: "down",
      amount: "page",
      root: "/repo/app",
      stateDir: "/tmp/expo-state",
    });
    assert.deepEqual(commandArgs("drag", commonArgs({ _: ["@e1", "@e2"], durationMs: 250 }), globals()).targetRef, "@e2");
    assert.deepEqual(commandArgs("type", commonArgs({ _: ["hello"], dryRun: true }), globals()).text, "hello");
    assert.deepEqual(commandArgs("press", commonArgs({ key: "Enter" }), globals()).key, "Enter");
    assert.deepEqual(commandArgs("clipboard", commonArgs({ _: ["copy", "hello"] }), globals()), {
      cwd: "/repo/app",
      device: "sim",
      platform: "ios",
      metroPort: 8081,
      bundleId: "com.acme.app",
      processName: "Acme",
      devClientUrl: "exp://127.0.0.1:8081",
      restartDevClient: true,
      crashCheckMs: 1000,
      action: "copy",
      text: "hello",
      key: "hello",
    });
    assert.deepEqual(commandArgs("set", commonArgs({ _: ["env", "dark", "extra"], dryRun: true }), globals()).extra, ["extra"]);
    assert.deepEqual(commandArgs("screenshot", args({ outputPath: "shot.png", full: true }), globals()), {
      outputPath: "shot.png",
      full: true,
      cwd: "/repo/app",
      root: "/repo/app",
      stateDir: "/tmp/expo-state",
    });
    assert.deepEqual(commandArgs("tap", args({ _: ["@e4"], x: 10, y: 20, dryRun: true }), globals()).ref, "@e4");
    assert.deepEqual(commandArgs("gesture", args({ _: ["swipe"], startX: 1, endX: 2, includeTrace: true }), globals()), {
      gesture: "swipe",
      startX: 1,
      endX: 2,
      includeTrace: true,
      cwd: "/repo/app",
    });
    assert.deepEqual(commandArgs("open-route", args({ _: ["/settings"], query: "a=1", authCookie: "secret" }), globals()), {
      cwd: "/repo/app",
      route: "/settings",
      query: "a=1",
      authCookie: "secret",
    });
  });

  it("preserves review, runtime, bridge, and evidence domain projections", () => {
    assert.equal(commandArgs("review-overlay-server", args({ port: 4010 }), globals()).action, "server");
    assert.equal(commandArgs("review-overlay", args({ _: ["build"], serve: true }), globals()).action, "build");
    assert.deepEqual(commandArgs("review-next", args({ _: ["missing-evidence"], hasScreenshot: false }), globals()), {
      cwd: "/repo/app",
      issue: "missing-evidence",
      hasScreenshot: false,
    });
    assert.deepEqual(commandArgs("trace", args({ _: ["start"], includeEvents: true }), globals()), {
      cwd: "/repo/app",
      action: "start",
      includeEvents: true,
    });
    assert.deepEqual(commandArgs("annotation-server", args({ dir: "/tmp/ann", port: 4545 }), globals()), {
      dir: "/tmp/ann",
      port: 4545,
    });
    assert.deepEqual(commandArgs("devtools", args({ _: ["events", "read"], metroPort: 8082 }), globals()), {
      action: "events",
      subaction: "read",
      metroPort: 8082,
      cwd: "/repo/app",
      root: "/repo/app",
      stateDir: "/tmp/expo-state",
    });
    assert.deepEqual(commandArgs("console", args({ clear: true, limit: 5 }), globals()), {
      action: "clear",
      limit: 5,
      cwd: "/repo/app",
    });
    assert.deepEqual(commandArgs("metro", args({ _: ["symbolicate", "stack.txt"], file: "file-stack.txt" }), globals()).stackFile, "file-stack.txt");
    assert.deepEqual(commandArgs("navigation", args({ _: ["deep-link", "/settings"], actionPolicy: "allow" }), globals()).route, "/settings");
    assert.deepEqual(commandArgs("network", args({ _: ["har", "stop", "out.har"] }), globals()).outputPath, "out.har");
    assert.deepEqual(commandArgs("storage", args({ _: ["async", "set", "token", "secret"] }), globals()), {
      store: "async",
      action: "set",
      key: "token",
      value: "secret",
      actionPolicy: "prompt",
      cwd: "/repo/app",
    });
    assert.deepEqual(commandArgs("state", args({ _: ["load", "profile"] }), globals()).action, "load");
    assert.deepEqual(commandArgs("controls", args({ _: ["press", "submit"] }), globals()).name, "submit");
    assert.deepEqual(commandArgs("bridge", args({ _: ["call", "storage", "get"] }), globals()), {
      action: "call",
      domain: "storage",
      command: "get",
      actionPolicy: "prompt",
      cwd: "/repo/app",
      confirmActions: "bridge-install",
    });
    assert.deepEqual(commandArgs("accessibility", args({ _: ["inspect", "@e1"], dryRun: true }), globals()).ref, "@e1");
    assert.deepEqual(commandArgs("dialog", args({ _: ["accept", "OK"] }), globals()), {
      action: "accept",
      text: "OK",
      cwd: "/repo/app",
    });
    assert.deepEqual(commandArgs("sheet", args({ _: ["dismiss"] }), globals()), {
      action: "dismiss",
      cwd: "/repo/app",
    });
  });

  it("preserves reporting, packaging, release, and fallback projections", () => {
    assert.deepEqual(commandArgs("record", args({ _: ["stop", "recording.mov"] }), globals()).outputPath, "recording.mov");
    assert.deepEqual(commandArgs("diff", args({ _: ["route", "/a", "/b"], screenshot: true }), globals()).routeB, "/b");
    assert.deepEqual(commandArgs("expo", args({}), globals()), { action: "modules", cwd: "/repo/app" });
    assert.deepEqual(commandArgs("rn", args({ _: ["renders", "read"] }), globals()).subaction, "read");
    assert.deepEqual(commandArgs("rn", args({ _: ["inspect", "@e1"] }), globals()).ref, "@e1");
    assert.deepEqual(commandArgs("profiler", args({ _: ["start", "trace.etl"] }), globals()), {
      action: "ettrace",
      subaction: "start",
      nativeArtifact: "trace.etl",
      cwd: "/repo/app",
      root: "/repo/app",
      stateDir: "/tmp/expo-state",
    });
    assert.deepEqual(commandArgs("perf", args({ _: ["measure", "start", "checkout"], samples: 3 }), globals()).label, "checkout");
    assert.deepEqual(commandArgs("dashboard", args({ port: 4100 }), globals()), {
      action: "status",
      port: 4100,
      cwd: "/repo/app",
      root: "/repo/app",
      stateDir: "/tmp/expo-state",
    });
    assert.deepEqual(commandArgs("highlight", commonArgs({ _: ["@e5"], durationMs: 300 }), globals()).ref, "@e5");
    assert.deepEqual(commandArgs("review", args({ _: ["report"], outputPath: "review.json" }), globals()).action, "report");
    assert.deepEqual(commandArgs("policy", args({ _: ["explain", "storage", "set"] }), globals()), {
      action: "explain",
      subject: "storage",
      name: "set",
      actionPolicy: "prompt",
      cwd: "/repo/app",
    });
    assert.deepEqual(commandArgs("redact", args({ _: ["run.json"], outputPath: "redacted.json" }), globals()), {
      file: "run.json",
      outputPath: "redacted.json",
    });
    assert.deepEqual(commandArgs("skills", args({ _: ["show", "modernize"] }), globals()), {
      action: "show",
      name: "modernize",
    });
    assert.deepEqual(commandArgs("install", args({ prefix: "/usr/local" }), globals()), {
      action: "check",
      prefix: "/usr/local",
    });
    assert.deepEqual(commandArgs("upgrade", args({ _: ["apply"] }), globals()), { action: "apply" });
    assert.deepEqual(commandArgs("release", args({ _: ["check"] }), globals()), { action: "check", cwd: "/repo/app" });
    assert.deepEqual(commandArgs("live-backlog", args({ outputDir: "out", bundleId: "com.acme" }), globals()), {
      action: "matrix",
      cwd: "/repo/app",
      outputDir: "out",
      bundleId: "com.acme",
      actionPolicy: "prompt",
    });
    assert.deepEqual(commandArgs("unknown", args({ _: ["x"] }), globals()), {});
    assert.deepEqual(pickDefined({ a: 1, b: undefined, c: null }), { a: 1, c: null });
  });
});

function args(values: Partial<CliArgs>): CliArgs {
  return { _: [], ...values };
}

function commonArgs(values: Partial<CliArgs>): CliArgs {
  return args({
    cwd: "/repo/app",
    device: "sim",
    platform: "ios",
    metroPort: 8081,
    bundleId: "com.acme.app",
    processName: "Acme",
    devClientUrl: "exp://127.0.0.1:8081",
    restartDevClient: true,
    crashCheckMs: 1000,
    ...values,
  });
}

function globals(values: Partial<CliGlobals> = {}): CliGlobals {
  return {
    root: "/repo/app",
    stateDir: "/tmp/expo-state",
    actionPolicy: "prompt",
    allowRuntimeEval: "never",
    confirmActions: "bridge-install",
    ...values,
  };
}
