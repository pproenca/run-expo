import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  CliUsageError,
  commandAliases,
  dispatchCommand,
  formatCliError,
  formatCliPayload,
  plainPayload,
  runTool,
  toolJson,
} from "../main/index.js";
import type { CliGlobals, RunRecorder, ToolHandler } from "../main/index.js";

describe("command-dispatch-envelope legacy characterization", () => {
  it("preserves runtime command alias exposure and rejects unknown commands", async () => {
    const aliases = commandAliases();

    assert.equal(aliases["project-info"], "project_info");
    assert.equal(aliases["review-overlay-server"], "review_overlay");
    assert.equal(aliases["annotation-server"], "annotation_server");
    assert.equal(aliases["release"], "release");
    assert.equal(aliases["live-backlog"], "live_backlog");
    assert.equal(aliases["trace"], "trace_interaction");
    assert.equal(Object.keys(aliases).length, 79);

    await assert.rejects(
      () => dispatchCommand({ command: "not-real", args: { _: [] }, globals: defaultGlobals() }, emptyDependencies()),
      /Unknown command: not-real/,
    );
  });

  it("dispatches parsed commands through arg projection, runTool, and run-record completion", async () => {
    const calls: Array<{ toolName: string; args: Record<string, unknown> }> = [];
    const finishes: Array<Record<string, unknown>> = [];
    const stderr: string[] = [];
    const recorder: RunRecorder = {
      path: "/tmp/run.json",
      finish: async (entry) => {
        finishes.push(entry);
      },
    };
    const handler: ToolHandler = async (args) => {
      calls.push({ toolName: "project_info", args });
      return toolJson({ cwd: args.cwd, token: "abc123", nested: { cookie: "sensitive" } });
    };

    const exitCode = await dispatchCommand(
      {
        command: "project-info",
        args: { _: [], cwd: "/repo/app" },
        globals: { ...defaultGlobals(), json: true, debug: true },
      },
      {
        handlers: { project_info: handler },
        projectArgs: (command, args) => ({ command, cwd: args.cwd, authCookie: "raw-cookie" }),
        startRunRecord: async ({ command, args }) => {
          assert.equal(command, "project-info");
          assert.deepEqual(args, { command: "project-info", cwd: "/repo/app", authCookie: "raw-cookie" });
          return recorder;
        },
        stdout: () => {},
        stderr: (text) => stderr.push(text),
      },
    );

    assert.equal(exitCode, 0);
    assert.deepEqual(calls, [
      { toolName: "project_info", args: { command: "project-info", cwd: "/repo/app", authCookie: "raw-cookie" } },
    ]);
    assert.deepEqual(finishes, [
      {
        status: "completed",
        exitCode: 0,
        payload: { cwd: "/repo/app", token: "[redacted]", nested: { cookie: "[redacted]" } },
      },
    ]);
    assert.deepEqual(stderr, ["run-record: /tmp/run.json\n"]);
  });

  it("finishes failed run records with the legacy invalid-usage exit code", async () => {
    const finishes: Array<Record<string, unknown>> = [];

    await assert.rejects(
      () => dispatchCommand(
        {
          command: "project-info",
          args: { _: [] },
          globals: { ...defaultGlobals(), debug: true },
        },
        {
          handlers: {
            project_info: async () => {
              throw new CliUsageError("Expected a finite number, got no.");
            },
          },
          startRunRecord: async () => ({
            path: "/tmp/failure.json",
            finish: async (entry) => {
              finishes.push(entry);
            },
          }),
          stdout: () => {},
          stderr: () => {},
        },
      ),
      /Expected a finite number, got no\./,
    );

    assert.equal(finishes.length, 1);
    assert.equal(finishes[0]?.status, "failed");
    assert.equal(finishes[0]?.exitCode, 2);
    assert.ok(finishes[0]?.error instanceof CliUsageError);
  });

  it("formats JSON, default JSON, quiet, and content-boundary payloads like the legacy CLI", () => {
    assert.equal(
      formatCliPayload({ value: 1 }, { command: "wait", globals: { ...defaultGlobals(), json: true } }),
      "{\n  \"ok\": true,\n  \"data\": {\n    \"value\": 1\n  }\n}\n",
    );

    assert.equal(
      formatCliPayload({ value: 1 }, { command: "wait", globals: defaultGlobals() }),
      "{\n  \"value\": 1\n}\n",
    );

    assert.equal(
      formatCliPayload({ value: 1 }, { command: "wait", globals: { ...defaultGlobals(), quiet: true } }),
      null,
    );

    assert.equal(
      formatCliPayload({ value: 1 }, { command: "wait", globals: { ...defaultGlobals(), json: true, contentBoundaries: true } }),
      "{\n  \"ok\": true,\n  \"data\": {\n    \"contentBoundary\": \"expo-ios-untrusted-output\",\n    \"payload\": {\n      \"value\": 1\n    }\n  }\n}\n",
    );
  });

  it("preserves plain output special cases and output bounding suffix", () => {
    assert.deepEqual(plainPayload("doctor", {
      cli: { name: "expo-ios", version: "0.1.0" },
      cwd: "/repo/app",
      capabilities: { iosSimulator: true, expoCli: false },
    }), [
      "ok: true",
      "command: doctor",
      "cli: expo-ios 0.1.0",
      "cwd: /repo/app",
      "ios-simulator: yes",
      "expo-cli: no",
    ]);

    assert.deepEqual(plainPayload("routes", {
      routeCount: 2,
      routes: [
        { route: "/", file: "app/index.tsx" },
        { route: "/settings", file: "app/settings.tsx" },
      ],
    }), [
      "ok: true",
      "command: routes",
      "routes: 2",
      "route: / app/index.tsx",
      "route: /settings app/settings.tsx",
    ]);

    assert.deepEqual(plainPayload("review-next", {
      constraint: { tocStep: "2" },
      nextStep: "Capture evidence",
      suggestedCommands: ["expo-ios screenshot"],
    }), [
      "ok: true",
      "command: review-next",
      "toc-step: 2",
      "next: Capture evidence",
      "suggested-command: expo-ios screenshot",
    ]);

    assert.deepEqual(plainPayload("wait", { available: false, reason: "Ref not found" }), [
      "ok: true",
      "command: wait",
      "available: false",
      "reason: Ref not found",
    ]);

    const truncated = formatCliPayload(
      { message: "abcdefghijklmnopqrstuvwxyz" },
      { command: "wait", globals: { ...defaultGlobals(), maxOutput: 12 } },
    );
    assert.equal(truncated, "\n[expo-ios output truncated by --max-output]\n");
  });

  it("unwraps tool JSON, redacts secrets, and writes unless silent", async () => {
    const writes: string[] = [];
    const payload = await runTool("fake", { url: "https://x.test?token=secret" }, {
      handlers: {
        fake: async () => toolJson({
          url: "https://x.test?token=secret",
          authorization: "bearer abc",
          text: "plain",
        }),
      },
      command: "wait",
      globals: defaultGlobals(),
      stdout: (text) => writes.push(text),
    });

    assert.deepEqual(payload, {
      url: "https://x.test?token=[redacted]",
      authorization: "[redacted]",
      text: "plain",
    });
    assert.deepEqual(writes, [
      "{\n  \"url\": \"https://x.test?token=[redacted]\",\n  \"authorization\": \"[redacted]\",\n  \"text\": \"plain\"\n}\n",
    ]);

    await assert.rejects(
      () => runTool("missing", {}, { handlers: {}, command: "wait", globals: defaultGlobals() }),
      /Unknown tool: missing/,
    );
  });

  it("formats sanitized error envelopes with json/default, plain, debug, and quiet behavior", () => {
    const error = Object.assign(new Error("failed token=secret"), { stdout: "ok", stderr: "bad password=hunter2" });

    assert.equal(formatCliError(error, defaultGlobals()), "{\n  \"ok\": false,\n  \"error\": {\n    \"code\": \"runtime_failure\",\n    \"message\": \"failed token=[redacted]\\n\\nstdout:\\nok\\n\\nstderr:\\nbad password=[redacted]\",\n    \"exitCode\": 1\n  }\n}\n");
    assert.equal(formatCliError(error, { ...defaultGlobals(), plain: true }), "error: failed token=[redacted]\n\nstdout:\nok\n\nstderr:\nbad password=[redacted]\n");
    assert.equal(formatCliError(error, { ...defaultGlobals(), debug: true }), "{\n  \"ok\": false,\n  \"error\": {\n    \"code\": \"runtime_failure\",\n    \"message\": \"failed token=[redacted]\\n\\nstdout:\\nok\\n\\nstderr:\\nbad password=[redacted]\",\n    \"exitCode\": 1,\n    \"name\": \"Error\"\n  }\n}\n");
    assert.equal(formatCliError(error, { ...defaultGlobals(), quiet: true }), null);
    assert.match(formatCliError(new CliUsageError("--json and --plain are mutually exclusive."), defaultGlobals()) ?? "", /"code": "invalid_usage"/);
  });
});

function defaultGlobals(): CliGlobals {
  return {
    json: false,
    plain: false,
    quiet: false,
    debug: false,
    maxOutput: null,
    contentBoundaries: false,
  };
}

function emptyDependencies() {
  return {
    handlers: {},
    stdout: () => {},
    stderr: () => {},
  };
}
