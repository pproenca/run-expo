import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  APP_INSTRUMENTATION_DOMAIN_NAMES,
  APP_INSTRUMENTATION_INTERFACE_NAMES,
  APP_INSTRUMENTATION_SCHEMA_VERSION,
  APP_INSTRUMENTATION_SIDE_EFFECTS,
  CONSOLE_LEVELS,
  createAppInstrumentationManifest,
  getInstrumentationDomain,
  isAppInstrumentationDomainName,
} from "../main/index.js";

describe("app-instrumentation-contracts legacy characterization", () => {
  it("preserves manifest constants, domains, side effects, and interfaces", () => {
    assert.equal(APP_INSTRUMENTATION_SCHEMA_VERSION, 1);
    assert.deepEqual(APP_INSTRUMENTATION_DOMAIN_NAMES, [
      "snapshot",
      "navigation",
      "performance",
      "console",
      "errors",
      "network",
      "storage",
      "controls",
      "app",
    ]);
    assert.deepEqual(APP_INSTRUMENTATION_SIDE_EFFECTS, ["none", "read", "write", "device", "network"]);
    assert.deepEqual(APP_INSTRUMENTATION_INTERFACE_NAMES, [
      "AppInstrumentationBridge",
      "SnapshotInstrumentation",
      "NavigationInstrumentation",
      "PerformanceInstrumentation",
      "AppReadinessInstrumentation",
      "ConsoleInstrumentation",
      "ErrorInstrumentation",
      "NetworkInstrumentation",
      "StorageInstrumentation",
      "ControlsInstrumentation",
    ]);
  });

  it("preserves console level vocabulary", () => {
    assert.deepEqual(CONSOLE_LEVELS, ["log", "info", "warn", "error", "debug"]);
  });

  it("creates dev-only schema v1 manifests with defensive domain copies", () => {
    const domains = [
      {
        name: "navigation" as const,
        capabilities: [],
        tools: [
          {
            name: "state",
            description: "Read navigation state.",
            inputSchema: { type: "object" },
            sideEffects: "read" as const,
          },
        ],
      },
    ];

    const manifest = createAppInstrumentationManifest(true, domains);
    domains[0].tools.pop();

    assert.deepEqual(manifest, {
      schemaVersion: 1,
      enabled: true,
      developmentOnly: true,
      domains: [
        {
          name: "navigation",
          capabilities: [],
          tools: [
            {
              name: "state",
              description: "Read navigation state.",
              inputSchema: { type: "object" },
              sideEffects: "read",
            },
          ],
        },
      ],
    });
  });

  it("looks up manifest domains and validates domain names", () => {
    const manifest = createAppInstrumentationManifest(false, [
      { name: "console", capabilities: [], tools: [] },
      { name: "errors", capabilities: [], tools: [] },
    ]);

    assert.equal(isAppInstrumentationDomainName("console"), true);
    assert.equal(isAppInstrumentationDomainName("dialogs"), false);
    assert.deepEqual(getInstrumentationDomain(manifest, "errors"), {
      name: "errors",
      capabilities: [],
      tools: [],
    });
    assert.equal(getInstrumentationDomain(manifest, "network"), null);
  });
});

