import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { configurePrepareGitHooks } from "../scripts/prepare-git-hooks.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const baseGitEnv = {
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_TERMINAL_PROMPT: "0",
};
const baseRunEnv = { ...process.env, ...baseGitEnv };

function makeTempRepoRoot(prefix) {
  return mkdtempSync(path.join(os.tmpdir(), prefix));
}

function run(cwd, cmd, args = [], env = {}) {
  return execFileSync(cmd, args, {
    cwd,
    encoding: "utf8",
    env: { ...baseRunEnv, ...env },
  }).trim();
}

function writeExecutable(dir, name, contents) {
  writeFileSync(path.join(dir, name), contents, {
    encoding: "utf8",
    mode: 0o755,
  });
}

function installPreCommitFixture(dir) {
  mkdirSync(path.join(dir, "git-hooks"), { recursive: true });
  mkdirSync(path.join(dir, "scripts", "pre-commit"), { recursive: true });
  symlinkSync(
    path.join(repoRoot, "git-hooks", "pre-commit"),
    path.join(dir, "git-hooks", "pre-commit"),
  );
  writeFileSync(
    path.join(dir, "scripts", "pre-commit", "run-node-tool.sh"),
    "#!/usr/bin/env bash\nexit 0\n",
    {
      encoding: "utf8",
      mode: 0o755,
    },
  );
  writeFileSync(
    path.join(dir, "scripts", "pre-commit", "filter-staged-files.mjs"),
    "process.exit(0);\n",
    "utf8",
  );

  const fakeBinDir = path.join(dir, "bin");
  mkdirSync(fakeBinDir, { recursive: true });
  writeExecutable(fakeBinDir, "node", "#!/usr/bin/env bash\nexit 0\n");
  return fakeBinDir;
}

function splitNonEmptyLines(output) {
  return output.split("\n").filter(Boolean);
}

function createSpawn(results) {
  return (_bin, _args) => {
    const result = results.shift();
    if (!result) {
      throw new Error("unexpected git invocation");
    }
    return result;
  };
}

test("configurePrepareGitHooks configures hooks through git without using a shell", () => {
  const calls = [];
  const spawnSync = (bin, args, options) => {
    calls.push([bin, args, options]);
    return calls.length === 1 ? { status: 0, stdout: "true\n" } : { status: 0 };
  };

  assert.deepEqual(
    configurePrepareGitHooks({
      cwd: "/repo",
      existsSync: () => true,
      spawnSync,
    }),
    { configured: true, reason: "configured" },
  );
  assert.deepEqual(calls, [
    [
      "git",
      ["rev-parse", "--is-inside-work-tree"],
      {
        cwd: "/repo",
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      },
    ],
    [
      "git",
      ["config", "core.hooksPath", "git-hooks"],
      {
        cwd: "/repo",
        encoding: "utf8",
        stdio: ["ignore", "ignore", "pipe"],
      },
    ],
  ]);
});

test("configurePrepareGitHooks quietly skips packaged installs without hooks", () => {
  assert.deepEqual(
    configurePrepareGitHooks({
      cwd: "/package",
      existsSync: () => false,
      spawnSync: createSpawn([]),
    }),
    { configured: false, reason: "missing-hooks-dir" },
  );
});

test("configurePrepareGitHooks warns without failing when git config fails", () => {
  const warnings = [];

  assert.deepEqual(
    configurePrepareGitHooks({
      cwd: "/repo",
      existsSync: () => true,
      spawnSync: createSpawn([
        { status: 0, stdout: "true\n" },
        { status: 1, stderr: "permission denied" },
      ]),
      warn: (message) => warnings.push(message),
    }),
    { configured: false, reason: "config-failed" },
  );
  assert.deepEqual(warnings, ["[prepare] could not configure git hooks: permission denied"]);
});

test("pre-commit does not treat staged filenames as git-add flags", (t) => {
  const dir = makeTempRepoRoot("expo98-pre-commit-");
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  run(dir, "git", ["init", "-q", "--initial-branch=main"]);

  const fakeBinDir = installPreCommitFixture(dir);
  writeFileSync(path.join(dir, "secret.txt"), "do-not-stage\n", "utf8");

  writeFileSync(path.join(dir, "--all"), "flag\n", "utf8");
  run(dir, "git", ["add", "--", "--all"]);

  run(dir, "bash", ["git-hooks/pre-commit"], {
    PATH: `${fakeBinDir}:${process.env.PATH ?? ""}`,
  });

  const staged = splitNonEmptyLines(run(dir, "git", ["diff", "--cached", "--name-only"]));
  assert.deepEqual(staged, ["--all"]);
});

test("pre-commit does not re-add staged paths ignored by gitignore", (t) => {
  const dir = makeTempRepoRoot("expo98-pre-commit-ignored-");
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  run(dir, "git", ["init", "-q", "--initial-branch=main"]);

  const fakeBinDir = installPreCommitFixture(dir);
  mkdirSync(path.join(dir, ".agents", "skills", "local-only"), { recursive: true });
  writeFileSync(path.join(dir, ".gitignore"), ".agents/skills/local-only/\n", "utf8");
  writeFileSync(
    path.join(dir, ".agents", "skills", "local-only", "SKILL.md"),
    "# Local Only\n",
    "utf8",
  );

  run(dir, "git", ["add", "--", ".gitignore"]);
  run(dir, "git", ["add", "-f", "--", ".agents/skills/local-only/SKILL.md"]);

  run(dir, "bash", ["git-hooks/pre-commit"], {
    PATH: `${fakeBinDir}:${process.env.PATH ?? ""}`,
  });

  const staged = splitNonEmptyLines(run(dir, "git", ["diff", "--cached", "--name-only"]));
  assert.deepEqual(staged, [".agents/skills/local-only/SKILL.md", ".gitignore"]);
});
