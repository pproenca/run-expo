import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";

import {
  bridgeCommand,
  bridgeMetadata,
  bridgeSource,
  unwrapToolJson
} from "../main/index.js";

const PROJECT_ROOT = "/work/expo-app";
const PACKAGE_PATH = "/work/expo-app/package.json";
const METADATA_PATH = "/work/expo-app/.expo-ios/bridge.json";
const SOURCE_PATH = "/work/expo-app/src/expo-ios-devtools-bridge.ts";

describe("bridge-command-adapter legacy characterization", () => {
  it("validates action as a known non-empty bridge action", async () => {
    await assert.rejects(() => bridgeCommand({ action: "" }, fakeIo()), /action must be a non-empty string\./);
    await assert.rejects(() => bridgeCommand({ action: "bogus" }, fakeIo()), /Unknown bridge action: bogus/);
  });

  it("returns legacy toolJson status envelope by default", async () => {
    const payload = await bridgePayload({ action: "status" }, fakeIo({
      files: new Map([[PACKAGE_PATH, { dependencies: { expo: "~52.0.0" } }]])
    }));

    assert.equal(payload.available, true);
    assert.equal(payload.action, "status");
    assert.equal(payload.projectRoot, PROJECT_ROOT);
    assert.equal(payload.state, "absent");
    assert.deepEqual(payload.files, { metadata: false, source: false });
  });

  it("returns plan envelope without mutating files", async () => {
    const writes: string[] = [];
    const payload = await bridgePayload({ action: "plan" }, fakeIo({
      files: new Map([[PACKAGE_PATH, { dependencies: { expo: "~52.0.0" } }]]),
      writes
    }));

    assert.equal(payload.available, true);
    assert.equal(payload.action, "plan");
    assert.equal(payload.status, "absent");
    assert.deepEqual(payload.plan.requiredConfirmations, ["bridge-install", "bridge-remove"]);
    assert.deepEqual(writes, []);
  });

  it("delegates health and domains actions with current status and plan", async () => {
    const calls: unknown[] = [];
    const io = fakeIo({
      files: new Map([[PACKAGE_PATH, { dependencies: { expo: "~52.0.0" } }]]),
      bridgeHealthPayload: (args, context) => {
        calls.push({ args, context });
        return { available: true, action: context.action, status: context.status.state, plannedStatus: context.plan.status };
      }
    });

    assert.deepEqual(await bridgePayload({ action: "health", metroPort: 19000 }, io), {
      available: true,
      action: "health",
      status: "absent",
      plannedStatus: "absent"
    });
    assert.deepEqual(await bridgePayload({ action: "domains" }, io), {
      available: true,
      action: "domains",
      status: "absent",
      plannedStatus: "absent"
    });
    assert.equal(calls.length, 2);
  });

  it("refuses install without explicit bridge-install confirmation", async () => {
    const writes: string[] = [];
    const payload = await bridgePayload({ action: "install", confirmActions: "bridge-remove" }, fakeIo({
      files: new Map([[PACKAGE_PATH, { dependencies: { expo: "~52.0.0" } }]]),
      writes
    }));

    assert.equal(payload.available, false);
    assert.equal(payload.action, "install");
    assert.equal(payload.status, "absent");
    assert.equal(payload.requiredConfirmation, "bridge-install");
    assert.equal(payload.reason, "Refusing to mutate app files without explicit --confirm-actions bridge-install.");
    assert.deepEqual(writes, []);
  });

  it("refuses remove without explicit bridge-remove confirmation", async () => {
    const payload = await bridgePayload({ action: "remove", confirmActions: "bridge-install" }, fakeIo({
      files: new Map<string, unknown>([
        [PACKAGE_PATH, { dependencies: { expo: "~52.0.0" } }],
        [METADATA_PATH, bridgeMetadata()]
      ]),
      existing: new Set([SOURCE_PATH])
    }));

    assert.equal(payload.available, false);
    assert.equal(payload.action, "remove");
    assert.equal(payload.status, "present");
    assert.equal(payload.requiredConfirmation, "bridge-remove");
  });

  it("confirmed install creates directories, writes metadata and hardened bridge source, then rereads status", async () => {
    const writes: string[] = [];
    const files = new Map<string, unknown>([[PACKAGE_PATH, { dependencies: { expo: "~52.0.0" } }]]);
    const textFiles = new Map<string, string>();
    const payload = await bridgePayload({ action: "install", confirmActions: "bridge-install" }, fakeIo({
      files,
      textFiles,
      writes,
      afterWriteJson: (file, value) => files.set(file, value),
      afterWriteFile: (file, text) => textFiles.set(file, text),
      pathExistsOverride: (file) => file === SOURCE_PATH ? textFiles.has(file) : false
    }));

    assert.deepEqual(writes, [
      "mkdir:/work/expo-app/.expo-ios",
      "mkdir:/work/expo-app/src",
      "json:/work/expo-app/.expo-ios/bridge.json",
      "file:/work/expo-app/src/expo-ios-devtools-bridge.ts:utf8"
    ]);
    assert.equal(payload.available, true);
    assert.equal(payload.installed, true);
    assert.equal(payload.status, "present");
    assert.deepEqual(files.get(METADATA_PATH), bridgeMetadata());
    assert.equal(textFiles.get(SOURCE_PATH), bridgeSource());
    assert.match(String(textFiles.get(SOURCE_PATH)), /development-mode-required/);
  });

  it("confirmed remove deletes bridge files, ignores remove failures, then rereads status", async () => {
    const writes: string[] = [];
    const files = new Map<string, unknown>([
      [PACKAGE_PATH, { dependencies: { expo: "~52.0.0" } }],
      [METADATA_PATH, bridgeMetadata()]
    ]);
    const textFiles = new Map<string, string>([[SOURCE_PATH, bridgeSource()]]);
    const payload = await bridgePayload({ action: "remove", confirmActions: "bridge-remove" }, fakeIo({
      files,
      textFiles,
      writes,
      rmFailure: new Set([SOURCE_PATH]),
      afterRm: (file) => {
        files.delete(file);
        textFiles.delete(file);
      },
      pathExistsOverride: (file) => textFiles.has(file)
    }));

    assert.deepEqual(writes, [
      "rm:/work/expo-app/.expo-ios/bridge.json",
      "rm:/work/expo-app/src/expo-ios-devtools-bridge.ts"
    ]);
    assert.equal(payload.available, true);
    assert.equal(payload.removed, true);
    assert.equal(payload.status, "absent");
  });

  it("falls back to resolved cwd when project normalization fails", async () => {
    const payload = await bridgePayload({ action: "status", cwd: "missing-app" }, fakeIo({
      normalizeProjectCwd: () => {
        throw new Error("missing");
      },
      resolvePath: (...parts) => `/resolved/${parts.join("/")}`,
      files: new Map([["/resolved/missing-app/package.json", { dependencies: { expo: "~52.0.0" } }]])
    }));

    assert.equal(payload.projectRoot, "/resolved/missing-app");
  });

  it("uses default Node filesystem behavior for install and remove", async () => {
    await withTempProject(async (root) => {
      await fs.writeFile(path.join(root, "package.json"), JSON.stringify({ dependencies: { expo: "~52.0.0" } }), "utf8");

      const installed = await bridgePayload({ action: "install", cwd: root, confirmActions: "bridge-install" });
      assert.equal(installed.status, "present");
      assert.deepEqual(JSON.parse(await fs.readFile(path.join(root, ".expo-ios", "bridge.json"), "utf8")), bridgeMetadata());
      assert.equal(await fs.readFile(path.join(root, "src", "expo-ios-devtools-bridge.ts"), "utf8"), bridgeSource());

      const removed = await bridgePayload({ action: "remove", cwd: root, confirmActions: "bridge-remove" });
      assert.equal(removed.status, "absent");
      await assert.rejects(() => fs.access(path.join(root, ".expo-ios", "bridge.json")));
      await assert.rejects(() => fs.access(path.join(root, "src", "expo-ios-devtools-bridge.ts")));
    });
  });
});

async function bridgePayload(args: Record<string, unknown>, deps?: ReturnType<typeof fakeIo>) {
  return unwrapToolJson(await bridgeCommand(args, deps)) as Record<string, any>;
}

function fakeIo({
  files = new Map<string, unknown>(),
  textFiles = new Map<string, string>(),
  writes = [],
  existing = new Set<string>(),
  rmFailure = new Set<string>(),
  normalizeProjectCwd = () => PROJECT_ROOT,
  bridgeHealthPayload,
  resolvePath = (...parts: string[]) => parts.join("/"),
  pathExistsOverride,
  afterWriteJson,
  afterWriteFile,
  afterRm
}: {
  files?: Map<string, unknown>;
  textFiles?: Map<string, string>;
  writes?: string[];
  existing?: Set<string>;
  rmFailure?: Set<string>;
  normalizeProjectCwd?: (cwd: string | undefined, options: { allowMissingPackageJson: true }) => Promise<string> | string;
  bridgeHealthPayload?: (...args: any[]) => unknown;
  resolvePath?: (...parts: string[]) => string;
  pathExistsOverride?: (file: string) => boolean;
  afterWriteJson?: (file: string, value: unknown) => void;
  afterWriteFile?: (file: string, text: string) => void;
  afterRm?: (file: string) => void;
} = {}) {
  return {
    normalizeProjectCwd,
    bridgeHealthPayload,
    joinPath: (...parts: string[]) => parts.join("/"),
    resolvePath,
    currentCwd: () => PROJECT_ROOT,
    readJsonFile: (file: string) => {
      if (!files.has(file)) throw new Error(`missing ${file}`);
      return files.get(file);
    },
    pathExists: (file: string) => pathExistsOverride ? pathExistsOverride(file) : existing.has(file) || textFiles.has(file),
    mkdir: (file: string) => {
      writes.push(`mkdir:${file}`);
    },
    writeJsonFile: (file: string, value: unknown) => {
      writes.push(`json:${file}`);
      afterWriteJson?.(file, value);
    },
    writeFile: (file: string, text: string, encoding: "utf8") => {
      writes.push(`file:${file}:${encoding}`);
      afterWriteFile?.(file, text);
    },
    rm: (file: string) => {
      writes.push(`rm:${file}`);
      afterRm?.(file);
      if (rmFailure.has(file)) throw new Error("rm failed");
    }
  };
}

async function withTempProject(test: (root: string) => Promise<void>): Promise<void> {
  const root = path.resolve(".tmp", `expo98-bridge-command-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await fs.mkdir(root, { recursive: true });
  try {
    await test(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}
