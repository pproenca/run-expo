import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  CliUsageError,
  coerceCliValue,
  defaultGlobals,
  globalFlagTakesValue,
  normalizeGlobalFlag,
  parseCliArgs,
  parseJsonArgument,
  pickDefined,
  toCamel,
} from "../main/index.js";

describe("cli-argv-parser legacy characterization", () => {
  it("returns the legacy default globals, null command, and empty positional args for empty argv", () => {
    assert.deepEqual(parseCliArgs([]), {
      globals: {
        json: false,
        plain: false,
        quiet: false,
        verbose: false,
        debug: false,
        noColor: false,
        noInput: false,
        record: false,
        version: false,
        help: false,
        root: null,
        stateDir: null,
        actionPolicy: null,
        maxOutput: null,
        contentBoundaries: false,
        allowRuntimeEval: null,
        confirmActions: null,
      },
      command: null,
      args: { _: [] },
    });
    assert.deepEqual(defaultGlobals(), parseCliArgs([]).globals);
  });

  it("parses boolean global flags before the command", () => {
    const parsed = parseCliArgs([
      "--json",
      "--plain",
      "--quiet",
      "--verbose",
      "--debug",
      "--record",
      "--content-boundaries",
      "--no-color",
      "--no-input",
      "--help",
      "--version",
      "doctor",
    ]);

    assert.equal(parsed.command, "doctor");
    assert.deepEqual(parsed.args, { _: [] });
    assert.deepEqual(parsed.globals, {
      json: true,
      plain: true,
      quiet: true,
      verbose: true,
      debug: true,
      noColor: true,
      noInput: true,
      record: true,
      version: true,
      help: true,
      root: null,
      stateDir: null,
      actionPolicy: null,
      maxOutput: null,
      contentBoundaries: true,
      allowRuntimeEval: null,
      confirmActions: null,
    });
  });

  it("normalizes global flags with values and stores values as strings", () => {
    const parsed = parseCliArgs([
      "--root",
      "/workspace",
      "--state-dir=/tmp/state",
      "--action-policy",
      "policy.json",
      "--max-output=250",
      "--allow-runtime-eval",
      "false",
      "--confirm-actions=install-app,uninstall-app",
      "snapshot",
    ]);

    assert.equal(parsed.command, "snapshot");
    assert.equal(parsed.globals.root, "/workspace");
    assert.equal(parsed.globals.stateDir, "/tmp/state");
    assert.equal(parsed.globals.actionPolicy, "policy.json");
    assert.equal(parsed.globals.maxOutput, "250");
    assert.equal(parsed.globals.allowRuntimeEval, "false");
    assert.equal(parsed.globals.confirmActions, "install-app,uninstall-app");
  });

  it("rejects missing global flag values and unknown pre-command flags as CliUsageError", () => {
    assert.throws(
      () => parseCliArgs(["--root"]),
      (error: unknown) => error instanceof CliUsageError &&
        error.message === "--root requires a value." &&
        error.exitCode === 2,
    );
    assert.throws(
      () => parseCliArgs(["--root", "--json"]),
      /--root requires a value\./,
    );
    assert.throws(
      () => parseCliArgs(["--output-path", "out.json"]),
      /Global flag or command expected before --output-path\./,
    );
  });

  it("parses command-local flags with camelCase keys, booleans, numeric coercion, and equals syntax", () => {
    assert.deepEqual(parseCliArgs([
      "open-route",
      "/customers",
      "--include-screenshot",
      "--metro-port",
      "8081",
      "--duration-ms=250.5",
      "--restart-dev-client=false",
      "--label",
      "first",
      "--negative",
      "-4",
      "--word-number",
      "001",
    ]), {
      globals: defaultGlobals(),
      command: "open-route",
      args: {
        _: ["/customers"],
        includeScreenshot: true,
        metroPort: 8081,
        durationMs: 250.5,
        restartDevClient: false,
        label: "first",
        negative: -4,
        wordNumber: 1,
      },
    });
  });

  it("treats tokens after -- as positional args without more parsing", () => {
    assert.deepEqual(parseCliArgs(["batch", "--", "--json", "doctor", "--root", "/tmp"]), {
      globals: defaultGlobals(),
      command: "batch",
      args: { _: ["--json", "doctor", "--root", "/tmp"] },
    });
  });

  it("sets help for -h and --help anywhere instead of treating them as command-local flags", () => {
    assert.deepEqual(parseCliArgs(["-h"]), {
      globals: { ...defaultGlobals(), help: true },
      command: null,
      args: { _: [] },
    });
    assert.deepEqual(parseCliArgs(["doctor", "--help"]), {
      globals: { ...defaultGlobals(), help: true },
      command: "doctor",
      args: { _: [] },
    });
  });

  it("coerces only exact booleans and numeric-looking strings", () => {
    assert.equal(coerceCliValue("true"), true);
    assert.equal(coerceCliValue("false"), false);
    assert.equal(coerceCliValue("-1.25"), -1.25);
    assert.equal(coerceCliValue("01"), 1);
    assert.equal(coerceCliValue("1e3"), "1e3");
    assert.equal(coerceCliValue("False"), "False");
  });

  it("exposes global flag normalization, value requirement, camelization, JSON parsing, and undefined filtering helpers", () => {
    assert.equal(normalizeGlobalFlag("content-boundaries"), "contentBoundaries");
    assert.equal(normalizeGlobalFlag("no-input"), "noInput");
    assert.equal(normalizeGlobalFlag("cwd"), null);
    assert.equal(globalFlagTakesValue("root"), true);
    assert.equal(globalFlagTakesValue("json"), false);
    assert.equal(toCamel("output-path"), "outputPath");
    assert.deepEqual(parseJsonArgument("{\"ok\":true}", "--steps"), { ok: true });
    assert.throws(
      () => parseJsonArgument("{bad json", "--steps"),
      /--steps must be valid JSON:/,
    );
    assert.deepEqual(pickDefined({ a: 1, b: undefined, c: null }), { a: 1, c: null });
  });
});

