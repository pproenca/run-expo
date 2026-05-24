import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { CLI_VERSION, cliHelpText, commandLines, exampleLines, globalFlagLines, printHelp } from "../main/index.js";

describe("cli-help-surface legacy characterization", () => {
  it("starts with the legacy version banner and usage contract", () => {
    const text = cliHelpText();

    assert.equal(text.startsWith(`expo-ios ${CLI_VERSION}\n\nUsage:\n  expo-ios [global flags] <command> [options]\n`), true);
    assert.equal(text.endsWith("  expo-ios --json trace --action read --metro-port 8081\n"), true);
    assert.equal(text.includes("\nGlobal flags:\n"), true);
    assert.equal(text.includes("\nDiscovery:\n"), true);
    assert.equal(text.includes("\nSimulator and app actions:\n"), true);
    assert.equal(text.includes("\nEvidence and runtime:\n"), true);
    assert.equal(text.includes("\nExamples:\n"), true);
  });

  it("supports version injection while preserving the rest of the help text", () => {
    const custom = cliHelpText("9.8.7");
    const legacy = cliHelpText();

    assert.equal(custom.split("\n")[0], "expo-ios 9.8.7");
    assert.equal(custom.slice(custom.indexOf("\n\nUsage:")), legacy.slice(legacy.indexOf("\n\nUsage:")));
  });

  it("preserves global flags including reserved noninteractive safety flags", () => {
    assert.deepEqual(globalFlagLines(), [
      "--json                 Write { ok, data } JSON to stdout",
      "--plain                Write stable line-oriented output to stdout",
      "--quiet                Suppress non-essential human output",
      "--version              Print CLI version",
      "--root <dir>           Default project root for commands that accept --cwd",
      "--state-dir <dir>      Persist a run record JSON file in this directory",
      "--action-policy <path> Permit gated write/device actions from a JSON policy",
      "--max-output <chars>   Truncate stdout payloads after this many characters",
      "--content-boundaries   Wrap stdout data in an explicit untrusted-output boundary",
      "--allow-runtime-eval <true|false>",
      "                       Permit gated Hermes Runtime.evaluate predicates",
      "--confirm-actions <list>",
      "                       Reserved for interactive confirmations; noninteractive runs deny",
      "--record               Persist a run record under <root>/.scratch/expo-ios/runs",
      "--debug                Include debug fields in machine-readable errors",
      "--no-color             Disable color; output is uncolored by default",
      "--no-input             Reserved for noninteractive safety; this CLI never prompts",
    ]);
  });

  it("preserves command groups and runtime-only commands from the bundled CLI", () => {
    const commands = commandLines();

    assert.equal(commands.discovery.length, 14);
    assert.equal(commands.simulatorAndAppActions.length, 18);
    assert.equal(commands.evidenceAndRuntime.length, 37);
    assert.ok(commands.discovery.includes("batch                  Run multiple expo-ios command steps in one process"));
    assert.ok(commands.evidenceAndRuntime.includes("release                Run local release packaging checks"));
    assert.ok(commands.evidenceAndRuntime.includes("live-backlog           Generate or run the source-derived live backlog"));
    assert.ok(commands.evidenceAndRuntime.includes("trace                  Start/read/stop/clear a Hermes interaction trace"));
    assert.ok(commands.evidenceAndRuntime.includes("profiler start|stop    Native profiler evidence boundary alias for perf ettrace"));
    assert.ok(!commands.evidenceAndRuntime.some((line) => line.startsWith("annotation-server")));
    assert.ok(!commands.evidenceAndRuntime.some((line) => line.startsWith("review-overlay-server")));
  });

  it("preserves all example command lines and their ordering", () => {
    const examples = exampleLines();

    assert.equal(examples.length, 59);
    assert.equal(examples[0], "expo-ios --json doctor");
    assert.equal(examples[8], "expo-ios --json batch '[\"wait\",\"--text\",\"Customers\"]' '[\"get\",\"source\",\"@e1\"]' --bail true");
    assert.equal(examples[20], "expo-ios --json review-overlay scaffold --cwd apps/mobile");
    assert.equal(examples[36], "expo-ios --json bridge domains storage set --cwd apps/mobile --metro-port 8081");
    assert.equal(examples.at(-1), "expo-ios --json trace --action read --metro-port 8081");
  });

  it("writes exactly one help payload through printHelp", () => {
    const writes: string[] = [];

    printHelp((text) => writes.push(text));

    assert.deepEqual(writes, [cliHelpText()]);
  });
});
