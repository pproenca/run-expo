import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  rnCommand,
  rnExpression,
  rnInspectPayload,
  rnLimitations,
} from "../main/index.js";
import type { RnIntrospectionDependencies, ToolTextResult } from "../main/index.js";

const CACHE = {
  snapshotId: "snap-1",
  targetId: "target-1",
  refs: [
    { ref: "@e1", role: "button", label: "Save", component: "SaveButton" },
  ],
};

describe("rn-introspection legacy characterization", () => {
  it("delegates tree introspection to the RN bridge domain with read-only policy", async () => {
    const calls: any[] = [];
    const payload = parseToolJson(await rnCommand({ action: "tree", metroPort: 19000 }, {
      bridgeDomainCommand: async (request) => {
        calls.push(request);
        return { available: true, source: "app-instrumentation", tree: [{ name: "Root" }], limitations: ["bridge caveat"] };
      },
    }));

    assert.deepEqual(payload, {
      available: true,
      source: "app-instrumentation",
      tree: [{ name: "Root" }],
      limitations: [
        "bridge caveat",
        "private React Native hooks and fiber fields are version-dependent and may be incomplete or unavailable.",
      ],
      action: "tree",
    });
    assert.equal(calls[0].domain, "rn");
    assert.equal(calls[0].action, "tree");
    assert.equal(calls[0].args.metroPort, 19000);
    assert.deepEqual(calls[0].policy, {
      checked: true,
      action: "rn.tree",
      sideEffect: "read",
      allowed: true,
      reason: "React Native introspection is read-only.",
    });
    assert.match(calls[0].expression, /const action = "tree"/);
  });

  it("maps renders subactions to renders-* bridge actions", async () => {
    const calls: any[] = [];
    const payload = parseToolJson(await rnCommand({ action: "renders", subaction: "start" }, depsWithBridge(calls)));

    assert.equal(payload.action, "renders");
    assert.equal(payload.subaction, "start");
    assert.equal(payload.bridgeAction, "renders-start");
    assert.equal(calls[0].action, "renders-start");
    assert.equal(calls[0].policy.action, "rn.renders-start");
    await assert.rejects(() => rnCommand({ action: "renders", subaction: "pause" }, depsWithBridge([])), /Unknown React Native renders action: pause/);
  });

  it("passes refs to fiber expressions and rejects unknown actions", async () => {
    const calls: any[] = [];
    await rnCommand({ action: "fiber", ref: "@e1" }, depsWithBridge(calls));

    assert.equal(calls[0].action, "fiber");
    assert.match(calls[0].expression, /const ref = "@e1"/);
    await assert.rejects(() => rnCommand({ action: "native" }, depsWithBridge([])), /Unknown React Native action: native/);
  });

  it("inspects cached ref evidence without runtime fiber internals", async () => {
    assert.deepEqual(await rnInspectPayload({ ref: "@e1" }, depsWithCache(CACHE)), {
      available: true,
      action: "inspect",
      ref: "@e1",
      sources: ["native-accessibility", "snapshot-cache"],
      snapshotId: "snap-1",
      targetId: "target-1",
      record: CACHE.refs[0],
      limitations: [
        "Inspect uses cached semantic/native accessibility evidence and does not expose private fiber internals.",
        "private React Native hooks and fiber fields are version-dependent and may be incomplete or unavailable.",
      ],
    });
  });

  it("returns legacy unavailable inspect payloads for absent snapshots and missing refs", async () => {
    assert.deepEqual(await rnInspectPayload({ ref: "@e1" }, depsWithCache(null)), {
      available: false,
      action: "inspect",
      ref: "@e1",
      sources: ["snapshot-cache"],
      reason: "No snapshot exists for the current session.",
      limitations: ["private React Native hooks and fiber fields are version-dependent and may be incomplete or unavailable."],
    });
    assert.deepEqual(await rnInspectPayload({ ref: "@missing" }, depsWithCache(CACHE)), {
      available: false,
      action: "inspect",
      ref: "@missing",
      sources: ["native-accessibility", "snapshot-cache"],
      reason: "Ref not found in the latest snapshot.",
      snapshotId: "snap-1",
      targetId: "target-1",
      limitations: ["private React Native hooks and fiber fields are version-dependent and may be incomplete or unavailable."],
    });
  });

  it("preserves RN runtime expression fallback contracts", () => {
    const expression = rnExpression({ action: "renders-read", ref: null });

    assert.match(expression, /__EXPO_IOS_RN_BRIDGE__/);
    assert.match(expression, /__EXPO_IOS_INSTRUMENTATION__/);
    assert.match(expression, /React Native bridge is not installed/);
    assert.match(expression, /Fiber inspection is not exposed by the app bridge/);
    assert.match(expression, /renders: \{ recording: false, commits: \[\] \}/);
    assert.deepEqual(rnLimitations(["extra"]), [
      "extra",
      "private React Native hooks and fiber fields are version-dependent and may be incomplete or unavailable.",
    ]);
  });

  it("wraps inspect payloads in tool JSON through rnCommand", async () => {
    const payload = parseToolJson(await rnCommand({ action: "inspect", ref: "@e1" }, depsWithCache(CACHE)));

    assert.equal(payload.available, true);
    assert.equal(payload.action, "inspect");
    assert.equal(payload.record.label, "Save");
  });
});

function depsWithBridge(calls: any[]): RnIntrospectionDependencies {
  return {
    bridgeDomainCommand: async (request) => {
      calls.push(request);
      return { available: true, limitations: [] };
    },
  };
}

function depsWithCache(cache: any): RnIntrospectionDependencies {
  return {
    readLatestRefCache: async () => cache,
  };
}

function parseToolJson(result: ToolTextResult): any {
  return JSON.parse(result.content[0]?.text ?? "null");
}
