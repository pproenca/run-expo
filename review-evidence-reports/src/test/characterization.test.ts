import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

import {
  diffCommand,
  reviewCommand,
  resolveExpoStateRoot,
  runSummary,
  toolJson,
} from "../main/index.js";
import type { ReviewDiffDependencies, ToolTextResult } from "../main/index.js";

describe("review-evidence-reports legacy characterization", () => {
  it("assembles review reports from latest session, recent run summaries, refs, and artifact roots", async () => {
    const stateRoot = await fixtureStateRoot();
    await writeSession(stateRoot, "old", { sessionId: "old", createdAt: "2026-05-20T10:00:00.000Z" });
    await writeSession(stateRoot, "new", {
      sessionId: "new",
      activeTargetId: "target-1",
      lastSnapshotId: "snap-1",
      createdAt: "2026-05-20T10:00:00.000Z",
      updatedAt: "2026-05-21T10:00:00.000Z",
    });
    await writeJson(join(stateRoot, "sessions", "new", "refs.json"), {
      snapshotId: "snap-1",
      refs: [{ ref: "@e1" }, { ref: "@e2" }],
    });
    for (let index = 0; index < 27; index += 1) {
      await writeJson(join(stateRoot, "runs", `run-${String(index).padStart(2, "0")}.json`), {
        command: index === 26 ? "screenshot" : "console",
        status: index % 2 === 0 ? "completed" : "failed",
        exitCode: index % 2,
        startedAt: `2026-05-21T10:${String(index).padStart(2, "0")}:00.000Z`,
        completedAt: `2026-05-21T10:${String(index).padStart(2, "0")}:30.000Z`,
        summary: { index },
      });
    }
    const outputPath = join(stateRoot, "artifacts", "review-report.json");

    const payload = parseToolJson(await reviewCommand({ action: "report", stateDir: stateRoot, outputPath }));
    const persisted = JSON.parse(await readFile(outputPath, "utf8"));

    assert.equal(payload.available, true);
    assert.equal(payload.action, "report");
    assert.equal(payload.sessionId, "new");
    assert.equal(payload.activeTargetId, "target-1");
    assert.equal(payload.lastSnapshotId, "snap-1");
    assert.equal(payload.runCount, 27);
    assert.equal(payload.recentRuns.length, 25);
    assert.equal(payload.recentRuns[24].command, "screenshot");
    assert.equal(payload.refCount, 2);
    assert.deepEqual(payload.artifacts, {
      runs: join(stateRoot, "runs"),
      sessions: join(stateRoot, "sessions"),
      artifacts: join(stateRoot, "artifacts"),
    });
    assert.equal(payload.limitations[0], "Review reports assemble evidence already captured by other commands; they do not independently judge UI quality.");
    assert.deepEqual(persisted, payload);
  });

  it("builds review matrix checks from captured command evidence without visual-quality judgment", async () => {
    const stateRoot = await fixtureStateRoot();
    await writeSession(stateRoot, "s1", {
      sessionId: "s1",
      activeTargetId: "target-1",
      lastSnapshotId: "snap-1",
      createdAt: "2026-05-21T10:00:00.000Z",
    });
    await writeJson(join(stateRoot, "sessions", "s1", "refs.json"), { snapshotId: "snap-1", refs: [] });
    for (const [index, command] of ["screenshot", "devtools", "console", "gesture"].entries()) {
      await writeJson(join(stateRoot, "runs", `run-${index}.json`), { command, startedAt: `2026-05-21T10:0${index}:00.000Z` });
    }

    const payload = parseToolJson(await reviewCommand({
      action: "matrix",
      stateDir: stateRoot,
      outputPath: join(stateRoot, "artifacts", "review-matrix.json"),
    }));

    assert.equal(payload.available, true);
    assert.equal(payload.action, "matrix");
    assert.equal(payload.passed, true);
    assert.deepEqual(Object.fromEntries(payload.checks.map((check: any) => [check.name, check.passed])), {
      session: true,
      target: true,
      snapshot: true,
      screenshot: true,
      runtime: true,
      diagnostics: true,
      interaction: true,
    });
    assert.equal(payload.runCount, 4);
  });

  it("diffs snapshots by added and removed refs, using explicit current or latest refs fallback", async () => {
    const stateRoot = await fixtureStateRoot();
    await writeSession(stateRoot, "s1", {
      sessionId: "s1",
      lastSnapshotId: "snap-current",
      createdAt: "2026-05-21T10:00:00.000Z",
    });
    const baselinePath = join(stateRoot, "baseline.json");
    const currentPath = join(stateRoot, "current.json");
    await writeJson(baselinePath, { snapshotId: "snap-base", refs: [{ ref: "@e1" }, { ref: "@e2" }] });
    await writeJson(currentPath, { snapshotId: "snap-current", refs: [{ ref: "@e2" }, { ref: "@e3" }] });
    await writeJson(join(stateRoot, "sessions", "s1", "refs.json"), { snapshotId: "snap-current", refs: [{ ref: "@e2" }, { ref: "@e4" }] });

    const explicit = parseToolJson(await diffCommand({
      kind: "snapshot",
      baseline: baselinePath,
      current: currentPath,
      stateDir: stateRoot,
      outputPath: join(stateRoot, "artifacts", "snapshot-explicit.json"),
    }));
    const fallback = parseToolJson(await diffCommand({
      kind: "snapshot",
      baseline: baselinePath,
      stateDir: stateRoot,
      outputPath: join(stateRoot, "artifacts", "snapshot-fallback.json"),
    }));

    assert.deepEqual(explicit.addedRefs, ["@e3"]);
    assert.deepEqual(explicit.removedRefs, ["@e1"]);
    assert.equal(explicit.beforeCount, 2);
    assert.equal(explicit.afterCount, 2);
    assert.deepEqual(fallback.addedRefs, ["@e4"]);
    assert.deepEqual(fallback.removedRefs, ["@e1"]);
  });

  it("diffs screenshot file sizes and route-open evidence with optional screenshot artifacts", async () => {
    const stateRoot = await fixtureStateRoot();
    await writeSession(stateRoot, "s1", { sessionId: "s1", activeTargetId: "target-1", createdAt: "2026-05-21T10:00:00.000Z" });
    const baseline = join(stateRoot, "baseline.png");
    const current = join(stateRoot, "current.png");
    await writeFile(baseline, "12345", "utf8");
    await writeFile(current, "123456789", "utf8");
    const screenshot = parseToolJson(await diffCommand({
      kind: "screenshot",
      baseline,
      current,
      stateDir: stateRoot,
      outputPath: join(stateRoot, "artifacts", "screenshot-diff.json"),
    }));
    const routeCalls: string[] = [];
    const route = parseToolJson(await diffCommand({
      kind: "route",
      routeA: "/before",
      routeB: "/after",
      screenshot: true,
      stateDir: stateRoot,
      outputPath: join(stateRoot, "artifacts", "route-diff.json"),
    }, {
      openExpoRoute: async (args) => {
        routeCalls.push(String(args.route));
        return toolJson({ available: true, route: args.route });
      },
      captureScreenshot: async (args) => ({ outputPath: String(args.outputPath) }),
      nowMs: () => 123,
    }));

    assert.equal(screenshot.byteDelta, 4);
    assert.equal(screenshot.changed, true);
    assert.deepEqual(routeCalls, ["/before", "/after"]);
    assert.equal(route.screenshots.before.endsWith("route-a-123.png"), true);
    assert.equal(route.screenshots.after.endsWith("route-b-123.png"), true);
    assert.equal(route.limitations[0], "Route diff captures route-open evidence and optional screenshots; semantic visual comparison is left to the caller.");
  });

  it("preserves unknown action/kind errors, state-root normalization, and run summaries", async () => {
    await assert.rejects(() => reviewCommand({ action: "audit" }), /Unknown review action: audit/);
    await assert.rejects(() => diffCommand({ kind: "tree" }), /Unknown diff kind: tree/);

    assert.equal(resolveExpoStateRoot({ stateDir: "/tmp/expo/runs" }), "/tmp/expo");
    assert.deepEqual(runSummary({
      command: "console",
      status: "completed",
      exitCode: 0,
      createdAt: "created",
      finishedAt: "finished",
      path: "/runs/run.json",
      summary: { messages: 2 },
    }), {
      command: "console",
      status: "completed",
      exitCode: 0,
      startedAt: "created",
      completedAt: "finished",
      path: "/runs/run.json",
      summary: { messages: 2 },
    });
  });
});

async function fixtureStateRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "expo98-review-"));
  await mkdir(join(root, "sessions"), { recursive: true });
  await mkdir(join(root, "runs"), { recursive: true });
  await mkdir(join(root, "artifacts"), { recursive: true });
  return root;
}

async function writeSession(stateRoot: string, id: string, record: Record<string, unknown>): Promise<void> {
  const dir = join(stateRoot, "sessions", id);
  await mkdir(dir, { recursive: true });
  await writeJson(join(dir, "session.json"), record);
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function parseToolJson(result: ToolTextResult): any {
  return JSON.parse(result.content[0]?.text ?? "null");
}
