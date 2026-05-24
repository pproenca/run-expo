import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import {
  CLI_NAME,
  CLI_VERSION,
  MAX_OUTPUT,
  buildUpstreamDependencyReport,
  classifyExpoReactNativeCompatibility,
  dependencyInfo,
  dependencyStatus,
  detectPackageManager,
  doctor,
  doctorRepairs,
  findUp,
  formatError,
  parseVersionLike,
  projectInfo,
  projectInfoAppConfigSummary,
  readExpoConfigSummary,
  resolveExpoStateRoot,
  safeToolSection,
  toolJson,
  truncate,
  unwrapToolJson,
} from "../main/index.js";
import type { DependencyInfo } from "../main/index.js";

async function tempProject(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), `expo98-project-info-doctor-${prefix}-`));
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

function dep(
  name: string,
  declaredVersion: string | null,
  resolvedVersion: string | null,
  unresolved = false,
): DependencyInfo {
  return {
    name,
    present: typeof declaredVersion === "string" && declaredVersion.length > 0,
    declaredVersion,
    resolvedVersion,
    unresolved,
  };
}

describe("project-info-doctor legacy characterization", () => {
  describe("tool JSON envelope, safe sections, and bounded errors", () => {
    it("wraps JSON payloads as MCP text content and unwraps JSON text when possible", () => {
      const envelope = toolJson({ ok: true, nested: ["a", 1] });

      assert.deepEqual(envelope, {
        content: [
          {
            type: "text",
            text: "{\n  \"ok\": true,\n  \"nested\": [\n    \"a\",\n    1\n  ]\n}\n",
          },
        ],
        isError: false,
      });
      assert.deepEqual(unwrapToolJson(envelope), { ok: true, nested: ["a", 1] });
      assert.deepEqual(unwrapToolJson({ content: [{ type: "text", text: "plain output" }] }), { text: "plain output" });
      assert.deepEqual(unwrapToolJson({ payload: true }), { payload: true });
    });

    it("returns safeToolSection success values and formats thrown errors with stdout and stderr", async () => {
      assert.deepEqual(await safeToolSection(() => ({ value: 42 })), {
        ok: true,
        value: { value: 42 },
      });

      const stdout = "x".repeat(MAX_OUTPUT + 5);
      const stderr = "short stderr";
      const error = Object.assign(new Error("fixture failure"), { stdout, stderr });

      assert.deepEqual(await safeToolSection(() => {
        throw error;
      }), {
        ok: false,
        error: `fixture failure\n\nstdout:\n${"x".repeat(MAX_OUTPUT)}\n[truncated 5 characters]\n\nstderr:\nshort stderr`,
      });
      assert.equal(formatError(null), "Unknown error");
      assert.equal(truncate("abcdef", 3), "abc\n[truncated 3 characters]");
      assert.equal(truncate(null, 3), "");
    });
  });

  describe("filesystem root discovery and package manager detection", () => {
    it("reports a stable non-project shape when no package.json exists upward", async () => {
      const cwd = await tempProject("empty");

      assert.deepEqual(unwrapToolJson(await projectInfo({ cwd })), {
        cwd,
        isExpoProject: false,
        reason: "No package.json found in this directory or its parents.",
      });
    });

    it("normalizes nested cwd by finding the nearest package.json project root", async () => {
      const project = await tempProject("nested-root");
      const nested = path.join(project, "app", "settings");
      await fs.mkdir(nested, { recursive: true });
      await writeJson(path.join(project, "package.json"), {
        scripts: { start: "expo start", ios: "expo run:ios" },
        dependencies: {
          expo: "^54.0.0",
          "react-native": "0.81.4",
          "expo-router": "^6.0.0",
        },
      });
      await writeJson(path.join(project, "package-lock.json"), {});

      assert.equal(await findUp(nested, "package.json"), path.join(project, "package.json"));
      assert.deepEqual(unwrapToolJson(await projectInfo({ cwd: nested })), {
        cwd: nested,
        projectRoot: project,
        isExpoProject: true,
        packageManager: "npm",
        expoDependency: "^54.0.0",
        reactNativeDependency: "0.81.4",
        expoRouterDependency: "^6.0.0",
        upstreamDependencies: buildUpstreamDependencyReport(project, {
          expo: "^54.0.0",
          "react-native": "0.81.4",
          "expo-router": "^6.0.0",
        }),
        scripts: { start: "expo start", ios: "expo run:ios" },
        appConfig: null,
        hasDynamicAppConfig: false,
        eas: null,
      });
    });

    it("detects package managers by walking upward with legacy pnpm, yarn, bun, npm precedence per directory", async () => {
      const workspace = await tempProject("package-manager");
      const app = path.join(workspace, "apps", "mobile");
      await fs.mkdir(app, { recursive: true });

      await fs.writeFile(path.join(workspace, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
      assert.equal(await detectPackageManager(app), "pnpm");

      await fs.writeFile(path.join(app, "package-lock.json"), "{}\n");
      assert.equal(await detectPackageManager(app), "npm");

      await fs.writeFile(path.join(app, "bun.lock"), "\n");
      assert.equal(await detectPackageManager(app), "bun");

      await fs.writeFile(path.join(app, "yarn.lock"), "\n");
      assert.equal(await detectPackageManager(app), "yarn");

      await fs.writeFile(path.join(app, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
      assert.equal(await detectPackageManager(app), "pnpm");

      const unknown = await tempProject("no-lock");
      assert.equal(await detectPackageManager(unknown), "unknown");
    });
  });

  describe("app config and EAS summaries", () => {
    it("summarizes static app.json Expo config through project-info", async () => {
      const project = await tempProject("app-json");
      await writeJson(path.join(project, "package.json"), {
        dependencies: {
          expo: "^54.0.0",
          "react-native": "0.81.4",
        },
      });
      await writeJson(path.join(project, "app.json"), {
        expo: {
          name: "Fixture App",
          slug: "fixture-app",
          scheme: "fixture",
          userInterfaceStyle: "dark",
          ios: { bundleIdentifier: "com.example.fixture" },
          android: { package: "com.example.fixture" },
          extra: { eas: { projectId: "fixture-project-id" } },
        },
      });

      const summary = await readExpoConfigSummary(project);

      assert.deepEqual(summary, {
        source: path.join(project, "app.json"),
        name: "Fixture App",
        slug: "fixture-app",
        scheme: "fixture",
        iosBundleIdentifier: "com.example.fixture",
        androidPackage: "com.example.fixture",
        easProjectId: "fixture-project-id",
        userInterfaceStyle: "dark",
      });
      assert.deepEqual(projectInfoAppConfigSummary(summary as Record<string, unknown>), {
        source: "app.json",
        name: "Fixture App",
        slug: "fixture-app",
        scheme: "fixture",
        iosBundleIdentifier: "com.example.fixture",
        androidPackage: "com.example.fixture",
        easProjectId: "fixture-project-id",
        userInterfaceStyle: "dark",
      });
    });

    it("summarizes dynamic app.config files with regex extraction and marks them dynamic", async () => {
      const project = await tempProject("dynamic-config");
      await writeJson(path.join(project, "package.json"), {
        dependencies: {
          expo: "catalog:",
          "react-native": "catalog:",
          "expo-router": "catalog:",
        },
      });
      await fs.writeFile(path.join(project, "app.config.ts"), `
export default () => ({
  name: "Dynamic Fixture",
  slug: "dynamic-fixture",
  scheme: "dynamic-fixture",
  userInterfaceStyle: "automatic",
  ios: { bundleIdentifier: "com.example.dynamic" },
  android: { package: "com.example.dynamic" },
  extra: { eas: { projectId: "dynamic-project-id" } },
});
`);

      assert.deepEqual(unwrapToolJson(await projectInfo({ cwd: project })), {
        cwd: project,
        projectRoot: project,
        isExpoProject: true,
        packageManager: "unknown",
        expoDependency: "catalog:",
        reactNativeDependency: "catalog:",
        expoRouterDependency: "catalog:",
        upstreamDependencies: buildUpstreamDependencyReport(project, {
          expo: "catalog:",
          "react-native": "catalog:",
          "expo-router": "catalog:",
        }),
        scripts: {},
        appConfig: {
          source: "app.config.ts",
          name: "Dynamic Fixture",
          slug: "dynamic-fixture",
          scheme: "dynamic-fixture",
          iosBundleIdentifier: "com.example.dynamic",
          androidPackage: "com.example.dynamic",
          easProjectId: "dynamic-project-id",
          userInterfaceStyle: "automatic",
          dynamic: true,
        },
        hasDynamicAppConfig: true,
        eas: null,
      });
    });

    it("summarizes EAS build and submit profile names plus cli settings", async () => {
      const project = await tempProject("eas");
      await writeJson(path.join(project, "package.json"), {
        dependencies: { expo: "^54.0.0" },
      });
      await writeJson(path.join(project, "eas.json"), {
        cli: { version: ">= 12.0.0", appVersionSource: "remote" },
        build: { development: {}, preview: {}, production: {} },
        submit: { production: {}, store: {} },
      });

      const payload = unwrapToolJson(await projectInfo({ cwd: project })) as Record<string, unknown>;

      assert.deepEqual(payload.eas, {
        buildProfiles: ["development", "preview", "production"],
        submitProfiles: ["production", "store"],
        cli: { version: ">= 12.0.0", appVersionSource: "remote" },
      });
    });
  });

  describe("dependency parsing and Expo/React Native compatibility", () => {
    it("parses declared, resolved, unresolved, missing, and status fields", () => {
      assert.deepEqual(dependencyInfo({ expo: "^54.0.0" }, "expo"), {
        name: "expo",
        present: true,
        declaredVersion: "^54.0.0",
        resolvedVersion: "54.0.0",
        unresolved: false,
      });
      assert.deepEqual(dependencyInfo({ expo: "workspace:*" }, "expo"), {
        name: "expo",
        present: true,
        declaredVersion: "workspace:*",
        resolvedVersion: null,
        unresolved: true,
      });
      assert.deepEqual(dependencyInfo({ expo: "file:../expo-54.0.0.tgz" }, "expo"), {
        name: "expo",
        present: true,
        declaredVersion: "file:../expo-54.0.0.tgz",
        resolvedVersion: "54.0.0",
        unresolved: true,
      });
      assert.deepEqual(dependencyInfo({}, "expo"), {
        name: "expo",
        present: false,
        declaredVersion: null,
        resolvedVersion: null,
        unresolved: false,
      });

      assert.equal(parseVersionLike("~0.81.4"), "0.81.4");
      assert.equal(parseVersionLike("catalog:"), null);
      assert.equal(dependencyStatus(dep("expo", null, null)), "missing");
      assert.equal(dependencyStatus(dep("expo", "catalog:", null, true)), "declared-unresolved");
      assert.equal(dependencyStatus(dep("expo", "^54.0.0", "54.0.0")), "present");
    });

    it("classifies Expo/RN compatibility states from the legacy SDK table", () => {
      assert.deepEqual(
        classifyExpoReactNativeCompatibility(
          dep("expo", "^54.0.0", "54.0.0"),
          dep("react-native", "0.81.4", "0.81.4"),
        ),
        {
          forExpo: {
            state: "compatible",
            expected: "Expo SDK 54 expects React Native 0.81.x.",
            expo: "^54.0.0",
            reactNative: "0.81.4",
          },
          forReactNative: {
            state: "compatible",
            expected: "Expo SDK 54 expects React Native 0.81.x.",
            expo: "^54.0.0",
            reactNative: "0.81.4",
          },
        },
      );
      assert.equal(
        classifyExpoReactNativeCompatibility(
          dep("expo", "^54.0.0", "54.0.0"),
          dep("react-native", "0.74.5", "0.74.5"),
        ).forExpo.state,
        "mismatched",
      );
      assert.deepEqual(
        classifyExpoReactNativeCompatibility(dep("expo", "^54.0.0", "54.0.0"), dep("react-native", null, null)),
        {
          forExpo: {
            state: "missing",
            expected: "Declare both expo and react-native to classify SDK compatibility.",
          },
          forReactNative: {
            state: "missing",
            expected: "Declare both expo and react-native to classify SDK compatibility.",
          },
        },
      );
      assert.equal(
        classifyExpoReactNativeCompatibility(
          dep("expo", "catalog:", null, true),
          dep("react-native", "catalog:", null, true),
        ).forReactNative.state,
        "declared-unresolved",
      );
      assert.equal(
        classifyExpoReactNativeCompatibility(
          dep("expo", "^99.0.0", "99.0.0"),
          dep("react-native", "0.99.0", "0.99.0"),
        ).forExpo.state,
        "unknown",
      );
    });

    it("builds upstream dependency report summaries with stable IDs, policy categories, and statuses", () => {
      const projectRoot = "/repo/apps/mobile";
      const report = buildUpstreamDependencyReport(projectRoot, {
        expo: "^54.0.0",
        "react-native": "0.74.5",
        "@rozenite/runtime": "workspace:*",
      }) as Record<string, any>;

      assert.equal(report.schemaVersion, 1);
      assert.equal(report.projectRoot, projectRoot);
      assert.deepEqual(report.policy.categories, [
        { id: "public-api", mayImportDirectly: true, requiresShim: false },
        { id: "documented-unstable-api", mayImportDirectly: false, requiresShim: true },
        { id: "internal-reference-only", mayImportDirectly: false, requiresShim: true },
        { id: "optional-compatibility-shim", mayImportDirectly: false, requiresShim: true },
      ]);
      assert.deepEqual(report.dependencies.map((dependency: any) => [dependency.id, dependency.status]), [
        ["expo-public-api", "present"],
        ["metro-inspector-http", "inferred-transitive"],
        ["hermes-react-native-cdp", "present"],
        ["react-native-devtools", "reference-only"],
        ["expo-devtools-plugin", "present"],
        ["rozenite-devtools-bridge", "declared-unresolved"],
        ["expo-cli-internals", "not-depended-on"],
      ]);
      assert.deepEqual(report.summary, {
        total: 7,
        directDependencies: 2,
        internalReferenceOnly: 1,
        optionalCompatibilityShims: 2,
        statuses: {
          present: 3,
          "inferred-transitive": 1,
          "reference-only": 1,
          "declared-unresolved": 1,
          "not-depended-on": 1,
        },
        mismatched: ["expo-public-api", "hermes-react-native-cdp"],
        missing: [],
      });
    });
  });

  describe("doctor command capabilities and read-only repairs", () => {
    it("reports commandPath capabilities, read-only auth, project info, and no repairs unless fix is true", async () => {
      const cwd = await tempProject("doctor");
      const commands: Record<string, string | null> = {
        node: "/usr/bin/node",
        npx: "/usr/bin/npx",
        xcrun: "/usr/bin/xcrun",
        open: "/usr/bin/open",
        plutil: "/usr/bin/plutil",
        idb: null,
        axe: "/opt/homebrew/bin/axe",
        adb: null,
      };

      assert.deepEqual(unwrapToolJson(await doctor({
        cwd,
        deps: {
          commandPath: async (command) => commands[command] ?? null,
          hasFetch: true,
          hasWebSocket: true,
        },
      })), {
        cli: { name: CLI_NAME, version: CLI_VERSION },
        cwd,
        auth: { required: false, source: "not-required" },
        commands,
        capabilities: {
          iosSimulator: true,
          simulatorScreenshots: true,
          iosCoordinateTap: true,
          iosCoordinateGestures: true,
          iosHierarchy: true,
          androidDeviceBridge: false,
          expoCli: true,
          metroHermes: true,
        },
        repairs: [],
        project: {
          cwd,
          isExpoProject: false,
          reason: "No package.json found in this directory or its parents.",
        },
      });
    });

    it("fix creates .scratch/expo-ios runs and sessions directories and returns repair records", async () => {
      const cwd = await tempProject("repairs");
      const stateRoot = path.join(cwd, ".scratch", "expo-ios");
      const outside = await tempProject("outside-state");

      assert.equal(resolveExpoStateRoot({ cwd }), stateRoot);
      assert.equal(resolveExpoStateRoot({ stateDir: path.join(stateRoot, "runs") }), stateRoot);
      assert.deepEqual(await doctorRepairs(cwd), [
        { action: "ensure-directory", path: path.join(stateRoot, "runs") },
        { action: "ensure-directory", path: path.join(stateRoot, "sessions") },
      ]);

      assert.equal((await fs.stat(path.join(stateRoot, "runs"))).isDirectory(), true);
      assert.equal((await fs.stat(path.join(stateRoot, "sessions"))).isDirectory(), true);

      const payload = unwrapToolJson(await doctor({
        cwd,
        fix: true,
        stateDir: outside,
        deps: { commandPath: async () => null, hasFetch: false, hasWebSocket: false },
      } as any)) as Record<string, any>;

      assert.deepEqual(payload.repairs, [
        { action: "ensure-directory", path: path.join(stateRoot, "runs") },
        { action: "ensure-directory", path: path.join(stateRoot, "sessions") },
      ]);
      await assert.rejects(fs.stat(path.join(outside, "runs")));
    });

    it("uses a default commandPath adapter for doctor when no test dependency is injected", async () => {
      const cwd = await tempProject("doctor-default");
      const payload = unwrapToolJson(await doctor({ cwd })) as Record<string, any>;

      assert.equal(typeof payload.commands.node === "string" || payload.commands.node === null, true);
      assert.equal(typeof payload.capabilities.metroHermes, "boolean");
      assert.deepEqual(payload.auth, { required: false, source: "not-required" });
    });
  });
});
