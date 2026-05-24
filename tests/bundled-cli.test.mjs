import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

async function runBundledCli(args) {
  return execFileAsync(process.execPath, ["cli/expo98.mjs", ...args]);
}

describe("bundled CLI entrypoint", () => {
  it("passes process argv through the executable wrapper", async () => {
    const { stdout, stderr } = await runBundledCli(["--version"]);

    assert.equal(stdout, "0.1.0\n");
    assert.equal(stderr, "");
  });

  it("wraps legacy doctor evidence with expo98 package metadata", async () => {
    const { stdout, stderr } = await runBundledCli(["--json", "doctor"]);
    const payload = JSON.parse(stdout);

    assert.equal(stderr, "");
    assert.equal(payload.ok, true);
    assert.equal(payload.data.cli.name, "expo98");
    assert.equal(payload.data.cli.bin, "expo98");
    assert.equal(payload.data.package.entrypoint, "cli/expo98.mjs");
    assert.equal(payload.data.package.compatibilityBin, "expo-ios");
    assert.equal(payload.data.runtime.required, ">=20");
  });
});
