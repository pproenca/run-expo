import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  ACTIONS_BY_ARG_DOMAIN,
  COMMAND_ARG_NAMES,
  ENVIRONMENT_CATEGORIES,
  FIND_KINDS,
  POSITIONAL_REF_ACTION_COMMANDS,
  REF_FIELDS,
  REVIEW_NEXT_STAGES,
  REVIEW_NEXT_SURFACES,
  commandSupportsAction,
  getCommandArgContract,
  listCommandArgContracts,
} from "../main/index.js";

describe("command-args-contracts legacy characterization", () => {
  it("preserves CommandArgsByName command ordering and positional ref-action commands", () => {
    assert.equal(COMMAND_ARG_NAMES.length, 76);
    assert.deepEqual(COMMAND_ARG_NAMES.slice(0, 10), [
      "install",
      "upgrade",
      "doctor",
      "project-info",
      "routes",
      "devices",
      "boot-simulator",
      "open-url",
      "open-route",
      "launch-app",
    ]);
    assert.deepEqual(COMMAND_ARG_NAMES.slice(-8), [
      "sheet",
      "profiler",
      "inspect",
      "highlight",
      "instrumentation",
      "dashboard",
      "policy",
      "redact",
    ]);
    assert.deepEqual(POSITIONAL_REF_ACTION_COMMANDS, [
      "long-press",
      "dbltap",
      "fill",
      "type",
      "focus",
      "blur",
      "press",
      "keyboard",
      "select",
      "check",
      "uncheck",
      "scroll",
      "scroll-into-view",
      "drag",
    ]);
  });

  it("preserves selected action unions from command arg types", () => {
    assert.deepEqual(ACTIONS_BY_ARG_DOMAIN.appLifecycle, [
      "terminate",
      "reload",
      "open-dev-menu",
      "install",
      "uninstall",
    ]);
    assert.deepEqual(ACTIONS_BY_ARG_DOMAIN.perf, [
      "summary",
      "startup",
      "action",
      "bundle",
      "mark-list",
      "mark-clear",
      "measure-start",
      "measure-stop",
      "compare",
      "budget-check",
      "startup-modules",
      "js-thread",
      "frames",
      "memory",
      "ettrace-start",
      "ettrace-stop",
      "memgraph-capture",
    ]);
    assert.deepEqual(ACTIONS_BY_ARG_DOMAIN.instrumentation, [
      "status",
      "manifest",
      "install",
      "remove",
      "call",
    ]);
  });

  it("preserves non-action vocabularies used by argument contracts", () => {
    assert.deepEqual(REF_FIELDS, ["text", "props", "box", "style", "source"]);
    assert.deepEqual(FIND_KINDS, [
      "role",
      "text",
      "label",
      "placeholder",
      "testid",
      "source",
      "first",
      "last",
      "nth",
    ]);
    assert.deepEqual(REVIEW_NEXT_SURFACES, [
      "calendar",
      "timeline",
      "form",
      "list",
      "navigation",
      "editor",
      "generic",
    ]);
    assert.deepEqual(REVIEW_NEXT_STAGES, [
      "intake",
      "pre-patch",
      "post-patch",
      "verifier-failed",
      "interaction",
      "handoff",
    ]);
    assert.deepEqual(ENVIRONMENT_CATEGORIES, [
      "appearance",
      "content-size",
      "locale",
      "timezone",
      "location",
      "network",
      "permissions",
      "orientation",
      "keyboard",
    ]);
  });

  it("builds defensive command argument contract lists and lookups", () => {
    const contracts = listCommandArgContracts();
    contracts.pop();

    assert.equal(listCommandArgContracts().length, 76);
    assert.deepEqual(getCommandArgContract("storage"), {
      command: "storage",
      argType: "StorageArgs",
      actions: ["list", "get", "set", "clear", "trace"],
    });
    assert.deepEqual(getCommandArgContract("doctor"), {
      command: "doctor",
      argType: "DoctorArgs",
      actions: [],
    });
    assert.equal(getCommandArgContract("missing"), null);
  });

  it("checks command action support through the extracted contract vocabulary", () => {
    assert.equal(commandSupportsAction("storage", "trace"), true);
    assert.equal(commandSupportsAction("storage", "status"), false);
    assert.equal(commandSupportsAction("doctor", "anything"), false);
    assert.equal(commandSupportsAction("missing", "trace"), false);
  });
});
