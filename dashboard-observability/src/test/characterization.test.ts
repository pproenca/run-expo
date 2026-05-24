import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  clampNumber,
  dashboardCommand,
  dashboardSessions,
  escapeHtml,
  resolveExpoStateRoot,
} from "../main/index.js";
import type { ToolTextResult } from "../main/index.js";

describe("dashboard-observability legacy characterization", () => {
  it("starts the dashboard, projects sorted sessions, writes JSON/HTML/state artifacts, and clamps port", async () => {
    const stateRoot = await fixtureStateRoot();
    await writeSession(stateRoot, "z-session", {
      sessionId: "s-z",
      name: "Zed",
      activeTargetId: "target-z",
      lastSnapshotId: "snap-z",
      updatedAt: "2026-05-22T12:00:00.000Z",
    });
    await writeSession(stateRoot, "a-session", {
      sessionId: "s-a",
      name: "A <B>",
      activeTargetId: "target-a",
      lastSnapshotId: "snap-a",
      createdAt: "2026-05-21T12:00:00.000Z",
    });
    const outputPath = join(stateRoot, "custom", "dashboard.json");

    const payload = parseToolJson(await dashboardCommand({
      action: "start",
      stateDir: stateRoot,
      port: 99999,
      outputPath,
    }));
    const persisted = JSON.parse(await readFile(outputPath, "utf8"));
    const state = JSON.parse(await readFile(join(stateRoot, "dashboard", "dashboard-state.json"), "utf8"));
    const html = await readFile(join(stateRoot, "dashboard", "index.html"), "utf8");

    assert.equal(payload.available, true);
    assert.equal(payload.action, "start");
    assert.equal(payload.status, "running");
    assert.equal(payload.port, 65535);
    assert.equal(payload.stateRoot, stateRoot);
    assert.deepEqual(payload.sessions.map((session: any) => session.sessionId), ["s-a", "s-z"]);
    assert.equal(payload.sessions[0].updatedAt, "2026-05-21T12:00:00.000Z");
    assert.deepEqual(payload.artifacts, {
      json: outputPath,
      html: join(stateRoot, "dashboard", "index.html"),
    });
    assert.equal(payload.limitations[0], "The dashboard command records a local static observability view; it does not expose network access unless a future server adapter is added.");
    assert.deepEqual(persisted, payload);
    assert.deepEqual(state, payload);
    assert.match(html, /<p>Status: running<\/p>/);
    assert.match(html, /A &lt;B&gt;/);
  });

  it("status reuses previous running state and artifact paths, then stop persists stopped state", async () => {
    const stateRoot = await fixtureStateRoot();
    const first = parseToolJson(await dashboardCommand({
      action: "start",
      stateDir: stateRoot,
      port: 3000,
      outputPath: join(stateRoot, "artifacts", "dash.json"),
    }));
    const status = parseToolJson(await dashboardCommand({ action: "status", stateDir: stateRoot }));
    const stopped = parseToolJson(await dashboardCommand({ action: "stop", stateDir: stateRoot }));

    assert.equal(first.status, "running");
    assert.equal(status.status, "running");
    assert.equal(status.port, 3000);
    assert.deepEqual(status.artifacts, first.artifacts);
    assert.equal(stopped.status, "stopped");
    assert.equal(stopped.port, 3000);
  });

  it("defaults status to stopped with default artifact paths when no prior state exists", async () => {
    const stateRoot = await fixtureStateRoot();

    const payload = parseToolJson(await dashboardCommand({ stateDir: join(stateRoot, "runs") }));

    assert.equal(payload.action, "status");
    assert.equal(payload.status, "stopped");
    assert.equal(payload.port, 0);
    assert.equal(payload.stateRoot, stateRoot);
    assert.deepEqual(payload.artifacts, {
      json: join(stateRoot, "dashboard", "dashboard.json"),
      html: join(stateRoot, "dashboard", "index.html"),
    });
    assert.equal(resolveExpoStateRoot({ stateDir: join(stateRoot, "runs") }), stateRoot);
  });

  it("skips unreadable sessions and preserves helper contracts", async () => {
    const stateRoot = await fixtureStateRoot();
    await mkdir(join(stateRoot, "sessions", "bad"), { recursive: true });
    await writeFile(join(stateRoot, "sessions", "bad", "session.json"), "{bad json", "utf8");
    await writeSession(stateRoot, "good", { sessionId: "good", createdAt: "created" });

    assert.deepEqual(await dashboardSessions(stateRoot), [{
      sessionId: "good",
      name: null,
      activeTargetId: null,
      lastSnapshotId: null,
      updatedAt: "created",
      path: join(stateRoot, "sessions", "good", "session.json"),
    }]);
    assert.equal(escapeHtml("\"<&>"), "&quot;&lt;&amp;&gt;");
    assert.equal(clampNumber(-10, 0, 65535), 0);
    assert.equal(clampNumber("12", 0, 65535), 12);
    assert.throws(() => clampNumber("nan", 0, 65535), /Expected a finite number/);
  });

  it("rejects unknown dashboard actions with legacy messages", async () => {
    await assert.rejects(() => dashboardCommand({ action: "open" }), /Unknown dashboard action: open/);
  });
});

async function fixtureStateRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "expo98-dashboard-"));
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
