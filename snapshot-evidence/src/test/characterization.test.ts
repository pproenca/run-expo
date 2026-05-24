import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  actionsForAccessibilityRole,
  buildSnapshotFilters,
  createSnapshotId,
  flattenAccessibilityNodes,
  getRefCommand,
  normalizeAccessibilityRole,
  normalizeFrame,
  normalizeSemanticBridgeRefs,
  normalizeSource,
  persistNativeSnapshot,
  persistSemanticSnapshot,
  refFieldValue,
  refRecordFromNode,
  refsCommand,
  snapshotCommand,
  snapshotNodeFromAccessibility,
} from "../main/index.js";
import type {
  RefCache,
  RefCommandDependencies,
  RefRecord,
  SemanticBridgeSnapshot,
  SessionRecord,
  SnapshotCommandDependencies,
  SnapshotFilters,
  SnapshotPersistenceDependencies,
  TargetRecord,
} from "../main/index.js";

const STATE_ROOT = "/work/app/.scratch/expo-ios";
const GENERATED_AT = "2026-05-23T16:20:30.456Z";
const SNAPSHOT_ID = "snapshot-20260523-162030z-abc123";

const ALL_FILTERS: SnapshotFilters = {
  interactiveOnly: false,
  compact: false,
  depth: null,
  includeSource: true,
  includeBounds: true,
};

describe("snapshot-evidence legacy characterization", () => {
  describe("RULE-010 snapshot preconditions and filters", () => {
    it("returns the legacy unavailable envelope when no session exists", async () => {
      const store = snapshotDeps({ session: null, target: selectedTarget() });

      assert.deepEqual(await snapshotCommand({ stateRoot: STATE_ROOT }, store), {
        available: false,
        reason: "No session exists. Run `expo-ios --json session new review` first.",
      });
      assert.deepEqual(store.writes, {});
      assert.deepEqual(store.createdDirectories, []);
      assert.equal(store.updatedSession, undefined);
    });

    it("returns the current session ID when no active target is selected", async () => {
      const store = snapshotDeps({ session: session({ activeTargetId: null }), target: selectedTarget() });

      assert.deepEqual(await snapshotCommand({ stateRoot: STATE_ROOT }, store), {
        available: false,
        reason: "No target selected for the current session.",
        sessionId: "review-1",
      });
      assert.deepEqual(store.writes, {});
    });

    it("returns the active target ID when selected target metadata is missing", async () => {
      const store = snapshotDeps({ session: session({ activeTargetId: "target-1" }), target: null });

      assert.deepEqual(await snapshotCommand({ stateRoot: STATE_ROOT }, store), {
        available: false,
        reason: "Selected target metadata is missing.",
        targetId: "target-1",
      });
      assert.deepEqual(store.writes, {});
    });

    it("builds filters from boolean flags and clamps depth to the legacy 1..100 range", () => {
      assert.deepEqual(buildSnapshotFilters({}), {
        interactiveOnly: false,
        compact: false,
        depth: null,
        includeSource: false,
        includeBounds: false,
      });
      assert.deepEqual(buildSnapshotFilters({ interactive: true, compact: true, depth: 0, source: true, bounds: true }), {
        interactiveOnly: true,
        compact: true,
        depth: 1,
        includeSource: true,
        includeBounds: true,
      });
      assert.equal(buildSnapshotFilters({ depth: 101 }).depth, 100);
      assert.equal(buildSnapshotFilters({ depth: "5" }).depth, 5);
      assertThrowsMessage(
        () => buildSnapshotFilters({ depth: "bad" }),
        /Expected a finite number, got bad\./,
      );
    });

    it("formats snapshot IDs with normalized UTC timestamp text and six random characters", () => {
      assert.equal(createSnapshotId(new Date(GENERATED_AT), "abc123"), SNAPSHOT_ID);
    });
  });

  describe("accessibility normalization and projection", () => {
    it("normalizes accessibility roles, frames, and default action sets", () => {
      assert.equal(normalizeAccessibilityRole("AXStaticText"), "text");
      assert.equal(normalizeAccessibilityRole("AXButton"), "button");
      assert.equal(normalizeAccessibilityRole("AXTextField"), "textbox");
      assert.equal(normalizeAccessibilityRole("textbox"), "textbox");
      assert.equal(normalizeAccessibilityRole("AXSwitch"), "switch");
      assert.equal(normalizeAccessibilityRole("AXLink"), "link");
      assert.equal(normalizeAccessibilityRole("AXImage"), "image");
      assert.equal(normalizeAccessibilityRole(null), null);

      assert.deepEqual(normalizeFrame({ x: "10", y: 20, width: "30", height: 40 }), {
        x: 10,
        y: 20,
        width: 30,
        height: 40,
      });
      assert.deepEqual(normalizeFrame({ left: 1, top: 2, width: 3, height: 4 }), {
        x: 1,
        y: 2,
        width: 3,
        height: 4,
      });
      assert.equal(normalizeFrame({ x: 1, y: 2, width: "wide", height: 4 }), null);
      assert.equal(normalizeFrame(null), null);

      assert.deepEqual(actionsForAccessibilityRole("button"), ["tap", "inspect"]);
      assert.deepEqual(actionsForAccessibilityRole("link"), ["tap", "inspect"]);
      assert.deepEqual(actionsForAccessibilityRole("textbox"), ["tap", "fill", "focus", "inspect"]);
      assert.deepEqual(actionsForAccessibilityRole("switch"), ["tap", "inspect"]);
      assert.deepEqual(actionsForAccessibilityRole("image"), []);
    });

    it("flattens trees in pre-order and applies depth, interactive-only, and compact filters", () => {
      const tree = {
        role: "AXWindow",
        name: "AppRoot",
        children: [
          {
            role_description: "AXButton",
            AXLabel: "Add customer",
            frame: { x: 10, y: 20, width: 120, height: 44 },
            source: { fileName: "src/AddCustomer.tsx", lineNumber: "12", columnNumber: 5 },
          },
          {
            role: "AXStaticText",
            AXLabel: "Customers",
            children: [{ role: "AXImage" }],
          },
        ],
      };

      assert.deepEqual(
        flattenAccessibilityNodes(tree, ALL_FILTERS).map((node) => ({
          role: node.role,
          label: node.label,
          text: node.text,
          actions: node.actions,
        })),
        [
          { role: "window", label: null, text: null, actions: [] },
          { role: "button", label: "Add customer", text: null, actions: ["tap", "inspect"] },
          { role: "text", label: "Customers", text: "Customers", actions: [] },
          { role: "image", label: null, text: null, actions: [] },
        ],
      );

      assert.deepEqual(
        flattenAccessibilityNodes(tree, { ...ALL_FILTERS, depth: 0 }).map((node) => node.role),
        ["window"],
      );
      assert.deepEqual(
        flattenAccessibilityNodes(tree, { ...ALL_FILTERS, interactiveOnly: true }).map((node) => node.label),
        ["Add customer"],
      );
      assert.deepEqual(
        flattenAccessibilityNodes(tree, { ...ALL_FILTERS, compact: true }).map((node) => node.role),
        ["button", "text"],
      );
    });

    it("projects accessibility nodes into refs and snapshot tree nodes with source and bounds flags", () => {
      const node = flattenAccessibilityNodes({
        role: "AXButton",
        AXLabel: "Add customer",
        placeholder: "Name",
        testId: "add-button",
        nativeID: "native-add",
        component: "AddCustomerButton",
        frame: { left: 10, top: 20, width: 120, height: 44 },
        source: { file: "src/AddCustomer.tsx", line: "12", column: "5" },
      }, ALL_FILTERS)[0];

      if (!node) throw new Error("fixture did not produce a node");

      assert.deepEqual(normalizeSource(node.source), {
        file: "src/AddCustomer.tsx",
        line: 12,
        column: 5,
      });
      assert.deepEqual(refRecordFromNode(node, 1, SNAPSHOT_ID, "target-1", ALL_FILTERS), {
        ref: "@e1",
        snapshotId: SNAPSHOT_ID,
        targetId: "target-1",
        stale: false,
        role: "button",
        label: "Add customer",
        text: null,
        placeholder: "Name",
        testID: "add-button",
        nativeID: "native-add",
        component: "AddCustomerButton",
        source: { file: "src/AddCustomer.tsx", line: 12, column: 5 },
        box: { x: 10, y: 20, width: 120, height: 44 },
        actions: ["tap", "inspect"],
      });
      assert.deepEqual(snapshotNodeFromAccessibility(node, "@e1", { ...ALL_FILTERS, includeSource: false, includeBounds: false }), {
        ref: "@e1",
        role: "button",
        label: "Add customer",
        text: null,
        testID: "add-button",
        source: null,
        box: null,
        actions: ["tap", "inspect"],
      });
    });
  });

  describe("semantic bridge normalization", () => {
    it("normalizes semantic refs, derives fallback fields, redacts raw secrets, and applies filters", () => {
      const refs = normalizeSemanticBridgeRefs([
        {
          type: "AXButton",
          name: "Add customer",
          value: "Add",
          nativeID: "native-add",
          component: "AddCustomerButton",
          source: { fileName: "src/AddCustomer.tsx", lineNumber: 12 },
          frame: { left: 10, top: 20, width: 120, height: 44 },
          raw: {
            url: "https://example.test/path?token=secret-token&ok=1",
            authorization: "Bearer secret-token",
          },
        },
        {
          role: "AXImage",
          raw: { password: "secret" },
        },
      ], ALL_FILTERS);

      assert.deepEqual(refs, [
        {
          role: "button",
          label: "Add customer",
          text: "Add",
          placeholder: null,
          testID: "native-add",
          nativeID: "native-add",
          component: "AddCustomerButton",
          source: { fileName: "src/AddCustomer.tsx", lineNumber: 12 },
          box: { x: 10, y: 20, width: 120, height: 44 },
          actions: ["tap", "inspect"],
          disabled: false,
          raw: {
            url: "https://example.test/path?token=[redacted]&ok=1",
            authorization: "[redacted]",
          },
        },
        {
          role: "image",
          label: null,
          text: null,
          placeholder: null,
          testID: null,
          nativeID: null,
          component: null,
          source: null,
          box: null,
          actions: [],
          disabled: false,
          raw: { password: "[redacted]" },
        },
      ]);

      assert.deepEqual(
        normalizeSemanticBridgeRefs(refs, { ...ALL_FILTERS, interactiveOnly: true }).map((record) => record.label),
        ["Add customer"],
      );
      assert.deepEqual(
        normalizeSemanticBridgeRefs(refs, { ...ALL_FILTERS, compact: true }).map((record) => record.label),
        ["Add customer"],
      );
      assert.deepEqual(normalizeSemanticBridgeRefs({ not: "an array" }, ALL_FILTERS), []);
    });
  });

  describe("RULE-015 snapshot persistence", () => {
    it("persists native accessibility snapshots, latest refs cache, and session lastSnapshotId", async () => {
      const store = persistenceDeps();
      const result = await persistNativeSnapshot({
        stateRoot: STATE_ROOT,
        session: session({ activeTargetId: "target-1" }),
        filters: ALL_FILTERS,
        semanticBridge: { available: false, source: "plugin-bridge-semantic", code: "missing-domain" },
        accessibilityTree: {
          role: "AXButton",
          AXLabel: "Add customer",
          frame: { x: 10, y: 20, width: 120, height: 44 },
          source: { fileName: "src/AddCustomer.tsx", lineNumber: 12, columnNumber: 5 },
        },
      }, store);

      assert.equal(result.snapshotId, SNAPSHOT_ID);
      assert.deepEqual(result.source, ["native-accessibility"]);
      assert.equal(result.targetId, "target-1");
      assert.equal(result.routeHint, null);
      assert.equal(result.generatedAt, GENERATED_AT);
      assert.deepEqual(result.refs.map((record) => record.ref), ["@e1"]);
      assert.deepEqual(result.tree, [
        {
          ref: "@e1",
          role: "button",
          label: "Add customer",
          text: null,
          testID: null,
          source: { file: "src/AddCustomer.tsx", line: 12, column: 5 },
          box: { x: 10, y: 20, width: 120, height: 44 },
          actions: ["tap", "inspect"],
        },
      ]);
      assert.deepEqual(result.artifacts, {
        json: `${STATE_ROOT}/sessions/review-1/snapshots/${SNAPSHOT_ID}.json`,
        screenshot: null,
        annotatedScreenshot: null,
      });
      assert.deepEqual(store.createdDirectories, [`${STATE_ROOT}/sessions/review-1/snapshots`]);
      assert.deepEqual(store.writes[`${STATE_ROOT}/sessions/review-1/snapshots/${SNAPSHOT_ID}.json`], result);
      assert.deepEqual(store.writes[`${STATE_ROOT}/sessions/review-1/refs.json`], {
        snapshotId: SNAPSHOT_ID,
        targetId: "target-1",
        source: ["native-accessibility"],
        semanticBridge: { available: false, source: "plugin-bridge-semantic", code: "missing-domain" },
        refs: result.refs,
      });
      assert.equal(store.updatedSession?.lastSnapshotId, SNAPSHOT_ID);
      assert.equal(store.updatedSession?.updatedAt, GENERATED_AT);
    });

    it("persists semantic snapshots by rewriting refs to current snapshot and target", async () => {
      const store = persistenceDeps();
      const bridge: SemanticBridgeSnapshot = {
        available: true,
        source: "plugin-bridge-semantic",
        bridgeVersion: "1.0.0",
        routeHint: "/customers",
        refs: [
          {
            ref: "@old",
            snapshotId: "old-snapshot",
            targetId: "old-target",
            stale: true,
            role: "button",
            label: "Add customer",
            text: null,
            placeholder: null,
            testID: "add-button",
            nativeID: null,
            component: "AddCustomerButton",
            source: { file: "src/AddCustomer.tsx", line: 12, column: 5 },
            box: { x: 10, y: 20, width: 120, height: 44 },
            actions: ["tap", "inspect"],
            disabled: true,
            raw: { authorization: "[redacted]" },
          },
        ],
        limitations: ["Semantic bridge data is app-defined."],
      };

      const result = await persistSemanticSnapshot({
        stateRoot: STATE_ROOT,
        session: session({ activeTargetId: "target-1" }),
        filters: ALL_FILTERS,
        semanticBridge: bridge,
      }, store);

      assert.equal(result.snapshotId, SNAPSHOT_ID);
      assert.equal(result.routeHint, "/customers");
      assert.deepEqual(result.source, ["plugin-bridge-semantic"]);
      assert.deepEqual(result.refs, [
        {
          ref: "@e1",
          snapshotId: SNAPSHOT_ID,
          targetId: "target-1",
          stale: false,
          role: "button",
          label: "Add customer",
          text: null,
          placeholder: null,
          testID: "add-button",
          nativeID: null,
          component: "AddCustomerButton",
          source: { file: "src/AddCustomer.tsx", line: 12, column: 5 },
          box: { x: 10, y: 20, width: 120, height: 44 },
          actions: ["tap", "inspect"],
          disabled: true,
          raw: { authorization: "[redacted]" },
        },
      ]);
      assert.deepEqual(result.tree, [
        {
          ref: "@e1",
          role: "button",
          label: "Add customer",
          text: null,
          testID: "add-button",
          source: { file: "src/AddCustomer.tsx", line: 12, column: 5 },
          box: { x: 10, y: 20, width: 120, height: 44 },
          actions: ["tap", "inspect"],
        },
      ]);
      assert.deepEqual(store.writes[`${STATE_ROOT}/sessions/review-1/refs.json`], {
        snapshotId: SNAPSHOT_ID,
        targetId: "target-1",
        source: ["plugin-bridge-semantic"],
        semanticBridge: bridge,
        refs: result.refs,
      });
      assert.equal(store.updatedSession?.lastSnapshotId, SNAPSHOT_ID);
      assert.equal(store.updatedSession?.updatedAt, GENERATED_AT);
    });
  });

  describe("refsCommand and getRefCommand", () => {
    it("reports missing latest ref cache with the legacy unavailable envelope", async () => {
      assert.deepEqual(
        await refsCommand({ stateRoot: STATE_ROOT }, refDeps({ session: session({ lastSnapshotId: null }), cache: null })),
        { available: false, reason: "No snapshot exists for the current session." },
      );
      assert.deepEqual(
        await getRefCommand({ stateRoot: STATE_ROOT, ref: "@e1", field: "text" }, refDeps({ session: null, cache: null })),
        { available: false, reason: "No snapshot exists for the current session." },
      );
    });

    it("returns the latest refs cache when present", async () => {
      const cache = refCache();

      assert.deepEqual(
        await refsCommand({ stateRoot: STATE_ROOT }, refDeps({ session: session({ lastSnapshotId: SNAPSHOT_ID }), cache })),
        { available: true, ...cache },
      );
    });

    it("validates ref shape and missing refs before reading fields", async () => {
      const cache = refCache();

      await assert.rejects(
        async () => getRefCommand({ stateRoot: STATE_ROOT, ref: "", field: "text" }, refDeps({ session: session({ lastSnapshotId: SNAPSHOT_ID }), cache })),
        /ref is required\./,
      );
      await assert.rejects(
        async () => getRefCommand({ stateRoot: STATE_ROOT, ref: "@e1", field: "" }, refDeps({ session: session({ lastSnapshotId: SNAPSHOT_ID }), cache })),
        /field is required\./,
      );
      assert.deepEqual(
        await getRefCommand({ stateRoot: STATE_ROOT, ref: "e1", field: "text" }, refDeps({ session: session({ lastSnapshotId: SNAPSHOT_ID }), cache })),
        { available: false, reason: "Ref must look like @e1.", ref: "e1" },
      );
      assert.deepEqual(
        await getRefCommand({ stateRoot: STATE_ROOT, ref: "@e9", field: "text" }, refDeps({ session: session({ lastSnapshotId: SNAPSHOT_ID }), cache })),
        { available: false, reason: "Ref not found in the latest snapshot.", ref: "@e9" },
      );
    });

    it("returns ref field values for text fallback, props, box, style, and source", async () => {
      const cache = refCache();
      const deps = refDeps({ session: session({ lastSnapshotId: SNAPSHOT_ID }), cache });

      assert.deepEqual(await getRefCommand({ stateRoot: STATE_ROOT, ref: "@e1", field: "text" }, deps), {
        ref: "@e1",
        field: "text",
        stale: false,
        value: "Add customer",
      });
      assert.deepEqual(await getRefCommand({ stateRoot: STATE_ROOT, ref: "@e1", field: "props" }, deps), {
        ref: "@e1",
        field: "props",
        stale: false,
        value: {
          role: "button",
          label: "Add customer",
          placeholder: "Name",
          testID: "add-button",
          nativeID: null,
          component: "AddCustomerButton",
          actions: ["tap", "inspect"],
        },
      });
      assert.deepEqual(refFieldValue(cache.refs[0] as RefRecord, "box"), { x: 10, y: 20, width: 120, height: 44 });
      assert.deepEqual(refFieldValue(cache.refs[0] as RefRecord, "source"), { file: "src/AddCustomer.tsx", line: 12, column: 5 });
      assert.equal(refFieldValue(cache.refs[0] as RefRecord, "style"), null);
      assertThrowsMessage(
        () => refFieldValue(cache.refs[0] as RefRecord, "raw"),
        /Unknown ref field: raw/,
      );
    });
  });
});

function assertThrowsMessage(fn: () => unknown, expected: RegExp): void {
  try {
    fn();
  } catch (error) {
    assert.equal(expected.test(error instanceof Error ? error.message : String(error)), true);
    return;
  }
  throw new Error(`Expected error matching ${expected.source}`);
}

function session(overrides: Partial<SessionRecord>): SessionRecord {
  return {
    schemaVersion: 1,
    sessionId: "review-1",
    name: "review",
    artifactDir: `${STATE_ROOT}/sessions/review-1/artifacts`,
    createdAt: "2026-05-23T16:00:00.000Z",
    updatedAt: "2026-05-23T16:00:00.000Z",
    activeTargetId: "target-1",
    lastSnapshotId: null,
    sidecars: [],
    ...overrides,
  };
}

function selectedTarget(): TargetRecord {
  return {
    targetId: "target-1",
    platform: "ios",
    device: { id: "SIM-1", name: "iPhone 15", state: "booted" },
    app: { bundleId: "com.example.fixture", processName: "fixture", running: null },
    metro: { port: 8081, status: "available", targetId: "metro-1", title: "Fixture", appId: "com.example.fixture", debuggerUrl: "ws://debugger" },
    selected: true,
    stale: false,
  };
}

function persistenceDeps(): SnapshotPersistenceDependencies & {
  createdDirectories: string[];
  writes: Record<string, unknown>;
  updatedSession?: SessionRecord;
} {
  const store: SnapshotPersistenceDependencies & {
    createdDirectories: string[];
    writes: Record<string, unknown>;
    updatedSession?: SessionRecord;
  } = {
    createdDirectories: [],
    writes: {},
    now() {
      return new Date(GENERATED_AT);
    },
    randomSuffix() {
      return "abc123";
    },
    async ensureDirectory(path) {
      store.createdDirectories.push(path);
    },
    async writeJsonFile(path, value) {
      store.writes[path] = value;
    },
    async updateSessionRecord(_stateRoot, record) {
      store.updatedSession = record;
      return record;
    },
  };
  return store;
}

function snapshotDeps(input: {
  session: SessionRecord | null;
  target: TargetRecord | null;
}): SnapshotCommandDependencies & {
  createdDirectories: string[];
  writes: Record<string, unknown>;
  updatedSession?: SessionRecord;
} {
  const store = {
    ...persistenceDeps(),
    async readLatestSession() {
      return input.session;
    },
    async readSelectedTarget() {
      return input.target;
    },
    async captureSemanticBridge() {
      return { available: false as const, source: "plugin-bridge-semantic", code: "missing-domain" };
    },
    async findAxeCli() {
      return null;
    },
    async describeNativeUi() {
      return { stdout: "[]", stderr: "" };
    },
  };
  return store;
}

function refCache(): RefCache {
  return {
    snapshotId: SNAPSHOT_ID,
    targetId: "target-1",
    source: ["native-accessibility"],
    semanticBridge: { available: false, source: "plugin-bridge-semantic" },
    refs: [
      {
        ref: "@e1",
        snapshotId: SNAPSHOT_ID,
        targetId: "target-1",
        stale: false,
        role: "button",
        label: "Add customer",
        text: null,
        placeholder: "Name",
        testID: "add-button",
        nativeID: null,
        component: "AddCustomerButton",
        source: { file: "src/AddCustomer.tsx", line: 12, column: 5 },
        box: { x: 10, y: 20, width: 120, height: 44 },
        actions: ["tap", "inspect"],
      },
    ],
  };
}

function refDeps(input: {
  session: SessionRecord | null;
  cache: RefCache | null;
}): RefCommandDependencies {
  return {
    async readLatestSession() {
      return input.session;
    },
    async readJsonFile() {
      if (!input.cache) throw new Error("missing refs.json");
      return input.cache;
    },
  };
}
