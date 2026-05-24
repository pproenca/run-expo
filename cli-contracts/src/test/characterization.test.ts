import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  CLI_INTERFACE_NAMES,
  GLOBAL_OPTION_KEYS,
  PARSED_CLI_FIELDS,
  createCliRuntime,
  createParsedCli,
  failure,
  ok,
} from "../main/index.js";

describe("cli-contracts legacy characterization", () => {
  it("preserves the legacy cli interface names and ParsedCli fields", () => {
    assert.deepEqual(CLI_INTERFACE_NAMES, ["CliParser", "CliOutputWriter", "CliRuntime"]);
    assert.deepEqual(PARSED_CLI_FIELDS, ["globals", "command", "rawArgs", "args"]);
    assert.deepEqual(GLOBAL_OPTION_KEYS, [
      "json",
      "plain",
      "quiet",
      "debug",
      "root",
      "stateDir",
      "record",
      "maxOutputChars",
      "contentBoundaries",
      "allowRuntimeEval",
      "actionPolicyPath",
    ]);
  });

  it("creates ParsedCli records while defensively copying mutable inputs", () => {
    const rawArgs = ["--json", "doctor"];
    const args = { fix: false };
    const parsed = createParsedCli(defaultGlobals(), "doctor", rawArgs, args);

    rawArgs.pop();
    args.fix = true;

    assert.deepEqual(parsed, {
      globals: defaultGlobals(),
      command: "doctor",
      rawArgs: ["--json", "doctor"],
      args: { fix: false },
    });
  });

  it("executes a parsed command through context creation and the dispatcher", async () => {
    const events: string[] = [];
    const runtime = createCliRuntime({
      createContext: async (parsed) => {
        events.push(`context:${parsed.command}`);
        return { cwd: "/repo/app", globals: parsed.globals };
      },
      dispatch: async (command, args, context) => {
        events.push(`dispatch:${command}:${context.cwd}:${args.target}`);
        return ok({ done: true });
      },
      outputWriter: {
        writeSuccess(command, payload, globals) {
          events.push(`success:${command}:${(payload as { done: boolean }).done}:${globals.json}`);
        },
        writeFailure(command, outcome) {
          if (!outcome.ok) {
            events.push(`failure:${command}:${outcome.error.message}`);
          }
        },
      },
    });

    const exitCode = await runtime.execute(
      createParsedCli(defaultGlobals(), "doctor", ["doctor"], { target: "sim" }),
    );

    assert.equal(exitCode, 0);
    assert.deepEqual(events, [
      "context:doctor",
      "dispatch:doctor:/repo/app:sim",
      "success:doctor:true:true",
    ]);
  });

  it("writes failures and returns exit code 1 for missing commands or failed outcomes", async () => {
    const events: string[] = [];
    const runtime = createCliRuntime({
      createContext: async (parsed) => ({ cwd: "/repo/app", globals: parsed.globals }),
      dispatch: async () => failure("usage", "bad args", { command: "doctor" }),
      outputWriter: {
        writeSuccess() {
          events.push("unexpected-success");
        },
        writeFailure(command, outcome) {
          if (!outcome.ok) {
            events.push(`failure:${command ?? "null"}:${outcome.error.message}`);
          }
        },
      },
    });

    assert.equal(await runtime.execute(createParsedCli(defaultGlobals(), null, [], {})), 1);
    assert.equal(await runtime.execute(createParsedCli(defaultGlobals(), "doctor", ["doctor"], {})), 1);
    assert.deepEqual(events, ["failure:null:No command provided", "failure:doctor:bad args"]);
  });
});

function defaultGlobals() {
  return {
    json: true,
    plain: false,
    quiet: false,
    debug: false,
    root: null,
    stateDir: null,
    record: false,
    maxOutputChars: null,
    contentBoundaries: true,
    allowRuntimeEval: false,
    actionPolicyPath: null,
  };
}
