import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  booleanSchema,
  enumSchema,
  numberSchema,
  objectSchema,
  stringSchema,
  toolJson,
  toolText,
  unwrapToolJson,
} from "../main/index.js";

describe("tool-schema-builders legacy characterization", () => {
  it("builds primitive JSON schema fragments with legacy shapes", () => {
    assert.deepEqual(stringSchema("Project directory."), {
      type: "string",
      description: "Project directory.",
    });
    assert.deepEqual(booleanSchema("Include bounds."), {
      type: "boolean",
      description: "Include bounds.",
    });
    assert.deepEqual(numberSchema("Metro port.", { minimum: 1, maximum: 65535 }), {
      type: "number",
      description: "Metro port.",
      minimum: 1,
      maximum: 65535,
    });
  });

  it("allows numberSchema extras to override earlier fields like object spread does", () => {
    assert.deepEqual(numberSchema("Original description.", { description: "Override.", type: "integer" }), {
      type: "integer",
      description: "Override.",
    });
  });

  it("builds enum and object schemas with required defaults and no extra properties", () => {
    const properties = {
      action: enumSchema(["list", "select", "current"], "Target action."),
      cwd: stringSchema("Project directory."),
    };
    const required = ["action"];

    const schema = objectSchema(properties, required);

    assert.deepEqual(schema, {
      type: "object",
      properties,
      required: ["action"],
      additionalProperties: false,
    });
    assert.equal(schema.properties, properties);
    assert.equal(schema.required, required);
    assert.deepEqual(objectSchema({ cwd: properties.cwd }), {
      type: "object",
      properties: { cwd: properties.cwd },
      required: [],
      additionalProperties: false,
    });
  });

  it("wraps text and JSON tool results in MCP-style text content", () => {
    assert.deepEqual(toolText("hello"), {
      content: [{ type: "text", text: "hello" }],
      isError: false,
    });
    assert.deepEqual(toolText("bad", true), {
      content: [{ type: "text", text: "bad" }],
      isError: true,
    });
    assert.deepEqual(toolJson({ ok: true, nested: ["a", 1] }), {
      content: [{ type: "text", text: "{\n  \"ok\": true,\n  \"nested\": [\n    \"a\",\n    1\n  ]\n}\n" }],
      isError: false,
    });
  });

  it("unwraps JSON text payloads and falls back to text or original result", () => {
    assert.deepEqual(unwrapToolJson(toolJson({ ok: true })), { ok: true });
    assert.deepEqual(unwrapToolJson(toolText("not json")), { text: "not json" });
    assert.deepEqual(unwrapToolJson({ content: [{ type: "image", data: "abc" }] }), { content: [{ type: "image", data: "abc" }] });
    assert.deepEqual(unwrapToolJson({ payload: true }), { payload: true });
    assert.equal(unwrapToolJson(null), null);
  });
});
