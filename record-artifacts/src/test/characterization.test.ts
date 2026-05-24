import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  recordCommand,
  resolveExpoStateRoot,
  runRecordMetadataPath,
} from "../main/index.js";
import type { ToolTextResult } from "../main/index.js";

describe("record-artifacts legacy characterization", () => {
  it("starts a recording metadata record for the latest session target", async () => {
    const stateRoot = await fixtureStateRoot();
    await writeSession(stateRoot, "old", { sessionId: "old", activeTargetId: "target-old", createdAt: "2026-05-20T10:00:00.000Z" });
    await writeSession(stateRoot, "new", { sessionId: "new", activeTargetId: "target-1", createdAt: "2026-05-21T10:00:00.000Z" });

    const payload = parseToolJson(await recordCommand({ stateDir: stateRoot }, {
      now: () => new Date("2026-05-22T12:00:00.000Z"),
    }));
    const persisted = JSON.parse(await readFile(runRecordMetadataPath(stateRoot), "utf8"));

    assert.equal(payload.available, true);
    assert.equal(payload.action, "start");
    assert.equal(payload.startedAt, "2026-05-22T12:00:00.000Z");
    assert.equal(payload.sessionId, "new");
    assert.equal(payload.targetId, "target-1");
    assert.equal(payload.status, "recording");
    assert.equal(payload.metadataPath, runRecordMetadataPath(stateRoot));
    assert.equal(payload.limitations[0], "This tracer-bullet command records metadata; native video capture is implemented by a later adapter.");
    assert.deepEqual(persisted, {
      available: true,
      action: "start",
      startedAt: "2026-05-22T12:00:00.000Z",
      sessionId: "new",
      targetId: "target-1",
      status: "recording",
      limitations: ["This tracer-bullet command records metadata; native video capture is implemented by a later adapter."],
    });
  });

  it("stops a recording by writing placeholder output when missing and metadata without wrapper-only path", async () => {
    const stateRoot = await fixtureStateRoot();
    await writeSession(stateRoot, "s1", { sessionId: "s1", activeTargetId: "target-1", createdAt: "2026-05-21T10:00:00.000Z" });
    const outputPath = join(stateRoot, "artifacts", "recordings", "clip.mov");

    const payload = parseToolJson(await recordCommand({ action: "stop", stateDir: stateRoot, outputPath }, {
      now: () => new Date("2026-05-22T12:34:56.000Z"),
    }));
    const output = await readFile(outputPath, "utf8");
    const persisted = JSON.parse(await readFile(runRecordMetadataPath(stateRoot), "utf8"));

    assert.equal(payload.available, true);
    assert.equal(payload.action, "stop");
    assert.equal(payload.stoppedAt, "2026-05-22T12:34:56.000Z");
    assert.equal(payload.sessionId, "s1");
    assert.equal(payload.targetId, "target-1");
    assert.equal(payload.outputPath, outputPath);
    assert.equal(payload.metadataPath, runRecordMetadataPath(stateRoot));
    assert.equal(payload.status, "stopped");
    assert.equal(output, "recording placeholder\n");
    assert.deepEqual(persisted, payload);
  });

  it("does not overwrite an existing output file on stop", async () => {
    const stateRoot = await fixtureStateRoot();
    const outputPath = join(stateRoot, "custom.mov");
    await writeFile(outputPath, "real video bytes", "utf8");

    const payload = parseToolJson(await recordCommand({ action: "stop", stateDir: stateRoot, outputPath }, {
      now: () => new Date("2026-05-22T12:00:00.000Z"),
    }));

    assert.equal(await readFile(outputPath, "utf8"), "real video bytes");
    assert.equal(payload.sessionId, null);
    assert.equal(payload.targetId, null);
  });

  it("uses default stop output names, positional action, no-session nulls, and state-dir /runs parent behavior", async () => {
    const stateRoot = await fixtureStateRoot();
    const payload = parseToolJson(await recordCommand({ _: ["stop"], stateDir: join(stateRoot, "runs") }, {
      now: () => new Date("2026-05-22T12:00:00.000Z"),
    }));

    assert.equal(payload.outputPath, join(stateRoot, "artifacts", "recordings", "recording-2026-05-22T12-00-00-000Z.mov"));
    assert.equal(payload.sessionId, null);
    assert.equal(payload.targetId, null);
    assert.equal(resolveExpoStateRoot({ stateDir: join(stateRoot, "runs") }), stateRoot);
  });

  it("rejects unknown actions with legacy messages", async () => {
    await assert.rejects(() => recordCommand({ action: "pause" }), /Unknown record action: pause/);
  });
});

async function fixtureStateRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "expo98-record-"));
  await mkdir(join(root, "sessions"), { recursive: true });
  await mkdir(join(root, "runs"), { recursive: true });
  await mkdir(join(root, "artifacts"), { recursive: true });
  return root;
}

async function writeSession(stateRoot: string, id: string, record: Record<string, unknown>): Promise<void> {
  await writeJson(join(stateRoot, "sessions", id, "session.json"), record);
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function parseToolJson(result: ToolTextResult): any {
  return JSON.parse(result.content[0]?.text ?? "null");
}
