import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";

import {
  annotatedScreenshot,
  annotatedScreenshotArtifactPaths,
  annotatedScreenshotSvg,
  automationTakeScreenshot,
  buildScreenshotLabelMap,
  captureFullScreenshot,
  captureScreenshot,
  clampNumber,
  escapeHtml,
  imageDimensions,
  MAX_OUTPUT,
  pathExists,
  screenshotOverlaySize,
  truncate,
} from "../main/index.js";
import type {
  ExecCall,
  ExecResult,
  IosDevice,
  ScreenshotCaptureArgs,
  ScreenshotCaptureDependencies,
  ScreenshotLabel,
  ScreenshotRefRecord,
  ScreenshotRefCache,
  SpawnedProcess,
} from "../main/index.js";

const DEVICE: IosDevice = {
  udid: "SIM-1",
  name: "iPhone 15",
  state: "Booted",
  runtime: "com.apple.CoreSimulator.SimRuntime.iOS-18-0",
  isAvailable: true,
};

describe("screenshot-capture legacy characterization", () => {
  describe("automationTakeScreenshot mode routing", () => {
    it("routes full=true to captureFullScreenshot and wraps the payload as pretty JSON text", async () => {
      const calls: string[] = [];
      const args = { full: true, annotate: true, outputPath: "/tmp/full.png" };
      const payload = await automationTakeScreenshot(args, {
        captureFullScreenshot: async (received) => {
          calls.push(`full:${received.outputPath}`);
          return { mode: "full", outputPath: received.outputPath };
        },
        annotatedScreenshot: async () => {
          calls.push("annotated");
          return {};
        },
        captureScreenshot: async () => {
          calls.push("plain");
          return {};
        },
      });

      assert.deepEqual(calls, ["full:/tmp/full.png"]);
      assert.deepEqual(payload, {
        content: [{ type: "text", text: "{\n  \"mode\": \"full\",\n  \"outputPath\": \"/tmp/full.png\"\n}\n" }],
        isError: false,
      });
    });

    it("routes annotate=true to annotatedScreenshot when full is not true", async () => {
      const calls: string[] = [];
      const payload = await automationTakeScreenshot({ annotate: true, outputPath: "/tmp/annotated.png" }, {
        annotatedScreenshot: async (received) => {
          calls.push(`annotate:${received.outputPath}`);
          return { annotated: true, outputPath: received.outputPath };
        },
        captureScreenshot: async () => {
          calls.push("plain");
          return {};
        },
      });

      assert.deepEqual(calls, ["annotate:/tmp/annotated.png"]);
      assert.deepEqual(JSON.parse(payload.content[0]?.text ?? "{}"), {
        annotated: true,
        outputPath: "/tmp/annotated.png",
      });
    });

    it("routes to plain captureScreenshot by default", async () => {
      const calls: string[] = [];
      const payload = await automationTakeScreenshot({ outputPath: "/tmp/screen.png" }, {
        captureScreenshot: async (received) => {
          calls.push(`plain:${received.outputPath}`);
          return { platform: "ios", outputPath: received.outputPath };
        },
      });

      assert.deepEqual(calls, ["plain:/tmp/screen.png"]);
      assert.deepEqual(JSON.parse(payload.content[0]?.text ?? "{}"), {
        platform: "ios",
        outputPath: "/tmp/screen.png",
      });
    });
  });

  describe("captureScreenshot", () => {
    it("captures iOS screenshots with xcrun simctl io and returns truncated stdout and stderr", async () => {
      const longStdout = `${"x".repeat(MAX_OUTPUT)}overflow`;
      const { deps, calls } = depsWith({
        execResults: [{ stdout: longStdout, stderr: "warning", error: null }],
        existingPaths: new Set(["/tmp/screen.png"]),
      });

      const payload = await captureScreenshot({ outputPath: "/tmp/screen.png" }, deps);

      assert.deepEqual(calls, [{
        file: "xcrun",
        args: ["simctl", "io", "SIM-1", "screenshot", "/tmp/screen.png"],
        options: { timeout: 30_000, rejectOnError: false },
      }]);
      assert.deepEqual(payload, {
        platform: "ios",
        device: DEVICE,
        outputPath: "/tmp/screen.png",
        stdout: `${"x".repeat(MAX_OUTPUT)}\n[truncated 8 characters]`,
        stderr: "warning",
      });
    });

    it("returns the legacy unavailable shape when iOS command reports an error or the artifact is missing", async () => {
      const error = { message: "simctl failed", code: 64, signal: null };
      const { deps } = depsWith({
        execResults: [{ stdout: "partial", stderr: `${"e".repeat(MAX_OUTPUT)}tail`, error }],
        existingPaths: new Set(),
      });

      const payload = await captureScreenshot({ device: "SIM-1", outputPath: "/tmp/missing.png" }, deps);

      assert.deepEqual(payload, {
        available: false,
        reason: "Screenshot tooling failed.",
        platform: "ios",
        device: DEVICE,
        outputPath: "/tmp/missing.png",
        stdout: "partial",
        stderr: `${"e".repeat(MAX_OUTPUT)}\n[truncated 4 characters]`,
        error,
      });
    });

    it("delegates Android screenshot capture to the adapter and returns platform, device, and outputPath", async () => {
      const { deps, adbCalls } = depsWith();

      const payload = await captureScreenshot({
        platform: "android",
        device: "emulator-5554",
        outputPath: "/tmp/android.png",
      }, deps);

      assert.deepEqual(adbCalls, [{ device: "emulator-5554", outputPath: "/tmp/android.png" }]);
      assert.deepEqual(payload, {
        platform: "android",
        device: "emulator-5554",
        outputPath: "/tmp/android.png",
      });
    });

    it("streams Android screenshots through adb stdout when no adapter is supplied", async () => {
      const outputPath = path.resolve("expo98-screenshot-capture-stream.png");
      await rm(outputPath, { force: true });
      const spawnCalls: Array<{ file: string; args: string[]; options: { stdio: ["ignore", "pipe", "pipe"] } }> = [];
      let stdoutHandler: ((chunk: Uint8Array) => void) | undefined;
      let closeHandler: ((code: number | null) => void) | undefined;
      const deps: ScreenshotCaptureDependencies = {
        mkdir: async () => {},
        spawnProcess: (file, args, options): SpawnedProcess => {
          spawnCalls.push({ file, args, options });
          return {
            stdout: {
              on: (_event, handler) => {
                stdoutHandler = handler;
              },
            },
            stderr: {
              setEncoding: () => {},
              on: () => {},
            },
            on: (event, handler) => {
              if (event === "close") closeHandler = handler as (code: number | null) => void;
            },
            kill: () => {},
          };
        },
      };

      const pending = captureScreenshot({ platform: "android", device: "emulator-5554", outputPath }, deps);
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (!stdoutHandler || !closeHandler) throw new Error("fake adb process handlers were not registered");
      stdoutHandler(new Uint8Array([137, 80, 78, 71]));
      closeHandler(0);
      const payload = await pending;

      assert.deepEqual(spawnCalls, [{
        file: "adb",
        args: ["-s", "emulator-5554", "exec-out", "screencap", "-p"],
        options: { stdio: ["ignore", "pipe", "pipe"] },
      }]);
      assert.deepEqual([...await readFile(outputPath)], [137, 80, 78, 71]);
      assert.deepEqual(payload, {
        platform: "android",
        device: "emulator-5554",
        outputPath,
      });
      await rm(outputPath, { force: true });
    });
  });

  describe("captureFullScreenshot", () => {
    it("returns unavailable for non-iOS platforms with the legacy full-mode reason", async () => {
      const payload = await captureFullScreenshot({ platform: "android", outputPath: "/tmp/full.png" }, depsWith().deps);

      assert.deepEqual(payload, {
        available: false,
        reason: "Segmented full-page capture is currently implemented for iOS simulator targets only.",
        mode: "full",
        platform: "android",
      });
    });

    it("returns unavailable when axe is missing before resolving devices or writing artifacts", async () => {
      const { deps, calls, mkdirs } = depsWith({ commandPaths: { axe: null, magick: "/usr/bin/magick" } });

      const payload = await captureFullScreenshot({ outputPath: "/tmp/full.png" }, deps);

      assert.deepEqual(calls, []);
      assert.deepEqual(mkdirs, []);
      assert.deepEqual(payload, {
        available: false,
        reason: "Full-page capture requires the axe CLI to perform real simulator scroll gestures.",
        mode: "full",
        platform: "ios",
      });
    });

    it("returns unavailable when magick is missing after axe is found", async () => {
      const payload = await captureFullScreenshot({ outputPath: "/tmp/full.png" }, depsWith({
        commandPaths: { axe: "/usr/bin/axe", magick: null },
      }).deps);

      assert.deepEqual(payload, {
        available: false,
        reason: "Full-page capture requires ImageMagick's magick command to stitch captured viewport segments.",
        mode: "full",
        platform: "ios",
      });
    });

    it("captures segments, scrolls with axe coordinates derived from imageDimensions, stitches with magick, and reports limitation metadata", async () => {
      const { deps, calls, capturedPaths } = depsWith({
        commandPaths: { axe: "/bin/axe", magick: "/bin/magick" },
        execResults: [
          { stdout: "390 844", stderr: "", error: null },
          { stdout: `${"s".repeat(MAX_OUTPUT)}end`, stderr: "gesture stderr", error: null },
          { stdout: "restored", stderr: "", error: null },
          { stdout: "stitched", stderr: "stitch stderr", error: null },
        ],
        existingPaths: new Set([
          "/tmp/full-segments/segment-000.png",
          "/tmp/full-segments/segment-001.png",
          "/tmp/full.png",
        ]),
      });

      const payload = await captureFullScreenshot({ outputPath: "/tmp/full.png", fullSegments: 2 }, deps);

      assert.deepEqual(capturedPaths, ["/tmp/full-segments/segment-000.png", "/tmp/full-segments/segment-001.png"]);
      assert.deepEqual(calls, [
        {
          file: "/bin/magick",
          args: ["identify", "-format", "%w %h", "/tmp/full-segments/segment-000.png"],
          options: { timeout: 5_000, rejectOnError: false },
        },
        {
          file: "/bin/axe",
          args: [
            "swipe",
            "--start-x",
            "195",
            "--start-y",
            "692",
            "--end-x",
            "195",
            "--end-y",
            "236",
            "--duration",
            "0.45",
            "--udid",
            "SIM-1",
          ],
          options: { timeout: 10_000, rejectOnError: false },
        },
        {
          file: "/bin/axe",
          args: [
            "swipe",
            "--start-x",
            "195",
            "--start-y",
            "236",
            "--end-x",
            "195",
            "--end-y",
            "692",
            "--duration",
            "0.25",
            "--udid",
            "SIM-1",
          ],
          options: { timeout: 10_000, rejectOnError: false },
        },
        {
          file: "/bin/magick",
          args: ["/tmp/full-segments/segment-000.png", "/tmp/full-segments/segment-001.png", "-append", "/tmp/full.png"],
          options: { timeout: 30_000, rejectOnError: false },
        },
      ]);
      assert.deepEqual(payload, {
        available: true,
        mode: "full",
        strategy: "segmented-scroll-stitch",
        platform: "ios",
        device: DEVICE,
        outputPath: "/tmp/full.png",
        segmentDir: "/tmp/full-segments",
        segments: ["/tmp/full-segments/segment-000.png", "/tmp/full-segments/segment-001.png"],
        segmentCount: 2,
        tools: { gesture: "axe", stitch: "magick" },
        limitation: "iOS Simulator does not expose a stable native full-page screenshot API for arbitrary React Native views; this artifact stitches real viewport screenshots captured after simulator scroll gestures.",
        gestures: [{
          index: 1,
          stdout: `${"s".repeat(MAX_OUTPUT)}\n[truncated 3 characters]`,
          stderr: "gesture stderr",
          error: null,
        }],
        stitch: { stdout: "stitched", stderr: "stitch stderr" },
      });
    });
  });

  describe("imageDimensions", () => {
    it("parses magick identify output in the exact legacy width-height shape", async () => {
      const { deps, calls } = depsWith({ execResults: [{ stdout: "390 844\n", stderr: "", error: null }] });

      const payload = await imageDimensions("/bin/magick", "/tmp/segment.png", deps);

      assert.deepEqual(calls, [{
        file: "/bin/magick",
        args: ["identify", "-format", "%w %h", "/tmp/segment.png"],
        options: { timeout: 5_000, rejectOnError: false },
      }]);
      assert.deepEqual(payload, { width: 390, height: 844 });
    });

    it("returns null when magick errors or stdout is malformed", async () => {
      const errorResult = await imageDimensions("/bin/magick", "/tmp/error.png", depsWith({
        execResults: [{ stdout: "390 844", stderr: "nope", error: { message: "identify failed" } }],
      }).deps);
      const malformedResult = await imageDimensions("/bin/magick", "/tmp/malformed.png", depsWith({
        execResults: [{ stdout: "390x844", stderr: "", error: null }],
      }).deps);

      assert.equal(errorResult, null);
      assert.equal(malformedResult, null);
    });
  });

  describe("annotatedScreenshot and label maps", () => {
    it("returns unavailable when no latest ref cache exists for the current session", async () => {
      const payload = await annotatedScreenshot({ outputPath: "/tmp/annotated.png" }, depsWith({ refCache: null }).deps);

      assert.deepEqual(payload, {
        available: false,
        reason: "No snapshot exists for the current session.",
      });
    });

    it("rejects refs from a different snapshot or target", () => {
      const payload = buildScreenshotLabelMap({
        snapshotId: "snapshot-current",
        targetId: "target-current",
        refs: [
          boundedRef("@e1", { snapshotId: "snapshot-current", targetId: "target-current" }),
          boundedRef("@e2", { snapshotId: "snapshot-old" }),
          boundedRef("@e3", { targetId: "target-old" }),
        ],
      });

      assert.deepEqual(payload, {
        available: false,
        reason: "Ref cache contains refs from a different snapshot or target.",
        snapshotId: "snapshot-current",
        targetId: "target-current",
        mismatchedRefs: ["@e2", "@e3"],
      });
    });

    it("rejects active refs that have no bounds", () => {
      const payload = buildScreenshotLabelMap({
        snapshotId: "snapshot-1",
        targetId: "target-1",
        refs: [
          { ref: "@e1", snapshotId: "snapshot-1", targetId: "target-1", role: "button" },
          { ref: "@e2", snapshotId: "snapshot-1", targetId: "target-1", box: null },
          boundedRef("@e3", { stale: true, box: undefined }),
        ],
      });

      assert.deepEqual(payload, {
        available: false,
        reason: "Cannot annotate screenshot because one or more refs do not include bounds.",
        snapshotId: "snapshot-1",
        targetId: "target-1",
        missingRefs: ["@e1", "@e2"],
      });
    });

    it("returns unavailable when all refs are stale and no bounded active refs remain", () => {
      const payload = buildScreenshotLabelMap({
        snapshotId: "snapshot-1",
        targetId: "target-1",
        refs: [
          boundedRef("@e1", { stale: true }),
          boundedRef("@e2", { stale: true }),
        ],
      });

      assert.deepEqual(payload, {
        available: false,
        reason: "No bounded refs are available for annotation.",
        snapshotId: "snapshot-1",
        targetId: "target-1",
      });
    });

    it("filters stale refs and assigns labels using label, text, role, then ref fallback order", () => {
      const payload = buildScreenshotLabelMap({
        snapshotId: "snapshot-1",
        targetId: "target-1",
        refs: [
          boundedRef("@e1", { label: "Save customer", text: "Save", role: "button", source: "native" }),
          boundedRef("@e2", { label: null, text: "Cancel", role: "button", source: "native" }),
          boundedRef("@e3", { label: null, text: null, role: "image", source: "native" }),
          boundedRef("@e4", { label: null, text: null, role: null, source: "native" }),
          boundedRef("@e5", { stale: true, label: "Stale" }),
        ],
      });

      assert.deepEqual(payload, {
        available: true,
        labels: [
          label("@e1", "Save customer", 1, { role: "button", text: "Save", source: "native" }),
          label("@e2", "Cancel", 2, { role: "button", text: "Cancel", source: "native" }),
          label("@e3", "image", 3, { role: "image", text: null, source: "native" }),
          label("@e4", "@e4", 4, { role: null, text: null, source: "native" }),
        ],
      });
    });

    it("captures a plain screenshot, writes label-map JSON and SVG artifacts, and returns the annotated payload", async () => {
      const writes: Array<{ file: string; value: unknown }> = [];
      const fileWrites: Array<{ file: string; contents: string; encoding: string }> = [];
      const { deps } = depsWith({
        refCache: {
          snapshotId: "snapshot-1",
          targetId: "target-1",
          refs: [boundedRef("@e1", { label: "Open", role: "button", text: "Open" })],
        },
        existingPaths: new Set(["/tmp/screen.png"]),
        execResults: [{ stdout: "screenshot ok", stderr: "", error: null }],
        writeJson: (file, value) => writes.push({ file, value }),
        writeFile: (file, contents, encoding) => fileWrites.push({ file, contents, encoding }),
      });

      const payload = await annotatedScreenshot({ outputPath: "/tmp/screen.png" }, deps);

      assert.deepEqual(writes, [{
        file: "/tmp/screen.labels.json",
        value: {
          schemaVersion: 1,
          createdAt: "2026-05-23T12:00:00.000Z",
          screenshot: "/tmp/screen.png",
          annotatedImage: "/tmp/screen.annotated.svg",
          snapshotId: "snapshot-1",
          targetId: "target-1",
          labels: [label("@e1", "Open", 1, { role: "button", text: "Open", source: null })],
        },
      }]);
      assert.equal(fileWrites[0]?.file, "/tmp/screen.annotated.svg");
      assert.equal(fileWrites[0]?.encoding, "utf8");
      assert.match(fileWrites[0]?.contents ?? "", /<image href="screen\.png"/);
      assert.match(fileWrites[0]?.contents ?? "", />1\. @e1<\/text>/);
      assert.deepEqual(payload, {
        platform: "ios",
        device: DEVICE,
        outputPath: "/tmp/screen.png",
        stdout: "screenshot ok",
        stderr: "",
        available: true,
        annotated: true,
        snapshotId: "snapshot-1",
        targetId: "target-1",
        artifacts: {
          screenshot: "/tmp/screen.png",
          annotatedImage: "/tmp/screen.annotated.svg",
          labelMap: "/tmp/screen.labels.json",
        },
        labels: [label("@e1", "Open", 1, { role: "button", text: "Open", source: null })],
      });
    });

    it("reads the latest persisted refs.json by default when no ref-cache adapter is supplied", async () => {
      const stateRoot = "/tmp/expo-state";
      const reads: string[] = [];
      const writes: Array<{ file: string; value: unknown }> = [];
      const deps: ScreenshotCaptureDependencies = {
        execFile: async () => ({ stdout: "screenshot ok", stderr: "", error: null }),
        resolveIosDevice: async () => DEVICE,
        pathExists: async (file) => file === "/tmp/persisted.png",
        mkdir: async () => {},
        readDir: async (directory) => {
          assert.equal(directory, `${stateRoot}/sessions`);
          return [
            { name: "older", isDirectory: () => true },
            { name: "newer", isDirectory: () => true },
          ];
        },
        readJsonFile: async (file) => {
          reads.push(file);
          if (file === `${stateRoot}/sessions/older/session.json`) {
            return { sessionId: "older", updatedAt: "2026-05-22T12:00:00.000Z", lastSnapshotId: "old-snap" };
          }
          if (file === `${stateRoot}/sessions/newer/session.json`) {
            return { sessionId: "newer", updatedAt: "2026-05-23T12:00:00.000Z", lastSnapshotId: "snapshot-1" };
          }
          if (file === `${stateRoot}/sessions/newer/refs.json`) {
            return {
              snapshotId: "snapshot-1",
              targetId: "target-1",
              refs: [boundedRef("@e1", { label: "Persisted", source: { file: "App.tsx" } })],
            };
          }
          throw new Error(`unexpected read: ${file}`);
        },
        writeJsonFile: async (file, value) => {
          writes.push({ file, value });
        },
        writeFile: async () => {},
        nowIso: () => "2026-05-23T12:00:00.000Z",
      };

      const payload = await annotatedScreenshot({
        stateDir: `${stateRoot}/runs`,
        outputPath: "/tmp/persisted.png",
      }, deps);

      assert.deepEqual(reads, [
        `${stateRoot}/sessions/older/session.json`,
        `${stateRoot}/sessions/newer/session.json`,
        `${stateRoot}/sessions/newer/refs.json`,
      ]);
      assert.deepEqual(writes[0]?.value, {
        schemaVersion: 1,
        createdAt: "2026-05-23T12:00:00.000Z",
        screenshot: "/tmp/persisted.png",
        annotatedImage: "/tmp/persisted.annotated.svg",
        snapshotId: "snapshot-1",
        targetId: "target-1",
        labels: [label("@e1", "Persisted", 1, { source: { file: "App.tsx" } })],
      });
      assert.equal(payload.available, true);
      assert.equal(payload.annotated, true);
    });
  });

  describe("artifact derivation, SVG, overlay sizing, and shared helpers", () => {
    it("derives annotation artifacts beside the screenshot with and without a filename extension", () => {
      assert.deepEqual(annotatedScreenshotArtifactPaths("/tmp/screen.png"), {
        labelMap: "/tmp/screen.labels.json",
        annotatedImage: "/tmp/screen.annotated.svg",
      });
      assert.deepEqual(annotatedScreenshotArtifactPaths("/tmp/screen"), {
        labelMap: "/tmp/screen.labels.json",
        annotatedImage: "/tmp/screen.annotated.svg",
      });
    });

    it("uses the legacy minimum overlay size and grows to cover refs plus 24px padding", () => {
      assert.deepEqual(screenshotOverlaySize([label("@e1", "One", 1, { box: { x: 10, y: 20, width: 30, height: 40 } })]), {
        width: 390,
        height: 844,
      });
      assert.deepEqual(screenshotOverlaySize([label("@e1", "One", 1, { box: { x: 380.2, y: 840.2, width: 20, height: 10 } })]), {
        width: 425,
        height: 875,
      });
    });

    it("renders annotated SVG with escaped basename refs and label text", () => {
      const svg = annotatedScreenshotSvg({
        screenshotPath: "/tmp/detail&view.png",
        labels: [label("@e<1>&\"", "Label", 1, { box: { x: 12, y: 8, width: 50, height: 20 } })],
      });

      assert.match(svg, /<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="390" height="844" viewBox="0 0 390 844">/);
      assert.match(svg, /<image href="detail&amp;view\.png"/);
      assert.match(svg, /<rect x="12" y="8" width="50" height="20" fill="none" stroke="#ff3b30" stroke-width="2"\/>/);
      assert.match(svg, />1\. @e&lt;1&gt;&amp;&quot;<\/text>/);
    });

    it("escapes ampersand, angle brackets, and double quotes while normalizing nullish values", () => {
      assert.equal(escapeHtml(`A&B <tag attr="value">`), "A&amp;B &lt;tag attr=&quot;value&quot;&gt;");
      assert.equal(escapeHtml(null), "");
      assert.equal(escapeHtml(undefined), "");
    });

    it("clamps finite numbers and throws the exact legacy message for non-finite values", () => {
      assert.equal(clampNumber("0", 1, 12), 1);
      assert.equal(clampNumber("13", 1, 12), 12);
      assert.equal(clampNumber("7", 1, 12), 7);
      assert.throws(() => clampNumber("many", 1, 12), /Expected a finite number, got many\./);
    });

    it("RULE-021 truncates stdout and stderr with explicit overflow character counts", () => {
      assert.equal(truncate(null, 3), "");
      assert.equal(truncate("abc", 3), "abc");
      assert.equal(truncate("abcdef", 3), "abc\n[truncated 3 characters]");
      assert.equal(
        truncate(`${"x".repeat(MAX_OUTPUT)}overflow`),
        `${"x".repeat(MAX_OUTPUT)}\n[truncated 8 characters]`,
      );
    });

    it("returns true when access succeeds and false when access rejects", async () => {
      const existing = await pathExists("/tmp/existing.png", {
        access: async () => {},
      });
      const missing = await pathExists("/tmp/missing.png", {
        access: async () => {
          throw new Error("ENOENT");
        },
      });

      assert.equal(existing, true);
      assert.equal(missing, false);
    });
  });
});

function depsWith(options: {
  execResults?: ExecResult[];
  existingPaths?: Set<string>;
  commandPaths?: Record<string, string | null>;
  refCache?: ScreenshotRefCache | null;
  writeJson?: (file: string, value: unknown) => void;
  writeFile?: (file: string, contents: string, encoding: "utf8") => void;
} = {}): {
  deps: ScreenshotCaptureDependencies;
  calls: ExecCall[];
  adbCalls: Array<{ device: string | undefined; outputPath: string }>;
  mkdirs: string[];
  capturedPaths: string[];
} {
  const calls: ExecCall[] = [];
  const adbCalls: Array<{ device: string | undefined; outputPath: string }> = [];
  const mkdirs: string[] = [];
  const capturedPaths: string[] = [];
  const execResults = [...(options.execResults ?? [])];
  const existingPaths = options.existingPaths ?? new Set<string>();
  const commandPaths = options.commandPaths ?? { axe: "/usr/bin/axe", magick: "/usr/bin/magick" };

  const deps: ScreenshotCaptureDependencies = {
    execFile: async (file, args, execOptions) => {
      calls.push({ file, args, options: execOptions });
      return execResults.shift() ?? { stdout: "", stderr: "", error: null };
    },
    resolveIosDevice: async () => DEVICE,
    adbScreenshot: async (device, outputPath) => {
      adbCalls.push({ device, outputPath });
    },
    commandPath: async (command) => commandPaths[command] ?? null,
    pathExists: async (file) => existingPaths.has(file),
    mkdir: async (directory) => {
      mkdirs.push(directory);
    },
    readLatestRefCache: async () => Object.hasOwn(options, "refCache")
      ? options.refCache ?? null
      : {
          snapshotId: "snapshot-1",
          targetId: "target-1",
          refs: [boundedRef("@e1")],
        },
    writeJsonFile: async (file, value) => {
      options.writeJson?.(file, value);
    },
    writeFile: async (file, contents, encoding) => {
      options.writeFile?.(file, contents, encoding);
    },
    wait: async () => {},
    nowIso: () => "2026-05-23T12:00:00.000Z",
    captureScreenshot: async (args: ScreenshotCaptureArgs) => {
      if (typeof args.outputPath === "string") capturedPaths.push(args.outputPath);
      return {
        platform: args.platform ?? "ios",
        device: DEVICE,
        outputPath: args.outputPath,
        stdout: "",
        stderr: "",
      };
    },
  };

  return { deps, calls, adbCalls, mkdirs, capturedPaths };
}

function boundedRef(ref: string, overrides: Partial<ScreenshotRefRecord> = {}): ScreenshotRefRecord {
  return {
    ref,
    snapshotId: "snapshot-1",
    targetId: "target-1",
    label: null,
    text: null,
    role: null,
    source: null,
    stale: false,
    box: { x: 10, y: 20, width: 100, height: 30 },
    ...overrides,
  };
}

function label(
  ref: string,
  textLabel: string,
  index: number,
  overrides: Partial<ScreenshotLabel> = {},
): ScreenshotLabel {
  return {
    ref,
    label: textLabel,
    role: null,
    text: null,
    source: null,
    box: { x: 10, y: 20, width: 100, height: 30 },
    snapshotId: "snapshot-1",
    targetId: "target-1",
    index,
    ...overrides,
  };
}
