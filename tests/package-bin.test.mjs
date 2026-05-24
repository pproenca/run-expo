import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const sanitizedEnv = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.toLowerCase().startsWith("npm_config_")),
);
const npxEnv = {
  ...sanitizedEnv,
  npm_config_cache: resolve(tmpdir(), "expo98-npm-cache"),
};

describe("expo98 package bin", () => {
  it("prints the modernized package version through the direct bin", async () => {
    const { stdout, stderr } = await execFileAsync(process.execPath, ["cli/expo98.mjs", "--version"]);

    assert.equal(stdout, "0.1.0\n");
    assert.equal(stderr, "");
  });

  it("runs the npx-facing binary from the package root without installing from the network", async () => {
    const { stdout, stderr } = await execFileAsync("npx", ["--no-install", "expo98", "--version"], { env: npxEnv });

    assert.equal(stdout, "0.1.0\n");
    assert.equal(stderr, "");
  });

  it("runs the local pnpm expo98 script for development testing", async () => {
    const { stdout, stderr } = await execFileAsync("pnpm", ["expo98", "--version"], { env: npxEnv });

    assert.match(stdout, /0\.1\.0\n$/);
    assert.equal(stderr, "");
  });

  it("returns JSON doctor evidence from the modernized package entrypoint", async () => {
    const { stdout } = await execFileAsync(process.execPath, ["cli/expo98.mjs", "--json", "doctor"]);
    const payload = JSON.parse(stdout);

    assert.equal(payload.ok, true);
    assert.equal(payload.data.cli.name, "expo98");
    assert.equal(payload.data.cli.bin, "expo98");
    assert.equal(payload.data.package.compatibilityBin, "expo-ios");
    assert.equal(payload.data.runtime.supported, true);
  });

  it("dispatches bundled project-info and policy commands without monorepo package imports", async () => {
    const project = await mkdtemp(resolve(tmpdir(), "expo98-package-bin-"));
    try {
      await writeFile(resolve(project, "package.json"), JSON.stringify({
        dependencies: {
          expo: "~54.0.0",
          "react-native": "0.81.0",
          "expo-router": "^5.0.0",
        },
      }), "utf8");

      const projectInfo = await execFileAsync(process.execPath, [
        "cli/expo98.mjs",
        "--json",
        "project-info",
        "--cwd",
        project,
      ]);
      const policy = await execFileAsync(process.execPath, ["cli/expo98.mjs", "--json", "policy", "show"]);

      const projectPayload = JSON.parse(projectInfo.stdout);
      const policyPayload = JSON.parse(policy.stdout);

      assert.equal(projectPayload.ok, true);
      assert.equal(projectPayload.data.isExpoProject, true);
      assert.equal(projectPayload.data.expoDependency, "~54.0.0");
      assert.equal(projectPayload.data.expoRouterDependency, "^5.0.0");
      assert.equal(policyPayload.ok, true);
      assert.equal(policyPayload.data.available, true);
      assert.equal(policyPayload.data.action, "show");
    } finally {
      await rm(project, { recursive: true, force: true });
    }
  });

  it("packs as one npm package containing the executable, not workspace package sources", async () => {
    const { stdout } = await execFileAsync("pnpm", ["pack", "--dry-run", "--json"], { env: npxEnv });
    const jsonStart = stdout.lastIndexOf("\n{");
    assert.notEqual(jsonStart, -1);
    const parsedPack = JSON.parse(stdout.slice(jsonStart + 1));
    const pack = Array.isArray(parsedPack) ? parsedPack[0] : parsedPack;
    const files = pack.files.map((file) => file.path).sort();
    const bundledCli = await readFile("cli/expo98.mjs", "utf8");
    const packageJson = JSON.parse(await readFile("package.json", "utf8"));

    assert.ok(files.includes("cli/expo98.mjs"));
    assert.ok(files.includes("cli/expo-ios.mjs"));
    assert.ok(files.includes("package.json"));
    assert.ok(files.includes("README.md"));
    assert.equal(files.some((file) => file.startsWith("package-entrypoints/")), false);
    assert.equal(files.some((file) => file.includes("/src/main/")), false);
    assert.equal(/from\s+["']\.\.\//.test(bundledCli), false);
    assert.equal(/import\s+["']\.\.\//.test(bundledCli), false);
    assert.deepEqual(packageJson.dependencies, { esbuild: "^0.25.12" });
    assert.equal(Object.hasOwn(packageJson, "devDependencies"), false);
  });
});
