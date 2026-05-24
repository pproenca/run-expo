import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  detectPackageManager,
  findUp,
  firstExisting,
  normalizeCwd,
  normalizeProjectCwd,
  pathExists,
  readJsonFile,
  walkFiles,
} from "../main/index.js";

describe("project-filesystem-helpers legacy characterization", () => {
  it("normalizes existing directories and rejects missing paths with legacy messages", async () => {
    await withTempDir(async (root) => {
      const child = path.join(root, "child");
      await fs.mkdir(child);

      assert.equal(await normalizeCwd(child), child);
      await assert.rejects(
        () => normalizeCwd(path.join(root, "missing")),
        new RegExp(`Directory does not exist: ${escapeRegExp(path.join(root, "missing"))}`),
      );
    });
  });

  it("normalizes project cwd to the nearest package.json ancestor unless missing packages are allowed", async () => {
    await withTempDir(async (root) => {
      const project = path.join(root, "project");
      const nested = path.join(project, "src", "feature");
      await fs.mkdir(nested, { recursive: true });
      await fs.writeFile(path.join(project, "package.json"), "{\"name\":\"demo\"}", "utf8");

      assert.equal(await normalizeProjectCwd(nested), project);
      assert.equal(await normalizeProjectCwd(nested, { allowMissingPackageJson: true }), nested);
    });
  });

  it("throws the legacy package.json guidance when no project root is found", async () => {
    await withTempDir(async (root) => {
      await assert.rejects(
        () => normalizeProjectCwd(root),
        new RegExp(`No package\\.json found from ${escapeRegExp(root)}\\. Pass cwd for an Expo project\\.`),
      );
      assert.equal(await normalizeProjectCwd(root, { allowMissingPackageJson: true }), root);
    });
  });

  it("findUp searches the starting directory first and then walks to the filesystem root", async () => {
    await withTempDir(async (root) => {
      const parent = path.join(root, "parent");
      const child = path.join(parent, "child");
      await fs.mkdir(child, { recursive: true });
      await fs.writeFile(path.join(parent, "package.json"), "{}", "utf8");
      await fs.writeFile(path.join(child, "app.json"), "{}", "utf8");

      assert.equal(await findUp(child, "app.json"), path.join(child, "app.json"));
      assert.equal(await findUp(child, "package.json"), path.join(parent, "package.json"));
      assert.equal(await findUp(child, "missing.json"), null);
    });
  });

  it("reads JSON through JSON.parse and propagates syntax errors", async () => {
    await withTempDir(async (root) => {
      const valid = path.join(root, "valid.json");
      const invalid = path.join(root, "invalid.json");
      await fs.writeFile(valid, "{\"expo\":{\"name\":\"Demo\"}}", "utf8");
      await fs.writeFile(invalid, "{bad", "utf8");

      assert.deepEqual(await readJsonFile(valid), { expo: { name: "Demo" } });
      await assert.rejects(() => readJsonFile(invalid), SyntaxError);
    });
  });

  it("detects package manager lockfiles in legacy priority while walking ancestors", async () => {
    await withTempDir(async (root) => {
      const project = path.join(root, "project");
      const child = path.join(project, "packages", "app");
      await fs.mkdir(child, { recursive: true });

      assert.equal(await detectPackageManager(child), "unknown");
      await fs.writeFile(path.join(project, "package-lock.json"), "", "utf8");
      assert.equal(await detectPackageManager(child), "npm");
      await fs.writeFile(path.join(project, "bun.lock"), "", "utf8");
      assert.equal(await detectPackageManager(child), "bun");
      await fs.writeFile(path.join(project, "bun.lockb"), "", "utf8");
      assert.equal(await detectPackageManager(child), "bun");
      await fs.writeFile(path.join(project, "yarn.lock"), "", "utf8");
      assert.equal(await detectPackageManager(child), "yarn");
      await fs.writeFile(path.join(project, "pnpm-lock.yaml"), "", "utf8");
      assert.equal(await detectPackageManager(child), "pnpm");
      await fs.writeFile(path.join(child, "package-lock.json"), "", "utf8");
      assert.equal(await detectPackageManager(child), "npm");
    });
  });

  it("returns the first existing candidate name and null when none exist", async () => {
    await withTempDir(async (root) => {
      await fs.writeFile(path.join(root, "app.config.js"), "", "utf8");
      await fs.writeFile(path.join(root, "app.json"), "", "utf8");

      assert.equal(
        await firstExisting(root, ["app.config.ts", "app.config.js", "app.json"]),
        path.join(root, "app.config.js"),
      );
      assert.equal(await firstExisting(root, ["missing-a", "missing-b"]), null);
    });
  });

  it("checks path existence through access without stat shape requirements", async () => {
    await withTempDir(async (root) => {
      const file = path.join(root, "file.txt");
      await fs.writeFile(file, "ok", "utf8");

      assert.equal(await pathExists(file), true);
      assert.equal(await pathExists(path.join(root, "missing.txt")), false);
    });
  });

  it("walkFiles recursively returns files while skipping node_modules and dot directories", async () => {
    await withTempDir(async (root) => {
      await fs.mkdir(path.join(root, "app", "nested"), { recursive: true });
      await fs.mkdir(path.join(root, "node_modules", "pkg"), { recursive: true });
      await fs.mkdir(path.join(root, ".expo"), { recursive: true });
      await fs.writeFile(path.join(root, "app", "index.tsx"), "", "utf8");
      await fs.writeFile(path.join(root, "app", "nested", "route.tsx"), "", "utf8");
      await fs.writeFile(path.join(root, "node_modules", "pkg", "ignored.js"), "", "utf8");
      await fs.writeFile(path.join(root, ".expo", "ignored.ts"), "", "utf8");

      assert.deepEqual((await walkFiles(root)).sort(), [
        path.join(root, "app", "index.tsx"),
        path.join(root, "app", "nested", "route.tsx"),
      ].sort());
    });
  });
});

async function withTempDir(test: (root: string) => Promise<void>): Promise<void> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "expo98-project-fs-"));
  try {
    await test(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
