import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  bridgeDomainPolicyPreview,
  bridgeHealthUnavailable,
  bridgeInstallPlan,
  bridgeMetadata,
  bridgeMutationRefusal,
  buildBridgeSource,
  computeBridgeInstallStatus,
  hasExplicitConfirmation,
  normalizeBridgeDomains,
  normalizeBridgeHealthValue,
  shouldRegisterBridge,
} from "../main/index.js";
import type { BridgeInstallStatus } from "../main/install-status.js";

const PROJECT_ROOT = "/work/expo-app";
const METADATA_PATH = `${PROJECT_ROOT}/.expo-ios/bridge.json`;
const SOURCE_PATH = `${PROJECT_ROOT}/src/expo-ios-devtools-bridge.ts`;

function expoPackageJson(extraDependencies = {}, extraDevDependencies = {}) {
  return {
    dependencies: { expo: "~52.0.0", ...extraDependencies },
    devDependencies: extraDevDependencies,
  };
}

function metadata(overrides = {}) {
  return { ...bridgeMetadata(), ...overrides };
}

function statusFixture(overrides: Partial<BridgeInstallStatus> = {}): BridgeInstallStatus {
  return {
    projectRoot: PROJECT_ROOT,
    state: "absent",
    bridgeVersion: null,
    expectedBridgeVersion: "1.0.0",
    developmentOnly: false,
    metadataPath: METADATA_PATH,
    sourcePath: SOURCE_PATH,
    files: { metadata: false, source: false },
    dependencies: { expo: "~52.0.0", rozenite: [] },
    issues: [],
    ...overrides,
  };
}

describe("bridge-installation legacy characterization", () => {
  describe("metadata", () => {
    it("RULE-006 exposes generated bridge metadata shape", () => {
      assert.deepEqual(bridgeMetadata(), {
        schemaVersion: 1,
        bridgeVersion: "1.0.0",
        developmentOnly: true,
        generatedBy: "expo-ios",
        domains: ["navigation", "network", "storage", "controls", "performance", "snapshot"],
      });
    });
  });

  describe("install status", () => {
    it("RULE-016 marks projects without expo as incompatible with missing-expo issue", () => {
      assert.deepEqual(
        computeBridgeInstallStatus({
          projectRoot: PROJECT_ROOT,
          packageJson: { dependencies: { react: "19.0.0" } },
          metadata: null,
          sourceExists: false,
        }),
        {
          projectRoot: PROJECT_ROOT,
          state: "incompatible",
          bridgeVersion: null,
          expectedBridgeVersion: "1.0.0",
          developmentOnly: false,
          metadataPath: METADATA_PATH,
          sourcePath: SOURCE_PATH,
          files: { metadata: false, source: false },
          dependencies: { expo: null, rozenite: [] },
          issues: [
            {
              code: "missing-expo",
              message: "The project does not declare expo, so an Expo DevTools bridge cannot be installed safely.",
            },
          ],
        },
      );
    });

    it("RULE-016 marks Expo projects with no bridge files as absent", () => {
      assert.deepEqual(
        computeBridgeInstallStatus({
          projectRoot: PROJECT_ROOT,
          packageJson: expoPackageJson(),
          metadata: null,
          sourceExists: false,
        }),
        statusFixture(),
      );
    });

    it("RULE-016 reports sorted rozenite packages without requiring them for status", () => {
      const status = computeBridgeInstallStatus({
        projectRoot: PROJECT_ROOT,
        packageJson: expoPackageJson(
          { "@rozenite/network-activity-plugin": "^1.2.0", zzz: "1.0.0" },
          { rozenite: "^0.8.0", "@rozenite/mmkv-plugin": "^2.0.0" },
        ),
        metadata: null,
        sourceExists: false,
      });

      assert.equal(status.state, "absent");
      assert.deepEqual(status.dependencies.rozenite, [
        { name: "@rozenite/mmkv-plugin", version: "^2.0.0" },
        { name: "@rozenite/network-activity-plugin", version: "^1.2.0" },
        { name: "rozenite", version: "^0.8.0" },
      ]);
    });

    it("RULE-016 marks metadata-only installs as stale partial-install", () => {
      const status = computeBridgeInstallStatus({
        projectRoot: PROJECT_ROOT,
        packageJson: expoPackageJson(),
        metadata: metadata(),
        sourceExists: false,
      });

      assert.equal(status.state, "stale");
      assert.equal(status.bridgeVersion, "1.0.0");
      assert.equal(status.developmentOnly, true);
      assert.deepEqual(status.files, { metadata: true, source: false });
      assert.deepEqual(status.issues, [
        { code: "partial-install", message: "Bridge metadata and source file are not both present." },
      ]);
    });

    it("RULE-016 marks source-only installs as stale partial-install", () => {
      const status = computeBridgeInstallStatus({
        projectRoot: PROJECT_ROOT,
        packageJson: expoPackageJson(),
        metadata: null,
        sourceExists: true,
      });

      assert.equal(status.state, "stale");
      assert.deepEqual(status.files, { metadata: false, source: true });
      assert.deepEqual(status.issues, [
        { code: "partial-install", message: "Bridge metadata and source file are not both present." },
      ]);
    });

    it("RULE-016 marks bridge version mismatch as stale version-mismatch", () => {
      const status = computeBridgeInstallStatus({
        projectRoot: PROJECT_ROOT,
        packageJson: expoPackageJson(),
        metadata: metadata({ bridgeVersion: "0.9.0" }),
        sourceExists: true,
      });

      assert.equal(status.state, "stale");
      assert.equal(status.bridgeVersion, "0.9.0");
      assert.deepEqual(status.issues, [
        { code: "version-mismatch", message: "Bridge version 0.9.0 does not match 1.0.0." },
      ]);
    });

    it("RULE-016 marks schema mismatch as stale version-mismatch", () => {
      const status = computeBridgeInstallStatus({
        projectRoot: PROJECT_ROOT,
        packageJson: expoPackageJson(),
        metadata: metadata({ schemaVersion: 2 }),
        sourceExists: true,
      });

      assert.equal(status.state, "stale");
      assert.deepEqual(status.issues, [
        { code: "version-mismatch", message: "Bridge version 1.0.0 does not match 1.0.0." },
      ]);
    });

    it("RULE-006 marks developmentOnly false metadata as incompatible", () => {
      const status = computeBridgeInstallStatus({
        projectRoot: PROJECT_ROOT,
        packageJson: expoPackageJson(),
        metadata: metadata({ developmentOnly: false }),
        sourceExists: true,
      });

      assert.equal(status.state, "incompatible");
      assert.equal(status.developmentOnly, false);
      assert.deepEqual(status.issues, [
        { code: "not-development-only", message: "Bridge metadata must declare developmentOnly: true." },
      ]);
    });

    it("RULE-016 marks matching metadata and source as present", () => {
      assert.deepEqual(
        computeBridgeInstallStatus({
          projectRoot: PROJECT_ROOT,
          packageJson: expoPackageJson(),
          metadata: metadata(),
          sourceExists: true,
        }),
        statusFixture({
          state: "present",
          bridgeVersion: "1.0.0",
          developmentOnly: true,
          files: { metadata: true, source: true },
        }),
      );
    });
  });

  describe("install and removal planning", () => {
    it("RULE-005 RULE-006 builds a mutation plan with confirmations and production exclusion", () => {
      assert.deepEqual(bridgeInstallPlan(PROJECT_ROOT, statusFixture()), {
        permissionRequired: true,
        requiredConfirmations: ["bridge-install", "bridge-remove"],
        developmentOnly: true,
        productionExclusion: [
          "Bridge code must be imported only from development-only app entrypoints or guarded by __DEV__.",
          "Production/release builds must not import src/expo-ios-devtools-bridge.ts.",
        ],
        filesToAddOrChange: [
          {
            path: METADATA_PATH,
            action: "add",
            purpose: "Versioned bridge metadata for stale/incompatible detection and removal.",
          },
          {
            path: SOURCE_PATH,
            action: "add",
            purpose: "Development-only Expo/Rozenite bridge registration shim.",
          },
        ],
        removalPlan: [
          { path: METADATA_PATH, action: "delete" },
          { path: SOURCE_PATH, action: "delete" },
        ],
        runtimeHealthCheckExpectations: [
          "Metro target is available.",
          "Hermes inspector is available.",
          "Bridge metadata version matches CLI expected version.",
          "App registers readable and writable domains separately.",
          "Mutation domains remain action-policy gated.",
        ],
        status: "absent",
        issues: [],
      });
    });

    it("RULE-005 plans updates when bridge files already exist", () => {
      const plan = bridgeInstallPlan(
        PROJECT_ROOT,
        statusFixture({
          state: "stale",
          files: { metadata: true, source: true },
          issues: [{ code: "version-mismatch", message: "Bridge version 0.9.0 does not match 1.0.0." }],
        }),
      );

      assert.deepEqual(
        plan.filesToAddOrChange.map((item) => item.action),
        ["update", "update"],
      );
      assert.equal(plan.status, "stale");
      assert.deepEqual(plan.issues, [
        { code: "version-mismatch", message: "Bridge version 0.9.0 does not match 1.0.0." },
      ]);
    });
  });

  describe("confirmation and mutation refusal", () => {
    it("RULE-005 trims comma-separated confirmation tokens", () => {
      assert.equal(hasExplicitConfirmation(" bridge-remove , bridge-install ", "bridge-install"), true);
      assert.equal(hasExplicitConfirmation("bridge-remove,bridge-health", "bridge-install"), false);
      assert.equal(hasExplicitConfirmation(null, "bridge-install"), false);
    });

    it("RULE-005 refuses install mutations without bridge-install confirmation", () => {
      const plan = bridgeInstallPlan(PROJECT_ROOT, statusFixture());

      assert.deepEqual(
        bridgeMutationRefusal({
          action: "install",
          confirmActions: "bridge-remove",
          status: statusFixture(),
          plan,
        }),
        {
          available: false,
          action: "install",
          status: "absent",
          projectRoot: PROJECT_ROOT,
          reason: "Refusing to mutate app files without explicit --confirm-actions bridge-install.",
          requiredConfirmation: "bridge-install",
          plan,
        },
      );
    });

    it("RULE-005 refuses remove mutations without bridge-remove confirmation", () => {
      const status = statusFixture({ state: "present" });
      const plan = bridgeInstallPlan(PROJECT_ROOT, status);

      assert.deepEqual(
        bridgeMutationRefusal({
          action: "remove",
          confirmActions: "bridge-install",
          status,
          plan,
        }),
        {
          available: false,
          action: "remove",
          status: "present",
          projectRoot: PROJECT_ROOT,
          reason: "Refusing to mutate app files without explicit --confirm-actions bridge-remove.",
          requiredConfirmation: "bridge-remove",
          plan,
        },
      );
    });

    it("RULE-005 returns null when mutation confirmation is explicit", () => {
      assert.equal(
        bridgeMutationRefusal({
          action: "install",
          confirmActions: " bridge-remove, bridge-install ",
          status: statusFixture(),
          plan: bridgeInstallPlan(PROJECT_ROOT, statusFixture()),
        }),
        null,
      );
    });
  });

  describe("runtime health normalization", () => {
    it("RULE-017 normalizes metadata version and app registration fields", () => {
      assert.deepEqual(
        normalizeBridgeHealthValue({
          available: true,
          metadata: { bridgeVersion: "1.0.0" },
          appRegistration: { registered: true, appId: "app-123", runtimeName: "Expo Go" },
          domains: [{ name: "navigation" }],
        }),
        {
          available: true,
          code: null,
          reason: null,
          registered: true,
          bridgeVersion: "1.0.0",
          appId: "app-123",
          runtimeName: "Expo Go",
          domains: [{ name: "navigation" }],
        },
      );
    });

    it("RULE-017 normalizes alternate version and top-level registration fields", () => {
      assert.deepEqual(
        normalizeBridgeHealthValue({
          available: false,
          code: "missing-app-registration",
          reason: "Bridge global exists but the app did not register domains.",
          registered: true,
          version: "0.9.0",
          appId: "direct-app",
          runtimeName: "Hermes",
          domains: "invalid",
        }),
        {
          available: false,
          code: "missing-app-registration",
          reason: "Bridge global exists but the app did not register domains.",
          registered: true,
          bridgeVersion: "0.9.0",
          appId: "direct-app",
          runtimeName: "Hermes",
          domains: [],
        },
      );
    });

    it("RULE-017 falls back to the CLI catalog when runtime domains are missing", () => {
      const domains = normalizeBridgeDomains([]);

      assert.deepEqual(
        domains.map((domain) => [domain.name, domain.source, domain.writable]),
        [
          ["navigation", "cli-catalog", true],
          ["network", "cli-catalog", true],
          ["storage", "cli-catalog", true],
          ["state", "cli-catalog", true],
          ["controls", "cli-catalog", true],
          ["performance", "cli-catalog", true],
          ["snapshot", "cli-catalog", false],
          ["rn", "cli-catalog", false],
        ],
      );
      assert.deepEqual(domains[0]!.readCommands, ["state"]);
      assert.deepEqual(domains[0]!.writeCommands, ["back", "pop-to-root", "tab", "deep-link"]);
      assert.deepEqual(domains[0]!.redactionBoundaries, ["route params", "query values"]);
    });

    it("RULE-017 applies runtime command overrides and appends unknown domains", () => {
      const domains = normalizeBridgeDomains([
        {
          name: "navigation",
          reads: [" current ", "state", "state"],
          writes: [" open ", "open"],
          redactionBoundaries: [" route params ", "route params"],
        },
        { name: "camera", readCommands: ["status"], writeCommands: ["capture"], available: false },
      ]);

      const navigation = domains.find((domain) => domain.name === "navigation");
      const camera = domains.find((domain) => domain.name === "camera");

      assert.deepEqual(navigation, {
        name: "navigation",
        available: true,
        readCommands: ["current", "state"],
        writeCommands: ["open"],
        writable: true,
        actionPolicyRequiredForWrites: true,
        redactionBoundaries: ["route params"],
        transport: "hermes-cdp Runtime.evaluate",
        source: "runtime-registration",
      });
      assert.deepEqual(camera, {
        name: "camera",
        available: false,
        readCommands: ["status"],
        writeCommands: ["capture"],
        writable: true,
        actionPolicyRequiredForWrites: true,
        redactionBoundaries: ["domain-defined values"],
        transport: "hermes-cdp Runtime.evaluate",
        source: "runtime-registration",
      });
      assert.equal(domains.at(-1)!.name, "camera");
    });

    it("RULE-017 reports stable unavailable health envelopes with domain counts", () => {
      const domains = normalizeBridgeDomains([]);
      const status = statusFixture({
        state: "incompatible",
        issues: [{ code: "missing-expo", message: "The project does not declare expo." }],
      });

      assert.deepEqual(
        bridgeHealthUnavailable({
          action: "health",
          code: "incompatible-project",
          reason: "The project does not declare expo.",
          status,
          install: {
            state: "incompatible",
            bridgeVersion: null,
            expectedBridgeVersion: "1.0.0",
            developmentOnly: false,
            files: status.files,
            dependencies: status.dependencies,
            issues: status.issues,
          },
          transport: {
            name: "metro-inspector-hermes-cdp",
            metroPort: 8081,
            inspectorEndpoint: "http://127.0.0.1:8081/json/list",
            protocol: "Runtime.evaluate",
            target: null,
            cdp: null,
          },
          domains,
          policy: null,
          plan: bridgeInstallPlan(PROJECT_ROOT, status),
        }),
        {
          available: false,
          health: "unavailable",
          appRegistration: { registered: false, appId: null, runtimeName: null },
          bridgeVersion: null,
          compatibleCliVersion: false,
          expectedBridgeVersion: "1.0.0",
          cliBridgeVersion: "1.0.0",
          domainCount: 8,
          writableDomainCount: 6,
          limitations: [
            "Bridge health requires Metro inspector access, a Hermes CDP target, and a development-only app bridge registration.",
          ],
          action: "health",
          code: "incompatible-project",
          reason: "The project does not declare expo.",
          status,
          install: {
            state: "incompatible",
            bridgeVersion: null,
            expectedBridgeVersion: "1.0.0",
            developmentOnly: false,
            files: status.files,
            dependencies: status.dependencies,
            issues: status.issues,
          },
          transport: {
            name: "metro-inspector-hermes-cdp",
            metroPort: 8081,
            inspectorEndpoint: "http://127.0.0.1:8081/json/list",
            protocol: "Runtime.evaluate",
            target: null,
            cdp: null,
          },
          domains,
          policy: null,
          plan: bridgeInstallPlan(PROJECT_ROOT, status),
        },
      );
    });
  });

  describe("domain policy preview", () => {
    it("RULE-017 allows read commands without an action policy", () => {
      assert.deepEqual(
        bridgeDomainPolicyPreview({ domain: "navigation", command: "state" }, normalizeBridgeDomains([])),
        {
          checked: true,
          allowed: true,
          denied: false,
          sideEffect: "read",
          reason: "Read command does not require action policy approval.",
          domain: "navigation",
          command: "state",
        },
      );
    });

    it("RULE-017 denies write commands without an action policy", () => {
      assert.deepEqual(
        bridgeDomainPolicyPreview({ domain: "navigation", command: "back" }, normalizeBridgeDomains([])),
        {
          checked: true,
          allowed: false,
          denied: true,
          sideEffect: "write",
          action: "navigation.back",
          reason: "No action policy allowed this bridge write command.",
          domain: "navigation",
          command: "back",
          actionPolicyRequired: true,
        },
      );
    });

    it("RULE-017 marks write commands pending when an action policy source is supplied", () => {
      assert.deepEqual(
        bridgeDomainPolicyPreview(
          { domain: "storage", command: "set", actionPolicy: "/work/policy.json" },
          normalizeBridgeDomains([]),
        ),
        {
          checked: true,
          allowed: null,
          denied: null,
          sideEffect: "write",
          action: "storage.set",
          reason: "Policy file will be evaluated before executing bridge write commands.",
          source: "/work/policy.json",
          domain: "storage",
          command: "set",
          actionPolicyRequired: true,
        },
      );
    });

    it("RULE-017 denies unknown domains", () => {
      assert.deepEqual(
        bridgeDomainPolicyPreview({ domain: "camera", command: "capture" }, normalizeBridgeDomains([])),
        {
          checked: true,
          allowed: false,
          denied: true,
          reason: "Unknown bridge domain camera.",
          domain: "camera",
          command: "capture",
        },
      );
    });

    it("RULE-017 denies unknown commands for known domains", () => {
      assert.deepEqual(
        bridgeDomainPolicyPreview({ domain: "navigation", command: "teleport" }, normalizeBridgeDomains([])),
        {
          checked: true,
          allowed: false,
          denied: true,
          reason: "Unknown bridge command teleport for domain navigation.",
          domain: "navigation",
          command: "teleport",
        },
      );
    });
  });

  describe("generated source production guard", () => {
    it("RULE-006 generated bridge source fails closed unless development mode is explicit", () => {
      const source = buildBridgeSource();

      assert.match(source, /if \(typeof __DEV__ === "undefined"\) return \{ registered: false, reason: "development-mode-required" \}/);
      assert.match(source, /if \(!__DEV__\) return \{ registered: false, reason: "production-build" \}/);
      assert.match(source, /return \{ registered: false, reason: "production-build" \}/);
      assert.match(source, /globalThis\.__EXPO_IOS_DEVTOOLS_BRIDGE__ = bridge/);
    });

    it("RULE-006 transformed registration guard fails closed unless development mode is explicit", () => {
      assert.deepEqual(shouldRegisterBridge({ dev: true }), { registered: true });
      assert.deepEqual(shouldRegisterBridge({ dev: false }), { registered: false, reason: "production-build" });
      assert.deepEqual(shouldRegisterBridge({ dev: undefined }), { registered: false, reason: "development-mode-required" });
    });
  });
});
