import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  debugInspectCommand,
  debugInspectPayload,
  highlightCommand,
  highlightSvg,
  requireString,
  resolveExpoStateRoot,
  toolJson,
} from "../main/index.js";
import type { DebugInspectDependencies, ToolTextResult } from "../main/index.js";

const SESSION = { sessionId: "session-1", lastSnapshotId: "snap-1", updatedAt: "2026-05-23T12:00:00.000Z" };
const CACHE = {
  snapshotId: "snap-1",
  targetId: "target-1",
  refs: [
    {
      ref: "@e1",
      role: "button",
      label: "Save",
      text: "",
      testID: "save-button",
      nativeID: "save-native",
      box: { x: 10, y: 20, width: 80, height: 44 },
      source: { file: "app/index.tsx", line: 7, column: 3 },
      component: "SaveButton",
      props: { disabled: false },
      actions: ["tap", "inspect"],
      stale: false,
    },
    { ref: "@stale", role: "button", label: "Old", stale: true },
    { ref: "@noBox", role: "text", label: "No bounds", actions: [] },
  ],
};

describe("debug-inspect-highlight legacy characterization", () => {
  it("assembles inspect payloads from cached ref, latest session, target, and Metro status", async () => {
    const payload = await debugInspectPayload({ ref: "@e1", metroPort: 99999 }, deps());

    assert.equal(payload.available, true);
    assert.equal(payload.action, "inspect");
    assert.equal(payload.ref, "@e1");
    assert.equal(payload.sessionId, "session-1");
    assert.equal(payload.snapshotId, "snap-1");
    assert.equal(payload.targetId, "target-1");
    assert.deepEqual(payload.target, { targetId: "target-1", selected: true });
    assert.deepEqual(payload.metro, {
      available: true,
      port: 65535,
      targetCount: 2,
      firstTarget: { id: "metro-target-1", title: "App" },
    });
    assert.deepEqual(payload.element, {
      ref: "@e1",
      role: "button",
      label: "Save",
      text: "",
      testID: "save-button",
      box: { x: 10, y: 20, width: 80, height: 44 },
      source: { file: "app/index.tsx", line: 7, column: 3 },
      component: "SaveButton",
      props: { disabled: false },
      actions: ["tap", "inspect"],
      stale: false,
    });
    assert.match(String(payload.evidence.refCache), /sessions\/session-1\/refs\.json$/);
    assert.deepEqual(payload.limitations, [
      "Inspect is assembled from the latest cached semantic/native ref snapshot plus Metro target status.",
      "Props and source are present only when the snapshot source includes them.",
    ]);
  });

  it("returns legacy unavailable inspect payloads for missing, stale, and absent snapshots", async () => {
    assert.deepEqual(await debugInspectPayload({ ref: "@missing" }, deps()), {
      available: false,
      reason: "Ref not found in the latest snapshot.",
      ref: "@missing",
      action: "inspect",
      sessionId: "session-1",
    });
    assert.deepEqual(await debugInspectPayload({ ref: "@stale" }, deps()), {
      available: false,
      reason: "Ref is stale. Capture a new snapshot before acting.",
      ref: "@stale",
      action: "inspect",
      sessionId: "session-1",
    });
    assert.deepEqual(await debugInspectPayload({ ref: "@e1" }, deps({ cache: null, session: null })), {
      available: false,
      reason: "No snapshot exists for the current session.",
      ref: "@e1",
      action: "inspect",
      sessionId: null,
    });
  });

  it("wraps inspect and highlight results in tool JSON envelopes", async () => {
    const inspect = parseToolJson(await debugInspectCommand({ ref: "@e1" }, deps()));
    const highlight = parseToolJson(await highlightCommand({ ref: "@e1", durationMs: 250 }, deps({ nowDate: new Date("2026-05-23T12:34:56.789Z") })));

    assert.equal(inspect.available, true);
    assert.equal(inspect.action, "inspect");
    assert.equal(highlight.available, true);
    assert.equal(highlight.action, "highlight");
    assert.equal(highlight.durationMs, 250);
    assert.match(highlight.outputPath, /artifacts\/highlight-e1-2026-05-23T12-34-56-789Z\.svg$/);
    assert.deepEqual(highlight.limitations, [
      "Highlight writes an evidence overlay artifact from cached bounds; it does not draw inside the running app.",
    ]);
  });

  it("requires bounds before highlighting and preserves missing-ref payloads", async () => {
    assert.deepEqual(parseToolJson(await highlightCommand({ ref: "@noBox" }, deps())), {
      available: false,
      action: "highlight",
      ref: "@noBox",
      reason: "Ref does not include bounds. Capture a snapshot with --bounds before highlighting.",
      record: CACHE.refs[2],
    });
    assert.deepEqual(parseToolJson(await highlightCommand({ ref: "@missing" }, deps())), {
      available: false,
      reason: "Ref not found in the latest snapshot.",
      ref: "@missing",
      action: "highlight",
    });
  });

  it("writes legacy highlight SVG content from cached bounds and escaped labels", async () => {
    const writes: Array<{ file: string; data: string; encoding: string }> = [];
    const payload = parseToolJson(await highlightCommand({ ref: "@e1" }, deps({
      nowDate: new Date("2026-05-23T00:00:00.000Z"),
      writeFile: async (file, data, encoding) => { writes.push({ file, data, encoding }); },
    })));

    assert.equal(payload.available, true);
    assert.equal(writes.length, 1);
    assert.equal(writes[0].encoding, "utf8");
    assert.match(writes[0].file, /highlight-e1-2026-05-23T00-00-00-000Z\.svg$/);
    assert.match(writes[0].data, /<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="390" height="844"/);
    assert.match(writes[0].data, /<rect x="10" y="20" width="80" height="44"/);
    assert.match(writes[0].data, />@e1 Save<\/text>/);
  });

  it("preserves helper contracts for state roots, input validation, and SVG escaping", () => {
    assert.equal(resolveExpoStateRoot({ cwd: "/tmp/project" }), "/tmp/project/.scratch/expo-ios");
    assert.equal(resolveExpoStateRoot({ stateDir: "/tmp/project/.scratch/expo-ios/runs" }), "/tmp/project/.scratch/expo-ios");
    assert.equal(requireString(" @e1 ", "ref"), "@e1");
    assert.match(highlightSvg({
      ref: "@e9",
      record: { label: "A&B <C>", box: { x: 388, y: 840, width: 10, height: 12 } },
      durationMs: 10,
    }), /@e9 A&amp;B &lt;C&gt;/);
  });
});

function deps(overrides: Partial<DebugInspectDependencies> & { cache?: any; session?: any; nowDate?: Date } = {}): DebugInspectDependencies {
  const cache = "cache" in overrides ? overrides.cache : CACHE;
  const session = "session" in overrides ? overrides.session : SESSION;
  return {
    readLatestRefCache: async () => cache,
    readLatestSession: async () => session,
    readSelectedTarget: async () => ({ targetId: "target-1", selected: true }),
    metroStatusPayload: async () => ({ available: true, targetCount: 2, targets: [{ id: "metro-target-1", title: "App" }, { id: "metro-target-2" }] }),
    mkdir: async () => undefined,
    writeFile: async () => undefined,
    now: () => overrides.nowDate ?? new Date("2026-05-23T12:00:00.000Z"),
    ...overrides,
  };
}

function parseToolJson(result: ToolTextResult): any {
  return JSON.parse(result.content[0]?.text ?? "null");
}
