import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  accessibilityCommand,
  auditAccessibilityRefs,
  clampNumber,
  toolJson,
  truncate,
} from "../main/index.js";
import type { AccessibilityDependencies, ToolTextResult } from "../main/index.js";

const CACHE = {
  snapshotId: "snap-1",
  targetId: "target-1",
  refs: [
    { ref: "@e1", label: "Add", text: "", actions: ["tap"], role: "button" },
    { ref: "@e2", label: "", text: "", actions: ["tap"], role: "button" },
    { ref: "@e3", text: "Read only", actions: [] },
    { ref: "@e4", actions: ["focus"] },
  ],
};

describe("accessibility-actions legacy characterization", () => {
  it("inspects cached refs and reports missing snapshots or refs", async () => {
    const deps = depsWithCache(CACHE);

    assert.deepEqual(parseToolJson(await accessibilityCommand({ action: "inspect", ref: "@e1" }, deps)), {
      available: true,
      action: "inspect",
      ref: "@e1",
      snapshotId: "snap-1",
      targetId: "target-1",
      record: CACHE.refs[0],
    });
    assert.deepEqual(parseToolJson(await accessibilityCommand({ action: "inspect", ref: "@missing" }, deps)), {
      available: false,
      action: "inspect",
      reason: "Ref not found in the latest snapshot.",
      ref: "@missing",
    });
    assert.deepEqual(parseToolJson(await accessibilityCommand({ action: "inspect", ref: "@e1" }, depsWithCache(null))), {
      available: false,
      action: "inspect",
      reason: "No snapshot exists for the current session.",
      ref: "@e1",
    });
  });

  it("audits interactive refs without label or text using RULE-034 interactive-name issues", async () => {
    const payload = parseToolJson(await accessibilityCommand({ action: "audit" }, depsWithCache(CACHE)));

    assert.equal(payload.available, true);
    assert.equal(payload.action, "audit");
    assert.equal(payload.snapshotId, "snap-1");
    assert.equal(payload.targetId, "target-1");
    assert.equal(payload.issueCount, 2);
    assert.deepEqual(payload.issues, [
      { ref: "@e2", rule: "interactive-name", message: "Interactive ref has no label or text." },
      { ref: "@e4", rule: "interactive-name", message: "Interactive ref has no label or text." },
    ]);
    assert.deepEqual(auditAccessibilityRefs(CACHE).map((issue) => issue.ref), ["@e2", "@e4"]);
    assert.deepEqual(parseToolJson(await accessibilityCommand({ action: "audit" }, depsWithCache(null))), {
      available: false,
      action: "audit",
      reason: "No snapshot exists for the current session.",
      issues: [],
    });
  });

  it("focus delegates to ref-action focus and adds source plus limitation", async () => {
    const calls: any[] = [];
    const payload = parseToolJson(await accessibilityCommand({ action: "focus", ref: "@e1", dryRun: true }, {
      refActionCommand: async (args) => {
        calls.push(args);
        return toolJson({ available: true, source: "tap-plan", ref: args.ref, command: args.command });
      },
    }));

    assert.deepEqual(calls, [{ action: "focus", ref: "@e1", dryRun: true, command: "focus" }]);
    assert.equal(payload.available, true);
    assert.equal(payload.action, "focus");
    assert.equal(payload.source, "tap-plan");
    assert.equal(payload.limitations[0], "Native iOS accessibility focus APIs are not exposed by stable local simulator tooling here; this command focuses the element through the available ref tap path.");
  });

  it("captures native tree with semantic bridge evidence when axe is available", async () => {
    const calls: any[] = [];
    const payload = parseToolJson(await accessibilityCommand({ action: "tree", device: "iPhone" }, {
      semanticBridgeSnapshot: async (args, context) => {
        calls.push({ args, context });
        return { available: true, source: "plugin-bridge-semantic", refs: [{ ref: "@e1" }] };
      },
      commandPath: async (name) => name === "axe" ? "/usr/bin/axe" : null,
      resolveIosDevice: async () => ({ udid: "UDID-1", name: "iPhone 15" }),
      execFile: async (file, argv, options) => {
        calls.push({ file, argv, options });
        return { stdout: "[{\"role\":\"button\"}]", stderr: "" };
      },
    }));

    assert.equal(payload.available, true);
    assert.equal(payload.action, "tree");
    assert.deepEqual(payload.source, ["plugin-bridge-semantic", "native-accessibility"]);
    assert.deepEqual(payload.device, { udid: "UDID-1", name: "iPhone 15" });
    assert.deepEqual(payload.tree, [{ role: "button" }]);
    assert.equal(payload.semanticBridge.available, true);
    assert.equal(calls[0].context.filters.includeSource, true);
    assert.deepEqual(calls[1].argv, ["describe-ui", "--udid", "UDID-1"]);
    assert.equal(calls[1].options.timeout, 12000);
    assert.equal(calls[1].options.maxBuffer, 4 * 1024 * 1024);
  });

  it("returns unavailable tree payloads for semantic errors, missing axe, and native failures", async () => {
    const missingAxe = parseToolJson(await accessibilityCommand({ action: "tree" }, {
      semanticBridgeSnapshot: async () => { throw new Error("bridge exploded"); },
      commandPath: async () => null,
    }));
    const nativeFailure = parseToolJson(await accessibilityCommand({ action: "tree" }, {
      semanticBridgeSnapshot: async () => ({ available: false, reason: "no bridge" }),
      commandPath: async () => "/usr/bin/axe",
      resolveIosDevice: async () => ({ udid: "UDID-1" }),
      execFile: async () => ({ stdout: "", stderr: "x".repeat(40020), error: "failed" }),
    }));

    assert.equal(missingAxe.available, false);
    assert.equal(missingAxe.reason, "axe CLI is not installed or not on PATH.");
    assert.equal(missingAxe.semanticBridge.code, "transport-failure");
    assert.equal(missingAxe.semanticBridge.reason, "bridge exploded");
    assert.equal(nativeFailure.available, false);
    assert.equal(nativeFailure.reason, "Native accessibility tree failed.");
    assert.equal(nativeFailure.error, "failed");
    assert.match(nativeFailure.stderr, /\.\.\.\[truncated 20 chars\]$/);
  });

  it("rejects unknown actions and preserves helper contracts", async () => {
    await assert.rejects(() => accessibilityCommand({ action: "scan" }), /Unknown accessibility action: scan/);
    await assert.rejects(() => accessibilityCommand({ action: "focus" }), /ref must be a non-empty string/);
    assert.equal(clampNumber(99, 0, 10), 10);
    assert.equal(truncate("abc", 2), "ab...[truncated 1 chars]");
  });
});

function depsWithCache(cache: any): AccessibilityDependencies {
  return {
    readLatestRefCache: async () => cache,
  };
}

function parseToolJson(result: ToolTextResult): any {
  return JSON.parse(result.content[0]?.text ?? "null");
}
