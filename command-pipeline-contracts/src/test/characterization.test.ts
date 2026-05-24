import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  BUILT_IN_MIDDLEWARE,
  COMMAND_FAMILIES,
  InMemoryCommandRegistry,
  createCommandPipeline,
  ok,
  usageFailure,
} from "../main/index.js";
import type { CommandDefinition, CommandMiddleware } from "../main/index.js";

describe("command-pipeline-contracts legacy characterization", () => {
  it("preserves command families and built-in middleware names from legacy src/commands", () => {
    assert.deepEqual(COMMAND_FAMILIES, [
      "discovery",
      "session",
      "target",
      "runtime",
      "action",
      "devtools",
      "performance",
      "review",
      "skills",
    ]);
    assert.deepEqual(BUILT_IN_MIDDLEWARE, [
      "schema-validation",
      "policy",
      "session",
      "run-record",
      "redaction",
      "output-boundary",
      "artifact-capture",
      "error-envelope",
    ]);
  });

  it("implements the legacy CommandRegistry list/get/register contract", () => {
    const registry = new InMemoryCommandRegistry();
    const doctor = commandDefinition("doctor", "Check local tooling.");
    const routes = commandDefinition("routes", "List routes.");

    registry.register({ family: "discovery", definition: doctor });
    registry.register({ family: "discovery", definition: routes });

    assert.deepEqual(registry.list().map((module) => module.definition.name), ["doctor", "routes"]);
    assert.equal(registry.get("doctor")?.definition.summary, "Check local tooling.");
    assert.equal(registry.get("missing"), null);

    const listed = registry.list();
    listed.pop();
    assert.equal(registry.list().length, 2);
  });

  it("replaces duplicate command modules by command name without changing insertion order", () => {
    const registry = new InMemoryCommandRegistry([
      { family: "discovery", definition: commandDefinition("doctor", "old") },
      { family: "runtime", definition: commandDefinition("wait", "wait") },
    ]);

    registry.register({ family: "discovery", definition: commandDefinition("doctor", "new") });

    assert.deepEqual(registry.list().map((module) => [module.definition.name, module.definition.summary]), [
      ["doctor", "new"],
      ["wait", "wait"],
    ]);
  });

  it("builds a middleware pipeline in registration order around the command handler", async () => {
    const events: string[] = [];
    const definition = commandDefinition("doctor", "Check local tooling.");
    const pipeline = createCommandPipeline();
    pipeline.use(traceMiddleware("schema-validation", events));
    pipeline.use(traceMiddleware("redaction", events));

    const handler = pipeline.build(definition, {
      run: async (args, context) => {
        events.push(`handler:${args.value}:${context.cwd}`);
        return ok({ done: true });
      },
    });

    const outcome = await handler.run({ value: "x" }, context());

    assert.deepEqual(outcome, { ok: true, data: { done: true } });
    assert.deepEqual(events, [
      "schema-validation:before:doctor",
      "redaction:before:doctor",
      "handler:x:/repo/app",
      "redaction:after:doctor",
      "schema-validation:after:doctor",
    ]);
  });

  it("returns defensive middleware lists and keeps built handlers immutable after build", async () => {
    const events: string[] = [];
    const pipeline = createCommandPipeline();
    pipeline.use(traceMiddleware("first", events));
    const handler = pipeline.build(commandDefinition("routes", "List routes."), {
      run: async () => ok("built"),
    });
    pipeline.use(traceMiddleware("second", events));

    const middleware = pipeline.list();
    middleware.pop();

    assert.equal(pipeline.list().length, 2);
    assert.deepEqual(await handler.run({}, context()), { ok: true, data: "built" });
    assert.deepEqual(events, ["first:before:routes", "first:after:routes"]);
  });

  it("preserves command failure outcome shape helpers", () => {
    assert.deepEqual(usageFailure("bad args", "doctor"), {
      ok: false,
      error: {
        type: "usage",
        message: "bad args",
        command: "doctor",
      },
    });
  });
});

function commandDefinition(name: string, summary: string): CommandDefinition<any, any> {
  return {
    name,
    summary,
    inputSchema: { type: "object" },
    effects: ["read"],
    actionCategories: [],
    examples: [`expo-ios --json ${name}`],
  };
}

function context() {
  return {
    cwd: "/repo/app",
    globals: { json: true },
    session: null,
    target: null,
    policy: {},
    artifacts: { add: () => {} },
  };
}

function traceMiddleware(name: string, events: string[]): CommandMiddleware {
  return {
    name,
    wrap(definition, next) {
      return async (invocation) => {
        events.push(`${name}:before:${definition.name}`);
        const result = await next(invocation);
        events.push(`${name}:after:${definition.name}`);
        return result;
      };
    },
  };
}
