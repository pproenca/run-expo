import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  expoConfigLimitations,
  expoModuleCategory,
  expoModuleRecords,
  expoPrebuildRiskLevel,
  expoPrebuildRisks,
  findUp,
  firstExisting,
  formatExpoPluginEntry,
  isExpoRelatedPackage,
  readExpoAppConfigPlugins,
  readJsonFile,
} from "../main/index.js";
import type { ExpoModuleRecord } from "../main/index.js";

describe("expo-prebuild-risk-analysis legacy characterization", () => {
  describe("Expo module discovery", () => {
    it("finds the nearest package.json, merges dependencies and devDependencies, filters Expo packages, and sorts by name", async () => {
      await withTempProject(async (root) => {
        const nested = path.join(root, "apps", "mobile");
        await fs.mkdir(nested, { recursive: true });
        await fs.writeFile(path.join(root, "package.json"), JSON.stringify({
          dependencies: {
            react: "19.1.0",
            "expo-camera": "~17.0.0",
            expo: "^54.0.0",
            "@expo/vector-icons": "^15.0.0",
            "not-expo": "1.0.0",
          },
          devDependencies: {
            "@config-plugins/react-native-ble-plx": "^9.0.0",
            "custom-config-plugin": "2.0.0",
          },
        }), "utf8");

        assert.deepEqual(await expoModuleRecords(nested), [
          { name: "@config-plugins/react-native-ble-plx", version: "^9.0.0", category: "config-plugin" },
          { name: "@expo/vector-icons", version: "^15.0.0", category: "expo" },
          { name: "custom-config-plugin", version: "2.0.0", category: "config-plugin" },
          { name: "expo", version: "^54.0.0", category: "expo" },
          { name: "expo-camera", version: "~17.0.0", category: "expo" },
        ]);
      });
    });

    it("lets devDependencies override dependencies because the legacy merge spreads devDependencies last", async () => {
      await withTempProject(async (root) => {
        await fs.writeFile(path.join(root, "package.json"), JSON.stringify({
          dependencies: { "expo-camera": "from-deps" },
          devDependencies: { "expo-camera": "from-dev-deps" },
        }), "utf8");

        assert.deepEqual(await expoModuleRecords(root), [
          { name: "expo-camera", version: "from-dev-deps", category: "expo" },
        ]);
      });
    });

    it("returns no module records when package.json cannot be found", async () => {
      await withTempProject(async (root) => {
        assert.deepEqual(await expoModuleRecords(root), []);
      });
    });

    it("classifies related package names with the exact legacy prefix and substring checks", () => {
      assert.equal(isExpoRelatedPackage("expo"), true);
      assert.equal(isExpoRelatedPackage("expo-camera"), true);
      assert.equal(isExpoRelatedPackage("@expo/vector-icons"), true);
      assert.equal(isExpoRelatedPackage("@config-plugins/react-native-ble-plx"), true);
      assert.equal(isExpoRelatedPackage("custom-config-plugin"), true);
      assert.equal(isExpoRelatedPackage("react-native"), false);

      assert.equal(expoModuleCategory("@config-plugins/react-native-ble-plx"), "config-plugin");
      assert.equal(expoModuleCategory("custom-config-plugin"), "config-plugin");
      assert.equal(expoModuleCategory("expo-router"), "expo");
      assert.equal(expoModuleCategory("@expo/config-pluginish"), "config-plugin");
      assert.equal(expoModuleCategory("unrelated"), "other");
    });
  });

  describe("Expo app config plugin extraction", () => {
    it("prefers app.json and formats expo.plugins entries before considering root plugins", async () => {
      await withTempProject(async (root) => {
        await fs.writeFile(path.join(root, "app.json"), JSON.stringify({
          plugins: ["root-plugin"],
          expo: {
            plugins: [
              "expo-font",
              ["expo-build-properties", { ios: { useFrameworks: "static" } }],
              { named: "object-plugin" },
              [],
            ],
          },
        }), "utf8");
        await fs.writeFile(path.join(root, "app.config.ts"), "export default { plugins: ['ignored'] };\n", "utf8");

        assert.deepEqual(await readExpoAppConfigPlugins(root), [
          "expo-font",
          "expo-build-properties",
          "{\"named\":\"object-plugin\"}",
          "",
        ]);
      });
    });

    it("falls back to root app.json plugins when expo.plugins is absent", async () => {
      await withTempProject(async (root) => {
        await fs.writeFile(path.join(root, "app.json"), JSON.stringify({
          plugins: ["root-plugin"],
          expo: { name: "Demo" },
        }), "utf8");

        assert.deepEqual(await readExpoAppConfigPlugins(root), ["root-plugin"]);
      });
    });

    it("returns no app.json plugins when the selected plugins field is not an array", async () => {
      await withTempProject(async (root) => {
        await fs.writeFile(path.join(root, "app.json"), JSON.stringify({
          expo: { plugins: "expo-font" },
        }), "utf8");

        assert.deepEqual(await readExpoAppConfigPlugins(root), []);
      });
    });

    it("extracts quoted plugin names from the first dynamic app config file in legacy priority order", async () => {
      await withTempProject(async (root) => {
        await fs.writeFile(path.join(root, "app.config.js"), "export default { plugins: ['ignored-js'] };\n", "utf8");
        await fs.writeFile(path.join(root, "app.config.ts"), [
          "export default {",
          "  plugins: [\"expo-font\", 'expo-camera', `expo-router`],",
          "};",
        ].join("\n"), "utf8");

        assert.deepEqual(await readExpoAppConfigPlugins(root), ["expo-font", "expo-camera", "expo-router"]);
      });
    });

    it("returns no dynamic plugins when the plugins array cannot be found", async () => {
      await withTempProject(async (root) => {
        await fs.writeFile(path.join(root, "app.config.cjs"), "module.exports = { name: 'Demo' };\n", "utf8");

        assert.deepEqual(await readExpoAppConfigPlugins(root), []);
      });
    });

    it("formats plugin entries with legacy string, tuple, empty tuple, and object behavior", () => {
      assert.equal(formatExpoPluginEntry("expo-router"), "expo-router");
      assert.equal(formatExpoPluginEntry(["expo-camera", { cameraPermission: "Allow" }]), "expo-camera");
      assert.equal(formatExpoPluginEntry([]), "");
      assert.equal(formatExpoPluginEntry({ plugin: "custom" }), "{\"plugin\":\"custom\"}");
    });
  });

  describe("prebuild risk planning", () => {
    it("orders native project risks, config-plugin dependency risks, and app-config plugin risks like legacy code", async () => {
      await withTempProject(async (root) => {
        await fs.mkdir(path.join(root, "ios"));
        await fs.mkdir(path.join(root, "android"));
        await fs.writeFile(path.join(root, "app.json"), JSON.stringify({ expo: { plugins: ["expo-font"] } }), "utf8");
        const modules: ExpoModuleRecord[] = [
          { name: "expo-camera", version: "~17.0.0", category: "expo" },
          { name: "@config-plugins/react-native-ble-plx", version: "^9.0.0", category: "config-plugin" },
          { name: "custom-config-plugin", version: "1.0.0", category: "config-plugin" },
        ];

        const risks = await expoPrebuildRisks(root, modules);

        assert.deepEqual(risks, [
          {
            kind: "native-project-present",
            platform: "ios",
            severity: "high",
            message: "ios native project exists; config and native module changes may require a rebuild.",
          },
          {
            kind: "native-project-present",
            platform: "android",
            severity: "high",
            message: "android native project exists; config and native module changes may require a rebuild.",
          },
          {
            kind: "config-plugin",
            package: "@config-plugins/react-native-ble-plx",
            severity: "medium",
            message: "Config-plugin dependency can affect native prebuild output.",
          },
          {
            kind: "config-plugin",
            package: "custom-config-plugin",
            severity: "medium",
            message: "Config-plugin dependency can affect native prebuild output.",
          },
          {
            kind: "app-config-plugin",
            plugin: "expo-font",
            severity: "medium",
            message: "App config plugin can affect native prebuild output.",
          },
        ]);
      });
    });

    it("derives high, medium, and low risk levels from the legacy native-project-first rule", () => {
      assert.equal(expoPrebuildRiskLevel([
        {
          kind: "config-plugin",
          package: "custom-config-plugin",
          severity: "medium",
          message: "Config-plugin dependency can affect native prebuild output.",
        },
      ]), "medium");
      assert.equal(expoPrebuildRiskLevel([
        {
          kind: "native-project-present",
          platform: "ios",
          severity: "high",
          message: "ios native project exists; config and native module changes may require a rebuild.",
        },
      ]), "high");
      assert.equal(expoPrebuildRiskLevel([]), "low");
    });

    it("reports dynamic and static Expo config limitations verbatim", () => {
      assert.deepEqual(expoConfigLimitations({ appConfig: { dynamic: true } }), [
        "Dynamic Expo config was summarized with static string extraction and may omit computed values.",
      ]);
      assert.deepEqual(expoConfigLimitations({ appConfig: null }), [
        "Expo config is summarized from project files; native runtime overrides are not included.",
      ]);
    });
  });

  describe("shared filesystem helpers", () => {
    it("findUp walks parent directories and firstExisting checks names in order", async () => {
      await withTempProject(async (root) => {
        const nested = path.join(root, "one", "two");
        await fs.mkdir(nested, { recursive: true });
        await fs.writeFile(path.join(root, "package.json"), "{}", "utf8");
        await fs.writeFile(path.join(root, "second"), "", "utf8");
        await fs.writeFile(path.join(root, "third"), "", "utf8");

        assert.equal(await findUp(nested, "package.json"), path.join(root, "package.json"));
        assert.equal(await firstExisting(root, ["first", "second", "third"]), path.join(root, "second"));
        assert.equal(await firstExisting(root, ["missing"]), null);
      });
    });

    it("propagates invalid JSON parse errors from legacy readJsonFile usage", async () => {
      await withTempProject(async (root) => {
        const file = path.join(root, "bad.json");
        await fs.writeFile(file, "{bad", "utf8");

        await assert.rejects(() => readJsonFile(file), SyntaxError);
      });
    });
  });
});

async function withTempProject(test: (root: string) => Promise<void>): Promise<void> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "expo98-prebuild-risk-"));
  try {
    await test(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}
