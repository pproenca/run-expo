import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  codexReviewOverlayComponentSource,
  normalizeEndpointPath,
  relativeImportFromAppRoot,
  requireOptionalString,
  reviewOverlay,
  scaffoldReviewOverlay,
  toolJson,
} from "../main/index.js";
import type { ReviewOverlayDependencies, ToolTextResult } from "../main/index.js";

describe("review-overlay-workflow legacy characterization", () => {
  it("prepares overlay events and returns non-served instructions by default", async () => {
    const created: Array<Record<string, unknown>> = [];
    const payload = parseToolJson(await reviewOverlay({ cwd: "/repo/app", title: "Review" }, deps({
      createEventsFile: async (args) => {
        created.push(args);
        return { version: 1, title: args.title, createdAt: "now", events: [] };
      },
    })));

    assert.equal(payload.outputDir, "/repo/app/.scratch/codex-review-overlay");
    assert.equal(payload.eventsPath, "/repo/app/.scratch/codex-review-overlay/events.json");
    assert.equal(payload.server, null);
    assert.deepEqual(created, [{ outputDir: "/repo/app/.scratch/codex-review-overlay", title: "Review", reset: false }]);
    assert.match(payload.instructions[0], /Run review-overlay scaffold once/);
    assert.match(payload.instructions[1], /Start with --serve true/);
  });

  it("serves prepare mode with clamped port, normalized endpoint path, detached spawn args, and server URLs", async () => {
    const spawns: Array<Record<string, unknown>> = [];
    const payload = parseToolJson(await reviewOverlay({
      cwd: "/repo/app",
      outputDir: "/tmp/overlay",
      serve: true,
      port: "70000",
      endpointPath: "events/v2",
    }, deps({
      openLogFile: async () => 44,
      spawnDetached: async (command, argv, options) => {
        spawns.push({ command, argv, options });
        return { pid: 777, unref: () => spawns.push({ unref: true }) };
      },
    })));

    assert.equal(payload.server.url, "http://127.0.0.1:65535/");
    assert.equal(payload.server.endpoint, "http://127.0.0.1:65535/events/v2");
    assert.equal(payload.server.eventsUrl, "http://127.0.0.1:65535/events.json");
    assert.equal(payload.server.logPath, "/tmp/overlay/review-overlay-server.log");
    assert.equal(payload.server.stop, "kill 777");
    assert.deepEqual(spawns[0]?.argv, [
      "/bin/expo-ios",
      "review-overlay-server",
      "--output-dir",
      "/tmp/overlay",
      "--port",
      "65535",
      "--endpoint-path",
      "/events/v2",
    ]);
    assert.deepEqual(spawns[1], { unref: true });
    assert.match(payload.instructions[1], /endpoint="http:\/\/127\.0\.0\.1:65535\/events\/v2"/);
  });

  it("routes read, clear, server, and unknown actions like legacy reviewOverlay", async () => {
    const read = parseToolJson(await reviewOverlay({ action: "read", outputDir: "/tmp/overlay", metroPort: 19000 }, deps({
      readEvents: async (eventsPath, options) => ({ version: 1, title: "T", events: [{ id: "a" }], eventsPathRead: eventsPath, options }),
    })));
    const cleared = parseToolJson(await reviewOverlay({ action: "clear", outputDir: "/tmp/overlay", title: "T" }, deps({
      createEventsFile: async (args) => ({ version: 1, title: args.title, events: [], reset: args.reset }),
    })));
    const server = await reviewOverlay({ action: "server", outputDir: "/tmp/overlay", port: 0, endpointPath: "/custom" }, deps({
      reviewOverlayServer: async (args) => toolJson({ action: "server", args }),
    }));

    assert.equal(read.eventsPath, "/tmp/overlay/events.json");
    assert.deepEqual(read.options, { metroPort: 19000 });
    assert.equal(cleared.cleared, true);
    assert.equal(cleared.reset, true);
    assert.deepEqual(parseToolJson(server), { action: "server", args: { dir: "/tmp/overlay", port: 0, endpointPath: "/custom" } });
    await assert.rejects(() => reviewOverlay({ action: "bad" }, deps()), /Unknown review-overlay action: bad/);
  });

  it("scaffolds the overlay component and index with integration details and capabilities", async () => {
    const writes: Array<{ file: string; data: string }> = [];
    const payload = await scaffoldReviewOverlay({ cwd: "/repo/app", overlayDir: "src/overlay" }, deps({
      writes,
      pathExists: async () => false,
    }));

    assert.equal(payload.overlayDir, "/repo/app/src/overlay");
    assert.equal(payload.componentPath, "/repo/app/src/overlay/CodexReviewOverlay.tsx");
    assert.equal(payload.indexPath, "/repo/app/src/overlay/index.ts");
    assert.equal(payload.integration.import, 'import { CodexReviewOverlay } from "./src/overlay";');
    assert.match(payload.integration.jsx, /CodexReviewOverlay endpoint="http:\/\/127\.0\.0\.1:17655\/events"/);
    assert.equal(payload.capabilities.length, 8);
    assert.match(writes.find((entry) => entry.file.endsWith("CodexReviewOverlay.tsx"))?.data ?? "", /CodexReviewOverlay/);
    assert.equal(writes.find((entry) => entry.file.endsWith("index.ts"))?.data, 'export { CodexReviewOverlay } from "./CodexReviewOverlay";\nexport { default } from "./CodexReviewOverlay";\n');
  });

  it("requires force to overwrite an existing scaffold and preserves helper behavior", async () => {
    await assert.rejects(() => scaffoldReviewOverlay({ cwd: "/repo/app" }, deps({
      pathExists: async (file) => file.endsWith("CodexReviewOverlay.tsx"),
    })), /already exists. Pass --force true to overwrite/);

    const forced = await scaffoldReviewOverlay({ cwd: "/repo/app", force: true }, deps({
      pathExists: async () => true,
    }));
    assert.equal(forced.overlayDir, "/repo/app/codex-review-overlay");
    assert.equal(relativeImportFromAppRoot("/repo/app", "/repo/app/codex-review-overlay"), "./codex-review-overlay");
    assert.equal(relativeImportFromAppRoot("/repo/app/src", "/repo/app/codex-review-overlay"), "../codex-review-overlay");
    assert.equal(normalizeEndpointPath(undefined), "/events");
    assert.equal(normalizeEndpointPath(""), "/events");
    assert.equal(normalizeEndpointPath("events"), "/events");
    assert.throws(() => normalizeEndpointPath("/bad?x=1"), /endpointPath must be a simple URL path/);
    assert.equal(requireOptionalString(" x "), "x");
    assert.equal(requireOptionalString(1), null);
    assert.match(codexReviewOverlayComponentSource(), /export function CodexReviewOverlay/);
    assert.equal(JSON.parse(toolJson({ ok: true }).content[0]?.text ?? "{}").ok, true);
  });
});

function deps(overrides: Partial<ReviewOverlayDependencies> & {
  writes?: Array<{ file: string; data: string }>;
} = {}): ReviewOverlayDependencies {
  const writes = overrides.writes ?? [];
  return {
    normalizeProjectCwd: async (cwd) => String(cwd ?? "/repo/app"),
    fallbackCwd: () => "/fallback",
    resolvePath: (...parts) => parts.join("/").replace(/\/+/g, "/"),
    joinPath: (...parts) => parts.join("/").replace(/\/+/g, "/"),
    relativePath: (from, to) => {
      if (to.startsWith(`${from}/`)) return to.slice(from.length + 1);
      if (from === "/repo/app/src" && to === "/repo/app/codex-review-overlay") return "../codex-review-overlay";
      return to;
    },
    createEventsFile: async (args) => ({ version: 1, title: args.title ?? "Codex in-app review", createdAt: "now", events: [] }),
    readEvents: async () => ({ version: 1, title: "Codex in-app review", events: [] }),
    reviewOverlayServer: async (args) => toolJson({ args }),
    mkdir: async () => undefined,
    writeFile: async (file, data) => writes.push({ file, data }),
    pathExists: async () => false,
    findAvailablePort: async () => 17655,
    openLogFile: async () => 9,
    spawnDetached: async () => ({ pid: 123, unref: () => undefined }),
    execPath: "/usr/local/bin/node",
    scriptPath: "/bin/expo-ios",
    ...overrides,
  };
}

function parseToolJson(result: ToolTextResult): any {
  return JSON.parse(result.content[0]?.text ?? "null");
}
