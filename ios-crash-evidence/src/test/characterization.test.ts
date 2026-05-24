import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  attachIosCrashEvidence,
  iosCrashEvidence,
  matchingIosCrashReports,
  readCrashReportMetadata,
} from "../main/index.js";
import type { DirentLike, IosCrashEvidenceDependencies, StatLike } from "../main/index.js";

const REPORTS_DIR = "/diagnostics";
const SINCE = Date.parse("2026-05-23T10:00:00.000Z");

describe("ios-crash-evidence legacy characterization", () => {
  it("returns payload unchanged for non-iOS platforms", async () => {
    const payload = { available: true, platform: "android" };
    assert.equal(await attachIosCrashEvidence(payload, {
      platform: "android",
      bundleId: "com.example",
      sinceMs: SINCE,
      action: "launch-app",
    }, fakeReports([])), payload);
  });

  it("builds a crash check with bounded wait time and no reports", async () => {
    const waited: number[] = [];
    const result = await iosCrashEvidence({
      bundleId: "com.example",
      processName: "Example",
      sinceMs: SINCE,
      waitMs: 45_000,
      action: "launch-app",
    }, { ...fakeReports([]), wait: async (ms) => { waited.push(ms); } });

    assert.deepEqual(waited, [30_000]);
    assert.deepEqual(result, {
      crashCheck: {
        action: "launch-app",
        bundleId: "com.example",
        processName: "Example",
        since: "2026-05-23T10:00:00.000Z",
        waitedMs: 30_000,
        reportCount: 0,
      },
      crashReports: [],
    });
  });

  it("matches reports by bundle id, process-name filename, and metadata process name", async () => {
    const deps = fakeReports([
      report("b.crash", Date.parse("2026-05-23T10:03:00.000Z"), { bundleID: "com.example", app_name: "Other", incident_id: "B" }),
      report("a-Example.ips", Date.parse("2026-05-23T10:02:00.000Z"), { bundleId: "other.bundle", name: "Other", incident: "A" }),
      report("c.crash", Date.parse("2026-05-23T10:04:00.000Z"), { procName: "Example" }),
      report("old.crash", Date.parse("2026-05-23T09:59:59.000Z"), { bundleID: "com.example" }),
      report("ignored.txt", Date.parse("2026-05-23T10:05:00.000Z"), { bundleID: "com.example" }),
      directory("folder.crash"),
    ]);

    assert.deepEqual(await matchingIosCrashReports({
      bundleId: "com.example",
      processName: "Example",
      sinceMs: SINCE,
    }, deps), [
      {
        path: "/diagnostics/a-Example.ips",
        file: "a-Example.ips",
        mtime: "2026-05-23T10:02:00.000Z",
        appName: "Other",
        bundleId: "other.bundle",
        incidentId: "A",
      },
      {
        path: "/diagnostics/b.crash",
        file: "b.crash",
        mtime: "2026-05-23T10:03:00.000Z",
        appName: "Other",
        bundleId: "com.example",
        incidentId: "B",
      },
      {
        path: "/diagnostics/c.crash",
        file: "c.crash",
        mtime: "2026-05-23T10:04:00.000Z",
        appName: "Example",
        bundleId: null,
        incidentId: null,
      },
    ]);
  });

  it("returns no matches when no bundleId or processName is provided", async () => {
    assert.deepEqual(await matchingIosCrashReports({ sinceMs: SINCE }, fakeReports([
      report("example.crash", Date.parse("2026-05-23T10:03:00.000Z"), { bundleID: "com.example" }),
    ])), []);
  });

  it("attaches non-fatal evidence when no crash reports match", async () => {
    assert.deepEqual(await attachIosCrashEvidence({ available: true }, {
      platform: "ios",
      bundleId: "com.example",
      sinceMs: SINCE,
      waitMs: 0,
      action: "terminate-app",
    }, fakeReports([])), {
      available: true,
      crashCheck: {
        action: "terminate-app",
        bundleId: "com.example",
        processName: null,
        since: "2026-05-23T10:00:00.000Z",
        waitedMs: 0,
        reportCount: 0,
      },
      crashReports: [],
    });
  });

  it("marks iOS payload unavailable when matching crash reports exist", async () => {
    const result = await attachIosCrashEvidence({ available: true, stdout: "ok" }, {
      platform: "ios",
      bundleId: "com.example",
      sinceMs: SINCE,
      waitMs: 0,
      action: "launch-app",
    }, fakeReports([
      report("example.crash", Date.parse("2026-05-23T10:03:00.000Z"), { bundleID: "com.example" }),
    ]));

    const crashResult = result as typeof result & { reason: string; crashReports: unknown[] };
    assert.equal(crashResult.available, false);
    assert.equal(crashResult.reason, "The app generated 1 matching iOS crash report(s) after launch-app.");
    assert.equal(crashResult.crashReports.length, 1);
  });

  it("parses only the first JSON line and returns null for non-JSON, invalid, or unreadable reports", async () => {
    assert.deepEqual(await readCrashReportMetadata("/ok", {
      readFile: async () => "  {\"bundleID\":\"com.example\"}\nignored",
    }), { bundleID: "com.example" });
    assert.equal(await readCrashReportMetadata("/not-json", {
      readFile: async () => "Incident Identifier: 123\n{}",
    }), null);
    assert.equal(await readCrashReportMetadata("/bad-json", {
      readFile: async () => "{bad",
    }), null);
    assert.equal(await readCrashReportMetadata("/missing", {
      readFile: async () => { throw new Error("missing"); },
    }), null);
  });
});

type FakeReport = {
  name: string;
  isFile: boolean;
  mtimeMs?: number;
  metadata?: Record<string, unknown>;
};

function fakeReports(reports: FakeReport[]): IosCrashEvidenceDependencies {
  const byPath = new Map(reports.map((entry) => [`${REPORTS_DIR}/${entry.name}`, entry]));
  return {
    reportsDir: REPORTS_DIR,
    readdir: async () => reports.map((entry): DirentLike => ({
      name: entry.name,
      isFile: () => entry.isFile,
    })),
    stat: async (file): Promise<StatLike> => {
      const entry = byPath.get(file);
      if (!entry || entry.mtimeMs == null) throw new Error("missing");
      return { mtimeMs: entry.mtimeMs, mtime: new Date(entry.mtimeMs) };
    },
    readFile: async (file) => {
      const entry = byPath.get(file);
      if (!entry?.metadata) return "";
      return `${JSON.stringify(entry.metadata)}\nrest`;
    },
  };
}

function report(name: string, mtimeMs: number, metadata: Record<string, unknown>): FakeReport {
  return { name, isFile: true, mtimeMs, metadata };
}

function directory(name: string): FakeReport {
  return { name, isFile: false };
}
