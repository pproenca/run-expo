import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  annotateScreen,
  annotationHtml,
  clampNumber,
  requireOptionalString,
  toolJson,
  unwrapToolJson,
} from "../main/index.js";
import type { AnnotateScreenDependencies, ToolTextResult } from "../main/index.js";

describe("annotate-screen-artifacts legacy characterization", () => {
  it("captures UX context by default, writes context, annotations, HTML, and file-mode instructions", async () => {
    const writes: Array<{ file: string; data: string }> = [];
    const calls: Array<Record<string, unknown>> = [];
    const result = parseToolJson(await annotateScreen({ cwd: "/repo/app", title: "Review <A>", metroPort: 19000 }, deps({
      writes,
      calls,
      pathExists: async () => false,
    })));

    assert.equal(result.outputDir, "/repo/app/.scratch/expo-ios-annotations/annotation-2026-05-23T12-34-56-789Z");
    assert.equal(result.screenshotPath, `${result.outputDir}/screenshot.png`);
    assert.equal(result.contextPath, `${result.outputDir}/context.json`);
    assert.equal(result.annotationsPath, `${result.outputDir}/annotations.json`);
    assert.equal(result.htmlPath, `${result.outputDir}/annotate.html`);
    assert.equal(result.server, null);
    assert.deepEqual(calls[0], {
      cwd: "/repo/app",
      device: undefined,
      bundleId: undefined,
      metroPort: 19000,
      outputPath: `${result.outputDir}/screenshot.png`,
      includeScreenshot: true,
      includeImageAnalysis: true,
      includeHierarchy: true,
      includeRuntime: true,
      includeComponents: true,
      includeLogs: false,
    });
    assert.deepEqual(JSON.parse(writes.find((entry) => entry.file.endsWith("context.json"))?.data ?? "{}"), { source: "ux-context" });
    assert.deepEqual(JSON.parse(writes.find((entry) => entry.file.endsWith("annotations.json"))?.data ?? "{}"), {
      version: 1,
      title: "Review <A>",
      createdAt: "2026-05-23T12:34:56.789Z",
      screenshot: "screenshot.png",
      context: "context.json",
      comments: [],
    });
    assert.match(writes.find((entry) => entry.file.endsWith("annotate.html"))?.data ?? "", /Review &lt;A&gt;/);
    assert.match(writes.find((entry) => entry.file.endsWith("annotate.html"))?.data ?? "", /mousedown/);
    assert.match(writes.find((entry) => entry.file.endsWith("annotate.html"))?.data ?? "", /kind: 'rect'/);
    assert.match(result.instructions[0], /Open .*annotate\.html/);
  });

  it("copies a provided screenshot and skips annotation JSON initialization when it already exists", async () => {
    const copies: Array<{ from: string; to: string }> = [];
    const writes: Array<{ file: string; data: string }> = [];
    const result = parseToolJson(await annotateScreen({
      cwd: "/repo/app",
      outputDir: "/tmp/out",
      screenshotPath: "/tmp/source.png",
    }, deps({
      copies,
      writes,
      pathExists: async (file) => file.endsWith("annotations.json"),
    })));

    assert.deepEqual(copies, [{ from: "/tmp/source.png", to: "/tmp/out/screenshot.png" }]);
    assert.deepEqual(JSON.parse(writes.find((entry) => entry.file.endsWith("context.json"))?.data ?? "{}"), {
      source: "provided-screenshot",
      screenshot: { outputPath: "/tmp/out/screenshot.png" },
      capturedAt: "2026-05-23T12:34:56.789Z",
    });
    assert.equal(writes.some((entry) => entry.file.endsWith("annotations.json")), false);
    assert.equal(result.annotationsPath, "/tmp/out/annotations.json");
  });

  it("uses screenshot-only fallback when includeUxContext is false", async () => {
    const shots: Array<Record<string, unknown>> = [];
    const result = parseToolJson(await annotateScreen({
      cwd: "/repo/app",
      outputDir: "/tmp/out",
      includeUxContext: false,
      device: "iPhone",
    }, deps({
      automationTakeScreenshot: async (args) => {
        shots.push(args);
        return toolJson({ outputPath: args.outputPath, platform: args.platform });
      },
    })));

    assert.deepEqual(shots, [{ platform: "ios", device: "iPhone", outputPath: "/tmp/out/screenshot.png" }]);
    assert.equal(result.screenshotPath, "/tmp/out/screenshot.png");
  });

  it("starts a detached annotation server descriptor when serve is true", async () => {
    const spawns: Array<Record<string, unknown>> = [];
    const result = parseToolJson(await annotateScreen({
      cwd: "/repo/app",
      outputDir: "/tmp/out",
      includeUxContext: false,
      serve: true,
      port: "70000",
    }, deps({
      spawns,
      openLogFile: async () => 12,
      spawnDetached: async (command, argv, options) => {
        spawns.push({ command, argv, options });
        return { pid: 4321, unref: () => spawns.push({ unref: true }) };
      },
    })));

    assert.equal(result.server.url, "http://127.0.0.1:65535/");
    assert.equal(result.server.pid, 4321);
    assert.equal(result.server.logPath, "/tmp/out/annotation-server.log");
    assert.equal(result.server.stop, "kill 4321");
    assert.deepEqual(spawns[0]?.argv, [
      "/bin/expo-ios",
      "annotation-server",
      "--dir",
      "/tmp/out",
      "--port",
      "65535",
    ]);
    assert.match(result.instructions[0], /Open http:\/\/127\.0\.0\.1:65535\//);
  });

  it("uses findAvailablePort when no serve port is supplied and preserves helper contracts", async () => {
    const result = parseToolJson(await annotateScreen({
      cwd: "/repo/app",
      outputDir: "/tmp/out",
      includeUxContext: false,
      serve: true,
    }, deps({ findAvailablePort: async () => 17660 })));

    assert.equal(result.server.url, "http://127.0.0.1:17660/");
    assert.equal(requireOptionalString("  x  "), "x");
    assert.equal(requireOptionalString(" "), null);
    assert.equal(requireOptionalString(1), null);
    assert.equal(clampNumber("99999", 1, 65535), 65535);
    assert.throws(() => clampNumber("bad", 1, 65535), /Expected a finite number, got bad/);
    assert.deepEqual(unwrapToolJson(toolJson({ ok: true })), { ok: true });
    assert.deepEqual(unwrapToolJson({ content: [{ type: "text", text: "not json" }] }), { text: "not json" });
    assert.match(annotationHtml({ title: "\"quoted\"" }), /&quot;quoted&quot;/);
  });
});

function deps(overrides: Partial<AnnotateScreenDependencies> & {
  writes?: Array<{ file: string; data: string }>;
  copies?: Array<{ from: string; to: string }>;
  calls?: Array<Record<string, unknown>>;
  spawns?: Array<Record<string, unknown>>;
} = {}): AnnotateScreenDependencies {
  const writes = overrides.writes ?? [];
  const copies = overrides.copies ?? [];
  const calls = overrides.calls ?? [];
  return {
    normalizeProjectCwd: async (cwd) => String(cwd ?? "/repo/app"),
    fallbackCwd: () => "/fallback",
    resolvePath: (...parts) => parts.join("/").replace(/\/+/g, "/"),
    joinPath: (...parts) => parts.join("/").replace(/\/+/g, "/"),
    mkdir: async () => undefined,
    copyFile: async (from, to) => copies.push({ from, to }),
    writeFile: async (file, data) => writes.push({ file, data }),
    pathExists: async () => false,
    captureUxContext: async (args) => {
      calls.push(args);
      return toolJson({ source: "ux-context" });
    },
    automationTakeScreenshot: async (args) => toolJson({ outputPath: args.outputPath }),
    annotationHtml,
    findAvailablePort: async () => 17654,
    openLogFile: async () => 9,
    spawnDetached: async () => ({ pid: 1234, unref: () => undefined }),
    execPath: "/usr/local/bin/node",
    scriptPath: "/bin/expo-ios",
    now: () => new Date("2026-05-23T12:34:56.789Z"),
    ...overrides,
  };
}

function parseToolJson(result: ToolTextResult): any {
  return JSON.parse(result.content[0]?.text ?? "null");
}
