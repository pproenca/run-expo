import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  projectInfoAppConfigSummary,
  regexConfigValue,
  regexNestedConfigValue,
} from "../main/index.js";

describe("project-app-config-summary legacy characterization", () => {
  it("projects app config fields with basename source and null defaults", () => {
    assert.deepEqual(projectInfoAppConfigSummary({
      source: "/project/app.json",
      name: "Demo",
      slug: "demo",
      scheme: "demo",
      iosBundleIdentifier: "com.example.demo",
      androidPackage: "com.example.demo",
      easProjectId: "project-id",
    }), {
      source: "app.json",
      name: "Demo",
      slug: "demo",
      scheme: "demo",
      iosBundleIdentifier: "com.example.demo",
      androidPackage: "com.example.demo",
      easProjectId: "project-id",
    });

    assert.deepEqual(projectInfoAppConfigSummary({ source: "/project/app.config.ts" }), {
      source: "app.config.ts",
      name: null,
      slug: null,
      scheme: null,
      iosBundleIdentifier: null,
      androidPackage: null,
      easProjectId: null,
    });
  });

  it("includes optional userInterfaceStyle only when not nullish", () => {
    assert.equal("userInterfaceStyle" in projectInfoAppConfigSummary({ source: "app.json", userInterfaceStyle: null }), false);
    assert.equal("userInterfaceStyle" in projectInfoAppConfigSummary({ source: "app.json", userInterfaceStyle: undefined }), false);
    assert.deepEqual(projectInfoAppConfigSummary({ source: "app.json", userInterfaceStyle: "dark" }), {
      source: "app.json",
      name: null,
      slug: null,
      scheme: null,
      iosBundleIdentifier: null,
      androidPackage: null,
      easProjectId: null,
      userInterfaceStyle: "dark",
    });
  });

  it("includes dynamic only when it is exactly true", () => {
    assert.equal("dynamic" in projectInfoAppConfigSummary({ source: "app.config.js", dynamic: false }), false);
    assert.equal("dynamic" in projectInfoAppConfigSummary({ source: "app.config.js", dynamic: "true" }), false);
    assert.equal(projectInfoAppConfigSummary({ source: "app.config.js", dynamic: true }).dynamic, true);
  });

  it("extracts simple app config values with legacy regex rules", () => {
    const source = [
      "export default {",
      "  name: 'Demo App',",
      "  slug: \"demo-app\",",
      "  scheme: `demo`,",
      "  userInterfaceStyle: 'automatic',",
      "};",
    ].join("\n");

    assert.equal(regexConfigValue(source, "name"), "Demo App");
    assert.equal(regexConfigValue(source, "slug"), "demo-app");
    assert.equal(regexConfigValue(source, "scheme"), "demo");
    assert.equal(regexConfigValue(source, "userInterfaceStyle"), "automatic");
    assert.equal(regexConfigValue(source, "missing"), null);
  });

  it("uses the same loose regex for nested config values", () => {
    const source = [
      "ios: { bundleIdentifier: 'com.example.ios' },",
      "android: { package: \"com.example.android\" },",
      "extra: { eas: { projectId: `abc` } }",
    ].join("\n");

    assert.equal(regexNestedConfigValue(source, "bundleIdentifier"), "com.example.ios");
    assert.equal(regexNestedConfigValue(source, "package"), "com.example.android");
    assert.equal(regexNestedConfigValue(source, "projectId"), "abc");
  });
});
