import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const PROJECT_ROOT = fileURLToPath(new URL("../", import.meta.url));
const MAKEFILE_PATH = path.join(PROJECT_ROOT, "Makefile");
const CLI_PATH = path.join(PROJECT_ROOT, "cli", "expo-ios.mjs");
const TEST_TMP = path.join(PROJECT_ROOT, ".scratch", "tests");

function runMake(args, options) {
  return new Promise((resolve) => {
    const child = spawn("make", args, {
      cwd: options.cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("close", (code) => resolve({ code, stdout, stderr }));
    child.on("error", (error) => resolve({ code: null, stdout, stderr: String(error) }));
  });
}

test("install-local resolves the CLI path relative to the Makefile", async (t) => {
  await fs.mkdir(TEST_TMP, { recursive: true });
  const workdir = await fs.mkdtemp(path.join(TEST_TMP, "make-cwd-"));
  const prefix = await fs.mkdtemp(path.join(TEST_TMP, "make-prefix-"));
  t.after(async () => {
    await fs.rm(workdir, { recursive: true, force: true });
    await fs.rm(prefix, { recursive: true, force: true });
  });

  const result = await runMake([
    "-f",
    MAKEFILE_PATH,
    "install-local",
    `PREFIX=${prefix}`,
  ], { cwd: workdir });

  assert.equal(result.code, 0, result.stderr || result.stdout);
  assert.equal(await fs.readlink(path.join(prefix, "bin", "expo-ios")), CLI_PATH);
});
