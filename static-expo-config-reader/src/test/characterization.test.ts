import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  firstExisting,
  readExpoConfigSummary,
  regexConfigValue,
  regexNestedConfigValue,
} from "../main/index.js";

describe("static-expo-config-reader legacy characterization", () => {
  it("prefers app.json and reads nested expo config fields", async () => {
    await withTempProject(async (root) => {
      await fs.writeFile(path.join(root, "app.json"), JSON.stringify({
        expo: {
          name: "Demo",
          slug: "demo",
          scheme: "demo",
          ios: { bundleIdentifier: "com.example.ios" },
          android: { package: "com.example.android" },
          extra: { eas: { projectId: "project-id" } },
          userInterfaceStyle: "automatic",
        },
      }), "utf8");
      await fs.writeFile(path.join(root, "app.config.js"), "export default { name: 'Ignored' };\n", "utf8");

      assert.deepEqual(await readExpoConfigSummary(root), {
        source: path.join(root, "app.json"),
        name: "Demo",
        slug: "demo",
        scheme: "demo",
        iosBundleIdentifier: "com.example.ios",
        androidPackage: "com.example.android",
        easProjectId: "project-id",
        userInterfaceStyle: "automatic",
      });
    });
  });

  it("supports app.json without an expo wrapper and fills missing fields with null", async () => {
    await withTempProject(async (root) => {
      await fs.writeFile(path.join(root, "app.json"), JSON.stringify({
        name: "Bare",
        ios: {},
      }), "utf8");

      assert.deepEqual(await readExpoConfigSummary(root), {
        source: path.join(root, "app.json"),
        name: "Bare",
        slug: null,
        scheme: null,
        iosBundleIdentifier: null,
        androidPackage: null,
        easProjectId: null,
        userInterfaceStyle: null,
      });
    });
  });

  it("uses the first app.config file in the legacy priority order and marks it dynamic", async () => {
    await withTempProject(async (root) => {
      await fs.writeFile(path.join(root, "app.config.js"), "export default { name: 'JS' };\n", "utf8");
      await fs.writeFile(path.join(root, "app.config.ts"), [
        "export default {",
        "  name: 'TS Demo',",
        "  slug: \"ts-demo\",",
        "  scheme: `tsdemo`,",
        "  ios: { bundleIdentifier: 'com.example.ts' },",
        "  android: { package: \"com.example.ts\" },",
        "  extra: { eas: { projectId: `ts-project` } },",
        "  userInterfaceStyle: 'dark',",
        "};",
      ].join("\n"), "utf8");

      assert.deepEqual(await readExpoConfigSummary(root), {
        source: path.join(root, "app.config.ts"),
        name: "TS Demo",
        slug: "ts-demo",
        scheme: "tsdemo",
        iosBundleIdentifier: "com.example.ts",
        androidPackage: "com.example.ts",
        easProjectId: "ts-project",
        userInterfaceStyle: "dark",
        dynamic: true,
      });
    });
  });

  it("returns null when no Expo config file exists", async () => {
    await withTempProject(async (root) => {
      assert.equal(await readExpoConfigSummary(root), null);
    });
  });

  it("propagates invalid app.json parse errors", async () => {
    await withTempProject(async (root) => {
      await fs.writeFile(path.join(root, "app.json"), "{bad", "utf8");
      await assert.rejects(() => readExpoConfigSummary(root), SyntaxError);
    });
  });

  it("firstExisting checks names in order", async () => {
    await withTempProject(async (root) => {
      await fs.writeFile(path.join(root, "second"), "", "utf8");
      await fs.writeFile(path.join(root, "third"), "", "utf8");
      assert.equal(await firstExisting(root, ["first", "second", "third"]), path.join(root, "second"));
      assert.equal(await firstExisting(root, ["missing"]), null);
    });
  });

  it("preserves the loose static regex extraction helpers", () => {
    const text = "name: 'Demo'\nslug: \"demo\"\nscheme: `demo`\n";
    assert.equal(regexConfigValue(text, "name"), "Demo");
    assert.equal(regexConfigValue(text, "slug"), "demo");
    assert.equal(regexConfigValue(text, "scheme"), "demo");
    assert.equal(regexConfigValue(text, "missing"), null);
    assert.equal(regexNestedConfigValue("ios: { bundleIdentifier: 'com.example' }", "bundleIdentifier"), "com.example");
  });
});

async function withTempProject(test: (root: string) => Promise<void>): Promise<void> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "expo98-static-config-"));
  try {
    await test(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}
