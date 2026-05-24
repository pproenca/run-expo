import { describe, it } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";

import {
  BRIDGE_DOMAIN_CATALOG,
  EXPO_IOS_BRIDGE_VERSION,
  bridgeDomainsFromCatalog,
  bridgeHealthExpression,
  bridgeMetadata,
  bridgeSource,
} from "../main/index.js";

describe("bridge-runtime-contracts legacy characterization", () => {
  it("preserves bridge metadata and catalog shape", () => {
    assert.deepEqual(bridgeMetadata(), {
      schemaVersion: 1,
      bridgeVersion: EXPO_IOS_BRIDGE_VERSION,
      developmentOnly: true,
      generatedBy: "expo-ios",
      domains: ["navigation", "network", "storage", "controls", "performance", "snapshot"],
    });
    assert.equal(BRIDGE_DOMAIN_CATALOG.length, 8);
    assert.deepEqual(BRIDGE_DOMAIN_CATALOG.map((domain) => domain.name), [
      "navigation",
      "network",
      "storage",
      "state",
      "controls",
      "performance",
      "snapshot",
      "rn",
    ]);
    const domains = bridgeDomainsFromCatalog();
    domains[0]?.readCommands.push("mutated");
    assert.deepEqual(BRIDGE_DOMAIN_CATALOG[0]?.readCommands, ["state"]);
  });

  it("reports missing bridge when no supported global is present", () => {
    assert.deepEqual(runHealth({}), {
      available: false,
      code: "missing-bridge",
      reason: "No bridge global is registered.",
    });
  });

  it("reports missing app registration while preserving discovered bridge version", () => {
    assert.deepEqual(runHealth({
      __EXPO_IOS_PLUGIN_BRIDGE__: { metadata: { bridgeVersion: "1.0.0" } },
    }), {
      available: false,
      code: "missing-app-registration",
      reason: "Bridge global exists but the app did not register domains.",
      registered: false,
      bridgeVersion: "1.0.0",
    });
  });

  it("uses registered bridge domains and runtime command overrides", () => {
    assert.deepEqual(runHealth({
      __EXPO_IOS_DEVTOOLS_BRIDGE__: {
        registered: true,
        metadata: { bridgeVersion: EXPO_IOS_BRIDGE_VERSION },
        appId: "app-1",
        runtimeName: "Hermes",
        domains: [
          "navigation",
          {
            name: "storage",
            available: false,
            readCommands: ["custom-read"],
            writeCommands: ["custom-write"],
            redactionBoundaries: ["custom-boundary"],
          },
          { name: "", readCommands: ["ignored"] },
          { name: "custom", readCommands: ["read"], writeCommands: [], redactionBoundaries: ["domain-defined values"] },
        ],
      },
    }), {
      available: true,
      registered: true,
      appRegistration: { registered: true, appId: "app-1", runtimeName: "Hermes" },
      bridgeVersion: EXPO_IOS_BRIDGE_VERSION,
      compatibleCliVersion: true,
      domains: [
        {
          name: "navigation",
          available: true,
          readCommands: ["state"],
          writeCommands: ["back", "pop-to-root", "tab", "deep-link"],
          redactionBoundaries: ["route params", "query values"],
        },
        {
          name: "storage",
          available: false,
          readCommands: ["custom-read"],
          writeCommands: ["custom-write"],
          redactionBoundaries: ["custom-boundary"],
        },
        {
          name: "custom",
          available: true,
          readCommands: ["read"],
          writeCommands: [],
          redactionBoundaries: ["domain-defined values"],
        },
      ],
    });
  });

  it("falls back through metadata domains, domainRegistry, and catalog domains", () => {
    assert.deepEqual(runHealth({
      __EXPO_IOS_PLUGIN_BRIDGE__: {
        registered: true,
        metadata: { domains: ["snapshot"] },
      },
    }).domains.map((domain: { name: string }) => domain.name), ["snapshot"]);

    assert.deepEqual(runHealth({
      __ROZENITE_AGENT_BRIDGE__: {
        appRegistered: true,
        domainRegistry: {
          controls: { readCommands: ["list"], writeCommands: ["press"], redactionBoundaries: ["labels"] },
        },
      },
    }).domains, [{
      name: "controls",
      available: true,
      readCommands: ["list"],
      writeCommands: ["press"],
      redactionBoundaries: ["labels"],
    }]);

    assert.equal(runHealth({
      __EXPO_IOS_DEVTOOLS_BRIDGE__: { registered: true },
    }).domains.length, 8);
  });

  it("detects app instrumentation domains and infers the expected bridge version", () => {
    const instrumentation = {
      app: { ready: true, appId: "instrumented", runtimeName: "Runtime" },
      navigation: {},
      storage: {},
    };
    const payload = runHealth({ __EXPO_IOS_INSTRUMENTATION__: instrumentation });

    assert.equal(payload.bridgeVersion, EXPO_IOS_BRIDGE_VERSION);
    assert.equal(payload.compatibleCliVersion, true);
    assert.deepEqual(payload.appRegistration, { registered: true, appId: "instrumented", runtimeName: "Runtime" });
    assert.deepEqual(payload.domains.map((domain: { name: string }) => domain.name), ["navigation", "storage"]);
  });

  it("preserves legacy generated bridge source, including permissive undefined __DEV__ registration", () => {
    const source = bridgeSource();
    assert.match(source, /if \(typeof __DEV__ !== "undefined" && !__DEV__\)/);
    assert.match(source, /globalThis\.__EXPO_IOS_DEVTOOLS_BRIDGE__ = bridge/);
    assert.match(source, /"generatedBy": "expo-ios"/);
    assert.doesNotMatch(source, /development-mode-required/);
  });

  it("embeds the health marker, bridge version, and catalog in the Runtime.evaluate expression", () => {
    const expression = bridgeHealthExpression();
    assert.match(expression, /__EXPO_IOS_BRIDGE_HEALTH__/);
    assert.match(expression, /expectedBridgeVersion = "1.0.0"/);
    assert.match(expression, /__EXPO_IOS_INSTRUMENTATION__/);
    assert.match(expression, /domain-defined values/);
  });
});

function runHealth(globals: Record<string, unknown>): Record<string, any> {
  return JSON.parse(JSON.stringify(vm.runInContext(bridgeHealthExpression(), vm.createContext({ ...globals }))));
}
