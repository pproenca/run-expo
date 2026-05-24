import { describe, it } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";

import {
  EXPO_IOS_BRIDGE_VERSION,
  semanticBridgeExpression,
} from "../main/index.js";

describe("semantic-bridge-expression legacy characterization", () => {
  it("reports unavailable-bridge when no supported global bridge exists", () => {
    assert.deepEqual(runExpression({ compact: true }, {}), {
      available: false,
      source: "plugin-bridge-semantic",
      code: "unavailable-bridge",
      reason: "Semantic bridge is not installed.",
      refs: [],
    });
  });

  it("reports missing-domain when a bridge exists without a semantic snapshot surface", () => {
    assert.deepEqual(runExpression({}, {
      __EXPO_IOS_PLUGIN_BRIDGE__: { metadata: { bridgeVersion: EXPO_IOS_BRIDGE_VERSION } },
    }), {
      available: false,
      source: "plugin-bridge-semantic",
      code: "missing-domain",
      reason: "Semantic snapshot bridge domain is not registered.",
      refs: [],
    });
  });

  it("rejects incompatible bridge versions before capturing refs", () => {
    assert.deepEqual(runExpression({ includeBounds: true }, {
      __ROZENITE_AGENT_BRIDGE__: {
        bridgeVersion: "0.9.0",
        snapshot: { refs: [{ label: "Ignored" }] },
      },
    }), {
      available: false,
      source: "plugin-bridge-semantic",
      code: "version-mismatch",
      bridgeVersion: "0.9.0",
      expectedBridgeVersion: EXPO_IOS_BRIDGE_VERSION,
      reason: "Semantic bridge version is not compatible with this CLI.",
      refs: [],
    });
  });

  it("prefers snapshot.capture and passes serialized filters", () => {
    const context = {
      __EXPO_IOS_DEVTOOLS_BRIDGE__: {
        metadata: { bridgeVersion: EXPO_IOS_BRIDGE_VERSION },
        snapshot: {
          capture: ({ filters }: { filters: unknown }) => ({
            routeHint: "/settings",
            refs: [{ label: "Save", filters }],
            limitations: ["fixture limitation"],
          }),
        },
      },
    };

    assert.deepEqual(runExpression({ compact: true, depth: 2 }, context), {
      available: true,
      source: "plugin-bridge-semantic",
      bridgeVersion: EXPO_IOS_BRIDGE_VERSION,
      routeHint: "/settings",
      refs: [{ label: "Save", filters: { compact: true, depth: 2 } }],
      limitations: ["fixture limitation"],
    });
  });

  it("falls back through semantics, domain maps, domainRegistry, and refs arrays", () => {
    assert.deepEqual(runExpression({}, {
      __EXPO_IOS_DEVTOOLS_BRIDGE__: {
        semantics: { refs: [{ label: "Semantics" }] },
      },
    }).refs, [{ label: "Semantics" }]);

    assert.deepEqual(runExpression({}, {
      __EXPO_IOS_DEVTOOLS_BRIDGE__: {
        domains: { snapshot: { refs: [{ label: "Domain map" }] } },
      },
    }).refs, [{ label: "Domain map" }]);

    assert.deepEqual(runExpression({}, {
      __EXPO_IOS_DEVTOOLS_BRIDGE__: {
        domainRegistry: { semantics: { refs: [{ label: "Registry" }] } },
      },
    }).refs, [{ label: "Registry" }]);
  });

  it("uses callTool when no direct semantic domain object exists", () => {
    const context = {
      __EXPO_IOS_PLUGIN_BRIDGE__: {
        callTool(name: string, payload: unknown) {
          return { routeHint: name, refs: [{ payload }] };
        },
      },
    };

    assert.deepEqual(runExpression({ includeSource: true }, context), {
      available: true,
      source: "plugin-bridge-semantic",
      bridgeVersion: null,
      routeHint: "snapshot.capture",
      refs: [{ payload: { filters: { includeSource: true } } }],
      limitations: [],
    });
  });

  it("treats array domain registrations for snapshot or semantics as available with empty refs", () => {
    assert.deepEqual(runExpression({}, {
      __EXPO_IOS_DEVTOOLS_BRIDGE__: {
        domains: [{ name: "navigation" }, { name: "snapshot" }],
      },
    }), {
      available: true,
      source: "plugin-bridge-semantic",
      bridgeVersion: null,
      routeHint: null,
      refs: [],
      limitations: [],
    });
  });

  it("supports array captures and normalizes missing routeHint and limitations", () => {
    assert.deepEqual(runExpression({}, {
      __EXPO_IOS_DEVTOOLS_BRIDGE__: {
        snapshot: {
          capture: () => [{ label: "One" }, { label: "Two" }],
        },
      },
    }), {
      available: true,
      source: "plugin-bridge-semantic",
      bridgeVersion: null,
      routeHint: null,
      refs: [{ label: "One" }, { label: "Two" }],
      limitations: [],
    });
  });
});

function runExpression(filters: unknown, globals: Record<string, unknown>): Record<string, any> {
  const context = vm.createContext({ ...globals });
  return JSON.parse(JSON.stringify(vm.runInContext(semanticBridgeExpression({ filters }), context)));
}
