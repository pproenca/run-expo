import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  buildUpstreamDependencyReport,
  classifyExpoReactNativeCompatibility,
  dependencyInfo,
  dependencyStatus,
  majorFromVersion,
  majorMinorFromVersion,
  parseVersionLike,
  summarizeUpstreamDependencies,
} from "../main/index.js";
import type { UpstreamDependencyRecord } from "../main/index.js";

describe("upstream-dependency-policy legacy characterization", () => {
  it("extracts dependency info, version-like substrings, and unresolved workspace/catalog specs", () => {
    assert.deepEqual(dependencyInfo({ expo: "^54.0.7" }, "expo"), {
      name: "expo",
      present: true,
      declaredVersion: "^54.0.7",
      resolvedVersion: "54.0.7",
      unresolved: false,
    });
    assert.deepEqual(dependencyInfo({ expo: "workspace:*" }, "expo"), {
      name: "expo",
      present: true,
      declaredVersion: "workspace:*",
      resolvedVersion: null,
      unresolved: true,
    });
    assert.deepEqual(dependencyInfo({}, "expo"), {
      name: "expo",
      present: false,
      declaredVersion: null,
      resolvedVersion: null,
      unresolved: false,
    });
  });

  it("parses version helpers with the legacy loose regex", () => {
    assert.equal(parseVersionLike("~0.81.4"), "0.81.4");
    assert.equal(parseVersionLike(">=54.0 <55"), "54.0");
    assert.equal(parseVersionLike("workspace:*"), null);
    assert.equal(parseVersionLike(null), null);
    assert.equal(majorFromVersion("^54.0.0"), 54);
    assert.equal(majorFromVersion("workspace:*"), null);
    assert.equal(majorMinorFromVersion("0.81.4"), "0.81");
    assert.equal(majorMinorFromVersion("54.0"), "54.0");
  });

  it("classifies dependency status", () => {
    assert.equal(dependencyStatus(dependencyInfo({}, "expo")), "missing");
    assert.equal(dependencyStatus(dependencyInfo({ expo: "catalog:" }, "expo")), "declared-unresolved");
    assert.equal(dependencyStatus(dependencyInfo({ expo: "^54.0.0" }, "expo")), "present");
  });

  it("classifies Expo and React Native compatibility states", () => {
    assert.deepEqual(classifyExpoReactNativeCompatibility(
      dependencyInfo({ expo: "^54.0.0" }, "expo"),
      dependencyInfo({ "react-native": "0.81.4" }, "react-native"),
    ).forExpo, {
      state: "compatible",
      expected: "Expo SDK 54 expects React Native 0.81.x.",
      expo: "^54.0.0",
      reactNative: "0.81.4",
    });
    assert.equal(classifyExpoReactNativeCompatibility(
      dependencyInfo({ expo: "^54.0.0" }, "expo"),
      dependencyInfo({ "react-native": "0.79.0" }, "react-native"),
    ).forExpo.state, "mismatched");
    assert.equal(classifyExpoReactNativeCompatibility(
      dependencyInfo({ expo: "^49.0.0" }, "expo"),
      dependencyInfo({ "react-native": "0.72.0" }, "react-native"),
    ).forExpo.state, "unknown");
    assert.equal(classifyExpoReactNativeCompatibility(
      dependencyInfo({}, "expo"),
      dependencyInfo({ "react-native": "0.81.4" }, "react-native"),
    ).forExpo.state, "missing");
    assert.equal(classifyExpoReactNativeCompatibility(
      dependencyInfo({ expo: "workspace:*" }, "expo"),
      dependencyInfo({ "react-native": "0.81.4" }, "react-native"),
    ).forExpo.state, "declared-unresolved");
  });

  it("builds the legacy seven-entry upstream dependency policy report", () => {
    const report = buildUpstreamDependencyReport("/project", {
      expo: "^54.0.0",
      "react-native": "0.79.0",
      "@rozenite/network": "1.2.3",
      rozenite: "workspace:*",
    }) as any;

    assert.equal(report.schemaVersion, 1);
    assert.equal(report.projectRoot, "/project");
    assert.equal(report.dependencies.length, 7);
    assert.deepEqual(report.summary.mismatched, ["expo-public-api", "hermes-react-native-cdp"]);
    assert.equal(report.dependencies.find((item: any) => item.id === "metro-inspector-http").status, "inferred-transitive");
    assert.equal(report.dependencies.find((item: any) => item.id === "rozenite-devtools-bridge").status, "declared-unresolved");
    assert.match(report.dependencies.find((item: any) => item.id === "rozenite-devtools-bridge").declaredVersion, /@rozenite\/network@1\.2\.3/);
    assert.equal(report.dependencies.find((item: any) => item.id === "expo-cli-internals").status, "not-depended-on");
  });

  it("summarizes dependency statuses and policy categories", () => {
    const dependencies: UpstreamDependencyRecord[] = [
      record("a", "present", "direct-dependency", "public-api", "compatible"),
      record("b", "missing", "optional-compatibility-shim", "optional-compatibility-shim", "missing"),
      record("c", "declared-unresolved", "internal-reference-only", "internal-reference-only", "mismatched"),
    ];

    assert.deepEqual(summarizeUpstreamDependencies(dependencies), {
      total: 3,
      directDependencies: 1,
      internalReferenceOnly: 1,
      optionalCompatibilityShims: 1,
      statuses: { present: 1, missing: 1, "declared-unresolved": 1 },
      mismatched: ["c"],
      missing: ["b"],
    });
  });
});

function record(
  id: string,
  status: string,
  usage: string,
  classification: string,
  compatibilityState: string,
): UpstreamDependencyRecord {
  return {
    id,
    ecosystem: "test",
    packageName: id,
    integrationPoint: "test",
    classification,
    usage,
    directDependency: usage === "direct-dependency",
    declaredVersion: null,
    resolvedVersion: null,
    status,
    compatibility: { state: compatibilityState, expected: "test" },
    notes: [],
  };
}
