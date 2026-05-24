import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  installCommand,
  listBundledSkills,
  parseSkillFrontmatter,
  releaseCheck,
  releaseCommand,
  skillsCommand,
  upgradeCommand,
} from "../main/index.js";
import type { PluginSelfManagementDependencies, ToolTextResult } from "../main/index.js";

describe("plugin-self-management legacy characterization", () => {
  it("lists bundled skills without content and gets one skill with content", async () => {
    const pluginRoot = await fixturePluginRoot();
    await writeSkill(pluginRoot, "zeta", "---\nname: zeta\ndescription: Last skill\n---\n# Zeta\n");
    await writeSkill(pluginRoot, "alpha-dir", "---\nname: alpha\ndescription: \"First skill\"\n---\n# Alpha\n");
    await mkdir(join(pluginRoot, "skills", "empty"), { recursive: true });

    const list = parseToolJson(await skillsCommand({ action: "list" }, deps({ pluginRoot })));
    const get = parseToolJson(await skillsCommand({ action: "get", name: "alpha" }, deps({ pluginRoot })));
    const missing = parseToolJson(await skillsCommand({ action: "get", name: "missing" }, deps({ pluginRoot })));

    assert.equal(list.available, true);
    assert.equal(list.pluginVersion, "0.1.0");
    assert.deepEqual(list.skills.map((skill: any) => skill.name), ["alpha", "zeta"]);
    assert.equal("content" in list.skills[0], false);
    assert.equal(get.available, true);
    assert.equal(get.name, "alpha");
    assert.equal(get.description, "First skill");
    assert.match(get.content, /# Alpha/);
    assert.equal(missing.available, false);
    assert.equal(missing.reason, "Skill not found.");
  });

  it("parses frontmatter, strips quotes, defaults metadata, and rejects unknown skills actions", async () => {
    const pluginRoot = await fixturePluginRoot();
    await writeSkill(pluginRoot, "plain", "# Plain\n");

    assert.deepEqual(parseSkillFrontmatter("---\nname: \"quoted\"\ndescription: 'desc'\n---\nbody"), {
      name: "quoted",
      description: "desc",
    });
    assert.deepEqual(await listBundledSkills({ pluginRoot }), [{
      name: "plain",
      description: "",
      path: join(pluginRoot, "skills", "plain", "SKILL.md"),
      content: "# Plain\n",
    }]);
    await assert.rejects(() => skillsCommand({ action: "delete" }, deps({ pluginRoot })), /Unknown skills action: delete/);
  });

  it("checks install target paths and installed state", async () => {
    const pluginRoot = await fixturePluginRoot();
    const prefix = await mkdtemp(join(tmpdir(), "expo98-prefix-"));
    await mkdir(join(prefix, "bin"), { recursive: true });
    await writeFile(join(prefix, "bin", "expo-ios"), "#!/bin/sh\n", "utf8");

    const payload = parseToolJson(await installCommand({ prefix }, deps({ pluginRoot })));

    assert.equal(payload.available, true);
    assert.equal(payload.action, "check");
    assert.equal(payload.prefix, prefix);
    assert.equal(payload.binPath, join(prefix, "bin", "expo-ios"));
    assert.equal(payload.installed, true);
    assert.equal(payload.installCommand, `make -C ${pluginRoot} install-local PREFIX=${prefix}`);
    assert.equal(payload.cliPath, join(pluginRoot, "cli", "expo-ios.mjs"));
    assert.equal(payload.version, "0.1.0");
    await assert.rejects(() => installCommand({ action: "run" }, deps({ pluginRoot })), /Unknown install action: run/);
  });

  it("reports local upgrade status without remote mutation", async () => {
    const prefix = await mkdtemp(join(tmpdir(), "expo98-prefix-"));
    const payload = parseToolJson(await upgradeCommand({ prefix }, deps({ pluginRoot: await fixturePluginRoot() })));

    assert.deepEqual(payload, {
      available: true,
      action: "check",
      prefix,
      currentVersion: "0.1.0",
      latestVersion: "0.1.0",
      upgradeAvailable: false,
      reason: "No packaged remote upgrade source is configured; local plugin version is authoritative.",
    });
    const pluginRoot = await fixturePluginRoot();
    await assert.rejects(() => upgradeCommand({ action: "apply" }, deps({ pluginRoot })), /Unknown upgrade action: apply/);
  });

  it("runs release checks against a generated route fixture and summarizes success", async () => {
    const pluginRoot = await fixturePluginRoot();
    const cwd = await mkdtemp(join(tmpdir(), "expo98-release-"));
    const calls: Array<{ argv: string[]; cwd: string }> = [];
    const execResults: Record<string, { stdout: string; stderr: string }> = {
      "--version": { stdout: "0.1.0\n", stderr: "" },
      "--help": { stdout: "help perf dashboard\n", stderr: "" },
      "--json doctor": { stdout: "{\"ok\":true}", stderr: "" },
      "--json routes --cwd": { stdout: "{\"data\":{\"routeCount\":1}}", stderr: "" },
    };
    const payload = parseToolJson(await releaseCommand({ cwd }, deps({
      pluginRoot,
      execFile: async (_file, argv, options) => {
        calls.push({ argv, cwd: options.cwd });
        const key = argv.slice(1, argv[1] === "routes" ? 4 : undefined).join(" ");
        return execResults[key] ?? { stdout: "{\"data\":{\"routeCount\":1}}", stderr: "" };
      },
    })));
    const packageJson = JSON.parse(await readFile(join(cwd, "routes-fixture", "package.json"), "utf8"));

    assert.equal(payload.available, true);
    assert.equal(payload.action, "check");
    assert.equal(payload.cwd, cwd);
    assert.equal(payload.version, "0.1.0");
    assert.deepEqual(payload.checks.map((check: any) => [check.name, check.ok]), [
      ["version", true],
      ["help", true],
      ["doctor-json", true],
      ["routes-fixture-json", true],
    ]);
    assert.equal(payload.limitations[0], "Release checks verify local CLI packaging behavior; they do not publish or mutate git state.");
    assert.equal(packageJson.dependencies.expo, "^54.0.0");
    assert.equal(calls[0]?.argv[0], join(pluginRoot, "cli", "expo-ios.mjs"));
  });

  it("formats release check failures and truncates long stdout/stderr", async () => {
    const okFalse = await releaseCheck("help", ["--help"], "/tmp", () => false, deps({
      pluginRoot: await fixturePluginRoot(),
      execFile: async () => ({ stdout: "x".repeat(1200), stderr: "e".repeat(1200) }),
    }));
    const thrown = await releaseCheck("boom", ["boom"], "/tmp", () => true, deps({
      pluginRoot: await fixturePluginRoot(),
      execFile: async () => {
        throw new Error("boom");
      },
    }));

    assert.equal(okFalse.ok, false);
    assert.equal(okFalse.exitCode, 1);
    assert.match(String(okFalse.stdout), /\.\.\.\[truncated 200 chars\]$/);
    assert.match(String(okFalse.stderr), /\.\.\.\[truncated 200 chars\]$/);
    assert.deepEqual(thrown, { name: "boom", ok: false, exitCode: 1, error: "boom" });
  });
});

async function fixturePluginRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "expo98-plugin-"));
  await mkdir(join(root, "skills"), { recursive: true });
  await mkdir(join(root, "cli"), { recursive: true });
  await writeFile(join(root, "cli", "expo-ios.mjs"), "#!/usr/bin/env node\n", "utf8");
  return root;
}

async function writeSkill(pluginRoot: string, dir: string, content: string): Promise<void> {
  await mkdir(join(pluginRoot, "skills", dir), { recursive: true });
  await writeFile(join(pluginRoot, "skills", dir, "SKILL.md"), content, "utf8");
}

function deps(overrides: Partial<PluginSelfManagementDependencies>): PluginSelfManagementDependencies {
  return overrides;
}

function parseToolJson(result: ToolTextResult): any {
  return JSON.parse(result.content[0]?.text ?? "null");
}
