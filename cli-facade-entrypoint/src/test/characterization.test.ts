import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  EXIT_RUNTIME_FAILURE,
  createCliFacade,
  defaultLastCliOptions,
} from "../main/index.js";
import type {
  CliFacadeDependencies,
  CliGlobals,
  ParsedCommand,
} from "../main/index.js";

function globals(overrides: Partial<CliGlobals> = {}): CliGlobals {
  return { ...defaultLastCliOptions(), ...overrides };
}

describe("cli-facade-entrypoint legacy characterization", () => {
  it("parses argv, stores parsed globals as last CLI options, and delegates to dispatch", async () => {
    const parsed: ParsedCommand = {
      command: "project-info",
      args: { _: [], cwd: "/repo/app" },
      globals: globals({ json: true, debug: true, maxOutput: "1200" }),
    };
    const calls: ParsedCommand[] = [];

    const facade = createCliFacade({
      parseCliArgs: (argv) => {
        assert.deepEqual(argv, ["--json", "project-info", "--cwd", "/repo/app"]);
        return parsed;
      },
      dispatchCommand: async (item) => {
        calls.push(item);
        return 0;
      },
      writeCliError: () => {
        throw new Error("writeCliError should not be called");
      },
      exitCodeForError: () => 1,
    });

    assert.deepEqual(facade.getLastCliOptions(), defaultLastCliOptions());
    assert.equal(await facade.main(["--json", "project-info", "--cwd", "/repo/app"]), 0);
    assert.deepEqual(calls, [parsed]);
    assert.deepEqual(facade.getLastCliOptions(), parsed.globals);
  });

  it("run returns dispatch exit codes without writing an error", async () => {
    const errors: Array<{ error: unknown; options: CliGlobals }> = [];
    const facade = createCliFacade({
      parseCliArgs: () => ({ command: "help", args: { _: [] }, globals: globals({ plain: true }) }),
      dispatchCommand: () => 0,
      writeCliError: (error, options) => errors.push({ error, options }),
      exitCodeForError: () => EXIT_RUNTIME_FAILURE,
    });

    assert.equal(await facade.run(["help"]), 0);
    assert.deepEqual(errors, []);
    assert.equal(facade.getLastCliOptions().plain, true);
  });

  it("run writes command errors with the last parsed CLI options and returns the classified exit code", async () => {
    const failure = Object.assign(new Error("Unknown command: nope"), { exitCode: 2 });
    const errors: Array<{ error: unknown; options: CliGlobals }> = [];
    const facade = createCliFacade({
      parseCliArgs: () => ({ command: "nope", args: { _: [] }, globals: globals({ json: true, quiet: true }) }),
      dispatchCommand: () => {
        throw failure;
      },
      writeCliError: (error, options) => errors.push({ error, options }),
      exitCodeForError: (error) => (error as { exitCode?: number }).exitCode ?? 1,
    });

    assert.equal(await facade.run(["--json", "--quiet", "nope"]), 2);
    assert.deepEqual(errors, [{ error: failure, options: globals({ json: true, quiet: true }) }]);
    assert.deepEqual(facade.getLastCliOptions(), globals({ json: true, quiet: true }));
  });

  it("parse failures keep the previous last options, matching the legacy process catch boundary", async () => {
    const parseFailure = Object.assign(new Error("--root requires a value."), { exitCode: 2 });
    const errors: Array<{ error: unknown; options: CliGlobals }> = [];
    let failParsing = false;

    const facade = createCliFacade({
      parseCliArgs: () => {
        if (failParsing) throw parseFailure;
        return { command: "doctor", args: { _: [] }, globals: globals({ plain: true }) };
      },
      dispatchCommand: () => 0,
      writeCliError: (error, options) => errors.push({ error, options }),
      exitCodeForError: (error) => (error as { exitCode?: number }).exitCode ?? 1,
    });

    assert.equal(await facade.run(["doctor"]), 0);
    failParsing = true;
    assert.equal(await facade.run(["--root"]), 2);
    assert.deepEqual(errors, [{ error: parseFailure, options: globals({ plain: true }) }]);
    assert.deepEqual(facade.getLastCliOptions(), globals({ plain: true }));
  });

  it("fresh parse failures use the legacy default last CLI options", async () => {
    const parseFailure = Object.assign(new Error("Global flag or command expected before --cwd."), { exitCode: 2 });
    const errors: Array<{ error: unknown; options: CliGlobals }> = [];

    const facade = createCliFacade({
      parseCliArgs: () => {
        throw parseFailure;
      },
      dispatchCommand: () => {
        throw new Error("dispatch should not run");
      },
      writeCliError: (error, options) => errors.push({ error, options }),
      exitCodeForError: (error) => (error as { exitCode?: number }).exitCode ?? 1,
    });

    assert.equal(await facade.run(["--cwd", "/repo"]), 2);
    assert.deepEqual(errors, [{ error: parseFailure, options: defaultLastCliOptions() }]);
    assert.deepEqual(facade.getLastCliOptions(), defaultLastCliOptions());
  });

  it("main propagates errors for process-level callers to catch", async () => {
    const failure = new Error("runtime failed");
    const facade = createCliFacade({
      parseCliArgs: () => ({ command: "doctor", args: { _: [] }, globals: globals({ debug: true }) }),
      dispatchCommand: () => {
        throw failure;
      },
      writeCliError: () => {},
      exitCodeForError: () => EXIT_RUNTIME_FAILURE,
    });

    await assert.rejects(() => facade.main(["doctor"]), /runtime failed/);
    assert.deepEqual(facade.getLastCliOptions(), globals({ debug: true }));
  });
});

