import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  cleanSessions,
  closeSession,
  createSession,
  errorCodeForExitCode,
  exitCodeForError,
  listSessions,
  normalizeSessionName,
  parseDurationMs,
  readLatestSession,
  resolveExpoStateRoot,
  sessionCommand,
  showSession,
  startRunRecord,
  truncateOutput,
  validateOutputMode,
} from "../main/index.js";
import type { SessionRecord } from "../main/index.js";

const CREATED_AT = "2026-05-23T14:05:06.789Z";
const CLOSED_AT = "2026-05-23T15:10:11.123Z";
const RUN_STARTED_AT = "2026-05-23T16:20:30.456Z";
const RUN_FINISHED_AT = "2026-05-23T16:20:31.456Z";

describe("session-run-records legacy characterization", () => {
  describe("session names, durations, and state roots", () => {
    it("RULE-018 normalizes session names with legacy lowercase dash collapse and 48 character cap", () => {
      assert.equal(normalizeSessionName(" Customer Review: iOS #1 "), "customer-review-ios-1");
      assert.equal(normalizeSessionName("Release_Candidate.2026"), "release_candidate.2026");
      assert.equal(normalizeSessionName("A".repeat(60)), "a".repeat(48));
    });

    it("RULE-018 rejects names that normalize to an empty string", async () => {
      await assert.rejects(
        async () => normalizeSessionName(" !!! "),
        /name must include at least one letter or number\./,
      );
    });

    it("RULE-013 parses only legacy duration units for session clean", () => {
      assert.equal(parseDurationMs("30s"), 30_000);
      assert.equal(parseDurationMs("2m"), 120_000);
      assert.equal(parseDurationMs("1h"), 3_600_000);
      assert.equal(parseDurationMs("7d"), 604_800_000);
    });

    it("RULE-013 rejects malformed clean durations with the legacy message", async () => {
      await assert.rejects(
        async () => parseDurationMs("7days"),
        /duration must look like 30s, 2m, 1h, or 7d\./,
      );
    });

    it("RULE-013 resolves --state-dir ending in runs to the parent state root", () => {
      const project = path.resolve(".tmp", "expo98-state-root");
      const runsDir = path.join(project, ".scratch", "expo-ios", "runs");

      assert.equal(
        resolveExpoStateRoot({ stateDir: runsDir }),
        path.join(project, ".scratch", "expo-ios"),
      );
      assert.equal(
        resolveExpoStateRoot({ stateDir: path.join(project, "custom-state") }),
        path.join(project, "custom-state"),
      );
      assert.equal(
        resolveExpoStateRoot({ root: project, cwd: path.join(project, "ignored") }),
        path.join(project, ".scratch", "expo-ios"),
      );
    });
  });

  describe("session lifecycle", () => {
    it("sessionCommand creates a default review session and wraps it as tool JSON", async () => {
      await usingTempDir(async (project) => {
        const payload = parseToolJson(await sessionCommand({
          action: "new",
          root: project,
        }, {
          now: fixedClock(CREATED_AT),
          randomSuffix: () => "abc123",
        }));

        const stateRoot = path.join(project, ".scratch", "expo-ios");
        const sessionId = "review-20260523-140506-abc123";
        assert.deepEqual(payload, {
          schemaVersion: 1,
          sessionId,
          name: "review",
          artifactDir: path.join(stateRoot, "sessions", sessionId, "artifacts"),
          createdAt: CREATED_AT,
          updatedAt: CREATED_AT,
          activeTargetId: null,
          lastSnapshotId: null,
          sidecars: [],
        });
      });
    });

    it("sessionCommand lists, shows, closes, and cleans sessions with legacy envelopes", async () => {
      await usingTempDir(async (project) => {
        const stateRoot = path.join(project, ".scratch", "expo-ios");
        await writeSessionFixture(stateRoot, {
          sessionId: "old",
          name: "old",
          createdAt: "2026-05-01T00:00:00.000Z",
        });
        await writeSessionFixture(stateRoot, {
          sessionId: "recent",
          name: "recent",
          createdAt: "2026-05-22T00:00:00.000Z",
        });

        const listed = parseToolJson(await sessionCommand({ action: "list", root: project }));
        assert.equal(listed.available, true);
        assert.equal(listed.action, "list");
        assert.equal(listed.stateRoot, stateRoot);
        assert.deepEqual(listed.sessions.map((session: SessionRecord) => session.sessionId), ["old", "recent"]);

        const shown = parseToolJson(await sessionCommand({ action: "show", name: "old", root: project }));
        assert.equal(shown.available, true);
        assert.equal(shown.action, "show");
        assert.equal(shown.session.sessionId, "old");

        const missing = parseToolJson(await sessionCommand({ action: "show", name: "missing", root: project }));
        assert.deepEqual(missing, {
          available: false,
          action: "show",
          reason: "Session not found.",
          name: "missing",
        });

        const closed = parseToolJson(await sessionCommand({ action: "close", root: project }, { now: fixedClock(CLOSED_AT) }));
        assert.equal(closed.available, true);
        assert.equal(closed.action, "close");
        assert.equal(closed.session.sessionId, "recent");
        assert.equal(closed.session.closedAt, CLOSED_AT);
        assert.deepEqual(closed.session.sidecars, []);

        const cleaned = parseToolJson(await sessionCommand({ action: "clean", olderThan: "7d", root: project }, {
          now: fixedClock("2026-05-23T00:00:00.000Z"),
        }));
        assert.deepEqual(cleaned, {
          available: true,
          action: "clean",
          stateRoot,
          olderThan: "7d",
          removed: ["old"],
        });
      });
    });

    it("sessionCommand rejects unknown actions with the legacy message", async () => {
      await assert.rejects(
        () => sessionCommand({ action: "delete" }),
        /Unknown session action: delete/,
      );
    });

    it("RULE-013 RULE-018 creates a default review session namespace and persists exact JSON", async () => {
      await usingTempDir(async (project) => {
        const stateRoot = path.join(project, ".scratch", "expo-ios");
        const session = await createSession({
          stateRoot,
          name: undefined,
          now: fixedClock(CREATED_AT),
          randomSuffix: () => "abc123",
        });

        const sessionId = "review-20260523-140506-abc123";
        const expected = {
          schemaVersion: 1,
          sessionId,
          name: "review",
          artifactDir: path.join(stateRoot, "sessions", sessionId, "artifacts"),
          createdAt: CREATED_AT,
          updatedAt: CREATED_AT,
          activeTargetId: null,
          lastSnapshotId: null,
          sidecars: [],
        };

        assert.deepEqual(session, expected);
        assert.equal((await stat(expected.artifactDir)).isDirectory(), true);
        assert.equal(
          await readFile(path.join(stateRoot, "sessions", sessionId, "session.json"), "utf8"),
          `${JSON.stringify(expected, null, 2)}\n`,
        );
      });
    });

    it("RULE-013 lists sessions sorted by createdAt and skips invalid session directories", async () => {
      await usingTempDir(async (project) => {
        const stateRoot = path.join(project, ".scratch", "expo-ios");
        await writeSessionFixture(stateRoot, {
          sessionId: "late",
          name: "late",
          createdAt: "2026-05-23T12:00:00.000Z",
        });
        await writeSessionFixture(stateRoot, {
          sessionId: "early",
          name: "early",
          createdAt: "2026-05-22T12:00:00.000Z",
        });
        await mkdir(path.join(stateRoot, "sessions", "missing-json"), { recursive: true });
        await mkdir(path.join(stateRoot, "sessions", "malformed"), { recursive: true });
        await writeFile(path.join(stateRoot, "sessions", "malformed", "session.json"), "{", "utf8");

        const sessions = await listSessions(stateRoot);

        assert.deepEqual(sessions.map((session: SessionRecord) => session.sessionId), ["early", "late"]);
      });
    });

    it("RULE-013 shows latest session by default and can show by name or sessionId", async () => {
      await usingTempDir(async (project) => {
        const stateRoot = path.join(project, ".scratch", "expo-ios");
        await writeSessionFixture(stateRoot, {
          sessionId: "review-1",
          name: "review",
          createdAt: "2026-05-22T12:00:00.000Z",
        });
        await writeSessionFixture(stateRoot, {
          sessionId: "audit-1",
          name: "audit",
          createdAt: "2026-05-23T12:00:00.000Z",
        });

        assert.deepEqual(await showSession({ stateRoot }), {
          available: true,
          action: "show",
          session: await readSessionFixture(stateRoot, "audit-1"),
        });
        assert.deepEqual(await showSession({ stateRoot, name: "review" }), {
          available: true,
          action: "show",
          session: await readSessionFixture(stateRoot, "review-1"),
        });
        assert.deepEqual(await showSession({ stateRoot, name: "audit-1" }), {
          available: true,
          action: "show",
          session: await readSessionFixture(stateRoot, "audit-1"),
        });
      });
    });

    it("RULE-013 returns unavailable show and close payloads when no session matches", async () => {
      await usingTempDir(async (project) => {
        const stateRoot = path.join(project, ".scratch", "expo-ios");

        assert.deepEqual(await showSession({ stateRoot, name: "missing" }), {
          available: false,
          action: "show",
          reason: "Session not found.",
          name: "missing",
        });
        assert.deepEqual(await closeSession({ stateRoot, name: "missing", now: fixedClock(CLOSED_AT) }), {
          available: false,
          action: "close",
          reason: "Session not found.",
          name: "missing",
        });
      });
    });

    it("RULE-013 closes the latest matching session, stamps closedAt and updatedAt, and clears sidecars", async () => {
      await usingTempDir(async (project) => {
        const stateRoot = path.join(project, ".scratch", "expo-ios");
        await writeSessionFixture(stateRoot, {
          sessionId: "review-1",
          name: "review",
          createdAt: "2026-05-22T12:00:00.000Z",
          sidecars: [{ name: "dashboard", pid: 123, port: 4510, status: "running" }],
        });
        await writeSessionFixture(stateRoot, {
          sessionId: "audit-1",
          name: "audit",
          createdAt: "2026-05-23T12:00:00.000Z",
          sidecars: [{ name: "overlay", pid: 456, port: 4520, status: "running" }],
        });

        const closed = await closeSession({ stateRoot, now: fixedClock(CLOSED_AT) });

        assert.equal(closed.available, true);
        if (!closed.available) {
          throw new Error("expected closeSession to return an available session");
        }
        assert.equal(closed.action, "close");
        const audit = await readSessionFixture(stateRoot, "audit-1");
        assert.deepEqual(closed.session, {
          ...audit,
          closedAt: CLOSED_AT,
          updatedAt: CLOSED_AT,
          sidecars: [],
        });
        assert.deepEqual(await readSessionFixture(stateRoot, "audit-1"), closed.session);
      });
    });

    it("RULE-013 cleans sessions older than the cutoff and preserves recent or malformed dates", async () => {
      await usingTempDir(async (project) => {
        const stateRoot = path.join(project, ".scratch", "expo-ios");
        await writeSessionFixture(stateRoot, {
          sessionId: "old",
          name: "old",
          createdAt: "2026-05-01T00:00:00.000Z",
        });
        await writeSessionFixture(stateRoot, {
          sessionId: "recent",
          name: "recent",
          createdAt: "2026-05-22T00:00:00.000Z",
        });
        await writeSessionFixture(stateRoot, {
          sessionId: "malformed-date",
          name: "malformed-date",
          createdAt: "not-a-date",
        });

        const result = await cleanSessions({
          stateRoot,
          olderThan: "7d",
          now: fixedClock("2026-05-23T00:00:00.000Z"),
        });

        assert.deepEqual(result, {
          available: true,
          action: "clean",
          stateRoot,
          olderThan: "7d",
          removed: ["old"],
        });
        assert.deepEqual((await readdir(path.join(stateRoot, "sessions"))).sort(), [
          "malformed-date",
          "recent",
        ]);
      });
    });

    it("RULE-013 reads the latest session by updatedAt before createdAt for dependent modules", async () => {
      await usingTempDir(async (project) => {
        const stateRoot = path.join(project, ".scratch", "expo-ios");
        await writeSessionFixture(stateRoot, {
          sessionId: "created-later",
          name: "created-later",
          createdAt: "2026-05-23T12:00:00.000Z",
          updatedAt: "2026-05-23T12:00:00.000Z",
        });
        await writeSessionFixture(stateRoot, {
          sessionId: "updated-later",
          name: "updated-later",
          createdAt: "2026-05-22T12:00:00.000Z",
          updatedAt: "2026-05-24T12:00:00.000Z",
        });

        assert.equal((await readLatestSession(stateRoot))?.sessionId, "updated-later");
      });
    });
  });

  describe("run records", () => {
    it("RULE-014 returns a no-op recorder when neither --record nor --state-dir is present", async () => {
      await usingTempDir(async (project) => {
        const recorder = await startRunRecord({
          command: "doctor",
          args: { cwd: project },
          globals: {},
          cwd: project,
          now: fixedClock(RUN_STARTED_AT),
          randomSuffix: () => "run123",
        });

        assert.deepEqual(recorder.path, null);
        await recorder.finish({ status: "completed", exitCode: 0, payload: { available: true } });
        await assert.rejects(async () => readdir(path.join(project, ".scratch")), /ENOENT/);
      });
    });

    it("RULE-002 RULE-014 RULE-018 starts and completes a redacted run record with legacy ID shape", async () => {
      await usingTempDir(async (project) => {
        const stateDir = path.join(project, ".scratch", "expo-ios", "runs");
        const recorder = await startRunRecord({
          command: "review-next",
          args: {
            cwd: project,
            issue: "myapp://customers?token=session-secret",
            headers: { authorization: "Bearer session-secret" },
          },
          globals: { stateDir },
          cwd: project,
          now: sequenceClock(RUN_STARTED_AT, RUN_FINISHED_AT),
          randomSuffix: () => "run123",
        });

        const runId = "20260523-162030Z-run123";
        const recordPath = path.join(stateDir, `${runId}.json`);
        assert.equal(recorder.path, recordPath);
        assert.deepEqual(JSON.parse(await readFile(recordPath, "utf8")), {
          schemaVersion: 1,
          runId,
          cli: { name: "expo-ios", version: "0.1.0" },
          command: "review-next",
          args: {
            cwd: project,
            issue: "myapp://customers?token=[redacted]",
            headers: { authorization: "[redacted]" },
          },
          root: project,
          stateDir,
          startedAt: RUN_STARTED_AT,
          finishedAt: null,
          status: "running",
          exitCode: null,
        });

        await recorder.finish({
          status: "completed",
          exitCode: 0,
          payload: { available: true, routeCount: 2, events: [{}, {}, {}], extra: "value" },
        });

        assert.deepEqual(JSON.parse(await readFile(recordPath, "utf8")), {
          schemaVersion: 1,
          runId,
          cli: { name: "expo-ios", version: "0.1.0" },
          command: "review-next",
          args: {
            cwd: project,
            issue: "myapp://customers?token=[redacted]",
            headers: { authorization: "[redacted]" },
          },
          root: project,
          stateDir,
          startedAt: RUN_STARTED_AT,
          finishedAt: RUN_FINISHED_AT,
          status: "completed",
          exitCode: 0,
          summary: {
            keys: ["available", "routeCount", "events", "extra"],
            available: true,
            routeCount: 2,
            eventCount: 3,
          },
          error: null,
        });
      });
    });

    it("RULE-014 records failed runs with sanitized error output", async () => {
      await usingTempDir(async (project) => {
        const stateDir = path.join(project, ".scratch", "expo-ios", "runs");
        const recorder = await startRunRecord({
          command: "open-url",
          args: { cwd: project, url: "fixture://customers?token=session-secret" },
          globals: { record: true, root: project },
          cwd: project,
          now: sequenceClock(RUN_STARTED_AT, RUN_FINISHED_AT),
          randomSuffix: () => "fail99",
        });
        const error = Object.assign(new Error("native failed for fixture://x?secret=session-secret"), {
          stdout: "opened fixture://x?token=session-secret",
        });

        await recorder.finish({ status: "failed", exitCode: 1, error });

        const persisted = await readFile(String(recorder.path), "utf8");
        assert.doesNotMatch(persisted, /session-secret/);
        const record = JSON.parse(persisted);
        assert.equal(record.status, "failed");
        assert.equal(record.error, "native failed for fixture://x?secret=[redacted]");
      });
    });

    it("RULE-014 summarizes non-object payloads as null and caps payload keys at forty", async () => {
      await usingTempDir(async (project) => {
        const nullSummaryStateDir = path.join(project, "non-object-runs");
        const nullSummaryRecorder = await startRunRecord({
          command: "doctor",
          args: { cwd: project },
          globals: { stateDir: nullSummaryStateDir },
          cwd: project,
          now: sequenceClock(RUN_STARTED_AT, RUN_FINISHED_AT),
          randomSuffix: () => "null00",
        });
        await nullSummaryRecorder.finish({ status: "completed", exitCode: 0, payload: "ok" });
        assert.equal(JSON.parse(await readFile(String(nullSummaryRecorder.path), "utf8")).summary, null);

        const cappedSummaryStateDir = path.join(project, "runs");
        const cappedSummaryRecorder = await startRunRecord({
          command: "routes",
          args: { cwd: project },
          globals: { stateDir: cappedSummaryStateDir },
          cwd: project,
          now: sequenceClock(RUN_STARTED_AT, RUN_FINISHED_AT),
          randomSuffix: () => "keys40",
        });
        const payload = Object.fromEntries(Array.from({ length: 45 }, (_, index) => [`k${index}`, index]));

        await cappedSummaryRecorder.finish({ status: "completed", exitCode: 0, payload });

        const record = JSON.parse(await readFile(String(cappedSummaryRecorder.path), "utf8"));
        assert.deepEqual(record.summary, {
          keys: Array.from({ length: 40 }, (_, index) => `k${index}`),
        });
      });
    });
  });

  describe("error classification", () => {
    it("RULE-007 rejects mutually exclusive JSON and plain output modes with invalid usage", () => {
      assert.throws(
        () => validateOutputMode({ json: true, plain: true }),
        (error: unknown) => {
          const record = error as { name?: string; message?: string; exitCode?: number };
          assert.equal(record.name, "CliUsageError");
          assert.equal(record.message, "--json and --plain are mutually exclusive.");
          assert.equal(record.exitCode, 2);
          assert.equal(exitCodeForError(error), 2);
          return true;
        },
      );
      assert.equal(exitCodeForError({ message: "--json and --plain are mutually exclusive." }), 2);
    });

    it("RULE-007 RULE-014 preserves explicit integer exit codes", () => {
      assert.equal(exitCodeForError({ exitCode: 7, message: "custom" }), 7);
    });

    it("RULE-007 RULE-014 maps legacy usage-message patterns to invalid usage exit code 2", () => {
      for (const message of [
        "Unknown command: nope",
        "--state-dir requires a value.",
        "Expected a finite number, got nope.",
        "name must be a non-empty string.",
        "duration must look like 30s, 2m, 1h, or 7d.",
        "field must not contain whitespace.",
        "--args-json must be valid JSON: bad",
      ]) {
        assert.equal(exitCodeForError({ message }), 2);
      }
    });

    it("RULE-014 maps runtime errors to exit code 1 and exit codes to stable error codes", () => {
      assert.equal(exitCodeForError({ message: "simulator failed" }), 1);
      assert.equal(errorCodeForExitCode(2), "invalid_usage");
      assert.equal(errorCodeForExitCode(1), "runtime_failure");
      assert.equal(errorCodeForExitCode(0), "error");
      assert.equal(errorCodeForExitCode(7), "error");
    });
  });

  describe("error formatting and output truncation", () => {
    it("RULE-021 keeps bounded output unchanged and normalizes nullish output to an empty string", () => {
      assert.equal(truncateOutput("abc", 3), "abc");
      assert.equal(truncateOutput(null, 3), "");
    });

    it("RULE-021 truncates output with the exact legacy overflow marker", () => {
      assert.equal(truncateOutput("abcdef", 3), "abc\n[truncated 3 characters]");
    });

    it("RULE-014 RULE-021 formats stdout and stderr sections with legacy blank-line separation", async () => {
      await usingTempDir(async (project) => {
        const stateDir = path.join(project, ".scratch", "expo-ios", "runs");
        const recorder = await startRunRecord({
          command: "doctor",
          args: { cwd: project },
          globals: { stateDir },
          cwd: project,
          now: sequenceClock(RUN_STARTED_AT, RUN_FINISHED_AT),
          randomSuffix: () => "stderr",
        });
        const error = Object.assign(new Error("native failed"), {
          stdout: "plain stdout",
          stderr: "plain stderr",
        });

        await recorder.finish({ status: "failed", exitCode: 1, error });

        const record = JSON.parse(await readFile(String(recorder.path), "utf8"));
        assert.equal(record.error, "native failed\n\nstdout:\nplain stdout\n\nstderr:\nplain stderr");
      });
    });
  });
});

async function usingTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = path.resolve(".tmp", `expo98-session-records-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(dir, { recursive: true });
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function parseToolJson(result: { content: Array<{ text: string }> }): any {
  return JSON.parse(result.content[0]?.text ?? "null");
}

function fixedClock(iso: string): () => Date {
  return () => new Date(iso);
}

function sequenceClock(firstIso: string, ...remainingIsos: string[]): () => Date {
  const isos = [firstIso, ...remainingIsos];
  let index = 0;
  return () => new Date(isos[Math.min(index++, isos.length - 1)] ?? firstIso);
}

type SessionFixture = {
  schemaVersion: 1;
  sessionId: string;
  name: string;
  artifactDir: string;
  createdAt: string;
  updatedAt: string;
  activeTargetId: string | null;
  lastSnapshotId: string | null;
  sidecars: Array<{ name: string; pid: number | null; port: number | null; status: "running" | "stale" | "stopped" | "unknown" }>;
};

async function writeSessionFixture(
  stateRoot: string,
  overrides: Partial<SessionFixture>,
): Promise<void> {
  const sessionId = overrides.sessionId ?? "review-1";
  const sessionDir = path.join(stateRoot, "sessions", sessionId);
  const artifactDir = overrides.artifactDir ?? path.join(sessionDir, "artifacts");
  const record = {
    schemaVersion: 1,
    sessionId,
    name: overrides.name ?? "review",
    artifactDir,
    createdAt: overrides.createdAt ?? "2026-05-23T00:00:00.000Z",
    updatedAt: overrides.updatedAt ?? overrides.createdAt ?? "2026-05-23T00:00:00.000Z",
    activeTargetId: overrides.activeTargetId ?? null,
    lastSnapshotId: overrides.lastSnapshotId ?? null,
    sidecars: overrides.sidecars ?? [],
  };
  await mkdir(artifactDir, { recursive: true });
  await writeFile(path.join(sessionDir, "session.json"), `${JSON.stringify(record, null, 2)}\n`, "utf8");
}

async function readSessionFixture(stateRoot: string, sessionId: string): Promise<SessionFixture> {
  return JSON.parse(await readFile(path.join(stateRoot, "sessions", sessionId, "session.json"), "utf8"));
}
