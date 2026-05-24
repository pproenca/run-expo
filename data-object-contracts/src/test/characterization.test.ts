import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  ARTIFACT_KINDS,
  BUILD_CONTEXTS,
  COMMAND_EXIT_CODES,
  COMMAND_FAILURE_TYPES,
  DEVTOOLS_CAPABILITY_SOURCES,
  DEVICE_STATES,
  METRO_TARGET_STATUSES,
  PACKAGE_MANAGERS,
  PERFORMANCE_SOURCES,
  PERFORMANCE_UNITS,
  REF_ACTIONS,
  SIDECAR_STATUSES,
  SNAPSHOT_SOURCES,
  SOURCE_CONFIDENCE_VALUES,
  createArtifactRef,
  createEvidencePacket,
  failure,
  ok,
} from "../main/index.js";

describe("data-object-contracts legacy characterization", () => {
  it("preserves primitive enum vocabularies", () => {
    assert.deepEqual(COMMAND_EXIT_CODES, [0, 1, 2]);
    assert.deepEqual(COMMAND_FAILURE_TYPES, [
      "usage",
      "runtime",
      "tool-missing",
      "unavailable",
      "policy-denied",
      "unexpected",
    ]);
    assert.deepEqual(ARTIFACT_KINDS, ["json", "png", "jpeg", "text", "har", "trace", "video", "memgraph", "directory"]);
    assert.deepEqual(SOURCE_CONFIDENCE_VALUES, ["high", "medium", "low"]);
    assert.deepEqual(BUILD_CONTEXTS, ["expo-go", "dev-build", "preview", "release-export", "unknown"]);
  });

  it("preserves record status and source vocabularies", () => {
    assert.deepEqual(SIDECAR_STATUSES, ["running", "stale", "stopped", "unknown"]);
    assert.deepEqual(DEVICE_STATES, ["booted", "shutdown", "connected", "unknown"]);
    assert.deepEqual(METRO_TARGET_STATUSES, ["available", "unavailable", "unknown"]);
    assert.deepEqual(SNAPSHOT_SOURCES, [
      "native-accessibility",
      "react-devtools-hook",
      "hermes-fiber",
      "app-instrumentation",
    ]);
    assert.deepEqual(REF_ACTIONS, ["tap", "long-press", "fill", "focus", "press", "scroll", "inspect"]);
  });

  it("preserves result payload vocabularies", () => {
    assert.deepEqual(PACKAGE_MANAGERS, ["npm", "yarn", "pnpm", "bun", "unknown"]);
    assert.deepEqual(DEVTOOLS_CAPABILITY_SOURCES, [
      "metro",
      "hermes",
      "react-devtools-hook",
      "react-native-devtools",
      "app-instrumentation",
      "simulator",
      "native-profiler",
    ]);
    assert.deepEqual(PERFORMANCE_UNITS, ["ms", "bytes", "count", "fps", "percent"]);
    assert.deepEqual(PERFORMANCE_SOURCES, [
      "expo-atlas",
      "metro",
      "hermes",
      "react-devtools-hook",
      "app-performance-mark",
      "simulator",
      "xctrace",
      "memgraph",
    ]);
  });

  it("preserves command outcome and artifact reference shapes", () => {
    assert.deepEqual(ok({ value: 1 }), { ok: true, data: { value: 1 } });
    assert.deepEqual(failure("unavailable", "missing tool", { command: "doctor" }), {
      ok: false,
      error: {
        type: "unavailable",
        message: "missing tool",
        command: "doctor",
      },
    });
    assert.deepEqual(createArtifactRef("json", "/tmp/a.json", { bytes: 12 }), {
      kind: "json",
      path: "/tmp/a.json",
      bytes: 12,
    });
  });

  it("creates evidence packets with legacy fields and defensive artifact copies", () => {
    const artifacts = [createArtifactRef("text", "/tmp/log.txt")];
    const packet = createEvidencePacket({
      packetId: "packet-1",
      targetId: null,
      startedAt: "2026-05-23T20:00:00.000Z",
      finishedAt: null,
      artifacts,
      summary: { ok: true },
      limitations: ["none"],
    });
    artifacts.pop();

    assert.deepEqual(packet, {
      packetId: "packet-1",
      targetId: null,
      timeRange: {
        startedAt: "2026-05-23T20:00:00.000Z",
        finishedAt: null,
      },
      artifacts: [{ kind: "text", path: "/tmp/log.txt" }],
      summary: { ok: true },
      limitations: ["none"],
    });
  });
});

