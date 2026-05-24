import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";

import {
  bridgeInstallStatus,
  bridgeMetadata,
  pathExists,
  readJsonFile
} from "../main/index.js";

const PROJECT_ROOT = "/work/expo-app";
const PACKAGE_PATH = "/work/expo-app/package.json";
const METADATA_PATH = "/work/expo-app/.expo-ios/bridge.json";
const SOURCE_PATH = "/work/expo-app/src/expo-ios-devtools-bridge.ts";

describe("bridge-install-status-adapter legacy characterization", () => {
  it("marks missing or unreadable package.json as incompatible missing-expo", async () => {
    const status = await bridgeInstallStatus(PROJECT_ROOT, fakeIo({
      readFailures: new Set([PACKAGE_PATH, METADATA_PATH]),
      existing: new Set()
    }));

    assert.deepEqual(status, {
      projectRoot: PROJECT_ROOT,
      state: "incompatible",
      bridgeVersion: null,
      expectedBridgeVersion: "1.0.0",
      developmentOnly: false,
      metadataPath: METADATA_PATH,
      sourcePath: SOURCE_PATH,
      files: { metadata: false, source: false },
      dependencies: { expo: null, rozenite: [] },
      issues: [
        {
          code: "missing-expo",
          message: "The project does not declare expo, so an Expo DevTools bridge cannot be installed safely."
        }
      ]
    });
  });

  it("uses the exact legacy package, metadata, and source paths", async () => {
    const calls: string[] = [];
    await bridgeInstallStatus(PROJECT_ROOT, {
      joinPath: (...parts) => parts.join("/"),
      readJsonFile: (file) => {
        calls.push(`read:${file}`);
        if (file === PACKAGE_PATH) return { dependencies: { expo: "~52.0.0" } };
        throw new Error("missing");
      },
      pathExists: (file) => {
        calls.push(`exists:${file}`);
        return false;
      }
    });

    assert.deepEqual(calls, [
      `read:${PACKAGE_PATH}`,
      `read:${METADATA_PATH}`,
      `exists:${SOURCE_PATH}`
    ]);
  });

  it("marks Expo projects with no bridge files as absent", async () => {
    const status = await bridgeInstallStatus(PROJECT_ROOT, fakeIo({
      files: new Map([[PACKAGE_PATH, { dependencies: { expo: "~52.0.0" } }]]),
      readFailures: new Set([METADATA_PATH]),
      existing: new Set()
    }));

    assert.equal(status.state, "absent");
    assert.equal(status.bridgeVersion, null);
    assert.deepEqual(status.files, { metadata: false, source: false });
    assert.deepEqual(status.issues, []);
  });

  it("reports sorted Rozenite packages from dependencies and devDependencies", async () => {
    const status = await bridgeInstallStatus(PROJECT_ROOT, fakeIo({
      files: new Map([
        [PACKAGE_PATH, {
          dependencies: {
            expo: "~52.0.0",
            "@rozenite/network-activity-plugin": "^1.2.0",
            zzz: "1.0.0"
          },
          devDependencies: {
            rozenite: "^0.8.0",
            "@rozenite/mmkv-plugin": "^2.0.0"
          }
        }]
      ]),
      readFailures: new Set([METADATA_PATH]),
      existing: new Set()
    }));

    assert.equal(status.state, "absent");
    assert.deepEqual(status.dependencies, {
      expo: "~52.0.0",
      rozenite: [
        { name: "@rozenite/mmkv-plugin", version: "^2.0.0" },
        { name: "@rozenite/network-activity-plugin", version: "^1.2.0" },
        { name: "rozenite", version: "^0.8.0" }
      ]
    });
  });

  it("marks metadata-only and source-only installs as stale partial-install", async () => {
    const metadataOnly = await bridgeInstallStatus(PROJECT_ROOT, fakeIo({
      files: new Map<string, unknown>([
        [PACKAGE_PATH, { dependencies: { expo: "~52.0.0" } }],
        [METADATA_PATH, bridgeMetadata()]
      ]),
      existing: new Set()
    }));
    const sourceOnly = await bridgeInstallStatus(PROJECT_ROOT, fakeIo({
      files: new Map([[PACKAGE_PATH, { dependencies: { expo: "~52.0.0" } }]]),
      readFailures: new Set([METADATA_PATH]),
      existing: new Set([SOURCE_PATH])
    }));

    assert.equal(metadataOnly.state, "stale");
    assert.deepEqual(metadataOnly.files, { metadata: true, source: false });
    assert.equal(sourceOnly.state, "stale");
    assert.deepEqual(sourceOnly.files, { metadata: false, source: true });
    assert.deepEqual(sourceOnly.issues, [
      { code: "partial-install", message: "Bridge metadata and source file are not both present." }
    ]);
  });

  it("marks bridge version or schema mismatches as stale version-mismatch", async () => {
    const versionMismatch = await statusWithMetadata({ ...bridgeMetadata(), bridgeVersion: "0.9.0" });
    const schemaMismatch = await statusWithMetadata({ ...bridgeMetadata(), schemaVersion: 2 });

    assert.equal(versionMismatch.state, "stale");
    assert.deepEqual(versionMismatch.issues, [
      { code: "version-mismatch", message: "Bridge version 0.9.0 does not match 1.0.0." }
    ]);
    assert.equal(schemaMismatch.state, "stale");
    assert.deepEqual(schemaMismatch.issues, [
      { code: "version-mismatch", message: "Bridge version 1.0.0 does not match 1.0.0." }
    ]);
  });

  it("marks non-development metadata incompatible and matching metadata present", async () => {
    const notDevelopmentOnly = await statusWithMetadata({ ...bridgeMetadata(), developmentOnly: false });
    const present = await statusWithMetadata(bridgeMetadata());

    assert.equal(notDevelopmentOnly.state, "incompatible");
    assert.deepEqual(notDevelopmentOnly.issues, [
      { code: "not-development-only", message: "Bridge metadata must declare developmentOnly: true." }
    ]);
    assert.equal(present.state, "present");
    assert.equal(present.bridgeVersion, "1.0.0");
    assert.equal(present.developmentOnly, true);
    assert.deepEqual(present.files, { metadata: true, source: true });
  });

  it("uses default Node filesystem helpers", async () => {
    await withTempProject(async (root) => {
      await fs.mkdir(path.join(root, ".expo-ios"), { recursive: true });
      await fs.mkdir(path.join(root, "src"), { recursive: true });
      await fs.writeFile(path.join(root, "package.json"), JSON.stringify({ dependencies: { expo: "~52.0.0" } }), "utf8");
      await fs.writeFile(path.join(root, ".expo-ios", "bridge.json"), JSON.stringify(bridgeMetadata()), "utf8");
      await fs.writeFile(path.join(root, "src", "expo-ios-devtools-bridge.ts"), "", "utf8");

      assert.deepEqual(await readJsonFile(path.join(root, "package.json")), { dependencies: { expo: "~52.0.0" } });
      assert.equal(await pathExists(path.join(root, "src", "expo-ios-devtools-bridge.ts")), true);
      assert.equal((await bridgeInstallStatus(root)).state, "present");
    });
  });
});

async function statusWithMetadata(metadata: unknown) {
  return bridgeInstallStatus(PROJECT_ROOT, fakeIo({
    files: new Map<string, unknown>([
      [PACKAGE_PATH, { dependencies: { expo: "~52.0.0" } }],
      [METADATA_PATH, metadata]
    ]),
    existing: new Set([SOURCE_PATH])
  }));
}

function fakeIo({
  files = new Map<string, unknown>(),
  readFailures = new Set<string>(),
  existing = new Set<string>()
}: {
  files?: Map<string, unknown>;
  readFailures?: Set<string>;
  existing?: Set<string>;
}) {
  return {
    joinPath: (...parts: string[]) => parts.join("/"),
    readJsonFile: (file: string) => {
      if (readFailures.has(file) || !files.has(file)) throw new Error(`missing ${file}`);
      return files.get(file);
    },
    pathExists: (file: string) => existing.has(file)
  };
}

async function withTempProject(test: (root: string) => Promise<void>): Promise<void> {
  const root = path.resolve(".tmp", `expo98-bridge-status-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await fs.mkdir(root, { recursive: true });
  try {
    await test(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}
