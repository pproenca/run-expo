import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  readMacCursorPosition,
  readSimulatorWindowBounds,
  resetSimulatorWindowBoundsCache,
  simulatorWindowBoundsAppleScript,
  writeMacClipboard,
} from "../main/index.js";
import type {
  ExecFileOptions,
  ExecFileResult,
  MacSimulatorBridgeDependencies,
} from "../main/index.js";

describe("mac-simulator-bridge-adapter legacy characterization", () => {
  beforeEach(() => {
    resetSimulatorWindowBoundsCache();
  });

  it("returns null for cursor position when cliclick is unavailable", async () => {
    const calls: unknown[] = [];
    const deps = fakeDeps({
      commandPath: (command) => {
        calls.push(command);
        return null;
      },
    });

    assert.equal(await readMacCursorPosition(deps), null);
    assert.deepEqual(calls, ["cliclick"]);
  });

  it("runs cliclick p with legacy timeout and parses decimal or negative cursor coordinates", async () => {
    const calls: unknown[] = [];
    const deps = fakeDeps({
      commandPath: () => "/usr/local/bin/cliclick",
      execFilePromise: (file, args, options) => {
        calls.push({ file, args, options });
        return { stdout: " -12.5, 48.25 \n" };
      },
    });

    assert.deepEqual(await readMacCursorPosition(deps), { x: -12.5, y: 48.25 });
    assert.deepEqual(calls, [{
      file: "/usr/local/bin/cliclick",
      args: ["p"],
      options: { timeout: 1500, rejectOnError: false },
    }]);
  });

  it("returns null when cliclick stdout does not contain a coordinate pair", async () => {
    const deps = fakeDeps({
      commandPath: () => "/usr/local/bin/cliclick",
      execFilePromise: () => ({ stdout: "not coordinates" }),
    });

    assert.equal(await readMacCursorPosition(deps), null);
  });

  it("refuses clipboard writes on non-macOS platforms and for empty text before command lookup", async () => {
    const calls: string[] = [];
    assert.equal(await writeMacClipboard("hello", fakeDeps({
      platform: "linux",
      commandPath: (command) => {
        calls.push(command);
        return "/usr/bin/pbcopy";
      },
    })), false);
    assert.equal(await writeMacClipboard("", fakeDeps({
      platform: "darwin",
      commandPath: (command) => {
        calls.push(command);
        return "/usr/bin/pbcopy";
      },
    })), false);
    assert.deepEqual(calls, []);
  });

  it("uses pbcopy stdin with legacy timeout and returns false for unavailable command or exec errors", async () => {
    assert.equal(await writeMacClipboard("hello", fakeDeps({
      platform: "darwin",
      commandPath: () => null,
    })), false);

    const calls: unknown[] = [];
    assert.equal(await writeMacClipboard("hello", fakeDeps({
      platform: "darwin",
      commandPath: () => "/usr/bin/pbcopy",
      execFilePromise: (file, args, options) => {
        calls.push({ file, args, options });
        return { stdout: "", error: null };
      },
    })), true);
    assert.equal(await writeMacClipboard("hello", fakeDeps({
      platform: "darwin",
      commandPath: () => "/usr/bin/pbcopy",
      execFilePromise: () => ({ stdout: "", error: { message: "failed" } }),
    })), false);

    assert.deepEqual(calls, [{
      file: "/usr/bin/pbcopy",
      args: [],
      options: { input: "hello", timeout: 1500, rejectOnError: false },
    }]);
  });

  it("runs the legacy osascript and parses Simulator window bounds", async () => {
    const calls: unknown[] = [];
    const deps = fakeDeps({
      now: () => 1000,
      execFilePromise: (file, args, options) => {
        calls.push({ file, args, options });
        return { stdout: "10, 20, 393, 852\n" };
      },
    });

    assert.deepEqual(await readSimulatorWindowBounds(deps), { x: 10, y: 20, width: 393, height: 852 });
    assert.deepEqual(calls, [{
      file: "osascript",
      args: ["-e", simulatorWindowBoundsAppleScript()],
      options: { timeout: 2000, rejectOnError: false },
    }]);
  });

  it("caches Simulator window bounds for less than 500ms", async () => {
    let now = 1000;
    let execCount = 0;
    const deps = fakeDeps({
      now: () => now,
      execFilePromise: () => {
        execCount += 1;
        return { stdout: `${execCount}, 20, 300, 400` };
      },
    });

    assert.deepEqual(await readSimulatorWindowBounds(deps), { x: 1, y: 20, width: 300, height: 400 });
    now = 1499;
    assert.deepEqual(await readSimulatorWindowBounds(deps), { x: 1, y: 20, width: 300, height: 400 });
    now = 1500;
    assert.deepEqual(await readSimulatorWindowBounds(deps), { x: 2, y: 20, width: 300, height: 400 });
    assert.equal(execCount, 2);
  });

  it("returns null for malformed Simulator window output without replacing a valid expired cache", async () => {
    let now = 1000;
    let stdout = "10,20,300,400";
    const deps = fakeDeps({
      now: () => now,
      execFilePromise: () => ({ stdout }),
    });

    assert.deepEqual(await readSimulatorWindowBounds(deps), { x: 10, y: 20, width: 300, height: 400 });
    now = 2000;
    stdout = "bad";
    assert.equal(await readSimulatorWindowBounds(deps), null);
  });

  it("keeps the exact AppleScript lines used by the legacy adapter", () => {
    assert.equal(simulatorWindowBoundsAppleScript(), [
      'tell application "System Events"',
      '  tell application process "Simulator"',
      '    set windowPosition to position of first window',
      '    set windowSize to size of first window',
      '    return (item 1 of windowPosition as text) & "," & (item 2 of windowPosition as text) & "," & (item 1 of windowSize as text) & "," & (item 2 of windowSize as text)',
      '  end tell',
      'end tell',
    ].join("\n"));
  });
});

function fakeDeps(overrides: Partial<MacSimulatorBridgeDependencies> = {}): MacSimulatorBridgeDependencies {
  return {
    platform: "darwin",
    now: () => 0,
    commandPath: () => null,
    execFilePromise: () => ({ stdout: "" }),
    ...overrides,
  };
}
