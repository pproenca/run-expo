import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  ADAPTER_REGISTRY_CONTRACTS,
  COMMAND_EFFECTS,
  COMMAND_NAMES,
  CONTRACT_ACTIONS_BY_DOMAIN,
  RECORD_STATUS_VALUES,
  RUNTIME_COMMAND_ALIASES,
  SIDECAR_STATUS_VALUES,
  commandSurfaceMismatches,
  runtimeCommandNames,
  toolJson,
} from "../main/index.js";
import type { ToolTextResult } from "../main/index.js";

describe("typed-contract-surface legacy characterization", () => {
  it("preserves the CommandName union ordering and key contract-only commands", () => {
    assert.equal(COMMAND_NAMES[0], "install");
    assert.equal(COMMAND_NAMES.at(-1), "redact");
    const commandNames = [...COMMAND_NAMES] as string[];
    assert.ok(commandNames.includes("instrumentation"));
    assert.ok(commandNames.includes("review-overlay"));
    assert.ok(!commandNames.includes("review-overlay-server"));
    assert.ok(!commandNames.includes("annotation-server"));
    assert.ok(!commandNames.includes("release"));
    assert.ok(!commandNames.includes("live-backlog"));
    assert.deepEqual(COMMAND_EFFECTS, ["read", "write", "device", "runtime", "sidecar"]);
  });

  it("preserves runtime alias exposure and dangling command mismatches from assessment", () => {
    assert.equal(RUNTIME_COMMAND_ALIASES["project-info"], "project_info");
    assert.equal(RUNTIME_COMMAND_ALIASES["review-overlay-server"], "review_overlay");
    assert.equal(RUNTIME_COMMAND_ALIASES["annotation-server"], "annotation_server");
    assert.equal(RUNTIME_COMMAND_ALIASES.release, "release");
    assert.equal(RUNTIME_COMMAND_ALIASES["live-backlog"], "live_backlog");
    assert.ok(runtimeCommandNames().includes("trace"));
    assert.ok(!runtimeCommandNames().includes("instrumentation"));

    assert.deepEqual(commandSurfaceMismatches(), {
      contractOnly: ["instrumentation"],
      runtimeOnly: ["review-overlay-server", "annotation-server", "release", "live-backlog"],
      actionMismatches: [
        { domain: "controls", contractOnly: ["set"], runtimeOnly: [] },
        { domain: "storage", contractOnly: ["trace"], runtimeOnly: [] },
        { domain: "record", contractOnly: ["status"], runtimeOnly: [] },
      ],
    });
  });

  it("preserves contract arg action sets for mismatched bridge domains", () => {
    assert.deepEqual(CONTRACT_ACTIONS_BY_DOMAIN.controls, ["list", "get", "press", "set"]);
    assert.deepEqual(CONTRACT_ACTIONS_BY_DOMAIN.storage, ["list", "get", "set", "clear", "trace"]);
    assert.deepEqual(CONTRACT_ACTIONS_BY_DOMAIN.record, ["start", "stop", "status"]);
    assert.deepEqual(CONTRACT_ACTIONS_BY_DOMAIN.navigation, ["state", "back", "pop-to-root", "tab", "deep-link"]);
    assert.deepEqual(CONTRACT_ACTIONS_BY_DOMAIN.instrumentation, ["status", "manifest", "install", "remove", "call"]);
  });

  it("preserves record status enumerations and adapter registry contracts", () => {
    assert.deepEqual(RECORD_STATUS_VALUES.run, ["running", "completed", "failed"]);
    assert.deepEqual(SIDECAR_STATUS_VALUES, ["running", "stale", "stopped", "unknown"]);
    assert.deepEqual(RECORD_STATUS_VALUES.device, ["booted", "shutdown", "connected", "unknown"]);
    assert.deepEqual(RECORD_STATUS_VALUES.metro, ["available", "unavailable", "unknown"]);
    assert.deepEqual(ADAPTER_REGISTRY_CONTRACTS.device, [
      "list",
      "bootSimulator",
      "launchApp",
      "terminateApp",
      "reloadApp",
      "installApp",
      "uninstallApp",
      "openDevMenu",
      "openUrl",
      "screenshot",
    ]);
    assert.ok(ADAPTER_REGISTRY_CONTRACTS.metro.includes("symbolicate"));
    assert.ok(ADAPTER_REGISTRY_CONTRACTS.hermes.includes("evaluate"));
  });

  it("returns pretty JSON tool text for downstream compatibility", () => {
    const payload = parseToolJson(toolJson({ ok: true, mismatches: commandSurfaceMismatches().runtimeOnly }));
    assert.equal(payload.ok, true);
    assert.deepEqual(payload.mismatches, ["review-overlay-server", "annotation-server", "release", "live-backlog"]);
  });
});

function parseToolJson(result: ToolTextResult): any {
  return JSON.parse(result.content[0]?.text ?? "null");
}
