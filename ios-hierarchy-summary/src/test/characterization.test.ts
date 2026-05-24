import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  describeIosHierarchy,
  summarizeHierarchy,
  truncate,
} from "../main/index.js";
import type { ExecOptions, ExecResult } from "../main/index.js";

describe("ios-hierarchy-summary legacy characterization", () => {
  it("summarizes hierarchy depth, roles, labels, non-zero frames, and content bounds", () => {
    const summary = summarizeHierarchy([
      {
        role: "AXApplication",
        frame: { x: 0, y: 0, width: 390, height: 844 },
        children: [
          {
            role_description: "button",
            AXLabel: "Continue",
            frame: { x: 20, y: 700, width: 120, height: 44 },
            children: [
              {
                type: "StaticText",
                title: "Nested",
                frame: { x: 30, y: 710, width: 60, height: 20 },
              },
            ],
          },
          {
            role: "image",
            AXValue: "Logo",
            frame: { x: 160, y: 40, width: 80, height: 80 },
          },
          {
            role: "ignored-zero-frame",
            frame: { x: 0, y: 0, width: 0, height: 0 },
          },
        ],
      },
    ]);

    assert.deepEqual(summary, {
      available: true,
      totalElements: 5,
      maxDepth: 2,
      emptyApplicationOnly: false,
      nonZeroFrames: 4,
      contentBounds: { x: 0, y: 0, width: 390, height: 844 },
      roles: {
        AXApplication: 1,
        button: 1,
        StaticText: 1,
        image: 1,
        "ignored-zero-frame": 1,
      },
      sampleLabels: [
        { label: "Continue", role: "button", frame: { x: 20, y: 700, width: 120, height: 44 } },
        { label: "Nested", role: "StaticText", frame: { x: 30, y: 710, width: 60, height: 20 } },
        { label: "Logo", role: "image", frame: { x: 160, y: 40, width: 80, height: 80 } },
      ],
      insight: "Hierarchy can help compare visible composition with semantic/structural UI frames.",
    });
  });

  it("detects the empty AXApplication-only simulator hierarchy", () => {
    const summary = summarizeHierarchy({ role: "AXApplication", children: [] });
    assert.equal(summary.totalElements, 1);
    assert.equal(summary.emptyApplicationOnly, true);
    assert.equal(summary.contentBounds, null);
    assert.equal(
      summary.insight,
      "Visible UI may exist, but the simulator hierarchy only exposes the app shell. Use screenshot, source, Metro runtime, and coordinate interactions for UX review.",
    );
  });

  it("ignores primitive roots but still returns an available empty summary", () => {
    assert.deepEqual(summarizeHierarchy("not a tree"), {
      available: true,
      totalElements: 0,
      maxDepth: 0,
      emptyApplicationOnly: false,
      nonZeroFrames: 0,
      contentBounds: null,
      roles: {},
      sampleLabels: [],
      insight: "Hierarchy can help compare visible composition with semantic/structural UI frames.",
    });
  });

  it("caps sample labels at the legacy 80 entries", () => {
    const children = Array.from({ length: 82 }, (_value, index) => ({
      role: "AXStaticText",
      AXLabel: `Label ${index}`,
    }));
    const summary = summarizeHierarchy({ role: "AXApplication", children });
    assert.equal(summary.sampleLabels.length, 80);
    assert.equal(summary.sampleLabels[0]?.label, "Label 0");
    assert.equal(summary.sampleLabels[79]?.label, "Label 79");
  });

  it("returns unavailable when axe is not installed", async () => {
    assert.deepEqual(await describeIosHierarchy("device-1", {
      commandPath: () => null,
    }), {
      available: false,
      reason: "axe CLI is not installed or not on PATH.",
    });
  });

  it("runs axe describe-ui with legacy timeout and buffer options", async () => {
    const calls: Array<{ file: string; args: string[]; options: ExecOptions }> = [];
    const result = await describeIosHierarchy("UDID-1", {
      commandPath: (command) => {
        assert.equal(command, "axe");
        return "/usr/local/bin/axe";
      },
      execFilePromise: (file, args, options) => {
        calls.push({ file, args, options });
        return execResult(JSON.stringify({ role: "AXApplication", children: [] }));
      },
    });

    assert.equal(result.available, true);
    assert.deepEqual(calls, [{
      file: "/usr/local/bin/axe",
      args: ["describe-ui", "--udid", "UDID-1"],
      options: { timeout: 12_000, maxBuffer: 4 * 1024 * 1024, rejectOnError: false },
    }]);
  });

  it("returns truncated stdout and stderr when axe exits with an error", async () => {
    const result = await describeIosHierarchy("UDID-1", {
      commandPath: () => "/bin/axe",
      execFilePromise: () => ({
        stdout: "s".repeat(16_386),
        stderr: "e".repeat(16_385),
        error: { message: "failed", code: 1, signal: null },
      }),
    });

    assert.deepEqual(result, {
      available: false,
      error: { message: "failed", code: 1, signal: null },
      stdout: `${"s".repeat(16_384)}\n[truncated 2 characters]`,
      stderr: `${"e".repeat(16_384)}\n[truncated 1 characters]`,
    });
  });

  it("propagates invalid JSON from axe stdout", async () => {
    await assert.rejects(
      () => describeIosHierarchy("UDID-1", {
        commandPath: () => "/bin/axe",
        execFilePromise: () => execResult("{bad"),
      }),
      SyntaxError,
    );
  });

  it("truncate converts nullish values to an empty string", () => {
    assert.equal(truncate(null), "");
    assert.equal(truncate(undefined), "");
    assert.equal(truncate("abcdef", 3), "abc\n[truncated 3 characters]");
  });
});

function execResult(stdout: string): ExecResult {
  return { stdout, stderr: "", error: null };
}
