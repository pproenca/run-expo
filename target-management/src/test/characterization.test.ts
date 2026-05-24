import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  clampMetroPort,
  discoverTargets,
  getCurrentTarget,
  normalizeMetroTargets,
  normalizeDeviceState,
  processNameFromBundleId,
  stableIdPart,
  targetCommand,
  targetRecord,
} from "../main/index.js";
import type { DeviceSummary, MetroTarget, SessionRecord, TargetDependencies, TargetRecord } from "../main/index.js";

const STATE_ROOT = "/work/app/.scratch/expo-ios";
const UPDATED_AT = "2026-05-23T17:00:00.000Z";

const IPHONE_15: DeviceSummary = { id: "SIM-1", name: "iPhone 15", state: "booted" };
const IPHONE_16: DeviceSummary = { id: "SIM-2", name: "iPhone 16", state: "shutdown" };
const IPHONE_14: DeviceSummary = { id: "SIM-3", name: "iPhone 14", state: "booted" };

const METRO_FIXTURE: MetroTarget = {
  id: "metro-1",
  title: "Fixture App",
  appId: "com.example.fixture",
  webSocketDebuggerUrl: "ws://127.0.0.1:19000/debugger",
  deviceName: "iPhone 15",
};

describe("target-management legacy characterization", () => {
  describe("target record calculations", () => {
    it("RULE-009 normalizes simulator device states using legacy state names", () => {
      assert.equal(normalizeDeviceState("Booted"), "booted");
      assert.equal(normalizeDeviceState("Shutdown"), "shutdown");
      assert.equal(normalizeDeviceState("connected"), "connected");
      assert.equal(normalizeDeviceState("Creating"), "unknown");
      assert.equal(normalizeDeviceState(null), "unknown");
    });

    it("RULE-009 creates stable ID parts by lowercasing, dash-collapsing, trimming, and falling back to unknown", () => {
      assert.equal(stableIdPart(" iPhone 15 Pro (A) "), "iphone-15-pro-a");
      assert.equal(stableIdPart("com.example.fixture"), "com.example.fixture");
      assert.equal(stableIdPart("!!!"), "unknown");
      assert.equal(stableIdPart(null), "unknown");
    });

    it("RULE-009 derives process names from bundle IDs using the final sanitized segment", () => {
      assert.equal(processNameFromBundleId("com.example.fixture-app"), "fixture-app");
      assert.equal(processNameFromBundleId("com.example.$bad"), "bad");
      assert.equal(processNameFromBundleId("..."), null);
      assert.equal(processNameFromBundleId(null), null);
    });

    it("RULE-009 clamps Metro ports to the legacy 1..65535 range", () => {
      assert.equal(clampMetroPort(undefined), 8081);
      assert.equal(clampMetroPort(0), 1);
      assert.equal(clampMetroPort(70_000), 65_535);
      assert.equal(clampMetroPort("19000"), 19_000);
    });

    it("RULE-009 rejects non-finite Metro ports with the legacy error message", async () => {
      await assert.rejects(
        async () => clampMetroPort("nope"),
        /Expected a finite number, got nope\./,
      );
    });

    it("RULE-009 builds available target records from device and Metro metadata", () => {
      const record = targetRecord({
        platform: "ios",
        device: IPHONE_15,
        metroPort: 19_000,
        metroTarget: METRO_FIXTURE,
        selectedTargetId: "ios:sim-1:com.example.fixture:19000",
      });

      assert.deepEqual(record, {
        targetId: "ios:sim-1:com.example.fixture:19000",
        platform: "ios",
        device: IPHONE_15,
        app: {
          bundleId: "com.example.fixture",
          processName: "fixture",
          running: null,
        },
        metro: {
          port: 19_000,
          status: "available",
          targetId: "metro-1",
          title: "Fixture App",
          appId: "com.example.fixture",
          debuggerUrl: "ws://127.0.0.1:19000/debugger",
        },
        selected: true,
        stale: false,
      });
    });

    it("RULE-009 builds unavailable no-runtime records when no Metro target matches", () => {
      assert.deepEqual(
        targetRecord({
          platform: "ios",
          device: IPHONE_16,
          metroPort: 8081,
          metroTarget: null,
          selectedTargetId: null,
        }),
        {
          targetId: "ios:sim-2:no-runtime:no-metro",
          platform: "ios",
          device: IPHONE_16,
          app: {
            bundleId: null,
            processName: null,
            running: null,
          },
          metro: {
            port: null,
            status: "unavailable",
            targetId: null,
            title: null,
            appId: null,
            debuggerUrl: null,
          },
          selected: false,
          stale: false,
        },
      );
    });
  });

  describe("target discovery", () => {
    it("RULE-009 discovers iOS targets, filters Metro targets by deviceName, and sorts selected/available/name", async () => {
      const selectedTargetId = "ios:sim-3:com.example.third:8081";
      const targets = await discoverTargets(
        { platform: "ios", selectedTargetId },
        deps({
          session: null,
          devices: [IPHONE_16, IPHONE_15, IPHONE_14],
          metroTargets: [
            METRO_FIXTURE,
            {
              id: "metro-3",
              title: "Third App",
              appId: "com.example.third",
              webSocketDebuggerUrl: "ws://third",
              deviceName: "iPhone 14",
            },
            {
              id: "metro-global",
              title: "Global App",
              appId: "com.example.global",
              webSocketDebuggerUrl: "ws://global",
            },
          ],
        }),
      );

      assert.deepEqual(
        targets.map((target) => ({
          id: target.targetId,
          selected: target.selected,
          metro: target.metro.status,
          device: target.device.name,
        })),
        [
          { id: selectedTargetId, selected: true, metro: "available", device: "iPhone 14" },
          { id: "ios:sim-3:com.example.global:8081", selected: false, metro: "available", device: "iPhone 14" },
          { id: "ios:sim-1:com.example.fixture:8081", selected: false, metro: "available", device: "iPhone 15" },
          { id: "ios:sim-1:com.example.global:8081", selected: false, metro: "available", device: "iPhone 15" },
          { id: "ios:sim-2:com.example.global:8081", selected: false, metro: "available", device: "iPhone 16" },
        ],
      );
    });

    it("RULE-009 returns no targets for non-iOS platform in the legacy implementation", async () => {
      const targets = await discoverTargets(
        { platform: "android" },
        deps({ session: null, devices: [IPHONE_15], metroTargets: [METRO_FIXTURE] }),
      );

      assert.deepEqual(targets, []);
    });

    it("RULE-009 treats malformed Metro target payloads as an empty list", async () => {
      const targets = await discoverTargets(
        { platform: "all", metroPort: 19_000 },
        deps({ session: null, devices: [IPHONE_15], metroTargets: { not: "an array" } }),
      );

      assert.deepEqual(targets.map((target) => target.targetId), ["ios:sim-1:no-runtime:no-metro"]);
    });

    it("RULE-009 normalizes malformed Metro array entries at the adapter boundary", () => {
      assert.deepEqual(
        normalizeMetroTargets([
          null,
          42,
          "bad",
          {
            id: 99,
            title: "Fixture",
            appId: "com.example.fixture",
            webSocketDebuggerUrl: {},
            deviceName: "iPhone 15",
          },
        ]),
        [
          {
            id: null,
            title: "Fixture",
            appId: "com.example.fixture",
            webSocketDebuggerUrl: null,
            deviceName: "iPhone 15",
          },
        ],
      );
    });
  });

  describe("target command lifecycle", () => {
    it("RULE-009 lists targets with availability based on discovered targets", async () => {
      assert.deepEqual(
        await targetCommand(
          { action: "list", stateRoot: STATE_ROOT },
          deps({ session: null, devices: [IPHONE_15], metroTargets: [METRO_FIXTURE] }),
        ),
        {
          available: true,
          targets: [
            targetRecord({
              platform: "ios",
              device: IPHONE_15,
              metroPort: 8081,
              metroTarget: METRO_FIXTURE,
              selectedTargetId: null,
            }),
          ],
        },
      );

      assert.deepEqual(
        await targetCommand(
          { action: "list", stateRoot: STATE_ROOT, platform: "android" },
          deps({ session: null, devices: [IPHONE_15], metroTargets: [METRO_FIXTURE] }),
        ),
        { available: false, targets: [] },
      );
    });

    it("RULE-009 blocks select/current when no session exists", async () => {
      assert.deepEqual(
        await targetCommand(
          { action: "select", targetId: "ios:sim-1:com.example.fixture:8081", stateRoot: STATE_ROOT },
          deps({ session: null, devices: [IPHONE_15], metroTargets: [METRO_FIXTURE] }),
        ),
        {
          available: false,
          reason: "No session exists. Run `expo-ios --json session new review` first.",
        },
      );
      assert.deepEqual(
        await getCurrentTarget(
          { stateRoot: STATE_ROOT },
          deps({ session: null, devices: [IPHONE_15], metroTargets: [METRO_FIXTURE] }),
        ),
        {
          available: false,
          reason: "No session exists. Run `expo-ios --json session new review` first.",
        },
      );
    });

    it("RULE-009 selects a discovered target, updates session activeTargetId, and persists target metadata", async () => {
      const store = deps({
        session: session({ activeTargetId: null }),
        devices: [IPHONE_15],
        metroTargets: [METRO_FIXTURE],
      });
      const targetId = "ios:sim-1:com.example.fixture:8081";

      const selected = await targetCommand(
        { action: "select", targetId, stateRoot: STATE_ROOT, now: fixedClock(UPDATED_AT) },
        store,
      );

      assert.deepEqual(selected, {
        ...targetRecord({
          platform: "ios",
          device: IPHONE_15,
          metroPort: 8081,
          metroTarget: METRO_FIXTURE,
          selectedTargetId: null,
        }),
        selected: true,
        stale: false,
      });
      assert.equal(store.updatedSession?.activeTargetId, targetId);
      assert.equal(store.updatedSession?.updatedAt, UPDATED_AT);
      assert.deepEqual(store.persistedTarget, selected);
    });

    it("RULE-009 returns discovered targets when requested target is missing", async () => {
      const store = deps({
        session: session({ activeTargetId: null }),
        devices: [IPHONE_15],
        metroTargets: [METRO_FIXTURE],
      });

      const result = await targetCommand(
        { action: "select", targetId: "missing", stateRoot: STATE_ROOT },
        store,
      );

      assert.deepEqual(result, {
        available: false,
        reason: "Target not found.",
        targetId: "missing",
        targets: [
          targetRecord({
            platform: "ios",
            device: IPHONE_15,
            metroPort: 8081,
            metroTarget: METRO_FIXTURE,
            selectedTargetId: null,
          }),
        ],
      });
    });

    it("RULE-009 reports current target when rediscovered and marks it selected/non-stale", async () => {
      const targetId = "ios:sim-1:com.example.fixture:8081";
      const result = await targetCommand(
        { action: "current", stateRoot: STATE_ROOT },
        deps({
          session: session({ activeTargetId: targetId }),
          devices: [IPHONE_15],
          metroTargets: [METRO_FIXTURE],
        }),
      );

      assert.deepEqual(result, {
        available: true,
        sessionId: "review-1",
        target: {
          ...targetRecord({
            platform: "ios",
            device: IPHONE_15,
            metroPort: 8081,
            metroTarget: METRO_FIXTURE,
            selectedTargetId: targetId,
          }),
          selected: true,
          stale: false,
        },
      });
    });

    it("RULE-009 reports no selected target for current when session activeTargetId is absent", async () => {
      assert.deepEqual(
        await targetCommand(
          { action: "current", stateRoot: STATE_ROOT },
          deps({ session: session({ activeTargetId: null }), devices: [IPHONE_15], metroTargets: [METRO_FIXTURE] }),
        ),
        {
          available: false,
          reason: "No target selected for the current session.",
          sessionId: "review-1",
        },
      );
    });

    it("RULE-009 marks selected target stale and returns persisted metadata when rediscovery misses it", async () => {
      const targetId = "ios:sim-1:com.example.fixture:8081";
      const persisted = targetRecord({
        platform: "ios",
        device: IPHONE_15,
        metroPort: 8081,
        metroTarget: METRO_FIXTURE,
        selectedTargetId: targetId,
      });

      assert.deepEqual(
        await targetCommand(
          { action: "current", stateRoot: STATE_ROOT, platform: "android" },
          deps({
            session: session({ activeTargetId: targetId }),
            devices: [IPHONE_15],
            metroTargets: [METRO_FIXTURE],
            persistedTarget: persisted,
          }),
        ),
        {
          available: false,
          reason: "Selected target is stale.",
          sessionId: "review-1",
          target: { ...persisted, selected: true, stale: true },
        },
      );
    });

    it("RULE-009 marks selected target stale with a minimal record when no persisted metadata exists", async () => {
      assert.deepEqual(
        await targetCommand(
          { action: "current", stateRoot: STATE_ROOT, platform: "android" },
          deps({
            session: session({ activeTargetId: "ios:missing" }),
            devices: [IPHONE_15],
            metroTargets: [METRO_FIXTURE],
          }),
        ),
        {
          available: false,
          reason: "Selected target is stale.",
          sessionId: "review-1",
          target: { targetId: "ios:missing", selected: true, stale: true },
        },
      );
    });

    it("RULE-009 rejects unknown target actions with the legacy message", async () => {
      await assert.rejects(
        async () => targetCommand(
          { action: "delete", stateRoot: STATE_ROOT },
          deps({ session: null, devices: [], metroTargets: [] }),
        ),
        /Unknown target action: delete/,
      );
    });
  });
});

function fixedClock(iso: string): () => Date {
  return () => new Date(iso);
}

function session(overrides: Partial<SessionRecord>): SessionRecord {
  return {
    schemaVersion: 1,
    sessionId: "review-1",
    name: "review",
    artifactDir: `${STATE_ROOT}/sessions/review-1/artifacts`,
    createdAt: "2026-05-23T16:00:00.000Z",
    updatedAt: "2026-05-23T16:00:00.000Z",
    activeTargetId: null,
    lastSnapshotId: null,
    sidecars: [],
    ...overrides,
  };
}

function deps(input: {
  session: SessionRecord | null;
  devices: DeviceSummary[];
  metroTargets: unknown;
  persistedTarget?: TargetRecord | null;
}): TargetDependencies & { updatedSession?: SessionRecord; persistedTarget?: TargetRecord } {
  const store: TargetDependencies & { updatedSession?: SessionRecord; persistedTarget?: TargetRecord } = {
    persistedTarget: input.persistedTarget ?? undefined,
    async readLatestSession() {
      return input.session;
    },
    async updateSessionRecord(_stateRoot, record) {
      store.updatedSession = record;
      return record;
    },
    async readPersistedTarget() {
      return store.persistedTarget ?? null;
    },
    async writePersistedTarget(_stateRoot, _sessionId, target) {
      store.persistedTarget = target;
    },
    async listIosSimulatorTargets() {
      return input.devices;
    },
    async fetchMetroTargets() {
      return input.metroTargets;
    },
  };
  return store;
}
