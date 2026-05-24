import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  CLI_RUNTIME_COMPONENT_SOURCES,
  EXIT_SUCCESS,
  assertRuntimeComponentSourcesCover,
  assertRuntimeHasHandlers,
  createCliRuntime,
  createProcessExitRunner,
  requiredRuntimeComponentRoles,
  runtimeComponentSourceByRole,
  runtimeComponentSources,
} from "../main/index.js";
import type {
  CliFacade,
  CliGlobals,
  DispatchDependencies,
  ParsedCommand,
  ToolHandler,
} from "../main/index.js";

describe("cli-runtime-composition legacy characterization", () => {
  it("binds tool implementations once and dispatches parsed commands with projected args", async () => {
    const events: unknown[] = [];
    const parsed: ParsedCommand = {
      command: "project-info",
      args: { _: [], cwd: "/repo/app" },
      globals: globals({ json: true }),
    };
    const handlers = {
      projectInfo: async (args: Record<string, unknown>) => ({ cwd: args.cwd }),
    };
    const runtime = createCliRuntime({
      parseCliArgs: (argv) => {
        events.push({ parse: argv });
        return parsed;
      },
      commandArgs: (command, args, cliGlobals) => {
        events.push({ commandArgs: { command, args, cliGlobals } });
        return { command, cwd: args.cwd, root: cliGlobals.root };
      },
      dispatchCommand: async (item, deps) => {
        const effectiveArgs = deps.projectArgs(item.command ?? "", item.args, item.globals);
        events.push({
          dispatch: item.command,
          handlerKeys: Object.keys(deps.handlers),
          effectiveArgs,
        });
        return EXIT_SUCCESS;
      },
      bindHandlers: (implementations) => {
        events.push({ bind: Object.keys(implementations) });
        return { project_info: implementations.projectInfo as ToolHandler };
      },
      createCliFacade,
      writeCliError: () => events.push({ error: "unexpected" }),
      exitCodeForError: () => 1,
      handlerImplementations: handlers,
    });

    assert.equal(await runtime.main(["--json", "project-info", "--cwd", "/repo/app"]), 0);
    assert.deepEqual(events, [
      { bind: ["projectInfo"] },
      { parse: ["--json", "project-info", "--cwd", "/repo/app"] },
      { commandArgs: { command: "project-info", args: parsed.args, cliGlobals: parsed.globals } },
      {
        dispatch: "project-info",
        handlerKeys: ["project_info"],
        effectiveArgs: { command: "project-info", cwd: "/repo/app", root: "/workspace" },
      },
    ]);
    assert.equal(runtime.handlers.project_info, handlers.projectInfo);
  });

  it("passes stdout, stderr, help text, cli version, and run recorder dependencies to dispatch", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const recordStarts: unknown[] = [];
    const seenDeps: DispatchDependencies[] = [];

    const runtime = createCliRuntime({
      parseCliArgs: () => ({ command: "help", args: { _: [] }, globals: globals({ help: true }) }),
      commandArgs: () => ({}),
      dispatchCommand: (_parsed, deps) => {
        seenDeps.push(deps);
        deps.stdout?.(deps.printHelp?.() ?? "");
        deps.stderr?.(`${deps.cliVersion}\n`);
        return EXIT_SUCCESS;
      },
      bindHandlers: () => ({}),
      createCliFacade,
      writeCliError: () => {},
      exitCodeForError: () => 1,
      handlerImplementations: {},
      startRunRecord: (entry) => {
        recordStarts.push(entry);
        return { path: "/tmp/run.json", finish: () => {} };
      },
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text),
      printHelp: () => "expo-ios help\n",
      cliVersion: "0.1.0",
    });

    assert.equal(await runtime.run(["--help"]), 0);
    assert.equal(seenDeps[0]?.startRunRecord, runtime.dispatchDependencies.startRunRecord);
    assert.deepEqual(stdout, ["expo-ios help\n"]);
    assert.deepEqual(stderr, ["0.1.0\n"]);
    assert.deepEqual(recordStarts, []);
  });

  it("keeps process-level error handling in the facade with last parsed options", async () => {
    const failure = Object.assign(new Error("Unknown command: nope"), { exitCode: 2 });
    const errors: Array<{ error: unknown; options: CliGlobals }> = [];

    const runtime = createCliRuntime({
      parseCliArgs: () => ({ command: "nope", args: { _: [] }, globals: globals({ json: true, quiet: true }) }),
      commandArgs: () => ({}),
      dispatchCommand: () => {
        throw failure;
      },
      bindHandlers: () => ({}),
      createCliFacade,
      writeCliError: (error, options) => errors.push({ error, options }),
      exitCodeForError: (error) => (error as { exitCode?: number }).exitCode ?? 1,
      handlerImplementations: {},
    });

    assert.equal(await runtime.run(["--json", "--quiet", "nope"]), 2);
    assert.deepEqual(errors, [{ error: failure, options: globals({ json: true, quiet: true }) }]);
    assert.deepEqual(runtime.getLastCliOptions(), globals({ json: true, quiet: true }));
  });

  it("fails composition early when the handler registry rejects missing implementations", () => {
    assert.throws(
      () => createCliRuntime({
        parseCliArgs: () => ({ command: "doctor", args: { _: [] }, globals: globals() }),
        commandArgs: () => ({}),
        dispatchCommand: () => 0,
        bindHandlers: () => {
          throw new Error("Missing handler implementations: doctor");
        },
        createCliFacade,
        writeCliError: () => {},
        exitCodeForError: () => 1,
        handlerImplementations: {},
      }),
      /Missing handler implementations: doctor/,
    );
  });

  it("sets process exit code through the executable runner returned by composition", async () => {
    const exitCodes: number[] = [];
    const runtime = {
      run: async (argv: string[]) => {
        assert.deepEqual(argv, ["doctor"]);
        return 0;
      },
    };

    const run = createProcessExitRunner(runtime, (exitCode) => exitCodes.push(exitCode));

    assert.equal(await run(["doctor"]), 0);
    assert.deepEqual(exitCodes, [0]);
  });

  it("asserts that composed runtime handlers cover required tool names", () => {
    const runtime = {
      handlers: {
        doctor: () => ({}),
        project_info: () => ({}),
      },
    };

    assert.doesNotThrow(() => assertRuntimeHasHandlers(runtime, ["doctor", "project_info"]));
    assert.throws(() => assertRuntimeHasHandlers(runtime, ["doctor", "release"]), /Missing runtime handlers: release/);
  });

  it("maps the final CLI runtime components to transformed package exports", () => {
    const sources = runtimeComponentSources();

    assert.equal(CLI_RUNTIME_COMPONENT_SOURCES.length, 12);
    assert.deepEqual(sources.map((item) => item.role), [
      "parseCliArgs",
      "commandArgs",
      "dispatchCommand",
      "formatCliError",
      "exitCodeForError",
      "bindHandlers",
      "handlerImplementationSources",
      "createCliFacade",
      "cliHelpText",
      "startRunRecord",
      "createCliRuntime",
      "createCliExecutable",
    ]);
    assert.deepEqual(runtimeComponentSourceByRole("dispatchCommand"), {
      role: "dispatchCommand",
      packageName: "@expo98/command-dispatch-envelope",
      exportName: "dispatchCommand",
      required: true,
    });
    assert.deepEqual(runtimeComponentSourceByRole("createCliExecutable"), {
      role: "createCliExecutable",
      packageName: "@expo98/cli-executable-wrapper",
      exportName: "createCliExecutable",
      required: true,
    });
    assert.equal(runtimeComponentSourceByRole("missing"), null);
    assert.deepEqual(requiredRuntimeComponentRoles(), sources.map((item) => item.role));

    sources.pop();
    assert.equal(runtimeComponentSources().length, 12);
  });

  it("verifies runtime component sources point at real manifests and public exports", async () => {
    const expoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

    for (const source of runtimeComponentSources()) {
      const packageDir = source.packageName.replace("@expo98/", "");
      const packageJson = JSON.parse(await readFile(resolve(expoRoot, packageDir, "package.json"), "utf8"));
      const publicIndex = await readFile(resolve(expoRoot, packageDir, "src", "main", "index.ts"), "utf8");

      assert.equal(packageJson.name, source.packageName, source.role);
      assert.match(publicIndex, new RegExp(`\\b${source.exportName}\\b`), source.role);
    }
  });

  it("asserts runtime component source coverage for requested roles", () => {
    assert.doesNotThrow(() => assertRuntimeComponentSourcesCover(["parseCliArgs", "createCliRuntime"]));
    assert.throws(
      () => assertRuntimeComponentSourcesCover(["parseCliArgs", "wireNativeAdapters"]),
      /Missing runtime component sources: wireNativeAdapters/,
    );
  });
});

function globals(overrides: Partial<CliGlobals> = {}): CliGlobals {
  return {
    json: false,
    plain: false,
    quiet: false,
    debug: false,
    maxOutput: null,
    contentBoundaries: false,
    root: "/workspace",
    ...overrides,
  };
}

function createCliFacade(deps: {
  parseCliArgs: (argv: string[]) => ParsedCommand;
  dispatchCommand: (parsed: ParsedCommand) => Promise<number> | number;
  writeCliError: (error: unknown, options: CliGlobals) => void;
  exitCodeForError: (error: unknown) => number;
}): CliFacade {
  let lastCliOptions = globals({ root: undefined });
  async function main(argv: string[]): Promise<number> {
    const parsed = deps.parseCliArgs(argv);
    lastCliOptions = parsed.globals;
    return deps.dispatchCommand(parsed);
  }
  return {
    main,
    async run(argv) {
      try {
        return await main(argv);
      } catch (error) {
        deps.writeCliError(error, lastCliOptions);
        return deps.exitCodeForError(error);
      }
    },
    getLastCliOptions: () => ({ ...lastCliOptions }),
  };
}
