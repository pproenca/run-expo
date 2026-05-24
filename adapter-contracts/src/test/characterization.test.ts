import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ADAPTER_CATALOG,
  ADAPTER_IMPLEMENTATION_SOURCES,
  CORE_ADAPTERS,
  DOMAIN_ADAPTERS,
  ENVIRONMENT_SETTING_CATEGORIES,
  GESTURE_ACTION_KINDS,
  NATIVE_PROFILER_ADAPTERS,
  REF_ACTION_KINDS,
  REVIEW_ADAPTERS,
  STORAGE_KINDS,
  adapterImplementationSources,
  adapterImplementationSourcesByExport,
  adapterImplementationSourcesByPackage,
  assertAdapterImplementationSourcesCover,
  createAdapterRegistry,
  getAdapterContract,
  implementedAdapterNames,
  listAdapterContracts,
} from "../main/index.js";

describe("adapter-contracts legacy characterization", () => {
  it("preserves adapter names by legacy source group", () => {
    assert.deepEqual(CORE_ADAPTERS, [
      "commandRunner",
      "project",
      "device",
      "gesture",
      "metro",
      "hermes",
      "snapshot",
      "devTools",
      "runtimeEvidence",
      "performance",
      "sessionStore",
    ]);
    assert.deepEqual(DOMAIN_ADAPTERS, [
      "navigation",
      "network",
      "storage",
      "appState",
      "controls",
      "accessibility",
      "dialog",
      "recording",
      "diff",
      "dashboard",
      "skills",
      "setup",
      "clipboard",
      "environment",
      "expoIntrospection",
      "instrumentation",
    ]);
    assert.deepEqual(NATIVE_PROFILER_ADAPTERS, ["nativeProfiler"]);
    assert.deepEqual(REVIEW_ADAPTERS, [
      "inspector",
      "trace",
      "annotation",
      "reviewOverlay",
      "reviewGuidance",
      "reviewReport",
    ]);
  });

  it("preserves union vocabularies used by adapter method arguments", () => {
    assert.deepEqual(GESTURE_ACTION_KINDS, ["tap", "long-press", "drag", "swipe", "ref-action"]);
    assert.deepEqual(REF_ACTION_KINDS, ["tap", "long-press", "fill", "focus", "scroll"]);
    assert.deepEqual(STORAGE_KINDS, ["async", "mmkv", "secure-store", "sqlite"]);
    assert.deepEqual(ENVIRONMENT_SETTING_CATEGORIES, [
      "appearance",
      "content-size",
      "locale",
      "timezone",
      "location",
      "network",
      "permissions",
      "orientation",
      "keyboard",
    ]);
  });

  it("builds a source-cited adapter catalog", () => {
    assert.equal(ADAPTER_CATALOG.length, 34);
    assert.deepEqual(getAdapterContract("metro"), {
      name: "metro",
      group: "core",
      sourceFile: "src/adapters/interfaces.ts",
      capability: "Metro status, target discovery, and stack symbolication",
    });
    assert.deepEqual(getAdapterContract("reviewOverlay"), {
      name: "reviewOverlay",
      group: "review",
      sourceFile: "src/adapters/review.ts",
      capability: "Review overlay scaffold, preparation, read, and clear operations",
    });
    assert.equal(getAdapterContract("missing"), null);
  });

  it("returns defensive catalog lists and group filters", () => {
    const core = listAdapterContracts("core");
    core.pop();

    assert.equal(listAdapterContracts("core").length, 11);
    assert.equal(listAdapterContracts("review").length, 6);
    assert.equal(listAdapterContracts().length, 34);
  });

  it("registers and requires concrete adapters by contract name", () => {
    const registry = createAdapterRegistry({
      metro: { status: async () => ({ port: 8081, status: "available", version: null, targets: [] }) },
    });

    assert.deepEqual(registry.list(), ["metro"]);
    assert.equal(registry.get("device"), null);

    const device = { list: async () => [] };
    registry.register("device", device);

    assert.equal(registry.get("device"), device);
    assert.equal(registry.require("device"), device);
    assert.throws(() => registry.require("network"), /Adapter not registered: network/);
  });

  it("maps adapter contracts to transformed implementation package exports", () => {
    const sources = adapterImplementationSources();

    assert.equal(ADAPTER_IMPLEMENTATION_SOURCES.length, 72);
    assert.deepEqual(implementedAdapterNames(), ADAPTER_CATALOG.map((contract) => contract.name));
    assert.deepEqual(adapterImplementationSources("hermes"), [
      {
        adapterName: "hermes",
        packageName: "@expo98/hermes-runtime-diagnostics",
        exportName: "evaluateHermesExpression",
        responsibility: "Hermes Runtime.evaluate execution",
      },
      {
        adapterName: "hermes",
        packageName: "@expo98/hermes-runtime-diagnostics",
        exportName: "inspectHermesRuntime",
        responsibility: "Hermes runtime inspection diagnostics",
      },
    ]);
    assert.deepEqual(
      adapterImplementationSourcesByPackage("@expo98/bridge-domain-actions").map((source) => source.adapterName),
      ["storage", "appState", "controls"],
    );
    assert.deepEqual(
      adapterImplementationSourcesByExport("reviewMatrixPayload").map((source) => source.adapterName),
      ["reviewReport"],
    );

    sources.pop();
    assert.equal(adapterImplementationSources().length, 72);
  });

  it("points adapter implementation sources at real manifests and public exports", async () => {
    const modernizedRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

    for (const source of adapterImplementationSources()) {
      const packageDir = source.packageName.replace("@expo98/", "");
      const packageJson = JSON.parse(await readFile(resolve(modernizedRoot, packageDir, "package.json"), "utf8"));
      const publicIndex = await readFile(resolve(modernizedRoot, packageDir, "src", "main", "index.ts"), "utf8");

      assert.equal(packageJson.name, source.packageName, `${source.adapterName}:${source.exportName}`);
      assert.match(publicIndex, new RegExp(`\\b${source.exportName}\\b`), `${source.adapterName}:${source.exportName}`);
    }
  });

  it("asserts adapter implementation source coverage for runtime composition", () => {
    assert.doesNotThrow(() => assertAdapterImplementationSourcesCover(["metro", "hermes", "reviewOverlay"]));
    assert.throws(
      () => assertAdapterImplementationSourcesCover(["metro", "nativeHostAutomation"]),
      /Missing adapter implementation sources: nativeHostAutomation/,
    );
  });
});
