import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  expoCommand,
  expoConfigLimitations,
  expoModuleCategory,
  expoModuleRecords,
  expoPrebuildRiskLevel,
  expoPrebuildRisks,
  formatExpoPluginEntry,
  isExpoRelatedPackage,
  readExpoAppConfigPlugins,
  toolJson,
  unwrapToolJson,
} from "../main/index.js";
import type {
  ExpoCommandDependencies,
  ExpoModuleRecord,
  ExpoProjectSummary,
} from "../main/index.js";

const PROJECT = "/fixture/project";
const PACKAGE_JSON = `${PROJECT}/package.json`;

interface FakeDepsOptions {
  existingPaths?: string[];
  jsonFiles?: Record<string, unknown>;
  textFiles?: Record<string, string>;
  firstExistingName?: string | null;
  packageJsonPath?: string | null;
  summary?: ExpoProjectSummary;
  normalizeFailure?: boolean;
  projectInfoPayload?: unknown;
  doctorPayload?: unknown;
  upstreamFallback?: unknown;
  onRuntimeSummaryCwd?: (cwd: string) => void;
}

function fakeDeps(options: FakeDepsOptions = {}): ExpoCommandDependencies {
  const existingPaths = new Set(options.existingPaths ?? []);
  const jsonFiles = options.jsonFiles ?? {};
  const textFiles = options.textFiles ?? {};

  return {
    normalizeProjectCwd: async (cwd) => {
      if (options.normalizeFailure) throw new Error("normalize failed");
      return cwd ?? PROJECT;
    },
    resolvePath: (input) => `/resolved/${input.replace(/^\/+/, "")}`,
    currentWorkingDirectory: () => "/cwd",
    runtimeSummary: async (cwd) => {
      options.onRuntimeSummaryCwd?.(cwd);
      return options.summary ?? {
        projectRoot: PROJECT,
        expoDependency: "^54.0.0",
        reactNativeDependency: "0.81.4",
        appConfig: null,
      };
    },
    doctor: async () => options.doctorPayload ?? toolJson({ ok: true }),
    projectInfo: async () => options.projectInfoPayload ?? toolJson({ isExpoProject: true, upstreamDependencies: { state: "from-project-info" } }),
    buildUpstreamDependencyReport: () => options.upstreamFallback ?? { state: "fallback-policy" },
    findUp: async () => options.packageJsonPath === undefined ? PACKAGE_JSON : options.packageJsonPath,
    readJsonFile: async (filePath) => jsonFiles[filePath] ?? {},
    joinPath: (...parts) => parts.join("/").replaceAll(/\/+/g, "/"),
    pathExists: async (filePath) => existingPaths.has(filePath),
    firstExisting: async (projectRoot, names) => {
      if (options.firstExistingName === null) return null;
      if (typeof options.firstExistingName === "string") return `${projectRoot}/${options.firstExistingName}`;
      return names.map((name) => `${projectRoot}/${name}`).find((path) => existingPaths.has(path)) ?? null;
    },
    readTextFile: async (filePath) => textFiles[filePath] ?? "",
  };
}

describe("expo-introspection-actions legacy characterization", () => {
  describe("action validation and JSON tool envelope", () => {
    it("defaults to modules, trims action strings, and rejects unknown actions with the legacy message", async () => {
      const payload = unwrapToolJson(await expoCommand({}, fakeDeps()));

      assert.equal((payload as { action: string }).action, "modules");
      assert.deepEqual(unwrapToolJson(await expoCommand({ action: " config " }, fakeDeps())), {
        available: true,
        action: "config",
        sources: ["project"],
        projectRoot: PROJECT,
        expoDependency: "^54.0.0",
        reactNativeDependency: "0.81.4",
        appConfig: null,
        limitations: ["Expo config is summarized from project files; native runtime overrides are not included."],
      });
      await assert.rejects(
        () => expoCommand({ action: "launch" }, fakeDeps()),
        /Unknown Expo action: launch/,
      );
      await assert.rejects(
        () => expoCommand({ action: " " }, fakeDeps()),
        /action must be a non-empty string\./,
      );
    });

    it("keeps the MCP-style JSON text envelope and unwraps plain text fallback output", () => {
      assert.deepEqual(toolJson({ ok: true }), {
        content: [{ type: "text", text: "{\n  \"ok\": true\n}\n" }],
        isError: false,
      });
      assert.deepEqual(unwrapToolJson(toolJson({ ok: true })), { ok: true });
      assert.deepEqual(unwrapToolJson({ content: [{ type: "text", text: "plain output" }] }), { text: "plain output" });
    });

    it("falls back to a resolved cwd when project cwd normalization fails", async () => {
      let runtimeCwd = "";

      await expoCommand({ action: "config", cwd: "missing-app" }, fakeDeps({
        normalizeFailure: true,
        onRuntimeSummaryCwd: (cwd) => {
          runtimeCwd = cwd;
        },
      }));

      assert.equal(runtimeCwd, "/resolved/missing-app");
    });
  });

  describe("Expo module dependency discovery", () => {
    it("filters dependencies and devDependencies to Expo-related packages, sorted by package name", async () => {
      const modules = await expoModuleRecords(PROJECT, fakeDeps({
        jsonFiles: {
          [PACKAGE_JSON]: {
            dependencies: {
              react: "19.1.0",
              "expo-camera": "~17.0.0",
              expo: "^54.0.0",
              "@expo/vector-icons": "^15.0.0",
              "not-expo": "1.0.0",
            },
            devDependencies: {
              "@config-plugins/react-native-ble-plx": "^9.0.0",
              "my-config-plugin": "2.0.0",
            },
          },
        },
      }));

      assert.deepEqual(modules, [
        { name: "@config-plugins/react-native-ble-plx", version: "^9.0.0", category: "config-plugin" },
        { name: "@expo/vector-icons", version: "^15.0.0", category: "expo" },
        { name: "expo", version: "^54.0.0", category: "expo" },
        { name: "expo-camera", version: "~17.0.0", category: "expo" },
        { name: "my-config-plugin", version: "2.0.0", category: "config-plugin" },
      ]);
    });

    it("returns no module records when package.json cannot be found", async () => {
      assert.deepEqual(await expoModuleRecords(PROJECT, fakeDeps({ packageJsonPath: null })), []);
    });

    it("classifies related package names with the same legacy prefix and substring checks", () => {
      assert.equal(isExpoRelatedPackage("expo"), true);
      assert.equal(isExpoRelatedPackage("expo-camera"), true);
      assert.equal(isExpoRelatedPackage("@expo/vector-icons"), true);
      assert.equal(isExpoRelatedPackage("@config-plugins/react-native-ble-plx"), true);
      assert.equal(isExpoRelatedPackage("custom-config-plugin"), true);
      assert.equal(isExpoRelatedPackage("react-native"), false);
      assert.equal(expoModuleCategory("@config-plugins/react-native-ble-plx"), "config-plugin");
      assert.equal(expoModuleCategory("custom-config-plugin"), "config-plugin");
      assert.equal(expoModuleCategory("expo-router"), "expo");
      assert.equal(expoModuleCategory("unrelated"), "other");
    });
  });

  describe("Expo app config plugin extraction", () => {
    it("formats app.json plugin entries and gives expo.plugins precedence over root plugins", async () => {
      const plugins = await readExpoAppConfigPlugins(PROJECT, fakeDeps({
        existingPaths: [`${PROJECT}/app.json`],
        jsonFiles: {
          [`${PROJECT}/app.json`]: {
            plugins: ["root-plugin"],
            expo: {
              plugins: [
                "expo-font",
                ["expo-build-properties", { ios: { useFrameworks: "static" } }],
                { named: "object-plugin" },
                [],
              ],
            },
          },
        },
      }));

      assert.deepEqual(plugins, [
        "expo-font",
        "expo-build-properties",
        "{\"named\":\"object-plugin\"}",
        "",
      ]);
      assert.equal(formatExpoPluginEntry("expo-router"), "expo-router");
      assert.equal(formatExpoPluginEntry(["expo-camera", { cameraPermission: "Allow" }]), "expo-camera");
      assert.equal(formatExpoPluginEntry([]), "");
      assert.equal(formatExpoPluginEntry({ plugin: "custom" }), "{\"plugin\":\"custom\"}");
    });

    it("extracts quoted plugin names from dynamic app.config files with conservative regex parsing", async () => {
      const configPath = `${PROJECT}/app.config.ts`;
      const plugins = await readExpoAppConfigPlugins(PROJECT, fakeDeps({
        existingPaths: [configPath],
        textFiles: {
          [configPath]: `
export default {
  plugins: ["expo-font", 'expo-camera', \`expo-router\`],
};
`,
        },
      }));

      assert.deepEqual(plugins, ["expo-font", "expo-camera", "expo-router"]);
    });

    it("returns no plugins when app.json has a non-array plugin field or no config file exists", async () => {
      assert.deepEqual(await readExpoAppConfigPlugins(PROJECT, fakeDeps({
        existingPaths: [`${PROJECT}/app.json`],
        jsonFiles: {
          [`${PROJECT}/app.json`]: { expo: { plugins: "expo-font" } },
        },
      })), []);
      assert.deepEqual(await readExpoAppConfigPlugins(PROJECT, fakeDeps({ firstExistingName: null })), []);
    });
  });

  describe("prebuild risk planning", () => {
    it("orders native project risks, config-plugin dependency risks, and app-config plugin risks like legacy code", async () => {
      const modules: ExpoModuleRecord[] = [
        { name: "expo-camera", version: "~17.0.0", category: "expo" },
        { name: "@config-plugins/react-native-ble-plx", version: "^9.0.0", category: "config-plugin" },
        { name: "custom-config-plugin", version: "1.0.0", category: "config-plugin" },
      ];

      const risks = await expoPrebuildRisks(PROJECT, modules, fakeDeps({
        existingPaths: [`${PROJECT}/ios`, `${PROJECT}/android`, `${PROJECT}/app.json`],
        jsonFiles: {
          [`${PROJECT}/app.json`]: { expo: { plugins: ["expo-font"] } },
        },
      }));

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
      assert.equal(expoPrebuildRiskLevel(risks), "high");
      assert.equal(expoPrebuildRiskLevel(risks.slice(2)), "medium");
      assert.equal(expoPrebuildRiskLevel([]), "low");
    });

    it("reports dynamic and static config limitations with the exact legacy messages", () => {
      assert.deepEqual(expoConfigLimitations({ appConfig: { dynamic: true } }), [
        "Dynamic Expo config was summarized with static string extraction and may omit computed values.",
      ]);
      assert.deepEqual(expoConfigLimitations({ appConfig: null }), [
        "Expo config is summarized from project files; native runtime overrides are not included.",
      ]);
    });
  });

  describe("expo command action payloads", () => {
    it("returns the config summary payload with static limitations", async () => {
      assert.deepEqual(unwrapToolJson(await expoCommand({ action: "config" }, fakeDeps({
        summary: {
          projectRoot: PROJECT,
          expoDependency: "^54.0.0",
          reactNativeDependency: "0.81.4",
          appConfig: { source: "app.json", name: "Fixture" },
        },
      }))), {
        available: true,
        action: "config",
        sources: ["project"],
        projectRoot: PROJECT,
        expoDependency: "^54.0.0",
        reactNativeDependency: "0.81.4",
        appConfig: { source: "app.json", name: "Fixture" },
        limitations: ["Expo config is summarized from project files; native runtime overrides are not included."],
      });
    });

    it("returns modules with dependency metadata and the static runtime limitation", async () => {
      assert.deepEqual(unwrapToolJson(await expoCommand({ action: "modules" }, fakeDeps({
        jsonFiles: {
          [PACKAGE_JSON]: {
            dependencies: { expo: "^54.0.0", "expo-camera": "~17.0.0" },
            devDependencies: { "custom-config-plugin": "1.0.0" },
          },
        },
      }))), {
        available: true,
        action: "modules",
        sources: ["project"],
        projectRoot: PROJECT,
        expoDependency: "^54.0.0",
        reactNativeDependency: "0.81.4",
        modules: [
          { name: "custom-config-plugin", version: "1.0.0", category: "config-plugin" },
          { name: "expo", version: "^54.0.0", category: "expo" },
          { name: "expo-camera", version: "~17.0.0", category: "expo" },
        ],
        limitations: ["Static dependency inspection cannot prove which native modules are currently compiled into the running app."],
      });
    });

    it("returns prebuild-plan risk level, risk list, and only config-plugin modules", async () => {
      assert.deepEqual(unwrapToolJson(await expoCommand({ action: "prebuild-plan" }, fakeDeps({
        existingPaths: [`${PROJECT}/ios`, `${PROJECT}/app.json`],
        jsonFiles: {
          [PACKAGE_JSON]: {
            dependencies: { expo: "^54.0.0", "expo-camera": "~17.0.0" },
            devDependencies: { "custom-config-plugin": "1.0.0" },
          },
          [`${PROJECT}/app.json`]: { expo: { plugins: ["expo-font"] } },
        },
        summary: {
          projectRoot: PROJECT,
          expoDependency: "^54.0.0",
          reactNativeDependency: "0.81.4",
          appConfig: { source: "app.json", name: "Fixture" },
        },
      }))), {
        available: true,
        action: "prebuild-plan",
        sources: ["project"],
        projectRoot: PROJECT,
        riskLevel: "high",
        risks: [
          {
            kind: "native-project-present",
            platform: "ios",
            severity: "high",
            message: "ios native project exists; config and native module changes may require a rebuild.",
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
        ],
        modules: [{ name: "custom-config-plugin", version: "1.0.0", category: "config-plugin" }],
        appConfig: { source: "app.json", name: "Fixture" },
        limitations: [
          "This static plan flags rebuild risk; it does not run expo prebuild or mutate native projects.",
          "Dynamic app.config files are read with conservative string extraction only.",
        ],
      });
    });

    it("wraps doctor output and upstream-policy output from dependent project tools", async () => {
      assert.deepEqual(unwrapToolJson(await expoCommand({ action: "doctor" }, fakeDeps({
        doctorPayload: toolJson({ project: { ok: true } }),
      }))), {
        available: true,
        action: "doctor",
        sources: ["project", "native"],
        projectRoot: PROJECT,
        summary: { project: { ok: true } },
      });

      assert.deepEqual(unwrapToolJson(await expoCommand({ action: "upstream-policy" }, fakeDeps({
        projectInfoPayload: toolJson({
          isExpoProject: true,
          upstreamDependencies: { status: "from-info" },
        }),
      }))), {
        available: true,
        action: "upstream-policy",
        sources: ["project"],
        projectRoot: PROJECT,
        report: { status: "from-info" },
        limitations: [
          "Static dependency policy cannot prove a runtime target is registered; run DevTools and bridge health checks for live domains.",
        ],
      });

      assert.deepEqual(unwrapToolJson(await expoCommand({ action: "upstream-policy" }, fakeDeps({
        projectInfoPayload: toolJson({ isExpoProject: false }),
        upstreamFallback: { status: "fallback" },
      }))), {
        available: false,
        action: "upstream-policy",
        sources: ["project"],
        projectRoot: PROJECT,
        report: { status: "fallback" },
        limitations: [
          "Static dependency policy cannot prove a runtime target is registered; run DevTools and bridge health checks for live domains.",
        ],
      });
    });
  });
});

