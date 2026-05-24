import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  CliUsageError,
  batchCommand,
  batchStepError,
  coerceCliValue,
  commandAliases,
  commandArgs,
  normalizeBatchSteps,
  parseCliArgs,
  parseJsonArgument,
  runBatchStep,
  toolJson,
  unwrapToolJson,
} from "../main/index.js";
import type { BatchDependencies, RunToolOptions, ToolTextResult } from "../main/index.js";

describe("batch-orchestration legacy characterization", () => {
  describe("tool JSON and usage errors", () => {
    it("constructs CliUsageError with the legacy name and invalid-usage exit code", () => {
      const error = new CliUsageError("Unknown command: nope");

      assert.equal(error.name, "CliUsageError");
      assert.equal(error.message, "Unknown command: nope");
      assert.equal(error.exitCode, 2);
    });

    it("wraps JSON payloads as MCP text content and unwraps JSON text when possible", () => {
      assert.deepEqual(toolJson({ ok: true, value: 42 }), {
        content: [{ type: "text", text: "{\n  \"ok\": true,\n  \"value\": 42\n}\n" }],
        isError: false,
      });
      assert.deepEqual(unwrapToolJson(toolJson({ nested: ["a", 1] })), { nested: ["a", 1] });
      assert.deepEqual(unwrapToolJson({ content: [{ type: "text", text: "plain output" }] }), { text: "plain output" });
      assert.deepEqual(unwrapToolJson({ payload: true }), { payload: true });
    });
  });

  describe("normalizeBatchSteps and JSON step parsing", () => {
    it("rejects missing or non-array batch steps with the legacy batch message", () => {
      assert.throws(
        () => normalizeBatchSteps(undefined),
        /batch requires one or more command steps\./,
      );
      assert.throws(
        () => normalizeBatchSteps("not an array"),
        /batch requires one or more command steps\./,
      );
    });

    it("parses string steps as JSON argv arrays and stringifies every argv part", () => {
      assert.deepEqual(
        normalizeBatchSteps([
          ["session", "new", 123, true, null],
          "[\"wait\",250,\"--app-ready\",false]",
        ]),
        [
          ["session", "new", "123", "true", "null"],
          ["wait", "250", "--app-ready", "false"],
        ],
      );
    });

    it("rejects malformed JSON, empty steps, and parsed non-arrays with source-cited messages", () => {
      assert.throws(
        () => parseJsonArgument("{bad json", "step 1"),
        /step 1 must be valid JSON: /,
      );
      assert.throws(
        () => normalizeBatchSteps(["{\"command\":\"session\"}"]),
        /batch step 1 must be a non-empty argv array\./,
      );
      assert.throws(
        () => normalizeBatchSteps([[]]),
        /batch step 1 must be a non-empty argv array\./,
      );
    });
  });

  describe("parseCliArgs and coercion", () => {
    it("parses globals, command, positional args, --flag=value, booleans, and numbers", () => {
      assert.deepEqual(
        parseCliArgs([
          "--json",
          "--quiet",
          "--root",
          "/repo/app",
          "--state-dir=/tmp/expo-state",
          "--allow-runtime-eval",
          "always",
          "wait",
          "@e1",
          "--timeout-ms=1500",
          "--no-spinner",
          "--text",
          "Ready",
        ]),
        {
          globals: {
            json: true,
            plain: false,
            quiet: true,
            verbose: false,
            debug: false,
            noColor: false,
            noInput: false,
            record: false,
            version: false,
            help: false,
            root: "/repo/app",
            stateDir: "/tmp/expo-state",
            actionPolicy: null,
            maxOutput: null,
            contentBoundaries: false,
            allowRuntimeEval: "always",
            confirmActions: null,
          },
          command: "wait",
          args: {
            _: ["@e1"],
            timeoutMs: 1500,
            noSpinner: true,
            text: "Ready",
          },
        },
      );

      assert.equal(coerceCliValue("true"), true);
      assert.equal(coerceCliValue("false"), false);
      assert.equal(coerceCliValue("-10.5"), -10.5);
      assert.equal(coerceCliValue("001"), 1);
      assert.equal(coerceCliValue("1e3"), "1e3");
    });

    it("treats -- as the end of option parsing and leaves following tokens positional", () => {
      assert.deepEqual(parseCliArgs(["find", "text", "--", "--not-a-flag", "Ready"]), {
        globals: defaultGlobals(),
        command: "find",
        args: { _: ["text", "--not-a-flag", "Ready"] },
      });
    });

    it("rejects command flags before a command and missing global flag values", () => {
      assert.throws(
        () => parseCliArgs(["--timeout-ms", "1000", "wait"]),
        /Global flag or command expected before --timeout-ms\./,
      );
      assert.throws(
        () => parseCliArgs(["--root", "--json", "session"]),
        /--root requires a value\./,
      );
      assert.throws(
        () => parseCliArgs(["--state-dir"]),
        /--state-dir requires a value\./,
      );
    });

    it("sets command flags to true when the omitted value is followed by another flag or end of argv", () => {
      assert.deepEqual(parseCliArgs(["snapshot", "--interactive", "--source"]), {
        globals: defaultGlobals(),
        command: "snapshot",
        args: { _: [], interactive: true, source: true },
      });
      assert.deepEqual(parseCliArgs(["batch", "--bail"]), {
        globals: defaultGlobals(),
        command: "batch",
        args: { _: [], bail: true },
      });
    });
  });

  describe("command aliases and commandArgs", () => {
    it("maps batch-supported commands to their legacy tool names", () => {
      const aliases = commandAliases();

      assert.equal(aliases["batch"], "batch");
      assert.equal(aliases["wait"], "wait");
      assert.equal(aliases["get"], "get_ref");
      assert.equal(aliases["find"], "find");
      assert.equal(aliases["session"], "session");
      assert.equal(aliases["target"], "target");
      assert.equal(aliases["snapshot"], "snapshot");
      assert.equal(aliases["refs"], "refs");
      assert.equal(aliases["tap"], "automation_tap");
      assert.equal(aliases["fill"], "ref_action");
      assert.equal(aliases["scroll-into-view"], "ref_action");
    });

    it("maps batch command args and preserves shared root/stateDir behavior", () => {
      assert.deepEqual(
        commandArgs("batch", { _: [["session", "new"], "[\"wait\",50]"], bail: true }, globalsWithState()),
        {
          steps: [["session", "new"], "[\"wait\",50]"],
          bail: true,
          cwd: "/repo/app",
          root: "/repo/app",
          stateDir: "/tmp/expo-state",
        },
      );
    });

    it("maps wait, get, and find representative args including positional fallbacks", () => {
      assert.deepEqual(
        commandArgs(
          "wait",
          { _: ["@e7"], state: "visible", timeoutMs: 500, actionPolicy: "allow" },
          { ...globalsWithState(), allowRuntimeEval: "never", actionPolicy: "prompt" },
        ),
        {
          ref: "@e7",
          state: "visible",
          allowRuntimeEval: "never",
          actionPolicy: "allow",
          timeoutMs: 500,
          cwd: "/repo/app",
          root: "/repo/app",
          stateDir: "/tmp/expo-state",
        },
      );

      assert.deepEqual(
        commandArgs("wait", { _: ["250"] }, globalsWithState()),
        {
          ms: 250,
          allowRuntimeEval: null,
          actionPolicy: null,
          cwd: "/repo/app",
          root: "/repo/app",
          stateDir: "/tmp/expo-state",
        },
      );

      assert.deepEqual(
        commandArgs("get", { _: ["text", "@e1"] }, globalsWithState()),
        { field: "text", ref: "@e1", cwd: "/repo/app", root: "/repo/app", stateDir: "/tmp/expo-state" },
      );

      assert.deepEqual(
        commandArgs("find", { _: ["nth", "2", "Submit"], action: "tap", dryRun: true }, globalsWithState()),
        {
          kind: "nth",
          value: "2",
          action: "tap",
          name: "Submit",
          dryRun: true,
          cwd: "/repo/app",
          root: "/repo/app",
          stateDir: "/tmp/expo-state",
        },
      );
    });

    it("maps session, target, and snapshot args with cwd falling back to global root", () => {
      assert.deepEqual(commandArgs("session", { _: ["new", "review"] }, globalsWithState()), {
        action: "new",
        name: "review",
        cwd: "/repo/app",
        root: "/repo/app",
        stateDir: "/tmp/expo-state",
      });

      assert.deepEqual(commandArgs("target", { _: ["select", "ios-sim-1"], platform: "ios" }, globalsWithState()), {
        action: "select",
        targetId: "ios-sim-1",
        platform: "ios",
        cwd: "/repo/app",
        root: "/repo/app",
        stateDir: "/tmp/expo-state",
      });

      assert.deepEqual(
        commandArgs(
          "snapshot",
          { _: [], interactive: true, compact: true, depth: 2, source: true, bounds: true, metroPort: 19001 },
          globalsWithState(),
        ),
        {
          interactive: true,
          compact: true,
          depth: 2,
          source: true,
          bounds: true,
          metroPort: 19001,
          cwd: "/repo/app",
          root: "/repo/app",
          stateDir: "/tmp/expo-state",
        },
      );
    });

    it("maps ref action and tap args before dispatching supported batch action commands", () => {
      assert.deepEqual(
        commandArgs("tap", { _: ["@e1"], dryRun: true }, globalsWithState()),
        { ref: "@e1", dryRun: true, cwd: "/repo/app", root: "/repo/app", stateDir: "/tmp/expo-state" },
      );
      assert.deepEqual(
        commandArgs("fill", { _: ["@e1", "hello"], dryRun: true }, globalsWithState()),
        {
          command: "fill",
          ref: "@e1",
          text: "hello",
          dryRun: true,
          cwd: "/repo/app",
          root: "/repo/app",
          stateDir: "/tmp/expo-state",
        },
      );
      assert.deepEqual(
        commandArgs("scroll-into-view", { _: ["@e2"], durationMs: 250 }, globalsWithState()),
        {
          command: "scroll-into-view",
          ref: "@e2",
          durationMs: 250,
          cwd: "/repo/app",
          root: "/repo/app",
          stateDir: "/tmp/expo-state",
        },
      );
    });
  });

  describe("runBatchStep", () => {
    it("merges globals with forced json/plain/quiet settings and calls runTool silently", async () => {
      const calls: Array<{ toolName: string; args: Record<string, unknown>; options: RunToolOptions }> = [];
      const deps: BatchDependencies = {
        runTool: async (toolName, args, options) => {
          calls.push({ toolName, args, options });
          return toolJson({ available: true, action: args.action, stateRoot: args.root });
        },
      };

      assert.deepEqual(await runBatchStep(["--plain", "session", "new", "review"], globalsWithState(), deps), {
        command: "session",
        data: { available: true, action: "new", stateRoot: "/repo/app" },
      });

      assert.deepEqual(calls, [
        {
          toolName: "session",
          args: {
            action: "new",
            name: "review",
            cwd: "/repo/app",
            root: "/repo/app",
            stateDir: "/tmp/expo-state",
          },
          options: {
            command: "session",
            globals: {
              ...defaultGlobals(),
              plain: false,
              json: true,
              quiet: true,
              root: "/repo/app",
              stateDir: "/tmp/expo-state",
            },
            silent: true,
          },
        },
      ]);
    });

    it("lets step globals override batch root/stateDir while batch args provide fallback", async () => {
      const calls: Array<{ args: Record<string, unknown>; options: RunToolOptions }> = [];
      const deps: BatchDependencies = {
        runTool: async (_toolName, args, options) => {
          calls.push({ args, options });
          return { available: true };
        },
      };

      await runBatchStep(
        ["--root", "/step/app", "--state-dir", "/step/state", "refs"],
        { root: "/batch/app", stateDir: "/batch/state" },
        deps,
      );

      assert.deepEqual(calls[0], {
        args: { cwd: "/step/app", root: "/step/app", stateDir: "/step/state" },
        options: {
          command: "refs",
          globals: {
            ...defaultGlobals(),
            json: true,
            quiet: true,
            root: "/step/app",
            stateDir: "/step/state",
          },
          silent: true,
        },
      });
    });

    it("redacts unwrapped tool payloads before returning batch step data", async () => {
      const deps: BatchDependencies = {
        runTool: async () => toolJson({ url: "myapp://x?token=secret", headers: { authorization: "Bearer secret" } }),
      };

      assert.deepEqual(await runBatchStep(["refs"], globalsWithState(), deps), {
        command: "refs",
        data: {
          url: "myapp://x?token=[redacted]",
          headers: { authorization: "[redacted]" },
        },
      });
    });

    it("passes mapped action args for tap and ref-action commands", async () => {
      const calls: Array<{ toolName: string; args: Record<string, unknown> }> = [];
      const deps: BatchDependencies = {
        runTool: async (toolName, args) => {
          calls.push({ toolName, args });
          return { ok: true };
        },
      };

      await runBatchStep(["tap", "@e1", "--dry-run"], globalsWithState(), deps);
      await runBatchStep(["fill", "@e2", "hello"], globalsWithState(), deps);

      assert.deepEqual(calls, [
        {
          toolName: "automation_tap",
          args: { ref: "@e1", dryRun: true, cwd: "/repo/app", root: "/repo/app", stateDir: "/tmp/expo-state" },
        },
        {
          toolName: "ref_action",
          args: { command: "fill", ref: "@e2", text: "hello", cwd: "/repo/app", root: "/repo/app", stateDir: "/tmp/expo-state" },
        },
      ]);
    });

    it("rejects missing and unknown commands with legacy usage messages", async () => {
      const deps: BatchDependencies = { runTool: async () => ({}) };

      await assertRejectsMessage(
        () => runBatchStep([], {}, deps),
        /Batch step is missing a command\./,
      );
      await assertRejectsMessage(
        () => runBatchStep(["not-a-command"], {}, deps),
        /Unknown command: not-a-command/,
      );
    });
  });

  describe("batchCommand and batchStepError", () => {
    it("executes steps serially, records success payloads, and returns the legacy ok envelope", async () => {
      const order: string[] = [];
      const deps: BatchDependencies = {
        runTool: async (toolName, args) => {
          order.push(`${toolName}:${String(args.action ?? args.ref ?? args.ms ?? "")}`);
          return toolJson({ handledBy: toolName, args });
        },
      };

      const payload = parseToolJson(await batchCommand(
        {
          steps: [
            ["session", "new", "review"],
            ["wait", "25"],
            ["get", "text", "@e1"],
          ],
          root: "/repo/app",
          stateDir: "/tmp/expo-state",
        },
        deps,
      ));

      assert.deepEqual(order, ["session:new", "wait:25", "get_ref:@e1"]);
      assert.deepEqual(payload, {
        ok: true,
        bail: false,
        failureIndex: null,
        steps: [
          {
            index: 0,
            command: "session",
            ok: true,
            data: {
              handledBy: "session",
              args: {
                action: "new",
                name: "review",
                cwd: "/repo/app",
                root: "/repo/app",
                stateDir: "/tmp/expo-state",
              },
            },
          },
          {
            index: 1,
            command: "wait",
            ok: true,
            data: {
              handledBy: "wait",
              args: {
                ms: 25,
                allowRuntimeEval: null,
                actionPolicy: null,
                cwd: "/repo/app",
                root: "/repo/app",
                stateDir: "/tmp/expo-state",
              },
            },
          },
          {
            index: 2,
            command: "get",
            ok: true,
            data: {
              handledBy: "get_ref",
              args: { field: "text", ref: "@e1", cwd: "/repo/app", root: "/repo/app", stateDir: "/tmp/expo-state" },
            },
          },
        ],
      });
    });

    it("continues after a failure when bail is false and keeps the first failureIndex", async () => {
      const deps: BatchDependencies = {
        runTool: async (toolName) => {
          if (toolName === "wait") {
            const error = new Error("Runtime failed with token=secret123");
            throw error;
          }
          return { ok: true, toolName };
        },
      };

      const payload = parseToolJson(await batchCommand(
        { steps: [["session", "new"], ["wait", "--app-ready"], ["refs"]] },
        deps,
      ));

      assert.equal(payload.ok, false);
      assert.equal(payload.bail, false);
      assert.equal(payload.failureIndex, 1);
      assert.deepEqual(payload.steps.map((step: any) => ({ index: step.index, command: step.command, ok: step.ok })), [
        { index: 0, command: "session", ok: true },
        { index: 1, command: "wait", ok: false },
        { index: 2, command: "refs", ok: true },
      ]);
      assert.deepEqual(payload.steps[1], {
        index: 1,
        command: "wait",
        ok: false,
        error: {
          code: "runtime_failure",
          message: "Runtime failed with token=[redacted]",
          exitCode: 1,
        },
      });
    });

    it("stops after the first failed step when bail is true", async () => {
      const calls: string[] = [];
      const deps: BatchDependencies = {
        runTool: async (toolName) => {
          calls.push(toolName);
          if (toolName === "wait") throw new CliUsageError("state must be a non-empty string.");
          return { ok: true };
        },
      };

      assert.deepEqual(parseToolJson(await batchCommand(
        { steps: [["session", "new"], ["wait", "--state"], ["refs"]], bail: true },
        deps,
      )), {
        ok: false,
        bail: true,
        failureIndex: 1,
        steps: [
          { index: 0, command: "session", ok: true, data: { ok: true } },
          {
            index: 1,
            command: "wait",
            ok: false,
            error: {
              code: "invalid_usage",
              message: "state must be a non-empty string.",
              exitCode: 2,
            },
          },
        ],
      });
      assert.deepEqual(calls, ["session", "wait"]);
    });

    it("rejects empty normalized steps before returning a payload and reports unknown commands inside batch steps", async () => {
      const deps: BatchDependencies = { runTool: async () => ({}) };

      await assertRejectsMessage(
        () => batchCommand({ steps: [[]] }, deps),
        /batch step 1 must be a non-empty argv array\./,
      );

      assert.deepEqual(parseToolJson(await batchCommand({ steps: [["nope"]] }, deps)), {
        ok: false,
        bail: false,
        failureIndex: 0,
        steps: [
          {
            index: 0,
            command: "nope",
            ok: false,
            error: {
              code: "invalid_usage",
              message: "Unknown command: nope",
              exitCode: 2,
            },
          },
        ],
      });
    });

    it("classifies, formats, truncates, and redacts stdout/stderr attached to step errors", () => {
      const error = new Error("Failed request with password=hunter2");
      (error as Error & { stdout?: string; stderr?: string }).stdout = `stdout token=abc123 ${"x".repeat(40_010)}`;
      (error as Error & { stdout?: string; stderr?: string }).stderr = "stderr authorization=Bearer abc123";

      const payload = batchStepError(error);

      assert.equal(payload.code, "runtime_failure");
      assert.equal(payload.exitCode, 1);
      assert.match(payload.message, /^Failed request with password=\[redacted\]\n\nstdout:\nstdout token=\[redacted\]/);
      assert.match(payload.message, /\[truncated \d+ characters\]/);
      assert.match(payload.message, /\n\nstderr:\nstderr authorization=\[redacted\]/);
      assert.doesNotMatch(payload.message, /hunter2|abc123|Bearer abc123/);
    });
  });
});

function defaultGlobals(): Record<string, unknown> {
  return {
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
  };
}

function globalsWithState(): Record<string, unknown> {
  return {
    ...defaultGlobals(),
    root: "/repo/app",
    stateDir: "/tmp/expo-state",
  };
}

function parseToolJson(result: ToolTextResult): any {
  return JSON.parse(result.content[0]?.text ?? "null");
}

async function assertRejectsMessage(fn: () => Promise<unknown>, expected: RegExp): Promise<void> {
  try {
    await fn();
  } catch (error) {
    assert.match(String((error as Error).message), expected);
    return;
  }
  throw new Error(`Expected rejection matching ${expected}`);
}
