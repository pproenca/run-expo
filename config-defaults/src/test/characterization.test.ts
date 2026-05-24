import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  CLI_NAME,
  CLI_VERSION,
  DEFAULT_CONFIG,
  DEFAULT_GLOBALS,
  DEFAULT_METRO_PORT,
  DEFAULT_STATE_DIR_NAME,
  EXEC_FILE_TIMEOUT_MS,
  EXPO_IOS_ENV_KEYS,
  MAX_OUTPUT,
  defaultConfig,
  defaultGlobals,
  resolveArtifactDir,
  resolveExpoStateRoot,
  resolveRunRecordDir,
} from "../main/index.js";

describe("config-defaults legacy characterization", () => {
  it("preserves CLI constants and hardcoded runtime defaults", () => {
    assert.equal(CLI_NAME, "expo-ios");
    assert.equal(CLI_VERSION, "0.1.0");
    assert.equal(MAX_OUTPUT, 40_000);
    assert.equal(EXEC_FILE_TIMEOUT_MS, 60_000);
    assert.equal(DEFAULT_METRO_PORT, 8081);
    assert.equal(DEFAULT_STATE_DIR_NAME, ".scratch/expo-ios");
  });

  it("preserves parseCliArgs global defaults as a defensive copy", () => {
    assert.deepEqual(defaultGlobals(), {
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
    });

    const globals = defaultGlobals();
    globals.json = true;
    assert.equal(DEFAULT_GLOBALS.json, false);
    assert.equal(defaultGlobals().json, false);
  });

  it("resolves expo state roots like duplicated legacy state helpers", () => {
    assert.equal(resolveExpoStateRoot({ cwd: "/repo/app" }), "/repo/app/.scratch/expo-ios");
    assert.equal(resolveExpoStateRoot({ root: "/workspace" }), "/workspace/.scratch/expo-ios");
    assert.equal(resolveExpoStateRoot({ cwd: "/repo/app", root: "/workspace" }), "/workspace/.scratch/expo-ios");
    assert.equal(resolveExpoStateRoot({ cwd: "/repo/app", stateDir: "/tmp/expo-state" }), "/tmp/expo-state");
    assert.equal(resolveExpoStateRoot({ cwd: "/repo/app", stateDir: "/tmp/expo-state/runs" }), "/tmp/expo-state");
  });

  it("resolves run-record and artifact paths from state-root defaults", () => {
    assert.equal(resolveRunRecordDir({ cwd: "/repo/app" }), "/repo/app/.scratch/expo-ios/runs");
    assert.equal(resolveRunRecordDir({ cwd: "/repo/app", stateDir: "/tmp/custom-runs" }), "/tmp/custom-runs");
    assert.equal(resolveArtifactDir({ cwd: "/repo/app" }), "/repo/app/.scratch/expo-ios/artifacts");
    assert.equal(resolveArtifactDir({ stateDir: "/tmp/expo-state/runs" }), "/tmp/expo-state/artifacts");
  });

  it("preserves config contract environment keys and default config shape", () => {
    assert.deepEqual(EXPO_IOS_ENV_KEYS, ["EXPO_IOS_ROOT", "EXPO_IOS_STATE_DIR", "EXPO_IOS_METRO_PORT", "NO_COLOR"]);
    assert.deepEqual(DEFAULT_CONFIG.commands, {
      verifyNativeExperience: null,
      typecheck: null,
      lint: null,
      test: null,
    });
    assert.deepEqual(DEFAULT_CONFIG.policy, {
      maxOutputChars: 40_000,
      contentBoundaries: false,
      allowRuntimeEval: false,
      confirmActions: [],
      deniedActions: [],
    });
    assert.equal(DEFAULT_CONFIG.artifactDir, ".scratch/expo-ios/artifacts");
    assert.equal(DEFAULT_CONFIG.redaction.queryKeys.includes("token"), true);
    assert.equal(DEFAULT_CONFIG.redaction.headerKeys.includes("authorization"), true);
  });

  it("returns default config copies with resolved project root and source", () => {
    const resolved = defaultConfig({ cwd: "/repo/app" });

    assert.equal(resolved.source.kind, "defaults");
    assert.equal(resolved.projectRoot, "/repo/app");
    assert.equal(resolved.config.metroPort, 8081);
    assert.equal(resolved.config.artifactDir, "/repo/app/.scratch/expo-ios/artifacts");

    resolved.config.policy!.allowRuntimeEval = true;
    assert.equal(DEFAULT_CONFIG.policy!.allowRuntimeEval, false);
  });
});
