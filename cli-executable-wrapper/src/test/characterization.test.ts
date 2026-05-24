import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_PROCESS_ARGV_OFFSET,
  cliArgv,
  createCliExecutable,
  runCliExecutable,
} from "../main/index.js";

describe("cli-executable-wrapper legacy characterization", () => {
  it("passes process argv after node and script to main and assigns the returned exit code", async () => {
    const calls: string[][] = [];
    const exitCodes: number[] = [];

    const exitCode = await runCliExecutable({
      argv: ["/usr/local/bin/node", "/plugin/cli/expo-ios.mjs", "--json", "doctor"],
      main: async (argv) => {
        calls.push(argv);
        return 0;
      },
      setExitCode: (code) => exitCodes.push(code),
      writeCliError: () => {
        throw new Error("writeCliError should not be called");
      },
      exitCodeForError: () => 1,
    });

    assert.equal(exitCode, 0);
    assert.deepEqual(calls, [["--json", "doctor"]]);
    assert.deepEqual(exitCodes, [0]);
  });

  it("writes and classifies rejected main errors before assigning process exit code", async () => {
    const failure = Object.assign(new Error("Unknown command: nope"), { exitCode: 2 });
    const errors: unknown[] = [];
    const exitCodes: number[] = [];

    const exitCode = await runCliExecutable({
      argv: ["node", "expo-ios", "nope"],
      main: async () => {
        throw failure;
      },
      setExitCode: (code) => exitCodes.push(code),
      writeCliError: (error) => errors.push(error),
      exitCodeForError: (error) => (error as { exitCode?: number }).exitCode ?? 1,
    });

    assert.equal(exitCode, 2);
    assert.deepEqual(errors, [failure]);
    assert.deepEqual(exitCodes, [2]);
  });

  it("uses lazy argv readers so executable wrappers see current process state", async () => {
    let currentArgv = ["node", "expo-ios", "doctor"];
    const seen: string[][] = [];
    const executable = createCliExecutable({
      argv: () => currentArgv,
      main: (argv) => {
        seen.push(argv);
        return 0;
      },
      setExitCode: () => {},
      writeCliError: () => {},
      exitCodeForError: () => 1,
    });

    assert.deepEqual(executable.argv(), ["doctor"]);
    currentArgv = ["node", "expo-ios", "--json", "routes"];
    assert.equal(await executable.run(), 0);
    assert.deepEqual(seen, [["--json", "routes"]]);
  });

  it("preserves all user arguments after the executable offset, including -- separators", () => {
    assert.deepEqual(cliArgv(["node", "expo-ios", "batch", "--", "--json", "doctor"]), [
      "batch",
      "--",
      "--json",
      "doctor",
    ]);
  });

  it("allows explicit offset overrides for embedded executable launchers", async () => {
    const seen: string[][] = [];

    await runCliExecutable({
      argv: ["expo-ios", "--json", "doctor"],
      argvOffset: 1,
      main: (argv) => {
        seen.push(argv);
        return 0;
      },
      setExitCode: () => {},
      writeCliError: () => {},
      exitCodeForError: () => 1,
    });

    assert.deepEqual(seen, [["--json", "doctor"]]);
  });

  it("falls back to the legacy offset for invalid offset values", () => {
    assert.equal(DEFAULT_PROCESS_ARGV_OFFSET, 2);
    assert.deepEqual(cliArgv(["node", "expo-ios", "doctor"], Number.NaN), ["doctor"]);
    assert.deepEqual(cliArgv(["node", "expo-ios", "doctor"], -1), ["doctor"]);
  });
});
