import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  ROUTE_SEGMENT_KINDS,
  SERVICE_METHODS,
  createEventStreamHandle,
  createSimpleSchemaValidator,
  createTruncatingOutputBoundary,
  invalid,
  valid,
} from "../main/index.js";

describe("runtime-service-contracts legacy characterization", () => {
  it("preserves shared route segment kinds and service method names", () => {
    assert.deepEqual(ROUTE_SEGMENT_KINDS, [
      "static",
      "dynamic",
      "catch-all",
      "optional-catch-all",
      "group",
    ]);
    assert.deepEqual(SERVICE_METHODS.schemaValidator, ["validate"]);
    assert.deepEqual(SERVICE_METHODS.redactor, ["redactText", "redactJson", "rules"]);
    assert.deepEqual(SERVICE_METHODS.artifactStore, [
      "reserve",
      "writeJson",
      "writeText",
      "writeBytes",
      "readJson",
      "list",
    ]);
    assert.deepEqual(SERVICE_METHODS.sessionStore, [
      "list",
      "show",
      "create",
      "update",
      "close",
      "clean",
    ]);
  });

  it("preserves validation success and failure outcome shapes", () => {
    assert.deepEqual(valid({ ok: true }), { valid: true, value: { ok: true } });
    assert.deepEqual(invalid("schema mismatch", "doctor"), {
      valid: false,
      error: {
        type: "usage",
        message: "schema mismatch",
        command: "doctor",
      },
    });
  });

  it("validates simple object schemas for deterministic characterization tests", () => {
    const validator = createSimpleSchemaValidator();

    assert.deepEqual(validator.validate({ type: "object" }, { a: 1 }), {
      valid: true,
      value: { a: 1 },
    });
    assert.deepEqual(validator.validate({ type: "array" }, { a: 1 }), {
      valid: false,
      error: {
        type: "usage",
        message: "Expected array",
      },
    });
  });

  it("bounds JSON and wraps untrusted text through the output boundary contract", () => {
    const boundary = createTruncatingOutputBoundary();

    assert.equal(boundary.wrapUntrustedText("hello"), "<<<hello>>>");
    assert.equal(boundary.bound("abcdef", 4), "a...");
    assert.deepEqual(boundary.bound({ nested: "abcdef" }, 4), { nested: "a..." });
    assert.deepEqual(boundary.bound(["abcdef", 3], 5), ["ab...", 3]);
  });

  it("creates event stream handles with the legacy fields", () => {
    assert.deepEqual(createEventStreamHandle("stream-1", "/tmp/events.jsonl", "2026-05-23T20:00:00.000Z"), {
      streamId: "stream-1",
      artifact: {
        kind: "json",
        path: "/tmp/events.jsonl",
      },
      startedAt: "2026-05-23T20:00:00.000Z",
    });
  });
});

