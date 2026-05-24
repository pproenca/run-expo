import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  CLI_WRAPPER_CONTRACT,
  LEGACY_PACKAGE_FILES,
  LEGACY_PACKAGE_MANIFEST,
  MAKEFILE_TARGETS,
  MODERN_CLI_WRAPPER_CONTRACT,
  MODERN_PACKAGE_FILES,
  MODERN_PACKAGE_MANIFEST,
  buildCliWrapperSource,
  buildModernCompatibilityWrapperSource,
  createLocalInstallPlan,
  modernPackageScriptCommand,
  packageScriptCommand,
} from "../main/index.js";

describe("package-entrypoints legacy characterization", () => {
  it("preserves package manifest identity, bin, scripts, engines, and published files", () => {
    assert.deepEqual(LEGACY_PACKAGE_MANIFEST, {
      name: "expo98",
      version: "0.1.0",
      private: true,
      description: "Standalone expo-ios local evidence CLI for Expo React Native iOS work.",
      type: "module",
      bin: { "expo-ios": "./cli/expo-ios.mjs" },
      scripts: {
        doctor: "node cli/expo-ios.mjs --json doctor",
        test: "node --test tests/*.mjs",
      },
      engines: { node: ">=20" },
      files: LEGACY_PACKAGE_FILES,
    });
    assert.deepEqual(LEGACY_PACKAGE_FILES, [
      "cli/",
      "dist/",
      "skills/",
      "src/",
      "SPEC.md",
      "README.md",
      "LICENSE",
    ]);
    assert.equal(packageScriptCommand("doctor"), "node cli/expo-ios.mjs --json doctor");
    assert.equal(packageScriptCommand("missing"), null);
  });

  it("preserves Makefile local install targets and path semantics", () => {
    assert.deepEqual(MAKEFILE_TARGETS, ["install-local", "test", "doctor"]);

    const plan = createLocalInstallPlan({
      makefileDir: "/repo/expo98/",
      prefix: "/home/user/.local",
    });

    assert.deepEqual(plan, {
      binDir: "/home/user/.local/bin",
      cliPath: "/repo/expo98/cli/expo-ios.mjs",
      linkPath: "/home/user/.local/bin/expo-ios",
      commands: [
        ["mkdir", "-p", "/home/user/.local/bin"],
        ["ln", "-sf", "/repo/expo98/cli/expo-ios.mjs", "/home/user/.local/bin/expo-ios"],
        ["chmod", "+x", "/repo/expo98/cli/expo-ios.mjs"],
      ],
      message: "Installed expo-ios to /home/user/.local/bin/expo-ios",
    });
  });

  it("normalizes Makefile directory and default prefix for install plans", () => {
    assert.deepEqual(createLocalInstallPlan({ makefileDir: "/repo/expo98" }), {
      binDir: "~/.local/bin",
      cliPath: "/repo/expo98/cli/expo-ios.mjs",
      linkPath: "~/.local/bin/expo-ios",
      commands: [
        ["mkdir", "-p", "~/.local/bin"],
        ["ln", "-sf", "/repo/expo98/cli/expo-ios.mjs", "~/.local/bin/expo-ios"],
        ["chmod", "+x", "/repo/expo98/cli/expo-ios.mjs"],
      ],
      message: "Installed expo-ios to ~/.local/bin/expo-ios",
    });
  });

  it("preserves the CLI wrapper shebang and dist import delegation", () => {
    assert.deepEqual(CLI_WRAPPER_CONTRACT, {
      shebang: "#!/usr/bin/env node",
      importPath: "../dist/expo-ios.mjs",
    });
    assert.equal(buildCliWrapperSource(), "#!/usr/bin/env node\n\nimport \"../dist/expo-ios.mjs\";\n");
  });

  it("defines the npx-facing expo98 package manifest and compatibility bin", () => {
    assert.deepEqual(MODERN_PACKAGE_MANIFEST, {
      name: "expo98",
      version: "0.1.0",
      description: "Modernized expo98 local evidence CLI for Expo React Native work.",
      type: "module",
      bin: {
        "expo98": "./cli/expo98.mjs",
        "expo-ios": "./cli/expo-ios.mjs",
      },
      scripts: {
        build: "node scripts/build-bundled-cli.mjs",
        doctor: "node cli/expo98.mjs --json doctor",
        prepack: "npm run build",
        test: "node --test tests/*.mjs",
      },
      engines: { node: ">=20" },
      files: MODERN_PACKAGE_FILES,
      dependencies: {
        esbuild: "^0.25.12",
      },
    });
    assert.deepEqual(MODERN_PACKAGE_FILES, [
      "cli/",
      "README.md",
    ]);
    assert.equal(modernPackageScriptCommand("doctor"), "node cli/expo98.mjs --json doctor");
    assert.equal(modernPackageScriptCommand("missing"), null);
    assert.deepEqual(MODERN_CLI_WRAPPER_CONTRACT, {
      shebang: "#!/usr/bin/env node",
      importPath: "./expo98.mjs",
    });
    assert.equal(buildModernCompatibilityWrapperSource(), "#!/usr/bin/env node\n\nimport \"./expo98.mjs\";\n");
  });

  it("matches the materialized modernized package root used by npx", async () => {
    const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
    const rootPackageJson = JSON.parse(await readFile(resolve(packageRoot, "package.json"), "utf8"));
    const expo98Wrapper = await readFile(resolve(packageRoot, "cli", "expo98.mjs"), "utf8");
    const compatibilityWrapper = await readFile(resolve(packageRoot, "cli", "expo-ios.mjs"), "utf8");

    assert.deepEqual(rootPackageJson, MODERN_PACKAGE_MANIFEST);
    assert.match(expo98Wrapper, /^#!\/usr\/bin\/env node\n/);
    assert.equal(compatibilityWrapper, buildModernCompatibilityWrapperSource());
  });
});
