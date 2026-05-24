import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  evaluateWaitPredicate,
  findCommand,
  findMatches,
  planRefAction,
  refHasVisibleEvidence,
  refPoint,
  requireString,
  scrollPlan,
  timeoutWaitPayload,
  unwrapToolJson,
  waitCommand,
  waitEvidence,
  waitPredicate,
} from "../main/index.js";
import type { RefActionDependencies, RefCache, RefRecord, ToolTextResult, WaitPredicate } from "../main/index.js";

const BASE_REFS: RefRecord[] = [
  refRecord({
    ref: "@e1",
    role: "button",
    label: "Add Customer",
    text: "Create",
    component: "AddCustomerButton",
    source: { file: "src/AddCustomer.tsx" },
    box: { x: 10, y: 20, width: 100, height: 40 },
    actions: ["tap", "inspect"],
  }),
  refRecord({
    ref: "@e2",
    role: "text",
    label: "Customer List",
    text: "Customers",
    source: { file: "src/CustomerList.tsx" },
    actions: ["inspect"],
  }),
  refRecord({
    ref: "@e3",
    role: "textbox",
    label: "Email",
    placeholder: "name@example.com",
    testID: "email-input",
    nativeID: "native-email",
    box: { x: 30, y: 100, width: 240, height: 36 },
    actions: ["tap", "fill", "focus", "inspect"],
  }),
  refRecord({
    ref: "@e4",
    role: "progressbar",
    label: "Loading spinner",
    actions: ["inspect"],
  }),
];

describe("ref-actions-wait legacy characterization", () => {
  describe("requireString and finder behavior", () => {
    it("trims non-empty strings and rejects missing, empty, and non-string values with the legacy message", () => {
      assert.equal(requireString("  tap  ", "action"), "tap");
      assert.throws(() => requireString("", "ref"), /ref must be a non-empty string\./);
      assert.throws(() => requireString("   ", "kind"), /kind must be a non-empty string\./);
      assert.throws(() => requireString(123, "value"), /value must be a non-empty string\./);
    });

    it("finds role, text, label, source, first, and nth matches with normalized text", () => {
      assert.deepEqual(findMatches(BASE_REFS, "role", "BUTTON").map((record) => record.ref), ["@e1"]);
      assert.deepEqual(findMatches(BASE_REFS, "role", "button", "customer").map((record) => record.ref), ["@e1"]);
      assert.deepEqual(findMatches(BASE_REFS, "text", "customers").map((record) => record.ref), ["@e2"]);
      assert.deepEqual(findMatches(BASE_REFS, "label", "email").map((record) => record.ref), ["@e3"]);
      assert.deepEqual(findMatches(BASE_REFS, "source", "addcustomerbutton").map((record) => record.ref), ["@e1"]);
      assert.deepEqual(findMatches(BASE_REFS, "source", "customerlist.tsx").map((record) => record.ref), ["@e2"]);
      assert.deepEqual(findMatches(BASE_REFS, "first", "customer").map((record) => record.ref), ["@e1"]);
      assert.deepEqual(findMatches(BASE_REFS, "nth", 2, "customer").map((record) => record.ref), ["@e2"]);
      assert.deepEqual(findMatches(BASE_REFS, "nth", 0, "customer").map((record) => record.ref), ["@e1"]);
      assert.deepEqual(findMatches(BASE_REFS, "nth", 99, "customer"), []);
      assert.throws(() => findMatches(BASE_REFS, "unknown", "customer"), /Unknown finder kind: unknown/);
      assert.throws(() => findMatches(BASE_REFS, "nth", 1), /name must be a non-empty string\./);
    });

    it("returns unavailable when findCommand has no latest ref cache", async () => {
      const deps = depsWithCaches([null]);

      assert.deepEqual(parseToolJson(await findCommand({ kind: "text", value: "Customer" }, deps)), {
        available: false,
        reason: "No snapshot exists for the current session.",
      });
    });

    it("adds optional tap action output for the first match using the injected action planner", async () => {
      const actionCalls: Array<Record<string, unknown>> = [];
      const deps = depsWithCaches([cache(BASE_REFS)], {
        planFinderAction: async (args) => {
          actionCalls.push(args);
          return {
            available: true,
            dryRun: true,
            plan: {
              action: args.action,
              ref: args.ref,
              targetId: "target-1",
              box: BASE_REFS[0]?.box,
              point: { x: 60, y: 40 },
            },
          };
        },
      });

      assert.deepEqual(parseToolJson(await findCommand({ kind: "text", value: "create", action: "tap" }, deps)), {
        available: true,
        kind: "text",
        value: "create",
        name: null,
        matches: [BASE_REFS[0]],
        actionResult: {
          available: true,
          dryRun: true,
          plan: {
            action: "tap",
            ref: "@e1",
            targetId: "target-1",
            box: { x: 10, y: 20, width: 100, height: 40 },
            point: { x: 60, y: 40 },
          },
        },
      });
      assert.deepEqual(actionCalls, [{ kind: "text", value: "create", action: "tap", ref: "@e1", dryRun: true }]);
    });

    it("returns an actionResult unavailable envelope when action is requested but no ref matches", async () => {
      const deps = depsWithCaches([cache(BASE_REFS)]);

      assert.deepEqual(parseToolJson(await findCommand({ kind: "text", value: "missing", action: "tap" }, deps)), {
        available: false,
        kind: "text",
        value: "missing",
        name: null,
        matches: [],
        actionResult: { available: false, reason: "No matching ref for action.", action: "tap" },
      });
    });

    it("rejects unsupported finder actions before invoking the injected planner", async () => {
      let plannerCalls = 0;
      const deps = depsWithCaches([cache(BASE_REFS)], {
        planFinderAction: async () => {
          plannerCalls += 1;
          return { available: true };
        },
      });

      assert.deepEqual(parseToolJson(await findCommand({ kind: "text", value: "create", action: "delete" }, deps)), {
        available: true,
        kind: "text",
        value: "create",
        name: null,
        matches: [BASE_REFS[0]],
        actionResult: { available: false, reason: "Unsupported finder action: delete", action: "delete" },
      });
      assert.equal(plannerCalls, 0);
    });
  });

  describe("wait predicate selection and waitCommand polling", () => {
    it("selects wait predicates in legacy priority order and validates string arguments", () => {
      assert.deepEqual(waitPredicate({ metroReady: true, appReady: true, text: "Ready" }), { kind: "metro-ready" });
      assert.deepEqual(waitPredicate({ appReady: true, fn: "1 === 1" }), { kind: "app-ready" });
      assert.deepEqual(waitPredicate({ fn: " Boolean(globalThis.ready) " }), {
        kind: "fn",
        expression: "Boolean(globalThis.ready)",
      });
      assert.deepEqual(waitPredicate({ route: " /customers " }), { kind: "route", route: "/customers" });
      assert.deepEqual(waitPredicate({ noSpinner: true, text: "Ready" }), { kind: "no-spinner" });
      assert.deepEqual(waitPredicate({ text: " Ready " }), { kind: "text", text: "Ready" });
      assert.deepEqual(waitPredicate({ ref: "@e1" }), { kind: "ref-state", ref: "@e1", state: "visible" });
      assert.deepEqual(waitPredicate({ ref: "@e1", state: " HIDDEN " }), { kind: "ref-state", ref: "@e1", state: "hidden" });
      assert.equal(waitPredicate({ ms: 50 }), null);
      assert.throws(() => waitPredicate({ fn: "" }), /fn must be a non-empty string\./);
      assert.throws(() => waitPredicate({ ref: "@e1", state: "" }), /state must be a non-empty string\./);
      assert.throws(() => waitPredicate({ state: "visible" }), /ref must be a non-empty string\./);
    });

    it("sleeps for clamped milliseconds when no predicate is supplied", async () => {
      const sleeps: number[] = [];
      let now = 1000;
      const deps = depsWithCaches([], {
        now: () => now,
        sleep: async (ms) => {
          sleeps.push(ms);
          now += ms;
        },
      });

      assert.deepEqual(parseToolJson(await waitCommand({ ms: 70000 }, deps)), {
        matched: true,
        predicate: { kind: "sleep", ms: 60000 },
        elapsedMs: 60000,
      });
      assert.deepEqual(sleeps, [60000]);
    });

    it("polls cache predicates at a bounded interval until a match appears", async () => {
      const sleeps: number[] = [];
      let now = 0;
      const first = cache([BASE_REFS[3] ?? refRecord({ ref: "@e4", actions: [] })]);
      const second = cache([BASE_REFS[0] ?? refRecord({ ref: "@e1", actions: [] })]);
      const deps = depsWithCaches([first, second], {
        now: () => now,
        sleep: async (ms) => {
          sleeps.push(ms);
          now += ms;
        },
      });

      assert.deepEqual(parseToolJson(await waitCommand({ text: "create", timeoutMs: 1000 }, deps)), {
        matched: true,
        predicate: { kind: "text", text: "create" },
        ref: BASE_REFS[0],
        lastEvidence: { snapshotId: "snapshot-1", targetId: "target-1", refCount: 1 },
        elapsedMs: 100,
      });
      assert.deepEqual(sleeps, [100]);
    });

    it("returns unmatched immediately when no ref cache exists", async () => {
      const deps = depsWithCaches([null]);

      assert.deepEqual(parseToolJson(await waitCommand({ text: "Ready" }, deps)), {
        matched: false,
        reason: "No snapshot exists for the current session.",
        predicate: { kind: "text", text: "Ready" },
        lastEvidence: null,
      });
    });

    it("delegates runtime waits to an injected adapter and fails explicitly when absent", async () => {
      const calls: Array<Record<string, unknown>> = [];
      const deps = depsWithCaches([], {
        now: () => 1234,
        waitRuntimePredicate: async (predicate, args, timing) => {
          calls.push({ predicate, args, timing });
          return { matched: true, predicate, elapsedMs: 250, target: { title: "Fixture" } };
        },
      });

      assert.deepEqual(parseToolJson(await waitCommand({ appReady: true, timeoutMs: 1000 }, deps)), {
        matched: true,
        predicate: { kind: "app-ready" },
        elapsedMs: 250,
        target: { title: "Fixture" },
      });
      assert.deepEqual(calls, [
        {
          predicate: { kind: "app-ready" },
          args: { appReady: true, timeoutMs: 1000 },
          timing: { started: 1234, timeoutMs: 1000, intervalMs: 100 },
        },
      ]);

      await assert.rejects(
        () => waitCommand({ metroReady: true }, depsWithCaches([])),
        /Runtime wait predicate requires waitRuntimePredicate dependency\./,
      );
    });
  });

  describe("wait predicate evaluation and timeout payloads", () => {
    it("evaluates text, route, no-spinner, and ref-state predicates with finality matching legacy behavior", () => {
      const loaded = cache(BASE_REFS);
      const noSpinner = cache(BASE_REFS.filter((record) => record.ref !== "@e4"));
      const hiddenRef = cache([refRecord({ ref: "@e9", role: "button", label: "", text: "", box: null, actions: ["tap"] })]);

      assert.deepEqual(evaluateWaitPredicate(loaded, { kind: "text", text: "customer" }), {
        matched: true,
        final: true,
        payload: {
          matched: true,
          predicate: { kind: "text", text: "customer" },
          ref: BASE_REFS[0],
          lastEvidence: { snapshotId: "snapshot-1", targetId: "target-1", refCount: 4 },
        },
      });
      assert.deepEqual(evaluateWaitPredicate(loaded, { kind: "route", route: "customer list" }).matched, true);
      assert.deepEqual(evaluateWaitPredicate(loaded, { kind: "no-spinner" }), { matched: false, final: false });
      assert.deepEqual(evaluateWaitPredicate(noSpinner, { kind: "no-spinner" }), {
        matched: true,
        final: true,
        payload: {
          matched: true,
          predicate: { kind: "no-spinner" },
          lastEvidence: { snapshotId: "snapshot-1", targetId: "target-1", refCount: 3 },
        },
      });
      assert.deepEqual(evaluateWaitPredicate(loaded, { kind: "ref-state", ref: "@e1", state: "visible" }).matched, true);
      assert.deepEqual(evaluateWaitPredicate(hiddenRef, { kind: "ref-state", ref: "@e9", state: "hidden" }).matched, true);
    });

    it("returns final unmatched payloads for invalid, missing, and stale refs and throws unknown state", () => {
      const loaded = cache([
        ...BASE_REFS,
        refRecord({ ref: "@e8", role: "button", label: "Old", stale: true, actions: ["tap"] }),
      ]);

      assert.deepEqual(evaluateWaitPredicate(loaded, { kind: "ref-state", ref: "e1", state: "visible" }), {
        matched: false,
        final: true,
        payload: { matched: false, reason: "Ref must look like @e1.", ref: "e1" },
      });
      assert.deepEqual(evaluateWaitPredicate(loaded, { kind: "ref-state", ref: "@e9", state: "visible" }), {
        matched: false,
        final: true,
        payload: { matched: false, reason: "Ref not found in the latest snapshot.", ref: "@e9" },
      });
      assert.deepEqual(evaluateWaitPredicate(loaded, { kind: "ref-state", ref: "@e8", state: "visible" }), {
        matched: false,
        final: true,
        payload: {
          matched: false,
          reason: "Ref is stale. Capture a new snapshot before waiting on it.",
          ref: "@e8",
        },
      });
      assert.throws(
        () => evaluateWaitPredicate(loaded, { kind: "ref-state", ref: "@e1", state: "disabled" }),
        /Unknown wait state: disabled/,
      );
    });

    it("reports wait evidence, sample refs, visible evidence, and timeout payload shape", () => {
      const loaded = cache(BASE_REFS);
      const predicate: WaitPredicate = { kind: "ref-state", ref: "@e1", state: "visible" };

      assert.deepEqual(waitEvidence(loaded), { snapshotId: "snapshot-1", targetId: "target-1", refCount: 4 });
      assert.deepEqual(waitEvidence(loaded, { includeSampleRefs: true }), {
        snapshotId: "snapshot-1",
        targetId: "target-1",
        refCount: 4,
        sampleRefs: BASE_REFS.map((record) => ({
          ref: record.ref,
          role: record.role ?? null,
          label: record.label ?? null,
          text: record.text ?? null,
          stale: record.stale === true,
        })),
      });
      assert.equal(refHasVisibleEvidence({ box: { x: 0, y: 0, width: 1, height: 1 }, actions: [] }), true);
      assert.equal(refHasVisibleEvidence({ text: " Ready ", actions: [] }), true);
      assert.equal(refHasVisibleEvidence({ label: " Visible ", actions: [] }), true);
      assert.equal(refHasVisibleEvidence({ text: " ", label: "", box: null, actions: [] }), false);
      assert.deepEqual(timeoutWaitPayload(predicate, loaded, 1000, 1200), {
        matched: false,
        reason: "Timed out waiting for @e1 to become visible.",
        predicate,
        timeoutMs: 1000,
        elapsedMs: 1200,
        lastEvidence: waitEvidence(loaded, { includeSampleRefs: true }),
      });
      assert.deepEqual(timeoutWaitPayload({ kind: "text", text: "Ready" }, loaded, 1000, 1000).reason, "Timed out waiting for text.");
      assert.deepEqual(
        timeoutWaitPayload({ kind: "no-spinner" }, loaded, 1000, 1000).reason,
        "Timed out waiting for undefined to become undefined.",
      );
    });
  });

  describe("ref action and scroll planning", () => {
    it("plans ref actions only when cache, ref freshness, and action capability checks pass", async () => {
      assert.deepEqual(await planRefAction({ action: "tap", ref: "@e1" }, depsWithCaches([null])), {
        available: false,
        reason: "No snapshot exists for the current session.",
      });
      assert.deepEqual(await planRefAction({ action: "tap", ref: "@e9" }, depsWithCaches([cache(BASE_REFS)])), {
        available: false,
        reason: "Ref not found in the latest snapshot.",
        ref: "@e9",
      });
      assert.deepEqual(
        await planRefAction(
          { action: "tap", ref: "@e8" },
          depsWithCaches([cache([refRecord({ ref: "@e8", stale: true, actions: ["tap"] })])]),
        ),
        {
          available: false,
          reason: "Ref is stale. Capture a new snapshot before acting.",
          ref: "@e8",
        },
      );
      assert.deepEqual(await planRefAction({ action: "fill", ref: "@e1" }, depsWithCaches([cache(BASE_REFS)])), {
        available: false,
        reason: "Action is not available for this ref.",
        ref: "@e1",
        action: "fill",
        availableActions: ["tap", "inspect"],
      });
      assert.deepEqual(await planRefAction({ action: "tap", ref: "@e1" }, depsWithCaches([cache(BASE_REFS)])), {
        available: true,
        dryRun: true,
        plan: {
          action: "tap",
          ref: "@e1",
          targetId: "target-1",
          box: { x: 10, y: 20, width: 100, height: 40 },
          point: { x: 60, y: 40 },
        },
      });
      await assert.rejects(
        () => planRefAction({ action: "", ref: "@e1" }, depsWithCaches([cache(BASE_REFS)])),
        /action must be a non-empty string\./,
      );
      await assert.rejects(
        () => planRefAction({ action: "tap", ref: "" }, depsWithCaches([cache(BASE_REFS)])),
        /ref must be a non-empty string\./,
      );
    });

    it("computes ref center points and rejects refs without bounds", async () => {
      assert.deepEqual(await refPoint("@e1", depsWithCaches([cache(BASE_REFS)])), {
        available: true,
        ref: "@e1",
        point: { x: 60, y: 40 },
        box: { x: 10, y: 20, width: 100, height: 40 },
      });
      assert.deepEqual(await refPoint("@e2", depsWithCaches([cache(BASE_REFS)])), {
        available: false,
        reason: "Ref does not include bounds.",
        ref: "@e2",
      });
    });

    it("builds scroll plans from ref origins or default origin with clamped amounts and direction deltas", async () => {
      assert.deepEqual(await scrollPlan({ ref: "@e1", targetRef: "down", amount: 50 }, depsWithCaches([cache(BASE_REFS)])), {
        available: true,
        dryRun: true,
        action: "scroll",
        direction: "down",
        amount: 50,
        coordinates: { startX: 60, startY: 40, endX: 60, endY: -10 },
      });
      assert.deepEqual(await scrollPlan({ direction: "up", amount: 0 }, depsWithCaches([])), {
        available: true,
        dryRun: true,
        action: "scroll",
        direction: "up",
        amount: 1,
        coordinates: { startX: 200, startY: 700, endX: 200, endY: 701 },
      });
      assert.deepEqual(await scrollPlan({ ref: "left", text: 6000 }, depsWithCaches([])), {
        available: true,
        dryRun: true,
        action: "scroll",
        direction: "left",
        amount: 5000,
        coordinates: { startX: 200, startY: 700, endX: 5200, endY: 700 },
      });
      assert.deepEqual(await scrollPlan({ direction: "diagonal" }, depsWithCaches([])), {
        available: false,
        reason: "Unknown scroll direction: diagonal",
        direction: "diagonal",
      });
      assert.deepEqual(await scrollPlan({ ref: "@e2", direction: "down" }, depsWithCaches([cache(BASE_REFS)])), {
        available: false,
        reason: "Ref does not include bounds.",
        ref: "@e2",
      });
    });
  });
});

function refRecord(overrides: Partial<RefRecord>): RefRecord {
  return {
    ref: overrides.ref ?? "@e1",
    snapshotId: overrides.snapshotId ?? "snapshot-1",
    targetId: overrides.targetId ?? "target-1",
    stale: overrides.stale ?? false,
    role: overrides.role ?? null,
    label: overrides.label ?? null,
    text: overrides.text ?? null,
    placeholder: overrides.placeholder ?? null,
    testID: overrides.testID ?? null,
    nativeID: overrides.nativeID ?? null,
    component: overrides.component ?? null,
    source: overrides.source ?? null,
    box: overrides.box ?? null,
    actions: overrides.actions ?? [],
  };
}

function cache(refs: RefRecord[], overrides: Partial<RefCache> = {}): RefCache {
  return {
    snapshotId: overrides.snapshotId ?? "snapshot-1",
    targetId: overrides.targetId ?? "target-1",
    refs,
  };
}

function depsWithCaches(caches: Array<RefCache | null>, overrides: Partial<RefActionDependencies> = {}): RefActionDependencies {
  let index = 0;
  return {
    readLatestRefCache: async () => {
      const value = caches[Math.min(index, Math.max(caches.length - 1, 0))] ?? null;
      index += 1;
      return value;
    },
    ...overrides,
  };
}

function parseToolJson(result: ToolTextResult): unknown {
  return unwrapToolJson(result);
}
