#!/usr/bin/env node

// src/commands/accessibility-actions/src/main/index.ts
import { execFile as nodeExecFile2 } from "node:child_process";
import { readdir, readFile as readFile2 } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

// src/core/tool-json-envelope/src/main/index.ts
function toolJson(value) {
  return {
    content: [{ type: "text", text: `${JSON.stringify(value, null, 2)}
` }],
    isError: false
  };
}
function unwrapToolJson(result) {
  const maybe = result;
  const text = maybe?.content?.[0]?.text;
  if (typeof text !== "string") {
    return result;
  }
  try {
    return JSON.parse(text);
  } catch {
    return { text };
  }
}

// src/commands/route-url-actions/src/main/index.ts
import { execFile as nodeExecFile } from "node:child_process";
import * as fs from "node:fs/promises";
import path from "node:path";

// src/core/policy-redaction/src/main/domain.ts
var REDACTED = "[redacted]";
var POLICY_REASONS = Object.freeze({
  READ_ALLOWED: "Read action does not require policy approval.",
  MISSING_POLICY: "No action policy allowed this state-changing operation.",
  ACTION_ALLOWED: "Action allowed by policy.",
  ACTION_DENIED: "Action policy did not allow this operation."
});
var BRIDGE_CONFIRMATIONS = Object.freeze({
  install: "bridge-install",
  remove: "bridge-remove"
});
function checkedPolicyDecision({
  action,
  sideEffect,
  allowed,
  source = null,
  reason
}) {
  return {
    checked: true,
    action,
    sideEffect,
    allowed,
    source,
    reason
  };
}

// src/core/policy-redaction/src/main/policy-service.ts
function decideActionPolicy({
  action,
  sideEffect,
  policy = null,
  source = null,
  allowRuntimeEval = false
}) {
  if (action === "wait.fn" && allowRuntimeEval === true) {
    return checkedPolicyDecision({
      action,
      sideEffect: "runtime-eval",
      allowed: true,
      source: "--allow-runtime-eval",
      reason: "Runtime eval allowed by global flag."
    });
  }
  if (sideEffect === "read") {
    return checkedPolicyDecision({
      action,
      sideEffect,
      allowed: true,
      source: null,
      reason: POLICY_REASONS.READ_ALLOWED
    });
  }
  if (!policy) {
    return checkedPolicyDecision({
      action,
      sideEffect,
      allowed: false,
      source: null,
      reason: POLICY_REASONS.MISSING_POLICY
    });
  }
  const allowed = policyAllowsAction(policy, action);
  return checkedPolicyDecision({
    action,
    sideEffect,
    allowed,
    source,
    reason: allowed ? POLICY_REASONS.ACTION_ALLOWED : POLICY_REASONS.ACTION_DENIED
  });
}
function policyAllowsAction(policy, action) {
  if (Array.isArray(policy?.allow) && policy.allow.includes(action)) {
    return true;
  }
  if (policy?.actions?.[action] === "allow" || policy?.actions?.[action] === true) {
    return true;
  }
  return false;
}
function defaultPolicySummary() {
  return {
    allow: [],
    defaults: {
      read: "allow",
      write: "deny",
      device: "deny",
      runtimeEval: "deny unless --allow-runtime-eval true or an action policy allows the command"
    }
  };
}
function actionSideEffect(action) {
  if (action === "wait.fn") {
    return "runtime-eval";
  }
  if (/^(doctor|project-info|routes|devices|target\.list|target\.current|snapshot|refs|get|find|wait|console|errors|logs|metro\.status|policy|redact|review)/.test(
    action
  )) {
    return "read";
  }
  if (/^(storage\.set|storage\.clear|state\.save|state\.load|state\.clear|install-app|uninstall-app|set\.)/.test(
    action
  )) {
    return "device";
  }
  return "device";
}
function policyDeniedPayload({
  domain,
  action,
  policy
}) {
  return {
    available: false,
    domain,
    action,
    source: "policy",
    evidenceSource: "policy",
    code: "policy-denied",
    denied: true,
    reason: "Policy denied action.",
    policy
  };
}

// src/commands/route-url-actions/src/main/index.ts
var MAX_OUTPUT = 4e4;
function requireString(value, field) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${field} must be a non-empty string.`);
  }
  return value.trim();
}
function requireOptionalString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
async function buildExpoRouteUrl(cwd, args = {}) {
  const scheme = requireOptionalString(args.scheme) ?? await inferExpoScheme(cwd);
  if (!scheme) throw new Error("Could not infer Expo scheme. Pass scheme or url.");
  const rawRoute = requireOptionalString(args.route) ?? "/";
  const route = rawRoute.startsWith("/") ? rawRoute.slice(1) : rawRoute;
  const params = new URLSearchParams(requireOptionalString(args.query) ?? "");
  const authCookie = requireOptionalString(args.authCookie);
  if (authCookie) params.set("cookie", authCookie);
  const query = params.toString();
  return `${scheme}:///${route}${query ? `?${query}` : ""}`;
}
async function inferExpoScheme(cwd) {
  const appJsonPath = path.join(cwd, "app.json");
  if (await pathExists(appJsonPath)) {
    const appJson = await readJsonFile(appJsonPath);
    const expo = isRecord(appJson.expo) ? appJson.expo : {};
    const scheme = expo.scheme ?? appJson.scheme;
    if (typeof scheme === "string" && scheme.trim()) return scheme.trim();
  }
  const configPath = await firstExisting(cwd, [
    "app.config.ts",
    "app.config.js",
    "app.config.mjs",
    "app.config.cjs"
  ]);
  if (!configPath) return null;
  const text = await fs.readFile(configPath, "utf8");
  const match = /\bscheme\s*:\s*["'`]([^"'`]+)["'`]/.exec(text);
  return match?.[1] ?? null;
}
function redactUrlAuthCookie(url) {
  try {
    const parsed = new URL(url);
    for (const key of [...parsed.searchParams.keys()]) {
      if (isSensitiveQueryKey(key)) parsed.searchParams.set(key, "[redacted]");
    }
    return parsed.toString();
  } catch {
    return redactSensitiveUrlQuery(url);
  }
}
function androidDeviceArgs(device, args) {
  return device ? ["-s", device, ...args] : [...args];
}
async function resolveIosDevice(requested, options = {}, deps = {}) {
  if (requested && /^[0-9A-Fa-f-]{20,}$/.test(requested)) {
    return { udid: requested, name: requested, state: "unknown" };
  }
  const execFile12 = deps.execFile ?? defaultExecFile;
  const { stdout } = await execFile12("xcrun", ["simctl", "list", "devices", "available", "--json"], {
    timeout: 2e4,
    maxBuffer: 4 * 1024 * 1024
  });
  const parsed = JSON.parse(String(stdout ?? "{}"));
  const devices = Object.entries(parsed.devices ?? {}).flatMap(
    ([runtime2, runtimeDevices]) => (Array.isArray(runtimeDevices) ? runtimeDevices : []).map(
      (device) => ({ ...device, runtime: runtime2 })
    )
  );
  if (requested) {
    const exact = devices.find((device) => device.udid === requested || device.name === requested);
    if (exact) return exact;
    const partial = devices.find(
      (device) => String(device.name).toLowerCase().includes(requested.toLowerCase())
    );
    if (partial) return partial;
    throw new Error(`No available iOS simulator matched: ${requested}`);
  }
  if (options.preferBooted) {
    const booted = devices.find((device) => device.state === "Booted");
    if (booted) return booted;
  }
  const iphone = [...devices].reverse().find((device) => /iPhone/.test(device.name));
  if (iphone) return iphone;
  if (devices[0]) return devices[0];
  throw new Error("No available iOS simulators found.");
}
async function openUrl(args, deps = {}) {
  const platform = args.platform ?? "ios";
  const url = requireString(args.url, "url");
  if (/\s/.test(url)) throw new Error("url must not contain whitespace.");
  const policy = await routeActionPolicyDecision(args, "open-url", deps);
  if (!policy.allowed)
    return toolJson(policyDeniedPayload({ domain: "route", action: "open-url", policy }));
  const execFile12 = deps.execFile ?? defaultExecFile;
  if (platform === "android") {
    const adbArgs = androidDeviceArgs(args.device, [
      "shell",
      "am",
      "start",
      "-a",
      "android.intent.action.VIEW",
      "-d",
      url
    ]);
    const result2 = await execFile12("adb", adbArgs, { timeout: 3e4, rejectOnError: false });
    return toolJson(
      redactToolPayload({
        platform,
        device: args.device ?? null,
        stdout: truncate(result2.stdout),
        stderr: truncate(result2.stderr)
      })
    );
  }
  const device = await resolveIosDevice(args.device, { preferBooted: true }, deps);
  const result = await execFile12("xcrun", ["simctl", "openurl", device.udid, url], {
    timeout: 3e4,
    rejectOnError: false
  });
  return toolJson(
    redactToolPayload({
      platform,
      device,
      stdout: truncate(result.stdout),
      stderr: truncate(result.stderr)
    })
  );
}
async function openExpoRoute(args, deps = {}) {
  const cwd = await normalizeProjectCwd(args.cwd, { allowMissingPackageJson: true });
  const url = args.url ? requireString(args.url, "url") : await buildExpoRouteUrl(cwd, args);
  if (/\s/.test(url)) throw new Error("url must not contain whitespace.");
  const policy = await routeActionPolicyDecision(args, "open-route", deps);
  if (!policy.allowed)
    return toolJson(policyDeniedPayload({ domain: "route", action: "open-route", policy }));
  const device = await resolveIosDevice(args.device, { preferBooted: true }, deps);
  const execFile12 = deps.execFile ?? defaultExecFile;
  const result = await execFile12("xcrun", ["simctl", "openurl", device.udid, url], {
    timeout: 3e4,
    rejectOnError: false
  });
  return toolJson(
    redactToolPayload({
      platform: "ios",
      device,
      url: redactUrlAuthCookie(url),
      stdout: truncate(result.stdout),
      stderr: truncate(result.stderr),
      error: normalizeExecError(result.error)
    })
  );
}
async function routeActionPolicyDecision(args, action, deps = {}) {
  const policyPath = requireOptionalString(args.actionPolicy);
  const source = policyPath ? (deps.resolvePath ?? path.resolve)(policyPath) : null;
  const policy = source ? await readPolicyDocument(source, deps) : null;
  return decideActionPolicy({ action, sideEffect: "device", policy, source });
}
async function normalizeProjectCwd(cwd, options = {}) {
  const resolved = await normalizeCwd(cwd);
  if (options.allowMissingPackageJson) return resolved;
  const packageJson = await findUp(resolved, "package.json");
  if (!packageJson)
    throw new Error(`No package.json found from ${resolved}. Pass cwd for an Expo project.`);
  return path.dirname(packageJson);
}
async function normalizeCwd(cwd) {
  const resolved = path.resolve(cwd ?? ".");
  const stat8 = await fs.stat(resolved).catch(() => null);
  if (!stat8?.isDirectory()) throw new Error(`Directory does not exist: ${resolved}`);
  return resolved;
}
async function findUp(startDir, filename) {
  let current = path.resolve(startDir);
  while (true) {
    const candidate = path.join(current, filename);
    if (await pathExists(candidate)) return candidate;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}
async function firstExisting(root, names) {
  for (const name of names) {
    const candidate = path.join(root, name);
    if (await pathExists(candidate)) return candidate;
  }
  return null;
}
async function pathExists(file) {
  return fs.access(file).then(
    () => true,
    () => false
  );
}
async function readJsonFile(file) {
  return JSON.parse(await fs.readFile(file, "utf8"));
}
async function readPolicyDocument(file, deps) {
  const read = deps.readJsonFile ?? readJsonFile;
  return await read(file);
}
function truncate(value, limit = MAX_OUTPUT) {
  const text = String(value ?? "");
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}
[truncated ${text.length - limit} characters]`;
}
function redactToolPayload(value) {
  return redactUnknown(value);
}
function redactUnknown(value) {
  if (typeof value === "string") return redactSensitiveUrlQuery(value);
  if (Array.isArray(value)) return value.map((item) => redactUnknown(item));
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, redactUnknown(item)])
    );
  }
  return value;
}
function normalizeExecError(error) {
  if (!error) return error ?? null;
  return redactToolPayload({
    message: typeof error.message === "string" ? error.message : void 0,
    code: error.code ?? null,
    signal: error.signal ?? null
  });
}
function redactSensitiveUrlQuery(value) {
  return value.replace(
    /([?&][^=\s&]*(?:cookie|token|authorization|password|secret)[^=\s&]*=)[^&\s]+/gi,
    "$1[redacted]"
  );
}
function isSensitiveQueryKey(key) {
  return /cookie|token|authorization|password|secret/i.test(key);
}
function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
var defaultExecFile = (file, args, options = {}) => new Promise((resolve18, reject) => {
  const { timeout = 6e4, maxBuffer = MAX_OUTPUT, rejectOnError = true } = options;
  nodeExecFile(
    file,
    [...args],
    { timeout: Number(timeout), maxBuffer: Number(maxBuffer) },
    (error, stdout, stderr) => {
      if (error && rejectOnError) {
        Object.assign(error, { stdout, stderr });
        reject(error);
        return;
      }
      resolve18({
        stdout: String(stdout ?? ""),
        stderr: String(stderr ?? ""),
        error: error ? { message: error.message, code: error.code, signal: error.signal } : void 0
      });
    }
  );
});

// src/commands/accessibility-actions/src/main/index.ts
var FOCUS_LIMITATION = "Native iOS accessibility focus APIs are not exposed by stable local simulator tooling here; this command focuses the element through the available ref tap path.";
async function accessibilityCommand(args = {}, deps = defaultAccessibilityDependencies) {
  const positionals = Array.isArray(args._) ? args._ : [];
  const action = requireString2(args.action ?? positionals[0] ?? "tree", "action");
  if (!["tree", "inspect", "audit", "focus"].includes(action))
    throw new Error(`Unknown accessibility action: ${action}`);
  if (action === "focus") {
    const ref = requireString2(args.ref ?? positionals[1], "ref");
    if (!deps.refActionCommand)
      return toolJson({
        available: false,
        action,
        ref,
        reason: "No ref action adapter is configured."
      });
    const result = asRecord(unwrapToolJson(await deps.refActionCommand({ ...args, command: "focus", ref }))) ?? {};
    return toolJson({
      ...result,
      action,
      source: result.source ?? "ref-action",
      limitations: [FOCUS_LIMITATION]
    });
  }
  if (action === "inspect") {
    const ref = requireString2(args.ref ?? positionals[1], "ref");
    const cache = await readLatestRefCache(args, deps);
    if (!cache)
      return toolJson({
        available: false,
        action,
        reason: "No snapshot exists for the current session.",
        ref
      });
    const record = (cache.refs ?? []).find((item) => item.ref === ref);
    return toolJson(
      record ? {
        available: true,
        action,
        ref,
        snapshotId: cache.snapshotId,
        targetId: cache.targetId,
        record
      } : { available: false, action, reason: "Ref not found in the latest snapshot.", ref }
    );
  }
  if (action === "audit") {
    const cache = await readLatestRefCache(args, deps);
    if (!cache)
      return toolJson({
        available: false,
        action,
        reason: "No snapshot exists for the current session.",
        issues: []
      });
    const issues = auditAccessibilityRefs(cache);
    return toolJson({
      available: true,
      action,
      snapshotId: cache.snapshotId,
      targetId: cache.targetId,
      issueCount: issues.length,
      issues
    });
  }
  return toolJson(await accessibilityTreePayload(args, deps));
}
var defaultAccessibilityDependencies = {
  commandPath: defaultCommandPath,
  resolveIosDevice: (device, options) => resolveIosDevice(typeof device === "string" ? device : null, options),
  execFile: defaultExecFile2,
  refActionCommand: (args) => toolJson({
    available: false,
    action: "focus",
    ref: args.ref ?? null,
    reason: "Accessibility focus requires a current ref action adapter."
  })
};
function defaultCommandPath(command) {
  return new Promise((resolve18) => {
    nodeExecFile2("which", [command], { timeout: 5e3 }, (error, stdout) => {
      resolve18(error ? null : String(stdout ?? "").trim() || null);
    });
  });
}
function defaultExecFile2(file, argv, options) {
  return new Promise((resolve18) => {
    nodeExecFile2(
      file,
      argv,
      {
        timeout: options.timeout,
        maxBuffer: options.maxBuffer
      },
      (error, stdout, stderr) => {
        resolve18({
          stdout: String(stdout ?? ""),
          stderr: String(stderr ?? ""),
          error: error ? { message: error.message, code: error.code, signal: error.signal } : void 0
        });
      }
    );
  });
}
async function accessibilityTreePayload(args, deps = {}) {
  const semanticBridge = await semanticBridgeTree(args, deps);
  const axe = deps.commandPath ? await deps.commandPath("axe") : null;
  if (!axe)
    return {
      available: false,
      action: "tree",
      reason: "axe CLI is not installed or not on PATH.",
      semanticBridge
    };
  if (!deps.resolveIosDevice)
    return { available: false, action: "tree", reason: "No iOS device resolver is configured." };
  if (!deps.execFile)
    return { available: false, action: "tree", reason: "No subprocess adapter is configured." };
  const device = await deps.resolveIosDevice(args.device, { preferBooted: true });
  const result = await deps.execFile(axe, ["describe-ui", "--udid", String(device.udid)], {
    timeout: 12e3,
    maxBuffer: 4 * 1024 * 1024,
    rejectOnError: false
  });
  if (result.error) {
    return {
      available: false,
      action: "tree",
      reason: "Native accessibility tree failed.",
      stderr: truncate2(result.stderr),
      error: result.error,
      semanticBridge
    };
  }
  const tree = JSON.parse(result.stdout || "[]");
  return {
    available: true,
    action: "tree",
    source: semanticBridge?.available ? ["plugin-bridge-semantic", "native-accessibility"] : "native-accessibility",
    device,
    tree,
    semanticBridge
  };
}
function auditAccessibilityRefs(cache) {
  return (cache.refs ?? []).filter((record) => (record.actions ?? []).length > 0 && !record.label && !record.text).map((record) => ({
    ref: record.ref,
    rule: "interactive-name",
    message: "Interactive ref has no label or text."
  }));
}
async function readLatestRefCache(args = {}, deps = {}) {
  if (deps.readLatestRefCache) return deps.readLatestRefCache(args);
  const stateRoot = resolveExpoStateRoot(args);
  const session = await readLatestSession(stateRoot);
  if (!session?.lastSnapshotId) return null;
  const parsed = await readJsonFile2(
    join(sessionDirectory(stateRoot, String(session.sessionId)), "refs.json")
  ).catch(() => null);
  return asRefCache(parsed);
}
async function semanticBridgeTree(args, deps = {}) {
  if (!deps.semanticBridgeSnapshot) return null;
  try {
    return await deps.semanticBridgeSnapshot(args, {
      stateRoot: resolveExpoStateRoot(args),
      session: { activeTargetId: null },
      filters: {
        interactiveOnly: false,
        compact: false,
        depth: null,
        includeSource: true,
        includeBounds: true
      }
    });
  } catch (error) {
    return {
      available: false,
      source: "plugin-bridge-semantic",
      code: "transport-failure",
      reason: formatError(error)
    };
  }
}
async function readLatestSession(stateRoot) {
  const sessionsRoot = join(stateRoot, "sessions");
  const entries = await readdir(sessionsRoot, { withFileTypes: true }).catch(() => []);
  const sessions = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const record = await readJsonFile2(join(sessionsRoot, entry.name, "session.json")).catch(
      () => null
    );
    const session = asSessionRecord(record);
    if (session) sessions.push(session);
  }
  sessions.sort(
    (a, b) => String(b.updatedAt ?? b.createdAt).localeCompare(String(a.updatedAt ?? a.createdAt))
  );
  return sessions[0] ?? null;
}
function resolveExpoStateRoot(args = {}) {
  if (args.stateDir) {
    const resolved = resolve(args.stateDir);
    return basename(resolved) === "runs" ? resolve(join(resolved, "..")) : resolved;
  }
  const root = resolve(args.root ?? args.cwd ?? process.cwd());
  return join(root, ".scratch", "expo98");
}
function sessionDirectory(stateRoot, sessionId) {
  return join(stateRoot, "sessions", sessionId);
}
async function readJsonFile2(file) {
  return JSON.parse(await readFile2(file, "utf8"));
}
function requireString2(value, name) {
  if (typeof value !== "string" || value.trim().length === 0)
    throw new Error(`${name} must be a non-empty string.`);
  return value.trim();
}
function truncate2(value, max = 4e4) {
  const text = String(value ?? "");
  if (text.length <= max) return text;
  return `${text.slice(0, max)}...[truncated ${text.length - max} chars]`;
}
function formatError(error) {
  const record = error && typeof error === "object" ? error : null;
  return record?.message == null ? String(error) : String(record.message);
}
function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}
function asRefCache(value) {
  const record = asRecord(value);
  if (!record || !Array.isArray(record.refs)) return null;
  return record;
}
function asSessionRecord(value) {
  const record = asRecord(value);
  return typeof record?.sessionId === "string" ? record : null;
}

// src/commands/review-overlay-workflow/src/main/index.ts
import { spawn } from "node:child_process";
import { openSync } from "node:fs";
import { mkdir as mkdir3, stat as stat2, writeFile as writeFile3 } from "node:fs/promises";
import path4 from "node:path";

// src/commands/review-overlay-workflow/src/main/events.ts
import { mkdir, readFile as readFile3, writeFile } from "node:fs/promises";
import path2 from "node:path";
async function createEventsFile(args) {
  await mkdir(args.outputDir, { recursive: true });
  const eventsPath = path2.join(args.outputDir, "events.json");
  const existing = await readJson(eventsPath).catch(() => null);
  const payload = args.reset || !existing ? {
    version: 1,
    title: requireOptionalString2(args.title) ?? "Codex in-app review",
    createdAt: (/* @__PURE__ */ new Date()).toISOString(),
    events: []
  } : existing;
  await writeFile(eventsPath, `${JSON.stringify(payload, null, 2)}
`, "utf8");
  return {
    eventsPath,
    eventCount: Array.isArray(payload.events) ? payload.events.length : 0,
    title: payload.title ?? null
  };
}
async function readEvents(eventsPath, options = {}) {
  const payload = await readJson(eventsPath).catch(() => null);
  if (!payload) {
    return {
      available: false,
      reason: "No review overlay events file exists.",
      eventCount: 0,
      events: [],
      metroPort: options.metroPort ?? null
    };
  }
  const events = Array.isArray(payload.events) ? payload.events : [];
  return {
    available: true,
    eventCount: events.length,
    events,
    title: payload.title ?? null,
    metroPort: options.metroPort ?? null
  };
}
async function readJson(file) {
  return JSON.parse(await readFile3(file, "utf8"));
}
function requireOptionalString2(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

// src/commands/review-overlay-workflow/src/main/scaffold-template.ts
function codexReviewOverlayComponentSource() {
  return `import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

type CodexReviewOverlayProps = {
  endpoint?: string;
  screenName?: string;
  inspectedViewRef?: React.RefObject<unknown>;
};

export function CodexReviewOverlay({ endpoint = "http://127.0.0.1:17655/events", screenName = "Screen", inspectedViewRef }: CodexReviewOverlayProps): React.ReactElement {
  const [active, setActive] = useState(false);
  const [events, setEvents] = useState([]);
  const sequence = useRef(0);

  const submit = useCallback(async (event) => {
    const payload = {
      id: "overlay-" + Date.now().toString(36) + "-" + sequence.current++,
      screenName,
      createdAt: new Date().toISOString(),
      ...event,
    };
    setEvents((current) => current.concat(payload));
    try {
      await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch {}
  }, [endpoint, screenName]);

  const label = useMemo(() => active ? "Tap target" : "Comment", [active]);

  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      <View pointerEvents="box-none" style={styles.toolbar}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Codex review comment"
          onPress={() => setActive((value) => !value)}
          style={[styles.button, active ? styles.active : null]}
        >
          <Text style={styles.buttonText}>{label}</Text>
        </Pressable>
      </View>
      {active ? (
        <Pressable
          accessibilityLabel="Codex review target surface"
          style={StyleSheet.absoluteFill}
          onPress={(event) => {
            const { locationX, locationY, pageX, pageY } = event.nativeEvent;
            submit({
              type: "tap-comment",
              gesture: { locationX, locationY, pageX, pageY },
              element: { refAvailable: Boolean(inspectedViewRef?.current) },
            });
            setActive(false);
          }}
        />
      ) : null}
      <View pointerEvents="none" style={styles.counter}>
        <Text style={styles.counterText}>{events.length}</Text>
      </View>
    </View>
  );
}

export default CodexReviewOverlay;

const styles = StyleSheet.create({
  toolbar: { position: "absolute", top: 48, right: 16, zIndex: 9999 },
  button: { backgroundColor: "#0a84ff", borderRadius: 18, paddingHorizontal: 14, paddingVertical: 9 },
  active: { backgroundColor: "#ff453a" },
  buttonText: { color: "white", fontWeight: "700" },
  counter: { position: "absolute", top: 92, right: 16, minWidth: 24, alignItems: "center" },
  counterText: { color: "white", backgroundColor: "rgba(0,0,0,0.55)", borderRadius: 12, overflow: "hidden", paddingHorizontal: 7, paddingVertical: 2 },
});
`;
}

// src/commands/review-overlay-workflow/src/main/server.ts
import { mkdir as mkdir2, readFile as readFile4, writeFile as writeFile2 } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import path3 from "node:path";
async function reviewOverlayServer(args) {
  const dir = path3.resolve(args.dir);
  const port = args.port ? clampNumber(args.port, 1, 65535) : await findAvailablePort(17655);
  const endpointPath = normalizeEndpointPath(args.endpointPath);
  await mkdir2(dir, { recursive: true });
  await createEventsFile({ outputDir: dir, reset: false });
  const server = createHttpServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", async () => {
      const url = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);
      const eventsPath = path3.join(dir, "events.json");
      if (request.method === "GET" && url.pathname === "/events.json") {
        const text = await readFile4(eventsPath, "utf8").catch(() => '{"events":[]}\n');
        response.writeHead(200, {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store"
        });
        response.end(text);
        return;
      }
      if (request.method === "POST" && url.pathname === endpointPath) {
        const current = await readJson(eventsPath).catch(() => ({ version: 1, events: [] }));
        const events = Array.isArray(current.events) ? current.events : [];
        events.push(JSON.parse(body || "{}"));
        const next = { ...current, events, updatedAt: (/* @__PURE__ */ new Date()).toISOString() };
        await writeFile2(eventsPath, `${JSON.stringify(next, null, 2)}
`, "utf8");
        response.writeHead(200, {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store"
        });
        response.end(
          `${JSON.stringify({ ok: true, eventsPath, eventCount: events.length }, null, 2)}
`
        );
        return;
      }
      response.writeHead(404, { "content-type": "application/json; charset=utf-8" });
      response.end('{"ok":false,"error":"not found"}\n');
    });
  });
  await new Promise((resolve18) => server.listen(port, "127.0.0.1", () => resolve18()));
  const payload = {
    ok: true,
    url: `http://127.0.0.1:${port}/`,
    endpoint: `http://127.0.0.1:${port}${endpointPath}`,
    eventsUrl: `http://127.0.0.1:${port}/events.json`,
    dir
  };
  process.stdout.write(`${JSON.stringify(payload, null, 2)}
`);
  return await new Promise(() => {
  });
}
function normalizeEndpointPath(value) {
  const raw = requireOptionalString3(value) ?? "/events";
  const endpoint = raw.startsWith("/") ? raw : `/${raw}`;
  if (!/^\/[A-Za-z0-9_./-]+$/.test(endpoint))
    throw new Error("endpointPath must be a simple URL path.");
  return endpoint;
}
function clampNumber(value, min, max) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) {
    throw new Error(`Expected a finite number, got ${value}.`);
  }
  return Math.min(Math.max(numberValue, min), max);
}
function findAvailablePort(start) {
  return new Promise((resolve18) => {
    const tryPort = (port) => {
      const server = createNetServer();
      server.once("error", () => tryPort(port + 1));
      server.once("listening", () => {
        server.close(() => resolve18(port));
      });
      server.listen(port, "127.0.0.1");
    };
    tryPort(start);
  });
}
function requireOptionalString3(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

// src/commands/review-overlay-workflow/src/main/index.ts
var REVIEW_OVERLAY_ACTIONS = /* @__PURE__ */ new Set(["prepare", "scaffold", "server", "read", "clear"]);
async function reviewOverlay(args = {}, deps = defaultReviewOverlayDependencies) {
  const payload = await reviewOverlayAction(args, deps);
  return isToolTextResult(payload) ? payload : toolJson(payload);
}
async function reviewOverlayAction(args = {}, deps = defaultReviewOverlayDependencies) {
  const action = requireOptionalString4(args.action) ?? "prepare";
  if (!REVIEW_OVERLAY_ACTIONS.has(action)) {
    throw new Error(`Unknown review-overlay action: ${action}`);
  }
  if (action === "scaffold") return scaffoldReviewOverlay(args, deps);
  const cwd = await deps.normalizeProjectCwd(args.cwd, { allowMissingPackageJson: true }).catch(() => deps.resolvePath(String(args.cwd ?? deps.fallbackCwd())));
  const outputDir = deps.resolvePath(
    requireOptionalString4(args.outputDir) ?? deps.joinPath(cwd, ".scratch", "codex-review-overlay")
  );
  const eventsPath = deps.joinPath(outputDir, "events.json");
  if (action === "read") {
    const data2 = await deps.readEvents(eventsPath, { metroPort: args.metroPort });
    return { outputDir, eventsPath, ...data2 };
  }
  if (action === "clear") {
    const data2 = await deps.createEventsFile({ outputDir, title: args.title, reset: true });
    return { outputDir, eventsPath, cleared: true, ...data2 };
  }
  if (action === "server") {
    return deps.reviewOverlayServer({
      dir: outputDir,
      port: args.port,
      endpointPath: args.endpointPath
    });
  }
  const title = requireOptionalString4(args.title) ?? "Codex in-app review";
  const data = await deps.createEventsFile({ outputDir, title, reset: false });
  let server = null;
  if (args.serve === true) {
    const port = args.port ? clampNumber(args.port, 1, 65535) : await deps.findAvailablePort(17655);
    const endpointPath = normalizeEndpointPath(args.endpointPath);
    const logPath = deps.joinPath(outputDir, "review-overlay-server.log");
    const logFd = await deps.openLogFile(logPath, "a");
    const child = await deps.spawnDetached(
      deps.execPath,
      [
        deps.scriptPath,
        "review-overlay-server",
        "--output-dir",
        outputDir,
        "--port",
        String(port),
        "--endpoint-path",
        endpointPath
      ],
      {
        detached: true,
        stdio: ["ignore", logFd, logFd]
      }
    );
    child.unref?.();
    server = {
      url: `http://127.0.0.1:${port}/`,
      endpoint: `http://127.0.0.1:${port}${endpointPath}`,
      eventsUrl: `http://127.0.0.1:${port}/events.json`,
      pid: child.pid,
      logPath,
      stop: `kill ${child.pid}`
    };
  }
  return {
    outputDir,
    eventsPath,
    server,
    ...data,
    instructions: [
      "Run review-overlay scaffold once, then mount CodexReviewOverlay inside the app root in development only.",
      server ? `Pass endpoint="${server.endpoint}" to CodexReviewOverlay. In iOS Simulator, 127.0.0.1 points at the Mac host.` : "Start with --serve true or run review-overlay server before using the overlay in the simulator.",
      `Codex can read in-app review events from ${eventsPath}.`
    ]
  };
}
var defaultReviewOverlayDependencies = {
  normalizeProjectCwd: defaultNormalizeProjectCwd,
  fallbackCwd: () => process.cwd(),
  resolvePath: (...parts) => path4.resolve(...parts.filter((part) => Boolean(part))),
  joinPath: (...parts) => path4.join(...parts),
  relativePath: (from, to) => path4.relative(from, to),
  createEventsFile,
  readEvents,
  reviewOverlayServer,
  mkdir: mkdir3,
  writeFile: writeFile3,
  pathExists: async (file) => stat2(file).then(
    () => true,
    () => false
  ),
  findAvailablePort,
  openLogFile: (file) => openSync(file, "a"),
  spawnDetached: (command, argv, options) => spawn(command, argv, options),
  execPath: process.execPath,
  scriptPath: process.argv[1] ?? ""
};
function isToolTextResult(value) {
  return Array.isArray(value?.content);
}
async function scaffoldReviewOverlay(args = {}, deps) {
  const cwd = await deps.normalizeProjectCwd(args.cwd, { allowMissingPackageJson: true }).catch(() => deps.resolvePath(String(args.cwd ?? deps.fallbackCwd())));
  const overlayDir = deps.resolvePath(
    cwd,
    requireOptionalString4(args.overlayDir) ?? "codex-review-overlay"
  );
  const componentPath = deps.joinPath(overlayDir, "CodexReviewOverlay.tsx");
  const indexPath = deps.joinPath(overlayDir, "index.ts");
  if (await deps.pathExists(componentPath) && args.force !== true) {
    throw new Error(`${componentPath} already exists. Pass --force true to overwrite.`);
  }
  await deps.mkdir(overlayDir, { recursive: true });
  await deps.writeFile(componentPath, codexReviewOverlayComponentSource(), "utf8");
  await deps.writeFile(
    indexPath,
    `export { CodexReviewOverlay } from "./CodexReviewOverlay";
export { default } from "./CodexReviewOverlay";
`,
    "utf8"
  );
  return {
    overlayDir,
    componentPath,
    indexPath,
    integration: {
      import: `import { CodexReviewOverlay } from "${relativeImportFromAppRoot(cwd, overlayDir, deps)}";`,
      jsx: `{__DEV__ ? <CodexReviewOverlay endpoint="http://127.0.0.1:17655/events" screenName="Schedule" inspectedViewRef={inspectedViewRef} /> : null}`,
      note: "Mount this near the root layout so it floats above the current screen. Wrap only the app content, not the overlay, in a host View ref with collapsable={false}; pass that ref as inspectedViewRef so comments identify the tapped app element."
    },
    capabilities: [
      "single Comment control inside the app",
      "inactive state leaves the app interactive",
      "mouse-over preview after Comment resolves native elements before selection",
      "next click after Comment resolves the touched native element and owner hierarchy",
      "Copy action writes Agentation-style feedback markdown to the Mac clipboard",
      "bounding boxes around commented elements",
      "gesture metadata for tap, hold, and scroll conflict notes",
      "local JSON event sync readable by Codex"
    ]
  };
}
function relativeImportFromAppRoot(cwd, overlayDir, deps) {
  const rel = (deps?.relativePath(cwd, overlayDir) ?? relativePathFallback(cwd, overlayDir)).replace(/\\/g, "/");
  return rel.startsWith(".") ? rel : `./${rel}`;
}
function requireOptionalString4(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
function relativePathFallback(from, to) {
  const fromParts = from.split("/").filter(Boolean);
  const toParts = to.split("/").filter(Boolean);
  while (fromParts.length && toParts.length && fromParts[0] === toParts[0]) {
    fromParts.shift();
    toParts.shift();
  }
  return [...fromParts.map(() => ".."), ...toParts].join("/") || ".";
}
async function defaultNormalizeProjectCwd(cwd) {
  const resolved = path4.resolve(requireOptionalString4(cwd) ?? ".");
  const details = await stat2(resolved).catch(() => null);
  if (!details?.isDirectory()) throw new Error(`Directory does not exist: ${resolved}`);
  return resolved;
}

// src/commands/annotate-screen-artifacts/src/main/index.ts
var ANNOTATE_ACTIONS = /* @__PURE__ */ new Set(["prepare", "read", "clear", "scaffold", "server"]);
var SCAFFOLD_CONFIRMATION = "annotate-overlay-scaffold";
async function annotateScreen(args = {}, deps = defaultAnnotateScreenDependencies) {
  const positionals = Array.isArray(args._) ? args._ : [];
  const action = requireOptionalString5(args.action ?? positionals[0]) ?? "prepare";
  if (!ANNOTATE_ACTIONS.has(action)) {
    throw new Error(`Unknown annotate-screen action: ${action}`);
  }
  if (action === "scaffold" && !hasExplicitConfirmation(args.confirmActions, SCAFFOLD_CONFIRMATION)) {
    return toolJson({
      available: false,
      action,
      source: "policy",
      evidenceSource: "policy",
      code: "confirmation-required",
      reason: `Refusing to mutate app files without explicit --confirm-actions ${SCAFFOLD_CONFIRMATION}.`,
      requiredConfirmation: SCAFFOLD_CONFIRMATION,
      mutation: {
        writesAppFiles: true,
        developmentOnly: true
      }
    });
  }
  const result = await deps.reviewOverlayAction({
    ...args,
    action,
    title: args.title ?? "Codex in-app annotations"
  });
  const payload = isToolTextResult2(result) ? unwrapToolJson2(result) : result;
  return toolJson({
    ...isRecord2(payload) ? payload : { value: payload },
    command: "annotate-screen",
    annotationSurface: "in-app-overlay",
    compatibility: {
      legacyBoard: "removed",
      replacement: "review-overlay"
    }
  });
}
var defaultAnnotateScreenDependencies = {
  reviewOverlayAction
};
function unwrapToolJson2(result) {
  const text = result?.content?.[0]?.text;
  if (typeof text !== "string") return result;
  try {
    return JSON.parse(text);
  } catch {
    return { text };
  }
}
function hasExplicitConfirmation(value, required) {
  if (typeof value !== "string") return false;
  return value.split(/[,\s]+/).filter(Boolean).includes(required);
}
function requireOptionalString5(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
function isRecord2(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isToolTextResult2(value) {
  return Array.isArray(value?.content);
}

// src/commands/annotation-server-http/src/main/index.ts
async function removedAnnotationServerCommand(args = {}) {
  return removedAnnotationServerHttpPayload(args);
}
function removedAnnotationServerHttpPayload(args = {}) {
  return {
    available: false,
    action: "annotation-server",
    code: "external-annotation-server-removed",
    reason: "The external annotation server has been removed. Use the in-app annotation overlay instead.",
    requested: {
      dir: typeof args.dir === "string" ? args.dir : null,
      port: args.port ?? null
    },
    replacement: {
      prepare: "annotate-screen prepare --serve true",
      server: "annotate-screen server",
      read: "annotate-screen read",
      scaffold: "annotate-screen scaffold --confirm-actions annotate-overlay-scaffold"
    },
    limitations: [
      "Annotation UI must be mounted inside the Expo/React Native app.",
      "This compatibility command does not serve external annotation boards."
    ]
  };
}

// src/commands/app-lifecycle-actions/src/main/index.ts
import { execFile as nodeExecFile3 } from "node:child_process";
import * as fs2 from "node:fs/promises";
import { homedir } from "node:os";
import { join as joinPath, resolve as resolvePath } from "node:path";
var MAX_OUTPUT2 = 4e4;
var defaultAppLifecycleDependencies = {
  execFile: defaultExecFile3,
  resolveIosDevice: defaultResolveIosDevice,
  wait: (ms) => new Promise((resolve18) => setTimeout(resolve18, ms)),
  now: () => Date.now(),
  policyDecision: defaultPolicyDecision,
  runtimeSummary: defaultRuntimeSummary,
  listDiagnosticReports: defaultListDiagnosticReports
};
async function bootSimulator(args, deps = defaultAppLifecycleDependencies) {
  const policy = await deps.policyDecision(args, "boot-simulator", "device");
  if (!policy.allowed) return policyDeniedPayload2("boot-simulator", policy);
  const requestedDevice = optionalString(args.device) ?? void 0;
  const device = await deps.resolveIosDevice(requestedDevice, { preferBooted: true });
  const bootResult = await deps.execFile("xcrun", ["simctl", "boot", device.udid], {
    timeout: 6e4,
    rejectOnError: false
  });
  const shouldOpen = args.openSimulator !== false;
  if (shouldOpen) {
    await deps.execFile("open", ["-a", "Simulator"], { timeout: 1e4, rejectOnError: false });
  }
  return {
    requestedDevice: requestedDevice ?? null,
    device,
    openSimulator: shouldOpen,
    stdout: truncateSubprocessOutput(bootResult.stdout),
    stderr: truncateSubprocessOutput(bootResult.stderr)
  };
}
async function launchApp(args, deps = defaultAppLifecycleDependencies) {
  const platform = platformArg(args.platform);
  const policy = await deps.policyDecision(args, "launch-app", "device");
  if (!policy.allowed) return policyDeniedPayload2("launch-app", policy);
  if (platform === "android") {
    const packageName = requireString3(args.packageName ?? args.bundleId, "packageName");
    const activity = optionalString(args.activity);
    const commandArgs2 = activity ? ["shell", "am", "start", "-n", `${packageName}/${activity}`] : ["shell", "monkey", "-p", packageName, "1"];
    const result2 = await deps.execFile("adb", androidDeviceArgs2(args.device, commandArgs2), {
      timeout: 3e4,
      rejectOnError: false
    });
    return {
      platform,
      packageName,
      stdout: truncateSubprocessOutput(result2.stdout),
      stderr: truncateSubprocessOutput(result2.stderr)
    };
  }
  const bundleId = requireString3(args.bundleId ?? args.packageName, "bundleId");
  const device = await deps.resolveIosDevice(optionalString(args.device) ?? void 0, {
    preferBooted: true
  });
  const startedAt = deps.now();
  const result = await deps.execFile("xcrun", ["simctl", "launch", device.udid, bundleId], {
    timeout: 3e4,
    rejectOnError: false
  });
  return attachIosCrashEvidence(
    {
      platform,
      device,
      bundleId,
      available: !result.error,
      stdout: truncateSubprocessOutput(result.stdout),
      stderr: truncateSubprocessOutput(result.stderr),
      error: result.error ?? null
    },
    {
      platform,
      bundleId,
      processName: args.processName,
      sinceMs: startedAt,
      waitMs: args.crashCheckMs,
      action: "launch-app"
    },
    deps
  );
}
async function terminateApp(args, deps = defaultAppLifecycleDependencies) {
  const platform = platformArg(args.platform);
  const policy = await deps.policyDecision(args, "terminate-app", "device");
  if (!policy.allowed) return policyDeniedPayload2("terminate-app", policy);
  const bundleId = await resolveBundleId(args, deps);
  if (args.dryRun === true) {
    return { available: true, dryRun: true, action: "terminate-app", platform, bundleId };
  }
  if (platform === "android") {
    const result2 = await deps.execFile(
      "adb",
      androidDeviceArgs2(args.device, ["shell", "am", "force-stop", bundleId]),
      {
        timeout: 2e4,
        rejectOnError: false
      }
    );
    return {
      available: !result2.error,
      action: "terminate-app",
      platform,
      packageName: bundleId,
      stdout: truncateSubprocessOutput(result2.stdout),
      stderr: truncateSubprocessOutput(result2.stderr),
      error: result2.error ?? null
    };
  }
  const device = await deps.resolveIosDevice(optionalString(args.device) ?? void 0, {
    preferBooted: true
  });
  const result = await deps.execFile("xcrun", ["simctl", "terminate", device.udid, bundleId], {
    timeout: 2e4,
    rejectOnError: false
  });
  return {
    available: !result.error,
    action: "terminate-app",
    platform,
    device,
    bundleId,
    stdout: truncateSubprocessOutput(result.stdout),
    stderr: truncateSubprocessOutput(result.stderr),
    error: result.error ?? null
  };
}
async function reloadApp(args, deps = defaultAppLifecycleDependencies) {
  const policy = await deps.policyDecision(args, "reload-app", "device");
  if (!policy.allowed) return policyDeniedPayload2("reload-app", policy);
  const bundleId = await resolveBundleId(args, deps);
  if (args.dryRun === true) {
    return { available: true, dryRun: true, action: "reload-app", bundleId };
  }
  const terminated = await terminateApp({ ...args, bundleId }, deps);
  const launched = await launchApp({ ...args, bundleId }, deps);
  return {
    available: launched.available === false || launched.error ? false : true,
    action: "reload-app",
    bundleId,
    strategy: "terminate-and-launch",
    terminated,
    launched
  };
}
async function attachIosCrashEvidence(payload, options, deps) {
  if (options.platform !== "ios") return payload;
  const evidence = await iosCrashEvidence(options, deps);
  const crashReports = Array.isArray(evidence.crashReports) ? evidence.crashReports : [];
  if (crashReports.length === 0) return { ...payload, ...evidence };
  return {
    ...payload,
    ...evidence,
    available: false,
    reason: `The app generated ${crashReports.length} matching iOS crash report(s) after ${String(options.action)}.`
  };
}
async function iosCrashEvidence(args, deps = defaultAppLifecycleDependencies) {
  const sinceMs = finiteNumber(args.sinceMs ?? deps.now());
  const delay = clampNumber2(args.waitMs ?? 0, 0, 3e4);
  if (delay > 0) await deps.wait(delay);
  const bundleId = optionalString(args.bundleId);
  const processName = optionalString(args.processName);
  const crashReports = await matchingIosCrashReports({ bundleId, processName, sinceMs }, deps);
  return {
    crashCheck: {
      action: String(args.action ?? "launch-app"),
      bundleId: bundleId ?? null,
      processName: processName ?? null,
      since: new Date(sinceMs).toISOString(),
      waitedMs: delay,
      reportCount: crashReports.length
    },
    crashReports
  };
}
async function matchingIosCrashReports(args, deps = defaultAppLifecycleDependencies) {
  const bundleId = optionalString(args.bundleId);
  const processName = optionalString(args.processName);
  if (!bundleId && !processName) return [];
  const reports = await deps.listDiagnosticReports();
  const sinceMs = finiteNumber(args.sinceMs ?? 0);
  const wantedProcess = processName?.toLowerCase() ?? null;
  const matches = [];
  for (const report of reports) {
    if (!report.isFile) continue;
    if (!/(\.ips|\.crash)$/.test(report.name)) continue;
    if (report.mtimeMs < sinceMs) continue;
    const metadata = parseCrashReportMetadata(report.content);
    const metadataBundle = stringFrom(metadata?.bundleID ?? metadata?.bundleId);
    const metadataName = stringFrom(metadata?.app_name ?? metadata?.name ?? metadata?.procName);
    const nameMatches = wantedProcess ? report.name.toLowerCase().includes(wantedProcess) || metadataName?.toLowerCase() === wantedProcess : false;
    if (bundleId && metadataBundle === bundleId || nameMatches) {
      matches.push({
        path: report.path,
        file: report.name,
        mtime: report.mtimeIso,
        appName: metadataName,
        bundleId: metadataBundle,
        incidentId: stringFrom(metadata?.incident_id ?? metadata?.incident)
      });
    }
  }
  return matches.sort((left, right) => String(left.path).localeCompare(String(right.path)));
}
async function installApp(args, deps = defaultAppLifecycleDependencies) {
  const platform = platformArg(args.platform);
  const appPath = resolvePath(requireString3(args.appPath, "appPath"));
  const policy = await deps.policyDecision(args, "install-app", "device");
  if (!policy.allowed) return policyDeniedPayload2("install-app", policy);
  if (args.dryRun === true) {
    return { available: true, dryRun: true, action: "install-app", platform, appPath, policy };
  }
  if (platform === "android") {
    const result2 = await deps.execFile(
      "adb",
      androidDeviceArgs2(args.device, ["install", "-r", appPath]),
      {
        timeout: 12e4,
        rejectOnError: false
      }
    );
    return {
      available: !result2.error,
      action: "install-app",
      platform,
      appPath,
      stdout: truncateSubprocessOutput(result2.stdout),
      stderr: truncateSubprocessOutput(result2.stderr),
      error: result2.error ?? null,
      policy
    };
  }
  const device = await deps.resolveIosDevice(optionalString(args.device) ?? void 0, {
    preferBooted: true
  });
  const result = await deps.execFile("xcrun", ["simctl", "install", device.udid, appPath], {
    timeout: 12e4,
    rejectOnError: false
  });
  return {
    available: !result.error,
    action: "install-app",
    platform,
    device,
    appPath,
    stdout: truncateSubprocessOutput(result.stdout),
    stderr: truncateSubprocessOutput(result.stderr),
    error: result.error ?? null,
    policy
  };
}
async function uninstallApp(args, deps = defaultAppLifecycleDependencies) {
  const platform = platformArg(args.platform);
  const policy = await deps.policyDecision(args, "uninstall-app", "device");
  if (!policy.allowed) return policyDeniedPayload2("uninstall-app", policy);
  const bundleId = await resolveBundleId(args, deps);
  if (args.dryRun === true) {
    return { available: true, dryRun: true, action: "uninstall-app", platform, bundleId, policy };
  }
  if (platform === "android") {
    const result2 = await deps.execFile(
      "adb",
      androidDeviceArgs2(args.device, ["uninstall", bundleId]),
      {
        timeout: 6e4,
        rejectOnError: false
      }
    );
    return {
      available: !result2.error,
      action: "uninstall-app",
      platform,
      packageName: bundleId,
      stdout: truncateSubprocessOutput(result2.stdout),
      stderr: truncateSubprocessOutput(result2.stderr),
      error: result2.error ?? null,
      policy
    };
  }
  const device = await deps.resolveIosDevice(optionalString(args.device) ?? void 0, {
    preferBooted: true
  });
  const result = await deps.execFile("xcrun", ["simctl", "uninstall", device.udid, bundleId], {
    timeout: 6e4,
    rejectOnError: false
  });
  return {
    available: !result.error,
    action: "uninstall-app",
    platform,
    device,
    bundleId,
    stdout: truncateSubprocessOutput(result.stdout),
    stderr: truncateSubprocessOutput(result.stderr),
    error: result.error ?? null,
    policy
  };
}
async function resolveBundleId(args, deps = defaultAppLifecycleDependencies) {
  const explicit = optionalString(args.bundleId ?? args.packageName);
  if (explicit) return explicit;
  const cwd = optionalString(args.cwd) ?? ".";
  const summary = await deps.runtimeSummary(cwd).catch(() => null);
  const inferred = optionalString(
    summary?.appConfig?.iosBundleIdentifier ?? summary?.appConfig?.androidPackage
  );
  if (!inferred) throw new Error("bundleId must be provided or inferable from Expo app config.");
  return inferred;
}
async function collectAppLogs(args, deps = defaultAppLifecycleDependencies) {
  const platform = platformArg(args.platform);
  if (platform === "android") {
    const device2 = optionalString(args.device);
    const lines = String(clampNumber2(args.lines ?? 500, 1, 5e3));
    const result2 = await deps.execFile(
      "adb",
      androidDeviceArgs2(device2, ["logcat", "-d", "-t", lines]),
      {
        timeout: 3e4,
        maxBuffer: 4 * 1024 * 1024,
        rejectOnError: false
      }
    );
    return {
      platform,
      device: device2 ?? null,
      stdout: truncateSubprocessOutput(result2.stdout),
      stderr: truncateSubprocessOutput(result2.stderr)
    };
  }
  const device = await deps.resolveIosDevice(optionalString(args.device) ?? void 0, {
    preferBooted: true
  });
  const last = optionalString(args.last) ?? "2m";
  if (!/^\d+[smhd]$/.test(last)) throw new Error("last must look like 30s, 2m, 1h, or 1d.");
  const predicate = optionalString(args.predicate) ?? iosLogPredicate(args);
  const commandArgs2 = [
    "simctl",
    "spawn",
    device.udid,
    "log",
    "show",
    "--style",
    "compact",
    "--last",
    last
  ];
  if (predicate) commandArgs2.push("--predicate", predicate);
  const result = await deps.execFile("xcrun", commandArgs2, {
    timeout: 45e3,
    maxBuffer: 5 * 1024 * 1024,
    rejectOnError: false
  });
  return {
    platform,
    device,
    last,
    predicate: predicate ?? null,
    stdout: truncateSubprocessOutput(result.stdout),
    stderr: truncateSubprocessOutput(result.stderr)
  };
}
function iosLogPredicate(args) {
  const processName = optionalString(args.processName);
  if (processName) return `process == "${escapePredicateValue(processName)}"`;
  const bundleId = optionalString(args.bundleId);
  const inferredProcess = bundleId?.split(".").filter(Boolean).at(-1);
  return inferredProcess ? `process CONTAINS "${escapePredicateValue(inferredProcess)}"` : null;
}
function defaultExecFile3(file, args, options = {}) {
  return new Promise((resolve18, reject) => {
    nodeExecFile3(
      file,
      args,
      {
        timeout: options.timeout,
        maxBuffer: options.maxBuffer ?? MAX_OUTPUT2
      },
      (error, stdout, stderr) => {
        if (error && options.rejectOnError !== false) {
          Object.assign(error, { stdout, stderr });
          reject(error);
          return;
        }
        resolve18({
          stdout: String(stdout ?? ""),
          stderr: String(stderr ?? ""),
          error: error ? { message: error.message, code: error.code, signal: error.signal } : null
        });
      }
    );
  });
}
async function defaultResolveIosDevice(requested) {
  if (requested && /^[0-9A-Fa-f-]{20,}$/.test(requested)) {
    return { udid: requested, name: requested, state: "unknown" };
  }
  const { stdout } = await defaultExecFile3(
    "xcrun",
    ["simctl", "list", "devices", "available", "--json"],
    {
      timeout: 2e4,
      maxBuffer: 4 * 1024 * 1024
    }
  );
  const parsed = JSON.parse(String(stdout ?? "{}"));
  const devices = Object.entries(parsed.devices ?? {}).flatMap(
    ([runtime2, runtimeDevices]) => (Array.isArray(runtimeDevices) ? runtimeDevices : []).map((device) => {
      const record = isRecord3(device) ? device : {};
      return {
        udid: String(record.udid ?? ""),
        name: String(record.name ?? ""),
        state: stringFrom(record.state) ?? void 0,
        runtime: runtime2,
        isAvailable: record.isAvailable === void 0 ? void 0 : Boolean(record.isAvailable)
      };
    })
  ).filter((device) => device.udid && device.name);
  if (requested) {
    const exact = devices.find((device) => device.udid === requested || device.name === requested);
    if (exact) return exact;
    const partial = devices.find(
      (device) => device.name.toLowerCase().includes(requested.toLowerCase())
    );
    if (partial) return partial;
    throw new Error(`No available iOS simulator matched: ${requested}`);
  }
  const booted = devices.find((device) => device.state === "Booted");
  if (booted) return booted;
  const iphone = [...devices].reverse().find((device) => /iPhone/.test(device.name));
  if (iphone) return iphone;
  if (devices[0]) return devices[0];
  throw new Error("No available iOS simulators found.");
}
async function defaultPolicyDecision(args, action, sideEffect) {
  const policyPath = optionalString(args.actionPolicy);
  if (!policyPath) {
    return {
      checked: true,
      action,
      sideEffect,
      allowed: false,
      source: null,
      reason: "No action policy allowed this state-changing operation."
    };
  }
  const policy = JSON.parse(await fs2.readFile(resolvePath(policyPath), "utf8"));
  const allowed = Array.isArray(policy.allow) && policy.allow.includes(action) || policy.actions?.[action] === true || policy.actions?.[action] === "allow";
  return {
    checked: true,
    action,
    sideEffect,
    allowed,
    source: resolvePath(policyPath),
    reason: allowed ? "Action allowed by policy." : "Action policy did not allow this operation."
  };
}
async function defaultRuntimeSummary(cwd) {
  const appJsonPath = resolvePath(cwd, "app.json");
  const text = await fs2.readFile(appJsonPath, "utf8").catch(() => null);
  if (!text) return null;
  const parsed = JSON.parse(text);
  const expo = isRecord3(parsed.expo) ? parsed.expo : parsed;
  const ios = isRecord3(expo.ios) ? expo.ios : {};
  const android = isRecord3(expo.android) ? expo.android : {};
  return {
    appConfig: {
      iosBundleIdentifier: stringFrom(ios.bundleIdentifier) ?? stringFrom(expo.bundleIdentifier),
      androidPackage: stringFrom(android.package) ?? stringFrom(expo.package)
    }
  };
}
async function defaultListDiagnosticReports() {
  const directory = joinPath(homedir(), "Library", "Logs", "DiagnosticReports");
  const entries = await fs2.readdir(directory, { withFileTypes: true }).catch(() => []);
  const reports = await Promise.all(
    entries.filter((entry) => entry.isFile() && /\.(ips|crash)$/.test(entry.name)).map(async (entry) => {
      const file = joinPath(directory, entry.name);
      const stat8 = await fs2.stat(file);
      return {
        name: entry.name,
        path: file,
        isFile: true,
        mtimeMs: stat8.mtimeMs,
        mtimeIso: stat8.mtime.toISOString(),
        content: await fs2.readFile(file, "utf8").catch(() => "")
      };
    })
  );
  return reports;
}
function truncateSubprocessOutput(value, limit = MAX_OUTPUT2) {
  const text = value == null ? "" : String(value);
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}
[truncated ${text.length - limit} characters]`;
}
function androidDeviceArgs2(device, args) {
  const requested = optionalString(device);
  return requested ? ["-s", requested, ...args] : args;
}
function clampNumber2(value, min, max) {
  const number = finiteNumber(value);
  return Math.min(max, Math.max(min, number));
}
function escapePredicateValue(value) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
function isRecord3(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function finiteNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`Expected a finite number, got ${String(value)}.`);
  return number;
}
function optionalString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
function platformArg(value) {
  return value === "android" ? "android" : "ios";
}
function policyDeniedPayload2(action, policy) {
  return policyDeniedPayload({ domain: "app", action, policy });
}
function parseCrashReportMetadata(content) {
  const firstLine = content.split(/\r?\n/, 1)[0]?.trim();
  if (!firstLine?.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(firstLine);
    return isRecord3(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
function requireString3(value, field) {
  const text = optionalString(value);
  if (!text) throw new Error(`${field} must be a non-empty string.`);
  return text;
}
function stringFrom(value) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

// src/core/cli-error-classification/src/main/index.ts
var EXIT_SUCCESS = 0;
var EXIT_RUNTIME_FAILURE = 1;
var EXIT_INVALID_USAGE = 2;
var CliUsageError = class extends Error {
  constructor(message) {
    super(message);
    this.exitCode = EXIT_INVALID_USAGE;
    this.name = "CliUsageError";
  }
};
function exitCodeForError(error) {
  const record = error;
  const explicitExitCode = record?.exitCode;
  if (Number.isInteger(explicitExitCode)) {
    return explicitExitCode;
  }
  const message = String(record?.message ?? "");
  if (/Unknown command|Unknown tool|requires a value|Expected a finite number|must be a non-empty string|must look like|must not contain whitespace|valid JSON|mutually exclusive/i.test(
    message
  )) {
    return EXIT_INVALID_USAGE;
  }
  return EXIT_RUNTIME_FAILURE;
}
function errorCodeForExitCode(exitCode) {
  if (exitCode === EXIT_INVALID_USAGE) return "invalid_usage";
  if (exitCode === EXIT_RUNTIME_FAILURE) return "runtime_failure";
  return "error";
}

// src/core/cli-argv-parser/src/main/index.ts
function parseCliArgs(argv) {
  const args = { _: [] };
  const globals = defaultGlobals();
  let command = null;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === void 0) continue;
    if (token === "--") {
      args._.push(...argv.slice(index + 1));
      break;
    }
    if (token === "--help" || token === "-h") {
      globals.help = true;
      continue;
    }
    if (token === "--version") {
      globals.version = true;
      continue;
    }
    if (token.startsWith("--")) {
      const eq = token.indexOf("=");
      const rawKey = eq === -1 ? token.slice(2) : token.slice(2, eq);
      const globalKey = normalizeGlobalFlag(rawKey);
      if (globalKey) {
        if (globalFlagTakesValue(rawKey)) {
          const value = eq === -1 ? argv[index + 1] : token.slice(eq + 1);
          if (value === void 0 || value.startsWith("--")) {
            throw new CliUsageError(`--${rawKey} requires a value.`);
          }
          if (eq === -1) index += 1;
          globals[globalKey] = String(value);
        } else {
          globals[globalKey] = true;
        }
        continue;
      }
      if (!command) {
        throw new CliUsageError(`Global flag or command expected before --${rawKey}.`);
      }
      const key = toCamel(rawKey);
      if (commandFlagTakesBoolean(rawKey)) {
        const explicitValue = eq === -1 ? argv[index + 1] : token.slice(eq + 1);
        if (explicitValue === "true" || explicitValue === "false") {
          if (eq === -1) index += 1;
          args[key] = explicitValue === "true";
        } else if (eq === -1) {
          args[key] = true;
        } else {
          args[key] = coerceCliValue(explicitValue);
        }
        continue;
      }
      const schemaValue = eq === -1 ? argv[index + 1] : token.slice(eq + 1);
      if (eq === -1 && (schemaValue === void 0 || schemaValue.startsWith("--"))) {
        args[key] = true;
      } else {
        if (eq === -1) index += 1;
        args[key] = coerceCliValue(String(schemaValue));
      }
      continue;
    }
    if (!command) {
      command = token;
      continue;
    }
    args._.push(token);
  }
  return { globals, command, args };
}
function defaultGlobals() {
  return {
    json: false,
    plain: false,
    quiet: false,
    verbose: false,
    debug: false,
    noColor: false,
    noInput: false,
    record: false,
    version: false,
    help: false,
    root: null,
    stateDir: null,
    actionPolicy: null,
    maxOutput: null,
    contentBoundaries: false,
    allowRuntimeEval: null,
    confirmActions: null
  };
}
function normalizeGlobalFlag(rawKey) {
  switch (rawKey) {
    case "json":
    case "plain":
    case "quiet":
    case "verbose":
    case "debug":
    case "record":
      return rawKey;
    case "content-boundaries":
      return "contentBoundaries";
    case "root":
      return "root";
    case "state-dir":
      return "stateDir";
    case "action-policy":
      return "actionPolicy";
    case "max-output":
      return "maxOutput";
    case "allow-runtime-eval":
      return "allowRuntimeEval";
    case "confirm-actions":
      return "confirmActions";
    case "no-color":
      return "noColor";
    case "no-input":
      return "noInput";
    default:
      return null;
  }
}
function globalFlagTakesValue(rawKey) {
  return rawKey === "root" || rawKey === "state-dir" || rawKey === "action-policy" || rawKey === "max-output" || rawKey === "allow-runtime-eval" || rawKey === "confirm-actions";
}
var BOOLEAN_COMMAND_FLAGS = /* @__PURE__ */ new Set([
  "added-visible-controls",
  "annotate",
  "app-ready",
  "bail",
  "bounds",
  "capture-before-after",
  "changed-chrome",
  "changed-gesture",
  "changed-navigation",
  "clear",
  "compact",
  "dry-run",
  "fix",
  "force",
  "full",
  "has-acceptance-contract",
  "has-interaction-proof",
  "has-screenshot",
  "has-static-verifier",
  "include-components",
  "include-events",
  "include-hierarchy",
  "include-image-analysis",
  "include-logs",
  "include-runtime",
  "include-screenshot",
  "include-trace",
  "interactive",
  "metro-ready",
  "no-spinner",
  "open-simulator",
  "raw",
  "restart-dev-client",
  "screenshot",
  "serve",
  "source"
]);
function commandFlagTakesBoolean(rawKey) {
  return BOOLEAN_COMMAND_FLAGS.has(rawKey);
}
function coerceCliValue(value) {
  if (value === "true") return true;
  if (value === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  return value;
}
function parseJsonArgument(value, flag) {
  try {
    return JSON.parse(value);
  } catch (error) {
    throw new Error(`${flag} must be valid JSON: ${formatError2(error)}`);
  }
}
function toCamel(value) {
  return value.replace(/-([a-z])/g, (_, char) => char.toUpperCase());
}
function formatError2(error) {
  if (!error) return "Unknown error";
  const record = error;
  return String(record.message ?? error);
}

// src/core/command-arg-projection/src/main/common.ts
function createProjectionContext(command, args, globals) {
  const cwd = args.cwd ?? globals.root;
  return {
    command,
    args,
    globals,
    cwd,
    common: {
      cwd,
      device: args.device,
      platform: args.platform,
      metroPort: args.metroPort,
      bundleId: args.bundleId,
      processName: args.processName,
      devClientUrl: args.devClientUrl,
      restartDevClient: args.restartDevClient,
      crashCheckMs: args.crashCheckMs,
      actionPolicy: args.actionPolicy ?? globals.actionPolicy
    }
  };
}
function pickDefined2(object) {
  return Object.fromEntries(Object.entries(object).filter(([, value]) => value !== void 0));
}

// src/core/command-arg-projection/src/main/projectors/core.ts
var coreCommandProjectors = {
  doctor: projectDoctorArgs,
  "project-info": projectProjectInfoArgs,
  routes: projectRoutesArgs,
  devices: projectDevicesArgs,
  session: projectSessionArgs,
  target: projectTargetArgs,
  snapshot: projectSnapshotArgs,
  refs: projectRefsArgs,
  get: projectGetArgs,
  find: projectFindArgs,
  wait: projectWaitArgs,
  batch: projectBatchArgs
};
function projectDoctorArgs({ args, cwd }) {
  return pickDefined2({ cwd, fix: args.fix });
}
function projectProjectInfoArgs({ cwd }) {
  return pickDefined2({ cwd });
}
function projectRoutesArgs({ args, cwd }) {
  return pickDefined2({ cwd, appDir: args.appDir });
}
function projectDevicesArgs({ args }) {
  return pickDefined2({ platform: args.platform, limit: args.limit });
}
function projectSessionArgs({
  args,
  globals,
  cwd
}) {
  return pickDefined2({
    action: args.action ?? args._[0],
    name: args.name ?? args._[1],
    olderThan: args.olderThan,
    cwd,
    root: globals.root,
    stateDir: globals.stateDir
  });
}
function projectTargetArgs({ args, globals, cwd }) {
  return pickDefined2({
    action: args.action ?? args._[0],
    targetId: args.targetId ?? args._[1],
    platform: args.platform,
    metroPort: args.metroPort,
    cwd,
    root: globals.root,
    stateDir: globals.stateDir
  });
}
function projectSnapshotArgs({
  args,
  globals,
  cwd
}) {
  return pickDefined2({
    interactive: args.interactive,
    compact: args.compact,
    depth: args.depth,
    source: args.source,
    bounds: args.bounds,
    metroPort: args.metroPort,
    cwd,
    root: globals.root,
    stateDir: globals.stateDir
  });
}
function projectRefsArgs({ globals, cwd }) {
  return pickDefined2({ cwd, root: globals.root, stateDir: globals.stateDir });
}
function projectGetArgs({ args, globals, cwd }) {
  return pickDefined2({
    field: args.field ?? args._[0],
    ref: args.ref ?? args._[1],
    cwd,
    root: globals.root,
    stateDir: globals.stateDir
  });
}
function projectFindArgs({ args, globals, cwd }) {
  return pickDefined2({
    kind: args.kind ?? args._[0],
    value: args.value ?? args._[1],
    action: args.action ?? args._[2],
    name: args.name ?? (args._[0] === "nth" ? args._[2] : void 0),
    text: args.text ?? args._[3],
    dryRun: args.dryRun,
    cwd,
    root: globals.root,
    stateDir: globals.stateDir
  });
}
function projectWaitArgs({ args, globals, cwd }) {
  const first = args._[0];
  return pickDefined2({
    ref: args.ref ?? (/^@e\d+$/.test(String(first ?? "")) ? first : void 0),
    ms: args.ms ?? (/^\d+$/.test(String(first ?? "")) ? Number(first) : void 0),
    state: args.state,
    text: args.text,
    route: args.route,
    metroReady: args.metroReady,
    appReady: args.appReady,
    noSpinner: args.noSpinner,
    fn: args.fn,
    allowRuntimeEval: globals.allowRuntimeEval,
    actionPolicy: args.actionPolicy ?? globals.actionPolicy,
    metroPort: args.metroPort,
    timeoutMs: args.timeoutMs,
    cwd,
    root: globals.root,
    stateDir: globals.stateDir
  });
}
function projectBatchArgs({ args, globals, cwd }) {
  return pickDefined2({
    steps: args.steps ?? args._,
    bail: args.bail,
    cwd,
    root: globals.root,
    stateDir: globals.stateDir
  });
}

// src/core/command-arg-projection/src/main/projectors/device.ts
var deviceCommandProjectors = {
  "boot-simulator": projectBootSimulatorArgs,
  "open-url": projectOpenUrlArgs,
  "launch-app": projectLaunchAppArgs,
  "terminate-app": projectAppPackageArgs,
  "reload-app": projectAppPackageArgs,
  "install-app": projectAppPackageArgs,
  "uninstall-app": projectAppPackageArgs,
  "open-dev-menu": projectOpenDevMenuArgs
};
function projectBootSimulatorArgs({
  args,
  globals
}) {
  return pickDefined2({
    device: args.device,
    openSimulator: args.openSimulator,
    actionPolicy: args.actionPolicy ?? globals.actionPolicy
  });
}
function projectOpenUrlArgs({ args, globals }) {
  return pickDefined2({
    platform: args.platform,
    device: args.device,
    url: args.url ?? args._[0],
    actionPolicy: args.actionPolicy ?? globals.actionPolicy
  });
}
function projectLaunchAppArgs({ args, common }) {
  return pickDefined2({ ...common, packageName: args.packageName, activity: args.activity });
}
function projectAppPackageArgs({
  args,
  globals,
  common
}) {
  return pickDefined2({
    ...common,
    appPath: args.appPath ?? args._[0],
    packageName: args.packageName,
    actionPolicy: args.actionPolicy ?? globals.actionPolicy,
    dryRun: args.dryRun
  });
}
function projectOpenDevMenuArgs({ common }) {
  return pickDefined2({ ...common, action: "open-dev-menu" });
}

// src/core/command-arg-projection/src/main/projectors/interaction.ts
var interactionCommandProjectors = {
  "long-press": projectRefActionArgs,
  dbltap: projectRefActionArgs,
  fill: projectRefActionArgs,
  focus: projectRefActionArgs,
  blur: projectRefActionArgs,
  select: projectRefActionArgs,
  check: projectRefActionArgs,
  uncheck: projectRefActionArgs,
  drag: projectRefActionArgs,
  scroll: projectRefActionArgs,
  "scroll-into-view": projectRefActionArgs,
  type: projectKeyboardTextAliasArgs,
  press: projectKeyboardTextAliasArgs,
  clipboard: projectClipboardKeyboardArgs,
  keyboard: projectClipboardKeyboardArgs,
  set: projectSetEnvironmentArgs,
  logs: projectLogsArgs,
  screenshot: projectScreenshotArgs,
  tap: projectTapArgs,
  gesture: projectGestureArgs,
  "open-route": projectOpenRouteArgs,
  "ux-context": projectUxContextArgs,
  "annotate-screen": projectAnnotateScreenArgs,
  inspector: projectInspectorArgs,
  "review-overlay": projectReviewOverlayArgs,
  "review-overlay-server": projectReviewOverlayArgs,
  "review-next": projectReviewNextArgs,
  trace: projectTraceArgs,
  "annotation-server": projectAnnotationServerArgs
};
function projectRefActionArgs({
  command,
  args,
  globals,
  cwd,
  common
}) {
  const first = args._[0];
  const second = args._[1];
  const third = args._[2];
  const scrollRef = command === "scroll" && /^@e\d+$/.test(String(first ?? "")) ? first : void 0;
  return pickDefined2({
    ...common,
    command,
    ref: args.ref ?? scrollRef ?? (command === "scroll" ? void 0 : first),
    targetRef: args.targetRef ?? (command === "drag" ? second : void 0),
    text: args.text ?? (command === "fill" || command === "select" ? args._[1] : void 0),
    direction: args.direction ?? (command === "scroll" ? scrollRef ? second : first : void 0),
    amount: args.amount ?? (command === "scroll" ? scrollRef ? third : second : void 0),
    durationMs: args.durationMs,
    dryRun: args.dryRun,
    cwd,
    root: globals.root,
    stateDir: globals.stateDir
  });
}
function projectKeyboardTextAliasArgs({
  command,
  args,
  common
}) {
  return pickDefined2({
    ...common,
    action: command,
    text: args.text ?? args._[0],
    key: args.key ?? args._[0],
    dryRun: args.dryRun
  });
}
function projectClipboardKeyboardArgs({
  args,
  common
}) {
  return pickDefined2({
    ...common,
    action: args.action ?? args._[0],
    text: args.text ?? args._[1],
    key: args.key ?? args._[1],
    dryRun: args.dryRun
  });
}
function projectSetEnvironmentArgs({
  args,
  globals,
  common
}) {
  return pickDefined2({
    ...common,
    domain: args.domain ?? args._[0],
    value: args.value ?? args._[1],
    extra: args.extra ?? args._.slice(2),
    actionPolicy: args.actionPolicy ?? globals.actionPolicy,
    dryRun: args.dryRun
  });
}
function projectLogsArgs({ args, common }) {
  return pickDefined2({ ...common, last: args.last, lines: args.lines, predicate: args.predicate });
}
function projectScreenshotArgs({
  args,
  globals,
  cwd
}) {
  return pickDefined2({
    platform: args.platform,
    device: args.device,
    outputPath: args.outputPath,
    annotate: args.annotate,
    full: args.full,
    fullSegments: args.fullSegments,
    cwd,
    root: globals.root,
    stateDir: globals.stateDir
  });
}
function projectTapArgs({ args, globals, cwd }) {
  return pickDefined2({
    platform: args.platform,
    device: args.device,
    x: args.x,
    y: args.y,
    ref: args.ref ?? args._[0],
    actionPolicy: args.actionPolicy ?? globals.actionPolicy,
    dryRun: args.dryRun,
    cwd,
    root: globals.root,
    stateDir: globals.stateDir
  });
}
function projectGestureArgs({
  args,
  globals,
  cwd
}) {
  return pickDefined2({
    platform: args.platform,
    device: args.device,
    gesture: args.gesture ?? args._[0],
    x: args.x,
    y: args.y,
    startX: args.startX,
    startY: args.startY,
    endX: args.endX,
    endY: args.endY,
    durationMs: args.durationMs,
    holdMs: args.holdMs,
    repeat: args.repeat,
    intervalMs: args.intervalMs,
    actionPolicy: args.actionPolicy ?? globals.actionPolicy,
    dryRun: args.dryRun,
    captureBeforeAfter: args.captureBeforeAfter,
    outputDir: args.outputDir,
    includeTrace: args.includeTrace,
    cwd,
    metroPort: args.metroPort,
    componentFilter: args.componentFilter,
    maxEvents: args.maxEvents
  });
}
function projectOpenRouteArgs({
  args,
  globals,
  cwd
}) {
  return pickDefined2({
    cwd,
    device: args.device,
    url: args.url,
    scheme: args.scheme,
    route: args.route ?? args._[0],
    query: args.query,
    authCookie: args.authCookie,
    actionPolicy: args.actionPolicy ?? globals.actionPolicy
  });
}
function projectUxContextArgs({ args, common }) {
  return pickDefined2({
    ...common,
    outputPath: args.outputPath,
    includeScreenshot: args.includeScreenshot,
    includeImageAnalysis: args.includeImageAnalysis,
    includeHierarchy: args.includeHierarchy,
    includeRuntime: args.includeRuntime,
    includeComponents: args.includeComponents,
    componentFilter: args.componentFilter,
    includeLogs: args.includeLogs,
    logsLast: args.logsLast
  });
}
function projectAnnotateScreenArgs({
  args,
  globals,
  cwd
}) {
  return pickDefined2({
    action: args.action ?? args._[0],
    cwd,
    metroPort: args.metroPort,
    outputDir: args.outputDir,
    overlayDir: args.overlayDir,
    endpointPath: args.endpointPath,
    title: args.title,
    serve: args.serve,
    port: args.port,
    force: args.force,
    confirmActions: args.confirmActions ?? globals.confirmActions
  });
}
function projectInspectorArgs({ args, cwd }) {
  return pickDefined2({
    cwd,
    device: args.device,
    metroPort: args.metroPort,
    bundleId: args.bundleId,
    devClientUrl: args.devClientUrl,
    restartDevClient: args.restartDevClient,
    action: args.action ?? args._[0],
    commentTitle: args.commentTitle,
    maxComments: args.maxComments
  });
}
function projectReviewOverlayArgs({
  command,
  args,
  cwd
}) {
  return pickDefined2({
    cwd,
    action: command === "review-overlay-server" ? "server" : args.action ?? args._[0],
    outputDir: args.outputDir,
    overlayDir: args.overlayDir,
    endpointPath: args.endpointPath,
    metroPort: args.metroPort,
    title: args.title,
    port: args.port,
    serve: args.serve,
    force: args.force
  });
}
function projectReviewNextArgs({ args, cwd }) {
  return pickDefined2({
    cwd,
    surface: args.surface,
    stage: args.stage,
    issue: args.issue ?? args._[0],
    componentFilter: args.componentFilter,
    metroPort: args.metroPort,
    verifierRule: args.verifierRule,
    hasAcceptanceContract: args.hasAcceptanceContract,
    hasScreenshot: args.hasScreenshot,
    hasInteractionProof: args.hasInteractionProof,
    hasStaticVerifier: args.hasStaticVerifier,
    changedGesture: args.changedGesture,
    changedChrome: args.changedChrome,
    changedNavigation: args.changedNavigation,
    addedVisibleControls: args.addedVisibleControls
  });
}
function projectTraceArgs({ args, cwd }) {
  return pickDefined2({
    cwd,
    metroPort: args.metroPort,
    action: args.action ?? args._[0],
    componentFilter: args.componentFilter,
    maxEvents: args.maxEvents,
    includeEvents: args.includeEvents
  });
}
function projectAnnotationServerArgs({ args }) {
  return pickDefined2({ dir: args.dir, port: args.port });
}

// src/core/command-arg-projection/src/main/projectors/maintenance.ts
var maintenanceCommandProjectors = {
  dashboard: projectDashboardArgs,
  inspect: projectInspectHighlightArgs,
  highlight: projectInspectHighlightArgs,
  review: projectReviewArgs,
  policy: projectPolicyArgs,
  redact: projectRedactArgs,
  skills: projectSkillsArgs,
  install: projectPluginLifecycleArgs,
  upgrade: projectPluginLifecycleArgs,
  release: projectReleaseArgs,
  "live-backlog": projectLiveBacklogArgs
};
function projectDashboardArgs({
  args,
  globals,
  cwd
}) {
  return pickDefined2({
    action: args.action ?? args._[0] ?? "status",
    outputPath: args.outputPath,
    port: args.port,
    cwd,
    root: globals.root,
    stateDir: globals.stateDir
  });
}
function projectInspectHighlightArgs({
  args,
  globals,
  cwd,
  common
}) {
  return pickDefined2({
    ...common,
    ref: args.ref ?? args._[0],
    durationMs: args.durationMs,
    outputPath: args.outputPath,
    cwd,
    root: globals.root,
    stateDir: globals.stateDir
  });
}
function projectReviewArgs({ args, globals, cwd }) {
  return pickDefined2({
    action: args.action ?? args._[0],
    outputPath: args.outputPath,
    cwd,
    root: globals.root,
    stateDir: globals.stateDir
  });
}
function projectPolicyArgs({ args, globals, cwd }) {
  return pickDefined2({
    action: args.action ?? args._[0],
    subject: args.subject ?? args._[1],
    name: args.name ?? args._[2],
    actionPolicy: args.actionPolicy ?? globals.actionPolicy,
    allowRuntimeEval: globals.allowRuntimeEval,
    cwd
  });
}
function projectRedactArgs({ args }) {
  return pickDefined2({ file: args.file ?? args._[0], outputPath: args.outputPath });
}
function projectSkillsArgs({ args }) {
  return pickDefined2({ action: args.action ?? args._[0] ?? "list", name: args.name ?? args._[1] });
}
function projectPluginLifecycleArgs({ args }) {
  return pickDefined2({ action: args.action ?? args._[0] ?? "check", prefix: args.prefix });
}
function projectReleaseArgs({ args, cwd }) {
  return pickDefined2({ action: args.action ?? args._[0] ?? "check", cwd });
}
function projectLiveBacklogArgs({
  args,
  globals,
  cwd
}) {
  return pickDefined2({
    action: args.action ?? args._[0] ?? "matrix",
    cwd,
    outputDir: args.outputDir,
    scope: args.scope,
    metroPort: args.metroPort,
    bundleId: args.bundleId,
    device: args.device,
    devClientUrl: args.devClientUrl,
    actionPolicy: args.actionPolicy ?? globals.actionPolicy
  });
}

// src/core/command-arg-projection/src/main/projectors/runtime-evidence.ts
var runtimeEvidenceCommandProjectors = {
  devtools: projectDevtoolsArgs,
  console: projectDiagnosticsArgs,
  errors: projectDiagnosticsArgs,
  metro: projectMetroArgs,
  navigation: projectNavigationArgs,
  network: projectNetworkArgs,
  storage: projectStorageArgs,
  state: projectStateArgs,
  controls: projectControlsArgs,
  bridge: projectBridgeArgs,
  accessibility: projectAccessibilityArgs,
  dialog: projectDialogArgs,
  sheet: projectSheetArgs,
  record: projectRecordArgs,
  diff: projectDiffArgs,
  expo: projectExpoArgs,
  rn: projectRnArgs,
  perf: projectPerfArgs,
  profiler: projectPerfArgs
};
function projectDevtoolsArgs({
  args,
  globals,
  cwd
}) {
  return pickDefined2({
    action: args.action ?? args._[0],
    subaction: args.subaction ?? (args._[0] === "events" ? args._[1] : void 0),
    metroPort: args.metroPort,
    cwd,
    root: globals.root,
    stateDir: globals.stateDir
  });
}
function projectDiagnosticsArgs({ args, cwd }) {
  return pickDefined2({
    action: args.clear === true ? "clear" : args.action ?? args._[0],
    limit: args.limit,
    metroPort: args.metroPort,
    cwd
  });
}
function projectMetroArgs({ args, cwd }) {
  return pickDefined2({
    action: args.action ?? args._[0],
    stackFile: args.stackFile ?? args.file ?? args._[1],
    metroPort: args.metroPort,
    cwd
  });
}
function projectNavigationArgs({
  args,
  globals,
  cwd
}) {
  return pickDefined2({
    action: args.action ?? args._[0],
    tab: args.tab ?? args._[1],
    route: args.route ?? (args._[0] === "deep-link" ? args._[1] : void 0),
    url: args.url,
    scheme: args.scheme,
    query: args.query,
    device: args.device,
    metroPort: args.metroPort,
    actionPolicy: args.actionPolicy ?? globals.actionPolicy,
    cwd,
    root: globals.root,
    stateDir: globals.stateDir
  });
}
function projectNetworkArgs({
  args,
  globals,
  cwd
}) {
  return pickDefined2({
    action: args.action ?? args._[0],
    harAction: args.harAction ?? (args._[0] === "har" ? args._[1] : void 0),
    requestId: args.requestId ?? (args._[0] === "request" ? args._[1] : void 0),
    outputPath: args.outputPath ?? (args._[0] === "har" && args._[1] === "stop" ? args._[2] : void 0),
    limit: args.limit,
    metroPort: args.metroPort,
    cwd,
    root: globals.root,
    stateDir: globals.stateDir
  });
}
function projectStorageArgs({
  args,
  globals,
  cwd
}) {
  return pickDefined2({
    store: args.store ?? args._[0],
    action: args.action ?? args._[1] ?? "list",
    key: args.key ?? args._[2],
    value: args.value ?? args._[3],
    limit: args.limit,
    metroPort: args.metroPort,
    actionPolicy: args.actionPolicy ?? globals.actionPolicy,
    cwd
  });
}
function projectStateArgs({ args, globals, cwd }) {
  return pickDefined2({
    action: args.action ?? args._[0] ?? "list",
    name: args.name ?? args._[1],
    metroPort: args.metroPort,
    actionPolicy: args.actionPolicy ?? globals.actionPolicy,
    cwd
  });
}
function projectControlsArgs({
  args,
  globals,
  cwd
}) {
  return pickDefined2({
    action: args.action ?? args._[0] ?? "list",
    name: args.name ?? args._[1],
    metroPort: args.metroPort,
    actionPolicy: args.actionPolicy ?? globals.actionPolicy,
    cwd
  });
}
function projectBridgeArgs({ args, globals, cwd }) {
  return pickDefined2({
    action: args.action ?? args._[0] ?? "status",
    metroPort: args.metroPort,
    domain: args.domain ?? args._[1],
    command: args.command ?? args._[2],
    actionPolicy: args.actionPolicy ?? globals.actionPolicy,
    cwd,
    confirmActions: args.confirmActions ?? globals.confirmActions
  });
}
function projectAccessibilityArgs({
  args,
  globals,
  cwd
}) {
  return pickDefined2({
    action: args.action ?? args._[0] ?? "tree",
    ref: args.ref ?? args._[1],
    device: args.device,
    metroPort: args.metroPort,
    dryRun: args.dryRun,
    cwd,
    root: globals.root,
    stateDir: globals.stateDir
  });
}
function projectDialogArgs({ args, cwd }) {
  return pickDefined2({
    action: args.action ?? args._[0] ?? "status",
    text: args.text ?? args._[1],
    metroPort: args.metroPort,
    cwd
  });
}
function projectSheetArgs({ args, cwd }) {
  return pickDefined2({
    action: args.action ?? args._[0] ?? "status",
    metroPort: args.metroPort,
    cwd
  });
}
function projectRecordArgs({ args, globals, cwd }) {
  return pickDefined2({
    action: args.action ?? args._[0] ?? "start",
    outputPath: args.outputPath ?? args._[1],
    cwd,
    root: globals.root,
    stateDir: globals.stateDir
  });
}
function projectDiffArgs({ args, globals, cwd }) {
  return pickDefined2({
    kind: args.kind ?? args._[0],
    baseline: args.baseline ?? args._[1],
    current: args.current ?? args._[2],
    routeA: args.routeA ?? (args._[0] === "route" ? args._[1] : void 0),
    routeB: args.routeB ?? (args._[0] === "route" ? args._[2] : void 0),
    screenshot: args.screenshot,
    outputPath: args.outputPath,
    cwd,
    root: globals.root,
    stateDir: globals.stateDir
  });
}
function projectExpoArgs({ args, cwd }) {
  return pickDefined2({ action: args.action ?? args._[0] ?? "modules", cwd });
}
function projectRnArgs({ args, globals, cwd }) {
  return pickDefined2({
    action: args.action ?? args._[0] ?? "tree",
    subaction: args.subaction ?? (args._[0] === "renders" ? args._[1] : void 0),
    ref: args.ref ?? (["inspect", "fiber"].includes(String(args._[0])) ? args._[1] : void 0),
    metroPort: args.metroPort,
    raw: args.raw,
    detail: args.detail,
    cwd,
    root: globals.root,
    stateDir: globals.stateDir
  });
}
function projectPerfArgs({
  command,
  args,
  globals,
  cwd
}) {
  return pickDefined2({
    action: command === "profiler" ? "ettrace" : args.action ?? args._[0] ?? "summary",
    subaction: command === "profiler" ? args.subaction ?? args.action ?? args._[0] ?? "start" : args.subaction ?? (["mark", "measure", "budget", "ettrace", "memgraph", "interaction"].includes(
      String(args._[0])
    ) ? args._[1] : void 0),
    label: args.label ?? (args._[0] === "action" ? args._[1] : ["measure", "interaction"].includes(String(args._[0])) ? args._[2] : void 0),
    interaction: args.interaction ?? (args._[0] === "report" ? args._[1] : void 0),
    bundleArtifact: args.bundleArtifact ?? (args._[0] === "bundle" ? args._[1] : void 0),
    baseline: args.baseline,
    candidate: args.candidate,
    file: args.file,
    nativeArtifact: args.nativeArtifact ?? (command === "profiler" ? args._[1] : ["ettrace", "memgraph"].includes(String(args._[0])) ? args._[2] : void 0),
    outputPath: args.outputPath,
    buildKind: args.buildKind,
    samples: args.samples,
    seconds: args.seconds,
    pid: args.pid,
    metroPort: args.metroPort,
    cwd,
    root: globals.root,
    stateDir: globals.stateDir
  });
}

// src/core/command-arg-projection/src/main/index.ts
var COMMAND_PROJECTORS = {
  ...coreCommandProjectors,
  ...deviceCommandProjectors,
  ...interactionCommandProjectors,
  ...runtimeEvidenceCommandProjectors,
  ...maintenanceCommandProjectors
};
function commandArgs(command, args, globals = {}) {
  const projector = COMMAND_PROJECTORS[command];
  return projector ? projector(createProjectionContext(command, args, globals)) : {};
}

// src/core/cli-identity/src/main/index.ts
var CURRENT_CLI_NAME = "expo98";
var COMPATIBILITY_CLI_NAME = "expo-ios";
var CLI_VERSION = "0.1.0";

// src/core/command-surface/src/main/index.ts
var COMMAND_SURFACE = [
  { command: "doctor", toolName: "doctor", handlerSymbol: "doctor", mutatesRuntime: false },
  {
    command: "project-info",
    toolName: "project_info",
    handlerSymbol: "projectInfo",
    mutatesRuntime: false
  },
  {
    command: "routes",
    toolName: "expo_router_sitemap",
    handlerSymbol: "expoRouterSitemap",
    mutatesRuntime: false
  },
  {
    command: "devices",
    toolName: "list_devices",
    handlerSymbol: "listDevices",
    mutatesRuntime: false
  },
  {
    command: "session",
    toolName: "session",
    handlerSymbol: "sessionCommand",
    mutatesRuntime: false
  },
  { command: "target", toolName: "target", handlerSymbol: "targetCommand", mutatesRuntime: false },
  {
    command: "snapshot",
    toolName: "snapshot",
    handlerSymbol: "snapshotCommand",
    mutatesRuntime: false
  },
  { command: "refs", toolName: "refs", handlerSymbol: "refsCommand", mutatesRuntime: false },
  { command: "get", toolName: "get_ref", handlerSymbol: "getRefCommand", mutatesRuntime: false },
  { command: "find", toolName: "find", handlerSymbol: "findCommand", mutatesRuntime: false },
  { command: "wait", toolName: "wait", handlerSymbol: "waitCommand", mutatesRuntime: false },
  { command: "batch", toolName: "batch", handlerSymbol: "batchCommand", mutatesRuntime: false },
  {
    command: "boot-simulator",
    toolName: "boot_simulator",
    handlerSymbol: "bootSimulator",
    mutatesRuntime: true
  },
  { command: "open-url", toolName: "open_url", handlerSymbol: "openUrl", mutatesRuntime: true },
  {
    command: "launch-app",
    toolName: "launch_app",
    handlerSymbol: "launchApp",
    mutatesRuntime: true
  },
  {
    command: "terminate-app",
    toolName: "terminate_app",
    handlerSymbol: "terminateApp",
    mutatesRuntime: true
  },
  {
    command: "reload-app",
    toolName: "reload_app",
    handlerSymbol: "reloadApp",
    mutatesRuntime: true
  },
  {
    command: "open-dev-menu",
    toolName: "runtime_inspector",
    handlerSymbol: "runtimeInspector",
    mutatesRuntime: true
  },
  {
    command: "install-app",
    toolName: "install_app",
    handlerSymbol: "installApp",
    mutatesRuntime: true
  },
  {
    command: "uninstall-app",
    toolName: "uninstall_app",
    handlerSymbol: "uninstallApp",
    mutatesRuntime: true
  },
  {
    command: "long-press",
    toolName: "ref_action",
    handlerSymbol: "refActionCommand",
    mutatesRuntime: true
  },
  {
    command: "dbltap",
    toolName: "ref_action",
    handlerSymbol: "refActionCommand",
    mutatesRuntime: true
  },
  {
    command: "fill",
    toolName: "ref_action",
    handlerSymbol: "refActionCommand",
    mutatesRuntime: true
  },
  { command: "type", toolName: "keyboard", handlerSymbol: "keyboardCommand", mutatesRuntime: true },
  {
    command: "press",
    toolName: "keyboard",
    handlerSymbol: "keyboardCommand",
    mutatesRuntime: true
  },
  {
    command: "focus",
    toolName: "ref_action",
    handlerSymbol: "refActionCommand",
    mutatesRuntime: true
  },
  {
    command: "blur",
    toolName: "ref_action",
    handlerSymbol: "refActionCommand",
    mutatesRuntime: true
  },
  {
    command: "select",
    toolName: "ref_action",
    handlerSymbol: "refActionCommand",
    mutatesRuntime: true
  },
  {
    command: "check",
    toolName: "ref_action",
    handlerSymbol: "refActionCommand",
    mutatesRuntime: true
  },
  {
    command: "uncheck",
    toolName: "ref_action",
    handlerSymbol: "refActionCommand",
    mutatesRuntime: true
  },
  {
    command: "drag",
    toolName: "ref_action",
    handlerSymbol: "refActionCommand",
    mutatesRuntime: true
  },
  {
    command: "scroll",
    toolName: "ref_action",
    handlerSymbol: "refActionCommand",
    mutatesRuntime: true
  },
  {
    command: "scroll-into-view",
    toolName: "ref_action",
    handlerSymbol: "refActionCommand",
    mutatesRuntime: true
  },
  {
    command: "clipboard",
    toolName: "clipboard",
    handlerSymbol: "clipboardCommand",
    mutatesRuntime: true
  },
  {
    command: "keyboard",
    toolName: "keyboard",
    handlerSymbol: "keyboardCommand",
    mutatesRuntime: true
  },
  {
    command: "set",
    toolName: "set_environment",
    handlerSymbol: "setEnvironmentCommand",
    mutatesRuntime: true
  },
  {
    command: "logs",
    toolName: "collect_app_logs",
    handlerSymbol: "collectAppLogs",
    mutatesRuntime: false
  },
  {
    command: "screenshot",
    toolName: "automation_take_screenshot",
    handlerSymbol: "automationTakeScreenshot",
    mutatesRuntime: false
  },
  {
    command: "tap",
    toolName: "automation_tap",
    handlerSymbol: "automationTap",
    mutatesRuntime: true
  },
  {
    command: "gesture",
    toolName: "automation_gesture",
    handlerSymbol: "automationGesture",
    mutatesRuntime: true
  },
  {
    command: "open-route",
    toolName: "open_expo_route",
    handlerSymbol: "openExpoRoute",
    mutatesRuntime: true
  },
  {
    command: "ux-context",
    toolName: "capture_ux_context",
    handlerSymbol: "captureUxContext",
    mutatesRuntime: false
  },
  {
    command: "annotate-screen",
    toolName: "annotate_screen",
    handlerSymbol: "annotateScreen",
    mutatesRuntime: false
  },
  {
    command: "inspector",
    toolName: "runtime_inspector",
    handlerSymbol: "runtimeInspector",
    mutatesRuntime: false
  },
  {
    command: "review-overlay",
    toolName: "review_overlay",
    handlerSymbol: "reviewOverlay",
    mutatesRuntime: false
  },
  {
    command: "review-overlay-server",
    toolName: "review_overlay",
    handlerSymbol: "reviewOverlay",
    mutatesRuntime: false
  },
  {
    command: "review-next",
    toolName: "review_next_step",
    handlerSymbol: "reviewNextStep",
    mutatesRuntime: false
  },
  {
    command: "annotation-server",
    toolName: "annotation_server",
    handlerSymbol: "removedAnnotationServerCommand",
    mutatesRuntime: false
  },
  {
    command: "devtools",
    toolName: "devtools",
    handlerSymbol: "devtoolsCommand",
    mutatesRuntime: false
  },
  {
    command: "console",
    toolName: "console",
    handlerSymbol: "consoleCommand",
    mutatesRuntime: false
  },
  { command: "errors", toolName: "errors", handlerSymbol: "errorsCommand", mutatesRuntime: false },
  { command: "metro", toolName: "metro", handlerSymbol: "metroCommand", mutatesRuntime: false },
  { command: "profiler", toolName: "perf", handlerSymbol: "perfCommand", mutatesRuntime: false },
  {
    command: "navigation",
    toolName: "navigation",
    handlerSymbol: "navigationCommand",
    mutatesRuntime: true
  },
  {
    command: "network",
    toolName: "network",
    handlerSymbol: "networkCommand",
    mutatesRuntime: false
  },
  {
    command: "storage",
    toolName: "storage",
    handlerSymbol: "storageCommand",
    mutatesRuntime: true
  },
  { command: "state", toolName: "state", handlerSymbol: "stateCommand", mutatesRuntime: true },
  {
    command: "controls",
    toolName: "controls",
    handlerSymbol: "controlsCommand",
    mutatesRuntime: true
  },
  { command: "bridge", toolName: "bridge", handlerSymbol: "bridgeCommand", mutatesRuntime: false },
  {
    command: "accessibility",
    toolName: "accessibility",
    handlerSymbol: "accessibilityCommand",
    mutatesRuntime: false
  },
  { command: "dialog", toolName: "dialog", handlerSymbol: "dialogCommand", mutatesRuntime: true },
  { command: "sheet", toolName: "sheet", handlerSymbol: "sheetCommand", mutatesRuntime: true },
  { command: "record", toolName: "record", handlerSymbol: "recordCommand", mutatesRuntime: false },
  { command: "diff", toolName: "diff", handlerSymbol: "diffCommand", mutatesRuntime: false },
  {
    command: "inspect",
    toolName: "debug_inspect",
    handlerSymbol: "debugInspectCommand",
    mutatesRuntime: false
  },
  {
    command: "highlight",
    toolName: "highlight",
    handlerSymbol: "highlightCommand",
    mutatesRuntime: false
  },
  { command: "expo", toolName: "expo", handlerSymbol: "expoCommand", mutatesRuntime: false },
  { command: "rn", toolName: "rn", handlerSymbol: "rnCommand", mutatesRuntime: false },
  { command: "perf", toolName: "perf", handlerSymbol: "perfCommand", mutatesRuntime: false },
  {
    command: "dashboard",
    toolName: "dashboard",
    handlerSymbol: "dashboardCommand",
    mutatesRuntime: false
  },
  { command: "review", toolName: "review", handlerSymbol: "reviewCommand", mutatesRuntime: false },
  { command: "policy", toolName: "policy", handlerSymbol: "policyCommand", mutatesRuntime: false },
  { command: "redact", toolName: "redact", handlerSymbol: "redactCommand", mutatesRuntime: false },
  { command: "skills", toolName: "skills", handlerSymbol: "skillsCommand", mutatesRuntime: false },
  {
    command: "install",
    toolName: "install",
    handlerSymbol: "installCommand",
    mutatesRuntime: false
  },
  {
    command: "upgrade",
    toolName: "upgrade",
    handlerSymbol: "upgradeCommand",
    mutatesRuntime: false
  },
  {
    command: "release",
    toolName: "release",
    handlerSymbol: "releaseCommand",
    mutatesRuntime: false
  },
  {
    command: "live-backlog",
    toolName: "live_backlog",
    handlerSymbol: "liveBacklogCommand",
    mutatesRuntime: false
  },
  {
    command: "trace",
    toolName: "trace_interaction",
    handlerSymbol: "traceInteraction",
    mutatesRuntime: false
  }
];
var COMMAND_ALIASES = Object.freeze(
  Object.fromEntries(COMMAND_SURFACE.map((entry) => [entry.command, entry.toolName]))
);
var TOOL_HANDLER_BINDINGS = COMMAND_SURFACE.filter(
  (entry, index, entries) => entries.findIndex((candidate) => candidate.toolName === entry.toolName) === index
).map(
  (entry) => [entry.toolName, entry.handlerSymbol]
);
function commandAliases() {
  return { ...COMMAND_ALIASES };
}
function manipulatingCommandNames() {
  return COMMAND_SURFACE.filter((entry) => entry.mutatesRuntime).map((entry) => entry.command);
}
var GLOBAL_FLAGS = [
  "--json                 Write { ok, data } JSON to stdout",
  "--plain                Write stable line-oriented output to stdout",
  "--quiet                Suppress non-essential human output",
  "--version              Print CLI version",
  "--root <dir>           Default project root for commands that accept --cwd",
  "--state-dir <dir>      Persist a run record JSON file in this directory",
  "--action-policy <path> Permit gated write/device actions from a JSON policy",
  "--max-output <chars>   Truncate stdout payloads after this many characters",
  "--content-boundaries   Wrap stdout data in an explicit untrusted-output boundary",
  "--allow-runtime-eval <true|false>",
  "                       Permit gated Hermes Runtime.evaluate predicates",
  "--confirm-actions <list>",
  "                       Reserved for interactive confirmations; noninteractive runs deny",
  "--record               Persist a run record under <root>/.scratch/expo98/runs",
  "--debug                Include debug fields in machine-readable errors",
  "--no-color             Disable color; output is uncolored by default",
  "--no-input             Reserved for noninteractive safety; this CLI never prompts"
];
var DISCOVERY_COMMANDS = [
  "doctor                 Check local tool availability and project context",
  "project-info           Inspect Expo dependencies and app config",
  "routes                 List Expo Router routes",
  "devices                List iOS simulators and Android devices",
  "session new [name]     Create an evidence session and artifact namespace",
  "target list            List stable simulator/app/Metro target handles",
  "target select <id>     Store the active target on the latest session",
  "target current         Show the selected target for the latest session",
  "snapshot               Capture semantic UI refs for the selected target",
  "refs                   List cached refs from the latest snapshot",
  "get <field> <ref>      Inspect one cached ref field",
  "find <kind> <value>     Locate cached semantic refs and optionally plan an action",
  "wait                   Wait for cached text or ref state evidence",
  "batch                  Run multiple expo98 command steps in one process"
];
var SIMULATOR_AND_APP_COMMANDS = [
  "boot-simulator         Boot an iOS simulator",
  "open-url <url>         Open a URL/deep link",
  "launch-app             Launch an installed app",
  "terminate-app          Terminate an installed app",
  "reload-app             Relaunch an app as a practical JS reload fallback",
  "open-dev-menu          Open the React Native dev menu on the simulator",
  "install-app            Install an .app/.ipa with an action policy",
  "uninstall-app          Uninstall an app with an action policy",
  "open-route [route]     Open an Expo Router route",
  "screenshot             Capture a simulator/device screenshot",
  "tap                    Tap device coordinates",
  "fill/press/type        Act on focused input or cached semantic refs",
  "long-press/dbltap      Run semantic ref gestures from cached bounds",
  "scroll/drag            Run semantic ref or coordinate gestures",
  "clipboard              Read, write, or paste simulator clipboard text",
  "keyboard               Type text or press a key through local tooling",
  "set                    Mutate explicit simulator environment settings",
  "gesture                Run tap, long-press, drag, or swipe gesture evidence"
];
var EVIDENCE_AND_RUNTIME_COMMANDS = [
  "logs                   Collect recent app/device logs",
  "ux-context             Capture screenshot, route, runtime, hierarchy, and log context",
  "annotate-screen        Prepare/read an in-app annotation overlay",
  "inspector              Toggle RN inspector and install/read simulator comments",
  "review-overlay         Scaffold/run an in-app Codex review overlay",
  "review-next            Suggest the next constraint-focused UI review step",
  "devtools capabilities  Report structured DevTools capability records",
  "console                Read bounded JS console diagnostics",
  "errors                 Read bounded JS error diagnostics",
  "metro status           Report Metro status, targets, and symbolication",
  "navigation             Read or drive app navigation bridge state",
  "network                Read metadata-only app network evidence, waterfall, and redacted HAR",
  "storage                Read or mutate app storage through policy gates",
  "state                  List/save/load/clear app state snapshots",
  "controls               List, inspect, or press app-defined controls",
  "bridge                 Plan/check dev-only app bridge install, health, and domains",
  "accessibility          Capture native accessibility tree/audit evidence",
  "dialog                 Report or act on visible dialog blockers",
  "sheet                  Report or dismiss visible sheet/modal blockers",
  "record                 Create recording evidence artifacts",
  "diff                   Write snapshot or screenshot diff artifacts",
  "expo                   Inspect Expo modules, config, doctor, upstream policy, and prebuild risk",
  "rn                     Inspect React Native tree, refs, renders, and fiber evidence",
  "perf                   Measure summary, interaction, report, frame, native, and bundle evidence",
  "dashboard              Start, stop, or report local session observability",
  "skills                 List or print bundled companion skill guidance",
  "install                Check local install target paths",
  "upgrade                Check local upgrade status",
  "release                Run local release packaging checks",
  "live-backlog           Generate or run the source-derived live backlog",
  "trace                  Start/read/stop/clear a Hermes interaction trace",
  "profiler start|stop    Native profiler evidence boundary alias for perf ettrace",
  "inspect <ref>          Inspect cached source/props/bounds plus Metro target status",
  "highlight <ref>        Write a bounded highlight evidence overlay",
  "review report|matrix   Assemble captured evidence into review artifacts",
  "policy show|check      Explain or evaluate action-policy decisions",
  "redact <file>          Redact secrets from a JSON/text file"
];
var EXAMPLES = [
  "expo98 --json doctor",
  "expo98 --json session new review",
  "expo98 --json target list",
  "expo98 --json snapshot --interactive --source --bounds",
  "expo98 --json get source @e1",
  "expo98 --json find role button --name Add tap",
  "expo98 --json wait --text Customers",
  "expo98 --json wait @e1 --state visible",
  `expo98 --json batch '["wait","--text","Customers"]' '["get","source","@e1"]' --bail true`,
  "expo98 --json screenshot --annotate",
  "expo98 --json open-route /customers --cwd apps/mobile --scheme myapp --action-policy expo98.policy.json",
  "expo98 --json annotate-screen prepare --cwd apps/mobile --serve true",
  "expo98 --json inspector probe --metro-port 8081",
  "expo98 --json inspector install-comment-menu --metro-port 8081",
  "expo98 --json inspector open-dev-menu",
  "expo98 --json terminate-app --bundle-id com.example.app",
  "expo98 --json reload-app --bundle-id com.example.app",
  'expo98 --json fill @e1 "hello"',
  "expo98 --json clipboard read",
  "expo98 --json set appearance dark --action-policy expo98.policy.json",
  "expo98 --json review-overlay scaffold --cwd apps/mobile",
  "expo98 --json review-overlay prepare --cwd apps/mobile --serve true",
  'expo98 --json review-next --surface calendar --stage pre-patch --issue "drag creates scroll conflict"',
  "expo98 --json devtools capabilities --metro-port 8081",
  "expo98 --json expo upstream-policy --cwd apps/mobile",
  "expo98 --json console --limit 50 --metro-port 8081",
  "expo98 --json errors --limit 50 --metro-port 8081",
  "expo98 --json metro status --metro-port 8081",
  "expo98 --json navigation state --metro-port 8081",
  "expo98 --json navigation deep-link /customers --scheme myapp",
  "expo98 --json network requests --metro-port 8081",
  "expo98 --json network waterfall --metro-port 8081",
  "expo98 --json network har stop network.har --metro-port 8081",
  "expo98 --json storage async list --metro-port 8081",
  "expo98 --json controls list --metro-port 8081",
  "expo98 --json bridge plan --cwd apps/mobile",
  "expo98 --json bridge health --cwd apps/mobile --metro-port 8081",
  "expo98 --json bridge domains storage set --cwd apps/mobile --metro-port 8081",
  "expo98 --json accessibility tree",
  "expo98 --json dialog status --metro-port 8081",
  "expo98 --json diff snapshot --baseline before.json",
  "expo98 --json expo modules --cwd apps/mobile",
  "expo98 --json rn tree --metro-port 8081",
  "expo98 --json rn renders read --metro-port 8081",
  "expo98 --json rn inspect @e1",
  "expo98 --json perf summary --metro-port 8081",
  'expo98 --json perf interaction start "tab-customers" --metro-port 8081',
  'expo98 --json perf interaction stop "tab-customers" --metro-port 8081',
  'expo98 --json perf report "tab-customers" --metro-port 8081 --native-artifact sample.txt',
  'expo98 --json perf action "open customer" --metro-port 8081',
  "expo98 --json perf bundle dist/index.ios.bundle",
  "expo98 --json perf compare --baseline before.json --candidate after.json",
  "expo98 --json perf budget check --file expo98.perf.json --candidate after.json",
  "expo98 --json perf memgraph capture heap.memgraph",
  "expo98 --json profiler start",
  "expo98 --json inspect @e1",
  "expo98 --json policy check action uninstall-app --action-policy expo98.policy.json",
  "expo98 --json redact run-record.json --output-path run-record.redacted.json",
  "expo98 --json dashboard start",
  "expo98 --json skills get expo98-cli",
  "expo98 --json release check",
  "expo98 --json gesture long-press --x 160 --y 720 --duration-ms 900 --dry-run true",
  "expo98 --json live-backlog matrix --cwd apps/mobile",
  "expo98 --json trace --action read --metro-port 8081"
];

// src/core/policy-redaction/src/main/redactor.ts
var SECRET_KEY_PATTERN = /token|authorization|cookie|password|secret|apikey|apiKey/i;
var URL_QUERY_SECRET_PATTERN = /([?&](cookie|token|authorization|password|secret)=)[^&]+/gi;
var FREEFORM_SECRET_PATTERN = /\b(token|authorization|password|secret)=([^\s&]+)/gi;
var BEARER_SECRET_PATTERN = /(authorization=\[redacted\]\s+)[^\s&]+/gi;
function redactJson(value, key = "") {
  if (typeof value === "string") {
    if (isSecretKey(key)) {
      return REDACTED;
    }
    return redactText(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactJson(item, key));
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value).map(([childKey, childValue]) => [
      childKey,
      isSecretKey(childKey) ? REDACTED : redactJson(childValue, childKey)
    ])
  );
}
function redactText(value) {
  return String(value ?? "").replace(URL_QUERY_SECRET_PATTERN, `$1${REDACTED}`).replace(FREEFORM_SECRET_PATTERN, `$1=${REDACTED}`).replace(BEARER_SECRET_PATTERN, `$1${REDACTED}`);
}
function redactValue(value, key = "") {
  if (typeof value === "string") {
    return isSecretKey(key) ? REDACTED : redactText(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, key));
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value).map(([childKey, childValue]) => [
      childKey,
      isSecretKey(childKey) ? REDACTED : redactValue(childValue, childKey)
    ])
  );
}
function sanitizeErrorMessage(message) {
  return redactText(String(message ?? ""));
}
function formatError3(error, limit = 4e4) {
  if (!error) return "Unknown error";
  const record = error;
  const parts = [record.message ?? String(error)];
  if (record.stdout) parts.push(`stdout:
${truncateOutput(record.stdout, limit)}`);
  if (record.stderr) parts.push(`stderr:
${truncateOutput(record.stderr, limit)}`);
  return parts.join("\n\n");
}
function truncateOutput(value, limit = 4e4) {
  const text = String(value ?? "");
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}
[truncated ${text.length - limit} characters]`;
}
function isSecretKey(key) {
  return SECRET_KEY_PATTERN.test(key);
}

// src/core/command-dispatch-envelope/src/main/index.ts
var CLI_NAME = CURRENT_CLI_NAME;
async function dispatchCommand(parsed, dependencies) {
  const { globals, command, args } = parsed;
  const stdout = dependencies.stdout ?? (() => {
  });
  const stderr = dependencies.stderr ?? (() => {
  });
  if (globals.json && globals.plain) {
    throw new CliUsageError("--json and --plain are mutually exclusive.");
  }
  if (globals.version) {
    stdout(`${dependencies.cliVersion ?? CLI_VERSION}
`);
    return EXIT_SUCCESS;
  }
  if (globals.help || !command || command === "help" || args.help) {
    stdout(dependencies.printHelp ? dependencies.printHelp() : "");
    return EXIT_SUCCESS;
  }
  const toolName = COMMAND_ALIASES[command];
  if (!toolName) {
    throw new CliUsageError(`Unknown command: ${command}`);
  }
  const effectiveArgs = dependencies.projectArgs ? dependencies.projectArgs(command, args, globals) : pickDefined3({ ...args });
  const recorder = await (dependencies.startRunRecord ? dependencies.startRunRecord({ command, args: effectiveArgs, globals }) : noopRecorder());
  try {
    const payload = await runToolAndEmitPayload(toolName, effectiveArgs, {
      handlers: dependencies.handlers,
      command,
      globals,
      stdout
    });
    await recorder.finish({ status: "completed", exitCode: EXIT_SUCCESS, payload });
    if (globals.debug && recorder.path) {
      stderr(`run-record: ${recorder.path}
`);
    }
    return EXIT_SUCCESS;
  } catch (error) {
    const exitCode = exitCodeForError(error);
    await recorder.finish({ status: "failed", exitCode, error });
    if (globals.debug && recorder.path) {
      stderr(`run-record: ${recorder.path}
`);
    }
    throw error;
  }
}
async function runToolAndEmitPayload(toolName, args, options) {
  const handler = options.handlers[toolName];
  if (!handler) {
    throw new CliUsageError(`Unknown tool: ${toolName}`);
  }
  const result = await handler(args);
  const payload = unwrapToolJson(result);
  const redactedPayload = redactValue(payload);
  if (!options.silent) {
    const text = formatCliPayload(redactedPayload, options);
    if (text !== null) {
      (options.stdout ?? (() => {
      }))(text);
    }
  }
  return redactedPayload;
}
function formatCliPayload(payload, options) {
  const globals = options.globals;
  if (globals.quiet && !globals.json) {
    return null;
  }
  const maybeBoundedPayload = globals.contentBoundaries === true ? { contentBoundary: "expo98-untrusted-output", payload } : payload;
  if (globals.json) {
    return boundOutput(
      `${JSON.stringify({ ok: true, data: maybeBoundedPayload }, null, 2)}
`,
      globals
    );
  }
  if (globals.plain) {
    return boundOutput(
      `${plainPayload(options.command, maybeBoundedPayload).join("\n")}
`,
      globals
    );
  }
  return boundOutput(`${JSON.stringify(maybeBoundedPayload, null, 2)}
`, globals);
}
function boundOutput(text, globals = { maxOutput: null }) {
  if (globals.maxOutput === null || globals.maxOutput === void 0) {
    return text;
  }
  const max = clampNumber3(globals.maxOutput, 1, 1e7);
  if (text.length <= max) {
    return text;
  }
  const suffix = "\n[expo98 output truncated by --max-output]\n";
  return `${text.slice(0, Math.max(0, max - suffix.length))}${suffix}`;
}
function formatCliError(error, options) {
  if (options.quiet && !options.json) {
    return null;
  }
  const exitCode = exitCodeForError(error);
  const payload = {
    ok: false,
    error: {
      code: errorCodeForExitCode(exitCode),
      message: sanitizeErrorMessage(formatError3(error)),
      exitCode
    }
  };
  if (options.debug) {
    payload.error.name = error?.name ?? "Error";
  }
  if (options.json || options.plain !== true) {
    return `${JSON.stringify(payload, null, 2)}
`;
  }
  return `error: ${payload.error.message}
`;
}
function plainPayload(command, payload) {
  const lines = ["ok: true", `command: ${command}`];
  if (command === "doctor") {
    lines.push(`cli: ${payload.cli?.name ?? CLI_NAME} ${payload.cli?.version ?? CLI_VERSION}`);
    lines.push(`cwd: ${payload.cwd ?? ""}`);
    lines.push(`ios-simulator: ${payload.capabilities?.iosSimulator ? "yes" : "no"}`);
    lines.push(`expo-cli: ${payload.capabilities?.expoCli ? "yes" : "no"}`);
    return lines;
  }
  if (command === "routes") {
    lines.push(`routes: ${payload.routeCount ?? payload.routes?.length ?? 0}`);
    for (const route of payload.routes ?? []) {
      lines.push(`route: ${route.route} ${route.file}`);
    }
    return lines;
  }
  if (command === "review-next") {
    lines.push(`toc-step: ${payload.constraint?.tocStep ?? ""}`);
    lines.push(`next: ${payload.nextStep ?? ""}`);
    for (const suggested of payload.suggestedCommands ?? []) {
      lines.push(`suggested-command: ${suggested}`);
    }
    return lines;
  }
  if (payload.available === false && payload.reason) {
    lines.push("available: false");
    lines.push(`reason: ${payload.reason}`);
    return lines;
  }
  lines.push(`data: ${JSON.stringify(payload)}`);
  return lines;
}
function clampNumber3(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new Error(`Expected a finite number, got ${value}.`);
  }
  return Math.min(Math.max(number, min), max);
}
function pickDefined3(object) {
  return Object.fromEntries(Object.entries(object).filter(([, value]) => value !== void 0));
}
function noopRecorder() {
  return { path: null, async finish() {
  } };
}

// src/commands/batch-orchestration/src/main/batch.ts
import { execFile as nodeExecFile4 } from "node:child_process";

// src/commands/batch-orchestration/src/main/errors.ts
var MAX_OUTPUT3 = 4e4;
function batchStepError(error) {
  const exitCode = exitCodeForError(error);
  return {
    code: errorCodeForExitCode(exitCode),
    message: sanitizeErrorMessage(formatError3(error)),
    exitCode
  };
}
function truncate3(value, limit = MAX_OUTPUT3) {
  return truncateOutput(value, limit);
}

// src/commands/batch-orchestration/src/main/batch.ts
async function batchCommand(args, deps = defaultBatchDependencies) {
  const steps = normalizeBatchSteps(args.steps ?? []);
  const bail = args.bail === true;
  const results = [];
  let failureIndex = null;
  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index];
    if (!step) continue;
    try {
      const result = await runBatchStep(step, args, deps);
      results.push({ index, command: result.command, ok: true, data: result.data });
    } catch (error) {
      if (failureIndex === null) failureIndex = index;
      results.push({
        index,
        command: Array.isArray(step) ? step[0] ?? null : null,
        ok: false,
        error: batchStepError(error)
      });
      if (bail) break;
    }
  }
  return toolJson({
    ok: failureIndex === null,
    bail,
    failureIndex,
    steps: results
  });
}
var defaultBatchDependencies = {
  runToolAndEmitPayload: runToolViaCli
};
function normalizeBatchSteps(steps) {
  if (!Array.isArray(steps)) {
    throw new CliUsageError("batch requires one or more command steps.");
  }
  return steps.map((step, index) => {
    const parsed = typeof step === "string" ? parseJsonArgument(step, `step ${index + 1}`) : step;
    if (!Array.isArray(parsed) || parsed.length === 0) {
      throw new CliUsageError(`batch step ${index + 1} must be a non-empty argv array.`);
    }
    return parsed.map((part) => String(part));
  });
}
async function runBatchStep(step, batchArgs, deps) {
  const parsed = parseCliArgs(step);
  const { command, args, globals } = parsed;
  if (!command) throw new CliUsageError("Batch step is missing a command.");
  const aliases = commandAliases();
  const toolName = aliases[command];
  if (!toolName) throw new CliUsageError(`Unknown command: ${command}`);
  const mergedGlobals = {
    ...globals,
    json: true,
    plain: false,
    quiet: true,
    root: globals.root ?? batchArgs.root ?? null,
    stateDir: globals.stateDir ?? batchArgs.stateDir ?? null
  };
  const effectiveArgs = commandArgs(command, args, mergedGlobals);
  const result = await deps.runToolAndEmitPayload(toolName, effectiveArgs, {
    command,
    globals: mergedGlobals,
    silent: true
  });
  return { command, data: redactValue(unwrapToolJson(result)) };
}
async function runToolViaCli(_toolName, args, options) {
  const cliPath = process.argv[1];
  if (!cliPath) {
    throw new Error("batch requires a CLI entrypoint to run steps.");
  }
  const argv = cliArgv(options.command, args, options.globals);
  const result = await execFile(process.execPath, [cliPath, ...argv], {
    timeout: 12e4,
    rejectOnError: false
  });
  if (result.error) {
    const message = [result.error.message, result.stderr].filter(Boolean).join("\n");
    throw new Error(message || `Batch step failed: ${options.command}`);
  }
  const parsed = parseCliJson(result.stdout);
  return parsed && typeof parsed === "object" && "data" in parsed ? parsed.data : parsed;
}
function cliArgv(command, args, globals) {
  const argv = ["--json", "--quiet"];
  if (typeof globals.root === "string" && globals.root) argv.push("--root", globals.root);
  if (typeof globals.stateDir === "string" && globals.stateDir)
    argv.push("--state-dir", globals.stateDir);
  argv.push(command);
  for (const [key, value] of Object.entries(args)) {
    if (value === void 0 || value === null || key === "root" || key === "stateDir") continue;
    const flag = `--${kebabCase(key)}`;
    if (value === true) {
      argv.push(flag);
    } else {
      argv.push(flag, typeof value === "object" ? JSON.stringify(value) : String(value));
    }
  }
  return argv;
}
function parseCliJson(stdout) {
  const text = stdout.trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (error) {
    const snippet = truncate3(text, 4e3);
    throw new Error(`Batch child process returned invalid JSON on stdout: ${snippet}`, {
      cause: error
    });
  }
}
function execFile(file, args, options) {
  return new Promise((resolve18) => {
    nodeExecFile4(file, args, { timeout: options.timeout }, (error, stdout, stderr) => {
      resolve18({
        stdout: String(stdout ?? ""),
        stderr: String(stderr ?? ""),
        error
      });
    });
  });
}
function kebabCase(value) {
  return value.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`);
}

// src/commands/bridge-command-adapter/src/main/index.ts
import { promises as fs3 } from "node:fs";
import path5 from "node:path";
var EXPO98_BRIDGE_VERSION = "1.0.0";
var BRIDGE_SCHEMA_VERSION = 1;
var BRIDGE_DIR = ".expo98";
var LEGACY_BRIDGE_DIR = ".expo-ios";
var BRIDGE_SOURCE_FILE = "expo98-devtools-bridge.ts";
var LEGACY_BRIDGE_SOURCE_FILE = "expo-ios-devtools-bridge.ts";
async function bridgeCommand(args = {}, dependencies = {}) {
  const action = requireBridgeAction(args.action ?? "status");
  const io = bridgeCommandIo(dependencies);
  const cwd = await resolveProjectCwd(args.cwd, io);
  const status = await bridgeInstallStatus(cwd, io);
  const plan = bridgeInstallPlan(status);
  if (action === "status") return toolJson({ available: true, action, ...status });
  if (action === "plan")
    return toolJson({
      available: true,
      action,
      status: status.state,
      projectRoot: status.projectRoot,
      plan
    });
  if (action === "health" || action === "domains") {
    return toolJson(await io.bridgeHealthPayload(args, { action, status, plan }));
  }
  const permission = action === "install" ? "bridge-install" : "bridge-remove";
  if (!hasExplicitConfirmation2(args.confirmActions, permission)) {
    return toolJson({
      available: false,
      action,
      status: status.state,
      projectRoot: status.projectRoot,
      reason: `Refusing to mutate app files without explicit --confirm-actions ${permission}.`,
      requiredConfirmation: permission,
      plan
    });
  }
  if (action === "install") {
    await io.mkdir(io.joinPath(cwd, BRIDGE_DIR), { recursive: true });
    await io.mkdir(io.joinPath(cwd, "src"), { recursive: true });
    await io.writeJsonFile(io.joinPath(cwd, BRIDGE_DIR, "bridge.json"), bridgeMetadata());
    await io.writeFile(io.joinPath(cwd, "src", BRIDGE_SOURCE_FILE), bridgeSource(), "utf8");
    return toolJson({
      available: true,
      action,
      projectRoot: cwd,
      installed: true,
      status: (await bridgeInstallStatus(cwd, io)).state,
      plan
    });
  }
  await removeIgnoringErrors(io, io.joinPath(cwd, BRIDGE_DIR, "bridge.json"));
  await removeIgnoringErrors(io, io.joinPath(cwd, LEGACY_BRIDGE_DIR, "bridge.json"));
  await removeIgnoringErrors(io, io.joinPath(cwd, "src", BRIDGE_SOURCE_FILE));
  await removeIgnoringErrors(io, io.joinPath(cwd, "src", LEGACY_BRIDGE_SOURCE_FILE));
  return toolJson({
    available: true,
    action,
    projectRoot: cwd,
    removed: true,
    status: (await bridgeInstallStatus(cwd, io)).state,
    plan
  });
}
async function bridgeInstallStatus(projectRoot, dependencies = {}) {
  const io = bridgeCommandIo(dependencies);
  const packageJsonPath = io.joinPath(projectRoot, "package.json");
  const packageJson = await readJsonOrNull(io.readJsonFile, packageJsonPath);
  const deps = packageJson ? dependencyMap(packageJson) : {};
  const metadataPath = io.joinPath(projectRoot, BRIDGE_DIR, "bridge.json");
  const sourcePath = io.joinPath(projectRoot, "src", BRIDGE_SOURCE_FILE);
  const legacyMetadataPath = io.joinPath(projectRoot, LEGACY_BRIDGE_DIR, "bridge.json");
  const legacySourcePath = io.joinPath(projectRoot, "src", LEGACY_BRIDGE_SOURCE_FILE);
  const metadata = await readJsonOrNull(io.readJsonFile, metadataPath) ?? await readJsonOrNull(io.readJsonFile, legacyMetadataPath);
  const sourceExists = await Promise.resolve(io.pathExists(sourcePath)) || await Promise.resolve(io.pathExists(legacySourcePath));
  const hasExpo = typeof deps.expo === "string";
  const rozenitePackages = Object.keys(deps).filter((name) => name === "rozenite" || name.startsWith("@rozenite/")).sort();
  let state = "absent";
  const issues = [];
  if (!hasExpo) {
    state = "incompatible";
    issues.push({
      code: "missing-expo",
      message: "The project does not declare expo, so an Expo DevTools bridge cannot be installed safely."
    });
  } else if (metadata || sourceExists) {
    if (!metadata || !sourceExists) {
      state = "stale";
      issues.push({
        code: "partial-install",
        message: "Bridge metadata and source file are not both present."
      });
    } else if (metadataProperty(metadata, "bridgeVersion") !== EXPO98_BRIDGE_VERSION || metadataProperty(metadata, "schemaVersion") !== BRIDGE_SCHEMA_VERSION) {
      state = "stale";
      issues.push({
        code: "version-mismatch",
        message: `Bridge version ${String(metadataProperty(metadata, "bridgeVersion") ?? "unknown")} does not match ${EXPO98_BRIDGE_VERSION}.`
      });
    } else if (metadataProperty(metadata, "developmentOnly") !== true) {
      state = "incompatible";
      issues.push({
        code: "not-development-only",
        message: "Bridge metadata must declare developmentOnly: true."
      });
    } else {
      state = "present";
    }
  }
  return {
    projectRoot,
    state,
    bridgeVersion: metadataProperty(metadata, "bridgeVersion") ?? null,
    expectedBridgeVersion: EXPO98_BRIDGE_VERSION,
    developmentOnly: metadataProperty(metadata, "developmentOnly") === true,
    metadataPath,
    sourcePath,
    files: { metadata: Boolean(metadata), source: sourceExists },
    dependencies: {
      expo: deps.expo ?? null,
      rozenite: rozenitePackages.map((name) => ({ name, version: deps[name] }))
    },
    issues
  };
}
function bridgeInstallPlan(status) {
  return {
    permissionRequired: true,
    requiredConfirmations: ["bridge-install", "bridge-remove"],
    developmentOnly: true,
    productionExclusion: [
      "Bridge code must be imported only from development-only app entrypoints or guarded by __DEV__.",
      `Production/release builds must not import src/${BRIDGE_SOURCE_FILE}.`
    ],
    filesToAddOrChange: [
      {
        path: status.metadataPath,
        action: status.files.metadata ? "update" : "add",
        purpose: "Versioned bridge metadata for stale/incompatible detection and removal."
      },
      {
        path: status.sourcePath,
        action: status.files.source ? "update" : "add",
        purpose: "Development-only Expo/Rozenite bridge registration shim."
      }
    ],
    removalPlan: [
      { path: status.metadataPath, action: "delete" },
      { path: status.sourcePath, action: "delete" }
    ],
    runtimeHealthCheckExpectations: [
      "Metro target is available.",
      "Hermes inspector is available.",
      "Bridge metadata version matches CLI expected version.",
      "App registers readable and writable domains separately.",
      "Mutation domains remain action-policy gated."
    ],
    status: status.state,
    issues: status.issues
  };
}
function bridgeMetadata() {
  return {
    schemaVersion: BRIDGE_SCHEMA_VERSION,
    bridgeVersion: EXPO98_BRIDGE_VERSION,
    developmentOnly: true,
    generatedBy: "expo98",
    domains: ["navigation", "network", "storage", "controls", "performance", "snapshot"]
  };
}
function bridgeSource() {
  return `// Generated by expo98. Import this file only from development-only app code guarded by __DEV__.
export const expo98DevtoolsBridgeMetadata = ${JSON.stringify(bridgeMetadata(), null, 2)} as const;
export const expoIosDevtoolsBridgeMetadata = expo98DevtoolsBridgeMetadata;

type Expo98DevtoolsBridgeRegistration =
  | { registered: false; reason: "development-mode-required" | "production-build" }
  | { registered: true; metadata: typeof expo98DevtoolsBridgeMetadata };

export function registerExpo98DevtoolsBridge(): Expo98DevtoolsBridgeRegistration {
  if (typeof __DEV__ === "undefined") return { registered: false, reason: "development-mode-required" };
  if (!__DEV__) return { registered: false, reason: "production-build" };
  const bridge = {
    registered: true,
    metadata: expo98DevtoolsBridgeMetadata,
    expo98DevtoolsBridgeMetadata,
    expoIosDevtoolsBridgeMetadata,
    bridgeVersion: expo98DevtoolsBridgeMetadata.bridgeVersion,
    domains: expo98DevtoolsBridgeMetadata.domains.map((name) => ({ name })),
  };
  globalThis.__EXPO98_DEVTOOLS_BRIDGE__ = bridge;
  globalThis.__EXPO_IOS_DEVTOOLS_BRIDGE__ = bridge;
  return { registered: true, metadata: expo98DevtoolsBridgeMetadata };
}

export const registerExpoIosDevtoolsBridge = registerExpo98DevtoolsBridge;
`;
}
function requireString4(value, field) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${field} must be a non-empty string.`);
  }
  return value.trim();
}
function hasExplicitConfirmation2(value, required) {
  return String(value ?? "").split(",").map((item) => item.trim()).includes(required);
}
async function normalizeProjectCwd2(cwd, options = {}) {
  const resolved = path5.resolve(cwd ?? process.cwd());
  const stat8 = await fs3.stat(resolved).catch(() => null);
  if (!stat8?.isDirectory()) {
    throw new Error(`Directory does not exist: ${resolved}`);
  }
  if (options.allowMissingPackageJson) return resolved;
  return resolved;
}
async function readJsonFile3(file) {
  return JSON.parse(await fs3.readFile(file, "utf8"));
}
async function pathExists2(file) {
  return fs3.access(file).then(
    () => true,
    () => false
  );
}
async function writeJsonFile(file, value) {
  await fs3.writeFile(file, `${JSON.stringify(value, null, 2)}
`, "utf8");
}
function bridgeCommandIo(dependencies) {
  return {
    normalizeProjectCwd: dependencies.normalizeProjectCwd ?? normalizeProjectCwd2,
    bridgeHealthPayload: dependencies.bridgeHealthPayload ?? defaultBridgeHealthPayload,
    readJsonFile: dependencies.readJsonFile ?? readJsonFile3,
    pathExists: dependencies.pathExists ?? pathExists2,
    mkdir: dependencies.mkdir ?? fs3.mkdir,
    writeJsonFile: dependencies.writeJsonFile ?? writeJsonFile,
    writeFile: dependencies.writeFile ?? fs3.writeFile,
    rm: dependencies.rm ?? fs3.rm,
    joinPath: dependencies.joinPath ?? path5.join,
    resolvePath: dependencies.resolvePath ?? path5.resolve,
    currentCwd: dependencies.currentCwd ?? process.cwd
  };
}
async function resolveProjectCwd(cwd, io) {
  try {
    return await io.normalizeProjectCwd(cwd, { allowMissingPackageJson: true });
  } catch {
    return io.resolvePath(cwd ?? io.currentCwd());
  }
}
async function defaultBridgeHealthPayload() {
  return {
    available: false,
    health: "unavailable",
    reason: "Bridge health payload dependency was not provided."
  };
}
async function removeIgnoringErrors(io, file) {
  try {
    await io.rm(file, { force: true });
  } catch {
  }
}
function requireBridgeAction(value) {
  const action = requireString4(value, "action");
  if (isBridgeAction(action)) return action;
  throw new Error(`Unknown bridge action: ${action}`);
}
function isBridgeAction(action) {
  return ["status", "plan", "health", "domains", "install", "remove"].includes(action);
}
async function readJsonOrNull(read, file) {
  try {
    return await read(file);
  } catch {
    return null;
  }
}
function dependencyMap(packageJson) {
  const record = asRecord2(packageJson);
  return {
    ...asRecord2(record?.dependencies),
    ...asRecord2(record?.devDependencies)
  };
}
function metadataProperty(metadata, key) {
  return asRecord2(metadata)?.[key];
}
function asRecord2(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : void 0;
}

// src/commands/bridge-domain-actions/src/main/index.ts
import { readFile as readFile6 } from "node:fs/promises";
import path7 from "node:path";

// src/platform/hermes-cdp-client/src/main/index.ts
import WebSocket2 from "ws";
async function evaluateHermesExpression(webSocketDebuggerUrl, expression, options) {
  return cdpCall(
    webSocketDebuggerUrl,
    [
      { method: "Runtime.enable", params: {} },
      {
        method: "Runtime.evaluate",
        params: { expression, returnByValue: true, awaitPromise: true }
      }
    ],
    options.timeoutMs
  );
}
async function cdpCall(webSocketDebuggerUrl, calls, timeoutMs) {
  const candidates = loopbackWebSocketCandidates(webSocketDebuggerUrl);
  const errors = [];
  for (const candidate of candidates) {
    const origin = metroOriginForWebSocket(candidate);
    const ws = new WebSocket2(candidate, { headers: { Origin: origin } });
    try {
      await waitForOpen(ws, Math.min(timeoutMs, 2500));
      let id = 0;
      let last = null;
      for (const call of calls) {
        id += 1;
        ws.send(JSON.stringify({ id, method: call.method, params: call.params }));
        last = await waitForMessage(ws, id, call.method, timeoutMs);
      }
      const cdpError = last ? cdpErrorMessage(last.error) : null;
      return {
        ...last ?? {},
        ...cdpError ? { error: cdpError } : {},
        cdp: last,
        diagnostics: {
          webSocketDebuggerUrl,
          connectedUrl: candidate,
          origin,
          attempts: candidates.length
        }
      };
    } catch (error) {
      errors.push(`${candidate}: ${formatError4(error)}`);
      try {
        ws.close();
      } catch {
      }
    } finally {
      try {
        ws.close();
      } catch {
      }
    }
  }
  return {
    error: errors.length > 0 ? errors.join("; ") : "Hermes websocket connection failed.",
    diagnostics: {
      webSocketDebuggerUrl,
      attemptedUrls: candidates
    }
  };
}
function loopbackWebSocketCandidates(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return [url];
  }
  const candidates = [];
  const add = (candidate) => {
    if (!candidates.includes(candidate)) candidates.push(candidate);
  };
  add(parsed.toString());
  const loopbackHosts = /* @__PURE__ */ new Set(["localhost", "127.0.0.1", "::1", "[::1]", "0.0.0.0"]);
  if (loopbackHosts.has(parsed.hostname)) {
    for (const host of ["127.0.0.1", "localhost", "[::1]"]) {
      const candidate = new URL(parsed.toString());
      candidate.hostname = host;
      add(candidate.toString());
    }
  }
  return candidates;
}
function metroOriginForWebSocket(url) {
  try {
    const parsed = new URL(url);
    const port = parsed.port ? `:${parsed.port}` : "";
    return `http://127.0.0.1${port}`;
  } catch {
    return "http://127.0.0.1";
  }
}
function waitForOpen(ws, timeoutMs) {
  return new Promise((resolve18, reject) => {
    const timer = setTimeout(() => reject(new Error("Timed out opening WebSocket.")), timeoutMs);
    ws.once("open", () => {
      clearTimeout(timer);
      resolve18();
    });
    ws.once("error", (error) => {
      clearTimeout(timer);
      reject(error instanceof Error ? error : new Error("WebSocket connection failed."));
    });
  });
}
function waitForMessage(ws, id, method, timeoutMs) {
  return new Promise((resolve18, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for CDP response to ${method}#${id}.`));
    }, timeoutMs);
    const onMessage = (data) => {
      let parsed;
      const raw = data.toString();
      try {
        parsed = JSON.parse(raw);
      } catch (error) {
        cleanup();
        reject(
          new Error(`Malformed CDP JSON response for ${method}#${id}: ${truncate4(raw, 1e3)}`, {
            cause: error
          })
        );
        return;
      }
      if (!isRecord4(parsed) || parsed.id !== id) return;
      cleanup();
      resolve18(parsed.error ? { ...parsed, error: cdpErrorMessage(parsed.error) } : parsed);
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      clearTimeout(timer);
      ws.off("message", onMessage);
      ws.off("error", onError);
    };
    ws.on("message", onMessage);
    ws.once("error", onError);
  });
}
function isRecord4(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function formatError4(error) {
  const record = isRecord4(error) ? error : null;
  return typeof record?.message === "string" ? record.message : String(error);
}
function cdpErrorMessage(error) {
  if (error === void 0 || error === null) return null;
  if (typeof error === "string") return error;
  const record = isRecord4(error) ? error : null;
  if (typeof record?.message === "string") return record.message;
  return JSON.stringify(error);
}
function truncate4(value, limit) {
  if (value.length <= limit) return value;
  return `${value.slice(0, limit)}
[truncated ${value.length - limit} characters]`;
}

// src/commands/metro-probes/src/main/index.ts
import { promises as fs4 } from "node:fs";
import path6 from "node:path";
var LIMITATIONS = [
  "This command probes existing Metro HTTP endpoints only and never starts Metro implicitly.",
  "Connected targets can be stale when multiple apps or devices are attached."
];
var MAX_OUTPUT4 = 16384;
function clampNumber4(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new Error(`Expected a finite number, got ${String(value)}.`);
  }
  return Math.min(Math.max(number, min), max);
}
function formatError5(error) {
  if (!error) return "Unknown error";
  const record = asRecord3(error);
  const message = record ? record.message : void 0;
  const parts = [message == null ? String(error) : String(message)];
  if (record?.stdout) parts.push(`stdout:
${truncate5(record.stdout)}`);
  if (record?.stderr) parts.push(`stderr:
${truncate5(record.stderr)}`);
  return parts.join("\n\n");
}
function targetSummary(target) {
  if (!target) return null;
  return {
    id: target.id ?? null,
    title: target.title ?? null,
    description: target.description ?? null,
    appId: target.appId ?? null,
    deviceName: target.deviceName ?? null,
    devtoolsFrontendUrl: target.devtoolsFrontendUrl ?? null,
    webSocketDebuggerUrl: target.webSocketDebuggerUrl ?? null,
    reactNative: target.reactNative ?? null,
    capabilities: target.capabilities ?? {
      hermesRuntime: typeof target.webSocketDebuggerUrl === "string" && target.webSocketDebuggerUrl.startsWith("ws"),
      devtoolsFrontend: typeof target.devtoolsFrontendUrl === "string" && target.devtoolsFrontendUrl.length > 0,
      reactNative: Boolean(target.reactNative)
    }
  };
}
async function metroCommand(args = {}, deps = {}) {
  const action = requireString5(args.action ?? "status", "action");
  if (action === "reload")
    return toolJson(
      await (deps.metroReloadPayload ?? ((nextArgs) => metroReloadPayload(nextArgs, deps)))(args)
    );
  if (action === "symbolicate") {
    return toolJson(
      await (deps.metroSymbolicatePayload ?? ((nextArgs) => metroSymbolicatePayload(nextArgs, deps)))(args)
    );
  }
  if (action !== "status") throw new Error(`Unknown metro action: ${action}`);
  return toolJson(
    await (deps.metroStatusPayload ?? ((nextArgs) => metroStatusPayload(nextArgs, deps)))(args)
  );
}
async function metroStatusPayload(args = {}, deps = {}) {
  const metroPort = clampNumber4(args.metroPort ?? 8081, 1, 65535);
  return new MetroInspectorClient(metroPort, deps).statusPayload();
}
async function metroTargets(metroPort, deps = {}) {
  const result = await new MetroInspectorClient(metroPort, deps).targets();
  return result.targets;
}
var MetroInspectorClient = class {
  constructor(metroPort, deps = {}) {
    this.metroPort = metroPort;
    this.baseUrl = `http://127.0.0.1:${metroPort}`;
    this.fetchLocalText = deps.fetchLocalText ?? defaultFetchLocalText;
    this.fetchLocalJson = deps.fetchLocalJson ?? defaultFetchLocalJson;
    this.fetchLocalLoopback = deps.fetchLocalLoopback ?? defaultFetchLocalLoopback;
  }
  async status() {
    try {
      const text = await this.fetchLocalText(`${this.baseUrl}/status`, { timeoutMs: 1500 });
      return { available: true, endpoint: "/status", text, error: null };
    } catch (error) {
      return { available: false, endpoint: "/status", text: null, error: formatError5(error) };
    }
  }
  async version() {
    try {
      const value = await this.fetchLocalJson(`${this.baseUrl}/json/version`, { timeoutMs: 1500 });
      return { available: true, endpoint: "/json/version", value, error: null };
    } catch (error) {
      return {
        available: false,
        endpoint: "/json/version",
        value: null,
        error: formatError5(error)
      };
    }
  }
  async targets() {
    let raw;
    try {
      raw = await this.fetchLocalJson(`${this.baseUrl}/json/list`, { timeoutMs: 2500 });
    } catch (error) {
      return {
        available: false,
        endpoint: "/json/list",
        targets: [],
        malformedTargets: [],
        reason: formatError5(error)
      };
    }
    if (!Array.isArray(raw)) {
      return {
        available: false,
        endpoint: "/json/list",
        targets: [],
        malformedTargets: [
          { index: null, reason: "Metro target list was not an array.", shape: responseShape(raw) }
        ],
        reason: "Metro target list was malformed."
      };
    }
    const targets = [];
    const malformedTargets = [];
    raw.forEach((target, index) => {
      const normalized = this.normalizeTarget(target, index);
      if (normalized.target) targets.push(normalized.target);
      if (normalized.error) malformedTargets.push(normalized.error);
    });
    return {
      available: true,
      endpoint: "/json/list",
      targets,
      malformedTargets,
      reason: malformedTargets.length > 0 ? "Some Metro targets were malformed and skipped." : null
    };
  }
  normalizeTarget(target, index = 0) {
    const record = asRecord3(target);
    if (!record || Array.isArray(target)) {
      return {
        target: null,
        error: { index, reason: "Target was not an object.", shape: responseShape(target) }
      };
    }
    const normalized = {
      id: optionalString2(record.id),
      title: optionalString2(record.title),
      description: optionalString2(record.description),
      appId: optionalString2(record.appId),
      deviceName: optionalString2(record.deviceName),
      devtoolsFrontendUrl: optionalString2(record.devtoolsFrontendUrl),
      webSocketDebuggerUrl: optionalString2(record.webSocketDebuggerUrl),
      reactNative: record.reactNative && typeof record.reactNative === "object" ? record.reactNative : null,
      capabilities: {
        hermesRuntime: typeof record.webSocketDebuggerUrl === "string" && record.webSocketDebuggerUrl.startsWith("ws"),
        devtoolsFrontend: typeof record.devtoolsFrontendUrl === "string" && record.devtoolsFrontendUrl.length > 0,
        reactNative: Boolean(record.reactNative)
      }
    };
    if (!normalized.id && !normalized.title && !normalized.webSocketDebuggerUrl && !normalized.devtoolsFrontendUrl) {
      return {
        target: null,
        error: {
          index,
          reason: "Target did not include any stable identifying metadata.",
          shape: responseShape(target)
        }
      };
    }
    return { target: normalized, error: null };
  }
  async symbolicate(stack) {
    try {
      const response = await this.fetchLocalLoopback(`${this.baseUrl}/symbolicate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ stack }),
        timeoutMs: 1500
      });
      const value = response.ok ? await response.json().catch(() => null) : null;
      return {
        available: response.ok,
        endpoint: "/symbolicate",
        status: response.status,
        reason: response.ok ? null : `Metro symbolicate HTTP ${response.status}`,
        value
      };
    } catch (error) {
      return {
        available: false,
        endpoint: "/symbolicate",
        status: null,
        reason: formatError5(error),
        value: null
      };
    }
  }
  async probeSymbolication() {
    const result = await this.symbolicate([]);
    return {
      available: result.available,
      endpoint: "/symbolicate",
      status: result.status,
      reason: result.reason
    };
  }
  async statusPayload() {
    const statusResult = await this.status();
    const targetsResult = statusResult.available ? await this.targets() : {
      available: false,
      endpoint: "/json/list",
      targets: [],
      malformedTargets: [],
      reason: "Metro is unavailable."
    };
    const versionResult = statusResult.available ? await this.version() : {
      available: false,
      endpoint: "/json/version",
      value: null,
      error: "Metro is unavailable."
    };
    const symbolication = statusResult.available ? await this.probeSymbolication() : { available: false, reason: "Metro is unavailable.", endpoint: "/symbolicate" };
    return {
      available: statusResult.available,
      reason: statusResult.available ? null : "Metro is not reachable on the requested port.",
      metroPort: this.metroPort,
      status: statusResult.available ? "available" : "unavailable",
      statusText: statusResult.text,
      error: statusResult.error ?? null,
      version: versionResult.value,
      versionError: versionResult.error ?? null,
      targetCount: targetsResult.targets.length,
      targets: targetsResult.targets.map(targetSummary),
      targetDiscovery: {
        endpoint: "/json/list",
        available: targetsResult.available,
        reason: targetsResult.reason,
        malformedTargets: targetsResult.malformedTargets
      },
      symbolication,
      limitations: LIMITATIONS
    };
  }
};
function optionalString2(value) {
  return typeof value === "string" && value.length > 0 ? value : null;
}
function requireString5(value, field) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${field} must be a non-empty string.`);
  }
  return value.trim();
}
function responseShape(value) {
  if (value == null) return null;
  if (Array.isArray(value)) return { type: "array", length: value.length };
  if (typeof value !== "object") return { type: typeof value };
  const record = value;
  const shape = { type: "object", keys: Object.keys(record).slice(0, 20) };
  if (typeof record.type === "string") shape.resultType = record.type;
  if (record.result && typeof record.result === "object")
    shape.result = responseShape(record.result);
  return shape;
}
function truncate5(value, limit = MAX_OUTPUT4) {
  const text = String(value ?? "");
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}
[truncated ${text.length - limit} characters]`;
}
function asRecord3(value) {
  return value && typeof value === "object" ? value : null;
}
async function metroReloadPayload(args, deps = {}) {
  const metroPort = clampNumber4(args.metroPort ?? 8081, 1, 65535);
  const targets = await metroTargets(metroPort, deps);
  const webSocketDebuggerUrl = targets[0]?.webSocketDebuggerUrl ?? null;
  if (!webSocketDebuggerUrl) {
    return { available: false, action: "reload", reason: "No Metro inspector target.", metroPort };
  }
  const evaluate = deps.evaluateHermesExpression ?? evaluateHermesExpression;
  const result = await evaluate(
    webSocketDebuggerUrl,
    `(() => {
    const devSettings = globalThis.NativeModules?.DevSettings || globalThis.__fbBatchedBridgeConfig?.remoteModuleConfig?.DevSettings;
    if (globalThis.location && typeof globalThis.location.reload === 'function') { globalThis.location.reload(); return { available: true, strategy: 'location.reload' }; }
    if (devSettings && typeof devSettings.reload === 'function') { devSettings.reload(); return { available: true, strategy: 'DevSettings.reload' }; }
    return { available: false, reason: 'No runtime reload hook was available.' };
  })()`,
    { timeoutMs: 3e3 }
  );
  const value = result.result?.result?.value;
  return {
    ...isPlainObject(value) ? value : { available: false, reason: result.error ?? "Runtime reload did not return a value." },
    action: "reload",
    metroPort,
    target: targetSummary(targets[0])
  };
}
async function metroSymbolicatePayload(args, deps = {}) {
  const stackFile = requireString5(
    args.stackFile ?? positionalArg(args._, 0) ?? args.file,
    "stackFile"
  );
  const resolvePath2 = deps.resolvePath ?? path6.resolve;
  const readTextFile = deps.readTextFile ?? fs4.readFile;
  const resolvedStackFile = resolvePath2(stackFile);
  const stack = parseComponentStackFrames(await readTextFile(resolvedStackFile, "utf8"));
  const metroPort = clampNumber4(args.metroPort ?? 8081, 1, 65535);
  const result = await postMetroSymbolicate(metroPort, stack, deps);
  return {
    available: true,
    action: "symbolicate",
    metroPort,
    stackFile: resolvedStackFile,
    frameCount: stack.length,
    result
  };
}
function parseComponentStackFrames(stack) {
  const frames = [];
  for (const line of String(stack).split("\n")) {
    const match = /^\s*at\s+(.*?)\s+\((http.*):(\d+):(\d+)\)$/.exec(line);
    if (!match) continue;
    frames.push({
      methodName: match[1]?.trim() || "<anonymous>",
      file: match[2] ?? "",
      lineNumber: Number(match[3]),
      column: Number(match[4])
    });
  }
  return frames;
}
async function postMetroSymbolicate(metroPort, stack, deps = {}) {
  const result = await new MetroInspectorClient(metroPort, deps).symbolicate(stack);
  if (!result.available) throw new Error(result.reason ?? "Metro symbolication failed.");
  return result.value;
}
function positionalArg(value, index) {
  return Array.isArray(value) ? value[index] : void 0;
}
function isPlainObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}
async function defaultFetchLocalText(url, options) {
  const response = await defaultFetchLocalLoopback(url, options);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}
async function defaultFetchLocalJson(url, options) {
  return JSON.parse(await defaultFetchLocalText(url, options));
}
async function defaultFetchLocalLoopback(url, options = {}) {
  const timeoutMs = options.timeoutMs ?? 1500;
  const { timeoutMs: _timeoutMs, ...request } = options;
  const candidates = loopbackUrlCandidates(url);
  let lastError = null;
  for (const candidate of candidates) {
    try {
      return await fetchWithTimeout(candidate, timeoutMs, request);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError ?? new Error("Local fetch failed");
}
function loopbackUrlCandidates(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return [url];
  }
  if (!["127.0.0.1", "localhost", "[::1]", "::1"].includes(parsed.hostname)) return [url];
  const candidates = [];
  for (const host of ["127.0.0.1", "localhost", "[::1]"]) {
    const candidate = new URL(url);
    candidate.host = `${host}${parsed.port ? `:${parsed.port}` : ""}`;
    if (!candidates.includes(candidate.toString())) candidates.push(candidate.toString());
  }
  return candidates;
}
async function fetchWithTimeout(url, timeoutMs, init) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

// src/commands/bridge-domain-actions/src/main/index.ts
var EXPO98_BRIDGE_VERSION2 = "1.0.0";
var MAX_OUTPUT5 = 4e4;
var MAX_ARRAY_ITEMS = 1e3;
function boundedToolJson(value) {
  return { content: [{ type: "text", text: stringifyBoundedJson(value) }] };
}
async function storageCommand(args = {}, deps = defaultBridgeDomainDependencies) {
  const positionals = Array.isArray(args._) ? args._ : [];
  const store = requireString6(args.store ?? positionals[0], "store");
  const action = requireString6(args.action ?? positionals[1] ?? "list", "action");
  if (!["list", "get", "set", "clear"].includes(action))
    throw new Error(`Unknown storage action: ${action}`);
  const key = args.key ?? positionals[2];
  const sideEffect = action === "list" || action === "get" ? "read" : "write";
  const policy = await policyDecision(args, `storage.${action}`, sideEffect, deps);
  if (!policy.allowed)
    return boundedToolJson(policyDeniedPayload({ domain: "storage", action, policy }));
  const value = action === "set" ? parseStorageValue(args.value ?? positionals[3]) : null;
  return boundedToolJson(
    await bridgeDomainCommand(
      {
        args,
        domain: "storage",
        action,
        expression: storageExpression({
          store,
          action,
          key,
          value,
          limit: clampNumber5(args.limit ?? 100, 1, 1e3)
        }),
        policy
      },
      deps
    )
  );
}
async function stateCommand(args = {}, deps = defaultBridgeDomainDependencies) {
  const positionals = Array.isArray(args._) ? args._ : [];
  const action = requireString6(args.action ?? positionals[0] ?? "list", "action");
  if (!["list", "save", "load", "clear"].includes(action))
    throw new Error(`Unknown state action: ${action}`);
  const sideEffect = action === "list" ? "read" : "write";
  const policy = await policyDecision(args, `state.${action}`, sideEffect, deps);
  if (!policy.allowed)
    return boundedToolJson(policyDeniedPayload({ domain: "state", action, policy }));
  return boundedToolJson(
    await bridgeDomainCommand(
      {
        args,
        domain: "state",
        action,
        expression: stateExpression({ action, name: args.name ?? positionals[1] }),
        policy
      },
      deps
    )
  );
}
async function controlsCommand(args = {}, deps = defaultBridgeDomainDependencies) {
  const positionals = Array.isArray(args._) ? args._ : [];
  const action = requireString6(args.action ?? positionals[0] ?? "list", "action");
  if (!["list", "get", "press"].includes(action))
    throw new Error(`Unknown controls action: ${action}`);
  const sideEffect = action === "press" ? "device" : "read";
  const policy = await policyDecision(args, `controls.${action}`, sideEffect, deps);
  if (!policy.allowed)
    return boundedToolJson(policyDeniedPayload({ domain: "controls", action, policy }));
  return boundedToolJson(
    await bridgeDomainCommand(
      {
        args,
        domain: "controls",
        action,
        expression: controlsExpression({ action, name: args.name ?? positionals[1] }),
        policy
      },
      deps
    )
  );
}
var defaultBridgeDomainDependencies = {
  metroTargets: (metroPort) => metroTargets(metroPort),
  evaluateHermesExpression,
  readJsonFile: async (file) => JSON.parse(await readFile6(file, "utf8")),
  resolvePath: (file) => path7.resolve(file)
};
async function bridgeDomainCommand(input, deps = defaultBridgeDomainDependencies) {
  const metroPort = clampNumber5(input.args.metroPort ?? 8081, 1, 65535);
  const sideEffect = bridgeActionSideEffect(input.domain, input.action);
  if (sideEffect !== "read" && input.policy?.allowed !== true) {
    return policyDeniedPayload({
      domain: input.domain,
      action: input.action,
      policy: input.policy ?? {
        checked: true,
        action: `${input.domain}.${input.action}`,
        sideEffect,
        allowed: false,
        source: null,
        reason: "No action policy allowed this state-changing operation."
      }
    });
  }
  const targets = deps.metroTargets ? await deps.metroTargets(metroPort) : [];
  const target = targets[0] ?? null;
  const webSocketDebuggerUrl = target?.webSocketDebuggerUrl ?? null;
  if (!webSocketDebuggerUrl) {
    return domainUnavailable({
      domain: input.domain,
      action: input.action,
      metroPort,
      code: "no-runtime-target",
      reason: "No Metro inspector target.",
      policy: input.policy
    });
  }
  if (!deps.evaluateHermesExpression) {
    return domainUnavailable({
      domain: input.domain,
      action: input.action,
      metroPort,
      code: "transport-failure",
      reason: `${input.domain} bridge did not return a value.`,
      target: targetSummary2(target),
      policy: input.policy
    });
  }
  const result = await deps.evaluateHermesExpression(webSocketDebuggerUrl, input.expression, {
    timeoutMs: 5e3
  });
  const value = result?.result?.result?.value;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return domainUnavailable({
      domain: input.domain,
      action: input.action,
      metroPort,
      code: "transport-failure",
      reason: result?.error ?? `${input.domain} bridge did not return a value.`,
      target: targetSummary2(target),
      transport: bridgeRuntimeTransport(
        metroPort,
        target,
        result?.diagnostics ?? result?.cdp ?? null
      ),
      policy: input.policy
    });
  }
  const redacted = sanitizePayload(deps.redactValue ? deps.redactValue(value) : value);
  return sanitizePayload({
    ...redacted,
    domain: input.domain,
    action: input.action,
    metroPort,
    target: targetSummary2(target),
    transport: bridgeRuntimeTransport(
      metroPort,
      target,
      result?.diagnostics ?? result?.cdp ?? null
    ),
    evidenceSource: typeof redacted.source === "string" ? redacted.source : "unknown",
    policy: input.policy
  });
}
function domainUnavailable(args) {
  return sanitizePayload({
    available: false,
    domain: args.domain,
    action: args.action,
    source: "app-instrumentation",
    evidenceSource: "unavailable",
    code: args.code ?? "unavailable",
    reason: args.reason,
    metroPort: args.metroPort,
    target: targetSummary2(args.target),
    transport: args.transport ?? bridgeRuntimeTransport(args.metroPort, args.target ?? null, null),
    policy: args.policy ?? null,
    limitations: [`${args.domain} evidence requires the dev-only app instrumentation bridge.`]
  });
}
function bridgeRuntimeTransport(metroPort, target, cdp = null) {
  return sanitizePayload({
    name: "metro-inspector-hermes-cdp",
    metroPort,
    protocol: "Runtime.evaluate",
    target: targetSummary2(target),
    cdp
  });
}
async function policyDecision(args, action, sideEffect, deps = {}) {
  if (sideEffect === "read") {
    return {
      checked: true,
      action,
      sideEffect,
      allowed: true,
      source: null,
      reason: "Read action does not require policy approval."
    };
  }
  const policyPath = optionalString3(args.actionPolicy);
  if (!policyPath) {
    return {
      checked: true,
      action,
      sideEffect,
      allowed: false,
      source: null,
      reason: "No action policy allowed this state-changing operation."
    };
  }
  const resolved = deps.resolvePath ? deps.resolvePath(policyPath) : policyPath;
  if (!deps.readJsonFile)
    throw new Error("policyDecision requires readJsonFile when actionPolicy is supplied.");
  const policy = await deps.readJsonFile(resolved);
  const allowed = policyAllowsAction2(policy, action);
  return {
    checked: true,
    action,
    sideEffect,
    allowed,
    source: resolved,
    reason: allowed ? "Action allowed by policy." : "Action policy did not allow this operation."
  };
}
function policyAllowsAction2(policy, action) {
  const record = asRecord4(policy);
  if (Array.isArray(record?.allow) && record.allow.includes(action)) return true;
  const actions = asRecord4(record?.actions);
  return actions?.[action] === "allow" || actions?.[action] === true;
}
function parseStorageValue(value) {
  if (value === void 0) throw new Error("storage set requires a JSON value.");
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch (error) {
    throw new Error(`Invalid JSON for --value: ${formatError6(error)}`);
  }
}
function storageExpression(args) {
  return `(() => {
    const store = ${JSON.stringify(args.store)};
    const action = ${JSON.stringify(args.action)};
    const key = ${JSON.stringify(args.key ?? null)};
    const value = ${JSON.stringify(args.value)};
    const limit = ${Number(args.limit)};
    const expectedBridgeVersion = ${JSON.stringify(EXPO98_BRIDGE_VERSION2)};
    const pluginBridge = globalThis.__EXPO98_DEVTOOLS_BRIDGE__ ||
      globalThis.__EXPO_IOS_DEVTOOLS_BRIDGE__ ||
      globalThis.__EXPO98_PLUGIN_BRIDGE__ ||
      globalThis.__EXPO_IOS_PLUGIN_BRIDGE__ ||
      globalThis.__ROZENITE_AGENT_BRIDGE__;
    const pluginMetadata = pluginBridge?.metadata || pluginBridge?.expo98DevtoolsBridgeMetadata || pluginBridge?.expoIosDevtoolsBridgeMetadata || pluginBridge?.bridgeMetadata || {};
    const pluginVersion = pluginMetadata.bridgeVersion || pluginBridge?.bridgeVersion || pluginBridge?.version || null;
    const pluginStorage = pluginBridge?.storage ||
      (pluginBridge?.domains && !Array.isArray(pluginBridge.domains) ? pluginBridge.domains.storage : null) ||
      (pluginBridge?.domainRegistry ? pluginBridge.domainRegistry.storage : null);
    const pluginCallTool = typeof pluginBridge?.callTool === 'function' ? pluginBridge.callTool.bind(pluginBridge) : null;
    const callStorage = (name, payload = {}) => {
      if (pluginStorage && typeof pluginStorage[name] === 'function') return pluginStorage[name](payload);
      if (pluginStorage && pluginStorage.actions && typeof pluginStorage.actions[name] === 'function') return pluginStorage.actions[name](payload);
      if (pluginCallTool) return pluginCallTool('storage.' + name, payload);
      return null;
    };
    const hasPluginStorage = Boolean(pluginStorage || pluginCallTool || (Array.isArray(pluginBridge?.domains) && pluginBridge.domains.some((domain) => domain?.name === 'storage')));
    if (hasPluginStorage) {
      if (pluginVersion && pluginVersion !== expectedBridgeVersion) {
        return { available: false, source: 'plugin-bridge', domain: 'storage', code: 'version-mismatch', bridgeVersion: pluginVersion, expectedBridgeVersion, reason: 'Storage plugin bridge version is not compatible with this CLI.', store, action };
      }
      const adapters = pluginStorage?.adapters || pluginStorage?.stores || pluginStorage || {};
      const adapter = adapters[store] || (pluginStorage?.store && pluginStorage.store(store)) || null;
      const read = (targetKey) => adapter && typeof adapter.get === 'function' ? adapter.get(targetKey) : adapter?.values?.[targetKey];
      if (!adapter && !pluginCallTool) return { available: false, source: 'plugin-bridge', domain: 'storage', code: 'missing-domain', reason: 'Storage bridge store is not registered.', store, action };
      if (action === 'list') {
        const keys = adapter ? (adapter.list ? adapter.list() : adapter.keys || []) : callStorage('list', { store, limit });
        return { available: true, source: 'plugin-bridge', domain: 'storage', bridgeVersion: pluginVersion, store, action, keys: (Array.isArray(keys) ? keys : []).slice(0, limit) };
      }
      if (action === 'get') return { available: true, source: 'plugin-bridge', domain: 'storage', bridgeVersion: pluginVersion, store, action, key, value: adapter ? read(key) : callStorage('get', { store, key }) };
      if (action === 'set') {
        const before = adapter ? read(key) : null;
        const result = adapter && typeof adapter.set === 'function' ? adapter.set(key, value) : callStorage('set', { store, key, value });
        const after = adapter ? read(key) : null;
        return { available: true, source: 'plugin-bridge', domain: 'storage', bridgeVersion: pluginVersion, store, action, key, before, after, result: result || { ok: true } };
      }
      if (action === 'clear') {
        const beforeKeys = adapter ? (adapter.list ? adapter.list() : adapter.keys || []) : [];
        const result = adapter && typeof adapter.clear === 'function' ? adapter.clear() : callStorage('clear', { store });
        const afterKeys = adapter ? (adapter.list ? adapter.list() : adapter.keys || []) : [];
        return { available: true, source: 'plugin-bridge', domain: 'storage', bridgeVersion: pluginVersion, store, action, before: { keys: beforeKeys }, after: { keys: afterKeys }, result: result || { ok: true } };
      }
    } else if (pluginBridge) {
      return { available: false, source: 'plugin-bridge', domain: 'storage', code: 'missing-domain', reason: 'Storage bridge domain is not registered.', store, action };
    }
    const bridge = globalThis.__EXPO98_STORAGE_BRIDGE__ ||
      globalThis.__EXPO_IOS_STORAGE_BRIDGE__ ||
      (globalThis.__EXPO98_INSTRUMENTATION__?.storage || globalThis.__EXPO_IOS_INSTRUMENTATION__?.storage);
    if (!bridge) return { available: false, source: 'app-instrumentation', code: 'unavailable-bridge', reason: 'Storage bridge is not installed.', store, action };
    const adapter = bridge[store];
    if (!adapter) return { available: false, source: 'app-instrumentation', reason: 'Unsupported storage store.', store, action };
    if (action === 'list') return { available: true, source: 'app-instrumentation', store, action, keys: (adapter.list ? adapter.list() : adapter.keys || []).slice(0, limit) };
    if (action === 'get') return { available: true, source: 'app-instrumentation', store, action, key, value: adapter.get ? adapter.get(key) : (adapter.values || {})[key] };
    if (action === 'set') return { available: true, source: 'app-instrumentation', store, action, key, result: adapter.set ? adapter.set(key, value) : { ok: true } };
    if (action === 'clear') return { available: true, source: 'app-instrumentation', store, action, result: adapter.clear ? adapter.clear() : { ok: true } };
    return { available: false, source: 'app-instrumentation', reason: 'Unsupported storage action.', store, action };
  })()`;
}
function stateExpression(args) {
  return `(() => {
    const action = ${JSON.stringify(args.action)};
    const name = ${JSON.stringify(args.name ?? null)};
    const bridge = globalThis.__EXPO98_STATE_BRIDGE__ ||
      globalThis.__EXPO_IOS_STATE_BRIDGE__ ||
      (globalThis.__EXPO98_INSTRUMENTATION__?.state || globalThis.__EXPO_IOS_INSTRUMENTATION__?.state);
    if (!bridge) return { available: false, source: 'app-instrumentation', reason: 'State bridge is not installed.', action };
    if (action === 'list') return { available: true, source: 'app-instrumentation', action, states: bridge.list ? bridge.list() : bridge.states || [] };
    if (action === 'save') return { available: true, source: 'app-instrumentation', action, name, result: bridge.save ? bridge.save(name) : { ok: true, name } };
    if (action === 'load') return { available: true, source: 'app-instrumentation', action, name, result: bridge.load ? bridge.load(name) : { ok: true, name } };
    if (action === 'clear') return { available: true, source: 'app-instrumentation', action, name, result: bridge.clear ? bridge.clear(name) : { ok: true, name } };
    return { available: false, source: 'app-instrumentation', reason: 'Unsupported state action.', action };
  })()`;
}
function controlsExpression(args) {
  return `(() => {
    const action = ${JSON.stringify(args.action)};
    const name = ${JSON.stringify(args.name ?? null)};
    const expectedBridgeVersion = ${JSON.stringify(EXPO98_BRIDGE_VERSION2)};
    const pluginBridge = globalThis.__EXPO98_DEVTOOLS_BRIDGE__ ||
      globalThis.__EXPO_IOS_DEVTOOLS_BRIDGE__ ||
      globalThis.__EXPO98_PLUGIN_BRIDGE__ ||
      globalThis.__EXPO_IOS_PLUGIN_BRIDGE__ ||
      globalThis.__ROZENITE_AGENT_BRIDGE__;
    const pluginMetadata = pluginBridge?.metadata || pluginBridge?.expo98DevtoolsBridgeMetadata || pluginBridge?.expoIosDevtoolsBridgeMetadata || pluginBridge?.bridgeMetadata || {};
    const pluginVersion = pluginMetadata.bridgeVersion || pluginBridge?.bridgeVersion || pluginBridge?.version || null;
    const pluginControls = pluginBridge?.controls ||
      (pluginBridge?.domains && !Array.isArray(pluginBridge.domains) ? pluginBridge.domains.controls : null) ||
      (pluginBridge?.domainRegistry ? pluginBridge.domainRegistry.controls : null);
    const pluginCallTool = typeof pluginBridge?.callTool === 'function' ? pluginBridge.callTool.bind(pluginBridge) : null;
    const callControls = (command, payload = {}) => {
      if (pluginControls && typeof pluginControls[command] === 'function') return pluginControls[command](payload);
      if (pluginControls && pluginControls.actions && typeof pluginControls.actions[command] === 'function') return pluginControls.actions[command](payload);
      if (pluginCallTool) return pluginCallTool('controls.' + command, payload);
      return null;
    };
    const hasPluginControls = Boolean(pluginControls || pluginCallTool || (Array.isArray(pluginBridge?.domains) && pluginBridge.domains.some((domain) => domain?.name === 'controls')));
    if (hasPluginControls) {
      if (pluginVersion && pluginVersion !== expectedBridgeVersion) {
        return { available: false, source: 'plugin-bridge', domain: 'controls', code: 'version-mismatch', bridgeVersion: pluginVersion, expectedBridgeVersion, reason: 'Controls plugin bridge version is not compatible with this CLI.', action };
      }
      const listControls = () => {
        const raw = pluginControls && typeof pluginControls.list === 'function'
          ? pluginControls.list()
          : pluginControls?.controls || callControls('list') || [];
        return Array.isArray(raw) ? raw : [];
      };
      if (action === 'list') return { available: true, source: 'plugin-bridge', domain: 'controls', bridgeVersion: pluginVersion, action, controls: listControls() };
      if (action === 'get') return { available: true, source: 'plugin-bridge', domain: 'controls', bridgeVersion: pluginVersion, action, name, control: pluginControls && typeof pluginControls.get === 'function' ? pluginControls.get(name) : listControls().find((control) => control.name === name) || null };
      if (action === 'press') {
        const before = pluginControls && typeof pluginControls.get === 'function' ? pluginControls.get(name) : listControls().find((control) => control.name === name) || null;
        const result = pluginControls && typeof pluginControls.press === 'function' ? pluginControls.press(name) : callControls('press', { name });
        const after = pluginControls && typeof pluginControls.get === 'function' ? pluginControls.get(name) : listControls().find((control) => control.name === name) || null;
        return { available: true, source: 'plugin-bridge', domain: 'controls', bridgeVersion: pluginVersion, action, name, before, after, result: result || { ok: true, name } };
      }
    } else if (pluginBridge) {
      return { available: false, source: 'plugin-bridge', domain: 'controls', code: 'missing-domain', reason: 'Controls bridge domain is not registered.', action };
    }
    const bridge = globalThis.__EXPO98_CONTROLS_BRIDGE__ ||
      globalThis.__EXPO_IOS_CONTROLS_BRIDGE__ ||
      (globalThis.__EXPO98_INSTRUMENTATION__?.controls || globalThis.__EXPO_IOS_INSTRUMENTATION__?.controls);
    if (!bridge) return { available: false, source: 'app-instrumentation', code: 'unavailable-bridge', reason: 'Controls bridge is not installed.', action };
    if (action === 'list') return { available: true, source: 'app-instrumentation', action, controls: bridge.list ? bridge.list() : bridge.controls || [] };
    if (action === 'get') return { available: true, source: 'app-instrumentation', action, name, control: bridge.get ? bridge.get(name) : (bridge.controls || []).find((control) => control.name === name) || null };
    if (action === 'press') return { available: true, source: 'app-instrumentation', action, name, result: bridge.press ? bridge.press(name) : { ok: true, name } };
    return { available: false, source: 'app-instrumentation', reason: 'Unsupported controls action.', action };
  })()`;
}
function targetSummary2(target) {
  if (!target) return null;
  return sanitizePayload({
    id: target.id ?? null,
    title: target.title ?? null,
    description: target.description ?? null,
    appId: target.appId ?? null,
    deviceName: target.deviceName ?? null,
    devtoolsFrontendUrl: target.devtoolsFrontendUrl ?? null,
    webSocketDebuggerUrl: target.webSocketDebuggerUrl ?? null,
    reactNative: target.reactNative ?? null,
    capabilities: target.capabilities ?? {
      hermesRuntime: typeof target.webSocketDebuggerUrl === "string" && target.webSocketDebuggerUrl.startsWith("ws"),
      devtoolsFrontend: typeof target.devtoolsFrontendUrl === "string" && target.devtoolsFrontendUrl.length > 0,
      reactNative: Boolean(target.reactNative)
    }
  });
}
function clampNumber5(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`Expected a finite number, got ${String(value)}.`);
  return Math.min(Math.max(number, min), max);
}
function requireString6(value, name) {
  if (typeof value !== "string" || value.trim().length === 0)
    throw new Error(`${name} must be a non-empty string.`);
  return value.trim();
}
function optionalString3(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}
function sanitizePayload(value) {
  return boundValue(redactValue2(value));
}
function stringifyBoundedJson(value) {
  const sanitized = sanitizePayload(value);
  const text = JSON.stringify(sanitized, null, 2);
  if (text.length <= MAX_OUTPUT5) return text;
  const record = asRecord4(sanitized);
  const envelope = {
    available: false,
    source: "output-boundary",
    evidenceSource: "output-boundary",
    code: "output-truncated",
    outputTruncated: true,
    originalLength: text.length,
    domain: record?.domain,
    action: record?.action,
    preview: ""
  };
  let budget = MAX_OUTPUT5 - JSON.stringify(envelope, null, 2).length - 128;
  envelope.preview = text.slice(0, Math.max(0, budget));
  let output = JSON.stringify(envelope, null, 2);
  while (output.length > MAX_OUTPUT5 && typeof envelope.preview === "string") {
    budget -= output.length - MAX_OUTPUT5 + 128;
    envelope.preview = envelope.preview.slice(0, Math.max(0, budget));
    output = JSON.stringify(envelope, null, 2);
  }
  return output;
}
function bridgeActionSideEffect(domain, action) {
  if (domain === "storage") return action === "list" || action === "get" ? "read" : "write";
  if (domain === "state") return action === "list" ? "read" : "write";
  if (domain === "controls") return action === "press" ? "device" : "read";
  return "unknown";
}
function boundValue(value) {
  if (typeof value === "string") return truncate6(value);
  if (Array.isArray(value)) return value.slice(-MAX_ARRAY_ITEMS).map(boundValue);
  const record = asRecord4(value);
  if (!record) return value;
  return Object.fromEntries(
    Object.entries(record).map(([key, nested]) => [key, boundValue(nested)])
  );
}
function redactValue2(value) {
  if (typeof value === "string") return redactString(value);
  if (Array.isArray(value)) return value.map(redactValue2);
  const record = asRecord4(value);
  if (!record) return value;
  return Object.fromEntries(
    Object.entries(record).map(([key, nested]) => [
      key,
      isSensitiveKey(key) ? "[redacted]" : redactValue2(nested)
    ])
  );
}
function redactString(value) {
  try {
    const parsed = new URL(value);
    let changed = false;
    for (const key of [...parsed.searchParams.keys()]) {
      if (isSensitiveKey(key)) {
        parsed.searchParams.set(key, "[redacted]");
        changed = true;
      }
    }
    return changed ? parsed.toString() : value;
  } catch {
    return value.replace(
      /([?&](?:cookie|token|authorization|password|secret|api[-_]?key|apikey)=)[^&\s]+/gi,
      "$1[redacted]"
    );
  }
}
function isSensitiveKey(key) {
  return /token|authorization|cookie|password|secret|apikey|apiKey/i.test(key);
}
function truncate6(value, max = MAX_OUTPUT5) {
  const text = String(value ?? "");
  if (text.length <= max) return text;
  return `${text.slice(0, max)}
...[truncated ${text.length - max} chars]`;
}
function asRecord4(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}
function formatError6(error) {
  const record = asRecord4(error);
  return record?.message == null ? String(error) : String(record.message);
}

// src/commands/dashboard-observability/src/main/index.ts
import { mkdir as mkdir4, readdir as readdir3, readFile as readFile7, writeFile as writeFile4 } from "node:fs/promises";
import { basename as basename2, dirname, join as join2, resolve as resolve2 } from "node:path";
var DASHBOARD_LIMITATION = "The dashboard command records a local static observability view; it does not expose network access unless a future server adapter is added.";
async function dashboardCommand(args = {}) {
  const positionals = Array.isArray(args._) ? args._ : [];
  const action = requireString7(args.action ?? positionals[0] ?? "status", "action");
  if (!["start", "status", "stop"].includes(action))
    throw new Error(`Unknown dashboard action: ${action}`);
  const stateRoot = resolveExpoStateRoot2(args);
  const dashboardDir = join2(stateRoot, "dashboard");
  const statePath = join2(dashboardDir, "dashboard-state.json");
  await mkdir4(dashboardDir, { recursive: true });
  const previous = asRecord5(await readJsonFile4(statePath).catch(() => null));
  const previousArtifacts = asRecord5(previous?.artifacts);
  const status = action === "start" ? "running" : action === "stop" ? "stopped" : previous?.status ?? "stopped";
  const payload = {
    available: true,
    action,
    status,
    port: clampNumber6(args.port ?? previous?.port ?? 0, 0, 65535),
    stateRoot,
    sessions: await dashboardSessions(stateRoot),
    artifacts: {
      json: resolve2(
        String(args.outputPath ?? previousArtifacts?.json ?? join2(dashboardDir, "dashboard.json"))
      ),
      html: String(previousArtifacts?.html ?? join2(dashboardDir, "index.html"))
    },
    limitations: [DASHBOARD_LIMITATION]
  };
  await writeDashboardHtml(payload.artifacts.html, payload);
  await writeJsonFile2(payload.artifacts.json, payload);
  await writeJsonFile2(statePath, payload);
  return toolJson(payload);
}
async function dashboardSessions(stateRoot) {
  const sessionsDir = join2(stateRoot, "sessions");
  const names = await readdir3(sessionsDir).catch(() => []);
  const sessions = [];
  for (const name of names.sort()) {
    const sessionPath = join2(sessionsDir, name, "session.json");
    const session = asRecord5(await readJsonFile4(sessionPath).catch(() => null));
    if (session) {
      sessions.push({
        sessionId: session.sessionId ?? name,
        name: session.name ?? null,
        activeTargetId: session.activeTargetId ?? null,
        lastSnapshotId: session.lastSnapshotId ?? null,
        updatedAt: session.updatedAt ?? session.createdAt ?? null,
        path: sessionPath
      });
    }
  }
  return sessions;
}
async function writeDashboardHtml(file, payload) {
  await mkdir4(dirname(file), { recursive: true });
  await writeFile4(
    file,
    `<!doctype html>
<html>
<head><meta charset="utf-8"><title>expo98 dashboard</title></head>
<body>
<h1>expo98 dashboard</h1>
<p>Status: ${escapeHtml(payload.status)}</p>
<p>Sessions: ${payload.sessions.length}</p>
<pre>${escapeHtml(JSON.stringify(payload.sessions, null, 2))}</pre>
</body>
</html>
`,
    "utf8"
  );
}
function resolveExpoStateRoot2(args = {}) {
  if (args.stateDir) {
    const resolved = resolve2(args.stateDir);
    return basename2(resolved) === "runs" ? resolve2(join2(resolved, "..")) : resolved;
  }
  const root = resolve2(args.root ?? args.cwd ?? process.cwd());
  return join2(root, ".scratch", "expo98");
}
async function readJsonFile4(file) {
  return JSON.parse(await readFile7(file, "utf8"));
}
async function writeJsonFile2(file, value) {
  await mkdir4(dirname(file), { recursive: true });
  await writeFile4(file, `${JSON.stringify(value, null, 2)}
`, "utf8");
}
function escapeHtml(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function clampNumber6(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`Expected a finite number, got ${String(value)}.`);
  return Math.min(Math.max(number, min), max);
}
function requireString7(value, name) {
  if (typeof value !== "string" || value.trim().length === 0)
    throw new Error(`${name} must be a non-empty string.`);
  return value.trim();
}
function asRecord5(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

// src/commands/debug-inspect-highlight/src/main/index.ts
import { mkdir as fsMkdir, readdir as readdir4, readFile as readFile8, writeFile as fsWriteFile } from "node:fs/promises";
import { basename as basename3, dirname as dirname2, join as join3, resolve as resolve3 } from "node:path";
async function debugInspectCommand(args = {}, deps = {}) {
  return toolJson(await debugInspectPayload(args, deps));
}
async function debugInspectPayload(args = {}, deps = {}) {
  const ref = requireString8(args.ref ?? firstPositional(args), "ref");
  const found = await readRefRecord(ref, args, deps);
  const stateRoot = resolveExpoStateRoot3(args);
  const session = await latestSession(stateRoot, deps);
  if (found.available === false) {
    return {
      ...found,
      action: "inspect",
      sessionId: session?.sessionId ?? null
    };
  }
  const metroPort = clampNumber7(args.metroPort ?? 8081, 1, 65535);
  const metro = await metroStatus({ metroPort }, deps);
  const target = session ? await selectedTarget(stateRoot, session, deps) : null;
  const record = found.record;
  const sessionId = String(session?.sessionId ?? "");
  return {
    available: true,
    action: "inspect",
    ref,
    sessionId: session?.sessionId ?? null,
    snapshotId: found.cache.snapshotId,
    targetId: found.cache.targetId,
    target,
    metro: {
      available: metro.available === true,
      port: metroPort,
      targetCount: metro.targetCount ?? 0,
      firstTarget: metro.targets?.[0] ?? null
    },
    element: {
      ref,
      role: record.role ?? null,
      label: record.label ?? null,
      text: record.text ?? null,
      testID: record.testID ?? record.nativeID ?? null,
      box: record.box ?? null,
      source: record.source ?? null,
      component: record.component ?? null,
      props: asRecord6(record)?.props ?? null,
      actions: record.actions ?? [],
      stale: record.stale === true
    },
    evidence: {
      refCache: join3(sessionDirectory2(stateRoot, sessionId), "refs.json"),
      snapshotId: found.cache.snapshotId
    },
    limitations: [
      "Inspect is assembled from the latest cached semantic/native ref snapshot plus Metro target status.",
      "Props and source are present only when the snapshot source includes them."
    ]
  };
}
async function highlightCommand(args = {}, deps = {}) {
  const ref = requireString8(args.ref ?? firstPositional(args), "ref");
  const found = await readRefRecord(ref, args, deps);
  if (found.available === false) return toolJson({ ...found, action: "highlight" });
  if (!found.record.box) {
    return toolJson({
      available: false,
      action: "highlight",
      ref,
      reason: "Ref does not include bounds. Capture a snapshot with --bounds before highlighting.",
      record: found.record
    });
  }
  const box = asBox(found.record.box);
  if (box.width <= 0 || box.height <= 0) {
    return toolJson({
      available: false,
      action: "highlight",
      ref,
      reason: "Ref bounds are zero-sized, so no useful highlight can be drawn.",
      record: found.record
    });
  }
  const stateRoot = resolveExpoStateRoot3(args);
  const timestamp = (deps.now?.() ?? /* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-");
  const outputPath = resolve3(
    String(
      args.outputPath ?? join3(
        stateRoot,
        "artifacts",
        `highlight-${ref.replace(/[^a-z0-9]/gi, "")}-${timestamp}.svg`
      )
    )
  );
  await (deps.mkdir ?? fsMkdir)(dirname2(outputPath), { recursive: true });
  await (deps.writeFile ?? fsWriteFile)(
    outputPath,
    highlightSvg({ ref, record: found.record, durationMs: args.durationMs }),
    "utf8"
  );
  return toolJson({
    available: true,
    action: "highlight",
    ref,
    durationMs: args.durationMs ?? null,
    snapshotId: found.cache.snapshotId,
    targetId: found.cache.targetId,
    outputPath,
    record: found.record,
    limitations: [
      "Highlight writes an evidence overlay artifact from cached bounds; it does not draw inside the running app."
    ]
  });
}
function highlightSvg({
  ref,
  record,
  durationMs
}) {
  const box = asBox(record.box);
  const width = Math.max(390, Math.ceil(box.x + box.width + 24));
  const height = Math.max(844, Math.ceil(box.y + box.height + 24));
  const label = `${ref} ${record.label ?? record.text ?? record.role ?? ""}`.trim();
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="100%" height="100%" fill="rgba(0,0,0,0.08)"/>
  <rect x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" fill="rgba(255,204,0,0.25)" stroke="#ffcc00" stroke-width="4"/>
  <text x="${Math.max(4, box.x)}" y="${Math.max(18, box.y - 8)}" fill="#111" font-family="Menlo, monospace" font-size="14">${escapeHtml2(label)}</text>
  <text x="8" y="${height - 12}" fill="#444" font-family="Menlo, monospace" font-size="11">${escapeHtml2(durationMs ? `durationMs=${durationMs}` : "static highlight evidence")}</text>
</svg>
`;
}
async function readRefRecord(ref, args = {}, deps = {}) {
  const cache = await readLatestRefCache2(args, deps);
  if (!cache)
    return { available: false, reason: "No snapshot exists for the current session.", ref };
  const record = (cache.refs ?? []).find((item) => item.ref === ref);
  if (!record) return { available: false, reason: "Ref not found in the latest snapshot.", ref };
  if (record.stale)
    return { available: false, reason: "Ref is stale. Capture a new snapshot before acting.", ref };
  return { available: true, record, cache };
}
async function readLatestRefCache2(args = {}, deps = {}) {
  if (deps.readLatestRefCache) return deps.readLatestRefCache(args);
  const stateRoot = resolveExpoStateRoot3(args);
  const session = await readLatestSession2(stateRoot);
  if (!session?.lastSnapshotId) return null;
  const parsed = await readJsonFile5(
    join3(sessionDirectory2(stateRoot, String(session.sessionId)), "refs.json")
  ).catch(() => null);
  return asRefCache2(parsed);
}
async function readLatestSession2(stateRoot) {
  const sessionsRoot = join3(stateRoot, "sessions");
  const entries = await readdir4(sessionsRoot, { withFileTypes: true }).catch(() => []);
  const sessions = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const record = await readJsonFile5(join3(sessionsRoot, entry.name, "session.json")).catch(
      () => null
    );
    const session = asSessionRecord2(record);
    if (session) sessions.push(session);
  }
  sessions.sort(
    (a, b) => String(b.updatedAt ?? b.createdAt).localeCompare(String(a.updatedAt ?? a.createdAt))
  );
  return sessions[0] ?? null;
}
async function readSelectedTarget(stateRoot, session) {
  const parsed = await readJsonFile5(
    join3(sessionDirectory2(stateRoot, String(session.sessionId)), "target.json")
  ).catch(() => null);
  return asTargetRecord(parsed);
}
function resolveExpoStateRoot3(args = {}) {
  if (args.stateDir) {
    const resolved = resolve3(args.stateDir);
    return basename3(resolved) === "runs" ? resolve3(join3(resolved, "..")) : resolved;
  }
  const root = resolve3(args.root ?? args.cwd ?? process.cwd());
  return join3(root, ".scratch", "expo98");
}
function sessionDirectory2(stateRoot, sessionId) {
  return join3(stateRoot, "sessions", sessionId);
}
async function readJsonFile5(file) {
  return JSON.parse(await readFile8(file, "utf8"));
}
function requireString8(value, name) {
  if (typeof value !== "string" || value.trim().length === 0)
    throw new Error(`${name} must be a non-empty string.`);
  return value.trim();
}
function clampNumber7(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`Expected a finite number, got ${String(value)}.`);
  return Math.min(Math.max(number, min), max);
}
function escapeHtml2(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
async function latestSession(stateRoot, deps) {
  return deps.readLatestSession ? deps.readLatestSession(stateRoot) : readLatestSession2(stateRoot);
}
async function selectedTarget(stateRoot, session, deps) {
  return deps.readSelectedTarget ? deps.readSelectedTarget(stateRoot, session) : readSelectedTarget(stateRoot, session);
}
async function metroStatus(args, deps) {
  return deps.metroStatusPayload ? deps.metroStatusPayload(args) : { available: false, targetCount: 0, targets: [] };
}
function asBox(value) {
  const record = asRecord6(value);
  const x = Number(record?.x);
  const y = Number(record?.y);
  const width = Number(record?.width);
  const height = Number(record?.height);
  if (![x, y, width, height].every(Number.isFinite))
    throw new Error("record.box must include finite x, y, width, and height.");
  return { x, y, width, height };
}
function firstPositional(args) {
  return Array.isArray(args._) ? args._[0] : void 0;
}
function asRecord6(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}
function asRefCache2(value) {
  const record = asRecord6(value);
  if (!record || !Array.isArray(record.refs)) return null;
  return record;
}
function asSessionRecord2(value) {
  const record = asRecord6(value);
  return typeof record?.sessionId === "string" ? record : null;
}
function asTargetRecord(value) {
  const record = asRecord6(value);
  return typeof record?.targetId === "string" ? record : null;
}

// src/commands/device-listing/src/main/index.ts
import { execFile as nodeExecFile5 } from "node:child_process";
var MAX_OUTPUT6 = 4e4;
function clampNumber8(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new Error(`Expected a finite number, got ${String(value)}.`);
  }
  return Math.min(Math.max(number, min), max);
}
async function safeToolSection(fn) {
  try {
    return { ok: true, value: await fn() };
  } catch (error) {
    return { ok: false, error: formatError7(error) };
  }
}
async function listIosPhysicalDevices(limit, dependencies) {
  const { stdout } = await dependencies.execFile(
    "xcrun",
    ["devicectl", "list", "devices", "--json-output", "-"],
    {
      timeout: 2e4,
      maxBuffer: 4 * 1024 * 1024
    }
  );
  const parsed = JSON.parse(stdout);
  const devices = devicesFromPhysicalPayload(parsed);
  return devices.slice(0, limit).map((device) => ({
    name: stringOrNull(deviceProperty(device, "deviceProperties", "name") ?? device.name),
    identifier: stringOrNull(device.identifier ?? device.udid),
    platform: stringOrNull(
      deviceProperty(device, "deviceProperties", "platform") ?? device.platform
    ),
    model: stringOrNull(
      deviceProperty(device, "hardwareProperties", "marketingName") ?? device.model
    ),
    connectionType: stringOrNull(
      deviceProperty(device, "connectionProperties", "transportType") ?? device.connectionType
    ),
    state: stringOrNull(
      deviceProperty(device, "connectionProperties", "pairingState") ?? device.state
    )
  }));
}
async function listDevices(args = {}, dependencies = defaultDeviceListingDependencies) {
  const platform = args.platform ?? "all";
  const limit = clampNumber8(args.limit ?? 40, 1, 200);
  const payload = {};
  if (platform === "ios" || platform === "all") {
    payload.ios = await safeToolSection(async () => listIosSimulators(limit, dependencies));
    payload.iosPhysical = await safeToolSection(
      async () => listIosPhysicalDevices(limit, dependencies)
    );
  }
  if (platform === "android" || platform === "all") {
    payload.android = await safeToolSection(async () => listAndroidDevices(limit, dependencies));
  }
  return toolJson(payload);
}
var defaultDeviceListingDependencies = {
  execFile: (file, args, options = {}) => new Promise((resolve18, reject) => {
    nodeExecFile5(
      file,
      args,
      {
        timeout: options.timeout,
        maxBuffer: options.maxBuffer
      },
      (error, stdout, stderr) => {
        if (error) {
          Object.assign(error, { stdout, stderr });
          reject(error);
          return;
        }
        resolve18({ stdout: String(stdout ?? ""), stderr: String(stderr ?? "") });
      }
    );
  })
};
async function listAndroidDevices(limit, dependencies) {
  const { stdout } = await dependencies.execFile("adb", ["devices", "-l"], { timeout: 2e4 });
  return stdout.split(/\r?\n/).slice(1).map((line) => line.trim()).filter(Boolean).map((line) => {
    const [serial = "", state = "", ...details] = line.split(/\s+/);
    return { serial, state, details: details.join(" ") };
  }).slice(0, limit);
}
async function listIosSimulators(limit, dependencies) {
  const { stdout } = await dependencies.execFile(
    "xcrun",
    ["simctl", "list", "devices", "available", "--json"],
    {
      timeout: 2e4,
      maxBuffer: 4 * 1024 * 1024
    }
  );
  const parsed = JSON.parse(stdout);
  const devices = isRecord5(parsed) && isRecord5(parsed.devices) ? parsed.devices : {};
  return Object.entries(devices).flatMap(([runtime2, runtimeDevices]) => {
    if (!Array.isArray(runtimeDevices)) throw new Error(`devices.${runtime2} must be an array.`);
    return runtimeDevices.map((device) => {
      const record = isRecord5(device) ? device : {};
      return {
        runtime: runtime2,
        name: record.name,
        udid: record.udid,
        state: record.state,
        isAvailable: record.isAvailable
      };
    });
  }).sort(
    (left, right) => Number(right.state === "Booted") - Number(left.state === "Booted") || String(left.name).localeCompare(String(right.name))
  ).slice(0, limit);
}
function deviceProperty(device, objectKey, propertyKey) {
  const parent = device[objectKey];
  return isRecord5(parent) ? parent[propertyKey] : void 0;
}
function devicesFromPhysicalPayload(value) {
  if (!isRecord5(value)) throw new Error("physical device payload must be an object.");
  const rawDevices = isRecord5(value.result) && "devices" in value.result ? value.result.devices : value.devices;
  if (!Array.isArray(rawDevices)) throw new Error("physical devices must be an array.");
  return rawDevices.map((device) => {
    if (!isRecord5(device)) throw new Error("physical device entry must be an object.");
    return device;
  });
}
function formatError7(error) {
  if (!error) return "Unknown error";
  const record = isRecord5(error) ? error : {};
  const message = error instanceof Error ? error.message : String(error);
  const parts = [message];
  if (record.stdout) parts.push(`stdout:
${truncate7(record.stdout)}`);
  if (record.stderr) parts.push(`stderr:
${truncate7(record.stderr)}`);
  return parts.join("\n\n");
}
function isRecord5(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function stringOrNull(value) {
  return value == null ? null : String(value);
}
function truncate7(value, limit = MAX_OUTPUT6) {
  const text = String(value ?? "");
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}
[truncated ${text.length - limit} characters]`;
}

// src/commands/devtools-diagnostics/src/main/index.ts
var DEVTOOLS_EVENTS_LIMITATIONS = [
  "This v1 collector records DevTools capability/session events, not a raw Chrome DevTools Protocol stream."
];
var DIAGNOSTICS_LIMITATIONS = [
  "Start Metro and connect a debuggable Hermes target before reading JS diagnostics."
];
var MAX_OUTPUT7 = 4e4;
var MAX_ARRAY_ITEMS2 = 500;
var defaultDevtoolsDiagnosticsDependencies = {
  evaluateHermesExpression
};
function sanitizedToolJson(value) {
  return { content: [{ type: "text", text: JSON.stringify(sanitizePayload2(value), null, 2) }] };
}
function requireString9(value, name) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${name} must be a non-empty string.`);
  }
  return value.trim();
}
function clampNumber9(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new Error(`Expected a finite number, got ${String(value)}.`);
  }
  return Math.min(Math.max(number, min), max);
}
function truncate8(value, max = MAX_OUTPUT7) {
  const text = String(value ?? "");
  if (text.length <= max) return text;
  return `${text.slice(0, max)}
...[truncated ${text.length - max} chars]`;
}
function targetSummary3(target) {
  if (!target) return null;
  return {
    id: target.id ?? null,
    title: target.title ?? null,
    description: target.description ?? null,
    appId: target.appId ?? null,
    deviceName: target.deviceName ?? null,
    devtoolsFrontendUrl: target.devtoolsFrontendUrl ?? null,
    webSocketDebuggerUrl: target.webSocketDebuggerUrl ?? null,
    reactNative: target.reactNative ?? null,
    capabilities: target.capabilities ?? {
      hermesRuntime: typeof target.webSocketDebuggerUrl === "string" && target.webSocketDebuggerUrl.startsWith("ws"),
      devtoolsFrontend: typeof target.devtoolsFrontendUrl === "string" && target.devtoolsFrontendUrl.length > 0,
      reactNative: Boolean(target.reactNative)
    }
  };
}
async function devtoolsCommand(args = {}, deps = defaultDevtoolsDiagnosticsDependencies) {
  const action = requireString9(args.action ?? "capabilities", "action");
  if (action === "status" || action === "panels")
    return sanitizedToolJson(await devtoolsStatusPayload(args, action, deps));
  if (action === "open") return sanitizedToolJson(await devtoolsOpenPayload(args, deps));
  if (action === "events") return sanitizedToolJson(await devtoolsEventsPayload(args, deps));
  if (action !== "capabilities") throw new Error(`Unknown devtools action: ${action}`);
  const metro = await metroStatusPayload2(args, deps);
  const rnDevTools = reactNativeDevToolsReport(metro);
  const hasTarget = metro.targets.length > 0;
  const hasRuntime = metro.targets.some((target) => target.webSocketDebuggerUrl);
  const hasDevtoolsFrontend = rnDevTools.frontend.available;
  const hasNetworkPanel = metro.targets.some(targetHasDevtoolsNetworkPanel);
  return sanitizedToolJson({
    action,
    metroPort: metro.metroPort,
    reactNativeDevTools: rnDevTools,
    capabilities: [
      capabilityRecord({
        name: "metro-http",
        source: "metro",
        transport: "http",
        available: metro.available,
        confidence: metro.available ? "high" : "low",
        reason: metro.available ? null : metro.reason ?? null,
        readCommands: ["metro status", "target list", "devtools capabilities"],
        writeCommands: [],
        artifactTypes: ["json"],
        repairHints: metro.available ? [] : ["Start Metro for the Maddie Native app and rerun with the correct --metro-port."],
        limitations: metro.available ? [
          "Reports Metro server and target discovery only; it does not prove the app UI is ready."
        ] : ["Metro was not reachable on the requested port."]
      }),
      capabilityRecord({
        name: "metro-symbolication",
        source: "metro",
        transport: "http",
        available: metro.symbolication.available,
        confidence: metro.symbolication.available ? "high" : "low",
        reason: metro.symbolication.available ? null : metro.symbolication.reason ?? null,
        readCommands: ["metro symbolicate"],
        writeCommands: [],
        artifactTypes: ["json"],
        repairHints: metro.symbolication.available ? [] : ["Confirm Metro is serving the current bundle and source maps."],
        limitations: metro.symbolication.available ? ["Symbolication quality depends on source maps for the current bundle."] : ["The Metro /symbolicate endpoint did not accept a probe request."]
      }),
      capabilityRecord({
        name: "hermes-runtime",
        source: "hermes-inspector",
        transport: "websocket",
        available: hasRuntime,
        confidence: hasRuntime ? "medium" : "low",
        reason: hasRuntime ? null : hasTarget ? "No target exposes a websocket debugger URL." : "No Metro inspector target.",
        readCommands: ["console", "errors", "rn tree", "trace --action read"],
        writeCommands: [
          "trace --action start",
          "trace --action stop",
          "inspector install-comment-menu"
        ],
        artifactTypes: ["json", "run-record"],
        repairHints: hasRuntime ? [] : [
          "Open Maddie Native in a debuggable development build and confirm /json/list includes webSocketDebuggerUrl."
        ],
        limitations: hasRuntime ? ["Runtime signals are unavailable in disconnected, production, or non-Hermes targets."] : [
          "Console, errors, React tree, and runtime globals cannot be read without an inspector websocket."
        ]
      }),
      capabilityRecord({
        name: "react-native-devtools",
        source: "react-native-devtools",
        transport: "metro-http",
        available: hasDevtoolsFrontend,
        confidence: hasDevtoolsFrontend ? "medium" : "low",
        reason: hasDevtoolsFrontend ? null : "No target advertises a React Native DevTools frontend URL.",
        readCommands: ["devtools status", "devtools panels", "devtools open"],
        writeCommands: ["devtools open"],
        artifactTypes: ["json"],
        repairHints: hasDevtoolsFrontend ? [] : ["Connect a React Native target to Metro that advertises devtoolsFrontendUrl."],
        limitations: hasDevtoolsFrontend ? [
          "The CLI can open and report the DevTools frontend; interactive panel state remains owned by React Native DevTools."
        ] : ["React Native DevTools cannot be opened without a Metro target frontend URL."]
      }),
      capabilityRecord({
        name: "react-native-devtools-network-panel",
        source: "react-native-devtools",
        transport: "metro-http",
        available: hasNetworkPanel,
        confidence: hasNetworkPanel ? "medium" : "low",
        reason: hasNetworkPanel ? null : "No target advertises unstable_enableNetworkPanel=true in its DevTools frontend URL.",
        readCommands: ["devtools panels", "devtools open"],
        writeCommands: [],
        artifactTypes: ["human-visible-panel"],
        repairHints: hasNetworkPanel ? [] : [
          "Enable or connect a React Native DevTools target whose frontend URL includes unstable_enableNetworkPanel=true."
        ],
        limitations: hasNetworkPanel ? [
          "The panel is an interactive DevTools UI surface; command-line HAR/export still uses app bridge evidence."
        ] : [
          "Use the app network bridge for CLI-readable request evidence when the DevTools network panel is absent."
        ]
      }),
      capabilityRecord({
        name: "console",
        source: "runtime-diagnostics",
        transport: "hermes-runtime",
        available: hasRuntime,
        confidence: hasRuntime ? "medium" : "low",
        reason: hasRuntime ? null : "No runtime diagnostics source is available.",
        readCommands: ["console"],
        writeCommands: [],
        artifactTypes: ["json", "run-record"],
        repairHints: hasRuntime ? [] : [
          "Connect Hermes runtime and install diagnostics instrumentation if the buffer is empty."
        ],
        limitations: [
          "JS console diagnostics require app/runtime instrumentation or a readable runtime buffer.",
          "Native device logs are a different evidence stream; use logs for those."
        ]
      }),
      capabilityRecord({
        name: "errors",
        source: "runtime-diagnostics",
        transport: "hermes-runtime",
        available: hasRuntime,
        confidence: hasRuntime ? "medium" : "low",
        reason: hasRuntime ? null : "No runtime diagnostics source is available.",
        readCommands: ["errors"],
        writeCommands: [],
        artifactTypes: ["json", "run-record"],
        repairHints: hasRuntime ? [] : ["Connect Hermes runtime and verify the app exposes bounded error diagnostics."],
        limitations: [
          "Error diagnostics depend on runtime buffers and may not include native crashes.",
          "Use logs and trace evidence for lower-level failures."
        ]
      })
    ],
    metro
  });
}
async function devtoolsStatusPayload(args = {}, action = "status", deps = {}) {
  const metro = await metroStatusPayload2(args, deps);
  const reactNativeDevTools = reactNativeDevToolsReport(metro);
  const panels = reactNativeDevTools.panels;
  const payload = {
    available: metro.available,
    action,
    metroPort: metro.metroPort,
    metro,
    target: reactNativeDevTools.target,
    frontend: reactNativeDevTools.frontend,
    attachmentState: reactNativeDevTools.attachmentState,
    attachmentRisk: reactNativeDevTools.attachmentRisk,
    panels,
    machineReadableDomains: panels.filter((panel) => panel.kind === "machine-readable-domain"),
    humanVisiblePanels: panels.filter((panel) => panel.kind === "human-visible-panel")
  };
  return sanitizePayload2(payload);
}
function reactNativeDevToolsReport(metro) {
  const target = metro.targets.find((item) => item.devtoolsFrontendUrl) ?? metro.targets[0] ?? null;
  const frontendUrl = frontendUrlForTarget(target, metro.metroPort);
  const hasNetworkPanel = targetHasDevtoolsNetworkPanel(target);
  const hasRuntime = Boolean(target?.webSocketDebuggerUrl);
  const attachmentState = detectDevToolsAttachmentState(target);
  const attachmentRisk = {
    level: hasRuntime || frontendUrl ? "medium" : "low",
    mayDetachHumanDebugger: Boolean(hasRuntime || frontendUrl),
    reason: hasRuntime || frontendUrl ? "Opening React Native DevTools can attach to the selected target and may affect an existing human debugger session." : "No debuggable React Native target is available."
  };
  const panels = [
    devtoolsPanelRecord({
      name: "debugger",
      kind: "human-visible-panel",
      available: Boolean(frontendUrl),
      transport: "react-native-devtools",
      source: "devtoolsFrontendUrl",
      readCommands: ["devtools open"],
      writeCommands: ["devtools open"],
      artifactTypes: ["human-visible-panel"],
      limitations: ["Interactive debugger state is owned by React Native DevTools."],
      repairHints: frontendUrl ? [] : ["Connect a Metro target that advertises devtoolsFrontendUrl."]
    }),
    devtoolsPanelRecord({
      name: "network",
      kind: "human-visible-panel",
      available: hasNetworkPanel,
      transport: "react-native-devtools",
      source: "devtoolsFrontendUrl",
      readCommands: ["devtools panels", "devtools open"],
      writeCommands: [],
      artifactTypes: ["human-visible-panel"],
      limitations: [
        "The network panel is human-visible; CLI-readable HAR still requires network bridge evidence."
      ],
      repairHints: hasNetworkPanel ? [] : ["Use the app network bridge or connect a target with unstable_enableNetworkPanel=true."]
    }),
    devtoolsPanelRecord({
      name: "console",
      kind: "machine-readable-domain",
      available: hasRuntime,
      transport: "hermes-runtime",
      source: "runtime-diagnostics",
      readCommands: ["console"],
      writeCommands: [],
      artifactTypes: ["json", "run-record"],
      limitations: ["Requires a readable runtime diagnostics buffer for bounded CLI output."],
      repairHints: hasRuntime ? [] : ["Connect Hermes runtime and enable app diagnostics instrumentation."]
    }),
    devtoolsPanelRecord({
      name: "errors",
      kind: "machine-readable-domain",
      available: hasRuntime,
      transport: "hermes-runtime",
      source: "runtime-diagnostics",
      readCommands: ["errors"],
      writeCommands: [],
      artifactTypes: ["json", "run-record"],
      limitations: ["Runtime JS errors are separate from native crash reports."],
      repairHints: hasRuntime ? [] : ["Connect Hermes runtime and use logs/crash reports for native failures."]
    }),
    devtoolsPanelRecord({
      name: "react-components",
      kind: "machine-readable-domain",
      available: hasRuntime,
      transport: "react-devtools-hook",
      source: "react-devtools-hook",
      readCommands: ["rn tree", "rn inspect", "snapshot"],
      writeCommands: [],
      artifactTypes: ["json", "run-record"],
      limitations: [
        "Component tree evidence depends on development runtime hooks and may omit private fiber details."
      ],
      repairHints: hasRuntime ? [] : ["Connect Hermes runtime and confirm React DevTools hook availability."]
    })
  ];
  return sanitizePayload2({
    target,
    frontend: {
      available: Boolean(frontendUrl),
      url: frontendUrl,
      launchPath: frontendUrl ? "metro-devtools-frontend-url" : null
    },
    attachmentState,
    attachmentRisk,
    panels
  });
}
async function devtoolsOpenPayload(args = {}, deps = {}) {
  const metro = await metroStatusPayload2(args, deps);
  const reactNativeDevTools = reactNativeDevToolsReport(metro);
  const target = reactNativeDevTools.target;
  const url = reactNativeDevTools.frontend.url;
  if (!url) {
    return sanitizePayload2({
      available: false,
      action: "open",
      reason: "No DevTools frontend URL is available.",
      metro,
      reactNativeDevTools
    });
  }
  const result = await execFile2(deps, "open", [url], { timeout: 1e4, rejectOnError: false });
  return sanitizePayload2({
    available: !result.error,
    action: "open",
    url,
    target,
    launchPath: "metro-devtools-frontend-url",
    mirrorsUpstreamLaunch: true,
    attachmentState: reactNativeDevTools.attachmentState,
    attachmentRisk: reactNativeDevTools.attachmentRisk,
    stdout: truncate8(result.stdout),
    stderr: truncate8(result.stderr),
    error: result.error ?? null
  });
}
async function devtoolsEventsPayload(args = {}, deps = {}) {
  const subaction = requireString9(args.subaction ?? "read", "subaction");
  if (!["start", "read", "stop"].includes(subaction))
    throw new Error(`Unknown devtools events action: ${subaction}`);
  const stateRoot = resolveExpoStateRoot4(args, deps);
  const eventsDir = joinPath2(stateRoot, "artifacts", "devtools-events");
  await mkdir5(deps, eventsDir, { recursive: true });
  const file = joinPath2(eventsDir, "events.json");
  const existing = await readJsonFile6(deps, file).catch(() => ({ events: [] }));
  const previousEvents = Array.isArray(asRecord7(existing)?.events) ? asRecord7(existing)?.events : [];
  const event = {
    type: `devtools.${subaction}`,
    timestamp: now(deps),
    metro: sanitizePayload2(await metroStatusPayload2(args, deps))
  };
  const payload = {
    available: true,
    action: "events",
    subaction,
    artifact: file,
    events: subaction === "start" ? [event] : [...previousEvents, event],
    limitations: DEVTOOLS_EVENTS_LIMITATIONS
  };
  const sanitized = sanitizePayload2(payload);
  await writeJsonFile3(deps, file, sanitized);
  return sanitized;
}
async function consoleCommand(args = {}, deps = defaultDevtoolsDiagnosticsDependencies) {
  return diagnosticMessagesCommand("console", args, deps);
}
async function errorsCommand(args = {}, deps = defaultDevtoolsDiagnosticsDependencies) {
  return diagnosticMessagesCommand("errors", args, deps);
}
async function diagnosticMessagesCommand(kind, args = {}, deps = defaultDevtoolsDiagnosticsDependencies) {
  const action = args.action ?? "read";
  const metroPort = clampNumber9(args.metroPort ?? 8081, 1, 65535);
  const limit = clampNumber9(args.limit ?? 100, 1, 1e3);
  const targetDiscovery = await metroTargetDiscovery(metroPort, deps);
  const targets = targetDiscovery.targets;
  const webSocketDebuggerUrl = targets[0]?.webSocketDebuggerUrl ?? null;
  if (!webSocketDebuggerUrl) {
    return sanitizedToolJson({
      available: false,
      kind,
      source: "hermes-runtime",
      reason: targetDiscovery.reason ?? "No Metro inspector target.",
      metroPort,
      messages: [],
      targetDiscovery,
      limitations: DIAGNOSTICS_LIMITATIONS
    });
  }
  if (action === "clear") {
    const result2 = await evaluateHermesExpression2(
      deps,
      webSocketDebuggerUrl,
      clearDiagnosticsExpression(kind),
      { timeoutMs: 5e3 }
    );
    const value2 = valueFromHermes(result2);
    return sanitizedToolJson({
      ...value2 && typeof value2 === "object" && !Array.isArray(value2) ? value2 : {
        available: false,
        reason: result2?.error ?? "Runtime diagnostics did not return a value."
      },
      kind,
      action,
      metroPort,
      target: targetSummary3(targets[0]),
      cdp: result2?.diagnostics ?? result2?.cdp ?? null
    });
  }
  const result = await evaluateHermesExpression2(
    deps,
    webSocketDebuggerUrl,
    diagnosticsExpression({ kind, limit }),
    { timeoutMs: 5e3 }
  );
  const value = valueFromHermes(result);
  if (!value) {
    return sanitizedToolJson({
      available: false,
      kind,
      source: "hermes-runtime",
      reason: result?.error ?? "Runtime diagnostics did not return a value.",
      metroPort,
      messages: [],
      cdp: result?.diagnostics ?? result?.cdp ?? null
    });
  }
  const record = asRecord7(value) ?? {};
  const messages = Array.isArray(record.messages) ? record.messages.slice(-limit) : [];
  return sanitizedToolJson({
    ...record,
    kind,
    metroPort,
    target: targetSummary3(targets[0]),
    messages,
    limit,
    cdp: result?.diagnostics ?? result?.cdp ?? null
  });
}
function diagnosticsExpression({ kind, limit }) {
  return `(() => {
    const kind = ${JSON.stringify(kind)};
    const limit = ${Number(limit)};
    const diagnostics = globalThis.__EXPO98_DIAGNOSTICS__ || globalThis.__EXPO_IOS_DIAGNOSTICS__ || globalThis.__CODEX_DIAGNOSTICS__ || {};
    const raw = diagnostics[kind] || diagnostics[kind === 'errors' ? 'error' : 'logs'] || [];
    const messages = Array.isArray(raw) ? raw.slice(-limit).map((entry, index) => ({
      index,
      level: entry && typeof entry === 'object' ? (entry.level || (kind === 'errors' ? 'error' : 'log')) : (kind === 'errors' ? 'error' : 'log'),
      message: entry && typeof entry === 'object' ? String(entry.message || entry.text || entry.value || '') : String(entry),
      timestamp: entry && typeof entry === 'object' ? (entry.timestamp || entry.time || null) : null,
      source: entry && typeof entry === 'object' ? (entry.source || null) : null,
      stack: entry && typeof entry === 'object' ? (entry.stack || null) : null
    })) : [];
    return {
      available: Array.isArray(raw),
      source: Array.isArray(raw) ? 'runtime-diagnostics-buffer' : 'missing-runtime-diagnostics-buffer',
      total: Array.isArray(raw) ? raw.length : 0,
      messages,
      limitations: Array.isArray(raw)
        ? ['Runtime diagnostics reflect the app-provided buffer; native logs are not included.']
        : ['Install or enable runtime diagnostics instrumentation to populate this buffer.']
    };
  })()`;
}
function capabilityRecord(args) {
  return {
    name: args.name,
    source: args.source,
    transport: args.transport,
    available: args.available === true,
    confidence: args.confidence,
    reason: args.reason,
    readCommands: args.readCommands ?? [],
    writeCommands: args.writeCommands ?? [],
    artifactTypes: args.artifactTypes ?? [],
    repairHints: args.repairHints ?? [],
    limitations: args.limitations
  };
}
function detectDevToolsAttachmentState(target) {
  if (!target) return { state: "unavailable", detectable: false, reason: "No Metro target." };
  const raw = target.reactNative ?? {};
  const attached = raw.debuggerFrontendConnected ?? raw.debuggerConnected ?? raw.isDebuggerConnected ?? target.attached;
  if (attached === true) return { state: "attached", detectable: true };
  if (attached === false) return { state: "not-attached", detectable: true };
  return {
    state: "unknown",
    detectable: false,
    reason: "Metro target metadata did not expose debugger attachment state."
  };
}
function targetHasDevtoolsNetworkPanel(target) {
  const url = target?.devtoolsFrontendUrl;
  if (!url) return false;
  try {
    const parsed = new URL(url, "http://127.0.0.1");
    return parsed.searchParams.get("unstable_enableNetworkPanel") === "true";
  } catch {
    return /[?&]unstable_enableNetworkPanel=true(?:&|$)/.test(String(url));
  }
}
function devtoolsPanelRecord(args) {
  return {
    name: args.name,
    kind: args.kind,
    machineReadable: args.kind === "machine-readable-domain",
    humanVisible: args.kind === "human-visible-panel",
    available: args.available === true,
    transport: args.transport,
    source: args.source,
    readCommands: args.readCommands,
    writeCommands: args.writeCommands,
    artifactTypes: args.artifactTypes,
    limitations: args.limitations,
    repairHints: args.repairHints
  };
}
function frontendUrlForTarget(target, metroPort) {
  const url = target?.devtoolsFrontendUrl;
  if (!url) return null;
  return url.startsWith("http") ? url : `http://127.0.0.1:${metroPort}${url}`;
}
async function metroStatusPayload2(args, deps) {
  if (deps.metroStatusPayload) return deps.metroStatusPayload(args);
  const metroPort = clampNumber9(args.metroPort ?? 8081, 1, 65535);
  const baseUrl = `http://127.0.0.1:${metroPort}`;
  const status = await fetchText(deps, `${baseUrl}/status`, 1500);
  if (!status.available) {
    return {
      available: false,
      reason: "Metro is not reachable on the requested port.",
      metroPort,
      status: "unavailable",
      statusText: null,
      error: status.error,
      symbolication: { available: false, reason: "Metro is unavailable." },
      targetCount: 0,
      targets: []
    };
  }
  const targetDiscovery = await fetchMetroTargets(deps, metroPort);
  const version = await fetchJson(deps, `${baseUrl}/json/version`, 1500).catch((error) => ({
    __error: formatError8(error)
  }));
  const symbolication = await probeMetroSymbolication(deps, metroPort);
  return {
    available: true,
    reason: null,
    metroPort,
    status: "available",
    statusText: status.text,
    version: asRecord7(version)?.__error ? null : version,
    versionError: asRecord7(version)?.__error ?? null,
    symbolication,
    targetCount: targetDiscovery.targets.length,
    targets: targetDiscovery.targets,
    targetDiscovery
  };
}
async function fetchMetroTargets(deps, metroPort) {
  const raw = await fetchJson(deps, `http://127.0.0.1:${metroPort}/json/list`, 2500).catch(
    (error2) => ({
      __error: formatError8(error2)
    })
  );
  const error = asRecord7(raw)?.__error;
  if (typeof error === "string") {
    return {
      available: false,
      endpoint: "/json/list",
      targets: [],
      malformedTargets: [],
      reason: error
    };
  }
  if (!Array.isArray(raw)) {
    return {
      available: false,
      endpoint: "/json/list",
      targets: [],
      malformedTargets: [
        { index: null, reason: "Metro target list was not an array.", shape: responseShape2(raw) }
      ],
      reason: "Metro target list was malformed."
    };
  }
  const targets = [];
  const malformedTargets = [];
  raw.forEach((entry, index) => {
    const normalized = normalizeMetroTarget(entry, index);
    if (normalized.target) targets.push(normalized.target);
    if (normalized.error) malformedTargets.push(normalized.error);
  });
  return {
    available: true,
    endpoint: "/json/list",
    targets,
    malformedTargets,
    reason: malformedTargets.length > 0 ? "Some Metro targets were malformed and skipped." : null
  };
}
async function metroTargetDiscovery(metroPort, deps) {
  if (typeof deps.targetDiscovery === "function") return deps.targetDiscovery(metroPort);
  if (deps.targetDiscovery) return deps.targetDiscovery;
  return fetchMetroTargets(deps, metroPort);
}
function clearDiagnosticsExpression(kind) {
  return `(() => {
      const diagnostics = globalThis.__EXPO98_DIAGNOSTICS__ || globalThis.__EXPO_IOS_DIAGNOSTICS__ || globalThis.__CODEX_DIAGNOSTICS__;
      if (!diagnostics) return { available: false, cleared: false, reason: 'Runtime diagnostics buffer is not installed.' };
      if (Array.isArray(diagnostics[${JSON.stringify(kind)}])) diagnostics[${JSON.stringify(kind)}].length = 0;
      return { available: true, cleared: true };
    })()`;
}
async function evaluateHermesExpression2(deps, webSocketDebuggerUrl, expression, options) {
  const evaluate = deps.evaluateHermesExpression ?? evaluateHermesExpression;
  return evaluate(webSocketDebuggerUrl, expression, options);
}
function valueFromHermes(result) {
  return result?.result?.result?.value;
}
async function execFile2(deps, file, args, options) {
  if (deps.execFile) return deps.execFile(file, args, options);
  const childProcess = await import("node:child_process");
  return new Promise((resolve18) => {
    childProcess.execFile(file, args, { timeout: options.timeout }, (error, stdout, stderr) => {
      resolve18({
        stdout,
        stderr,
        error: error ? formatError8(error) : null
      });
    });
  });
}
function resolveExpoStateRoot4(args, deps) {
  if (deps.resolveExpoStateRoot) return deps.resolveExpoStateRoot(args);
  const explicit = typeof args.stateDir === "string" && args.stateDir.length > 0 ? args.stateDir : null;
  if (explicit?.endsWith("/runs")) return explicit.slice(0, -"/runs".length);
  return explicit ?? joinPath2(typeof args.root === "string" ? args.root : ".", ".scratch", "expo98");
}
async function mkdir5(deps, dir, options) {
  if (deps.mkdir) return deps.mkdir(dir, options);
  const fs10 = await import("node:fs/promises");
  return fs10.mkdir(dir, options);
}
async function readJsonFile6(deps, file) {
  if (!deps.readJsonFile) {
    const fs10 = await import("node:fs/promises");
    return JSON.parse(await fs10.readFile(file, "utf8"));
  }
  return deps.readJsonFile(file);
}
async function writeJsonFile3(deps, file, payload) {
  const redacted = sanitizePayload2(deps.redactValue ? deps.redactValue(payload) : payload);
  if (!deps.writeJsonFile) {
    const fs10 = await import("node:fs/promises");
    await fs10.writeFile(file, `${JSON.stringify(redacted, null, 2)}
`, "utf8");
    return void 0;
  }
  return deps.writeJsonFile(file, redacted);
}
function now(deps) {
  return deps.now ? deps.now() : (/* @__PURE__ */ new Date()).toISOString();
}
function joinPath2(...parts) {
  const absolute = parts[0]?.startsWith("/") === true;
  const joined = parts.flatMap((part) => part.split("/")).filter((part, index) => part.length > 0 || absolute && index === 0).join("/");
  return absolute ? `/${joined}`.replace(/\/+/g, "/") : joined.replace(/\/+/g, "/");
}
function asRecord7(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}
async function probeMetroSymbolication(deps, metroPort) {
  try {
    const response = asFetchResponse(
      await fetchWithTimeout2(deps, `http://127.0.0.1:${metroPort}/symbolicate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ stack: [] }),
        timeoutMs: 1500
      })
    );
    return {
      available: response.ok,
      endpoint: "/symbolicate",
      status: response.status,
      reason: response.ok ? null : `Metro symbolicate HTTP ${response.status}`
    };
  } catch (error) {
    return { available: false, endpoint: "/symbolicate", status: null, reason: formatError8(error) };
  }
}
async function fetchText(deps, url, timeoutMs) {
  try {
    const response = asFetchResponse(await fetchWithTimeout2(deps, url, { timeoutMs }));
    return {
      available: response.ok,
      text: await response.text(),
      error: response.ok ? null : `HTTP ${response.status}`
    };
  } catch (error) {
    return { available: false, text: null, error: formatError8(error) };
  }
}
async function fetchJson(deps, url, timeoutMs) {
  const response = asFetchResponse(await fetchWithTimeout2(deps, url, { timeoutMs }));
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}
async function fetchWithTimeout2(deps, url, options) {
  const fetcher = deps.fetch ?? globalThis.fetch;
  if (!fetcher) throw new Error("fetch is not available in this runtime.");
  const timeoutMs = Number(options.timeoutMs ?? 1500);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const { timeoutMs: _timeoutMs, ...requestOptions } = options;
    return await fetcher(url, { ...requestOptions, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
function asFetchResponse(value) {
  const response = value;
  return {
    ok: response.ok === true,
    status: typeof response.status === "number" ? response.status : 0,
    text: typeof response.text === "function" ? response.text.bind(response) : async () => "",
    json: typeof response.json === "function" ? response.json.bind(response) : async () => null
  };
}
function normalizeMetroTarget(value, index) {
  const record = asRecord7(value);
  if (!record) {
    return {
      target: null,
      error: { index, reason: "Target was not an object.", shape: responseShape2(value) }
    };
  }
  const target = {
    id: optionalString4(record.id),
    title: optionalString4(record.title),
    description: optionalString4(record.description),
    appId: optionalString4(record.appId),
    deviceName: optionalString4(record.deviceName),
    devtoolsFrontendUrl: optionalString4(record.devtoolsFrontendUrl),
    webSocketDebuggerUrl: optionalString4(record.webSocketDebuggerUrl),
    reactNative: asRecord7(record.reactNative),
    attached: record.attached
  };
  if (!target.id && !target.title && !target.webSocketDebuggerUrl && !target.devtoolsFrontendUrl) {
    return {
      target: null,
      error: {
        index,
        reason: "Target did not include any stable identifying metadata.",
        shape: responseShape2(value)
      }
    };
  }
  return { target, error: null };
}
function optionalString4(value) {
  return typeof value === "string" && value.length > 0 ? value : null;
}
function responseShape2(value) {
  if (Array.isArray(value)) return { type: "array", length: value.length };
  if (value && typeof value === "object")
    return { type: "object", keys: Object.keys(value).slice(0, 20) };
  return { type: typeof value };
}
function sanitizePayload2(value) {
  return boundValue2(redactValue3(value));
}
function boundValue2(value) {
  if (typeof value === "string") return truncate8(value);
  if (Array.isArray(value)) return value.slice(-MAX_ARRAY_ITEMS2).map(boundValue2);
  const record = asRecord7(value);
  if (!record) return value;
  return Object.fromEntries(
    Object.entries(record).map(([key, nested]) => [key, boundValue2(nested)])
  );
}
function redactValue3(value) {
  if (typeof value === "string") return redactString2(value);
  if (Array.isArray(value)) return value.map(redactValue3);
  const record = asRecord7(value);
  if (!record) return value;
  return Object.fromEntries(
    Object.entries(record).map(([key, nested]) => [
      key,
      isSensitiveKey2(key) ? "[redacted]" : redactValue3(nested)
    ])
  );
}
function redactString2(value) {
  try {
    const parsed = new URL(value);
    let changed = false;
    for (const key of [...parsed.searchParams.keys()]) {
      if (isSensitiveKey2(key)) {
        parsed.searchParams.set(key, "[redacted]");
        changed = true;
      }
    }
    return changed ? parsed.toString() : value;
  } catch {
    return value.replace(
      /([?&](?:cookie|token|authorization|password|secret|api[-_]?key|apikey)=)[^&\s]+/gi,
      "$1[redacted]"
    );
  }
}
function isSensitiveKey2(key) {
  return /token|authorization|cookie|password|secret|apikey|apiKey/i.test(key);
}
function formatError8(error) {
  const record = asRecord7(error);
  const message = record?.message;
  return message == null ? String(error) : String(message);
}

// src/commands/expo-introspection-actions/src/main/index.ts
import { access as access3, readFile as readFile10, stat as stat5 } from "node:fs/promises";
import path9 from "node:path";

// src/commands/project-info-doctor/src/main/index.ts
import { execFile as execFile3 } from "node:child_process";
import * as fs5 from "node:fs/promises";
import * as path8 from "node:path";
var CLI_NAME2 = CURRENT_CLI_NAME;
var MAX_OUTPUT8 = 4e4;
var COMMAND_NAMES = ["node", "npx", "xcrun", "open", "plutil", "idb", "axe", "adb"];
var EXPO_REACT_NATIVE_COMPATIBILITY = [
  { expoMajor: 54, reactNativeMajorMinor: "0.81" },
  { expoMajor: 53, reactNativeMajorMinor: "0.79" },
  { expoMajor: 52, reactNativeMajorMinor: "0.76" },
  { expoMajor: 51, reactNativeMajorMinor: "0.74" },
  { expoMajor: 50, reactNativeMajorMinor: "0.73" }
];
async function doctor(args = {}) {
  const cwd = await normalizeCwd2(args.cwd).catch(() => path8.resolve(args.cwd ?? process.cwd()));
  const commands = {};
  for (const command of COMMAND_NAMES) {
    commands[command] = await commandPath(command, args.deps);
  }
  const projectInfoResult = await safeToolSection2(() => projectInfo({ cwd }));
  const repairs = args.fix === true ? await doctorRepairs(cwd) : [];
  return toolJson({
    cli: { name: CLI_NAME2, version: CLI_VERSION },
    cwd,
    auth: { required: false, source: "not-required" },
    commands,
    capabilities: {
      iosSimulator: Boolean(commands.xcrun),
      simulatorScreenshots: Boolean(commands.xcrun),
      iosCoordinateTap: Boolean(commands.idb || commands.axe),
      iosCoordinateGestures: Boolean(commands.idb || commands.axe),
      iosHierarchy: Boolean(commands.axe),
      androidDeviceBridge: Boolean(commands.adb),
      expoCli: Boolean(commands.npx),
      metroHermes: hasRuntimeGlobal("fetch", args.deps?.hasFetch) && hasRuntimeGlobal("WebSocket", args.deps?.hasWebSocket)
    },
    repairs,
    project: projectInfoResult.ok ? unwrapToolJson(projectInfoResult.value) : projectInfoResult
  });
}
async function doctorRepairs(cwd) {
  const stateRoot = resolveExpoStateRoot5({ cwd });
  const runs = path8.join(stateRoot, "runs");
  const sessions = path8.join(stateRoot, "sessions");
  await fs5.mkdir(runs, { recursive: true });
  await fs5.mkdir(sessions, { recursive: true });
  return [
    { action: "ensure-directory", path: runs },
    { action: "ensure-directory", path: sessions }
  ];
}
async function projectInfo(args) {
  const cwd = await normalizeCwd2(args.cwd);
  const packageJsonPath = await findUp2(cwd, "package.json");
  if (!packageJsonPath) {
    return toolJson({
      cwd,
      isExpoProject: false,
      reason: "No package.json found in this directory or its parents."
    });
  }
  const projectRoot = path8.dirname(packageJsonPath);
  const packageJson = asRecord8(await readJsonFile7(packageJsonPath)) ?? {};
  const allDeps = {
    ...asStringRecord(packageJson.dependencies),
    ...asStringRecord(packageJson.devDependencies)
  };
  const appJsonPath = await pathExists3(path8.join(projectRoot, "app.json"));
  const appConfigPath = await firstExisting2(projectRoot, [
    "app.config.ts",
    "app.config.js",
    "app.config.mjs",
    "app.config.cjs"
  ]);
  const appJson = appJsonPath ? asRecord8(await readJsonFile7(path8.join(projectRoot, "app.json"))) : null;
  const expoConfig = appJson ? asRecord8(appJson.expo) ?? appJson : null;
  const appConfigSummary = await readExpoConfigSummary(projectRoot);
  const easJson = await pathExists3(path8.join(projectRoot, "eas.json")) ? asRecord8(await readJsonFile7(path8.join(projectRoot, "eas.json"))) : null;
  return toolJson({
    cwd,
    projectRoot,
    isExpoProject: Boolean(allDeps.expo || expoConfig),
    packageManager: await detectPackageManager(projectRoot),
    expoDependency: allDeps.expo ?? null,
    reactNativeDependency: allDeps["react-native"] ?? null,
    expoRouterDependency: allDeps["expo-router"] ?? null,
    upstreamDependencies: buildUpstreamDependencyReport(projectRoot, allDeps),
    scripts: asRecord8(packageJson.scripts) ?? {},
    appConfig: appConfigSummary ? projectInfoAppConfigSummary(appConfigSummary) : expoConfig ? {
      source: appJsonPath ? "app.json" : path8.basename(appConfigPath ?? ""),
      name: expoConfig.name ?? null,
      slug: expoConfig.slug ?? null,
      scheme: expoConfig.scheme ?? null,
      iosBundleIdentifier: asRecord8(expoConfig.ios)?.bundleIdentifier ?? null,
      androidPackage: asRecord8(expoConfig.android)?.package ?? null,
      easProjectId: asRecord8(asRecord8(expoConfig.extra)?.eas)?.projectId ?? null
    } : null,
    hasDynamicAppConfig: Boolean(appConfigPath),
    eas: easJson ? {
      buildProfiles: Object.keys(asRecord8(easJson.build) ?? {}),
      submitProfiles: Object.keys(asRecord8(easJson.submit) ?? {}),
      cli: easJson.cli ?? null
    } : null
  });
}
function buildUpstreamDependencyReport(projectRoot, allDeps = {}) {
  const expoVersion = dependencyInfo(allDeps, "expo");
  const reactNativeVersion = dependencyInfo(allDeps, "react-native");
  const metroVersion = dependencyInfo(allDeps, "metro");
  const expoCliVersion = dependencyInfo(allDeps, "@expo/cli");
  const devMiddlewareVersion = dependencyInfo(allDeps, "@react-native/dev-middleware");
  const rozenitePackages = Object.keys(allDeps).filter((name) => name === "rozenite" || name.startsWith("@rozenite/")).sort().map((name) => dependencyInfo(allDeps, name));
  const expoRnCompatibility = classifyExpoReactNativeCompatibility(expoVersion, reactNativeVersion);
  const dependencies = [
    {
      id: "expo-public-api",
      ecosystem: "expo",
      packageName: "expo",
      integrationPoint: "Expo config, dev-client, expo/devtools plugin APIs, and public package exports.",
      classification: "public-api",
      usage: "direct-dependency",
      directDependency: expoVersion.present,
      declaredVersion: expoVersion.declaredVersion,
      resolvedVersion: expoVersion.resolvedVersion,
      status: dependencyStatus(expoVersion),
      compatibility: expoRnCompatibility.forExpo,
      notes: expoVersion.present ? ["Expo is declared by the project and can be used for public API compatibility checks."] : ["Expo is not declared; Expo-specific upstream clients remain unavailable."]
    },
    {
      id: "metro-inspector-http",
      ecosystem: "metro",
      packageName: "metro",
      integrationPoint: "Metro /status, /json/list, /json/version, /symbolicate, and /message HTTP/WebSocket surfaces.",
      classification: "documented-unstable-api",
      usage: "optional-compatibility-shim",
      directDependency: metroVersion.present,
      declaredVersion: metroVersion.declaredVersion,
      resolvedVersion: metroVersion.resolvedVersion,
      status: metroVersion.present ? dependencyStatus(metroVersion) : expoVersion.present ? "inferred-transitive" : "missing",
      compatibility: {
        state: metroVersion.present || expoVersion.present ? "discoverable-at-runtime" : "missing",
        expected: "Metro inspector endpoints are discovered over local HTTP at runtime; direct internal imports are not required."
      },
      notes: [
        "The CLI may probe Metro's local HTTP endpoints, but Metro server internals are reference-only unless isolated by a shim."
      ]
    },
    {
      id: "hermes-react-native-cdp",
      ecosystem: "hermes-react-native",
      packageName: "react-native",
      integrationPoint: "Hermes inspector Chrome DevTools Protocol websocket exposed by React Native/Metro.",
      classification: "optional-compatibility-shim",
      usage: "optional-compatibility-shim",
      directDependency: reactNativeVersion.present,
      declaredVersion: reactNativeVersion.declaredVersion,
      resolvedVersion: reactNativeVersion.resolvedVersion,
      status: dependencyStatus(reactNativeVersion),
      compatibility: expoRnCompatibility.forReactNative,
      notes: [
        "CDP method calls must stay behind the expo98 CDP client because Hermes/RN can expose implementation-specific methods."
      ]
    },
    {
      id: "react-native-devtools",
      ecosystem: "react-native-devtools",
      packageName: "@react-native/dev-middleware",
      integrationPoint: "React Native DevTools launch metadata, panel discovery, and machine-readable domains where available.",
      classification: "documented-unstable-api",
      usage: "internal-reference-only",
      directDependency: devMiddlewareVersion.present,
      declaredVersion: devMiddlewareVersion.declaredVersion,
      resolvedVersion: devMiddlewareVersion.resolvedVersion,
      status: devMiddlewareVersion.present ? dependencyStatus(devMiddlewareVersion) : reactNativeVersion.present ? "reference-only" : "missing",
      compatibility: {
        state: reactNativeVersion.present ? "runtime-target-required" : "missing",
        expected: "React Native DevTools capabilities are confirmed from Metro target metadata before use."
      },
      notes: [
        "React Native DevTools internals can inform local wrappers, but command code must not depend on private build paths."
      ]
    },
    {
      id: "expo-devtools-plugin",
      ecosystem: "expo-devtools-plugin",
      packageName: "expo",
      integrationPoint: "expo/devtools and useDevToolsPluginClient two-way development plugin APIs.",
      classification: "public-api",
      usage: "direct-dependency",
      directDependency: expoVersion.present,
      declaredVersion: expoVersion.declaredVersion,
      resolvedVersion: expoVersion.resolvedVersion,
      status: dependencyStatus(expoVersion),
      compatibility: {
        state: expoVersion.present ? "available-when-app-registers" : "missing",
        expected: "Plugin domains still require a live development build to register the app-side bridge."
      },
      notes: [
        "Plugin bridge installation and mutation remain explicit-user-permission operations."
      ]
    },
    {
      id: "rozenite-devtools-bridge",
      ecosystem: "rozenite",
      packageName: rozenitePackages.length > 0 ? rozenitePackages.map((item) => item.name).join(", ") : "rozenite/@rozenite/*",
      integrationPoint: "Rozenite bridge, agent, React Navigation, network, storage, controls, and performance integrations.",
      classification: "optional-compatibility-shim",
      usage: "optional-compatibility-shim",
      directDependency: rozenitePackages.length > 0,
      declaredVersion: rozenitePackages.length > 0 ? rozenitePackages.map((item) => `${item.name}@${item.declaredVersion}`).join(", ") : null,
      resolvedVersion: rozenitePackages.length > 0 ? rozenitePackages.map((item) => `${item.name}@${item.resolvedVersion ?? item.declaredVersion}`).join(", ") : null,
      status: rozenitePackages.length > 0 ? rozenitePackages.some((item) => item.unresolved) ? "declared-unresolved" : "present" : "missing",
      compatibility: {
        state: rozenitePackages.length > 0 ? "optional-present" : "optional-missing",
        expected: "Rozenite-backed domains are preferred only when installed and registered by the app."
      },
      notes: [
        "Rozenite is optional; absence must produce structured unavailable data, not a CLI failure."
      ]
    },
    {
      id: "expo-cli-internals",
      ecosystem: "expo",
      packageName: "@expo/cli",
      integrationPoint: "Expo CLI private implementation details used only as reference material.",
      classification: "internal-reference-only",
      usage: "internal-reference-only",
      directDependency: expoCliVersion.present,
      declaredVersion: expoCliVersion.declaredVersion,
      resolvedVersion: expoCliVersion.resolvedVersion,
      status: expoCliVersion.present ? dependencyStatus(expoCliVersion) : "not-depended-on",
      compatibility: {
        state: "reference-only",
        expected: "Private Expo CLI build paths must not be imported by command handlers."
      },
      notes: [
        "If an internal path is ever needed, it must be wrapped by an optional compatibility shim with fallback behavior."
      ]
    }
  ];
  return {
    schemaVersion: 1,
    projectRoot,
    policy: {
      categories: [
        { id: "public-api", mayImportDirectly: true, requiresShim: false },
        { id: "documented-unstable-api", mayImportDirectly: false, requiresShim: true },
        { id: "internal-reference-only", mayImportDirectly: false, requiresShim: true },
        { id: "optional-compatibility-shim", mayImportDirectly: false, requiresShim: true }
      ],
      rules: [
        "Command handlers depend on expo98 adapters, not raw upstream package objects.",
        "Metro and Hermes runtime availability is confirmed at runtime before a command reports live evidence.",
        "Internal Expo, Metro, React Native, or DevTools source paths are reference material unless isolated behind optional shims.",
        "Missing optional upstream packages produce structured unavailable reports instead of thrown errors."
      ]
    },
    summary: summarizeUpstreamDependencies(dependencies),
    dependencies
  };
}
function dependencyInfo(allDeps, name) {
  const declaredVersion = allDeps[name] ?? null;
  return {
    name,
    present: typeof declaredVersion === "string" && declaredVersion.length > 0,
    declaredVersion,
    resolvedVersion: parseVersionLike(declaredVersion),
    unresolved: typeof declaredVersion === "string" && /^(catalog|workspace|file|link|portal):/.test(declaredVersion)
  };
}
function dependencyStatus(info) {
  if (!info.present) return "missing";
  if (info.unresolved) return "declared-unresolved";
  return "present";
}
function parseVersionLike(version) {
  if (typeof version !== "string") return null;
  const match = version.match(/\d+\.\d+(?:\.\d+)?/);
  return match ? match[0] ?? null : null;
}
function classifyExpoReactNativeCompatibility(expoVersion, reactNativeVersion) {
  const missing = {
    state: "missing",
    expected: "Declare both expo and react-native to classify SDK compatibility."
  };
  if (!expoVersion.present || !reactNativeVersion.present) {
    return { forExpo: missing, forReactNative: missing };
  }
  if (expoVersion.unresolved || reactNativeVersion.unresolved) {
    const unresolved = {
      state: "declared-unresolved",
      expected: "Resolve catalog/workspace dependency versions before treating compatibility as proven.",
      expo: expoVersion.declaredVersion,
      reactNative: reactNativeVersion.declaredVersion
    };
    return { forExpo: unresolved, forReactNative: unresolved };
  }
  const expoMajor = majorFromVersion(expoVersion.declaredVersion);
  const reactNativeMajorMinor = majorMinorFromVersion(reactNativeVersion.declaredVersion);
  const expected = EXPO_REACT_NATIVE_COMPATIBILITY.find((entry) => entry.expoMajor === expoMajor);
  if (!expected) {
    const unknown = {
      state: "unknown",
      expected: "This Expo SDK is not in expo98's compatibility table; verify with the project dependency source.",
      expo: expoVersion.declaredVersion,
      reactNative: reactNativeVersion.declaredVersion
    };
    return { forExpo: unknown, forReactNative: unknown };
  }
  const result = {
    state: reactNativeMajorMinor === expected.reactNativeMajorMinor ? "compatible" : "mismatched",
    expected: `Expo SDK ${expected.expoMajor} expects React Native ${expected.reactNativeMajorMinor}.x.`,
    expo: expoVersion.declaredVersion,
    reactNative: reactNativeVersion.declaredVersion
  };
  return { forExpo: result, forReactNative: result };
}
async function normalizeCwd2(cwd) {
  const resolved = path8.resolve(cwd ?? process.cwd());
  const stat8 = await fs5.stat(resolved).catch(() => null);
  if (!stat8?.isDirectory()) throw new Error(`Directory does not exist: ${resolved}`);
  return resolved;
}
async function findUp2(startDir, filename) {
  let current = path8.resolve(startDir);
  while (true) {
    const candidate = path8.join(current, filename);
    if (await pathExists3(candidate)) return candidate;
    const parent = path8.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}
async function readJsonFile7(file) {
  return JSON.parse(await fs5.readFile(file, "utf8"));
}
async function detectPackageManager(projectRoot) {
  let current = path8.resolve(projectRoot);
  while (true) {
    if (await pathExists3(path8.join(current, "pnpm-lock.yaml"))) return "pnpm";
    if (await pathExists3(path8.join(current, "yarn.lock"))) return "yarn";
    if (await pathExists3(path8.join(current, "bun.lockb"))) return "bun";
    if (await pathExists3(path8.join(current, "bun.lock"))) return "bun";
    if (await pathExists3(path8.join(current, "package-lock.json"))) return "npm";
    const parent = path8.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return "unknown";
}
async function firstExisting2(root, names) {
  for (const name of names) {
    const candidate = path8.join(root, name);
    if (await pathExists3(candidate)) return candidate;
  }
  return null;
}
async function pathExists3(file) {
  return fs5.access(file).then(
    () => true,
    () => false
  );
}
async function readExpoConfigSummary(projectRoot) {
  const appJsonPath = path8.join(projectRoot, "app.json");
  if (await pathExists3(appJsonPath)) {
    const appJson = asRecord8(await readJsonFile7(appJsonPath)) ?? {};
    const expo = asRecord8(appJson.expo) ?? appJson;
    return {
      source: appJsonPath,
      name: expo.name ?? null,
      slug: expo.slug ?? null,
      scheme: expo.scheme ?? null,
      iosBundleIdentifier: asRecord8(expo.ios)?.bundleIdentifier ?? null,
      androidPackage: asRecord8(expo.android)?.package ?? null,
      easProjectId: asRecord8(asRecord8(expo.extra)?.eas)?.projectId ?? null,
      userInterfaceStyle: expo.userInterfaceStyle ?? null
    };
  }
  const configPath = await firstExisting2(projectRoot, [
    "app.config.ts",
    "app.config.js",
    "app.config.mjs",
    "app.config.cjs"
  ]);
  if (!configPath) return null;
  const text = await fs5.readFile(configPath, "utf8");
  return {
    source: configPath,
    name: regexConfigValue(text, "name"),
    slug: regexConfigValue(text, "slug"),
    scheme: regexConfigValue(text, "scheme"),
    iosBundleIdentifier: regexNestedConfigValue(text, "bundleIdentifier"),
    androidPackage: regexNestedConfigValue(text, "package"),
    easProjectId: regexConfigValue(text, "projectId"),
    userInterfaceStyle: regexConfigValue(text, "userInterfaceStyle"),
    dynamic: true
  };
}
function projectInfoAppConfigSummary(summary) {
  const payload = {
    source: path8.basename(String(summary.source)),
    name: summary.name ?? null,
    slug: summary.slug ?? null,
    scheme: summary.scheme ?? null,
    iosBundleIdentifier: summary.iosBundleIdentifier ?? null,
    androidPackage: summary.androidPackage ?? null,
    easProjectId: summary.easProjectId ?? null
  };
  if (summary.userInterfaceStyle != null) payload.userInterfaceStyle = summary.userInterfaceStyle;
  if (summary.dynamic === true) payload.dynamic = true;
  return payload;
}
function resolveExpoStateRoot5(args = {}) {
  if (args.stateDir) {
    const resolved = path8.resolve(args.stateDir);
    return path8.basename(resolved) === "runs" ? path8.dirname(resolved) : resolved;
  }
  const root = path8.resolve(args.root ?? args.cwd ?? process.cwd());
  return path8.join(root, ".scratch", "expo98");
}
async function safeToolSection2(fn) {
  try {
    return { ok: true, value: await fn() };
  } catch (error) {
    return { ok: false, error: formatError9(error) };
  }
}
function truncate9(value, limit = MAX_OUTPUT8) {
  const text = String(value ?? "");
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}
[truncated ${text.length - limit} characters]`;
}
function formatError9(error) {
  if (!error) return "Unknown error";
  const record = asRecord8(error);
  const parts = [error instanceof Error ? error.message : String(error)];
  if (record?.stdout) parts.push(`stdout:
${truncate9(record.stdout)}`);
  if (record?.stderr) parts.push(`stderr:
${truncate9(record.stderr)}`);
  return parts.join("\n\n");
}
async function commandPath(command, deps) {
  if (deps?.commandPath) return deps.commandPath(command);
  const result = await execFilePromise("sh", ["-lc", `command -v ${shellArg(command)}`], {
    timeout: 5e3,
    rejectOnError: false
  });
  return result.stdout.trim() || null;
}
function execFilePromise(file, args, options = {}) {
  return new Promise((resolve18, reject) => {
    execFile3(
      file,
      args,
      { timeout: options.timeout },
      (error, stdout, stderr) => {
        const result = {
          stdout: String(stdout ?? ""),
          stderr: String(stderr ?? ""),
          error: error ? { message: error.message, code: error.code, signal: error.signal } : null
        };
        if (error && options.rejectOnError !== false) reject(Object.assign(error, result));
        else resolve18(result);
      }
    );
  });
}
function hasRuntimeGlobal(name, override) {
  if (override !== void 0) return override;
  return typeof globalThis[name] === "function";
}
function shellArg(value) {
  return `'${value.replace(/'/g, "'\\''")}'`;
}
function asRecord8(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : null;
}
function asStringRecord(value) {
  const record = asRecord8(value);
  if (!record) return {};
  return Object.fromEntries(
    Object.entries(record).filter(
      (entry) => typeof entry[1] === "string"
    )
  );
}
function majorFromVersion(version) {
  const parsed = parseVersionLike(version);
  if (!parsed) return null;
  return Number(parsed.split(".")[0]);
}
function majorMinorFromVersion(version) {
  const parsed = parseVersionLike(version);
  if (!parsed) return null;
  const [major, minor] = parsed.split(".");
  return `${major}.${minor ?? "0"}`;
}
function regexConfigValue(text, key) {
  return new RegExp(`\\b${key}\\s*:\\s*["'\`]([^"'\`]+)["'\`]`).exec(text)?.[1] ?? null;
}
function regexNestedConfigValue(text, key) {
  return new RegExp(`\\b${key}\\s*:\\s*["'\`]([^"'\`]+)["'\`]`).exec(text)?.[1] ?? null;
}
function summarizeUpstreamDependencies(dependencies) {
  const statuses = {};
  for (const dependency of dependencies) {
    statuses[dependency.status] = (statuses[dependency.status] ?? 0) + 1;
  }
  return {
    total: dependencies.length,
    directDependencies: dependencies.filter(
      (dependency) => dependency.usage === "direct-dependency"
    ).length,
    internalReferenceOnly: dependencies.filter(
      (dependency) => dependency.classification === "internal-reference-only"
    ).length,
    optionalCompatibilityShims: dependencies.filter(
      (dependency) => dependency.classification === "optional-compatibility-shim"
    ).length,
    statuses,
    mismatched: dependencies.filter((dependency) => dependency.compatibility?.state === "mismatched").map((dependency) => dependency.id),
    missing: dependencies.filter((dependency) => dependency.status === "missing").map((dependency) => dependency.id)
  };
}

// src/commands/expo-introspection-actions/src/main/index.ts
var EXPO_ACTIONS = [
  "modules",
  "config",
  "doctor",
  "upstream-policy",
  "prebuild-plan"
];
async function expoCommand(args = {}, deps = defaultExpoCommandDependencies) {
  const action = requireString10(args.action ?? "modules", "action");
  if (!isExpoAction(action)) throw new Error(`Unknown Expo action: ${action}`);
  const cwd = await deps.normalizeProjectCwd(args.cwd, { allowMissingPackageJson: true }).catch(() => deps.resolvePath(args.cwd ?? deps.currentWorkingDirectory()));
  const summary = await deps.runtimeSummary(cwd);
  if (action === "doctor") {
    return toolJson({
      available: true,
      action,
      sources: ["project", "native"],
      projectRoot: summary.projectRoot,
      summary: unwrapToolJson(await deps.doctor({ cwd: summary.projectRoot }))
    });
  }
  if (action === "upstream-policy") {
    const info = asRecord9(unwrapToolJson(await deps.projectInfo({ cwd: summary.projectRoot }))) ?? {};
    return toolJson({
      available: Boolean(info.isExpoProject),
      action,
      sources: ["project"],
      projectRoot: summary.projectRoot,
      report: info.upstreamDependencies ?? deps.buildUpstreamDependencyReport(summary.projectRoot, {}),
      limitations: [
        "Static dependency policy cannot prove a runtime target is registered; run DevTools and bridge health checks for live domains."
      ]
    });
  }
  if (action === "config") {
    return toolJson({
      available: true,
      action,
      sources: ["project"],
      ...summary,
      limitations: expoConfigLimitations(summary)
    });
  }
  const modules = await expoModuleRecords(summary.projectRoot, deps);
  if (action === "modules") {
    return toolJson({
      available: true,
      action,
      sources: ["project"],
      projectRoot: summary.projectRoot,
      expoDependency: summary.expoDependency,
      reactNativeDependency: summary.reactNativeDependency,
      modules,
      limitations: [
        "Static dependency inspection cannot prove which native modules are currently compiled into the running app."
      ]
    });
  }
  const risks = await expoPrebuildRisks(summary.projectRoot, modules, deps);
  return toolJson({
    available: true,
    action,
    sources: ["project"],
    projectRoot: summary.projectRoot,
    riskLevel: expoPrebuildRiskLevel(risks),
    risks,
    modules: modules.filter((module) => module.category === "config-plugin"),
    appConfig: summary.appConfig,
    limitations: [
      "This static plan flags rebuild risk; it does not run expo prebuild or mutate native projects.",
      "Dynamic app.config files are read with conservative string extraction only."
    ]
  });
}
var defaultExpoCommandDependencies = {
  normalizeProjectCwd: defaultNormalizeProjectCwd2,
  resolvePath: (input) => path9.resolve(input),
  currentWorkingDirectory: () => process.cwd(),
  runtimeSummary: async (cwd) => {
    const info = asRecord9(unwrapToolJson(await projectInfo({ cwd }))) ?? {};
    return {
      projectRoot: String(info.projectRoot ?? cwd),
      expoDependency: info.expoDependency ?? null,
      reactNativeDependency: info.reactNativeDependency ?? null,
      appConfig: asRecord9(info.appConfig)
    };
  },
  doctor,
  projectInfo,
  buildUpstreamDependencyReport,
  findUp: findUp3,
  readJsonFile: async (filePath) => JSON.parse(await readFile10(filePath, "utf8")),
  joinPath: (...parts) => path9.join(...parts),
  pathExists: async (filePath) => access3(filePath).then(
    () => true,
    () => false
  ),
  firstExisting: async (projectRoot, names) => {
    for (const name of names) {
      const candidate = path9.join(projectRoot, name);
      if (await access3(candidate).then(
        () => true,
        () => false
      ))
        return candidate;
    }
    return null;
  },
  readTextFile: (filePath) => readFile10(filePath, "utf8")
};
async function expoModuleRecords(projectRoot, deps) {
  const packageJsonPath = await deps.findUp(projectRoot, "package.json");
  const packageJson = packageJsonPath ? asRecord9(await deps.readJsonFile(packageJsonPath)) ?? {} : {};
  const allDeps = {
    ...asRecord9(packageJson.dependencies),
    ...asRecord9(packageJson.devDependencies)
  };
  return Object.entries(allDeps).filter(([name]) => isExpoRelatedPackage(name)).sort(([left], [right]) => left.localeCompare(right)).map(([name, version]) => ({
    name,
    version,
    category: expoModuleCategory(name)
  }));
}
function isExpoRelatedPackage(name) {
  return name === "expo" || name.startsWith("expo-") || name.startsWith("@expo/") || name.startsWith("@config-plugins/") || name.includes("config-plugin");
}
function expoModuleCategory(name) {
  if (name.startsWith("@config-plugins/") || name.includes("config-plugin")) return "config-plugin";
  if (name === "expo" || name.startsWith("expo-") || name.startsWith("@expo/")) return "expo";
  return "other";
}
async function expoPrebuildRisks(projectRoot, modules, deps) {
  const risks = [];
  for (const platformDir of ["ios", "android"]) {
    if (await deps.pathExists(deps.joinPath(projectRoot, platformDir))) {
      risks.push({
        kind: "native-project-present",
        platform: platformDir,
        severity: "high",
        message: `${platformDir} native project exists; config and native module changes may require a rebuild.`
      });
    }
  }
  for (const module of modules.filter((item) => item.category === "config-plugin")) {
    risks.push({
      kind: "config-plugin",
      package: module.name,
      severity: "medium",
      message: "Config-plugin dependency can affect native prebuild output."
    });
  }
  for (const plugin of await readExpoAppConfigPlugins(projectRoot, deps)) {
    risks.push({
      kind: "app-config-plugin",
      plugin,
      severity: "medium",
      message: "App config plugin can affect native prebuild output."
    });
  }
  return risks;
}
async function readExpoAppConfigPlugins(projectRoot, deps) {
  const appJsonPath = deps.joinPath(projectRoot, "app.json");
  if (await deps.pathExists(appJsonPath)) {
    const appJson = asRecord9(await deps.readJsonFile(appJsonPath));
    const expoConfig = asRecord9(appJson?.expo);
    const plugins = expoConfig?.plugins ?? appJson?.plugins ?? [];
    return Array.isArray(plugins) ? plugins.map(formatExpoPluginEntry) : [];
  }
  const configPath = await deps.firstExisting(projectRoot, [
    "app.config.ts",
    "app.config.js",
    "app.config.mjs",
    "app.config.cjs"
  ]);
  if (!configPath) return [];
  const text = await deps.readTextFile(configPath);
  const match = /\bplugins\s*:\s*\[([\s\S]*?)\]/m.exec(text);
  if (!match) return [];
  return [...match[1].matchAll(/["'`]([^"'`]+)["'`]/g)].map((item) => item[1]);
}
function formatExpoPluginEntry(entry) {
  if (typeof entry === "string") return entry;
  if (Array.isArray(entry)) return String(entry[0] ?? "");
  return JSON.stringify(entry);
}
function expoConfigLimitations(summary) {
  return summary.appConfig?.dynamic ? [
    "Dynamic Expo config was summarized with static string extraction and may omit computed values."
  ] : ["Expo config is summarized from project files; native runtime overrides are not included."];
}
function expoPrebuildRiskLevel(risks) {
  if (risks.some((risk) => risk.kind === "native-project-present")) return "high";
  return risks.length > 0 ? "medium" : "low";
}
function requireString10(value, field) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${field} must be a non-empty string.`);
  }
  return value.trim();
}
function isExpoAction(action) {
  return EXPO_ACTIONS.includes(action);
}
function asRecord9(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : null;
}
async function defaultNormalizeProjectCwd2(cwd) {
  const resolved = path9.resolve(cwd ?? ".");
  const details = await stat5(resolved).catch(() => null);
  if (!details?.isDirectory()) throw new Error(`Directory does not exist: ${resolved}`);
  return resolved;
}
async function findUp3(projectRoot, filename) {
  let current = path9.resolve(projectRoot);
  while (true) {
    const candidate = path9.join(current, filename);
    if (await access3(candidate).then(
      () => true,
      () => false
    ))
      return candidate;
    const parent = path9.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

// src/commands/interaction-actions/src/main/types.ts
var MAX_OUTPUT9 = 4e4;

// src/commands/interaction-actions/src/main/dependencies.ts
import { execFile as nodeExecFile6, spawn as nodeSpawn } from "node:child_process";
import * as fs7 from "node:fs/promises";
import { tmpdir as osTmpdir } from "node:os";
import { join as joinPath3 } from "node:path";

// src/core/real-validation/src/main/index.ts
function realValidation(input) {
  return {
    state: input.state,
    claimsAllowed: {
      networkLatency: false,
      networkWaterfall: false,
      renderCost: false,
      frameJank: false,
      nativeCpu: false,
      releasePerformance: false,
      ...input.claimsAllowed ?? {}
    },
    evidence: input.evidence ?? [],
    missingEvidence: input.missingEvidence ?? []
  };
}

// src/commands/interaction-trace-expression/src/main/index.ts
async function traceInteraction(args = {}, deps = defaultTraceInteractionDependencies) {
  const metroPort = clampNumber10(args.metroPort ?? 8081, 1, 65535);
  const action = args.action;
  const maxEvents = clampNumber10(args.maxEvents ?? 300, 1, 2e3);
  const includeEvents = args.includeEvents === true;
  const componentFilter = requireOptionalString6(args.componentFilter);
  const targets = await deps.fetchMetroTargets(metroPort).catch(() => []);
  const targetList = Array.isArray(targets) ? targets : [];
  const webSocketDebuggerUrl = asString(asRecord10(targetList[0])?.webSocketDebuggerUrl);
  if (!webSocketDebuggerUrl) {
    return toolJson({
      available: false,
      action,
      reason: "No Metro inspector target.",
      metroPort,
      realValidation: realValidation({
        state: "environment-blocked",
        evidence: [
          { source: "metro", command: `trace.${String(action ?? "read")}`, confidence: "low" }
        ],
        missingEvidence: [
          {
            signal: "metro-hermes-target",
            reason: "No Metro inspector target.",
            recommendedFix: "Start Metro, launch the app in a Hermes dev client, and rerun with --metro-port."
          }
        ]
      }),
      limitations: [
        "No Hermes Runtime.evaluate trace was collected.",
        "React commits, layout changes, animation frames, and handler-bearing components are unavailable for this read."
      ]
    });
  }
  const expression = interactionTraceExpression({
    action,
    maxEvents,
    componentFilter,
    includeEvents
  });
  const result = await deps.evaluateHermesExpression(webSocketDebuggerUrl, expression, {
    timeoutMs: 8e3
  });
  const trace = getPath(result, ["result", "result", "value"]) ?? null;
  return toolJson({
    action,
    metroPort,
    target: targetSummary4(targetList[0]),
    trace,
    protocolError: getPath(result, ["result", "exceptionDetails"]) ?? asRecord10(result)?.error ?? null,
    cdp: asRecord10(result)?.diagnostics ?? asRecord10(result)?.cdp ?? null,
    realValidation: traceRealValidation(trace, action)
  });
}
var defaultTraceInteractionDependencies = {
  fetchMetroTargets: (metroPort) => metroTargets(metroPort),
  evaluateHermesExpression
};
function interactionTraceExpression({
  action,
  maxEvents,
  componentFilter,
  includeEvents
}) {
  return `(() => {
    const action = ${JSON.stringify(action)};
    const maxEvents = ${JSON.stringify(maxEvents)};
    const includeEvents = ${JSON.stringify(Boolean(includeEvents))};
    const componentFilter = ${JSON.stringify(componentFilter ?? "")};
    const filterNeedle = String(componentFilter || '').toLowerCase();
    const now = () => Math.round((typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now()) * 10) / 10;
    const globalKey = '__EXPO_LOCAL_DEV_INTERACTION_TRACE__';
    const tracer = globalThis[globalKey] ||= {
      installed: false,
      startedAt: null,
      events: [],
      lastSnapshot: new Map(),
      originals: {},
      errors: []
    };

    function short(value, max = 160) {
      if (value == null) return null;
      const text = String(value);
      return text.length > max ? text.slice(0, max) + '...' : text;
    }

    function push(type, payload = {}) {
      const event = { t: now(), type, ...payload };
      tracer.events.push(event);
      const hardLimit = Math.max(2000, maxEvents * 3);
      if (tracer.events.length > hardLimit) tracer.events.splice(0, tracer.events.length - hardLimit);
      return event;
    }

    function primitive(value) {
      return value == null || ['string', 'number', 'boolean'].includes(typeof value);
    }

    function typeName(type) {
      if (!type) return null;
      if (typeof type === 'string') return type;
      return type.displayName || type.name || type.render?.displayName || type.render?.name || type.type?.displayName || type.type?.name || null;
    }

    function fiberName(fiber) {
      return typeName(fiber.elementType) || typeName(fiber.type) || fiber._debugName || tagName(fiber.tag);
    }

    function tagName(tag) {
      const names = { 0: 'FunctionComponent', 1: 'ClassComponent', 3: 'HostRoot', 5: 'HostComponent', 6: 'HostText', 7: 'Fragment', 10: 'ContextProvider', 11: 'ForwardRef', 14: 'MemoComponent', 15: 'SimpleMemoComponent' };
      return names[tag] || ('FiberTag' + tag);
    }

    function debugSource(fiber) {
      const source = fiber?._debugSource;
      if (!source) return null;
      return { fileName: source.fileName || null, lineNumber: source.lineNumber || null, columnNumber: source.columnNumber || null };
    }

    function ownerName(fiber) {
      return fiber?._debugOwner ? fiberName(fiber._debugOwner) : null;
    }

    function flattenText(value, out = []) {
      if (out.join(' ').length > 220) return out;
      if (typeof value === 'string' || typeof value === 'number') {
        const text = String(value).trim();
        if (text) out.push(short(text, 100));
      } else if (Array.isArray(value)) {
        for (const item of value.slice(0, 16)) flattenText(item, out);
      }
      return out;
    }

    const layoutKeys = [
      'display','position','top','right','bottom','left','width','height','minWidth','minHeight','maxWidth','maxHeight',
      'flex','flexGrow','flexShrink','flexBasis','flexDirection','alignItems','alignSelf','justifyContent',
      'gap','rowGap','columnGap','margin','marginTop','marginRight','marginBottom','marginLeft',
      'padding','paddingTop','paddingRight','paddingBottom','paddingLeft','textAlign','overflow',
      'transform','opacity'
    ];
    const classKeys = ['className', 'contentContainerClassName'];
    const styleKeys = ['style', 'contentContainerStyle', 'containerStyle', 'indicatorStyle'];
    const handlerKeys = [
      'onScroll','onScrollBeginDrag','onScrollEndDrag','onMomentumScrollBegin','onMomentumScrollEnd',
      'onTouchStart','onTouchMove','onTouchEnd','onResponderGrant','onResponderMove','onResponderRelease',
      'onStartShouldSetResponder','onMoveShouldSetResponder','onGestureEvent','onHandlerStateChange',
      'onPress','onPressIn','onPressOut','onLongPress'
    ];

    function summarizeStyle(style, depth = 0) {
      if (!style || depth > 4) return null;
      if (typeof style === 'number') return { stylesheetId: style };
      if (Array.isArray(style)) {
        const merged = {};
        for (const item of style.slice(0, 12)) {
          const part = summarizeStyle(item, depth + 1);
          if (part && typeof part === 'object' && !Array.isArray(part)) Object.assign(merged, part);
        }
        return Object.keys(merged).length ? merged : null;
      }
      if (typeof style !== 'object') return null;
      const summary = {};
      for (const key of layoutKeys) {
        if (primitive(style[key])) summary[key] = style[key];
        else if (key === 'transform' && Array.isArray(style[key])) {
          try { summary[key] = JSON.parse(JSON.stringify(style[key].slice(0, 8))); } catch {}
        }
      }
      return Object.keys(summary).length ? summary : null;
    }

    function summarizeProps(props) {
      if (!props || typeof props !== 'object') return {};
      const summary = {};
      for (const key of ['accessibilityLabel','accessibilityRole','testID','nativeID','pointerEvents']) {
        if (primitive(props[key])) summary[key] = short(props[key], 140);
      }
      const text = flattenText(props.children).join(' ');
      if (text) summary.text = short(text, 180);
      for (const key of classKeys) {
        if (typeof props[key] === 'string' && props[key].trim()) summary[key] = short(props[key], 240);
      }
      for (const key of styleKeys) {
        const style = summarizeStyle(props[key]);
        if (style) summary[key] = style;
      }
      const handlers = handlerKeys.filter((key) => typeof props[key] === 'function');
      if (handlers.length) summary.handlers = handlers;
      return summary;
    }

    function matches(info) {
      if (!filterNeedle) return true;
      return [info.name, info.owner, info.label, info.testID, info.text, info.className, info.contentContainerClassName, info.source?.fileName]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(filterNeedle));
    }

    function walk(root) {
      const nodes = [];
      let truncated = false;
      function visit(fiber, depth, parentId, path) {
        if (!fiber || nodes.length >= 1800) {
          if (fiber) truncated = true;
          return;
        }
        const props = summarizeProps(fiber.memoizedProps);
        const label = props.accessibilityLabel || props.text || null;
        const info = {
          id: nodes.length + 1,
          parentId,
          depth,
          path,
          name: fiberName(fiber),
          owner: ownerName(fiber),
          label,
          text: props.text || null,
          testID: props.testID || null,
          role: props.accessibilityRole || null,
          className: props.className || null,
          contentContainerClassName: props.contentContainerClassName || null,
          source: debugSource(fiber),
          layout: {
            className: props.className || null,
            contentContainerClassName: props.contentContainerClassName || null,
            style: props.style || null,
            contentContainerStyle: props.contentContainerStyle || null,
            containerStyle: props.containerStyle || null,
            indicatorStyle: props.indicatorStyle || null,
            pointerEvents: props.pointerEvents || null
          },
          handlers: props.handlers || []
        };
        nodes.push(info);
        let child = fiber.child;
        let index = 0;
        while (child) {
          visit(child, depth + 1, info.id, path + '.' + index);
          child = child.sibling;
          index += 1;
        }
      }
      visit(root?.current?.child, 0, null, '0');
      return { nodes, truncated };
    }

    function layoutSignature(info) {
      return JSON.stringify(info.layout || {});
    }

    function handleCommit(root, reason = 'reactCommit') {
      const result = walk(root);
      const changed = [];
      const active = [];
      for (const info of result.nodes) {
        const sig = layoutSignature(info);
        const prev = tracer.lastSnapshot.get(info.path);
        if (matches(info) && (info.handlers.length || info.label || info.testID || /Animated|Scroll|Gesture|Pressable|Calendar|Draft|Event|Glass|Tab|Screen|Route/.test(info.name))) {
          active.push({
            id: info.id,
            parentId: info.parentId,
            depth: info.depth,
            name: info.name,
            owner: info.owner,
            label: info.label,
            role: info.role,
            testID: info.testID,
            handlers: info.handlers,
            layout: info.layout
          });
        }
        if (matches(info) && prev && prev !== sig) {
          changed.push({
            id: info.id,
            parentId: info.parentId,
            depth: info.depth,
            name: info.name,
            owner: info.owner,
            label: info.label,
            role: info.role,
            testID: info.testID,
            before: safeParse(prev),
            after: info.layout
          });
        }
        tracer.lastSnapshot.set(info.path, sig);
      }
      push(reason, {
        nodeCount: result.nodes.length,
        truncated: result.truncated,
        changedLayout: changed.slice(0, 40),
        activeElements: active.slice(0, 24)
      });
    }

    function safeParse(text) {
      try { return JSON.parse(text); } catch { return text; }
    }

    function compactLayout(layout) {
      if (!layout || typeof layout !== 'object') return null;
      return {
        className: layout.className || null,
        contentContainerClassName: layout.contentContainerClassName || null,
        style: layout.style || null,
        contentContainerStyle: layout.contentContainerStyle || null,
        containerStyle: layout.containerStyle || null,
        indicatorStyle: layout.indicatorStyle || null,
        pointerEvents: layout.pointerEvents || null
      };
    }

    function compactElement(info) {
      if (!info || typeof info !== 'object') return null;
      return {
        id: info.id ?? null,
        parentId: info.parentId ?? null,
        depth: info.depth ?? null,
        name: info.name || null,
        owner: info.owner || null,
        label: info.label || null,
        role: info.role || null,
        testID: info.testID || null,
        handlers: Array.isArray(info.handlers) ? info.handlers.slice(0, 16) : [],
        layout: compactLayout(info.layout)
      };
    }

    function compactChange(change) {
      if (!change || typeof change !== 'object') return null;
      return {
        id: change.id ?? null,
        parentId: change.parentId ?? null,
        depth: change.depth ?? null,
        name: change.name || null,
        owner: change.owner || null,
        label: change.label || null,
        role: change.role || null,
        testID: change.testID || null,
        before: compactLayout(change.before),
        after: compactLayout(change.after)
      };
    }

    function compactEvent(event) {
      const out = {
        t: event.t,
        type: event.type
      };
      if (event.filter != null) out.filter = event.filter;
      if (event.message) out.message = event.message;
      if (event.nodeCount != null) out.nodeCount = event.nodeCount;
      if (event.truncated != null) out.truncated = event.truncated;
      if (event.frameTime != null) out.frameTime = event.frameTime;
      if (event.changedLayout?.length) {
        out.changedLayoutCount = event.changedLayout.length;
        out.changedComponents = event.changedLayout.slice(0, 8).map((item) => ({
          name: item?.name || null,
          owner: item?.owner || null,
          label: item?.label || null,
          testID: item?.testID || null
        }));
      }
      if (event.activeElements?.length) {
        out.activeElementCount = event.activeElements.length;
        out.activeComponents = event.activeElements.slice(0, 8).map((item) => ({
          name: item?.name || null,
          owner: item?.owner || null,
          label: item?.label || null,
          testID: item?.testID || null,
          handlers: Array.isArray(item?.handlers) ? item.handlers.slice(0, 8) : []
        }));
      }
      return out;
    }

    function install() {
      tracer.filter = componentFilter || null;
      if (tracer.installed) {
        push('traceAlreadyInstalled', { filter: tracer.filter });
        return;
      }
      tracer.installed = true;
      tracer.startedAt = new Date().toISOString();
      const hook = globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__;
      if (hook && typeof hook.getFiberRoots === 'function') {
        tracer.originals.onCommitFiberRoot = hook.onCommitFiberRoot;
        hook.onCommitFiberRoot = function tracedCommit(...args) {
          try { handleCommit(args[1]); } catch (error) { tracer.errors.push(short(error?.message || error, 220)); }
          if (typeof tracer.originals.onCommitFiberRoot === 'function') return tracer.originals.onCommitFiberRoot.apply(this, args);
        };
        for (const rendererId of Array.from(hook.renderers?.keys?.() || [])) {
          for (const root of Array.from(hook.getFiberRoots(rendererId) || [])) {
            try { handleCommit(root, 'initialTree'); } catch (error) { tracer.errors.push(short(error?.message || error, 220)); }
          }
        }
      } else {
        push('warning', { message: 'React DevTools hook not available; only requestAnimationFrame patch can be installed.' });
      }
      if (typeof globalThis.requestAnimationFrame === 'function' && !tracer.originals.requestAnimationFrame) {
        tracer.originals.requestAnimationFrame = globalThis.requestAnimationFrame;
        globalThis.requestAnimationFrame = function tracedRaf(callback) {
          push('requestAnimationFrame', {});
          return tracer.originals.requestAnimationFrame.call(this, function tracedRafCallback(ts) {
            push('animationFrame', { frameTime: ts });
            return callback(ts);
          });
        };
      }
      push('traceStarted', { filter: tracer.filter });
    }

    function read() {
      const events = tracer.events.slice(-maxEvents);
      const counts = {};
      const handlers = {};
      const components = {};
      const layoutChanges = [];
      const activeElements = new Map();
      for (const event of events) {
        counts[event.type] = (counts[event.type] || 0) + 1;
        if (event.handler) handlers[event.handler] = (handlers[event.handler] || 0) + 1;
        if (event.component) components[event.component] = (components[event.component] || 0) + 1;
        if (event.changedLayout?.length) {
          layoutChanges.push(...event.changedLayout);
          for (const item of event.changedLayout) {
            if (item?.name) components[item.name] = (components[item.name] || 0) + 1;
          }
        }
        if (event.activeElements?.length) {
          for (const item of event.activeElements) {
            if (item?.name) components[item.name] = (components[item.name] || 0) + 1;
            for (const handler of item?.handlers || []) handlers[handler] = (handlers[handler] || 0) + 1;
            const key = [item?.name, item?.owner, item?.label, item?.testID, item?.depth].filter(Boolean).join('|');
            if (key) activeElements.set(key, compactElement(item));
          }
        }
      }
      const top = (object) => Object.entries(object).sort((a, b) => b[1] - a[1]).slice(0, 20).map(([name, count]) => ({ name, count }));
      const compactEvents = events.map(compactEvent);
      const perfBridge = globalThis.__EXPO98_PERF_BRIDGE__ ||
      globalThis.__EXPO_IOS_PERF_BRIDGE__ ||
        (globalThis.__EXPO98_INSTRUMENTATION__?.performance || globalThis.__EXPO_IOS_INSTRUMENTATION__?.performance);
      const renderPayload = (() => {
        try { return perfBridge?.renders?.read ? perfBridge.renders.read() : null; } catch { return null; }
      })();
      const commits = Array.isArray(renderPayload?.renders?.commits) ? renderPayload.renders.commits : Array.isArray(renderPayload?.commits) ? renderPayload.commits : [];
      const frameEvents = events.filter((event) => event.type === 'animationFrame' && event.frameTime != null);
      const frameDeltas = [];
      for (let index = 1; index < frameEvents.length; index += 1) {
        frameDeltas.push(Math.round((Number(frameEvents[index].frameTime) - Number(frameEvents[index - 1].frameTime)) * 10) / 10);
      }
      const response = {
        available: true,
        installed: tracer.installed,
        startedAt: tracer.startedAt,
        filter: tracer.filter || null,
        eventCount: tracer.events.length,
        returnedEventCount: events.length,
        counts,
        topDeclaredHandlers: top(handlers),
        topComponents: top(components),
        activeElements: Array.from(activeElements.values()).slice(-30),
        layoutChanges: layoutChanges.slice(-40).map(compactChange).filter(Boolean),
        renderSummary: {
          commitCount: commits.length,
          worstCommitMs: commits.reduce((max, commit) => Math.max(max, Number(commit.durationMs ?? commit.actualDuration) || 0), 0),
          commits: commits.slice(-40)
        },
        frameSummary: {
          sampleCount: frameDeltas.length,
          worstFrameMs: frameDeltas.length ? Math.max(...frameDeltas) : null,
          droppedFrameCount: frameDeltas.filter((delta) => delta > 33.4).length,
          longFrameCount: frameDeltas.filter((delta) => delta > 16.7).length
        },
        recentEvents: compactEvents.slice(-20),
        errors: tracer.errors.slice(-20),
        interpretationHints: [
          'Scroll or drag bugs usually show reactCommit/layout changes and handler-bearing components such as onScroll/onResponderMove/onGestureEvent near the affected subtree.',
          'This tracer does not wrap app event handlers; topDeclaredHandlers reports handler props present in the committed tree, not handler invocations.',
          'If requestAnimationFrame/animationFrame is active but no React commits occur, the animation may be native-driver/Reanimated/UI-thread and needs screenshot/video or native instrumentation.',
          'changedLayout is declared prop/class/style churn, not final Yoga frame movement.'
        ]
      };
      if (includeEvents) response.events = events;
      return response;
    }

    function stop() {
      const hook = globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__;
      if (hook && tracer.originals && Object.prototype.hasOwnProperty.call(tracer.originals, 'onCommitFiberRoot')) {
        hook.onCommitFiberRoot = tracer.originals.onCommitFiberRoot;
      }
      if (tracer.originals?.requestAnimationFrame) {
        globalThis.requestAnimationFrame = tracer.originals.requestAnimationFrame;
      }
      tracer.installed = false;
      push('traceStopped', {});
      return read();
    }

    if (action === 'start') {
      tracer.events = [];
      tracer.errors = [];
      tracer.lastSnapshot = new Map();
      install();
      return read();
    }
    if (action === 'read') return read();
    if (action === 'clear') {
      tracer.events = [];
      tracer.errors = [];
      tracer.lastSnapshot = new Map();
      push('traceCleared', {});
      return read();
    }
    if (action === 'stop') return stop();
    return { available: false, reason: 'Unknown trace action: ' + action };
  })()`;
}
function targetSummary4(target) {
  const record = asRecord10(target);
  if (!record) return null;
  return {
    title: record.title,
    appId: record.appId,
    deviceName: record.deviceName,
    description: record.description
  };
}
function traceRealValidation(trace, action) {
  const record = asRecord10(trace);
  if (!record || record.available === false) {
    return realValidation({
      state: "unvalidated",
      evidence: [
        { source: "trace", command: `trace.${String(action ?? "read")}`, confidence: "low" }
      ],
      missingEvidence: [
        {
          signal: "trace-runtime",
          reason: "No Hermes trace payload was returned.",
          recommendedFix: "Start Metro, launch a Hermes target, and run trace --action start before reading."
        }
      ]
    });
  }
  const hasCommits = Number(asRecord10(record.renderSummary)?.commitCount ?? 0) > 0;
  const hasFrames = Number(asRecord10(record.frameSummary)?.sampleCount ?? 0) > 0;
  const hasEvents = Number(record.eventCount ?? 0) > 0;
  return realValidation({
    state: hasEvents && (hasCommits || hasFrames) ? "validated" : "partial",
    claimsAllowed: {
      renderCost: hasCommits,
      frameJank: hasFrames
    },
    evidence: [
      {
        source: "hermes-runtime-trace",
        command: `trace.${String(action ?? "read")}`,
        confidence: hasEvents ? "medium" : "low"
      }
    ],
    missingEvidence: [
      ...!hasCommits ? [
        {
          signal: "react-profiler-commits",
          reason: "Trace did not include React Profiler commit durations.",
          recommendedFix: "Mount the dev-only Profiler bridge or run rn renders with commit recording."
        }
      ] : [],
      ...!hasFrames ? [
        {
          signal: "frame-deltas",
          reason: "Trace did not observe enough animation frames to compute frame deltas.",
          recommendedFix: "Start trace before an animated interaction and rerun trace read/stop."
        }
      ] : []
    ]
  });
}
function requireOptionalString6(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
function clampNumber10(value, min, max) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) {
    throw new Error(`Expected a finite number, got ${value}.`);
  }
  return Math.min(Math.max(numberValue, min), max);
}
function getPath(value, path16) {
  let current = value;
  for (const key of path16) {
    current = asRecord10(current)?.[key];
  }
  return current;
}
function asString(value) {
  return typeof value === "string" && value.trim() ? value : null;
}
function asRecord10(value) {
  return value && typeof value === "object" ? value : null;
}

// src/commands/ref-actions-wait/src/main/defaults.ts
import { readdir as readdir5, readFile as readFile11 } from "node:fs/promises";
import { join as join6 } from "node:path";

// src/state/session-run-records/src/main/paths.ts
import { basename as basename5, join as join5, resolve as resolve5 } from "node:path";
function resolveExpoStateRoot6(args = {}) {
  if (args.stateDir) {
    const resolved = resolve5(args.stateDir);
    return basename5(resolved) === "runs" ? resolve5(join5(resolved, "..")) : resolved;
  }
  const root = resolve5(args.root ?? args.cwd ?? process.cwd());
  return join5(root, ".scratch", "expo98");
}
function sessionDirectory3(stateRoot, sessionId) {
  return join5(stateRoot, "sessions", sessionId);
}
function sessionJsonPath(stateRoot, sessionId) {
  return join5(sessionDirectory3(stateRoot, sessionId), "session.json");
}

// src/commands/ref-actions-wait/src/main/common.ts
function requireString11(value, field) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${field} must be a non-empty string.`);
  }
  return value.trim();
}
function clampNumber11(value, min, max) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) {
    throw new Error(`Expected a finite number, got ${value}.`);
  }
  return Math.min(Math.max(numberValue, min), max);
}
function normalizeFinderText(value) {
  return String(value ?? "").toLowerCase().trim();
}

// src/commands/ref-actions-wait/src/main/planning.ts
async function planRefActionWithDeps(args, deps) {
  const action = requireString11(args.action, "action");
  const ref = requireString11(args.ref, "ref");
  const cache = await deps.readLatestRefCache(args);
  if (!cache) {
    return { available: false, reason: "No snapshot exists for the current session." };
  }
  const record = cache.refs.find((item) => item.ref === ref);
  if (!record) {
    return { available: false, reason: "Ref not found in the latest snapshot.", ref };
  }
  if (record.stale) {
    return { available: false, reason: "Ref is stale. Capture a new snapshot before acting.", ref };
  }
  if (!record.actions.includes(action)) {
    return {
      available: false,
      reason: "Action is not available for this ref.",
      ref,
      action,
      availableActions: record.actions
    };
  }
  return {
    available: true,
    dryRun: true,
    plan: {
      action,
      ref,
      targetId: record.targetId,
      box: record.box ?? null,
      point: record.box ? centerPoint(record.box) : null
    }
  };
}
async function refPointWithDeps(refValue, deps) {
  const ref = requireString11(refValue, "ref");
  const found = await readRefRecord2(ref, deps);
  if (found.available === false) {
    return found;
  }
  const box = found.record.box;
  if (!box) {
    return { available: false, reason: "Ref does not include bounds.", ref };
  }
  return {
    available: true,
    ref,
    point: centerPoint(box),
    box
  };
}
async function scrollPlanWithDeps(args, deps) {
  const maybeRef = /^@e\d+$/.test(String(args.ref ?? "")) ? args.ref : null;
  const direction = requireString11(
    maybeRef ? args.targetRef ?? args.direction : args.direction ?? args.ref,
    "direction"
  ).toLowerCase();
  const amount = clampNumber11(args.amount ?? args.text ?? 600, 1, 5e3);
  const origin = maybeRef ? await readRefPoint(maybeRef, args, deps) : { available: true, point: { x: 200, y: 700 } };
  if (origin.available === false) {
    return origin;
  }
  const point = origin.point;
  const delta = {
    down: { x: 0, y: -amount },
    up: { x: 0, y: amount },
    left: { x: amount, y: 0 },
    right: { x: -amount, y: 0 }
  }[direction];
  if (!delta) {
    return { available: false, reason: `Unknown scroll direction: ${direction}`, direction };
  }
  return {
    available: true,
    dryRun: true,
    action: "scroll",
    direction,
    amount,
    coordinates: {
      startX: point.x,
      startY: point.y,
      endX: point.x + delta.x,
      endY: point.y + delta.y
    }
  };
}
async function readRefRecord2(ref, deps, args) {
  const cache = await deps.readLatestRefCache(args);
  if (!cache)
    return { available: false, reason: "No snapshot exists for the current session.", ref };
  const record = cache.refs.find((item) => item.ref === ref);
  if (!record) return { available: false, reason: "Ref not found in the latest snapshot.", ref };
  if (record.stale)
    return { available: false, reason: "Ref is stale. Capture a new snapshot before acting.", ref };
  return { available: true, record };
}
async function readRefPoint(refValue, args, deps) {
  const ref = requireString11(refValue, "ref");
  const found = await readRefRecord2(ref, deps, args);
  if (found.available === false) {
    return found;
  }
  const box = found.record.box;
  if (!box) {
    return { available: false, reason: "Ref does not include bounds.", ref };
  }
  return {
    available: true,
    ref,
    point: centerPoint(box),
    box
  };
}
function centerPoint(box) {
  return {
    x: box.x + box.width / 2,
    y: box.y + box.height / 2
  };
}

// src/commands/ref-actions-wait/src/main/defaults.ts
var defaultRefActionDependencies = {
  readLatestRefCache: readLatestRefCache3,
  planFinderAction: (args) => planRefActionWithDeps(args, defaultRefActionDependencies)
};
async function readLatestRefCache3(args = {}) {
  const stateRoot = resolveExpoStateRoot6(
    args
  );
  const session = await readLatestSession3(stateRoot);
  if (!session?.sessionId || !session.lastSnapshotId) return null;
  try {
    return await readJson2(join6(stateRoot, "sessions", session.sessionId, "refs.json"));
  } catch {
    return null;
  }
}
async function readLatestSession3(stateRoot) {
  const sessionsRoot = join6(stateRoot, "sessions");
  const entries = await readdir5(sessionsRoot, { withFileTypes: true }).catch(() => []);
  const sessions = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const session = await readJson2(join6(sessionsRoot, entry.name, "session.json")).catch(
      () => null
    );
    if (session && typeof session === "object") sessions.push(session);
  }
  sessions.sort(
    (left, right) => String(right.updatedAt ?? right.createdAt ?? "").localeCompare(
      String(left.updatedAt ?? left.createdAt ?? "")
    )
  );
  return sessions[0] ?? null;
}
async function readJson2(path16) {
  return JSON.parse(await readFile11(path16, "utf8"));
}

// src/commands/ref-actions-wait/src/main/find.ts
async function findCommand(args, deps = defaultRefActionDependencies) {
  const kind = requireString11(args.kind, "kind").toLowerCase();
  const value = requireString11(args.value, "value");
  const cache = await deps.readLatestRefCache(args);
  if (!cache) {
    return toolJson({ available: false, reason: "No snapshot exists for the current session." });
  }
  const matches = findMatches(cache.refs, kind, value, args.name);
  const payload = {
    available: matches.length > 0,
    kind,
    value,
    name: args.name ?? null,
    matches
  };
  if (args.action) {
    payload.actionResult = matches[0] ? await finderActionResult({ ...args, ref: matches[0].ref }, deps) : { available: false, reason: "No matching ref for action.", action: args.action };
  }
  return toolJson(payload);
}
async function finderActionResult(args, deps) {
  const action = requireString11(args.action, "action");
  const dryRun = args.dryRun !== false;
  if (!["tap", "inspect", "long-press", "fill", "scroll-into-view", "focus"].includes(action)) {
    return { available: false, reason: `Unsupported finder action: ${action}`, action };
  }
  if (deps.planFinderAction) {
    return deps.planFinderAction({ ...args, action, dryRun });
  }
  if (action === "tap" || ["long-press", "fill", "scroll-into-view", "focus"].includes(action)) {
    return unwrapToolJson(toolJson(await planUnavailable(action)));
  }
  if (action === "inspect") {
    return {
      available: false,
      reason: "Inspect action is not wired in this module.",
      ref: args.ref
    };
  }
  return { available: false, reason: `Unsupported finder action: ${action}`, action };
}
function findMatches(refs, kind, value, name) {
  if (kind === "first") {
    const match = refs.find(
      (record) => refMatches(record, "source", value, name) || refMatches(record, "text", value, name) || refMatches(record, "label", value, name)
    );
    return match ? [match] : [];
  }
  if (kind === "nth") {
    const index = clampNumber11(Number(value), 1, Number.MAX_SAFE_INTEGER) - 1;
    const needle = requireString11(name, "name");
    const matches = refs.filter(
      (record) => refMatches(record, "source", needle) || refMatches(record, "text", needle) || refMatches(record, "label", needle)
    );
    return matches[index] ? [matches[index]] : [];
  }
  return refs.filter((record) => refMatches(record, kind, value, name));
}
function refMatches(record, kind, value, name) {
  const expected = normalizeFinderText(value);
  if (kind === "role") {
    if (normalizeFinderText(record.role) !== expected) return false;
    if (!name) return true;
    const accessibleName = normalizeFinderText(
      [record.label, record.text].filter(Boolean).join(" ")
    );
    return accessibleName.includes(normalizeFinderText(name));
  }
  if (kind === "text") return normalizeFinderText(record.text ?? record.label).includes(expected);
  if (kind === "label") return normalizeFinderText(record.label).includes(expected);
  if (kind === "placeholder") return normalizeFinderText(record.placeholder).includes(expected);
  if (kind === "testid")
    return normalizeFinderText(record.testID ?? record.nativeID).includes(expected);
  if (kind === "source") {
    return normalizeFinderText(
      [record.component, record.source?.file].filter(Boolean).join(" ")
    ).includes(expected);
  }
  throw new Error(`Unknown finder kind: ${kind}`);
}
async function planUnavailable(action) {
  return { available: false, reason: `No action planner configured for ${action}.`, action };
}

// src/commands/ref-actions-wait/src/main/ref-actions.ts
function planRefAction(args, deps = defaultRefActionDependencies) {
  return planRefActionWithDeps(args, deps);
}
function refPoint(refValue, deps = defaultRefActionDependencies) {
  return refPointWithDeps(refValue, deps);
}
function scrollPlan(args, deps = defaultRefActionDependencies) {
  return scrollPlanWithDeps(args, deps);
}

// src/commands/ref-actions-wait/src/main/wait.ts
async function waitCommand(args, deps = defaultRefActionDependencies) {
  const now4 = deps.now ?? Date.now;
  const sleep = deps.sleep ?? defaultSleep;
  const started = now4();
  const timeoutMs = clampNumber11(args.timeoutMs ?? 5e3, 0, 6e4);
  const intervalMs = Math.min(Math.max(Math.floor(timeoutMs / 10), 25), 250);
  const predicate = waitPredicate(args);
  if (!predicate) {
    const ms = clampNumber11(args.ms ?? 0, 0, 6e4);
    if (ms > 0) await sleep(ms);
    return toolJson({
      matched: true,
      predicate: { kind: "sleep", ms },
      elapsedMs: now4() - started
    });
  }
  if (predicate.kind === "metro-ready" || predicate.kind === "app-ready" || predicate.kind === "fn") {
    if (!deps.waitRuntimePredicate) {
      return toolJson({
        matched: false,
        available: false,
        reason: "Runtime wait predicates require a runtime adapter.",
        predicate,
        timeoutMs,
        elapsedMs: now4() - started
      });
    }
    const runtimeResult = await deps.waitRuntimePredicate(predicate, args, {
      started,
      timeoutMs,
      intervalMs
    });
    return toolJson(runtimeResult);
  }
  let lastCache = null;
  do {
    lastCache = await deps.readLatestRefCache(args);
    if (!lastCache) {
      return toolJson({
        matched: false,
        reason: "No snapshot exists for the current session.",
        predicate,
        lastEvidence: null
      });
    }
    const result = evaluateWaitPredicate(lastCache, predicate);
    if (result.final || result.matched) {
      const payload = result.payload?.matched ? { ...result.payload, elapsedMs: now4() - started } : result.payload;
      return toolJson(payload);
    }
    if (now4() - started >= timeoutMs) break;
    await sleep(Math.min(intervalMs, timeoutMs - (now4() - started)));
  } while (now4() - started <= timeoutMs);
  return toolJson(timeoutWaitPayload(predicate, lastCache, timeoutMs, now4() - started));
}
function waitPredicate(args = {}) {
  if (args.metroReady === true) return { kind: "metro-ready" };
  if (args.appReady === true) return { kind: "app-ready" };
  if (args.fn !== void 0) return { kind: "fn", expression: requireString11(args.fn, "fn") };
  if (args.route !== void 0) return { kind: "route", route: requireString11(args.route, "route") };
  if (args.noSpinner === true) return { kind: "no-spinner" };
  if (args.text !== void 0) return { kind: "text", text: requireString11(args.text, "text") };
  if (args.ref !== void 0 || args.state !== void 0) {
    return {
      kind: "ref-state",
      ref: requireString11(args.ref, "ref"),
      state: requireString11(args.state ?? "visible", "state").toLowerCase()
    };
  }
  return null;
}
function evaluateWaitPredicate(cache, predicate) {
  if (predicate.kind === "text") {
    const expected = normalizeFinderText(predicate.text);
    const ref = cache.refs.find(
      (record) => !record.stale && normalizeFinderText([record.text, record.label].filter(Boolean).join(" ")).includes(
        expected
      )
    );
    if (!ref) return { matched: false, final: false };
    return {
      matched: true,
      final: true,
      payload: { matched: true, predicate, ref, lastEvidence: waitEvidence(cache) }
    };
  }
  if (predicate.kind === "ref-state") {
    if (!/^@e\d+$/.test(predicate.ref)) {
      return {
        matched: false,
        final: true,
        payload: { matched: false, reason: "Ref must look like @e1.", ref: predicate.ref }
      };
    }
    if (!["visible", "hidden"].includes(predicate.state)) {
      throw new Error(`Unknown wait state: ${predicate.state}`);
    }
    const ref = cache.refs.find((record) => record.ref === predicate.ref);
    if (!ref) {
      return {
        matched: false,
        final: true,
        payload: {
          matched: false,
          reason: "Ref not found in the latest snapshot.",
          ref: predicate.ref
        }
      };
    }
    if (ref.stale) {
      return {
        matched: false,
        final: true,
        payload: {
          matched: false,
          reason: "Ref is stale. Capture a new snapshot before waiting on it.",
          ref: predicate.ref
        }
      };
    }
    const visible = refHasVisibleEvidence(ref);
    const matched = predicate.state === "visible" ? visible : !visible;
    if (!matched) return { matched: false, final: false };
    return {
      matched: true,
      final: true,
      payload: { matched: true, predicate, ref, lastEvidence: waitEvidence(cache) }
    };
  }
  if (predicate.kind === "route") {
    const expected = normalizeFinderText(predicate.route);
    const ref = cache.refs.find(
      (record) => !record.stale && normalizeFinderText([record.text, record.label].filter(Boolean).join(" ")).includes(
        expected
      )
    );
    if (!ref) return { matched: false, final: false };
    return {
      matched: true,
      final: true,
      payload: { matched: true, predicate, ref, lastEvidence: waitEvidence(cache) }
    };
  }
  if (predicate.kind === "no-spinner") {
    const spinner = cache.refs.find(
      (record) => /spinner|loading|progress/i.test(
        [record.role, record.label, record.text].filter(Boolean).join(" ")
      )
    );
    if (spinner) return { matched: false, final: false };
    return {
      matched: true,
      final: true,
      payload: { matched: true, predicate, lastEvidence: waitEvidence(cache) }
    };
  }
  throw new Error(`Unknown wait predicate: ${predicate.kind}`);
}
function timeoutWaitPayload(predicate, cache, timeoutMs, elapsedMs) {
  const refState = predicate;
  const label = predicate.kind === "text" ? "text" : `${refState.ref} to become ${refState.state}`;
  return {
    matched: false,
    reason: `Timed out waiting for ${label}.`,
    predicate,
    timeoutMs,
    elapsedMs,
    lastEvidence: waitEvidence(cache, { includeSampleRefs: true })
  };
}
function waitEvidence(cache, options = {}) {
  if (!cache) return null;
  return {
    snapshotId: cache.snapshotId ?? null,
    targetId: cache.targetId ?? null,
    refCount: cache.refs?.length ?? 0,
    ...options.includeSampleRefs ? { sampleRefs: (cache.refs ?? []).slice(0, 5).map((record) => waitSampleRef(record)) } : {}
  };
}
function refHasVisibleEvidence(record) {
  return Boolean(
    record?.box || normalizeFinderText(record?.text) || normalizeFinderText(record?.label)
  );
}
function waitSampleRef(record) {
  return {
    ref: record.ref,
    role: record.role ?? null,
    label: record.label ?? null,
    text: record.text ?? null,
    stale: record.stale === true
  };
}
function defaultSleep(ms) {
  return new Promise((resolve18) => setTimeout(resolve18, ms));
}

// src/commands/screenshot-capture/src/main/index.ts
import { execFile as execFile4, spawn as spawn2 } from "node:child_process";
import * as fs6 from "node:fs/promises";
import * as os from "node:os";
import * as path10 from "node:path";
var MAX_OUTPUT10 = 4e4;
async function automationTakeScreenshot(args, deps = {}) {
  if (args.full === true) {
    return toolJson(await (deps.captureFullScreenshot ?? captureFullScreenshot)(args, deps));
  }
  if (args.annotate === true) {
    return toolJson(await (deps.annotatedScreenshot ?? annotatedScreenshot)(args, deps));
  }
  return toolJson(await (deps.captureScreenshot ?? captureScreenshot)(args, deps));
}
async function captureFullScreenshot(args, deps = {}) {
  const platform = args.platform ?? "ios";
  if (platform !== "ios") {
    return {
      available: false,
      reason: "Segmented full-page capture is currently implemented for iOS simulator targets only.",
      mode: "full",
      platform
    };
  }
  const axe = await commandPath2("axe", deps);
  if (!axe) {
    return {
      available: false,
      reason: "Full-page capture requires the axe CLI to perform real simulator scroll gestures.",
      mode: "full",
      platform
    };
  }
  const magick = await commandPath2("magick", deps);
  if (!magick) {
    return {
      available: false,
      reason: "Full-page capture requires ImageMagick's magick command to stitch captured viewport segments.",
      mode: "full",
      platform
    };
  }
  const device = await resolveIosDevice2(args.device, deps);
  const outputPath = path10.resolve(
    args.outputPath ?? path10.join(os.tmpdir(), "expo98-screenshots", `full-screenshot-${safeTimestamp(deps)}.png`)
  );
  const segmentCount = clampNumber12(args.fullSegments ?? args.segments ?? 3, 1, 12);
  const segmentDir = path10.join(
    path10.dirname(outputPath),
    `${path10.basename(outputPath, path10.extname(outputPath))}-segments`
  );
  await mkdir8(segmentDir, deps);
  const segments = [];
  const firstPath = path10.join(segmentDir, "segment-000.png");
  const first = await (deps.captureScreenshot ?? captureScreenshot)(
    { ...args, full: false, annotate: false, outputPath: firstPath, device: device.udid, platform },
    deps
  );
  if (isUnavailable(first)) return first;
  segments.push(firstPath);
  const dimensions = await imageDimensions(magick, firstPath, deps);
  const width = dimensions?.width ?? 390;
  const height = dimensions?.height ?? 844;
  const startX = Math.max(1, Math.round(width / 2));
  const startY = Math.max(1, Math.round(height * 0.82));
  const endY = Math.max(1, Math.round(height * 0.28));
  const gestureResults = [];
  for (let index = 1; index < segmentCount; index += 1) {
    const gesture = await execFilePromise2(
      axe,
      [
        "swipe",
        "--start-x",
        String(startX),
        "--start-y",
        String(startY),
        "--end-x",
        String(startX),
        "--end-y",
        String(endY),
        "--duration",
        "0.45",
        "--udid",
        device.udid
      ],
      { timeout: 1e4, rejectOnError: false },
      deps
    );
    gestureResults.push({
      index,
      stdout: truncate10(gesture.stdout),
      stderr: truncate10(gesture.stderr),
      error: gesture.error ?? null
    });
    if (gesture.error) break;
    await wait(300, deps);
    const segmentPath = path10.join(segmentDir, `segment-${String(index).padStart(3, "0")}.png`);
    const segment = await (deps.captureScreenshot ?? captureScreenshot)(
      {
        ...args,
        full: false,
        annotate: false,
        outputPath: segmentPath,
        device: device.udid,
        platform
      },
      deps
    );
    if (isUnavailable(segment)) break;
    segments.push(segmentPath);
  }
  for (let index = 1; index < segments.length; index += 1) {
    await execFilePromise2(
      axe,
      [
        "swipe",
        "--start-x",
        String(startX),
        "--start-y",
        String(endY),
        "--end-x",
        String(startX),
        "--end-y",
        String(startY),
        "--duration",
        "0.25",
        "--udid",
        device.udid
      ],
      { timeout: 1e4, rejectOnError: false },
      deps
    );
  }
  await mkdir8(path10.dirname(outputPath), deps);
  const stitch = await execFilePromise2(
    magick,
    [...segments, "-append", outputPath],
    {
      timeout: 3e4,
      rejectOnError: false
    },
    deps
  );
  if (stitch.error || !await defaultPathExists(outputPath, deps)) {
    return {
      available: false,
      reason: "Captured scroll segments but failed to stitch the full screenshot artifact.",
      mode: "full",
      platform,
      device,
      outputPath,
      segmentDir,
      segments,
      stitch: {
        stdout: truncate10(stitch.stdout),
        stderr: truncate10(stitch.stderr),
        error: stitch.error
      }
    };
  }
  return {
    available: true,
    mode: "full",
    strategy: "segmented-scroll-stitch",
    platform,
    device,
    outputPath,
    segmentDir,
    segments,
    segmentCount: segments.length,
    tools: { gesture: "axe", stitch: "magick" },
    limitation: "iOS Simulator does not expose a stable native full-page screenshot API for arbitrary React Native views; this artifact stitches real viewport screenshots captured after simulator scroll gestures.",
    gestures: gestureResults,
    stitch: {
      stdout: truncate10(stitch.stdout),
      stderr: truncate10(stitch.stderr)
    }
  };
}
async function imageDimensions(magick, imagePath, deps = {}) {
  const result = await execFilePromise2(
    magick,
    ["identify", "-format", "%w %h", imagePath],
    {
      timeout: 5e3,
      rejectOnError: false
    },
    deps
  );
  if (result.error) return null;
  const match = String(result.stdout ?? "").trim().match(/^(\d+)\s+(\d+)$/);
  if (!match) return null;
  return { width: Number(match[1]), height: Number(match[2]) };
}
async function captureScreenshot(args, deps = {}) {
  const platform = args.platform ?? "ios";
  const outputPath = path10.resolve(
    args.outputPath ?? path10.join(os.tmpdir(), "expo98-screenshots", `screenshot-${safeTimestamp(deps)}.png`)
  );
  await mkdir8(path10.dirname(outputPath), deps);
  if (platform === "android") {
    await adbScreenshot(args.device, outputPath, deps);
    return { platform, device: args.device ?? null, outputPath };
  }
  const device = await resolveIosDevice2(args.device, deps);
  const result = await execFilePromise2(
    "xcrun",
    ["simctl", "io", device.udid, "screenshot", outputPath],
    {
      timeout: 3e4,
      rejectOnError: false
    },
    deps
  );
  if (result.error || !await defaultPathExists(outputPath, deps)) {
    return {
      available: false,
      reason: "Screenshot tooling failed.",
      platform,
      device,
      outputPath,
      stdout: truncate10(result.stdout),
      stderr: truncate10(result.stderr),
      error: result.error
    };
  }
  return {
    platform,
    device,
    outputPath,
    stdout: truncate10(result.stdout),
    stderr: truncate10(result.stderr)
  };
}
async function annotatedScreenshot(args, deps = {}) {
  const cache = await readLatestRefCache4(args, deps);
  if (!cache) {
    return { available: false, reason: "No snapshot exists for the current session." };
  }
  const labelMap = buildScreenshotLabelMap(cache);
  if (labelMap.available === false) return labelMap;
  const screenshot = asRecord11(await captureScreenshot({ ...args, annotate: false }, deps));
  if (screenshot.available === false) return screenshot;
  const outputPath = String(screenshot.outputPath);
  const artifacts = annotatedScreenshotArtifactPaths(outputPath);
  const labels = asRecord11(labelMap).labels ?? [];
  await writeJsonFile4(
    artifacts.labelMap,
    {
      schemaVersion: 1,
      createdAt: deps.nowIso?.() ?? (/* @__PURE__ */ new Date()).toISOString(),
      screenshot: outputPath,
      annotatedImage: artifacts.annotatedImage,
      snapshotId: cache.snapshotId,
      targetId: cache.targetId,
      labels
    },
    deps
  );
  await writeFile6(
    artifacts.annotatedImage,
    annotatedScreenshotSvg({ screenshotPath: outputPath, labels }),
    "utf8",
    deps
  );
  return {
    ...screenshot,
    available: true,
    annotated: true,
    snapshotId: cache.snapshotId,
    targetId: cache.targetId,
    artifacts: {
      screenshot: outputPath,
      annotatedImage: artifacts.annotatedImage,
      labelMap: artifacts.labelMap
    },
    labels
  };
}
function buildScreenshotLabelMap(cache) {
  const refs = cache.refs ?? [];
  const targetMismatch = refs.filter(
    (record) => record.snapshotId !== cache.snapshotId || record.targetId !== cache.targetId
  );
  if (targetMismatch.length > 0) {
    return {
      available: false,
      reason: "Ref cache contains refs from a different snapshot or target.",
      snapshotId: cache.snapshotId ?? null,
      targetId: cache.targetId ?? null,
      mismatchedRefs: targetMismatch.map((record) => record.ref)
    };
  }
  const activeRefs = refs.filter((record) => record.stale !== true);
  const missingBounds = activeRefs.filter((record) => !record.box);
  if (missingBounds.length > 0) {
    return {
      available: false,
      reason: "Cannot annotate screenshot because one or more refs do not include bounds.",
      snapshotId: cache.snapshotId ?? null,
      targetId: cache.targetId ?? null,
      missingRefs: missingBounds.map((record) => record.ref)
    };
  }
  if (activeRefs.length === 0) {
    return {
      available: false,
      reason: "No bounded refs are available for annotation.",
      snapshotId: cache.snapshotId ?? null,
      targetId: cache.targetId ?? null
    };
  }
  return {
    available: true,
    labels: activeRefs.map((record, index) => ({
      ref: record.ref,
      label: record.label ?? record.text ?? record.role ?? record.ref,
      role: record.role ?? null,
      text: record.text ?? null,
      source: record.source ?? null,
      box: record.box,
      snapshotId: cache.snapshotId,
      targetId: cache.targetId,
      index: index + 1
    }))
  };
}
function annotatedScreenshotArtifactPaths(outputPath) {
  const ext = path10.extname(outputPath);
  const base = ext ? outputPath.slice(0, -ext.length) : outputPath;
  return {
    labelMap: `${base}.labels.json`,
    annotatedImage: `${base}.annotated.svg`
  };
}
function annotatedScreenshotSvg(args) {
  const { width, height } = screenshotOverlaySize(args.labels);
  const imageHref = escapeHtml3(path10.basename(args.screenshotPath));
  const labelSvg = args.labels.map((label) => {
    const box = label.box;
    const textX = Math.max(0, box.x);
    const textY = Math.max(16, box.y - 6);
    const text = `${label.index}. ${label.ref}`;
    return [
      `<rect x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" fill="none" stroke="#ff3b30" stroke-width="2"/>`,
      `<rect x="${textX}" y="${textY - 15}" width="${Math.max(44, text.length * 8)}" height="18" fill="#ff3b30"/>`,
      `<text x="${textX + 4}" y="${textY - 2}" fill="#fff" font-family="Menlo, monospace" font-size="12">${escapeHtml3(text)}</text>`
    ].join("\n");
  }).join("\n");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <image href="${imageHref}" x="0" y="0" width="${width}" height="${height}" preserveAspectRatio="xMinYMin meet"/>
  ${labelSvg}
</svg>
`;
}
function screenshotOverlaySize(labels) {
  const maxX = Math.max(390, ...labels.map((label) => label.box.x + label.box.width + 24));
  const maxY = Math.max(844, ...labels.map((label) => label.box.y + label.box.height + 24));
  return { width: Math.ceil(maxX), height: Math.ceil(maxY) };
}
function escapeHtml3(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function clampNumber12(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new Error(`Expected a finite number, got ${value}.`);
  }
  return Math.min(Math.max(number, min), max);
}
function truncate10(value, limit = MAX_OUTPUT10) {
  const text = String(value ?? "");
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}
[truncated ${text.length - limit} characters]`;
}
async function pathExists4(file, deps) {
  return deps.access(file).then(
    () => true,
    () => false
  );
}
async function execFilePromise2(file, args, options, deps = {}) {
  if (deps.execFile) return deps.execFile(file, args, options);
  return new Promise((resolve18, reject) => {
    execFile4(
      file,
      args,
      { timeout: options.timeout, maxBuffer: options.maxBuffer ?? MAX_OUTPUT10 },
      (error, stdout, stderr) => {
        if (error && options.rejectOnError !== false) {
          reject(error);
          return;
        }
        const execError = error;
        resolve18({
          stdout: String(stdout ?? ""),
          stderr: String(stderr ?? ""),
          error: execError ? { message: execError.message, code: execError.code, signal: execError.signal } : null
        });
      }
    );
  });
}
async function commandPath2(command, deps) {
  if (deps.commandPath) return deps.commandPath(command);
  const result = await execFilePromise2(
    "sh",
    ["-lc", `command -v ${command}`],
    {
      timeout: 5e3,
      rejectOnError: false
    },
    deps
  );
  return String(result.stdout ?? "").trim() || null;
}
async function resolveIosDevice2(requested, deps) {
  if (deps.resolveIosDevice) return deps.resolveIosDevice(requested, { preferBooted: true });
  if (requested && /^[0-9A-Fa-f-]{20,}$/.test(requested)) {
    return { udid: requested, name: requested, state: "unknown" };
  }
  const { stdout } = await execFilePromise2(
    "xcrun",
    ["simctl", "list", "devices", "available", "--json"],
    {
      timeout: 2e4,
      maxBuffer: 4 * 1024 * 1024
    },
    deps
  );
  const parsed = JSON.parse(String(stdout ?? "{}"));
  const devices = Object.entries(parsed.devices ?? {}).flatMap(
    ([runtime2, runtimeDevices]) => runtimeDevices.map((device) => ({ ...device, runtime: runtime2 }))
  );
  if (requested) {
    const exact = devices.find((device) => device.udid === requested || device.name === requested);
    if (exact) return exact;
    const partial = devices.find(
      (device) => device.name.toLowerCase().includes(requested.toLowerCase())
    );
    if (partial) return partial;
    throw new Error(`No available iOS simulator matched: ${requested}`);
  }
  const booted = devices.find((device) => device.state === "Booted");
  if (booted) return booted;
  const iphone = [...devices].reverse().find((device) => /iPhone/.test(device.name));
  if (iphone) return iphone;
  if (devices[0]) return devices[0];
  throw new Error("No available iOS simulators found.");
}
async function adbScreenshot(device, outputPath, deps) {
  if (deps.adbScreenshot) return deps.adbScreenshot(device, outputPath);
  const args = device ? ["-s", device, "exec-out", "screencap", "-p"] : ["exec-out", "screencap", "-p"];
  await new Promise((resolve18, reject) => {
    const child = spawnProcess("adb", args, deps);
    let stderr = "";
    const chunks = [];
    let byteLength = 0;
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("adb screenshot timed out after 30000ms"));
    }, 3e4);
    child.stdout.on("data", (chunk) => {
      chunks.push(chunk);
      byteLength += chunk.byteLength;
    });
    child.stderr.setEncoding?.("utf8");
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        fs6.writeFile(outputPath, Buffer.concat(chunks, byteLength)).then(resolve18, reject);
      } else {
        reject(new Error(`adb screenshot failed with code ${code}: ${stderr}`));
      }
    });
  });
}
function spawnProcess(file, args, deps) {
  if (deps.spawnProcess)
    return deps.spawnProcess(file, args, { stdio: ["ignore", "pipe", "pipe"] });
  return spawn2(file, args, { stdio: ["ignore", "pipe", "pipe"] });
}
async function defaultPathExists(file, deps) {
  if (deps.pathExists) return deps.pathExists(file);
  return pathExists4(file, { access: fs6.access });
}
async function mkdir8(directory, deps) {
  if (deps.mkdir) return deps.mkdir(directory, { recursive: true });
  await fs6.mkdir(directory, { recursive: true });
}
async function readLatestRefCache4(args, deps) {
  if (deps.readLatestRefCache) return deps.readLatestRefCache(args);
  const stateRoot = resolveExpoStateRoot7(args);
  const session = await readLatestSession4(stateRoot, deps);
  if (!session?.lastSnapshotId || typeof session.sessionId !== "string") return null;
  return readJsonFile8(path10.join(stateRoot, "sessions", session.sessionId, "refs.json"), deps).then((value) => asRecord11(value)).catch(() => null);
}
async function writeJsonFile4(file, value, deps) {
  if (deps.writeJsonFile) return deps.writeJsonFile(file, value);
  await fs6.writeFile(file, `${JSON.stringify(value, null, 2)}
`, "utf8");
}
async function writeFile6(file, contents, encoding, deps) {
  if (deps.writeFile) return deps.writeFile(file, contents, encoding);
  await fs6.writeFile(file, contents, encoding);
}
async function wait(ms, deps) {
  if (deps.wait) return deps.wait(ms);
  await new Promise((resolve18) => setTimeout(resolve18, ms));
}
function safeTimestamp(deps) {
  return (deps.nowIso?.() ?? (/* @__PURE__ */ new Date()).toISOString()).replace(/[:.]/g, "-");
}
function isUnavailable(value) {
  return Boolean(
    value && typeof value === "object" && value.available === false
  );
}
function asRecord11(value) {
  return value && typeof value === "object" ? value : {};
}
function resolveExpoStateRoot7(args = {}) {
  if (args.stateDir) {
    const resolved = path10.resolve(args.stateDir);
    return path10.basename(resolved) === "runs" ? path10.dirname(resolved) : resolved;
  }
  const root = path10.resolve(args.root ?? args.cwd ?? process.env.PWD ?? ".");
  return path10.join(root, ".scratch", "expo98");
}
async function readLatestSession4(stateRoot, deps) {
  const sessionsRoot = path10.join(stateRoot, "sessions");
  const entries = await readDir(sessionsRoot, deps).catch(() => []);
  const sessions = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const record = await readJsonFile8(
      path10.join(sessionsRoot, entry.name, "session.json"),
      deps
    ).catch(() => null);
    if (record) sessions.push(asRecord11(record));
  }
  sessions.sort(
    (a, b) => String(b.updatedAt ?? b.createdAt).localeCompare(String(a.updatedAt ?? a.createdAt))
  );
  return sessions[0] ?? null;
}
async function readDir(directory, deps) {
  if (deps.readDir) return deps.readDir(directory, { withFileTypes: true });
  return fs6.readdir(directory, { withFileTypes: true });
}
async function readJsonFile8(file, deps) {
  if (deps.readJsonFile) return deps.readJsonFile(file);
  return JSON.parse(await fs6.readFile(file, "utf8"));
}

// src/commands/interaction-actions/src/main/shared.ts
function requireString12(value, field) {
  if (typeof value !== "string" || value.trim() === "")
    throw new Error(`${field} must be a non-empty string.`);
  return value.trim();
}
function clampNumber13(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`Expected a finite number, got ${value}.`);
  return Math.min(Math.max(number, min), max);
}
function truncate11(value, limit = MAX_OUTPUT9) {
  const text = String(value ?? "");
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}
[truncated ${text.length - limit} characters]`;
}
function createRefActionAdapter(refDeps, refActions) {
  return {
    planRefAction: (args) => refActions.planRefAction(args, refDeps),
    readRefRecord: async (ref, args) => readRefRecordFromCache(ref, args, refDeps),
    refPoint: async (ref, args) => refPointFromCache(ref, args, refDeps),
    scrollPlan: (args) => refActions.scrollPlan(args, refDeps)
  };
}
function policyDeniedPayload3({
  domain,
  action,
  policy
}) {
  return policyDeniedPayload({ domain, action, policy });
}
async function readRefRecordFromCache(refValue, args, deps) {
  const ref = requireString12(refValue, "ref");
  const cache = await deps.readLatestRefCache(args);
  if (!cache)
    return { available: false, reason: "No snapshot exists for the current session.", ref };
  const record = cache.refs.find((item) => item.ref === ref);
  if (!record) return { available: false, reason: "Ref not found in the latest snapshot.", ref };
  if (record.stale)
    return { available: false, reason: "Ref is stale. Capture a new snapshot before acting.", ref };
  return { available: true, record, cache };
}
async function refPointFromCache(refValue, args, deps) {
  const ref = requireString12(refValue, "ref");
  const found = await readRefRecordFromCache(ref, args, deps);
  if (found.available === false) return found;
  const record = asRecord12(found.record);
  const box = asRecord12(record.box);
  if (!box) return { available: false, reason: "Ref does not include bounds.", ref };
  const x = Number(box.x) + Number(box.width) / 2;
  const y = Number(box.y) + Number(box.height) / 2;
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return { available: false, reason: "Ref bounds are not finite.", ref, box };
  }
  return {
    available: true,
    ref,
    point: { x, y },
    box
  };
}
async function policyGate(args, action, domain, deps) {
  const policy = await deps.policyDecision(args, action, "device");
  return policy.allowed ? null : policyDeniedPayload3({ domain, action, policy });
}
async function resolveIosInteractionTool(deps) {
  const idb = await deps.commandPath("idb");
  if (idb) return { tool: "idb", path: idb };
  const axe = await deps.commandPath("axe");
  if (axe) return { tool: "axe", path: axe };
  return null;
}
function androidDeviceArgs3(device, args) {
  return device ? ["-s", device, ...args] : args;
}
function platformArg2(value) {
  return value === "android" ? "android" : "ios";
}
function optionalString5(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
function asRecord12(value) {
  return value && typeof value === "object" ? value : {};
}
function isFinitePoint(value) {
  return Number.isFinite(value.x) && Number.isFinite(value.y);
}
function asGesturePlan(value) {
  const record = asRecord12(value);
  return {
    tool: String(record.tool ?? ""),
    command: Array.isArray(record.command) ? record.command.map(String) : [],
    repeat: Number(record.repeat ?? 1),
    intervalMs: Number(record.intervalMs ?? 0),
    notes: Array.isArray(record.notes) ? record.notes.map(String) : []
  };
}
function unwrapToolPayload(value) {
  if (value && typeof value === "object" && Array.isArray(value.content)) {
    const text = value.content[0]?.text ?? "{}";
    return JSON.parse(text);
  }
  return asRecord12(value);
}
function formatSeconds(ms) {
  return (ms / 1e3).toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}
function reviewQuestions() {
  return [
    "Does a long press stay on the intended target instead of becoming scroll?",
    "Does a drag/swipe create, resize, or scroll according to the intended mode?",
    "Do screenshots before and after show unintended movement, selection, or chrome overlap?",
    "Do React commits/layout changes during the gesture match the expected interaction owner?"
  ];
}

// src/commands/interaction-actions/src/main/dependencies.ts
var defaultInteractionDependencies = {
  commandPath: defaultCommandPath2,
  execFile: defaultExecFile4,
  resolveIosDevice: defaultResolveIosDevice2,
  ...createRefActionAdapter(defaultRefActionDependencies, { planRefAction, refPoint, scrollPlan }),
  policyDecision: defaultPolicyDecision2,
  captureScreenshot: (args) => automationTakeScreenshot(args),
  traceInteraction: (args) => traceInteraction(args),
  wait: (ms) => new Promise((resolve18) => setTimeout(resolve18, ms)),
  now: () => /* @__PURE__ */ new Date(),
  tmpdir: osTmpdir,
  mkdir: (path16, options) => fs7.mkdir(path16, options),
  joinPath: joinPath3
};
async function defaultCommandPath2(command) {
  const result = await defaultExecFile4("which", [command], {
    timeout: 5e3,
    rejectOnError: false
  });
  return result.error ? null : optionalString5(result.stdout);
}
function defaultExecFile4(file, args, options = {}) {
  if (options.input !== void 0) {
    return defaultSpawnFile(file, args, options);
  }
  return new Promise((resolve18, reject) => {
    nodeExecFile6(
      file,
      args,
      { timeout: options.timeout, maxBuffer: options.maxBuffer ?? MAX_OUTPUT9 },
      (error, stdout, stderr) => {
        if (error && options.rejectOnError !== false) {
          Object.assign(error, { stdout, stderr });
          reject(error);
          return;
        }
        resolve18({
          stdout: String(stdout ?? ""),
          stderr: String(stderr ?? ""),
          error: error ? { message: error.message, code: error.code, signal: error.signal } : null
        });
      }
    );
  });
}
function defaultSpawnFile(file, args, options = {}) {
  return new Promise((resolve18, reject) => {
    const child = nodeSpawn(file, args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timeout = options.timeout ? setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      const error = {
        message: `${file} timed out after ${options.timeout}ms`,
        code: "ETIMEDOUT",
        signal: null
      };
      if (options.rejectOnError !== false) {
        reject(Object.assign(new Error(error.message), { stdout, stderr, code: error.code }));
      } else {
        resolve18({ stdout, stderr, error });
      }
    }, options.timeout) : null;
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      if (options.rejectOnError !== false) {
        reject(Object.assign(error, { stdout, stderr }));
      } else {
        resolve18({ stdout, stderr, error: { message: error.message, code: null, signal: null } });
      }
    });
    child.on("close", (code, signal) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      const error = code === 0 ? null : { message: `${file} exited with code ${code}`, code, signal };
      if (error && options.rejectOnError !== false) {
        reject(Object.assign(new Error(error.message), { stdout, stderr, code, signal }));
      } else {
        resolve18({ stdout, stderr, error });
      }
    });
    child.stdin.end(options.input);
  });
}
async function defaultResolveIosDevice2(requested) {
  if (requested && /^[0-9A-Fa-f-]{20,}$/.test(requested)) {
    return { udid: requested, name: requested, state: "unknown" };
  }
  const { stdout } = await defaultExecFile4(
    "xcrun",
    ["simctl", "list", "devices", "available", "--json"],
    {
      timeout: 2e4,
      maxBuffer: 4 * 1024 * 1024
    }
  );
  const parsed = JSON.parse(String(stdout ?? "{}"));
  const devices = Object.entries(parsed.devices ?? {}).flatMap(
    ([runtime2, runtimeDevices]) => (Array.isArray(runtimeDevices) ? runtimeDevices : []).map((device) => {
      const record = asRecord12(device);
      return {
        udid: String(record.udid ?? ""),
        name: String(record.name ?? ""),
        state: optionalString5(record.state) ?? void 0,
        runtime: runtime2,
        isAvailable: record.isAvailable === void 0 ? void 0 : Boolean(record.isAvailable)
      };
    })
  ).filter((device) => device.udid && device.name);
  if (requested) {
    const exact = devices.find((device) => device.udid === requested || device.name === requested);
    if (exact) return exact;
    const partial = devices.find(
      (device) => device.name.toLowerCase().includes(requested.toLowerCase())
    );
    if (partial) return partial;
    throw new Error(`No available iOS simulator matched: ${requested}`);
  }
  const booted = devices.find((device) => device.state === "Booted");
  if (booted) return booted;
  const iphone = [...devices].reverse().find((device) => /iPhone/.test(device.name));
  if (iphone) return iphone;
  if (devices[0]) return devices[0];
  throw new Error("No available iOS simulators found.");
}
async function defaultPolicyDecision2(args, action, sideEffect) {
  const policyPath = optionalString5(args.actionPolicy);
  if (!policyPath) {
    return {
      checked: true,
      action,
      sideEffect,
      allowed: false,
      source: null,
      reason: "No action policy allowed this state-changing operation."
    };
  }
  const policy = JSON.parse(await fs7.readFile(policyPath, "utf8"));
  const allowed = Array.isArray(policy.allow) && policy.allow.includes(action) || policy.actions?.[action] === true || policy.actions?.[action] === "allow";
  return {
    checked: true,
    action,
    sideEffect,
    allowed,
    source: policyPath,
    reason: allowed ? "Action allowed by policy." : "Action policy did not allow this operation."
  };
}

// src/commands/interaction-actions/src/main/gestures.ts
import { basename as basename7 } from "node:path";
async function automationGesture(args, deps = defaultInteractionDependencies) {
  return automationGestureInternal(args, deps, false);
}
async function automationGestureInternal(args, deps, policyChecked) {
  const platform = platformArg2(args.platform);
  const gesture = normalizeGesture(args.gesture);
  const policyDenied = policyChecked ? null : await policyGate(args, `gesture.${gesture}`, "gesture", deps);
  if (policyDenied) return policyDenied;
  const repeat = clampNumber13(args.repeat ?? 1, 1, 20);
  const intervalMs = clampNumber13(args.intervalMs ?? 250, 0, 1e4);
  const durationMs = clampNumber13(args.durationMs ?? defaultGestureDurationMs(gesture), 1, 3e4);
  const holdMs = args.holdMs === void 0 ? null : clampNumber13(args.holdMs, 0, 3e4);
  const metroPort = clampNumber13(args.metroPort ?? 8081, 1, 65535);
  const maxEvents = clampNumber13(args.maxEvents ?? 200, 1, 2e3);
  const componentFilter = optionalString5(args.componentFilter);
  const cwd = optionalString5(args.cwd) ?? ".";
  const coordinates = normalizeGestureCoordinates(gesture, args);
  const plan = gestureCommandPlan({
    platform,
    gesture,
    coordinates,
    durationMs,
    holdMs,
    repeat,
    intervalMs,
    device: args.device
  });
  const reviewQuestionsThisCanAnswer = reviewQuestions();
  if (args.dryRun === true) {
    return {
      available: true,
      dryRun: true,
      platform,
      gesture,
      coordinates,
      durationMs,
      holdMs,
      repeat,
      intervalMs,
      captureBeforeAfter: args.captureBeforeAfter === true,
      includeTrace: args.includeTrace === true,
      plan,
      reviewQuestionsThisCanAnswer
    };
  }
  const evidence = {
    traceStart: null,
    traceRead: null,
    traceStop: null,
    screenshots: {}
  };
  if (args.captureBeforeAfter === true) {
    asRecord12(evidence.screenshots).before = await captureGestureScreenshot(
      { platform, device: args.device, outputDir: args.outputDir, label: "before" },
      deps
    );
  }
  if (args.includeTrace === true) {
    evidence.traceStart = unwrapToolPayload(
      await deps.traceInteraction({
        cwd,
        metroPort,
        action: "start",
        componentFilter,
        maxEvents,
        includeEvents: false
      })
    );
  }
  const execution = await executeGesturePlanInternal(
    { platform, device: args.device, gesture, plan, repeat, intervalMs },
    deps,
    true
  );
  if (args.includeTrace === true) {
    evidence.traceRead = unwrapToolPayload(
      await deps.traceInteraction({
        cwd,
        metroPort,
        action: "read",
        componentFilter,
        maxEvents,
        includeEvents: false
      })
    );
    evidence.traceStop = unwrapToolPayload(
      await deps.traceInteraction({
        cwd,
        metroPort,
        action: "stop",
        componentFilter,
        maxEvents,
        includeEvents: false
      })
    );
  }
  if (args.captureBeforeAfter === true) {
    asRecord12(evidence.screenshots).after = await captureGestureScreenshot(
      { platform, device: args.device, outputDir: args.outputDir, label: "after" },
      deps
    );
  }
  return {
    available: execution.available,
    platform,
    gesture,
    coordinates,
    durationMs,
    holdMs,
    repeat,
    intervalMs,
    plan,
    execution,
    evidence,
    reviewQuestionsThisCanAnswer,
    interferenceReview: {
      requiredHumanCheck: "Compare before/after screenshots and trace summary against the intended gesture owner. This command gathers evidence; it does not know the app's product semantics.",
      possibleSignals: [
        "after screenshot shows unexpected scroll offset or selected state",
        "trace shows commits/layout changes outside the intended component filter",
        "gesture command reports unavailable tooling, meaning the interaction was not actually exercised"
      ]
    }
  };
}
function normalizeGesture(value) {
  const gesture = requireString12(value, "gesture");
  if (gesture === "tap-and-hold") return "long-press";
  if (!["tap", "long-press", "drag", "swipe"].includes(gesture))
    throw new Error(`Unknown gesture: ${gesture}`);
  return gesture;
}
function defaultGestureDurationMs(gesture) {
  if (gesture === "long-press") return 900;
  if (gesture === "drag") return 900;
  if (gesture === "swipe") return 250;
  return 80;
}
function normalizeGestureCoordinates(gesture, args) {
  if (gesture === "tap" || gesture === "long-press") {
    return {
      x: clampNumber13(args.x, 0, Number.MAX_SAFE_INTEGER),
      y: clampNumber13(args.y, 0, Number.MAX_SAFE_INTEGER)
    };
  }
  return {
    startX: clampNumber13(args.startX, 0, Number.MAX_SAFE_INTEGER),
    startY: clampNumber13(args.startY, 0, Number.MAX_SAFE_INTEGER),
    endX: clampNumber13(args.endX, 0, Number.MAX_SAFE_INTEGER),
    endY: clampNumber13(args.endY, 0, Number.MAX_SAFE_INTEGER)
  };
}
function gestureCommandPlan(args) {
  const platform = platformArg2(args.platform);
  const gesture = requireString12(args.gesture, "gesture");
  const coordinates = asRecord12(args.coordinates);
  const durationMs = Number(args.durationMs);
  const holdMs = args.holdMs === null ? null : Number(args.holdMs);
  const repeat = Number(args.repeat);
  const intervalMs = Number(args.intervalMs);
  const durationSeconds = formatSeconds(durationMs);
  const holdSeconds = holdMs === null ? null : formatSeconds(holdMs);
  if (platform === "android") {
    const deviceArgs = optionalString5(args.device) ? ["-s", String(args.device)] : [];
    const command2 = gesture === "tap" ? [
      "adb",
      ...deviceArgs,
      "shell",
      "input",
      "tap",
      String(coordinates.x),
      String(coordinates.y)
    ] : gesture === "long-press" ? [
      "adb",
      ...deviceArgs,
      "shell",
      "input",
      "swipe",
      String(coordinates.x),
      String(coordinates.y),
      String(coordinates.x),
      String(coordinates.y),
      String(durationMs)
    ] : [
      "adb",
      ...deviceArgs,
      "shell",
      "input",
      "swipe",
      String(coordinates.startX),
      String(coordinates.startY),
      String(coordinates.endX),
      String(coordinates.endY),
      String(durationMs)
    ];
    return {
      tool: "adb",
      command: command2,
      repeat,
      intervalMs,
      notes: holdMs ? ["Android adb input swipe has duration but no separate hold-before-move primitive."] : []
    };
  }
  const udidArgs = optionalString5(args.device) ? ["--udid", String(args.device)] : ["--udid", "<resolved-booted-simulator-udid>"];
  const command = gesture === "tap" ? ["idb", "ui", "tap", String(coordinates.x), String(coordinates.y), ...udidArgs] : gesture === "long-press" ? [
    "idb",
    "ui",
    "tap",
    String(coordinates.x),
    String(coordinates.y),
    "--duration",
    durationSeconds,
    ...udidArgs
  ] : [
    "idb",
    "ui",
    "swipe",
    String(coordinates.startX),
    String(coordinates.startY),
    String(coordinates.endX),
    String(coordinates.endY),
    "--duration",
    durationSeconds,
    ...udidArgs
  ];
  return {
    tool: "idb",
    command,
    repeat,
    intervalMs,
    notes: holdSeconds ? [
      "Current idb plan records holdMs as intent; idb swipe supports duration but not a separate hold-before-move flag in this wrapper."
    ] : []
  };
}
async function executeGesturePlanInternal(args, deps, policyChecked) {
  const platform = platformArg2(args.platform);
  const plan = asGesturePlan(args.plan);
  const gesture = optionalString5(args.gesture) ?? "unknown";
  const policyDenied = policyChecked ? null : await policyGate(args, `gesture.${gesture}`, "gesture", deps);
  if (policyDenied) return policyDenied;
  const repeat = clampNumber13(args.repeat ?? plan.repeat, 1, 20);
  const intervalMs = clampNumber13(args.intervalMs ?? plan.intervalMs, 0, 1e4);
  if (platform === "android") {
    const adb = await deps.commandPath("adb");
    if (!adb)
      return {
        available: false,
        reason: "Android gestures require adb, which is not installed or not on PATH.",
        plan
      };
    return executeRepeatedCommandInternal(
      plan.command[0] ?? "adb",
      plan.command.slice(1),
      { repeat, intervalMs },
      deps
    );
  }
  const tool = await resolveIosInteractionTool(deps);
  if (!tool) {
    return {
      available: false,
      reason: "iOS complex gestures require the idb or axe CLI, but neither is installed or on PATH.",
      installHint: "Install idb or axe and rerun this command, or use dryRun=true to inspect the intended gesture plan.",
      plan
    };
  }
  const resolvedDevice = args.device ? { udid: String(args.device) } : await deps.resolveIosDevice(void 0, { preferBooted: true });
  if (tool.tool === "axe") {
    const command2 = axeGestureCommandFromPlan({
      gesture: args.gesture,
      plan,
      udid: resolvedDevice.udid
    });
    return executeRepeatedCommandInternal(
      tool.path,
      command2.slice(1),
      { repeat, intervalMs, device: resolvedDevice, tool: tool.tool, plannedCommand: command2 },
      deps
    );
  }
  const command = plan.command.map(
    (part) => part === "<resolved-booted-simulator-udid>" ? resolvedDevice.udid : part
  );
  return executeRepeatedCommandInternal(
    tool.path,
    command.slice(1),
    { repeat, intervalMs, device: resolvedDevice, tool: tool.tool, plannedCommand: command },
    deps
  );
}
function axeGestureCommandFromPlan(args) {
  const gesture = requireString12(args.gesture, "gesture");
  const plan = asGesturePlan(args.plan);
  const udid = requireString12(args.udid, "udid");
  const command = plan.command;
  if (gesture === "tap")
    return ["axe", "tap", "-x", command[3] ?? "", "-y", command[4] ?? "", "--udid", udid];
  if (gesture === "long-press") {
    const durationIndex2 = command.indexOf("--duration");
    const delay = durationIndex2 === -1 ? "0.9" : command[durationIndex2 + 1] ?? "0.9";
    return [
      "axe",
      "touch",
      "-x",
      command[3] ?? "",
      "-y",
      command[4] ?? "",
      "--down",
      "--up",
      "--delay",
      delay,
      "--udid",
      udid
    ];
  }
  const durationIndex = command.indexOf("--duration");
  const duration = durationIndex === -1 ? null : command[durationIndex + 1];
  const axeCommand = [
    "axe",
    gesture === "drag" ? "drag" : "swipe",
    "--start-x",
    command[3] ?? "",
    "--start-y",
    command[4] ?? "",
    "--end-x",
    command[5] ?? "",
    "--end-y",
    command[6] ?? ""
  ];
  if (duration) axeCommand.push("--duration", duration);
  axeCommand.push("--udid", udid);
  return axeCommand;
}
async function executeRepeatedCommandInternal(command, args, options, deps) {
  const repeat = clampNumber13(options.repeat ?? 1, 1, 20);
  const intervalMs = clampNumber13(options.intervalMs ?? 0, 0, 1e4);
  const runs = [];
  for (let index = 0; index < repeat; index += 1) {
    const result = await deps.execFile(command, args, { timeout: 35e3, rejectOnError: false });
    runs.push({
      index: index + 1,
      command: [command, ...args],
      exitCode: result.error?.code ?? 0,
      stdout: truncate11(result.stdout),
      stderr: truncate11(result.stderr)
    });
    if (index < repeat - 1 && intervalMs > 0) await deps.wait(intervalMs);
  }
  return {
    available: true,
    device: options.device ?? null,
    tool: options.tool ?? basename7(command),
    command: options.plannedCommand ?? [basename7(command), ...args],
    runs
  };
}
async function captureGestureScreenshot(args, deps = defaultInteractionDependencies) {
  const root = optionalString5(args.outputDir) ?? deps.joinPath(deps.tmpdir(), "expo98-gestures");
  await deps.mkdir(root, { recursive: true });
  const outputPath = deps.joinPath(
    root,
    `${requireString12(args.label, "label")}-${deps.now().toISOString().replace(/[:.]/g, "-")}.png`
  );
  return unwrapToolPayload(
    await deps.captureScreenshot({ platform: args.platform, device: args.device, outputPath })
  );
}

// src/commands/interaction-actions/src/main/keyboard-clipboard.ts
async function clipboardCommand(args, deps = defaultInteractionDependencies) {
  const action = requireString12(args.action ?? "read", "action");
  if (!["read", "write", "paste"].includes(action))
    throw new Error(`Unknown clipboard action: ${action}`);
  if (action !== "read") {
    const policyDenied = await policyGate(args, `clipboard.${action}`, "clipboard", deps);
    if (policyDenied) return policyDenied;
  }
  const device = await deps.resolveIosDevice(optionalString5(args.device) ?? void 0, {
    preferBooted: true
  });
  if (args.dryRun === true) {
    return { available: true, dryRun: true, action: `clipboard.${action}`, device };
  }
  if (action === "read") {
    const result2 = await deps.execFile("xcrun", ["simctl", "pbpaste", device.udid], {
      timeout: 1e4,
      rejectOnError: false
    });
    return {
      available: !result2.error,
      action,
      device,
      text: result2.stdout,
      stderr: truncate11(result2.stderr),
      error: result2.error ?? null
    };
  }
  if (action === "write") {
    const text = requireString12(args.text, "text");
    const result2 = await deps.execFile("xcrun", ["simctl", "pbcopy", device.udid], {
      input: text,
      timeout: 1e4,
      rejectOnError: false
    });
    return {
      available: !result2.error,
      action,
      device,
      textLength: text.length,
      stdout: truncate11(result2.stdout),
      stderr: truncate11(result2.stderr),
      error: result2.error ?? null
    };
  }
  const axe = await deps.commandPath("axe");
  if (!axe)
    return {
      available: false,
      action,
      reason: "clipboard paste requires axe key-combo support.",
      device
    };
  const result = await deps.execFile(
    axe,
    ["key-combo", "--modifiers", "227", "--key", "25", "--udid", device.udid],
    {
      timeout: 1e4,
      rejectOnError: false
    }
  );
  return {
    available: !result.error,
    action,
    device,
    tool: "axe",
    stdout: truncate11(result.stdout),
    stderr: truncate11(result.stderr),
    error: result.error ?? null
  };
}
async function keyboardCommand(args, deps = defaultInteractionDependencies) {
  const action = requireString12(args.action ?? "type", "action");
  if (!["type", "press"].includes(action)) throw new Error(`Unknown keyboard action: ${action}`);
  const policyDenied = await policyGate(args, `keyboard.${action}`, "keyboard", deps);
  if (policyDenied) return policyDenied;
  const device = await deps.resolveIosDevice(optionalString5(args.device) ?? void 0, {
    preferBooted: true
  });
  const axe = await deps.commandPath("axe");
  if (!axe)
    return { available: false, action, reason: "keyboard commands require the axe CLI.", device };
  if (args.dryRun === true) {
    return { available: true, dryRun: true, action: `keyboard.${action}`, device, tool: "axe" };
  }
  if (action === "type") {
    const text = requireString12(args.text, "text");
    const result2 = await deps.execFile(axe, ["type", text, "--udid", device.udid], {
      timeout: 2e4,
      rejectOnError: false
    });
    return {
      available: !result2.error,
      action,
      device,
      tool: "axe",
      textLength: text.length,
      stdout: truncate11(result2.stdout),
      stderr: truncate11(result2.stderr),
      error: result2.error ?? null
    };
  }
  const key = requireString12(args.key, "key");
  const keycode = keyCodeFor(key);
  const result = await deps.execFile(axe, ["key", String(keycode), "--udid", device.udid], {
    timeout: 1e4,
    rejectOnError: false
  });
  return {
    available: !result.error,
    action,
    device,
    tool: "axe",
    key,
    keycode,
    stdout: truncate11(result.stdout),
    stderr: truncate11(result.stderr),
    error: result.error ?? null
  };
}
function keyCodeFor(key) {
  const normalized = String(key).toLowerCase();
  const known = {
    enter: 40,
    return: 40,
    tab: 43,
    space: 44,
    backspace: 42,
    delete: 42,
    escape: 41,
    esc: 41
  };
  if (known[normalized]) return known[normalized];
  if (/^\d+$/.test(normalized)) return clampNumber13(Number(normalized), 0, 255);
  if (/^[a-z]$/.test(normalized)) return normalized.charCodeAt(0) - 93;
  throw new Error(`Unknown key: ${key}`);
}

// src/commands/interaction-actions/src/main/tap-ref-actions.ts
async function automationTap(args, deps = defaultInteractionDependencies) {
  return automationTapInternal(args, deps, false);
}
async function automationTapInternal(args, deps, policyChecked) {
  const policyDenied = policyChecked ? null : await policyGate(args, "tap", "interaction", deps);
  if (policyDenied) return policyDenied;
  if (args.ref) {
    const planned = await deps.planRefAction({ ...args, action: "tap" });
    if (args.dryRun === true || planned.available === false) return planned;
    const point = asRecord12(asRecord12(planned.plan).point);
    if (!isFinitePoint(point)) {
      return { available: false, reason: "Ref does not include tappable bounds.", ref: args.ref };
    }
    return automationTapInternal({ ...args, ref: void 0, x: point.x, y: point.y }, deps, true);
  }
  const platform = platformArg2(args.platform);
  const x = String(clampNumber13(args.x, 0, Number.MAX_SAFE_INTEGER));
  const y = String(clampNumber13(args.y, 0, Number.MAX_SAFE_INTEGER));
  if (args.dryRun === true) {
    const iosTool = platform === "ios" ? await resolveIosInteractionTool(deps) : null;
    const iosCommand = iosTool?.tool === "axe" ? [
      "axe",
      "tap",
      "-x",
      x,
      "-y",
      y,
      "--udid",
      optionalString5(args.device) ?? "<booted-device>"
    ] : ["idb", "ui", "tap", x, y, "--udid", optionalString5(args.device) ?? "<booted-device>"];
    return {
      available: true,
      dryRun: true,
      platform,
      device: optionalString5(args.device),
      tool: platform === "android" ? "adb" : iosTool?.tool ?? "idb",
      point: { x: Number(x), y: Number(y) },
      command: platform === "android" ? [
        "adb",
        ...androidDeviceArgs3(optionalString5(args.device), ["shell", "input", "tap", x, y])
      ] : iosCommand
    };
  }
  if (platform === "android") {
    const result2 = await deps.execFile(
      "adb",
      androidDeviceArgs3(optionalString5(args.device), ["shell", "input", "tap", x, y]),
      {
        timeout: 2e4,
        rejectOnError: false
      }
    );
    return {
      platform,
      device: optionalString5(args.device),
      x: Number(x),
      y: Number(y),
      stdout: truncate11(result2.stdout),
      stderr: truncate11(result2.stderr)
    };
  }
  const tool = await resolveIosInteractionTool(deps);
  if (!tool) {
    throw new Error(
      "iOS coordinate taps require the idb or axe CLI, but neither is installed or on PATH. Install idb or axe for iOS coordinate automation."
    );
  }
  const device = await deps.resolveIosDevice(optionalString5(args.device) ?? void 0, {
    preferBooted: true
  });
  const command = tool.tool === "axe" ? ["tap", "-x", x, "-y", y, "--udid", device.udid] : ["ui", "tap", x, y, "--udid", device.udid];
  const result = await deps.execFile(tool.path, command, { timeout: 2e4, rejectOnError: false });
  return {
    platform,
    device,
    tool: tool.tool,
    x: Number(x),
    y: Number(y),
    stdout: truncate11(result.stdout),
    stderr: truncate11(result.stderr)
  };
}
async function refActionCommand(args, deps = defaultInteractionDependencies) {
  const command = requireString12(args.command, "command");
  if (command === "scroll-into-view") {
    const record = await deps.readRefRecord(args.ref, args);
    return record.available === false ? record : {
      available: true,
      action: command,
      ref: args.ref,
      reason: "Ref is present in the current snapshot.",
      record: record.record
    };
  }
  if (command === "blur") {
    const policyDenied = await policyGate(args, "ref.blur", "ref", deps);
    if (policyDenied) return policyDenied;
    return keyboardCommand({ ...args, action: "press", key: "Enter" }, deps);
  }
  if (["focus", "check", "uncheck", "select"].includes(command)) {
    const policyDenied = await policyGate(args, `ref.${command}`, "ref", deps);
    if (policyDenied) return policyDenied;
    const tapped = await automationTapInternal(
      { ...args, ref: args.ref, dryRun: args.dryRun },
      deps,
      true
    );
    return { ...tapped, action: command, ref: args.ref, value: args.text ?? null };
  }
  if (command === "fill") {
    const policyDenied = await policyGate(args, "ref.fill", "ref", deps);
    if (policyDenied) return policyDenied;
    const ref = requireString12(args.ref, "ref");
    const text = requireString12(args.text, "text");
    if (args.dryRun === true) {
      return {
        available: true,
        dryRun: true,
        action: command,
        ref,
        textLength: text.length,
        steps: ["tap ref", "type text"]
      };
    }
    const tapped = await automationTapInternal({ ...args, ref }, deps, true);
    if (tapped.available === false) return { ...tapped, action: command, ref };
    const typed = await keyboardCommand({ ...args, action: "type", text }, deps);
    return { available: typed.available !== false, action: command, ref, tap: tapped, type: typed };
  }
  if (command === "long-press" || command === "dbltap") {
    const policyDenied = await policyGate(args, `ref.${command}`, "ref", deps);
    if (policyDenied) return policyDenied;
    const point = await deps.refPoint(args.ref, args);
    if (point.available === false) return point;
    const coordinates = asRecord12(point.point);
    return automationGestureInternal(
      {
        ...args,
        gesture: command === "long-press" ? "long-press" : "tap",
        x: coordinates.x,
        y: coordinates.y,
        repeat: command === "dbltap" ? 2 : 1,
        intervalMs: command === "dbltap" ? 80 : args.intervalMs
      },
      deps,
      true
    );
  }
  if (command === "drag") {
    const policyDenied = await policyGate(args, "ref.drag", "ref", deps);
    if (policyDenied) return policyDenied;
    const start = await deps.refPoint(args.ref, args);
    const end = await deps.refPoint(args.targetRef, args);
    if (start.available === false) return start;
    if (end.available === false) return { ...end, role: "targetRef" };
    return automationGestureInternal(
      {
        ...args,
        gesture: "drag",
        startX: asRecord12(start.point).x,
        startY: asRecord12(start.point).y,
        endX: asRecord12(end.point).x,
        endY: asRecord12(end.point).y,
        durationMs: args.durationMs ?? 600
      },
      deps,
      true
    );
  }
  if (command === "scroll") {
    const policyDenied = await policyGate(args, "ref.scroll", "ref", deps);
    if (policyDenied) return policyDenied;
    const plan = await deps.scrollPlan(args);
    if (plan.available === false || args.dryRun === true) return plan;
    return automationGestureInternal(
      {
        ...args,
        gesture: "swipe",
        ...asRecord12(plan.coordinates),
        durationMs: args.durationMs ?? 250
      },
      deps,
      true
    );
  }
  throw new Error(`Unknown ref action command: ${command}`);
}

// src/commands/interaction-actions/src/main/environment.ts
function setEnvironmentPlan(domain, args, device) {
  const value = optionalString5(args.value);
  const extra = Array.isArray(args.extra) ? args.extra : [];
  if (domain === "appearance") {
    if (!["dark", "light"].includes(value ?? ""))
      throw new Error("appearance must be dark or light.");
    return {
      available: true,
      action: domain,
      device,
      command: ["xcrun", "simctl", "ui", device.udid, "appearance", value]
    };
  }
  if (domain === "content-size") {
    const mapped = value === "accessibility" ? "accessibility-large" : requireString12(value, "value");
    return {
      available: true,
      action: domain,
      device,
      command: ["xcrun", "simctl", "ui", device.udid, "content_size", mapped]
    };
  }
  if (domain === "location") {
    const lat = requireString12(value, "latitude");
    const lon = requireString12(extra[0], "longitude");
    return {
      available: true,
      action: domain,
      device,
      command: ["xcrun", "simctl", "location", device.udid, "set", `${lat},${lon}`]
    };
  }
  if (domain === "permissions") {
    const spec = requireString12(value, "permission");
    const [service, state = "granted"] = spec.split("=");
    const bundleId = optionalString5(args.bundleId) ?? optionalString5(extra[0]);
    if (!bundleId) throw new Error("set permissions requires --bundle-id or a bundle id argument.");
    const action = state === "granted" ? "grant" : state === "denied" ? "revoke" : "reset";
    return {
      available: true,
      action: domain,
      device,
      command: ["xcrun", "simctl", "privacy", device.udid, action, service, bundleId]
    };
  }
  if (domain === "locale" || domain === "timezone" || domain === "network" || domain === "orientation" || domain === "keyboard") {
    return {
      available: false,
      action: domain,
      reason: `${domain} mutation is not exposed by stable simctl/axe commands in this CLI yet.`,
      requestedValue: value,
      device
    };
  }
  throw new Error(`Unknown set domain: ${domain}`);
}
async function setEnvironmentCommand(args, deps = defaultInteractionDependencies) {
  const domain = requireString12(args.domain, "domain");
  const device = await deps.resolveIosDevice(optionalString5(args.device) ?? void 0, {
    preferBooted: true
  });
  const policy = await deps.policyDecision(args, `set.${domain}`, "device");
  if (!policy.allowed) return policyDeniedPayload3({ domain: "set", action: domain, policy });
  const planned = setEnvironmentPlan(domain, args, device);
  if (args.dryRun === true || planned.available === false) {
    return { ...planned, dryRun: args.dryRun === true, policy };
  }
  const command = planned.command;
  const result = await deps.execFile(command[0] ?? "", command.slice(1), {
    timeout: Number(planned.timeoutMs ?? 2e4),
    rejectOnError: false
  });
  return {
    available: !result.error,
    action: domain,
    device,
    command,
    stdout: truncate11(result.stdout),
    stderr: truncate11(result.stderr),
    error: result.error ?? null,
    policy
  };
}

// src/commands/live-backlog/src/main/index.ts
import { execFile as nodeExecFile7 } from "node:child_process";
import { mkdir as fsMkdir2, readdir as fsReaddir, writeFile as fsWriteFile2 } from "node:fs/promises";
import { join as join8, resolve as resolve7 } from "node:path";
var EXIT_SUCCESS2 = 0;
var EXIT_INVALID_USAGE2 = 2;
var COMMAND_ALIASES2 = commandAliases();
var LIVE_BACKLOG_MANIPULATING_COMMANDS = manipulatingCommandNames();
var ADAPTER_SELF_CHECK_FINDINGS = [
  {
    command: "snapshot",
    domain: "semantic",
    status: "wired",
    reason: "Semantic snapshot capture evaluates app instrumentation through the shared Hermes CDP transport and falls back to native accessibility only when bridge data is unavailable.",
    sourceFile: "src/commands/snapshot-evidence/src/main/snapshot-command.ts",
    recommendedFix: null
  },
  {
    command: "rn tree|rn fiber|rn renders",
    domain: "react-native",
    status: "wired",
    reason: "React Native introspection delegates to bridge-domain Runtime.evaluate using __EXPO98_RN_BRIDGE__ and instrumentation fallbacks.",
    sourceFile: "src/commands/rn-introspection/src/main/index.ts",
    recommendedFix: null
  },
  {
    command: "console|errors",
    domain: "diagnostics",
    status: "wired",
    reason: "Runtime diagnostics use the shared Hermes CDP evaluator by default.",
    sourceFile: "src/commands/devtools-diagnostics/src/main/index.ts",
    recommendedFix: null
  },
  {
    command: "navigation|network|dialog|sheet|storage|state|controls|perf|trace|inspector|metro reload",
    domain: "runtime",
    status: "wired",
    reason: "Runtime.evaluate-backed commands share the Hermes CDP transport with loopback URL normalization and Metro Origin headers.",
    sourceFile: "src/platform/hermes-cdp-client/src/main/index.ts",
    recommendedFix: null
  },
  {
    command: "network waterfall",
    domain: "validation",
    status: "runtime-dependent",
    reason: "Waterfall output is wired, but phase-level timing is only validated when the app bridge emits startedAt/endedAt and metadata-only request rows.",
    sourceFile: "src/commands/network-evidence/src/main/index.ts",
    recommendedFix: "Mount the upgraded dev-only network bridge before making network waterfall claims."
  },
  {
    command: "perf action|perf interaction|perf report",
    domain: "performance-validation",
    status: "runtime-dependent",
    reason: "Performance outputs now include realValidation and mark placeholder action/frame metrics partial until interaction, render, frame, or native sample evidence is present.",
    sourceFile: "src/commands/perf-evidence/src/main/index.ts",
    recommendedFix: "Use perf interaction start/stop and perf report for bottleneck claims."
  },
  {
    command: "rn renders|trace read",
    domain: "render-validation",
    status: "runtime-dependent",
    reason: "Render cost claims require React Profiler commit durations; empty commit arrays are reported as partial evidence.",
    sourceFile: "src/commands/rn-introspection/src/main/index.ts",
    recommendedFix: "Mount the dev-only Profiler wrapper and rerun rn renders start/read/stop."
  }
];
async function liveBacklogCommand(args = {}, deps = defaultLiveBacklogDependencies) {
  const action = requireString13(args.action ?? firstPositional2(args) ?? "matrix", "action");
  if (!["matrix", "self-check", "run"].includes(action))
    throw new Error(`Unknown live-backlog action: ${action}`);
  const cwd = resolve7(args.cwd ?? process.cwd());
  const scope = args.scope ?? "smoke";
  const matrix = buildLiveBacklogMatrix({ ...args, cwd, scope });
  const selfCheck = liveBacklogSelfCheck(matrix);
  if (action === "self-check") {
    return toolJson({
      available: selfCheck.ok,
      action,
      cwd,
      scope,
      selfCheck,
      source: matrix.source,
      rowCount: matrix.rows.length
    });
  }
  if (action === "matrix") {
    return toolJson({
      available: true,
      action,
      cwd,
      scope,
      source: matrix.source,
      selfCheck,
      rowCount: matrix.rows.length,
      rows: matrix.rows
    });
  }
  if (!selfCheck.ok) {
    return toolJson({
      available: false,
      action,
      cwd,
      scope,
      source: matrix.source,
      selfCheck,
      reason: "Live backlog self-check failed before executing rows."
    });
  }
  const outputDir = resolve7(
    args.outputDir ?? join8(cwd, ".scratch", "expo98", "live-backlog", isoStamp(deps))
  );
  await (deps.mkdir ?? fsMkdir2)(outputDir, { recursive: true });
  const rows = [];
  for (const row of matrix.rows) {
    rows.push(await runLiveBacklogRow(row, { ...args, cwd, outputDir }, deps));
  }
  const summary = summarizeLiveBacklogRows(rows);
  const report = {
    schemaVersion: 1,
    action,
    cwd,
    scope,
    outputDir,
    generatedAt: (deps.now?.() ?? /* @__PURE__ */ new Date()).toISOString(),
    source: matrix.source,
    selfCheck,
    summary,
    rows,
    hiddenPreflights: [],
    limitations: [
      "The runner executes only commands represented as rows; it does not start Metro, launch apps, or reconnect dev clients outside row execution.",
      "Runtime rows can be classified environment-blocked when Metro/Hermes target evidence is absent; those rows are not live passes."
    ]
  };
  const reportPath = join8(outputDir, "live-backlog-report.json");
  await writeJsonFile5(reportPath, report, deps);
  return toolJson({ ...report, reportPath });
}
var defaultLiveBacklogDependencies = {
  execFile: execFile5
};
function buildLiveBacklogMatrix(args = {}) {
  const dispatcherCommands = Object.keys(COMMAND_ALIASES2).sort();
  const helpCommands = parseHelpCommandNames(cliHelpText()).sort();
  const allRows = orderLiveBacklogRows(
    dispatcherCommands.map((command) => liveBacklogRowForCommand(command, args))
  );
  const smokeCommands = /* @__PURE__ */ new Set([
    "doctor",
    "project-info",
    "routes",
    "devices",
    "metro",
    "devtools",
    "console",
    "errors",
    "expo",
    "bridge",
    "policy",
    "skills",
    "install",
    "upgrade",
    "live-backlog"
  ]);
  const rows = args.scope === "smoke" || !args.scope ? allRows.filter((row) => smokeCommands.has(row.command)) : allRows;
  const representedCommands = new Set(allRows.map((row) => row.command));
  return {
    schemaVersion: 1,
    scope: args.scope ?? "smoke",
    source: {
      dispatcher: "commandAliases",
      dispatcherCommandCount: dispatcherCommands.length,
      dispatcherCommands,
      help: "cliHelpText",
      helpCommandCount: helpCommands.length,
      helpCommands,
      fullRowCount: allRows.length,
      rowSubsetCount: rows.length,
      rowSubset: rows.map((row) => row.command),
      unrepresentedDispatcherCommands: dispatcherCommands.filter(
        (command) => !representedCommands.has(command)
      ),
      unrepresentedHelpCommands: helpCommands.filter(
        (command) => COMMAND_ALIASES2[command] && !representedCommands.has(command)
      )
    },
    rows
  };
}
function orderLiveBacklogRows(rows) {
  const terminalRuntimeActions = /* @__PURE__ */ new Set(["terminate-app"]);
  return [
    ...rows.filter((row) => !terminalRuntimeActions.has(row.command)),
    ...rows.filter((row) => terminalRuntimeActions.has(row.command))
  ];
}
function liveBacklogRowForCommand(command, args = {}) {
  const template = liveBacklogTemplate(command, args);
  const requirements = template.requirements ?? inferLiveBacklogRequirements(command);
  return {
    id: template.id ?? command.replace(/[^a-z0-9]+/g, "-"),
    command,
    exactCommand: ["expo98", "--json", ...template.argv],
    argv: template.argv,
    scope: template.scope ?? "full",
    expectedClass: template.expectedClass ?? (requirements.length ? "live-pass" : "static-pass"),
    requirements,
    mutatesRuntime: LIVE_BACKLOG_MANIPULATING_COMMANDS.includes(command),
    captures: ["stdout", "stderr", "exit-code", "run-record"],
    artifacts: [],
    source: {
      dispatcher: true,
      helpListed: parseHelpCommandNames(cliHelpText()).includes(command)
    },
    rationale: template.rationale ?? "Source-derived CLI command row."
  };
}
function liveBacklogTemplate(command, _args = {}) {
  const cwdArg = ["--cwd", "__CWD__"];
  const metroArg = ["--metro-port", "__METRO_PORT__"];
  const bundleArg = ["--bundle-id", "__BUNDLE_ID__"];
  const deviceArg = ["--device", "__DEVICE__"];
  const policyArg = ["--action-policy", "__ACTION_POLICY__"];
  switch (command) {
    case "doctor":
      return { argv: ["doctor"] };
    case "project-info":
      return { argv: ["project-info", ...cwdArg] };
    case "routes":
      return { argv: ["routes", ...cwdArg] };
    case "devices":
      return { argv: ["devices"] };
    case "session":
      return { argv: ["session", "new", "live-backlog"], expectedClass: "static-pass" };
    case "target":
      return { argv: ["target", "list", ...metroArg], requirements: ["metro"] };
    case "snapshot":
      return {
        argv: ["snapshot", "--interactive", "true", "--source", "true", "--bounds", "true"]
      };
    case "refs":
      return { argv: ["refs"] };
    case "get":
      return { argv: ["get", "source", "@e1"], expectedClass: "expected-usage-error" };
    case "find":
      return { argv: ["find", "text", "Customers"], expectedClass: "expected-usage-error" };
    case "wait":
      return {
        argv: ["wait", "--text", "Customers", "--timeout-ms", "100"],
        expectedClass: "expected-usage-error"
      };
    case "batch":
      return { argv: ["batch", '["doctor"]', "--bail", "true"] };
    case "boot-simulator":
      return { argv: ["boot-simulator", ...deviceArg], requirements: ["simulator"], scope: "full" };
    case "open-url":
      return {
        argv: ["open-url", "exp://127.0.0.1:8081", ...deviceArg],
        requirements: ["simulator"],
        scope: "full"
      };
    case "launch-app":
      return {
        argv: ["launch-app", ...deviceArg, ...bundleArg, "--crash-check-ms", "1000"],
        requirements: ["simulator", "installed-app", "crash-monitor"],
        scope: "full"
      };
    case "terminate-app":
      return {
        argv: ["terminate-app", ...deviceArg, ...bundleArg],
        requirements: ["simulator", "installed-app"],
        scope: "full"
      };
    case "reload-app":
      return {
        argv: ["reload-app", ...deviceArg, ...bundleArg],
        requirements: ["simulator", "installed-app"],
        scope: "full"
      };
    case "open-dev-menu":
      return {
        argv: [
          "open-dev-menu",
          ...metroArg,
          ...deviceArg,
          ...bundleArg,
          "--dev-client-url",
          "__DEV_CLIENT_URL__",
          "--crash-check-ms",
          "1000"
        ],
        requirements: ["metro-message", "simulator", "crash-monitor"],
        scope: "full"
      };
    case "install-app":
      return {
        argv: ["install-app", "__APP_PATH__", ...deviceArg, ...policyArg, "--dry-run", "true"],
        expectedClass: "expected-usage-error",
        scope: "full"
      };
    case "uninstall-app":
      return {
        argv: ["uninstall-app", ...bundleArg, ...deviceArg, ...policyArg, "--dry-run", "true"],
        requirements: ["simulator", "action-policy"],
        scope: "full"
      };
    case "long-press":
      return {
        argv: ["long-press", "@e1", "--dry-run", "true"],
        expectedClass: "expected-usage-error"
      };
    case "dbltap":
      return {
        argv: ["dbltap", "@e1", "--dry-run", "true"],
        expectedClass: "expected-usage-error"
      };
    case "fill":
      return {
        argv: ["fill", "@e1", "hello", "--dry-run", "true"],
        expectedClass: "expected-usage-error"
      };
    case "type":
      return {
        argv: ["type", "hello", "--dry-run", "true"],
        requirements: ["simulator"],
        scope: "full"
      };
    case "press":
      return {
        argv: ["press", "Return", "--dry-run", "true"],
        requirements: ["simulator"],
        scope: "full"
      };
    case "focus":
      return { argv: ["focus", "@e1", "--dry-run", "true"], expectedClass: "expected-usage-error" };
    case "blur":
      return { argv: ["blur", "@e1", "--dry-run", "true"], expectedClass: "expected-usage-error" };
    case "select":
      return {
        argv: ["select", "@e1", "value", "--dry-run", "true"],
        expectedClass: "expected-usage-error"
      };
    case "check":
      return { argv: ["check", "@e1", "--dry-run", "true"], expectedClass: "expected-usage-error" };
    case "uncheck":
      return {
        argv: ["uncheck", "@e1", "--dry-run", "true"],
        expectedClass: "expected-usage-error"
      };
    case "drag":
      return {
        argv: ["drag", "@e1", "--to-x", "10", "--to-y", "10", "--dry-run", "true"],
        expectedClass: "expected-usage-error"
      };
    case "scroll":
      return {
        argv: ["scroll", "@e1", "--dy", "200", "--dry-run", "true"],
        expectedClass: "expected-usage-error"
      };
    case "scroll-into-view":
      return {
        argv: ["scroll-into-view", "@e1", "--dry-run", "true"],
        expectedClass: "expected-usage-error"
      };
    case "clipboard":
      return { argv: ["clipboard", "read"], requirements: ["simulator"], scope: "full" };
    case "keyboard":
      return {
        argv: ["keyboard", "press", "Return", "--dry-run", "true"],
        requirements: ["simulator"],
        scope: "full"
      };
    case "set":
      return {
        argv: ["set", "appearance", "dark", ...policyArg],
        requirements: ["simulator", "action-policy"],
        scope: "full"
      };
    case "logs":
      return {
        argv: ["logs", "--bundle-id", "__BUNDLE_ID__", "--limit", "20"],
        requirements: ["simulator-or-device-logs"]
      };
    case "screenshot":
      return {
        argv: ["screenshot", "--output-path", "__ROW_DIR__/screenshot.png"],
        requirements: ["simulator-screenshot"],
        scope: "full"
      };
    case "tap":
      return {
        argv: ["tap", "--x", "1", "--y", "1", "--dry-run", "true"],
        requirements: ["simulator"],
        scope: "full"
      };
    case "gesture":
      return {
        argv: ["gesture", "tap", "--x", "1", "--y", "1", "--dry-run", "true"],
        requirements: ["simulator"],
        scope: "full"
      };
    case "open-route":
      return {
        argv: ["open-route", "/", ...cwdArg, ...policyArg],
        requirements: ["project-scheme", "simulator", "action-policy"],
        scope: "full"
      };
    case "ux-context":
      return { argv: ["ux-context", ...cwdArg, ...metroArg], requirements: ["simulator", "metro"] };
    case "annotate-screen":
      return {
        argv: ["annotate-screen", "prepare", ...cwdArg, "--output-dir", "__ROW_DIR__/annotations"]
      };
    case "inspector":
      return { argv: ["inspector", "probe", ...metroArg], requirements: ["hermes-target"] };
    case "review-overlay":
      return { argv: ["review-overlay", "read", "--output-dir", "__ROW_DIR__", ...cwdArg] };
    case "review-overlay-server":
      return {
        argv: ["review-overlay-server", "--output-dir", "__ROW_DIR__", "--port", "0", ...cwdArg]
      };
    case "review-next":
      return {
        argv: [
          "review-next",
          "--surface",
          "live-backlog",
          "--stage",
          "intake",
          "--issue",
          "live verification"
        ]
      };
    case "annotation-server":
      return { argv: ["annotation-server", "--dir", "__ROW_DIR__/annotations"] };
    case "devtools":
      return { argv: ["devtools", "capabilities", ...metroArg], requirements: ["metro"] };
    case "console":
      return { argv: ["console", "--limit", "20", ...metroArg], requirements: ["hermes-target"] };
    case "errors":
      return { argv: ["errors", "--limit", "20", ...metroArg], requirements: ["hermes-target"] };
    case "metro":
      return { argv: ["metro", "status", ...metroArg], requirements: ["metro"] };
    case "profiler":
      return { argv: ["profiler", "start"], requirements: ["native-profiler"], scope: "full" };
    case "navigation":
      return {
        argv: ["navigation", "state", ...metroArg],
        requirements: ["hermes-target", "app-bridge"]
      };
    case "network":
      return {
        argv: ["network", "requests", ...metroArg],
        requirements: ["hermes-target", "app-bridge"]
      };
    case "storage":
      return {
        argv: ["storage", "async", "list", ...metroArg],
        requirements: ["hermes-target", "app-bridge"]
      };
    case "state":
      return {
        argv: ["state", "list", ...metroArg],
        requirements: ["hermes-target", "app-bridge"]
      };
    case "controls":
      return {
        argv: ["controls", "list", ...metroArg],
        requirements: ["hermes-target", "app-bridge"]
      };
    case "bridge":
      return { argv: ["bridge", "status", ...cwdArg] };
    case "accessibility":
      return {
        argv: ["accessibility", "tree"],
        requirements: ["accessibility-tooling"],
        scope: "full"
      };
    case "dialog":
      return {
        argv: ["dialog", "status", ...metroArg],
        requirements: ["hermes-target", "app-bridge"]
      };
    case "sheet":
      return {
        argv: ["sheet", "status", ...metroArg],
        requirements: ["hermes-target", "app-bridge"]
      };
    case "record":
      return {
        argv: ["record", "start", "--output-path", "__ROW_DIR__/recording.mov"],
        requirements: ["simulator"],
        scope: "full"
      };
    case "diff":
      return {
        argv: ["diff", "snapshot", "--baseline", "__ROW_DIR__/missing-baseline.json"],
        expectedClass: "expected-usage-error"
      };
    case "inspect":
      return { argv: ["inspect", "@e1"], expectedClass: "expected-usage-error" };
    case "highlight":
      return {
        argv: ["highlight", "@e1", "--output-path", "__ROW_DIR__/highlight.json"],
        expectedClass: "expected-usage-error"
      };
    case "expo":
      return { argv: ["expo", "upstream-policy", ...cwdArg] };
    case "rn":
      return { argv: ["rn", "tree", ...metroArg], requirements: ["hermes-target", "app-bridge"] };
    case "perf":
      return { argv: ["perf", "summary", ...metroArg], requirements: ["metro"] };
    case "dashboard":
      return { argv: ["dashboard", "status"] };
    case "review":
      return { argv: ["review", "matrix"] };
    case "policy":
      return { argv: ["policy", "show"] };
    case "redact":
      return {
        argv: [
          "redact",
          "__ROW_DIR__/redact-input.json",
          "--output-path",
          "__ROW_DIR__/redacted.json"
        ],
        setupFiles: [{ path: "redact-input.json", content: '{"token":"secret"}\n' }]
      };
    case "skills":
      return { argv: ["skills", "list"] };
    case "install":
      return { argv: ["install", "check"] };
    case "upgrade":
      return { argv: ["upgrade", "check"] };
    case "release":
      return { argv: ["release", "check"], scope: "full" };
    case "live-backlog":
      return { argv: ["live-backlog", "self-check"] };
    case "trace":
      return { argv: ["trace", "--action", "read", ...metroArg], requirements: ["hermes-target"] };
    default:
      return { argv: [command], expectedClass: "expected-usage-error" };
  }
}
function inferLiveBacklogRequirements(command) {
  if ([
    "console",
    "errors",
    "inspector",
    "trace",
    "navigation",
    "network",
    "storage",
    "state",
    "controls",
    "dialog",
    "sheet",
    "rn"
  ].includes(command))
    return ["hermes-target"];
  if (["metro", "devtools", "target"].includes(command)) return ["metro"];
  if (LIVE_BACKLOG_MANIPULATING_COMMANDS.includes(command)) return ["simulator"];
  return [];
}
function parseHelpCommandNames(text) {
  const commands = /* @__PURE__ */ new Set();
  let inCommands = false;
  for (const line of String(text).split(/\r?\n/)) {
    if (/^(Discovery|Simulator and app actions|Evidence and runtime):$/.test(line.trim())) {
      inCommands = true;
      continue;
    }
    if (/^Examples:/.test(line.trim())) break;
    if (!inCommands) continue;
    const match = /^\s{2}([a-z][a-z0-9-]+)\b/.exec(line);
    if (match) commands.add(match[1]);
  }
  return [...commands];
}
function liveBacklogSelfCheck(matrix) {
  const issues = [];
  const adapterFindings = ADAPTER_SELF_CHECK_FINDINGS.map((finding) => ({ ...finding }));
  for (const command of matrix.source.unrepresentedDispatcherCommands)
    issues.push({ type: "missing-dispatcher-row", command });
  for (const command of matrix.source.unrepresentedHelpCommands)
    issues.push({ type: "missing-help-row", command });
  for (const finding of adapterFindings) {
    if (finding.status === "missing" || finding.status === "stub") {
      issues.push({
        type: "missing-adapter",
        command: finding.command,
        domain: finding.domain,
        sourceFile: finding.sourceFile
      });
    }
  }
  for (const command of LIVE_BACKLOG_MANIPULATING_COMMANDS) {
    if (COMMAND_ALIASES2[command] && !matrix.source.dispatcherCommands.includes(command))
      issues.push({ type: "missing-live-action-dispatcher", command });
  }
  for (const row of matrix.rows) {
    if (!Array.isArray(row.argv) || row.argv.length === 0)
      issues.push({ type: "missing-command-argv", rowId: row.id });
    for (const capture of ["stdout", "stderr", "exit-code"]) {
      if (!row.captures.includes(capture))
        issues.push({ type: "missing-capture", rowId: row.id, capture });
    }
  }
  return {
    ok: issues.length === 0,
    issueCount: issues.length,
    issues,
    adapterFindings,
    adapterFindingCount: adapterFindings.length,
    missingAdapterCount: adapterFindings.filter(
      (finding) => finding.status === "missing" || finding.status === "stub"
    ).length,
    hiddenPreflightPolicy: {
      allowed: false,
      statement: "Simulator, app lifecycle, Metro, Hermes, dev-client, gesture, screenshot, accessibility, log, and crash-report actions must be represented as live-backlog rows."
    }
  };
}
async function runLiveBacklogRow(row, args, deps = defaultLiveBacklogDependencies) {
  const rowDir = join8(args.outputDir, row.id);
  await (deps.mkdir ?? fsMkdir2)(rowDir, { recursive: true });
  for (const file of liveBacklogTemplate(row.command, args).setupFiles ?? []) {
    await (deps.writeFile ?? fsWriteFile2)(join8(rowDir, file.path), file.content, "utf8");
  }
  if (row.argv.includes("__ACTION_POLICY__")) {
    await writeJsonFile5(
      join8(rowDir, "action-policy.json"),
      {
        allow: [
          "set.appearance",
          "install-app",
          "uninstall-app",
          "storage.set",
          "storage.clear",
          "state.load",
          "state.clear",
          "controls.press",
          "navigation.back",
          "navigation.tab"
        ]
      },
      deps
    );
  }
  if (row.argv.includes("__APP_PATH__")) {
    await (deps.mkdir ?? fsMkdir2)(join8(rowDir, "missing.app"), { recursive: true });
  }
  const stateDir = join8(rowDir, "runs");
  const argv = [
    "--json",
    "--state-dir",
    stateDir,
    ...materializeLiveBacklogArgv(row.argv, args, rowDir)
  ];
  const executable2 = deps.processExecPath ?? process.execPath;
  const cli = deps.cliWrapperPath ?? join8(resolve7("."), "cli", "expo98.mjs");
  const exactCommand = [executable2, cli, ...argv];
  const startedAt = (deps.now?.() ?? /* @__PURE__ */ new Date()).toISOString();
  if (!deps.execFile) throw new Error("No subprocess adapter is configured.");
  const result = await deps.execFile(executable2, [cli, ...argv], {
    cwd: args.cwd,
    timeout: 6e4,
    maxBuffer: 8 * 1024 * 1024,
    rejectOnError: false
  });
  const exitCode = result.error?.code ?? 0;
  const stdoutPath = join8(rowDir, "stdout.json");
  const stderrPath = join8(rowDir, "stderr.log");
  const exitCodePath = join8(rowDir, "exit-code.txt");
  await (deps.writeFile ?? fsWriteFile2)(stdoutPath, result.stdout, "utf8");
  await (deps.writeFile ?? fsWriteFile2)(stderrPath, result.stderr, "utf8");
  await (deps.writeFile ?? fsWriteFile2)(exitCodePath, `${exitCode}
`, "utf8");
  const parsed = parseBacklogJson(result.stdout);
  const classification = classifyLiveBacklogRow(row, exitCode, parsed);
  const runRecords = await listJsonFiles(stateDir, deps);
  return {
    id: row.id,
    command: row.command,
    exactCommand,
    startedAt,
    finishedAt: (deps.now?.() ?? /* @__PURE__ */ new Date()).toISOString(),
    exitCode,
    classification,
    requirements: row.requirements,
    mutatesRuntime: row.mutatesRuntime,
    stdoutPath,
    stderrPath,
    exitCodePath,
    runRecordPaths: runRecords,
    artifactPaths: [stdoutPath, stderrPath, exitCodePath, ...runRecords],
    parsedSummary: summarizeBacklogPayload(parsed)
  };
}
function materializeLiveBacklogArgv(argv, args, rowDir) {
  const replacements = {
    __CWD__: args.cwd,
    __METRO_PORT__: String(args.metroPort ?? 8081),
    __BUNDLE_ID__: args.bundleId ?? "com.maddie.console",
    __DEVICE__: args.device ?? "booted",
    __DEV_CLIENT_URL__: args.devClientUrl ?? "exp+maddie://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A8081",
    __ACTION_POLICY__: args.actionPolicy ?? join8(rowDir, "action-policy.json"),
    __OUTPUT_DIR__: args.outputDir,
    __ROW_DIR__: rowDir,
    __APP_PATH__: join8(rowDir, "missing.app")
  };
  return argv.map((part) => {
    let materialized = part;
    for (const [token, value] of Object.entries(replacements)) {
      materialized = materialized.split(token).join(value);
    }
    return materialized;
  });
}
function parseBacklogJson(stdout) {
  try {
    const parsed = JSON.parse(stdout);
    return asRecord13(parsed);
  } catch {
    return null;
  }
}
function classifyLiveBacklogRow(row, exitCode, parsed) {
  if (exitCode === EXIT_INVALID_USAGE2) return "expected-usage-error";
  if (exitCode !== EXIT_SUCCESS2) {
    if (row.requirements.length > 0) return "environment-blocked";
    if (row.expectedClass === "expected-usage-error") return "expected-usage-error";
    return "defect";
  }
  const data = asRecord13(parsed?.data) ?? parsed;
  const requiresRuntime = row.requirements.some(
    (requirement) => ["metro", "metro-message", "hermes-target", "app-bridge"].includes(requirement)
  );
  if (requiresRuntime && !hasLiveRuntimeEvidence(data, row.requirements))
    return "environment-blocked";
  if (data?.available === false) {
    if (row.expectedClass === "expected-usage-error") return "expected-usage-error";
    if (requiresRuntime || row.requirements.length > 0) return "environment-blocked";
    return "designed-unavailable";
  }
  if (row.expectedClass === "expected-usage-error") return "expected-usage-error";
  return row.requirements.length > 0 || row.mutatesRuntime ? "live-pass" : "static-pass";
}
function hasLiveRuntimeEvidence(data, requirements) {
  const record = asRecord13(data);
  if (!record) return false;
  if (requirements.includes("hermes-target")) {
    const target = asRecord13(record.target);
    const cdp = asRecord13(record.cdp);
    const metro = asRecord13(record.metro);
    const metroTargets2 = Array.isArray(metro?.targets) ? metro.targets : [];
    return Boolean(
      target?.webSocketDebuggerUrl || Array.isArray(cdp?.calls) && cdp.calls.length > 0 || metroTargets2.some((targetEntry) => Boolean(asRecord13(targetEntry)?.webSocketDebuggerUrl))
    );
  }
  if (requirements.includes("metro")) {
    const metro = asRecord13(record.metro);
    const context = asRecord13(record.context);
    const contextMetro = asRecord13(context?.metro);
    return record.status === "available" || metro?.status === "available" || metro?.status === "packager-status:running" || contextMetro?.status === "available" || contextMetro?.status === "packager-status:running" || Number(metro?.targetCount ?? contextMetro?.targetCount ?? 0) > 0 || Array.isArray(record.targets) && record.targets.length > 0 || Array.isArray(metro?.targets) && metro.targets.length > 0;
  }
  if (requirements.includes("metro-message")) {
    const messageSocket = asRecord13(record.messageSocket);
    return messageSocket?.available === true || record.transport === "metro-message-socket";
  }
  if (requirements.includes("app-bridge")) {
    return record.source === "app-instrumentation" || Array.isArray(record.sources) && record.sources.includes("app-instrumentation");
  }
  return true;
}
function summarizeBacklogPayload(parsed) {
  const data = asRecord13(parsed?.data) ?? parsed;
  if (!data || typeof data !== "object") return null;
  return {
    ok: parsed?.ok,
    available: typeof data.available === "boolean" ? data.available : void 0,
    action: data.action,
    reason: data.reason,
    keys: Object.keys(data).slice(0, 20)
  };
}
async function listJsonFiles(dir, deps = {}) {
  const entries = await Promise.resolve((deps.readdir ?? fsReaddir)(dir)).catch(() => []);
  return entries.filter((entry) => entry.endsWith(".json")).sort().map((entry) => join8(dir, entry));
}
function summarizeLiveBacklogRows(rows) {
  const classifications = {};
  for (const row of rows) {
    classifications[row.classification] = (classifications[row.classification] ?? 0) + 1;
  }
  return {
    rowCount: rows.length,
    classifications,
    defectCount: classifications.defect ?? 0,
    environmentBlockedCount: classifications["environment-blocked"] ?? 0,
    unexplainedPartialCount: classifications["unexplained-partial"] ?? 0
  };
}
function cliHelpText() {
  const commands = Object.keys(COMMAND_ALIASES2).sort();
  return `Discovery:
${commands.map((command) => `  ${command}`).join("\n")}
Examples:
  expo98 doctor
`;
}
function requireString13(value, name) {
  if (typeof value !== "string" || value.trim().length === 0)
    throw new Error(`${name} must be a non-empty string.`);
  return value.trim();
}
async function writeJsonFile5(file, value, deps = {}) {
  await (deps.writeFile ?? fsWriteFile2)(file, `${JSON.stringify(value, null, 2)}
`, "utf8");
}
function isoStamp(deps = {}) {
  return (deps.now?.() ?? /* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-");
}
function firstPositional2(args) {
  return Array.isArray(args._) ? args._[0] : void 0;
}
function asRecord13(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}
function execFile5(file, argv, options) {
  return new Promise((resolve18) => {
    nodeExecFile7(
      file,
      argv,
      {
        cwd: options.cwd,
        timeout: options.timeout,
        maxBuffer: options.maxBuffer
      },
      (error, stdout, stderr) => {
        resolve18({
          stdout: String(stdout ?? ""),
          stderr: String(stderr ?? ""),
          error: error && typeof error === "object" && "code" in error ? { code: Number(error.code) } : error ? { code: 1 } : null
        });
      }
    );
  });
}

// src/commands/modal-blocker-actions/src/main/index.ts
import { readFile as readFile14 } from "node:fs/promises";
import path11 from "node:path";
var MAX_OUTPUT11 = 4e4;
var MAX_ARRAY_ITEMS3 = 1e3;
function boundedToolJson2(value) {
  return { content: [{ type: "text", text: stringifyBoundedJson2(value) }] };
}
async function dialogCommand(args = {}, deps = defaultModalBridgeDependencies) {
  return modalBridgeCommand(
    { args, domain: "dialog", actions: ["status", "accept", "dismiss"] },
    deps
  );
}
async function sheetCommand(args = {}, deps = defaultModalBridgeDependencies) {
  return modalBridgeCommand({ args, domain: "sheet", actions: ["status", "dismiss"] }, deps);
}
var defaultModalBridgeDependencies = {
  metroTargets: (metroPort) => metroTargets(metroPort),
  evaluateHermesExpression,
  readJsonFile: async (file) => JSON.parse(await readFile14(file, "utf8")),
  resolvePath: (file) => path11.resolve(file)
};
async function modalBridgeCommand(input, deps) {
  const positionals = Array.isArray(input.args._) ? input.args._ : [];
  const action = requireString14(input.args.action ?? positionals[0] ?? "status", "action");
  if (!input.actions.includes(action)) throw new Error(`Unknown ${input.domain} action: ${action}`);
  const sideEffect = action === "status" ? "read" : "device";
  const policy = await policyDecision(
    input.args,
    `${input.domain}.${action}`,
    sideEffect,
    deps
  );
  if (!policy.allowed)
    return boundedToolJson2(policyDeniedPayload({ domain: input.domain, action, policy }));
  return boundedToolJson2(
    await bridgeDomainCommand2(
      {
        args: input.args,
        domain: input.domain,
        action,
        expression: modalExpression({
          domain: input.domain,
          action,
          text: input.args.text ?? positionals[1]
        }),
        policy
      },
      deps
    )
  );
}
async function bridgeDomainCommand2(input, deps) {
  const metroPort = clampNumber14(input.args.metroPort ?? 8081, 1, 65535);
  const targets = deps.metroTargets ? await deps.metroTargets(metroPort) : [];
  const target = targets[0] ?? null;
  const webSocketDebuggerUrl = target?.webSocketDebuggerUrl ?? null;
  if (!webSocketDebuggerUrl) {
    return domainUnavailable2({
      domain: input.domain,
      action: input.action,
      metroPort,
      code: "no-runtime-target",
      reason: "No Metro inspector target.",
      policy: input.policy
    });
  }
  if (!deps.evaluateHermesExpression) {
    return domainUnavailable2({
      domain: input.domain,
      action: input.action,
      metroPort,
      code: "transport-failure",
      reason: `${input.domain} bridge did not return a value.`,
      target: targetSummary5(target),
      policy: input.policy
    });
  }
  const result = await deps.evaluateHermesExpression(webSocketDebuggerUrl, input.expression, {
    timeoutMs: 5e3
  });
  const value = result?.result?.result?.value;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return domainUnavailable2({
      domain: input.domain,
      action: input.action,
      metroPort,
      code: "transport-failure",
      reason: result?.error ?? `${input.domain} bridge did not return a value.`,
      target: targetSummary5(target),
      transport: bridgeRuntimeTransport2(
        metroPort,
        target,
        result?.diagnostics ?? result?.cdp ?? null
      ),
      policy: input.policy
    });
  }
  const redacted = sanitizePayload3(deps.redactValue ? deps.redactValue(value) : value);
  return sanitizePayload3({
    ...redacted,
    domain: input.domain,
    action: input.action,
    metroPort,
    target: targetSummary5(target),
    transport: bridgeRuntimeTransport2(
      metroPort,
      target,
      result?.diagnostics ?? result?.cdp ?? null
    ),
    evidenceSource: typeof redacted.source === "string" ? redacted.source : "unknown",
    policy: input.policy
  });
}
function domainUnavailable2(args) {
  return sanitizePayload3({
    available: false,
    domain: args.domain,
    action: args.action,
    source: "app-instrumentation",
    evidenceSource: "unavailable",
    code: args.code ?? "unavailable",
    reason: args.reason,
    metroPort: args.metroPort,
    target: targetSummary5(args.target),
    transport: args.transport ?? bridgeRuntimeTransport2(args.metroPort, args.target ?? null, null),
    policy: args.policy ?? null,
    limitations: [`${args.domain} evidence requires the dev-only app instrumentation bridge.`]
  });
}
function bridgeRuntimeTransport2(metroPort, target, cdp = null) {
  return sanitizePayload3({
    name: "metro-inspector-hermes-cdp",
    metroPort,
    protocol: "Runtime.evaluate",
    target: targetSummary5(target),
    cdp
  });
}
function modalExpression(args) {
  const globalName = args.domain === "dialog" ? "__EXPO98_DIALOG_BRIDGE__" : "__EXPO98_SHEET_BRIDGE__";
  const legacyGlobalName = args.domain === "dialog" ? "__EXPO_IOS_DIALOG_BRIDGE__" : "__EXPO_IOS_SHEET_BRIDGE__";
  return `(() => {
    const action = ${JSON.stringify(args.action)};
    const text = ${JSON.stringify(args.text ?? null)};
    const bridge = globalThis.${globalName} ||
      globalThis.${legacyGlobalName} ||
      (globalThis.__EXPO98_INSTRUMENTATION__?.[${JSON.stringify(args.domain)}] || globalThis.__EXPO_IOS_INSTRUMENTATION__?.[${JSON.stringify(args.domain)}]);
    if (!bridge) return { available: false, source: 'app-instrumentation', reason: ${JSON.stringify(`${args.domain} bridge is not installed.`)}, action };
    if (action === 'status') return { available: true, source: 'app-instrumentation', action, visible: !!bridge.visible, ${args.domain}: bridge.current || null };
    if (action === 'accept') return { available: true, source: 'app-instrumentation', action, result: bridge.accept ? bridge.accept(text) : { accepted: true, text } };
    if (action === 'dismiss') return { available: true, source: 'app-instrumentation', action, result: bridge.dismiss ? bridge.dismiss() : { dismissed: true } };
    return { available: false, source: 'app-instrumentation', reason: 'Unsupported modal action.', action };
  })()`;
}
function targetSummary5(target) {
  if (!target) return null;
  return sanitizePayload3({
    id: target.id ?? null,
    title: target.title ?? null,
    description: target.description ?? null,
    appId: target.appId ?? null,
    deviceName: target.deviceName ?? null,
    devtoolsFrontendUrl: target.devtoolsFrontendUrl ?? null,
    webSocketDebuggerUrl: target.webSocketDebuggerUrl ?? null,
    reactNative: target.reactNative ?? null,
    capabilities: target.capabilities ?? {
      hermesRuntime: typeof target.webSocketDebuggerUrl === "string" && target.webSocketDebuggerUrl.startsWith("ws"),
      devtoolsFrontend: typeof target.devtoolsFrontendUrl === "string" && target.devtoolsFrontendUrl.length > 0,
      reactNative: Boolean(target.reactNative)
    }
  });
}
function clampNumber14(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`Expected a finite number, got ${String(value)}.`);
  return Math.min(Math.max(number, min), max);
}
function requireString14(value, name) {
  if (typeof value !== "string" || value.trim().length === 0)
    throw new Error(`${name} must be a non-empty string.`);
  return value.trim();
}
function sanitizePayload3(value) {
  return boundValue3(redactValue4(value));
}
function stringifyBoundedJson2(value) {
  const sanitized = sanitizePayload3(value);
  const text = JSON.stringify(sanitized, null, 2);
  if (text.length <= MAX_OUTPUT11) return text;
  const record = asRecord14(sanitized);
  const envelope = {
    available: false,
    source: "output-boundary",
    evidenceSource: "output-boundary",
    code: "output-truncated",
    outputTruncated: true,
    originalLength: text.length,
    domain: record?.domain,
    action: record?.action,
    preview: ""
  };
  let budget = MAX_OUTPUT11 - JSON.stringify(envelope, null, 2).length - 128;
  envelope.preview = text.slice(0, Math.max(0, budget));
  let output = JSON.stringify(envelope, null, 2);
  while (output.length > MAX_OUTPUT11 && typeof envelope.preview === "string") {
    budget -= output.length - MAX_OUTPUT11 + 128;
    envelope.preview = envelope.preview.slice(0, Math.max(0, budget));
    output = JSON.stringify(envelope, null, 2);
  }
  return output;
}
function boundValue3(value) {
  if (typeof value === "string") return truncate12(value);
  if (Array.isArray(value)) return value.slice(-MAX_ARRAY_ITEMS3).map(boundValue3);
  const record = asRecord14(value);
  if (!record) return value;
  return Object.fromEntries(
    Object.entries(record).map(([key, nested]) => [key, boundValue3(nested)])
  );
}
function redactValue4(value) {
  if (typeof value === "string") return redactString3(value);
  if (Array.isArray(value)) return value.map(redactValue4);
  const record = asRecord14(value);
  if (!record) return value;
  return Object.fromEntries(
    Object.entries(record).map(([key, nested]) => [
      key,
      isSensitiveKey3(key) ? "[redacted]" : redactValue4(nested)
    ])
  );
}
function redactString3(value) {
  try {
    const parsed = new URL(value);
    let changed = false;
    for (const key of [...parsed.searchParams.keys()]) {
      if (isSensitiveKey3(key)) {
        parsed.searchParams.set(key, "[redacted]");
        changed = true;
      }
    }
    return changed ? parsed.toString() : value;
  } catch {
    return value.replace(
      /([?&](?:cookie|token|authorization|password|secret|api[-_]?key|apikey)=)[^&\s]+/gi,
      "$1[redacted]"
    );
  }
}
function isSensitiveKey3(key) {
  return /token|authorization|cookie|password|secret|apikey|apiKey/i.test(key);
}
function truncate12(value, max = MAX_OUTPUT11) {
  const text = String(value ?? "");
  if (text.length <= max) return text;
  return `${text.slice(0, max)}
...[truncated ${text.length - max} chars]`;
}
function asRecord14(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

// src/commands/navigation-deeplinks/src/main/index.ts
var EXPO98_BRIDGE_VERSION3 = "1.0.0";
var NAVIGATION_LIMITATIONS = [
  "Navigation state and imperative navigation actions require the dev-only app instrumentation bridge.",
  "Use open-route or navigation deep-link when only URL navigation is available."
];
function clampNumber15(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`Expected a finite number, got ${String(value)}.`);
  return Math.min(Math.max(number, min), max);
}
function targetSummary6(target) {
  if (!target) return null;
  return {
    id: target.id ?? null,
    title: target.title ?? null,
    description: target.description ?? null,
    appId: target.appId ?? null,
    deviceName: target.deviceName ?? null,
    devtoolsFrontendUrl: target.devtoolsFrontendUrl ?? null,
    webSocketDebuggerUrl: target.webSocketDebuggerUrl ?? null,
    reactNative: target.reactNative ?? null,
    capabilities: target.capabilities ?? {
      hermesRuntime: typeof target.webSocketDebuggerUrl === "string" && target.webSocketDebuggerUrl.startsWith("ws"),
      devtoolsFrontend: typeof target.devtoolsFrontendUrl === "string" && target.devtoolsFrontendUrl.length > 0,
      reactNative: Boolean(target.reactNative)
    }
  };
}
function navigationTransport(metroPort, target, cdp = null) {
  return {
    name: "metro-inspector-hermes-cdp",
    metroPort,
    protocol: "Runtime.evaluate",
    target: targetSummary6(target),
    cdp
  };
}
function navigationUnavailable(args) {
  return {
    available: false,
    action: args.action,
    source: "app-instrumentation",
    evidenceSource: "unavailable",
    reason: args.reason,
    metroPort: args.metroPort,
    target: args.target ?? null,
    transport: navigationTransport(args.metroPort, args.target ?? null),
    policy: args.policy ?? null,
    limitations: NAVIGATION_LIMITATIONS
  };
}
async function navigationPolicyDecision(args, action, deps = {}) {
  const sideEffect = action === "state" ? "read" : "device";
  if (action === "state") {
    return {
      checked: true,
      action: `navigation.${action}`,
      sideEffect,
      allowed: true,
      reason: "Read action does not require policy approval."
    };
  }
  if (action === "deep-link") {
    if (!deps.policyDecision) {
      return {
        checked: true,
        action: "open-route",
        sideEffect,
        allowed: false,
        source: null,
        reason: "No action policy allowed this state-changing operation."
      };
    }
    return deps.policyDecision(args, "open-route", "device");
  }
  if (!deps.policyDecision) {
    return {
      checked: true,
      action: `navigation.${action}`,
      sideEffect,
      allowed: false,
      source: null,
      reason: "No action policy allowed this state-changing operation."
    };
  }
  return deps.policyDecision(args, `navigation.${action}`, "device");
}
async function navigationCommand(args = {}, deps = defaultNavigationDependencies) {
  const action = requireString15(args.action ?? "state", "action");
  if (!["state", "back", "pop-to-root", "tab", "deep-link"].includes(action)) {
    throw new Error(`Unknown navigation action: ${action}`);
  }
  if (action === "deep-link") return toolJson(await navigationDeepLink(args, deps));
  const metroPort = clampNumber15(args.metroPort ?? 8081, 1, 65535);
  const policy = await navigationPolicyDecision(args, action, deps);
  if (!policy.allowed) {
    return toolJson({
      available: false,
      action,
      metroPort,
      source: "policy",
      evidenceSource: "policy",
      reason: policy.reason,
      policy,
      transport: navigationTransport(metroPort, null, null)
    });
  }
  const targets = deps.metroTargets ? await deps.metroTargets(metroPort) : [];
  const target = targets[0] ?? null;
  const webSocketDebuggerUrl = target?.webSocketDebuggerUrl ?? null;
  if (!webSocketDebuggerUrl) {
    return toolJson(
      navigationUnavailable({ action, metroPort, reason: "No Metro inspector target.", policy })
    );
  }
  if (!deps.evaluateHermesExpression) {
    return toolJson(
      navigationUnavailable({
        action,
        metroPort,
        reason: "No Hermes evaluator is configured.",
        target: targetSummary6(target),
        policy
      })
    );
  }
  const result = await deps.evaluateHermesExpression(
    webSocketDebuggerUrl,
    navigationExpression({ action, tab: args.tab ?? args._?.[1] }),
    { timeoutMs: 5e3 }
  );
  const value = result?.result?.result?.value;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return toolJson(
      navigationUnavailable({
        action,
        metroPort,
        reason: result?.error ?? "Navigation bridge did not return a value.",
        target: targetSummary6(target),
        policy
      })
    );
  }
  return toolJson({
    ...value,
    action,
    metroPort,
    target: targetSummary6(target),
    transport: navigationTransport(metroPort, target, result?.diagnostics),
    evidenceSource: "source" in value && typeof value.source === "string" ? value.source : "unknown",
    policy
  });
}
async function navigationDeepLink(args = {}, deps = defaultNavigationDependencies) {
  const policy = await navigationPolicyDecision(args, "deep-link", deps);
  if (!policy.allowed)
    return { available: false, action: "deep-link", reason: policy.reason, policy };
  if (!deps.openExpoRoute) {
    return {
      available: false,
      action: "deep-link",
      reason: "No open-route adapter is configured.",
      policy
    };
  }
  const route = args.route ?? args._?.[1] ?? args._?.[0];
  const openedRaw = unwrapToolJson(await deps.openExpoRoute({ ...args, route }));
  if (!openedRaw || typeof openedRaw !== "object" || Array.isArray(openedRaw)) {
    return {
      available: false,
      action: "deep-link",
      source: "open-route",
      evidenceSource: "deep-link",
      reason: "Open-route result was malformed.",
      policy
    };
  }
  const opened = sanitizeOpenRouteResult(openedRaw);
  return {
    available: true,
    action: "deep-link",
    source: "open-route",
    evidenceSource: "deep-link",
    transport: {
      name: "simulator-open-url",
      command: "open-route",
      target: opened.device ?? null
    },
    policy,
    deepLink: opened,
    evidence: {
      targetId: await selectedTargetId(args, deps),
      sessionId: await latestSessionId(args, deps),
      route: route ?? opened.route ?? null,
      url: opened.url ?? null
    }
  };
}
var defaultNavigationDependencies = {
  metroTargets: (metroPort) => metroTargets(metroPort),
  evaluateHermesExpression,
  openExpoRoute,
  policyDecision: (args, action) => routeActionPolicyDecision(
    args,
    action
  )
};
function navigationExpression(args) {
  return `(() => {
    const action = ${JSON.stringify(args.action)};
    const tab = ${JSON.stringify(args.tab ?? null)};
    const expectedBridgeVersion = ${JSON.stringify(EXPO98_BRIDGE_VERSION3)};
    const pluginBridge = globalThis.__EXPO98_DEVTOOLS_BRIDGE__ ||
      globalThis.__EXPO_IOS_DEVTOOLS_BRIDGE__ ||
      globalThis.__EXPO98_PLUGIN_BRIDGE__ ||
      globalThis.__EXPO_IOS_PLUGIN_BRIDGE__ ||
      globalThis.__ROZENITE_AGENT_BRIDGE__;
    if (pluginBridge && typeof pluginBridge === 'object') {
      const metadata = pluginBridge.metadata || pluginBridge.expoIosDevtoolsBridgeMetadata || pluginBridge.bridgeMetadata || {};
      const bridgeVersion = metadata.bridgeVersion || pluginBridge.bridgeVersion || pluginBridge.version || null;
      if (bridgeVersion && bridgeVersion !== expectedBridgeVersion) {
        return {
          available: false,
          action,
          source: 'plugin-bridge',
          domain: 'navigation',
          code: 'version-mismatch',
          bridgeVersion,
          expectedBridgeVersion,
          reason: 'Navigation plugin bridge version is not compatible with this CLI.',
          state: null
        };
      }
      const domains = pluginBridge.domainRegistry || pluginBridge.domains || {};
      const navigation = pluginBridge.navigation ||
        (pluginBridge.domains && !Array.isArray(pluginBridge.domains) ? pluginBridge.domains.navigation : null) ||
        (pluginBridge.domainRegistry ? pluginBridge.domainRegistry.navigation : null);
      const callTool = typeof pluginBridge.callTool === 'function' ? pluginBridge.callTool.bind(pluginBridge) : null;
      const callNavigation = (name, payload = {}) => {
        if (navigation && typeof navigation[name] === 'function') return navigation[name](payload);
        if (navigation && navigation.actions && typeof navigation.actions[name] === 'function') return navigation.actions[name](payload);
        if (callTool) return callTool('navigation.' + name, payload);
        return null;
      };
      const hasNavigation = Boolean(navigation || callTool || (Array.isArray(domains) && domains.some((domain) => domain?.name === 'navigation')));
      if (hasNavigation) {
        if (action === 'state') {
          return {
            available: true,
            action,
            source: 'plugin-bridge',
            domain: 'navigation',
            bridgeVersion,
            state: navigation && typeof navigation.state !== 'function' ? navigation.state || null : callNavigation('state')
          };
        }
        if (action === 'back') {
          return { available: true, action, source: 'plugin-bridge', domain: 'navigation', bridgeVersion, result: callNavigation('back') };
        }
        if (action === 'pop-to-root') {
          return { available: true, action, source: 'plugin-bridge', domain: 'navigation', bridgeVersion, result: callNavigation('pop-to-root') || callNavigation('popToRoot') };
        }
        if (action === 'tab') {
          return { available: true, action, source: 'plugin-bridge', domain: 'navigation', bridgeVersion, tab, result: callNavigation('tab', { tab }) };
        }
      }
    }
    const bridge = globalThis.__EXPO98_NAVIGATION_BRIDGE__ ||
      globalThis.__EXPO_IOS_NAVIGATION_BRIDGE__ ||
      (globalThis.__EXPO98_INSTRUMENTATION__?.navigation || globalThis.__EXPO_IOS_INSTRUMENTATION__?.navigation);
    if (!bridge) {
      return {
        available: false,
        action,
        source: 'app-instrumentation',
        reason: 'Navigation bridge is not installed.',
        state: null
      };
    }
    if (action === 'state') {
      return {
        available: true,
        action,
        source: 'app-instrumentation',
        state: typeof bridge.state === 'function' ? bridge.state() : bridge.state || null
      };
    }
    if (action === 'back') {
      return {
        available: true,
        action,
        source: 'app-instrumentation',
        result: typeof bridge.back === 'function' ? bridge.back() : null
      };
    }
    if (action === 'pop-to-root') {
      return {
        available: true,
        action,
        source: 'app-instrumentation',
        result: typeof bridge.popToRoot === 'function' ? bridge.popToRoot() : null
      };
    }
    if (action === 'tab') {
      return {
        available: true,
        action,
        source: 'app-instrumentation',
        tab,
        result: typeof bridge.tab === 'function' ? bridge.tab(tab) : null
      };
    }
    return { available: false, action, source: 'app-instrumentation', reason: 'Unsupported navigation action.' };
  })()`;
}
async function selectedTargetId(args = {}, deps = {}) {
  return deps.selectedTargetId ? deps.selectedTargetId(args) : null;
}
async function latestSessionId(args = {}, deps = {}) {
  return deps.latestSessionId ? deps.latestSessionId(args) : null;
}
function requireString15(value, field) {
  if (typeof value !== "string" || value.trim() === "")
    throw new Error(`${field} must be a non-empty string.`);
  return value.trim();
}
function sanitizeOpenRouteResult(result) {
  return sanitizeSensitiveUrlStrings(result);
}
function sanitizeSensitiveUrlStrings(value) {
  if (typeof value === "string") return redactSensitiveUrlQuery2(value);
  if (Array.isArray(value)) return value.map((item) => sanitizeSensitiveUrlStrings(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        sanitizeSensitiveUrlStrings(item)
      ])
    );
  }
  return value;
}
function redactSensitiveUrlQuery2(value) {
  return value.replace(
    /([?&][^=\s&]*(?:cookie|token|authorization|password|secret)[^=\s&]*=)[^&\s]+/gi,
    "$1[redacted]"
  );
}

// src/commands/network-evidence/src/main/index.ts
import { promises as fs8 } from "node:fs";
import path12 from "node:path";
var CLI_NAME3 = CURRENT_CLI_NAME;
var CLI_VERSION2 = "0.1.0";
var EXPO98_BRIDGE_VERSION4 = "1.0.0";
var REDACTED2 = "[redacted]";
var UNAVAILABLE_LIMITATIONS = [
  "Network evidence requires dev-only app instrumentation that patches fetch/XHR or an equivalent app network adapter.",
  "Native networking stacks are unavailable unless the app exposes them through the bridge."
];
function clampNumber16(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`Expected a finite number, got ${String(value)}.`);
  return Math.min(Math.max(number, min), max);
}
async function networkCommand(args = {}, deps = defaultNetworkDependencies) {
  const action = requireString16(args.action ?? "status", "action");
  if (!["status", "requests", "request", "clear", "har", "waterfall"].includes(action)) {
    throw new Error(`Unknown network action: ${action}`);
  }
  const harAction = action === "har" ? requireString16(args.harAction ?? "start", "harAction") : null;
  const bridgeAction = action === "har" ? `har-${harAction}` : action;
  if (harAction && !["start", "stop"].includes(harAction)) {
    throw new Error(`Unknown network HAR action: ${harAction}`);
  }
  const metroPort = clampNumber16(args.metroPort ?? 8081, 1, 65535);
  const limit = clampNumber16(args.limit ?? 100, 1, 1e3);
  if (!deps.metroTargets) {
    return toolJson(
      networkUnavailable({
        action: bridgeAction,
        metroPort,
        code: "transport-failure",
        reason: "No Metro target resolver is configured."
      })
    );
  }
  const targets = await deps.metroTargets(metroPort);
  const target = targets.find((item) => item.webSocketDebuggerUrl) ?? targets[0] ?? null;
  const webSocketDebuggerUrl = target?.webSocketDebuggerUrl ?? null;
  if (!webSocketDebuggerUrl) {
    return toolJson(
      networkUnavailable({
        action: bridgeAction,
        metroPort,
        code: "no-runtime-target",
        reason: "No Metro inspector target."
      })
    );
  }
  if (!deps.evaluateHermesExpression) {
    return toolJson(
      networkUnavailable({
        action: bridgeAction,
        metroPort,
        code: "transport-failure",
        reason: "No Hermes evaluator is configured.",
        target: targetSummary7(target)
      })
    );
  }
  const result = await deps.evaluateHermesExpression(
    webSocketDebuggerUrl,
    networkExpression({ action: bridgeAction, requestId: args.requestId, limit }),
    { timeoutMs: 5e3 }
  );
  const value = result?.result?.result?.value;
  if (!value) {
    return toolJson(
      networkUnavailable({
        action: bridgeAction,
        metroPort,
        code: "transport-failure",
        reason: result?.error ?? "Network bridge did not return a value.",
        target: targetSummary7(target),
        transport: networkTransport(metroPort, target, result?.diagnostics)
      })
    );
  }
  const transport = networkTransport(metroPort, target, result.diagnostics);
  const redacted = normalizeNetworkEvidence(redactNetworkEvidence(value), bridgeAction);
  const clock = deps.clock ?? systemClock;
  if (bridgeAction === "har-stop" && redacted.available !== false) {
    const paths = deps.path ?? defaultPath;
    const stateRoot = (deps.resolveExpoStateRoot ?? defaultResolveExpoStateRoot)(args);
    const timestamp = clock.now().toISOString().replace(/[:.]/g, "-");
    const outputPath = paths.resolve(
      args.outputPath ?? paths.join(stateRoot, "artifacts", `network-${timestamp}.har`)
    );
    const captureTiming = networkCaptureTiming(redacted, clock);
    const har = annotateHar(
      redacted.har ?? harFromNetworkRequests(redacted.requests ?? [], clock),
      {
        source: redacted.source ?? "unknown",
        transport,
        limitations: networkLimitations(redacted),
        captureTiming
      }
    );
    const fileSystem = deps.fileSystem ?? defaultFileSystem;
    await fileSystem.mkdir(paths.dirname(outputPath), { recursive: true });
    await fileSystem.writeJsonFile(outputPath, har);
    return toolJson({
      ...redacted,
      action: bridgeAction,
      metroPort,
      target: targetSummary7(target),
      transport,
      evidenceSource: redacted.source ?? "unknown",
      limitations: networkLimitations(redacted),
      captureTiming,
      artifact: outputPath,
      har
    });
  }
  const payload = {
    ...redacted,
    action: bridgeAction,
    metroPort,
    target: targetSummary7(target),
    transport,
    evidenceSource: redacted.source ?? "unknown",
    limitations: networkLimitations(redacted),
    captureTiming: networkCaptureTiming(redacted, clock)
  };
  return toolJson(action === "waterfall" ? networkWaterfallPayload(payload) : payload);
}
var defaultNetworkDependencies = {
  metroTargets: defaultMetroTargets,
  evaluateHermesExpression
};
async function defaultMetroTargets(metroPort) {
  try {
    const response = await fetch(`http://localhost:${metroPort}/json/list`);
    if (!response.ok) return [];
    const parsed = await response.json();
    return Array.isArray(parsed) ? parsed.map((target) => target) : [];
  } catch {
    return [];
  }
}
function networkUnavailable(input) {
  const code = input.code ?? "unavailable";
  const evidenceSource = input.source ?? (code === "no-runtime-target" ? "runtime-target" : "app-instrumentation");
  return {
    available: false,
    action: input.action,
    source: evidenceSource,
    evidenceSource: "unavailable",
    code,
    reason: input.reason,
    metroPort: input.metroPort,
    target: input.target ?? null,
    transport: input.transport ?? {
      name: "metro-inspector-hermes-cdp",
      metroPort: input.metroPort,
      protocol: "Runtime.evaluate",
      target: input.target ?? null,
      cdp: null
    },
    requests: [],
    limitations: UNAVAILABLE_LIMITATIONS,
    realValidation: realValidation({
      state: code === "no-runtime-target" ? "environment-blocked" : "unvalidated",
      evidence: [{ source: evidenceSource, command: `network.${input.action}`, confidence: "low" }],
      missingEvidence: [
        {
          signal: code === "no-runtime-target" ? "metro-hermes-target" : "network-bridge",
          reason: input.reason,
          recommendedFix: code === "no-runtime-target" ? "Start Metro, launch the app in a Hermes dev client, and rerun with --metro-port." : "Install or mount the dev-only network bridge, then rerun network requests."
        }
      ]
    })
  };
}
function networkExpression(input) {
  const { action, requestId, limit } = input;
  return `(() => {
    const action = ${JSON.stringify(action)};
    const requestId = ${JSON.stringify(requestId ?? null)};
    const limit = ${Number(limit)};
    const expectedBridgeVersion = ${JSON.stringify(EXPO98_BRIDGE_VERSION4)};
    const pluginBridge = globalThis.__EXPO98_DEVTOOLS_BRIDGE__ ||
      globalThis.__EXPO_IOS_DEVTOOLS_BRIDGE__ ||
      globalThis.__EXPO98_PLUGIN_BRIDGE__ ||
      globalThis.__EXPO_IOS_PLUGIN_BRIDGE__ ||
      globalThis.__ROZENITE_AGENT_BRIDGE__;
    const pluginMetadata = pluginBridge?.metadata || pluginBridge?.expo98DevtoolsBridgeMetadata || pluginBridge?.expoIosDevtoolsBridgeMetadata || pluginBridge?.bridgeMetadata || {};
    const pluginVersion = pluginMetadata.bridgeVersion || pluginBridge?.bridgeVersion || pluginBridge?.version || null;
    const pluginNetwork = pluginBridge?.network ||
      (pluginBridge?.domains && !Array.isArray(pluginBridge.domains) ? pluginBridge.domains.network : null) ||
      (pluginBridge?.domainRegistry ? pluginBridge.domainRegistry.network : null);
    const pluginCallTool = typeof pluginBridge?.callTool === 'function' ? pluginBridge.callTool.bind(pluginBridge) : null;
    const callNetwork = (name, payload = {}) => {
      if (pluginNetwork && typeof pluginNetwork[name] === 'function') return pluginNetwork[name](payload);
      if (pluginNetwork && pluginNetwork.actions && typeof pluginNetwork.actions[name] === 'function') return pluginNetwork.actions[name](payload);
      if (pluginCallTool) return pluginBridge.callTool('network.' + name, payload);
      return null;
    };
    const hasPluginNetwork = Boolean(pluginNetwork || pluginCallTool || (Array.isArray(pluginBridge?.domains) && pluginBridge.domains.some((domain) => domain?.name === 'network')));
    if (hasPluginNetwork) {
      if (pluginVersion && pluginVersion !== expectedBridgeVersion) {
        return { available: false, action, source: 'plugin-bridge', code: 'version-mismatch', bridgeVersion: pluginVersion, expectedBridgeVersion, reason: 'Network plugin bridge version is not compatible with this CLI.', requests: [] };
      }
      const list = () => {
        const raw = pluginNetwork && typeof pluginNetwork.requests === 'function'
          ? pluginNetwork.requests({ limit })
          : pluginNetwork?.requests || callNetwork('requests', { limit }) || [];
        return Array.isArray(raw) ? raw.slice(-limit) : raw;
      };
      if (action === 'status') return { available: true, action, source: 'plugin-bridge', domain: 'network', bridgeVersion: pluginVersion, hooks: pluginNetwork?.hooks || callNetwork('status') || { fetch: true, xhr: true } };
      if (action === 'requests' || action === 'waterfall') return { available: true, action, source: 'plugin-bridge', domain: 'network', bridgeVersion: pluginVersion, requests: list() };
      if (action === 'request') {
        const requests = list();
        if (!Array.isArray(requests)) return { available: false, action, source: 'plugin-bridge', code: 'malformed-payload', reason: 'Network plugin bridge returned a malformed request list.', requests: [] };
        const found = requests.find((request) => request && request.id === requestId) || null;
        return found
          ? { available: true, action, source: 'plugin-bridge', domain: 'network', bridgeVersion: pluginVersion, request: found }
          : { available: false, action, source: 'plugin-bridge', code: 'no-observed-traffic', reason: 'Request not found.', requestId, requests: [] };
      }
      if (action === 'clear') return { available: true, action, source: 'plugin-bridge', domain: 'network', bridgeVersion: pluginVersion, cleared: callNetwork('clear') ?? true };
      if (action === 'har-start') return { available: true, action, source: 'plugin-bridge', domain: 'network', bridgeVersion: pluginVersion, started: callNetwork('har-start') ?? true, startedAt: new Date().toISOString() };
      if (action === 'har-stop') {
        const har = callNetwork('har-stop');
        return { available: true, action, source: 'plugin-bridge', domain: 'network', bridgeVersion: pluginVersion, har: har?.log ? har : null, requests: list(), stoppedAt: new Date().toISOString() };
      }
    }
    const devtoolsNetwork = globalThis.__REACT_NATIVE_DEVTOOLS_NETWORK__ ||
      globalThis.__RN_DEVTOOLS_NETWORK__ ||
      globalThis.__REACT_DEVTOOLS_NETWORK__;
    if (devtoolsNetwork && typeof devtoolsNetwork === 'object') {
      const list = () => {
        const raw = typeof devtoolsNetwork.requests === 'function' ? devtoolsNetwork.requests({ limit }) : devtoolsNetwork.requests || [];
        return Array.isArray(raw) ? raw.slice(-limit) : raw;
      };
      if (action === 'status') return { available: true, action, source: 'react-native-devtools-network', hooks: devtoolsNetwork.hooks || { fetch: true, xhr: true } };
      if (action === 'requests' || action === 'waterfall') return { available: true, action, source: 'react-native-devtools-network', requests: list() };
      if (action === 'request') {
        const found = list().find((request) => request && request.id === requestId) || null;
        return found
          ? { available: true, action, source: 'react-native-devtools-network', request: found }
          : { available: false, action, source: 'react-native-devtools-network', code: 'no-observed-traffic', reason: 'Request not found.', requestId, requests: [] };
      }
      if (action === 'har-start') return { available: true, action, source: 'react-native-devtools-network', started: true, startedAt: new Date().toISOString() };
      if (action === 'har-stop') return { available: true, action, source: 'react-native-devtools-network', requests: list(), stoppedAt: new Date().toISOString() };
    }
    const bridge = globalThis.__EXPO98_NETWORK_BRIDGE__ ||
      globalThis.__EXPO_IOS_NETWORK_BRIDGE__ ||
      (globalThis.__EXPO98_INSTRUMENTATION__?.network || globalThis.__EXPO_IOS_INSTRUMENTATION__?.network);
    if (!bridge) {
      return {
        available: false,
        action,
        source: 'app-instrumentation',
        code: 'no-bridge-domain',
        reason: 'Network bridge is not installed.',
        requests: []
      };
    }
    const list = () => {
      const raw = typeof bridge.requests === 'function' ? bridge.requests({ limit }) : bridge.requests || [];
      return Array.isArray(raw) ? raw.slice(-limit) : [];
    };
    if (action === 'status') {
      return {
        available: true,
        action,
        source: 'app-instrumentation',
        hooks: typeof bridge.status === 'function' ? bridge.status() : (bridge.hooks || { fetch: true, xhr: true })
      };
    }
    if (action === 'requests' || action === 'waterfall') {
      return { available: true, action, source: 'app-instrumentation', requests: list() };
    }
    if (action === 'request') {
      const found = list().find((request) => request && request.id === requestId) || null;
      return found
        ? { available: true, action, source: 'app-instrumentation', request: found }
        : { available: false, action, source: 'app-instrumentation', reason: 'Request not found.', requestId };
    }
    if (action === 'clear') {
      if (typeof bridge.clear === 'function') bridge.clear();
      return { available: true, action, source: 'app-instrumentation', cleared: true };
    }
    if (action === 'har-start') {
      if (typeof bridge.harStart === 'function') return { available: true, action, source: 'app-instrumentation', har: bridge.harStart() };
      return { available: true, action, source: 'app-instrumentation', started: true };
    }
    if (action === 'har-stop') {
      if (typeof bridge.harStop === 'function') return { available: true, action, source: 'app-instrumentation', har: bridge.harStop(), requests: list() };
      return { available: true, action, source: 'app-instrumentation', requests: list() };
    }
    return { available: false, action, source: 'app-instrumentation', reason: 'Unsupported network action.' };
  })()`;
}
function redactNetworkEvidence(value) {
  if (!isRecord6(value)) return value;
  const clone = { ...value };
  if (Array.isArray(clone.requests))
    clone.requests = clone.requests.map(redactNetworkRequest).map(normalizeNetworkRequest);
  if (clone.request) clone.request = normalizeNetworkRequest(redactNetworkRequest(clone.request));
  if (clone.har) clone.har = redactHar(clone.har);
  return clone;
}
function normalizeNetworkEvidence(value, action) {
  if (!isRecord6(value) || Array.isArray(value)) {
    return {
      available: false,
      action,
      source: "runtime",
      code: "malformed-payload",
      reason: "Network runtime returned a malformed payload.",
      requests: []
    };
  }
  const normalized = { ...value };
  if (normalized.requests !== void 0 && !Array.isArray(normalized.requests)) {
    return {
      ...normalized,
      available: false,
      action,
      code: "malformed-payload",
      reason: "Network runtime returned a malformed request list.",
      requests: []
    };
  }
  if (Array.isArray(normalized.requests))
    normalized.requests = normalized.requests.map(normalizeNetworkRequest);
  if (normalized.request)
    normalized.request = normalizeNetworkRequest(normalized.request);
  if ((action === "requests" || action === "waterfall" || action === "har-stop") && normalized.available !== false && Array.isArray(normalized.requests) && normalized.requests.length === 0) {
    return {
      ...normalized,
      available: false,
      action,
      code: "no-observed-traffic",
      reason: "No network traffic was observed by the selected upstream/bridge path.",
      requests: [],
      realValidation: realValidation({
        state: "partial",
        evidence: [
          {
            source: String(normalized.source ?? "network"),
            command: `network.${action}`,
            confidence: "low"
          }
        ],
        missingEvidence: [
          {
            signal: "observed-network-traffic",
            reason: "No network traffic was observed by the selected upstream/bridge path.",
            recommendedFix: "Start capture before the interaction or verify the app network bridge patches fetch/XHR."
          }
        ]
      })
    };
  }
  return {
    ...normalized,
    realValidation: networkRealValidation(normalized, action)
  };
}
function networkTransport(metroPort, target, cdp = null) {
  return {
    name: "metro-inspector-hermes-cdp",
    metroPort,
    protocol: "Runtime.evaluate",
    target: targetSummary7(target),
    cdp
  };
}
function networkLimitations(value) {
  const record = isRecord6(value) ? value : {};
  const limitations = [
    "Network evidence is limited to traffic observed by the selected React Native DevTools or app bridge network domain.",
    "Headers, cookies, credentials, request bodies, and response bodies are redacted before stdout and artifact writes."
  ];
  if (record.source === "app-instrumentation") {
    limitations.push(
      "Legacy app instrumentation was used because no upstream DevTools or plugin bridge network domain was available."
    );
  }
  if (record.available === false && record.code === "no-observed-traffic") {
    limitations.push(
      "No observed traffic is not proof that the app made no native network requests outside the selected domain."
    );
  }
  return limitations;
}
function networkWaterfallPayload(payload) {
  const requests = Array.isArray(payload.requests) ? payload.requests.map(normalizeNetworkRequest) : [];
  const rankedRequests = [...requests].filter((request) => typeof request.durationMs === "number").sort((a, b) => Number(b.durationMs ?? 0) - Number(a.durationMs ?? 0)).slice(0, 50);
  const duplicateGroups = duplicateNetworkRequests(requests);
  const slowThresholdMs = 500;
  const waterfall = {
    requestCount: requests.length,
    slowThresholdMs,
    slowRequestCount: rankedRequests.filter(
      (request) => Number(request.durationMs ?? 0) >= slowThresholdMs
    ).length,
    rankedRequests,
    duplicateGroups,
    timings: requests.map((request) => ({
      requestId: request.requestId ?? request.id ?? null,
      method: request.method ?? "GET",
      origin: request.origin ?? null,
      path: request.path ?? null,
      startedAt: request.startedAt ?? null,
      endedAt: request.endedAt ?? null,
      durationMs: request.durationMs ?? null,
      status: request.status ?? null,
      initiator: request.initiator ?? null
    }))
  };
  return {
    ...payload,
    action: "waterfall",
    requests,
    waterfall,
    realValidation: networkRealValidation({ ...payload, requests }, "waterfall")
  };
}
function networkCaptureTiming(value, clock = systemClock) {
  const record = isRecord6(value) ? value : {};
  const requests = Array.isArray(record.requests) ? record.requests : record.request ? [record.request] : [];
  const times = requests.map((request) => isRecord6(request) ? request.startedAt : void 0).filter((item) => typeof item === "string" && item.length > 0).sort();
  return {
    startedAt: typeof record.startedAt === "string" ? record.startedAt : times[0] ?? null,
    stoppedAt: typeof record.stoppedAt === "string" ? record.stoppedAt : clock.now().toISOString(),
    observedRequestCount: requests.length
  };
}
function networkRealValidation(value, action) {
  const requests = Array.isArray(value.requests) ? value.requests : value.request ? [value.request] : [];
  const hasTimedRequests = requests.some((request) => typeof request?.durationMs === "number");
  const hasWaterfallMetadata = requests.some(
    (request) => typeof request?.startedAt === "string" && typeof request?.endedAt === "string"
  );
  return realValidation({
    state: value.available === false ? "unvalidated" : hasTimedRequests ? action === "waterfall" && !hasWaterfallMetadata ? "partial" : "validated" : "partial",
    claimsAllowed: {
      networkLatency: hasTimedRequests,
      networkWaterfall: action === "waterfall" && hasWaterfallMetadata
    },
    evidence: [
      {
        source: String(value.source ?? value.evidenceSource ?? "network"),
        command: `network.${action}`,
        timestamp: (/* @__PURE__ */ new Date()).toISOString(),
        confidence: hasTimedRequests ? "medium" : "low"
      }
    ],
    missingEvidence: [
      ...!hasTimedRequests ? [
        {
          signal: "request-duration",
          reason: "No timed network request rows were present.",
          recommendedFix: "Run network requests after a real interaction or mount a bridge that records durationMs."
        }
      ] : [],
      ...action === "waterfall" && !hasWaterfallMetadata ? [
        {
          signal: "network-phase-timestamps",
          reason: "Request rows do not include complete endedAt/phase timing metadata.",
          recommendedFix: "Upgrade the app bridge to record endedAt and phase timing metadata."
        }
      ] : []
    ]
  });
}
function normalizeNetworkRequest(request) {
  if (!isRecord6(request)) return request;
  const url = String(request.url ?? (isRecord6(request.request) ? request.request.url : "") ?? "");
  const parsed = parseUrlParts(url);
  const startedAt = optionalString6(request.startedAt);
  const durationMs = numberOrNull(request.durationMs);
  const endedAt = optionalString6(request.endedAt ?? request.completedAt) ?? inferEndedAt(startedAt, durationMs);
  const response = isRecord6(request.response) ? request.response : {};
  const status = numberOrNull(request.status) ?? numberOrNull(response.status);
  return {
    ...request,
    id: optionalString6(request.id) ?? optionalString6(request.requestId) ?? null,
    requestId: optionalString6(request.requestId) ?? optionalString6(request.id) ?? null,
    method: optionalString6(request.method) ?? optionalString6(isRecord6(request.request) ? request.request.method : null) ?? "GET",
    url,
    origin: parsed.origin,
    path: parsed.path,
    startedAt,
    endedAt,
    durationMs,
    status,
    ok: typeof request.ok === "boolean" ? request.ok : typeof status === "number" ? status >= 200 && status < 400 : void 0,
    requestBytes: numberOrNull(request.requestBytes ?? request.encodedRequestBytes),
    responseBytes: numberOrNull(
      request.responseBytes ?? request.encodedResponseBytes ?? response.encodedBodySize ?? response.size
    ),
    cache: isRecord6(request.cache) ? request.cache : void 0,
    retryCount: numberOrNull(request.retryCount) ?? 0,
    aborted: request.aborted === true,
    error: optionalString6(request.error),
    initiator: normalizeInitiator(request.initiator)
  };
}
function duplicateNetworkRequests(requests) {
  const groups = /* @__PURE__ */ new Map();
  for (const request of requests) {
    const key = `${request.method ?? "GET"} ${request.origin ?? ""}${request.path ?? request.url ?? ""}`;
    const group = groups.get(key) ?? [];
    group.push(request);
    groups.set(key, group);
  }
  return [...groups.entries()].filter(([, group]) => group.length > 1).map(([key, group]) => ({
    key,
    count: group.length,
    requestIds: group.map((request) => request.requestId ?? request.id ?? null).filter(Boolean),
    totalDurationMs: group.reduce((sum, request) => sum + Number(request.durationMs ?? 0), 0)
  }));
}
function harFromNetworkRequests(requests, clock = systemClock) {
  return {
    log: {
      version: "1.2",
      creator: { name: CLI_NAME3, version: CLI_VERSION2 },
      entries: requests.map((request) => ({
        startedDateTime: request.startedAt ?? clock.now().toISOString(),
        time: request.durationMs ?? 0,
        request: {
          method: request.method ?? request.request?.method ?? "GET",
          url: request.url ?? request.request?.url ?? "",
          headers: request.headers ?? request.request?.headers ?? {},
          queryString: [],
          cookies: []
        },
        response: {
          status: request.status ?? request.response?.status ?? 0,
          statusText: request.response?.statusText ?? "",
          headers: request.response?.headers ?? {},
          cookies: [],
          content: { size: request.responseBytes ?? 0, mimeType: request.response?.mimeType ?? "" }
        }
      }))
    }
  };
}
function annotateHar(har, metadata) {
  const copy = cloneJson(isRecord6(har) ? har : harFromNetworkRequests([]));
  const log = isRecord6(copy.log) ? copy.log : { version: "1.2", creator: { name: CLI_NAME3, version: CLI_VERSION2 }, entries: [] };
  copy.log = log;
  log._expoIos = {
    source: metadata.source,
    transport: metadata.transport,
    limitations: metadata.limitations,
    captureTiming: metadata.captureTiming,
    redaction: {
      headers: ["authorization", "cookie", "set-cookie", "token", "secret", "api-key"],
      bodies: true,
      query: ["token", "secret", "key", "password", "auth", "session", "cookie"]
    }
  };
  return copy;
}
function targetSummary7(target) {
  if (!target) return null;
  return {
    id: target.id ?? null,
    title: target.title ?? null,
    description: target.description ?? null,
    appId: target.appId ?? null,
    deviceName: target.deviceName ?? null,
    devtoolsFrontendUrl: target.devtoolsFrontendUrl ?? null,
    webSocketDebuggerUrl: target.webSocketDebuggerUrl ?? null,
    reactNative: target.reactNative ?? null,
    capabilities: target.capabilities ?? {
      hermesRuntime: typeof target.webSocketDebuggerUrl === "string" && target.webSocketDebuggerUrl.startsWith("ws"),
      devtoolsFrontend: typeof target.devtoolsFrontendUrl === "string" && target.devtoolsFrontendUrl.length > 0,
      reactNative: Boolean(target.reactNative)
    }
  };
}
function requireString16(value, field) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${field} must be a non-empty string.`);
  }
  return value.trim();
}
function redactNetworkRequest(request) {
  if (!isRecord6(request)) return request;
  const content = isRecord6(request.content) ? { ...request.content, text: void 0 } : void 0;
  return {
    ...request,
    url: redactNetworkUrl(request.url),
    request: request.request ? redactNetworkMessage(request.request) : void 0,
    response: request.response ? redactNetworkMessage(request.response) : void 0,
    headers: request.headers ? redactHeaders(request.headers) : void 0,
    cookies: request.cookies ? REDACTED2 : void 0,
    body: void 0,
    postData: void 0,
    content
  };
}
function redactNetworkMessage(message) {
  if (!isRecord6(message)) return message;
  const content = isRecord6(message.content) ? { ...message.content, text: void 0 } : void 0;
  return {
    ...message,
    url: redactNetworkUrl(message.url),
    headers: message.headers ? redactHeaders(message.headers) : void 0,
    cookies: message.cookies ? REDACTED2 : void 0,
    body: void 0,
    postData: void 0,
    content
  };
}
function redactHeaders(headers) {
  if (Array.isArray(headers)) {
    return headers.map((header) => {
      if (!isRecord6(header)) return header;
      const name = String(header.name ?? "");
      return {
        ...header,
        value: /authorization|cookie|token|secret|api[-_]?key|password|set-cookie/i.test(name) ? REDACTED2 : header.value
      };
    });
  }
  if (!isRecord6(headers)) return headers;
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [
      key,
      /authorization|cookie|token|secret|api[-_]?key|password|set-cookie/i.test(key) ? REDACTED2 : value
    ])
  );
}
function redactNetworkUrl(url) {
  if (!url) return url;
  try {
    const parsed = new URL(String(url));
    for (const key of [...parsed.searchParams.keys()]) {
      if (/token|secret|key|password|auth|session|cookie/i.test(key))
        parsed.searchParams.set(key, REDACTED2);
    }
    parsed.username = parsed.username ? REDACTED2 : "";
    parsed.password = parsed.password ? REDACTED2 : "";
    return parsed.toString();
  } catch {
    return String(url).replace(
      /([?&][^=]*(token|secret|key|password|auth|session|cookie)[^=]*=)[^&]+/gi,
      `$1${REDACTED2}`
    );
  }
}
function redactHar(har) {
  if (!isRecord6(har)) return har;
  const copy = cloneJson(har);
  const entries = isRecord6(copy.log) ? copy.log.entries : void 0;
  if (Array.isArray(entries)) {
    for (const entry of entries) {
      if (!isRecord6(entry)) continue;
      if (entry.request) entry.request = redactNetworkMessage(entry.request);
      if (entry.response) entry.response = redactNetworkMessage(entry.response);
    }
  }
  return copy;
}
function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}
function isRecord6(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}
function parseUrlParts(url) {
  if (!url) return { origin: null, path: null };
  try {
    const parsed = new URL(url);
    return { origin: parsed.origin, path: `${parsed.pathname}${parsed.search}` };
  } catch {
    return { origin: null, path: url || null };
  }
}
function inferEndedAt(startedAt, durationMs) {
  if (!startedAt || typeof durationMs !== "number") return null;
  const started = Date.parse(startedAt);
  if (!Number.isFinite(started)) return null;
  return new Date(started + durationMs).toISOString();
}
function optionalString6(value) {
  return typeof value === "string" && value.length > 0 ? value : null;
}
function numberOrNull(value) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}
function normalizeInitiator(value) {
  if (!isRecord6(value)) return void 0;
  const out = {
    route: optionalString6(value.route),
    screen: optionalString6(value.screen),
    interactionId: optionalString6(value.interactionId),
    interactionName: optionalString6(value.interactionName),
    queryKey: optionalString6(value.queryKey),
    component: optionalString6(value.component),
    source: isRecord6(value.source) ? value.source : void 0
  };
  return Object.values(out).some((item) => item !== void 0 && item !== null) ? out : void 0;
}
var systemClock = {
  now: () => /* @__PURE__ */ new Date()
};
var defaultPath = {
  resolve: (filePath) => path12.resolve(filePath),
  join: (...segments) => path12.join(...segments),
  dirname: (filePath) => path12.dirname(filePath)
};
var defaultFileSystem = {
  mkdir: (filePath, options) => fs8.mkdir(filePath, options).then(() => void 0),
  writeJsonFile: (filePath, value) => fs8.writeFile(filePath, `${JSON.stringify(value, null, 2)}
`, "utf8")
};
function defaultResolveExpoStateRoot(args) {
  if (typeof args.stateDir === "string" && args.stateDir.length > 0) return args.stateDir;
  return ".scratch/expo98";
}

// src/commands/perf-evidence/src/main/actions.ts
import { mkdir as fsMkdir4, writeFile as fsWriteFile4 } from "node:fs/promises";
import { dirname as dirname6, join as join11, resolve as resolve11 } from "node:path";

// src/commands/perf-evidence/src/main/artifacts.ts
import { mkdir as fsMkdir3, readFile as readFile16 } from "node:fs/promises";
import { dirname as dirname5, join as join10, resolve as resolve10 } from "node:path";

// src/commands/perf-evidence/src/main/common.ts
import { basename as basename8, join as join9, resolve as resolve8 } from "node:path";
function resolveExpoStateRoot8(args = {}) {
  if (args.stateDir) {
    const resolved = resolve8(args.stateDir);
    return basename8(resolved) === "runs" ? resolve8(join9(resolved, "..")) : resolved;
  }
  const root = resolve8(args.root ?? args.cwd ?? process.cwd());
  return join9(root, ".scratch", "expo98");
}
function requireString17(value, name) {
  if (typeof value !== "string" || value.trim().length === 0)
    throw new Error(`${name} must be a non-empty string.`);
  return value.trim();
}
function requireOptionalString7(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}
function clampNumber17(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`Expected a finite number, got ${String(value)}.`);
  return Math.min(Math.max(number, min), max);
}
function firstPositional3(args) {
  return Array.isArray(args._) ? args._[0] : void 0;
}

// src/commands/perf-evidence/src/main/dependencies.ts
import { execFile as nodeExecFile8 } from "node:child_process";
import { readFile as readFile15, stat as fsStat, writeFile as fsWriteFile3 } from "node:fs/promises";
import { resolve as resolve9 } from "node:path";
async function projectCwd(cwd, deps) {
  if (deps.normalizeProjectCwd) {
    return Promise.resolve(deps.normalizeProjectCwd(cwd, { allowMissingPackageJson: true })).catch(
      () => resolve9(String(cwd ?? process.cwd()))
    );
  }
  return resolve9(String(cwd ?? process.cwd()));
}
async function projectSummary(cwd, deps) {
  return deps.expoProjectRuntimeSummary ? deps.expoProjectRuntimeSummary(cwd) : { projectRoot: cwd };
}
async function metroStatus2(args, deps) {
  return deps.metroStatusPayload ? deps.metroStatusPayload(args) : metroStatusPayload(args);
}
async function listMetroTargets(metroPort, deps) {
  return deps.metroTargets ? deps.metroTargets(metroPort) : metroTargets(metroPort);
}
async function evaluateHermes(url, expression, deps) {
  return deps.evaluateHermesExpression ? deps.evaluateHermesExpression(url, expression, { timeoutMs: 5e3 }) : evaluateHermesExpression(url, expression, {
    timeoutMs: 5e3
  });
}
async function findUpFile(cwd, name, deps) {
  return deps.findUp ? deps.findUp(cwd, name) : null;
}
async function readJson3(file, deps) {
  if (deps.readJsonFile) return deps.readJsonFile(file);
  return JSON.parse(await readFile15(file, "utf8"));
}
async function writeJsonFile6(file, value, deps) {
  await (deps.writeFile ?? fsWriteFile3)(file, `${JSON.stringify(value, null, 2)}
`, "utf8");
}
async function exists(path16, deps) {
  return deps.pathExists ? deps.pathExists(path16) : fsStat(path16).then(
    () => true,
    () => false
  );
}
async function fileStat(path16, deps) {
  return deps.stat ? deps.stat(path16) : fsStat(path16).catch(() => null);
}
function execFile6(file, argv, options) {
  return new Promise((resolveExec) => {
    nodeExecFile8(
      file,
      argv,
      { timeout: options.timeout, maxBuffer: 4 * 1024 * 1024 },
      (error, stdout, stderr) => {
        resolveExec({
          stdout: String(stdout ?? ""),
          stderr: String(stderr ?? ""),
          error: error ? { message: error.message, code: error.code, signal: error.signal } : null
        });
      }
    );
  });
}

// src/commands/perf-evidence/src/main/artifacts.ts
async function writePerfArtifact(args, action, payload, deps = {}) {
  const timestamp = (deps.now?.() ?? /* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-");
  const artifactPath = resolve10(
    args.outputPath ?? join10(resolveExpoStateRoot8(args), "artifacts", "perf", `${action}-${timestamp}.json`)
  );
  await (deps.mkdir ?? fsMkdir3)(dirname5(artifactPath), { recursive: true });
  const withArtifact = { ...payload, artifacts: [...payload.artifacts ?? [], artifactPath] };
  await writeJsonFile6(artifactPath, withArtifact, deps);
  return withArtifact;
}
async function parseNativeSampleArtifact(file) {
  const text = await readFile16(file, "utf8").catch(() => null);
  if (!text)
    return {
      available: false,
      artifact: file,
      reason: "Native sample artifact was not found or unreadable."
    };
  const physicalFootprintMb = numberFromMatch(text, /Physical footprint:\s+([0-9.]+)M/);
  const peakFootprintMb = numberFromMatch(text, /Physical footprint \(peak\):\s+([0-9.]+)M/);
  const mainThreadSamples = numberFromMatch(
    text,
    /Call graph:\s*\n\s+(\d+)\s+Thread_[^:\n]+:\s+Main Thread/s
  );
  const idleSamples = countSampleBucket(text, [/mach_msg/i, /CFRunLoopServiceMachPort/i]);
  const buckets = {
    hermes: countSampleBucket(text, [/hermes/i]),
    yoga: countSampleBucket(text, [/yoga/i]),
    mounting: countSampleBucket(text, [/RCTMountingManager/i, /RCTPerformMountInstructions/i]),
    coreAnimation: countSampleBucket(text, [/QuartzCore/i, /CA::Layer/i, /CoreAnimation/i]),
    uiKit: countSampleBucket(text, [/UIKitCore/i])
  };
  const topSymbols = [...text.matchAll(/^\s*([0-9]+)\s+(.+?)\s+\(in\s+(.+?)\)/gm)].slice(0, 30).map((match) => ({
    samples: Number(match[1]),
    symbol: match[2].trim(),
    library: match[3].trim()
  }));
  return {
    available: Boolean(physicalFootprintMb || peakFootprintMb || topSymbols.length),
    artifact: file,
    bytes: Buffer.byteLength(text),
    physicalFootprintMb,
    peakFootprintMb,
    mainThreadSamples,
    estimatedMainThreadIdleSamples: idleSamples,
    estimatedMainThreadBusySamples: mainThreadSamples == null ? null : Math.max(0, mainThreadSamples - idleSamples),
    buckets,
    topSymbols
  };
}
function numberFromMatch(text, pattern) {
  const match = pattern.exec(text);
  return match ? Number(match[1]) : null;
}
function countSampleBucket(text, patterns) {
  let count = 0;
  for (const line of text.split(/\r?\n/)) {
    if (!patterns.some((pattern) => pattern.test(line))) continue;
    const match = /^\s*[+!:| ]*\s*(\d+)\s+/.exec(line);
    count += match ? Number(match[1]) : 1;
  }
  return count;
}

// src/commands/perf-evidence/src/main/redaction.ts
function redactPerfValue(value) {
  if (Array.isArray(value)) return value.map(redactPerfValue);
  if (!value || typeof value !== "object") return value;
  const result = {};
  for (const [key, item] of Object.entries(value)) {
    if (/body|postData/i.test(key)) continue;
    result[key] = /token|authorization|cookie|password|secret|apikey/i.test(key) ? "[redacted]" : redactPerfValue(item);
  }
  return result;
}

// src/commands/perf-evidence/src/main/model.ts
function metricMap(metrics) {
  if (!Array.isArray(metrics)) return /* @__PURE__ */ new Map();
  return new Map(
    metrics.map((metric) => {
      const record = metric && typeof metric === "object" && !Array.isArray(metric) ? metric : {};
      const normalized = perfMetric(record);
      return [normalized.name, normalized];
    })
  );
}
function lowerConfidence(left, right) {
  const order = ["low", "medium", "high"];
  const leftIndex = order.indexOf(normalizeConfidence(left));
  const rightIndex = order.indexOf(normalizeConfidence(right));
  return order[Math.min(leftIndex === -1 ? 0 : leftIndex, rightIndex === -1 ? 0 : rightIndex)];
}
function normalizePerfBridgePayload(value, action) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      available: false,
      action,
      sources: ["runtime"],
      source: "runtime",
      code: "malformed-payload",
      reason: "Performance runtime returned a malformed payload.",
      metrics: []
    };
  }
  if (value.metrics !== void 0 && !Array.isArray(value.metrics)) {
    return {
      ...value,
      available: false,
      action,
      code: "malformed-payload",
      reason: "Performance runtime returned malformed metrics.",
      metrics: []
    };
  }
  const metrics = (value.metrics ?? []).map(
    (metric) => perfMetric({
      name: metric.name,
      value: metric.value,
      unit: metric.unit,
      source: metric.source ?? value.source ?? value.sources?.[0] ?? "runtime",
      confidence: metric.confidence ?? value.confidence ?? "medium"
    })
  );
  return { ...value, action, metrics };
}
function normalizePerfReport(runtimePayload, nativeSummary) {
  const runtime2 = normalizeRuntimePayload(runtimePayload);
  const requests = runtimeNetworkRequests(runtime2);
  const renders = runtimeRenderCommits(runtime2);
  const frames = runtimeFrameSamples(runtime2);
  const findings = [];
  const slowRequests = requests.filter((request) => Number(request.durationMs) >= 500).sort((a, b) => Number(b.durationMs ?? 0) - Number(a.durationMs ?? 0));
  if (slowRequests[0]) {
    findings.push({
      type: "network-latency",
      severity: Number(slowRequests[0].durationMs) >= 1e3 ? "high" : "medium",
      summary: `Slow network request: ${slowRequests[0].method ?? "GET"} ${slowRequests[0].url ?? ""}`,
      evidence: { durationMs: slowRequests[0].durationMs, status: slowRequests[0].status ?? null }
    });
  }
  const worstCommit = renders.reduce(
    (worst, commit) => Number(commit.durationMs ?? commit.actualDuration ?? 0) > Number(worst?.durationMs ?? worst?.actualDuration ?? 0) ? commit : worst,
    null
  );
  if (worstCommit && Number(worstCommit.durationMs ?? worstCommit.actualDuration ?? 0) >= 16.7) {
    findings.push({
      type: "render-cost",
      severity: Number(worstCommit.durationMs ?? worstCommit.actualDuration ?? 0) >= 50 ? "high" : "medium",
      summary: "React render commit exceeded one frame budget.",
      evidence: worstCommit
    });
  }
  const droppedFrames = Number(
    runtime2?.frames?.droppedFrameCount ?? frames.filter((frame) => Number(frame.deltaMs) > 33.4).length
  );
  if (droppedFrames > 0) {
    findings.push({
      type: "frame-jank",
      severity: droppedFrames >= 5 ? "high" : "medium",
      summary: "Frame samples include dropped or long frames.",
      evidence: {
        droppedFrameCount: droppedFrames,
        worstFrameMs: runtime2?.frames?.worstFrameMs ?? null
      }
    });
  }
  if (nativeSummary?.available) {
    findings.push({
      type: "native-sample",
      severity: "info",
      summary: "Native sample artifact was parsed.",
      evidence: {
        physicalFootprintMb: nativeSummary.physicalFootprintMb,
        peakFootprintMb: nativeSummary.peakFootprintMb,
        topBuckets: nativeSummary.buckets
      }
    });
  }
  const metrics = [
    perfMetric({
      name: "network.requests",
      value: requests.length,
      unit: "count",
      source: "network",
      confidence: requests.length ? "medium" : "low"
    }),
    perfMetric({
      name: "renders.commits",
      value: renders.length,
      unit: "count",
      source: "react-profiler",
      confidence: renders.length ? "medium" : "low"
    }),
    perfMetric({
      name: "frames.samples",
      value: frames.length,
      unit: "count",
      source: "frame-sampler",
      confidence: frames.length ? "medium" : "low"
    }),
    ...nativeSummary?.available ? [
      perfMetric({
        name: "native.sample.bytes",
        value: nativeSummary.bytes,
        unit: "bytes",
        source: "native-profiler",
        confidence: "medium"
      })
    ] : []
  ];
  return {
    available: Boolean(runtime2 || nativeSummary?.available),
    sources: [
      ...runtime2 ? ["runtime"] : [],
      ...requests.length ? ["network"] : [],
      ...renders.length ? ["react-profiler"] : [],
      ...frames.length ? ["frame-sampler"] : [],
      ...nativeSummary?.available ? ["native-profiler"] : []
    ],
    runtime: runtime2,
    findings: findings.length ? findings : [
      {
        type: "insufficient-evidence",
        severity: "info",
        summary: "No bottleneck can be ranked from the available evidence."
      }
    ],
    metrics,
    confidence: perfOverallConfidence(metrics),
    limitations: [
      ...!renders.length ? ["Render cost is unavailable because no React Profiler commit records were returned."] : [],
      ...!frames.length ? ["Frame jank is unavailable because no frame samples were returned."] : [],
      ...!requests.length ? ["Network attribution is unavailable because no request rows were returned."] : []
    ]
  };
}
function normalizeRuntimePayload(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? redactPerfValue(value) : null;
}
function runtimeNetworkRequests(runtime2) {
  return Array.isArray(runtime2?.network?.requests) ? runtime2.network.requests : [];
}
function runtimeRenderCommits(runtime2) {
  return Array.isArray(runtime2?.renders?.commits) ? runtime2.renders.commits : [];
}
function runtimeFrameSamples(runtime2) {
  return Array.isArray(runtime2?.frames?.samples) ? runtime2.frames.samples : [];
}
function perfEvidenceSource(value) {
  if (typeof value?.source === "string") return value.source;
  if (Array.isArray(value?.sources) && value.sources.length > 0) return value.sources[0];
  return "unknown";
}
function perfTransport(metroPort, target, cdp = null) {
  return {
    name: "metro-inspector-hermes-cdp",
    metroPort,
    protocol: "Runtime.evaluate",
    target: targetSummary8(target),
    cdp
  };
}
async function perfContext({
  args,
  projectRoot,
  metro,
  target = null
}) {
  const buildMode = normalizePerfBuildKind(args.buildKind);
  return {
    projectRoot,
    build: {
      mode: buildMode,
      releaseLike: ["preview", "release-export", "production"].includes(buildMode)
    },
    platform: args.platform ?? "ios",
    device: target?.deviceName ?? null,
    metro: metro ? {
      port: metro.metroPort ?? args.metroPort ?? 8081,
      status: metro.available ? "available" : "unavailable",
      targetCount: metro.targetCount ?? 0,
      devMode: buildMode === "development" ? true : null
    } : {
      port: args.metroPort ?? 8081,
      status: "not-measured",
      targetCount: 0,
      devMode: buildMode === "development" ? true : null
    },
    coldStart: null,
    samples: 1
  };
}
function normalizePerfBuildKind(value) {
  const buildKind = requireOptionalString7(value) ?? "development";
  if (buildKind === "production") return "production";
  if (["development", "dev-build", "preview", "release-export", "unknown"].includes(buildKind))
    return buildKind;
  throw new Error(`Unknown performance build kind: ${buildKind}`);
}
function perfMetric({
  name,
  value,
  unit,
  source,
  confidence
}) {
  return {
    name: String(name),
    value,
    unit: unit == null ? null : String(unit),
    source: typeof source === "string" && source ? source : "unknown",
    confidence: confidence === "high" || confidence === "medium" || confidence === "low" ? confidence : "low"
  };
}
function perfOverallConfidence(metrics) {
  if (!metrics.length) return "low";
  if (metrics.some((metric) => metric.confidence === "high")) return "high";
  if (metrics.some((metric) => metric.confidence === "medium")) return "medium";
  return "low";
}
function normalizeConfidence(value) {
  return value === "high" || value === "medium" || value === "low" ? value : "low";
}
function perfDevelopmentLimitations(extra = []) {
  return [
    ...extra.map(String),
    "Development-mode measurements include Metro, dev runtime, and instrumentation overhead and must not be generalized to release performance."
  ];
}
function targetSummary8(target) {
  if (!target) return null;
  return {
    id: target.id ?? null,
    title: target.title ?? null,
    description: target.description ?? null,
    appId: target.appId ?? null,
    deviceName: target.deviceName ?? null,
    devtoolsFrontendUrl: target.devtoolsFrontendUrl ?? null,
    webSocketDebuggerUrl: target.webSocketDebuggerUrl ?? null,
    reactNative: target.reactNative ?? null,
    capabilities: target.capabilities ?? {
      hermesRuntime: typeof target.webSocketDebuggerUrl === "string" && target.webSocketDebuggerUrl.startsWith("ws"),
      devtoolsFrontend: typeof target.devtoolsFrontendUrl === "string" && target.devtoolsFrontendUrl.length > 0,
      reactNative: Boolean(target.reactNative)
    }
  };
}

// src/commands/perf-evidence/src/main/types.ts
var EXPO98_BRIDGE_VERSION5 = "1.0.0";
var PERF_ACTIONS = [
  "summary",
  "startup",
  "action",
  "bundle",
  "mark",
  "measure",
  "compare",
  "budget",
  "js-thread",
  "frames",
  "memory",
  "ettrace",
  "memgraph",
  "interaction",
  "report"
];

// src/commands/perf-evidence/src/main/validation.ts
function perfValidation(payload, action) {
  const metrics = Array.isArray(payload.metrics) ? payload.metrics : [];
  const hasNetwork = metrics.some((metric) => /network/i.test(String(metric.name)) && Number(metric.value) > 0) || Array.isArray(payload.requests) && payload.requests.length > 0 || Array.isArray(payload.runtime?.network?.requests) && payload.runtime.network.requests.length > 0;
  const hasRender = metrics.some(
    (metric) => /commit|render/i.test(String(metric.name)) && Number(metric.value) > 0
  ) || Array.isArray(payload.renders?.commits) && payload.renders.commits.length > 0 || Array.isArray(payload.runtime?.renders?.commits) && payload.runtime.renders.commits.length > 0;
  const hasFrames = metrics.some(
    (metric) => /frame/i.test(String(metric.name)) && Number(metric.value) > 0 && !/available/.test(String(metric.name))
  ) || Array.isArray(payload.frames?.samples) && payload.frames.samples.length > 0 || Array.isArray(payload.runtime?.frames?.samples) && payload.runtime.frames.samples.length > 0;
  const hasNativeArtifact = Boolean(payload.nativeSummary?.available);
  const hasNative = hasNativeArtifact && Boolean(payload.pid && payload.seconds);
  const releaseLike = payload.context?.build?.releaseLike === true;
  const placeholderMetric = metrics.some(
    (metric) => /available$|bridge\.available|interaction\.duration/.test(String(metric.name)) && Number(metric.value) <= 1
  );
  const missingEvidence = [
    ...!hasNetwork && ["interaction", "report"].includes(action) ? [
      {
        signal: "network-interaction-correlation",
        reason: "No interaction-scoped network request evidence was returned.",
        recommendedFix: "Run network requests after a real interaction or mount the metadata network bridge."
      }
    ] : [],
    ...!hasRender && ["interaction", "report", "action"].includes(action) ? [
      {
        signal: "react-profiler-commits",
        reason: "No React Profiler commit duration records were returned.",
        recommendedFix: "Mount the dev-only Profiler wrapper or run rn renders start/read/stop with bridge commit records."
      }
    ] : [],
    ...!hasFrames && ["frames", "interaction", "report"].includes(action) ? [
      {
        signal: "frame-samples",
        reason: "No requestAnimationFrame delta samples were returned.",
        recommendedFix: "Start frame sampling before exercising the interaction and rerun perf frames/report."
      }
    ] : [],
    ...!hasNative && ["ettrace", "report"].includes(action) ? [
      {
        signal: "native-sample-summary",
        reason: hasNativeArtifact ? "Native sample artifact was parsed, but PID and sample duration were not attached to this evidence." : "No parseable native sample artifact was available.",
        recommendedFix: "Run profiler start with --pid, --seconds, and --native-artifact, then pass that artifact to perf report."
      }
    ] : [],
    ...!releaseLike ? [
      {
        signal: "release-like-build",
        reason: "This evidence was collected in development mode.",
        recommendedFix: "Repeat the profile against a preview or production build before making release performance claims."
      }
    ] : []
  ];
  const validated = payload.available !== false && !placeholderMetric && (action === "summary" || action === "startup" || action === "memory" || action === "bundle" || action === "compare" || action === "budget" || action === "ettrace" && hasNative || action === "frames" && hasFrames || action === "report" && (hasNetwork || hasRender || hasFrames || hasNativeArtifact) || action === "interaction" && (hasNetwork || hasRender || hasFrames));
  return realValidation({
    state: payload.available === false ? "unvalidated" : validated ? "validated" : "partial",
    claimsAllowed: {
      networkLatency: hasNetwork,
      networkWaterfall: hasNetwork,
      renderCost: hasRender,
      frameJank: hasFrames,
      nativeCpu: hasNative,
      releasePerformance: releaseLike && (hasNetwork || hasRender || hasFrames || hasNative)
    },
    evidence: [
      {
        source: perfEvidenceSource(payload),
        artifactPath: Array.isArray(payload.artifacts) ? payload.artifacts[0] : null,
        command: `perf.${action}`,
        timestamp: (/* @__PURE__ */ new Date()).toISOString(),
        buildKind: payload.context?.build?.mode ?? payload.mode ?? "development",
        confidence: payload.confidence ?? perfOverallConfidence(metrics)
      }
    ],
    missingEvidence
  });
}

// src/commands/perf-evidence/src/main/runtime-bridge.ts
async function collectRuntimeBridgeEvidence(args, deps, expression) {
  const metroPort = clampNumber17(args.metroPort ?? 8081, 1, 65535);
  const targets = await listMetroTargets(metroPort, deps);
  const target = targets[0] ?? null;
  const projectRoot = await projectCwd(args.cwd, deps);
  const metro = target ? {
    available: true,
    metroPort,
    status: "available",
    statusText: null,
    targetCount: targets.length,
    targets: targets.map(targetSummary8)
  } : await metroStatus2({ metroPort }, deps);
  let bridgePayload = null;
  let diagnostics = null;
  if (target?.webSocketDebuggerUrl) {
    const result = await evaluateHermes(
      String(target.webSocketDebuggerUrl),
      perfExpression(expression),
      deps
    );
    bridgePayload = result?.result?.result?.value ?? null;
    diagnostics = result?.diagnostics ?? null;
  }
  return { metroPort, targets, target, projectRoot, metro, bridgePayload, diagnostics };
}
async function writeRuntimePerfArtifact(args, deps, options) {
  const evidence = await collectRuntimeBridgeEvidence(args, deps, {
    action: options.bridgeAction,
    label: options.label
  });
  const basePayload = evidence.bridgePayload && typeof evidence.bridgePayload === "object" ? normalizePerfBridgePayload(redactPerfValue(evidence.bridgePayload), options.normalizeAction) : {
    available: false,
    sources: ["runtime", "app-instrumentation"],
    metrics: [],
    code: evidence.target ? "malformed-payload" : "no-runtime-target",
    reason: evidence.target ? options.unavailableReason ?? "Performance bridge did not return a value." : "No Metro inspector target."
  };
  const payload = {
    ...basePayload,
    action: options.artifactAction,
    ...options.extraFields?.(basePayload, evidence) ?? {},
    mode: "development",
    context: await perfContext({
      args,
      projectRoot: evidence.projectRoot,
      metro: evidence.metro,
      target: evidence.target
    }),
    transport: perfTransport(evidence.metroPort, evidence.target, evidence.diagnostics),
    evidenceSource: perfEvidenceSource(basePayload),
    confidence: perfOverallConfidence(basePayload.metrics ?? []),
    limitations: perfDevelopmentLimitations(basePayload.limitations)
  };
  return writePerfArtifact(
    args,
    options.artifactAction,
    { ...payload, realValidation: perfValidation(payload, options.artifactAction) },
    deps
  );
}
function perfBridgeAction(action, subaction) {
  if (action === "mark") return `mark-${subaction ?? "list"}`;
  if (action === "measure") return `measure-${subaction ?? "start"}`;
  if (action === "interaction") return `interaction-${subaction ?? "read"}`;
  return action;
}
function perfExpression({ action, label }) {
  return runtimeProgram([
    perfRuntimeInputs(action, label),
    perfPluginBridgeSection(),
    perfExpoDevtoolsSection(),
    perfInstrumentationSetupSection(),
    perfInteractionSection(),
    perfActionDispatchSection()
  ]);
}
function runtimeProgram(sections) {
  return `(() => {
${sections.join("\n")}
  })()`;
}
function perfRuntimeInputs(action, label) {
  return `    const action = ${JSON.stringify(action)};
    const label = ${JSON.stringify(label ?? null)};
    const expectedBridgeVersion = ${JSON.stringify(EXPO98_BRIDGE_VERSION5)};`;
}
function perfPluginBridgeSection() {
  return `    const pluginBridge = globalThis.__EXPO98_DEVTOOLS_BRIDGE__ ||
      globalThis.__EXPO_IOS_DEVTOOLS_BRIDGE__ ||
      globalThis.__EXPO98_PLUGIN_BRIDGE__ ||
      globalThis.__EXPO_IOS_PLUGIN_BRIDGE__ ||
      globalThis.__ROZENITE_AGENT_BRIDGE__;
    const pluginMetadata = pluginBridge?.metadata || pluginBridge?.expo98DevtoolsBridgeMetadata || pluginBridge?.expoIosDevtoolsBridgeMetadata || pluginBridge?.bridgeMetadata || {};
    const pluginVersion = pluginMetadata.bridgeVersion || pluginBridge?.bridgeVersion || pluginBridge?.version || null;
    const pluginPerf = pluginBridge?.performance ||
      pluginBridge?.perf ||
      (pluginBridge?.domains && !Array.isArray(pluginBridge.domains) ? (pluginBridge.domains.performance || pluginBridge.domains.perf) : null) ||
      (pluginBridge?.domainRegistry ? (pluginBridge.domainRegistry.performance || pluginBridge.domainRegistry.perf) : null);
    const pluginCallTool = typeof pluginBridge?.callTool === 'function' ? pluginBridge.callTool.bind(pluginBridge) : null;
    const callPerf = (command, payload = {}) => {
      if (pluginPerf && typeof pluginPerf[command] === 'function') return pluginPerf[command](payload);
      if (pluginPerf && pluginPerf.actions && typeof pluginPerf.actions[command] === 'function') return pluginPerf.actions[command](payload);
      if (pluginCallTool) return pluginCallTool('performance.' + command, payload);
      return null;
    };
    const hasPluginPerf = Boolean(pluginPerf || pluginCallTool || (Array.isArray(pluginBridge?.domains) && pluginBridge.domains.some((domain) => domain?.name === 'performance' || domain?.name === 'perf')));
    if (hasPluginPerf) {
      if (pluginVersion && pluginVersion !== expectedBridgeVersion) {
        return { available: false, source: 'plugin-bridge-performance', sources: ['plugin-bridge', 'rozenite-performance'], code: 'version-mismatch', bridgeVersion: pluginVersion, expectedBridgeVersion, reason: 'Performance plugin bridge version is not compatible with this CLI.', metrics: [] };
      }
      if (action === 'mark-list') return callPerf('mark-list', { label }) || callPerf('marks', { label }) || { available: true, source: 'plugin-bridge-performance', sources: ['plugin-bridge', 'rozenite-performance'], marks: pluginPerf?.marks || [], metrics: [] };
      if (action === 'mark-clear') return callPerf('mark-clear', { label }) || { available: true, source: 'plugin-bridge-performance', sources: ['plugin-bridge', 'rozenite-performance'], cleared: true, metrics: [] };
      if (action === 'measure-start') return callPerf('measure-start', { label }) || { available: true, source: 'plugin-bridge-performance', sources: ['plugin-bridge', 'rozenite-performance'], measure: { name: label, status: 'started' }, metrics: [] };
      if (action === 'measure-stop') return callPerf('measure-stop', { label }) || { available: true, source: 'plugin-bridge-performance', sources: ['plugin-bridge', 'rozenite-performance'], measure: { name: label, status: 'stopped' }, metrics: [] };
      if (action === 'js-thread') return callPerf('js-thread', { label }) || { available: false, source: 'plugin-bridge-performance', sources: ['plugin-bridge', 'rozenite-performance'], code: 'missing-metric', reason: 'JS thread evidence is not exposed by the performance plugin bridge.', metrics: [] };
      if (action === 'frames') return callPerf('frames', { label }) || { available: false, source: 'plugin-bridge-performance', sources: ['plugin-bridge', 'rozenite-performance'], code: 'missing-metric', reason: 'Frame evidence is not exposed by the performance plugin bridge.', metrics: [] };
      if (action === 'startup') return callPerf('startup', { label }) || { available: true, source: 'plugin-bridge-performance', sources: ['plugin-bridge', 'rozenite-performance'], metrics: pluginPerf?.startupMetrics || [] };
      if (action === 'action') return callPerf('action', { label }) || { available: true, source: 'plugin-bridge-performance', sources: ['plugin-bridge', 'rozenite-performance'], actionName: label, metrics: pluginPerf?.actionMetrics || [] };
    } else if (pluginBridge) {
      return { available: false, source: 'plugin-bridge-performance', sources: ['plugin-bridge'], code: 'missing-domain', reason: 'Performance bridge domain is not registered.', metrics: [] };
    }`;
}
function perfExpoDevtoolsSection() {
  return `    const expoDevtoolsPerf = globalThis.__EXPO_DEVTOOLS_PERFORMANCE__ || globalThis.__REACT_NATIVE_DEVTOOLS_PERFORMANCE__;
    if (expoDevtoolsPerf && typeof expoDevtoolsPerf === 'object') {
      const call = (command, payload = {}) => typeof expoDevtoolsPerf[command] === 'function' ? expoDevtoolsPerf[command](payload) : null;
      if (action === 'startup') return call('startup', { label }) || { available: true, source: 'expo-devtools-performance', sources: ['expo-devtools'], metrics: expoDevtoolsPerf.startupMetrics || [] };
      if (action === 'action') return call('action', { label }) || { available: true, source: 'expo-devtools-performance', sources: ['expo-devtools'], actionName: label, metrics: expoDevtoolsPerf.actionMetrics || [] };
      if (action === 'mark-list') return call('marks', { label }) || { available: true, source: 'expo-devtools-performance', sources: ['expo-devtools'], marks: expoDevtoolsPerf.marks || [], metrics: [] };
    }`;
}
function perfInstrumentationSetupSection() {
  return `    const bridge = globalThis.__EXPO98_PERF_BRIDGE__ ||
      globalThis.__EXPO_IOS_PERF_BRIDGE__ ||
      (globalThis.__EXPO98_INSTRUMENTATION__?.performance || globalThis.__EXPO_IOS_INSTRUMENTATION__?.performance);
    const networkBridge = globalThis.__EXPO98_NETWORK_BRIDGE__ ||
      globalThis.__EXPO_IOS_NETWORK_BRIDGE__ ||
      (globalThis.__EXPO98_INSTRUMENTATION__?.network || globalThis.__EXPO_IOS_INSTRUMENTATION__?.network);
    const rnBridge = globalThis.__EXPO98_RN_BRIDGE__ ||
      globalThis.__EXPO_IOS_RN_BRIDGE__ ||
      (globalThis.__EXPO98_INSTRUMENTATION__?.rn || globalThis.__EXPO_IOS_INSTRUMENTATION__?.rn);
    const perfState = globalThis.__EXPO98_PERF_STATE__ ||= { interactions: {}, frames: [], lastFrameTs: null };
    const readRequests = () => {
      try {
        const raw = networkBridge && typeof networkBridge.requests === 'function' ? networkBridge.requests({ limit: 1000 }) : networkBridge?.requests || [];
        return Array.isArray(raw) ? raw : [];
      } catch { return []; }
    };
    const readRenders = () => {
      try {
        if (bridge?.renders?.read) return bridge.renders.read();
        if (rnBridge?.renders?.read) return rnBridge.renders.read();
        return { commits: bridge?.commits || [], recording: false };
      } catch { return { commits: [], recording: false }; }
    };
    const startRenders = () => {
      try {
        if (bridge?.renders?.start) return bridge.renders.start();
        if (rnBridge?.renders?.start) return rnBridge.renders.start();
      } catch {}
      return null;
    };
    const stopRenders = () => {
      try {
        if (bridge?.renders?.stop) return bridge.renders.stop();
        if (rnBridge?.renders?.stop) return rnBridge.renders.stop();
      } catch {}
      return null;
    };
    const readFrames = () => {
      try {
        if (bridge?.frames) {
          const value = typeof bridge.frames === 'function' ? bridge.frames() : bridge.frames;
          if (value && typeof value === 'object' && Array.isArray(value.samples)) return value;
        }
      } catch {}
      const samples = Array.isArray(perfState.frames) ? perfState.frames.slice(-300) : [];
      const deltas = samples.map((sample) => Number(sample.deltaMs)).filter(Number.isFinite);
      const droppedFrameCount = deltas.filter((delta) => delta > 33.4).length;
      return {
        available: samples.length > 0,
        source: 'frame-sampler',
        samples,
        sampleCount: samples.length,
        avgFps: deltas.length ? Math.round((1000 / (deltas.reduce((sum, value) => sum + value, 0) / deltas.length)) * 10) / 10 : null,
        worstFrameMs: deltas.length ? Math.max(...deltas) : null,
        droppedFrameCount,
        longFrameCount: deltas.filter((delta) => delta > 16.7).length
      };
    };
    if (typeof globalThis.requestAnimationFrame === 'function' && !perfState.rafPatched) {
      perfState.rafPatched = true;
      const originalRaf = globalThis.requestAnimationFrame.bind(globalThis);
      globalThis.requestAnimationFrame = (callback) => originalRaf((ts) => {
        if (perfState.lastFrameTs != null) {
          perfState.frames.push({ t: ts, deltaMs: Math.round((ts - perfState.lastFrameTs) * 10) / 10, interactionId: perfState.activeInteractionId || null });
          if (perfState.frames.length > 1000) perfState.frames.splice(0, perfState.frames.length - 1000);
        }
        perfState.lastFrameTs = ts;
        callback(ts);
      });
    }
    const interactionSummary = (name) => {
      const requests = readRequests();
      const renders = readRenders();
      const frames = readFrames();
      const commits = Array.isArray(renders?.commits) ? renders.commits : [];
      const networkDurationMs = requests.reduce((sum, request) => sum + (Number(request.durationMs) || 0), 0);
      const worstCommitMs = commits.reduce((max, commit) => Math.max(max, Number(commit.durationMs ?? commit.actualDuration) || 0), 0);
      const lastRequestEnd = requests.reduce((max, request) => {
        const start = Date.parse(request.startedAt || 0);
        const duration = Number(request.durationMs) || 0;
        return Number.isFinite(start) ? Math.max(max, start + duration) : max;
      }, 0);
      return { requests, renders, frames, networkDurationMs, worstCommitMs, lastRequestEnd, name };
    };`;
}
function perfInteractionSection() {
  return `    if (action === 'interaction-start') {
      const name = label || 'interaction';
      const id = 'interaction-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
      startRenders();
      perfState.activeInteractionId = id;
      perfState.interactions[name] = {
        id,
        name,
        startedAt: new Date().toISOString(),
        startedMs: Date.now(),
        baseline: {
          requestCount: readRequests().length,
          commitCount: (readRenders()?.commits || []).length,
          frameCount: readFrames().samples?.length || 0
        }
      };
      return { available: true, source: 'app-instrumentation', sources: ['runtime', 'app-instrumentation'], interaction: perfState.interactions[name], metrics: [] };
    }
    if (action === 'interaction-stop' || action === 'interaction-read') {
      const name = label || Object.keys(perfState.interactions).slice(-1)[0] || 'interaction';
      const interaction = perfState.interactions[name] || null;
      const summary = interactionSummary(name);
      const elapsedMs = interaction ? Date.now() - interaction.startedMs : 0;
      if (interaction && action === 'interaction-stop') {
        interaction.stoppedAt = new Date().toISOString();
        interaction.elapsedMs = elapsedMs;
        perfState.activeInteractionId = null;
        stopRenders();
      }
      const baseline = interaction?.baseline || { requestCount: 0, commitCount: 0, frameCount: 0 };
      const interactionRequests = summary.requests.slice(baseline.requestCount || 0);
      const interactionCommits = (summary.renders?.commits || []).slice(baseline.commitCount || 0);
      const interactionFrames = (summary.frames?.samples || []).slice(baseline.frameCount || 0);
      const networkDurationMs = interactionRequests.reduce((sum, request) => sum + (Number(request.durationMs) || 0), 0);
      const worstCommitMs = interactionCommits.reduce((max, commit) => Math.max(max, Number(commit.durationMs ?? commit.actualDuration) || 0), 0);
      const worstFrameMs = interactionFrames.reduce((max, frame) => Math.max(max, Number(frame.deltaMs) || 0), 0);
      const lastRequestEnd = interactionRequests.reduce((max, request) => {
        const start = Date.parse(request.startedAt || 0);
        const duration = Number(request.durationMs) || 0;
        return Number.isFinite(start) ? Math.max(max, start + duration) : max;
      }, 0);
      return {
        available: Boolean(interaction),
        source: 'app-instrumentation',
        sources: ['runtime', 'app-instrumentation'],
        interaction: { ...interaction, name, elapsedMs },
        requests: interactionRequests,
        renders: { commits: interactionCommits },
        frames: { samples: interactionFrames, worstFrameMs, droppedFrameCount: interactionFrames.filter((frame) => Number(frame.deltaMs) > 33.4).length },
        metrics: [
          { name: 'interaction.elapsed', value: elapsedMs, unit: 'ms', source: 'app-performance-mark', confidence: interaction ? 'medium' : 'low' },
          { name: 'interaction.networkDuration', value: networkDurationMs, unit: 'ms', source: 'network', confidence: interactionRequests.length ? 'medium' : 'low' },
          { name: 'interaction.commitCount', value: interactionCommits.length, unit: 'count', source: 'react-profiler', confidence: interactionCommits.length ? 'medium' : 'low' },
          { name: 'interaction.worstCommit', value: worstCommitMs, unit: 'ms', source: 'react-profiler', confidence: interactionCommits.length ? 'medium' : 'low' },
          { name: 'interaction.worstFrame', value: worstFrameMs, unit: 'ms', source: 'frame-sampler', confidence: interactionFrames.length ? 'medium' : 'low' },
          { name: 'interaction.settledAfterResponse', value: lastRequestEnd && interaction ? Math.max(0, Date.now() - lastRequestEnd) : 0, unit: 'ms', source: 'correlation', confidence: 'low' }
        ]
      };
    }
    if (action === 'report') {
      const requests = readRequests();
      const renders = readRenders();
      const frames = readFrames();
      return {
        available: true,
        source: 'app-instrumentation',
        sources: ['runtime', 'app-instrumentation'],
        interaction: label || perfState.activeInteractionId || null,
        network: { requests },
        renders,
        frames,
        jsThread: bridge?.jsThread ? bridge.jsThread() : { available: false, reason: 'JS thread long-task evidence is not exposed.' },
        interactions: perfState.interactions,
        metrics: []
      };
    }`;
}
function perfActionDispatchSection() {
  return `    if (!bridge) return { available: false, source: 'app-instrumentation', sources: ['runtime', 'app-instrumentation'], code: 'unavailable-bridge', reason: 'Performance bridge is not installed.', metrics: [] };
    if (action === 'mark-list') return bridge.marks ? bridge.marks() : { available: true, sources: ['runtime', 'app-instrumentation'], marks: performance.getEntriesByType ? performance.getEntriesByType('mark') : [], metrics: [] };
    if (action === 'mark-clear') return bridge.clearMarks ? bridge.clearMarks() : { available: true, sources: ['runtime', 'app-instrumentation'], cleared: true, metrics: [] };
    if (action === 'measure-start') return bridge.measureStart ? bridge.measureStart(label) : { available: true, sources: ['runtime', 'app-instrumentation'], measure: { name: label, status: 'started' }, metrics: [] };
    if (action === 'measure-stop') return bridge.measureStop ? bridge.measureStop(label) : { available: true, sources: ['runtime', 'app-instrumentation'], measure: { name: label, status: 'stopped' }, metrics: [] };
    if (action === 'js-thread') return bridge.jsThread ? bridge.jsThread() : { available: false, sources: ['runtime', 'app-instrumentation'], reason: 'JS thread evidence is not exposed by the performance bridge.', metrics: [] };
    if (action === 'frames') return bridge.frames ? bridge.frames() : { available: false, sources: ['runtime', 'app-instrumentation'], reason: 'Frame evidence is not exposed by the performance bridge.', metrics: [] };
    if (action === 'startup') return bridge.startup ? bridge.startup() : { available: true, sources: ['runtime', 'app-instrumentation'], metrics: bridge.startupMetrics || [] };
    if (action === 'action') return bridge.action ? bridge.action(label) : { available: false, sources: ['runtime', 'app-instrumentation'], actionName: label, code: 'missing-interaction-measurement', reason: 'Performance action requires interaction start/stop evidence.', metrics: bridge.actionMetrics || [] };
    return { available: false, sources: ['runtime', 'app-instrumentation'], reason: 'Unsupported performance action.', metrics: [] };`;
}

// src/commands/perf-evidence/src/main/actions.ts
async function perfSummaryPayload(args = {}, deps = {}) {
  const cwd = await projectCwd(args.cwd, deps);
  const summary = await projectSummary(cwd, deps);
  const metroPort = clampNumber17(args.metroPort ?? 8081, 1, 65535);
  const metro = await metroStatus2({ metroPort }, deps);
  const metrics = [];
  const unavailableSources = [];
  const packageJsonPath = await findUpFile(summary.projectRoot, "package.json", deps);
  if (packageJsonPath) {
    const packageJson = asRecord15(await readJson3(packageJsonPath, deps)) ?? {};
    const dependencies = asRecord15(packageJson.dependencies) ?? {};
    const devDependencies = asRecord15(packageJson.devDependencies) ?? {};
    metrics.push(
      perfMetric({
        name: "project.dependencies",
        value: Object.keys({ ...dependencies, ...devDependencies }).length,
        unit: "count",
        source: "project",
        confidence: "low"
      })
    );
  } else {
    unavailableSources.push({ source: "project", reason: "No package.json found." });
  }
  if (metro.available) {
    metrics.push(
      perfMetric({
        name: "metro.targets",
        value: metro.targetCount,
        unit: "count",
        source: "metro",
        confidence: "medium"
      })
    );
  } else {
    unavailableSources.push({ source: "metro", reason: metro.reason });
  }
  const capabilities = [
    {
      source: "plugin-bridge-performance",
      available: metro.targets?.some((target) => target.capabilities?.hermesRuntime) === true,
      type: "upstream-plugin",
      confidence: "medium"
    },
    {
      source: "expo-devtools-performance",
      available: metro.available === true,
      type: "upstream-devtools",
      confidence: "low"
    },
    { source: "native-profiler", available: true, type: "native-fallback", confidence: "high" },
    { source: "bundle-artifact", available: false, type: "static-fallback", confidence: "high" }
  ];
  unavailableSources.push({
    source: "plugin-bridge-performance",
    reason: "Run perf startup/action/mark against an app with the performance bridge domain registered."
  });
  unavailableSources.push({
    source: "expo-devtools-performance",
    reason: "No machine-readable Expo DevTools performance domain was confirmed."
  });
  unavailableSources.push({
    source: "bundle-artifact",
    reason: "Pass an existing bundle artifact to perf bundle for byte evidence."
  });
  const payload = {
    available: true,
    action: "summary",
    mode: "development",
    sources: ["project", "metro"],
    capabilities,
    confidence: perfOverallConfidence(metrics),
    context: await perfContext({ args, projectRoot: summary.projectRoot, metro }),
    metrics,
    unavailableSources,
    limitations: perfDevelopmentLimitations([
      "Summary reports evidence availability and lightweight signals; it is not a performance score."
    ])
  };
  return {
    ...payload,
    realValidation: perfValidation(payload, "summary")
  };
}
function asRecord15(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}
async function perfRuntimePayload(args = {}, action, deps = {}) {
  return writeRuntimePerfArtifact(args, deps, {
    artifactAction: action,
    bridgeAction: action,
    normalizeAction: action,
    label: args.label,
    extraFields: () => action === "action" ? { actionName: requireString17(args.label, "label") } : {}
  });
}
async function perfInstrumentedPayload(args = {}, action, deps = {}) {
  const subaction = requireOptionalString7(args.subaction);
  const label = requireOptionalString7(args.label);
  const bridgeAction = perfBridgeAction(action, subaction);
  return writeRuntimePerfArtifact(args, deps, {
    artifactAction: action,
    bridgeAction,
    normalizeAction: action,
    label,
    extraFields: () => ({ subaction, bridgeAction })
  });
}
async function perfInteractionPayload(args = {}, deps = {}) {
  const subaction = requireString17(args.subaction ?? "read", "subaction");
  if (!["start", "stop", "read"].includes(subaction))
    throw new Error(`Unknown performance interaction action: ${subaction}`);
  const label = requireOptionalString7(args.label ?? args.interaction);
  return writeRuntimePerfArtifact(args, deps, {
    artifactAction: "interaction",
    bridgeAction: `interaction-${subaction}`,
    normalizeAction: "interaction",
    label,
    unavailableReason: "Performance interaction bridge did not return a value.",
    extraFields: () => ({ subaction, interaction: label })
  });
}
async function perfReportPayload(args = {}, deps = {}) {
  const nativeArtifact = requireOptionalString7(args.nativeArtifact);
  const evidence = await collectRuntimeBridgeEvidence(args, deps, {
    action: "report",
    label: args.interaction ?? args.label
  });
  const nativeSummary = nativeArtifact ? await parseNativeSampleArtifact(resolve11(nativeArtifact)) : null;
  const report = normalizePerfReport(evidence.bridgePayload, nativeSummary);
  const payload = {
    available: report.available,
    action: "report",
    interaction: args.interaction ?? args.label ?? null,
    mode: "development",
    sources: report.sources,
    findings: report.findings,
    metrics: report.metrics,
    runtime: report.runtime,
    nativeSummary,
    context: await perfContext({
      args,
      projectRoot: evidence.projectRoot,
      metro: evidence.metro,
      target: evidence.target
    }),
    transport: perfTransport(evidence.metroPort, evidence.target, evidence.diagnostics),
    confidence: report.confidence,
    limitations: perfDevelopmentLimitations(report.limitations)
  };
  return writePerfArtifact(
    args,
    "report",
    { ...payload, realValidation: perfValidation(payload, "report") },
    deps
  );
}
async function perfComparePayload(args = {}, deps = {}) {
  const baselinePath = resolve11(requireString17(args.baseline, "baseline"));
  const candidatePath = resolve11(requireString17(args.candidate, "candidate"));
  const baseline = await readJson3(baselinePath, deps);
  const candidate = await readJson3(candidatePath, deps);
  const candidateMetrics = metricMap(candidate.metrics ?? []);
  const deltas = [];
  for (const metric of baseline.metrics ?? []) {
    const next = candidateMetrics.get(metric.name);
    if (!next || typeof metric.value !== "number" || typeof next.value !== "number") continue;
    deltas.push({
      metric: metric.name,
      baseline: metric.value,
      candidate: next.value,
      delta: next.value - metric.value,
      unit: next.unit ?? metric.unit,
      improved: next.value <= metric.value,
      confidence: lowerConfidence(metric.confidence, next.confidence)
    });
  }
  return writePerfArtifact(
    args,
    "compare",
    {
      available: true,
      action: "compare",
      sources: ["artifact"],
      baseline: baselinePath,
      candidate: candidatePath,
      deltas,
      confidence: perfOverallConfidence(deltas.map((delta) => ({ confidence: delta.confidence }))),
      limitations: [
        "Comparison uses only matching metric names and does not infer user impact without workflow context."
      ]
    },
    deps
  );
}
async function perfBudgetPayload(args = {}, deps = {}) {
  const subaction = requireString17(args.subaction ?? "check", "subaction");
  if (subaction !== "check") throw new Error(`Unknown performance budget action: ${subaction}`);
  const budgetPath = resolve11(requireString17(args.file, "file"));
  const candidatePath = resolve11(requireString17(args.candidate, "candidate"));
  const budget = await readJson3(budgetPath, deps);
  const candidate = await readJson3(candidatePath, deps);
  const metrics = metricMap(candidate.metrics ?? []);
  const checks = (budget.budgets ?? []).map((rule) => {
    const metric = metrics.get(rule.metric);
    const value = typeof metric?.value === "number" ? metric.value : null;
    const passed = typeof value === "number" && (typeof rule.max !== "number" || value <= rule.max) && (typeof rule.min !== "number" || value >= rule.min);
    return {
      metric: rule.metric,
      value,
      min: rule.min ?? null,
      max: rule.max ?? null,
      passed,
      unit: metric?.unit ?? null
    };
  });
  return writePerfArtifact(
    args,
    "budget",
    {
      available: true,
      action: "budget",
      subaction,
      sources: ["artifact"],
      file: budgetPath,
      candidate: candidatePath,
      passed: checks.every((check) => check.passed),
      checks,
      limitations: [
        "Budget checks compare numeric metrics only; choose budgets that match build mode and device context."
      ]
    },
    deps
  );
}
async function perfMemoryPayload(args = {}, deps = {}) {
  const samples = clampNumber17(args.samples ?? 1, 1, 100);
  const nativeArtifact = requireOptionalString7(args.nativeArtifact);
  const projectRoot = await projectCwd(args.cwd, deps);
  const metrics = [
    perfMetric({
      name: "memory.samples",
      value: samples,
      unit: "count",
      source: nativeArtifact ? "memgraph" : "simulator",
      confidence: samples >= 2 || nativeArtifact ? "medium" : "low"
    })
  ];
  const leakAllowed = samples >= 2 || Boolean(nativeArtifact);
  const payload = {
    available: true,
    action: "memory",
    mode: "development",
    sources: nativeArtifact ? ["native-profiler", "memgraph"] : ["simulator"],
    metrics,
    context: await perfContext({ args, projectRoot, metro: null }),
    leakClaim: {
      allowed: leakAllowed,
      reason: leakAllowed ? "Repeated measurements or native artifacts are present." : "Repeated measurements or a native memgraph artifact are required before making a memory-leak claim."
    },
    nativeArtifact: nativeArtifact ? resolve11(nativeArtifact) : null,
    confidence: perfOverallConfidence(metrics),
    limitations: perfDevelopmentLimitations([
      "A single memory sample is only a hint, not leak evidence."
    ])
  };
  return writePerfArtifact(
    args,
    "memory",
    { ...payload, realValidation: perfValidation(payload, "memory") },
    deps
  );
}
async function perfNativeProfilerPayload(args = {}, profiler, deps = {}) {
  const subaction = requireString17(
    args.subaction ?? (profiler === "memgraph" ? "capture" : "stop"),
    "subaction"
  );
  const allowed = profiler === "ettrace" ? ["start", "stop"] : ["capture"];
  if (!allowed.includes(subaction)) throw new Error(`Unknown ${profiler} action: ${subaction}`);
  const defaultName = profiler === "ettrace" ? "capture.trace" : "heap.memgraph";
  const nativeArtifact = resolve11(
    String(
      args.nativeArtifact ?? join11(resolveExpoStateRoot8(args), "artifacts", "perf", defaultName)
    )
  );
  await (deps.mkdir ?? fsMkdir4)(dirname6(nativeArtifact), { recursive: true });
  let sampleResult = null;
  let samplePid = null;
  let sampleSeconds = null;
  if (profiler === "ettrace" && subaction === "start" && args.pid !== void 0) {
    const pid = requirePid(args.pid);
    samplePid = pid;
    const seconds = String(clampNumber17(args.seconds ?? 1, 1, 30));
    sampleSeconds = Number(seconds);
    sampleResult = await execFile6("sample", [String(pid), seconds, "-file", nativeArtifact], {
      timeout: (Number(seconds) + 20) * 1e3
    });
  } else if (subaction !== "start" && !await exists(nativeArtifact, deps)) {
    await (deps.writeFile ?? fsWriteFile4)(nativeArtifact, `${profiler} placeholder
`, "utf8");
  }
  const projectRoot = await projectCwd(args.cwd, deps);
  const nativeSummary = await parseNativeSampleArtifact(nativeArtifact);
  const payload = {
    available: true,
    action: profiler,
    subaction,
    profiler,
    mode: "development",
    sources: ["native-profiler"],
    nativeArtifact,
    pid: samplePid,
    seconds: sampleSeconds,
    sample: sampleResult,
    nativeSummary,
    metrics: [],
    context: await perfContext({ args, projectRoot, metro: null }),
    confidence: subaction === "start" ? "low" : "high",
    limitations: [
      `${profiler} metadata records native profiler evidence boundaries; collect and symbolicate native profiler artifacts before making native CPU or memory claims.`,
      "Native profiler workflows are heavier than routine runtime evidence and may require platform tooling outside this CLI."
    ]
  };
  return writePerfArtifact(
    args,
    profiler,
    { ...payload, realValidation: perfValidation(payload, profiler) },
    deps
  );
}
function requirePid(value) {
  const pid = Number(value);
  if (!Number.isInteger(pid) || pid <= 0)
    throw new Error(`pid must be a positive integer, got ${String(value)}.`);
  return pid;
}
async function perfBundlePayload(args = {}, deps = {}) {
  const cwd = await projectCwd(args.cwd, deps);
  const bundleArtifact = requireOptionalString7(args.bundleArtifact);
  const metrics = [];
  const unavailableSources = [];
  let available = false;
  let bundlePath = null;
  if (bundleArtifact) {
    bundlePath = resolve11(bundleArtifact);
    const stat8 = await fileStat(bundlePath, deps);
    if (stat8?.isFile()) {
      available = true;
      metrics.push(
        perfMetric({
          name: "bundle.bytes",
          value: stat8.size,
          unit: "bytes",
          source: "metro",
          confidence: "high"
        })
      );
    } else {
      unavailableSources.push({
        source: "bundle-artifact",
        reason: "Bundle artifact was not found.",
        path: bundlePath
      });
    }
  } else {
    unavailableSources.push({
      source: "bundle-artifact",
      reason: "Pass an existing Metro/Expo bundle artifact path."
    });
  }
  return writePerfArtifact(
    args,
    "bundle",
    {
      available,
      action: "bundle",
      mode: "development",
      sources: available ? ["project", "metro"] : ["project"],
      bundleArtifact: bundlePath,
      metrics,
      unavailableSources,
      context: await perfContext({ args, projectRoot: cwd, metro: null }),
      confidence: perfOverallConfidence(metrics),
      limitations: perfDevelopmentLimitations([
        "Bundle byte evidence depends on the supplied artifact and does not imply release performance unless the artifact is release-like."
      ])
    },
    deps
  );
}

// src/commands/perf-evidence/src/main/index.ts
async function perfCommand(args = {}, deps = {}) {
  const action = requireString17(args.action ?? firstPositional3(args) ?? "summary", "action");
  if (!PERF_ACTIONS.includes(action)) throw new Error(`Unknown performance action: ${action}`);
  if (action === "summary") return toolJson(await perfSummaryPayload(args, deps));
  if (action === "bundle") return toolJson(await perfBundlePayload(args, deps));
  if (action === "compare") return toolJson(await perfComparePayload(args, deps));
  if (action === "budget") return toolJson(await perfBudgetPayload(args, deps));
  if (action === "memory") return toolJson(await perfMemoryPayload(args, deps));
  if (action === "ettrace" || action === "memgraph")
    return toolJson(await perfNativeProfilerPayload(args, action, deps));
  if (action === "interaction") return toolJson(await perfInteractionPayload(args, deps));
  if (action === "report") return toolJson(await perfReportPayload(args, deps));
  if (["mark", "measure", "js-thread", "frames"].includes(action))
    return toolJson(await perfInstrumentedPayload(args, action, deps));
  return toolJson(await perfRuntimePayload(args, action, deps));
}

// src/commands/plugin-self-management/src/main/index.ts
import { execFile as nodeExecFile9 } from "node:child_process";
import { existsSync } from "node:fs";
import { access as access5, mkdir as mkdir10, mkdtemp, readdir as readdir7, readFile as readFile17, writeFile as writeFile7 } from "node:fs/promises";
import { homedir as homedir2, tmpdir as tmpdir2 } from "node:os";
import { dirname as dirname7, join as join12, resolve as resolve12 } from "node:path";
var CLI_NAME4 = CURRENT_CLI_NAME;
var CLI_VERSION3 = "0.1.0";
async function skillsCommand(args = {}, deps = {}) {
  const positionals = Array.isArray(args._) ? args._ : [];
  const action = requireString18(args.action ?? positionals[0] ?? "list", "action");
  if (!["list", "get"].includes(action)) throw new Error(`Unknown skills action: ${action}`);
  const skills = await listBundledSkills(deps);
  if (action === "list") {
    return toolJson({
      available: true,
      action,
      pluginVersion: CLI_VERSION3,
      skills: skills.map(({ content: _content, ...skill2 }) => skill2)
    });
  }
  const name = requireString18(args.name ?? positionals[1], "name");
  const skill = skills.find((item) => item.name === name);
  if (!skill)
    return toolJson({
      available: false,
      action,
      name,
      reason: "Skill not found.",
      pluginVersion: CLI_VERSION3
    });
  return toolJson({ available: true, action, pluginVersion: CLI_VERSION3, ...skill });
}
async function listBundledSkills(deps = {}) {
  const skillsRoot = join12(pluginRoot(deps), "skills");
  const entries = await readdir7(skillsRoot, { withFileTypes: true }).catch(() => []);
  const skills = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const file = join12(skillsRoot, entry.name, "SKILL.md");
    const content = await readFile17(file, "utf8").catch(() => null);
    if (!content) continue;
    const metadata = parseSkillFrontmatter(content);
    skills.push({
      name: metadata.name ?? entry.name,
      description: metadata.description ?? "",
      path: file,
      content
    });
  }
  return skills.sort((left, right) => left.name.localeCompare(right.name));
}
function parseSkillFrontmatter(content) {
  const match = /^---\n([\s\S]*?)\n---/.exec(content);
  if (!match) return {};
  const metadata = {};
  for (const line of match[1]?.split("\n") ?? []) {
    const item = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (item?.[1]) metadata[item[1]] = String(item[2] ?? "").replace(/^["']|["']$/g, "");
  }
  return metadata;
}
async function installCommand(args = {}, deps = {}) {
  const positionals = Array.isArray(args._) ? args._ : [];
  const action = requireString18(args.action ?? positionals[0] ?? "check", "action");
  if (action !== "check") throw new Error(`Unknown install action: ${action}`);
  const prefix = resolve12(optionalString7(args.prefix) ?? join12(deps.homeDir ?? homedir2(), ".local"));
  const binPath = join12(prefix, "bin", CLI_NAME4);
  return toolJson({
    available: true,
    action,
    prefix,
    binPath,
    installed: await pathExists5(binPath),
    installCommand: `make -C ${pluginRoot(deps)} install-local PREFIX=${prefix}`,
    cliPath: cliWrapperPath(deps),
    version: CLI_VERSION3
  });
}
async function upgradeCommand(args = {}, deps = {}) {
  const positionals = Array.isArray(args._) ? args._ : [];
  const action = requireString18(args.action ?? positionals[0] ?? "check", "action");
  if (action !== "check") throw new Error(`Unknown upgrade action: ${action}`);
  const prefix = resolve12(optionalString7(args.prefix) ?? join12(deps.homeDir ?? homedir2(), ".local"));
  return toolJson({
    available: true,
    action,
    prefix,
    currentVersion: CLI_VERSION3,
    latestVersion: CLI_VERSION3,
    upgradeAvailable: false,
    reason: "No packaged remote upgrade source is configured; local plugin version is authoritative."
  });
}
async function releaseCommand(args = {}, deps = defaultPluginSelfManagementDependencies) {
  const positionals = Array.isArray(args._) ? args._ : [];
  const action = requireString18(args.action ?? positionals[0] ?? "check", "action");
  if (action !== "check") throw new Error(`Unknown release action: ${action}`);
  const outsideCwd = resolve12(
    String(args.cwd ?? await mkdtemp(join12(deps.tmpDir ?? tmpdir2(), "expo98-release-")))
  );
  await mkdir10(outsideCwd, { recursive: true });
  const fixture = join12(outsideCwd, "routes-fixture");
  await mkdir10(join12(fixture, "app"), { recursive: true });
  await writeJsonFile7(join12(fixture, "package.json"), {
    dependencies: { expo: "^54.0.0", "expo-router": "^6.0.0" }
  });
  await writeFile7(
    join12(fixture, "app", "index.tsx"),
    "export default function Index() { return null; }\n",
    "utf8"
  );
  const checks = [
    await releaseCheck(
      "version",
      ["--version"],
      outsideCwd,
      (result) => result.stdout.trim() === CLI_VERSION3,
      deps
    ),
    await releaseCheck(
      "help",
      ["--help"],
      outsideCwd,
      (result) => result.stdout.includes("perf") && result.stdout.includes("dashboard"),
      deps
    ),
    await releaseCheck(
      "doctor-json",
      ["--json", "doctor"],
      outsideCwd,
      (result) => JSON.parse(result.stdout).ok === true,
      deps
    ),
    await releaseCheck(
      "routes-fixture-json",
      ["--json", "routes", "--cwd", fixture],
      outsideCwd,
      (result) => JSON.parse(result.stdout).data.routeCount >= 1,
      deps
    )
  ];
  return toolJson({
    available: checks.every((check) => check.ok),
    action,
    cwd: outsideCwd,
    version: CLI_VERSION3,
    checks,
    limitations: [
      "Release checks verify local CLI packaging behavior; they do not publish or mutate git state."
    ]
  });
}
var defaultPluginSelfManagementDependencies = {
  execFile: execFile7
};
async function releaseCheck(name, argv, cwd, predicate, deps = defaultPluginSelfManagementDependencies) {
  try {
    if (!deps.execFile)
      return { name, ok: false, exitCode: 1, error: "No subprocess adapter is configured." };
    const result = await deps.execFile(process.execPath, [cliWrapperPath(deps), ...argv], {
      cwd,
      timeout: 2e4,
      rejectOnError: false
    });
    const ok = predicate(result);
    return {
      name,
      ok,
      exitCode: ok ? 0 : 1,
      stdout: truncate13(result.stdout, 1e3),
      stderr: truncate13(result.stderr, 1e3)
    };
  } catch (error) {
    return { name, ok: false, exitCode: 1, error: formatError10(error) };
  }
}
function cliWrapperPath(deps = {}) {
  return join12(pluginRoot(deps), "cli", "expo98.mjs");
}
function pluginRoot(deps = {}) {
  return resolve12(deps.pluginRoot ?? findPackageRoot(dirname7(new URL(import.meta.url).pathname)));
}
function findPackageRoot(start) {
  let current = resolve12(start);
  while (true) {
    if (existsSync(join12(current, "package.json")) && existsSync(join12(current, "cli")))
      return current;
    const parent = dirname7(current);
    if (parent === current) return resolve12(start);
    current = parent;
  }
}
async function pathExists5(file) {
  try {
    await access5(file);
    return true;
  } catch {
    return false;
  }
}
async function writeJsonFile7(file, value) {
  await mkdir10(dirname7(file), { recursive: true });
  await writeFile7(file, `${JSON.stringify(value, null, 2)}
`, "utf8");
}
function requireString18(value, name) {
  if (typeof value !== "string" || value.trim().length === 0)
    throw new Error(`${name} must be a non-empty string.`);
  return value.trim();
}
function optionalString7(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}
function truncate13(value, max = 4e4) {
  const text = String(value ?? "");
  if (text.length <= max) return text;
  return `${text.slice(0, max)}...[truncated ${text.length - max} chars]`;
}
function formatError10(error) {
  const record = error && typeof error === "object" ? error : null;
  return record?.message == null ? String(error) : String(record.message);
}
function execFile7(file, argv, options) {
  return new Promise((resolve18) => {
    nodeExecFile9(
      file,
      argv,
      { cwd: options.cwd, timeout: options.timeout, maxBuffer: 4 * 1024 * 1024 },
      (_error, stdout, stderr) => {
        resolve18({ stdout: String(stdout ?? ""), stderr: String(stderr ?? "") });
      }
    );
  });
}

// src/commands/record-artifacts/src/main/index.ts
import { spawn as spawn3 } from "node:child_process";
import { access as access6, mkdir as mkdir11, readdir as readdir8, readFile as readFile18, writeFile as writeFile8 } from "node:fs/promises";
import { basename as basename9, dirname as dirname8, join as join13, resolve as resolve13 } from "node:path";
var RECORD_LIMITATION = "Simulator video capture uses xcrun simctl io recordVideo and requires a booted iOS simulator.";
async function recordCommand(args = {}, deps = {}) {
  const positionals = Array.isArray(args._) ? args._ : [];
  const action = requireString19(args.action ?? positionals[0] ?? "start", "action");
  if (!["start", "stop"].includes(action)) throw new Error(`Unknown record action: ${action}`);
  const stateRoot = resolveExpoStateRoot9(args);
  const session = asRecord16(await readLatestSession5(stateRoot));
  const recordDir = join13(stateRoot, "artifacts", "recordings");
  await mkdir11(recordDir, { recursive: true });
  const metadataPath = runRecordMetadataPath(stateRoot);
  const defaultOutputPath = join13(recordDir, `recording-${isoStamp2(deps)}.mov`);
  const outputPath = resolve13(String(args.outputPath ?? positionals[1] ?? defaultOutputPath));
  if (action === "start") {
    await mkdir11(dirname8(outputPath), { recursive: true });
    const device = typeof args.device === "string" && args.device.trim() ? args.device.trim() : "booted";
    const child = spawn3("xcrun", ["simctl", "io", device, "recordVideo", outputPath], {
      detached: true,
      stdio: "ignore"
    });
    child.unref();
    const metadata2 = {
      available: true,
      action,
      startedAt: now2(deps).toISOString(),
      sessionId: session?.sessionId ?? null,
      targetId: session?.activeTargetId ?? null,
      outputPath,
      status: "recording",
      pid: child.pid ?? null,
      command: ["xcrun", "simctl", "io", device, "recordVideo", outputPath],
      limitations: [RECORD_LIMITATION]
    };
    await writeJsonFile8(metadataPath, metadata2);
    return toolJson({ ...metadata2, metadataPath });
  }
  const previous = asRecord16(await readJsonFile9(metadataPath).catch(() => null));
  const previousPid = Number(previous?.pid);
  if (Number.isInteger(previousPid) && previousPid > 0) {
    try {
      process.kill(previousPid, "SIGINT");
    } catch {
    }
  }
  const finalOutputPath = resolve13(String(args.outputPath ?? previous?.outputPath ?? outputPath));
  await waitForPath(finalOutputPath, 3e3);
  const metadata = {
    available: true,
    action,
    stoppedAt: now2(deps).toISOString(),
    sessionId: session?.sessionId ?? null,
    targetId: session?.activeTargetId ?? null,
    outputPath: finalOutputPath,
    metadataPath,
    status: "stopped",
    pid: Number.isInteger(previousPid) && previousPid > 0 ? previousPid : null,
    fileExists: await pathExists6(finalOutputPath)
  };
  await writeJsonFile8(metadataPath, metadata);
  return toolJson(metadata);
}
function runRecordMetadataPath(stateRoot) {
  return join13(stateRoot, "artifacts", "recordings", "recording.json");
}
async function readLatestSession5(stateRoot) {
  const sessionsRoot = join13(stateRoot, "sessions");
  const entries = await readdir8(sessionsRoot, { withFileTypes: true }).catch(() => []);
  const sessions = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const record = await readJsonFile9(join13(sessionsRoot, entry.name, "session.json")).catch(
      () => null
    );
    if (record) sessions.push(record);
  }
  sessions.sort(
    (a, b) => String(asRecord16(b)?.updatedAt ?? asRecord16(b)?.createdAt).localeCompare(
      String(asRecord16(a)?.updatedAt ?? asRecord16(a)?.createdAt)
    )
  );
  return sessions[0] ?? null;
}
function resolveExpoStateRoot9(args = {}) {
  if (args.stateDir) {
    const resolved = resolve13(args.stateDir);
    return basename9(resolved) === "runs" ? resolve13(join13(resolved, "..")) : resolved;
  }
  const root = resolve13(args.root ?? args.cwd ?? process.cwd());
  return join13(root, ".scratch", "expo98");
}
async function readJsonFile9(file) {
  return JSON.parse(await readFile18(file, "utf8"));
}
async function writeJsonFile8(file, value) {
  await writeFile8(file, `${JSON.stringify(value, null, 2)}
`, "utf8");
}
async function pathExists6(file) {
  try {
    await access6(file);
    return true;
  } catch {
    return false;
  }
}
async function waitForPath(file, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await pathExists6(file)) return true;
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  return pathExists6(file);
}
function requireString19(value, name) {
  if (typeof value !== "string" || value.trim().length === 0)
    throw new Error(`${name} must be a non-empty string.`);
  return value.trim();
}
function isoStamp2(deps) {
  return now2(deps).toISOString().replace(/[:.]/g, "-");
}
function now2(deps) {
  return deps.now ? deps.now() : /* @__PURE__ */ new Date();
}
function asRecord16(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

// src/commands/review-evidence-reports/src/main/index.ts
import { mkdir as mkdir12, readdir as readdir9, readFile as readFile19, stat as stat6, writeFile as writeFile9 } from "node:fs/promises";
import { basename as basename10, dirname as dirname9, join as join14, resolve as resolve14 } from "node:path";
var REVIEW_LIMITATION = "Review reports assemble evidence already captured by other commands; they do not independently judge UI quality.";
var ROUTE_DIFF_LIMITATION = "Route diff captures route-open evidence and optional screenshots; semantic visual comparison is left to the caller.";
async function reviewCommand(args = {}, deps = defaultReviewDiffDependencies) {
  const positionals = Array.isArray(args._) ? args._ : [];
  const action = requireString20(args.action ?? positionals[0] ?? "report", "action");
  if (!["report", "matrix"].includes(action)) throw new Error(`Unknown review action: ${action}`);
  const stateRoot = resolveExpoStateRoot10(args);
  const session = await readLatestSession6(stateRoot);
  const outputPath = resolve14(
    String(
      args.outputPath ?? join14(stateRoot, "artifacts", `review-${action}-${isoStamp3(deps)}.json`)
    )
  );
  await mkdir12(dirname9(outputPath), { recursive: true });
  const runs = await listRunRecords(stateRoot);
  const latestRefs = await readLatestRefCache5(args);
  const payload = action === "matrix" ? reviewMatrixPayload({ stateRoot, session, runs, latestRefs, outputPath }) : reviewReportPayload({ stateRoot, session, runs, latestRefs, outputPath });
  await writeJsonFile9(outputPath, payload);
  return toolJson(payload);
}
async function diffCommand(args = {}, deps = defaultReviewDiffDependencies) {
  const positionals = Array.isArray(args._) ? args._ : [];
  const kind = requireString20(args.kind ?? positionals[0], "kind");
  if (!["snapshot", "screenshot", "route"].includes(kind))
    throw new Error(`Unknown diff kind: ${kind}`);
  const normalizedArgs = {
    ...args,
    kind,
    baseline: args.baseline ?? positionals[1],
    current: args.current ?? positionals[2],
    routeA: args.routeA ?? (kind === "route" ? positionals[1] : void 0),
    routeB: args.routeB ?? (kind === "route" ? positionals[2] : void 0)
  };
  const stateRoot = resolveExpoStateRoot10(normalizedArgs);
  const session = await readLatestSession6(stateRoot);
  const outputPath = resolve14(
    String(
      normalizedArgs.outputPath ?? join14(stateRoot, "artifacts", `diff-${kind}-${isoStamp3(deps)}.json`)
    )
  );
  await mkdir12(dirname9(outputPath), { recursive: true });
  const diff = kind === "snapshot" ? await snapshotDiffPayload(normalizedArgs) : kind === "route" ? await routeDiffPayload(normalizedArgs, deps) : await screenshotDiffPayload(normalizedArgs);
  const payload = {
    ...diff,
    kind,
    sessionId: asRecord17(session)?.sessionId ?? null,
    targetId: asRecord17(session)?.activeTargetId ?? null,
    outputPath
  };
  await writeJsonFile9(outputPath, payload);
  return toolJson(payload);
}
var defaultReviewDiffDependencies = {
  openExpoRoute,
  captureScreenshot,
  now: () => /* @__PURE__ */ new Date(),
  nowMs: () => Date.now()
};
function reviewReportPayload(args) {
  const session = asRecord17(args.session);
  const artifacts = collectExpoIosArtifacts(args.stateRoot);
  return {
    available: true,
    action: "report",
    outputPath: args.outputPath,
    stateRoot: args.stateRoot,
    sessionId: session?.sessionId ?? null,
    activeTargetId: session?.activeTargetId ?? null,
    lastSnapshotId: session?.lastSnapshotId ?? null,
    runCount: args.runs.length,
    recentRuns: args.runs.slice(-25).map(runSummary),
    refCount: Array.isArray(args.latestRefs?.refs) ? args.latestRefs.refs.length : 0,
    artifacts,
    limitations: [REVIEW_LIMITATION]
  };
}
function reviewMatrixPayload(args) {
  const session = asRecord17(args.session);
  const commands = new Set(args.runs.map((run) => run.command).filter(Boolean));
  const checks = [
    {
      name: "session",
      passed: Boolean(session),
      evidence: session ? sessionDirectory4(args.stateRoot, String(session.sessionId)) : null
    },
    {
      name: "target",
      passed: Boolean(session?.activeTargetId),
      evidence: session?.activeTargetId ?? null
    },
    {
      name: "snapshot",
      passed: Boolean(args.latestRefs?.snapshotId),
      evidence: args.latestRefs?.snapshotId ?? null
    },
    {
      name: "screenshot",
      passed: commands.has("screenshot") || commands.has("annotate-screen"),
      evidence: "run-records"
    },
    {
      name: "runtime",
      passed: commands.has("devtools") || commands.has("inspector") || commands.has("ux-context"),
      evidence: "run-records"
    },
    {
      name: "diagnostics",
      passed: commands.has("console") || commands.has("errors") || commands.has("logs"),
      evidence: "run-records"
    },
    {
      name: "interaction",
      passed: commands.has("tap") || commands.has("gesture") || commands.has("fill"),
      evidence: "run-records"
    }
  ];
  return {
    available: true,
    action: "matrix",
    outputPath: args.outputPath,
    stateRoot: args.stateRoot,
    sessionId: session?.sessionId ?? null,
    checks,
    passed: checks.every((check) => check.passed),
    runCount: args.runs.length
  };
}
async function routeDiffPayload(args = {}, deps = defaultReviewDiffDependencies) {
  const routeA = requireString20(args.routeA, "routeA");
  const routeB = requireString20(args.routeB, "routeB");
  const screenshot = args.screenshot === true;
  if (!deps.openExpoRoute)
    return { available: false, routeA, routeB, reason: "No open-route adapter is configured." };
  const openedA = unwrapToolJson(await deps.openExpoRoute({ ...args, route: routeA }));
  const shotA = screenshot ? await captureRouteScreenshot(args, deps, `route-a-${nowMs(deps)}.png`) : null;
  const openedB = unwrapToolJson(await deps.openExpoRoute({ ...args, route: routeB }));
  const shotB = screenshot ? await captureRouteScreenshot(args, deps, `route-b-${nowMs(deps)}.png`) : null;
  return {
    available: true,
    routeA,
    routeB,
    openedA,
    openedB,
    screenshots: screenshot ? { before: shotA?.outputPath ?? null, after: shotB?.outputPath ?? null } : null,
    limitations: [ROUTE_DIFF_LIMITATION]
  };
}
async function snapshotDiffPayload(args = {}) {
  const baseline = await readJsonFile10(resolve14(requireString20(args.baseline, "baseline")));
  const current = args.current ? await readJsonFile10(resolve14(requireString20(args.current, "current"))) : await latestSnapshotJson(args);
  if (!current)
    return { available: false, reason: "No current snapshot exists for the current session." };
  const beforeRefs = new Set(refsFromSnapshot(baseline));
  const afterRefs = new Set(refsFromSnapshot(current));
  return {
    available: true,
    baselineSnapshotId: asRecord17(baseline)?.snapshotId ?? null,
    currentSnapshotId: asRecord17(current)?.snapshotId ?? null,
    addedRefs: [...afterRefs].filter((ref) => !beforeRefs.has(ref)),
    removedRefs: [...beforeRefs].filter((ref) => !afterRefs.has(ref)),
    beforeCount: beforeRefs.size,
    afterCount: afterRefs.size
  };
}
async function screenshotDiffPayload(args = {}) {
  const baseline = resolve14(requireString20(args.baseline, "baseline"));
  const current = resolve14(requireString20(args.current, "current"));
  const [before, after] = await Promise.all([stat6(baseline), stat6(current)]);
  return {
    available: true,
    baseline,
    current,
    byteDelta: after.size - before.size,
    changed: before.size !== after.size
  };
}
async function latestSnapshotJson(args = {}) {
  const cache = await readLatestRefCache5(args);
  if (!cache?.snapshotId) return null;
  const stateRoot = resolveExpoStateRoot10(args);
  const session = await readLatestSession6(stateRoot);
  const sessionId = asRecord17(session)?.sessionId;
  if (!sessionId) return cache;
  return readJsonFile10(
    join14(sessionDirectory4(stateRoot, String(sessionId)), "snapshots", `${cache.snapshotId}.json`)
  ).catch(() => cache);
}
async function readLatestSession6(stateRoot) {
  const sessionsRoot = join14(stateRoot, "sessions");
  const entries = await readdir9(sessionsRoot, { withFileTypes: true }).catch(() => []);
  const sessions = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const record = await readJsonFile10(join14(sessionsRoot, entry.name, "session.json")).catch(
      () => null
    );
    if (record) sessions.push(record);
  }
  sessions.sort(
    (a, b) => String(asRecord17(b)?.updatedAt ?? asRecord17(b)?.createdAt).localeCompare(
      String(asRecord17(a)?.updatedAt ?? asRecord17(a)?.createdAt)
    )
  );
  return sessions[0] ?? null;
}
async function readLatestRefCache5(args = {}) {
  const stateRoot = resolveExpoStateRoot10(args);
  const session = asRecord17(await readLatestSession6(stateRoot));
  if (!session?.lastSnapshotId) return null;
  return readJsonFile10(
    join14(sessionDirectory4(stateRoot, String(session.sessionId)), "refs.json")
  ).catch(() => null);
}
async function listRunRecords(stateRoot) {
  const runsRoot = join14(stateRoot, "runs");
  const entries = await readdir9(runsRoot, { withFileTypes: true }).catch(() => []);
  const records = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const file = join14(runsRoot, entry.name);
    const record = asRecord17(await readJsonFile10(file).catch(() => null));
    if (record) records.push({ ...record, path: file });
  }
  records.sort(
    (a, b) => String(a.startedAt ?? a.createdAt ?? "").localeCompare(
      String(b.startedAt ?? b.createdAt ?? "")
    )
  );
  return records;
}
function runSummary(run) {
  return {
    command: run.command ?? null,
    status: run.status ?? null,
    exitCode: run.exitCode ?? null,
    startedAt: run.startedAt ?? run.createdAt ?? null,
    completedAt: run.completedAt ?? run.finishedAt ?? null,
    path: run.path ?? null,
    summary: run.summary ?? null
  };
}
function collectExpoIosArtifacts(stateRoot) {
  return {
    runs: join14(stateRoot, "runs"),
    sessions: join14(stateRoot, "sessions"),
    artifacts: join14(stateRoot, "artifacts")
  };
}
function resolveExpoStateRoot10(args = {}) {
  if (args.stateDir) {
    const resolved = resolve14(args.stateDir);
    return basename10(resolved) === "runs" ? resolve14(join14(resolved, "..")) : resolved;
  }
  const root = resolve14(args.root ?? args.cwd ?? process.cwd());
  return join14(root, ".scratch", "expo98");
}
function sessionDirectory4(stateRoot, sessionId) {
  return join14(stateRoot, "sessions", sessionId);
}
async function readJsonFile10(file) {
  return JSON.parse(await readFile19(file, "utf8"));
}
async function writeJsonFile9(file, value) {
  await writeFile9(file, `${JSON.stringify(value, null, 2)}
`, "utf8");
}
function requireString20(value, name) {
  if (typeof value !== "string" || value.trim().length === 0)
    throw new Error(`${name} must be a non-empty string.`);
  return value.trim();
}
function refsFromSnapshot(snapshot) {
  const refs = asRecord17(snapshot)?.refs;
  if (!Array.isArray(refs)) return [];
  return refs.map((record) => asRecord17(record)?.ref).filter((ref) => typeof ref === "string");
}
async function captureRouteScreenshot(args, deps, filename) {
  if (!deps.captureScreenshot) return null;
  const outputPath = join14(resolveExpoStateRoot10(args), "artifacts", filename);
  return deps.captureScreenshot({ ...args, outputPath });
}
function isoStamp3(deps) {
  return (deps.now ? deps.now() : /* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-");
}
function nowMs(deps) {
  return deps.nowMs ? deps.nowMs() : Date.now();
}
function asRecord17(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

// src/commands/review-next-guidance/src/main/index.ts
var SUBORDINATE_RULE = "Do not patch or call done until the current constraint is proven or deliberately elevated.";
var NON_GOALS = [
  "Do not change unrelated app contracts, data shape, or navigation model without a separate reason."
];
async function reviewNextStep(args = {}) {
  const surface = args.surface ?? "generic";
  const stage = args.stage ?? "intake";
  const issue = requireOptionalString8(args.issue) ?? "unspecified UI review issue";
  const cwd = requireOptionalString8(args.cwd) ?? ".";
  const metroPort = clampNumber18(args.metroPort ?? 8081, 1, 65535);
  const componentFilter = requireOptionalString8(args.componentFilter);
  const verifierRule = requireOptionalString8(args.verifierRule);
  const flags = reviewFlags(args);
  const requiredFlows = reviewFlowsForSurface(surface);
  const suggestedCommands = reviewCommandSuggestions({
    cwd,
    metroPort,
    componentFilter,
    flags,
    stage
  });
  const questionTriggers = reviewQuestionTriggers(flags, verifierRule);
  const constraint = chooseReviewConstraint({ stage, flags, verifierRule });
  return toolJson({
    issue,
    surface,
    stage,
    constraint,
    nextStep: constraint.nextStep,
    subordinateRule: SUBORDINATE_RULE,
    requiredFlows,
    questionTriggers,
    suggestedCommands,
    stopConditions: reviewStopConditions({ flags, verifierRule }),
    acceptanceContractTemplate: {
      userGoal: "<role + task>",
      firstScreenInvariants: requiredFlows.firstScreenInvariants,
      ambiguousSemantics: questionTriggers,
      representativeAction: requiredFlows.representativeAction,
      evidenceRequired: requiredFlows.evidenceRequired,
      nonGoals: NON_GOALS
    }
  });
}
function chooseReviewConstraint(args) {
  const workflowVerifier = args.verifierRule && verifierRuleMatchesChangedWorkflow(args.verifierRule, args.flags);
  if (!args.flags.hasAcceptanceContract && args.stage !== "handoff") {
    return {
      name: "decision clarity",
      tocStep: "exploit",
      reason: "The limiting constraint is not code; it is the missing acceptance contract.",
      nextStep: "Write the acceptance contract and resolve ambiguous control/gesture/chrome semantics before editing."
    };
  }
  if (!args.flags.hasScreenshot && (args.stage === "intake" || args.stage === "pre-patch")) {
    return {
      name: "baseline evidence",
      tocStep: "exploit",
      reason: "The screen cannot be reviewed reliably without visible runtime evidence.",
      nextStep: "Capture ux-context or a screenshot, then inspect the image against the first-screen invariants."
    };
  }
  if (workflowVerifier) {
    return {
      name: "workflow blocker",
      tocStep: "elevate",
      reason: `Verifier rule ${args.verifierRule} maps to the changed workflow.`,
      nextStep: "Treat the verifier finding as blocking, fix the underlying workflow, or record an explicit product exception."
    };
  }
  if ((args.flags.changedGesture || args.stage === "interaction") && !args.flags.hasInteractionProof) {
    return {
      name: "interaction proof",
      tocStep: "elevate",
      reason: "The touched workflow depends on direct manipulation, so screenshots and static checks are insufficient.",
      nextStep: "Run the representative action in the simulator or an equivalent interaction test, then compare preview and committed state."
    };
  }
  if ((args.flags.changedChrome || args.flags.changedNavigation) && !args.flags.hasInteractionProof) {
    return {
      name: "chrome/navigation proof",
      tocStep: "subordinate",
      reason: "Chrome and navigation changes can silently break safe area, tab, sheet, or return behavior.",
      nextStep: "Exercise tab/header/sheet/back behavior on the target route and inspect safe-area clearance."
    };
  }
  if (args.flags.addedVisibleControls && !args.flags.hasInteractionProof) {
    return {
      name: "affordance validation",
      tocStep: "exploit",
      reason: "New always-visible controls may reduce discoverability debt while damaging the direct object model.",
      nextStep: "Prove object-level feedback is insufficient, then verify the added controls do not clutter or compete with the primary surface."
    };
  }
  if (!args.flags.hasStaticVerifier && args.stage !== "intake") {
    return {
      name: "static pattern gate",
      tocStep: "subordinate",
      reason: "The local native-feel rule gate has not been run for the changed iOS surface.",
      nextStep: "Run verify-native-experience and classify findings by whether they map to the touched workflow."
    };
  }
  return {
    name: "handoff proof",
    tocStep: "subordinate",
    reason: "The main constraints appear covered; the remaining work is to make proof inspectable.",
    nextStep: "Finish with an acceptance matrix: invariant, evidence, pass/fail, and remaining risk."
  };
}
function reviewFlowsForSurface(surface) {
  if (surface === "calendar" || surface === "timeline") {
    return {
      firstScreenInvariants: [
        "current day remains visibly distinct",
        "current time is visible or the screen explains why not",
        "date context is still visible after positioning near now",
        "bottom tab/home-indicator chrome does not crop or cover working time"
      ],
      representativeAction: "Open today, tap an empty slot, drag a time range, confirm the draft range, scroll without creating, and drag without scrolling.",
      evidenceRequired: [
        "before and after ux-context or screenshot",
        "interaction proof for tap-to-create and drag-to-create",
        "safe-area/tab clearance proof",
        "verify-native-experience classification for gesture, tab, safe-area, and visible-text rules"
      ],
      flows: [
        "fresh-open temporal context",
        "day switch away and back to today",
        "tap-to-create draft",
        "short and long drag-to-create",
        "scroll-vs-drag conflict",
        "bottom chrome and safe-area clearance",
        "today selected, today not selected, past, future, occupied, and free states"
      ]
    };
  }
  if (surface === "navigation") {
    return {
      firstScreenInvariants: [
        "selected tab/title is clear",
        "back or dismiss behavior is predictable",
        "content clears system chrome"
      ],
      representativeAction: "Enter the route, navigate forward, back out, switch tabs, and return.",
      evidenceRequired: [
        "ux-context or screenshot",
        "manual/smoke navigation walkthrough",
        "safe-area proof"
      ],
      flows: ["deep link/cold entry", "tab switch", "back/dismiss", "return to prior state"]
    };
  }
  if (surface === "form") {
    return {
      firstScreenInvariants: [
        "primary fields are visible",
        "keyboard does not hide focused input",
        "submit state is clear"
      ],
      representativeAction: "Focus a field, submit invalid data, recover, submit valid data, and confirm the result.",
      evidenceRequired: [
        "focused keyboard state",
        "invalid/recovery state",
        "success or saved state"
      ],
      flows: ["focus/keyboard", "invalid submit", "recovery", "valid submit"]
    };
  }
  if (surface === "list") {
    return {
      firstScreenInvariants: [
        "rows are readable",
        "selected/empty/loading/error state is clear",
        "row actions do not conflict with scroll"
      ],
      representativeAction: "Scroll, select a row, perform row action if present, and return.",
      evidenceRequired: ["ux-context or screenshot", "scroll/row interaction proof"],
      flows: ["loading/empty/error", "scroll", "row select", "row action"]
    };
  }
  if (surface === "editor") {
    return {
      firstScreenInvariants: [
        "editable object is clear",
        "tool state is visible",
        "chrome does not cover the canvas/content"
      ],
      representativeAction: "Create or edit the object, preview the change, cancel, then commit and confirm saved state.",
      evidenceRequired: ["before/after screenshot", "interaction proof", "saved-state proof"],
      flows: ["edit", "preview", "cancel", "commit"]
    };
  }
  return {
    firstScreenInvariants: [
      "location/state is clear",
      "primary action is visible or directly discoverable",
      "system chrome does not cover content"
    ],
    representativeAction: "Exercise the primary user action from the visible surface and confirm the committed state matches the preview.",
    evidenceRequired: [
      "ux-context or screenshot",
      "representative action proof",
      "static verifier classification"
    ],
    flows: ["fresh open", "primary action", "cancel/recover", "commit", "return"]
  };
}
function reviewQuestionTriggers(flags, verifierRule) {
  const questions = [];
  if (flags.changedChrome || flags.changedNavigation) {
    questions.push(
      "What should this control/chrome mean: navigation, disclosure, filter, picker, or title menu?"
    );
  }
  if (flags.changedGesture) {
    questions.push("Which gesture owns the surface when scroll and direct manipulation overlap?");
  }
  if (flags.addedVisibleControls) {
    questions.push(
      "Can object-level feedback solve discoverability before adding always-visible controls?"
    );
  }
  if (verifierRule) {
    questions.push(
      `Does verifier rule ${verifierRule} map to the changed workflow or an unrelated legacy surface?`
    );
  }
  return questions;
}
function reviewCommandSuggestions(args) {
  const base = [
    `expo98 --json ux-context --cwd ${shellArg2(args.cwd)} --metro-port ${args.metroPort}${args.componentFilter ? ` --component-filter ${shellArg2(args.componentFilter)}` : ""}`
  ];
  if (args.flags.changedGesture || args.flags.changedChrome || args.flags.changedNavigation || args.flags.addedVisibleControls || args.stage === "interaction") {
    base.push(
      `expo98 --json inspector probe --metro-port ${args.metroPort}`,
      `expo98 --json inspector toggle --metro-port ${args.metroPort}`,
      `expo98 --json inspector install-comment-menu --metro-port ${args.metroPort}`,
      "expo98 --json inspector open-dev-menu",
      `expo98 --json inspector read-comments --metro-port ${args.metroPort}`,
      `expo98 --json review-overlay scaffold --cwd ${shellArg2(args.cwd)}`,
      `expo98 --json review-overlay prepare --cwd ${shellArg2(args.cwd)} --serve true`,
      `expo98 --json review-overlay read --cwd ${shellArg2(args.cwd)}`
    );
  }
  if (args.flags.changedGesture || args.stage === "interaction") {
    base.push(
      `expo98 --json trace --action start --metro-port ${args.metroPort}${args.componentFilter ? ` --component-filter ${shellArg2(args.componentFilter)}` : ""}`,
      "# reproduce the representative gesture in the simulator, or use expo98 gesture when coordinates are known",
      "expo98 --json gesture drag --start-x <x1> --start-y <y1> --end-x <x2> --end-y <y2> --duration-ms 900 --capture-before-after true",
      "expo98 --json gesture long-press --x <x> --y <y> --duration-ms 900 --capture-before-after true",
      `expo98 --json trace --action read --metro-port ${args.metroPort} --max-events 200`,
      `expo98 --json trace --action stop --metro-port ${args.metroPort}`
    );
  }
  if (!args.flags.hasStaticVerifier && args.stage !== "intake") {
    base.push("verify-native-experience <expo-app> --strict");
  }
  return base;
}
function reviewStopConditions(args) {
  const stops = [];
  if (!args.flags.hasAcceptanceContract)
    stops.push("Stop before patching: acceptance contract is missing.");
  if (args.flags.changedGesture && !args.flags.hasInteractionProof)
    stops.push("Stop before handoff: gesture/direct-manipulation proof is missing.");
  if (args.flags.changedChrome && !args.flags.hasInteractionProof)
    stops.push("Stop before handoff: tab/header/safe-area behavior has not been exercised.");
  if (args.verifierRule && verifierRuleMatchesChangedWorkflow(args.verifierRule, args.flags)) {
    stops.push(
      `Stop before handoff: verifier rule ${args.verifierRule} maps to the changed workflow.`
    );
  }
  return stops;
}
function verifierRuleMatchesChangedWorkflow(rule, flags) {
  const normalized = String(rule ?? "").toLowerCase();
  if (flags.changedGesture && /(gesture|panresponder|reanimated|handler|swipe|drag)/.test(normalized))
    return true;
  if ((flags.changedChrome || flags.changedNavigation) && /(tab|safe|navigation|header|sheet|modal|back)/.test(normalized))
    return true;
  if (/(text|button|row|visible|wrapper)/.test(normalized)) return true;
  return false;
}
function reviewFlags(args) {
  return {
    hasAcceptanceContract: args.hasAcceptanceContract === true,
    hasScreenshot: args.hasScreenshot === true,
    hasInteractionProof: args.hasInteractionProof === true,
    hasStaticVerifier: args.hasStaticVerifier === true,
    changedGesture: args.changedGesture === true,
    changedChrome: args.changedChrome === true,
    changedNavigation: args.changedNavigation === true,
    addedVisibleControls: args.addedVisibleControls === true
  };
}
function shellArg2(value) {
  const text = String(value);
  if (/^[A-Za-z0-9_./:@=-]+$/.test(text)) return text;
  return `'${text.replace(/'/g, "'\\''")}'`;
}
function requireOptionalString8(value) {
  if (value == null) return void 0;
  if (typeof value !== "string") throw new Error("Expected optional string.");
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : void 0;
}
function clampNumber18(value, min, max) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return min;
  return Math.max(min, Math.min(max, Math.trunc(numberValue)));
}

// src/commands/rn-introspection/src/main/index.ts
import { readdir as readdir10, readFile as readFile20 } from "node:fs/promises";
import { basename as basename11, join as join15, resolve as resolve15 } from "node:path";
async function rnCommand(args = {}, deps = defaultRnDependencies) {
  const positionals = Array.isArray(args._) ? args._ : [];
  const action = requireString21(args.action ?? positionals[0] ?? "tree", "action");
  if (!["tree", "inspect", "renders", "fiber"].includes(action))
    throw new Error(`Unknown React Native action: ${action}`);
  if (action === "inspect") return toolJson(await rnInspectPayload(args, deps));
  const subaction = action === "renders" ? requireString21(args.subaction ?? positionals[1] ?? "read", "subaction") : null;
  if (subaction && !["start", "stop", "read"].includes(subaction))
    throw new Error(`Unknown React Native renders action: ${subaction}`);
  const bridgeAction = action === "renders" ? `renders-${subaction}` : action;
  if (!deps.bridgeDomainCommand) {
    return toolJson({
      available: false,
      action,
      code: "transport-failure",
      reason: "No React Native bridge dependency is configured.",
      realValidation: rnRealValidation({ available: false }, action, subaction),
      limitations: rnLimitations(void 0)
    });
  }
  const bridgePayload = await deps.bridgeDomainCommand({
    args,
    domain: "rn",
    action: bridgeAction,
    expression: rnExpression({
      action: bridgeAction,
      ref: args.ref,
      depth: args.depth,
      limit: args.limit
    }),
    policy: {
      checked: true,
      action: `rn.${bridgeAction}`,
      sideEffect: "read",
      allowed: true,
      reason: "React Native introspection is read-only."
    }
  });
  const outputPayload = action === "tree" && !wantsRawOutput(args) ? summarizeRnTreePayload(bridgePayload) : bridgePayload;
  return toolJson({
    ...outputPayload,
    action,
    ...subaction ? { subaction, bridgeAction } : {},
    realValidation: rnRealValidation(outputPayload, action, subaction),
    limitations: rnLimitations(outputPayload.limitations)
  });
}
var defaultRnDependencies = {
  bridgeDomainCommand: defaultBridgeDomainCommand
};
async function defaultBridgeDomainCommand(request) {
  return bridgeDomainCommand(request);
}
async function rnInspectPayload(args = {}, deps = {}) {
  const positionals = Array.isArray(args._) ? args._ : [];
  const ref = requireString21(args.ref ?? positionals[1] ?? positionals[0], "ref");
  const cache = await readLatestRefCache6(args, deps);
  if (!cache) {
    return {
      available: false,
      action: "inspect",
      ref,
      sources: ["snapshot-cache"],
      reason: "No snapshot exists for the current session.",
      limitations: rnLimitations()
    };
  }
  const record = (cache.refs ?? []).find((item) => item.ref === ref);
  if (!record) {
    return {
      available: false,
      action: "inspect",
      ref,
      sources: ["native-accessibility", "snapshot-cache"],
      reason: "Ref not found in the latest snapshot.",
      snapshotId: cache.snapshotId,
      targetId: cache.targetId,
      limitations: rnLimitations()
    };
  }
  return {
    available: true,
    action: "inspect",
    ref,
    sources: ["native-accessibility", "snapshot-cache"],
    snapshotId: cache.snapshotId,
    targetId: cache.targetId,
    record,
    limitations: rnLimitations([
      "Inspect uses cached semantic/native accessibility evidence and does not expose private fiber internals."
    ])
  };
}
function rnExpression({
  action,
  ref,
  depth,
  limit
}) {
  return `(() => {
    const action = ${JSON.stringify(action)};
    const ref = ${JSON.stringify(ref ?? null)};
    const maxDepth = Math.max(1, Math.min(Number(${JSON.stringify(depth ?? 30)}) || 30, 80));
    const maxNodes = Math.max(1, Math.min(Number(${JSON.stringify(limit ?? 500)}) || 500, 2000));
    const bridge = globalThis.__EXPO98_RN_BRIDGE__ ||
      globalThis.__EXPO_IOS_RN_BRIDGE__ ||
      (globalThis.__EXPO98_INSTRUMENTATION__?.rn || globalThis.__EXPO_IOS_INSTRUMENTATION__?.rn);
    const bridgeTree = () => bridge && bridge.tree ? bridge.tree() : bridge ? { available: true, sources: ['runtime', 'app-instrumentation'], action, tree: bridge.tree || [] } : null;
    const isRouterShellOnly = (payload) => {
      const tree = payload && Array.isArray(payload.tree) ? payload.tree : [];
      if (tree.length !== 1) return false;
      const root = tree[0] || {};
      const children = Array.isArray(root.children) ? root.children : [];
      return String(root.name || '') === 'RootLayout' && children.length === 1 && String(children[0]?.name || '') === 'ExpoRouterStack';
    };
    const tagName = (tag) => ({
      0: 'FunctionComponent',
      1: 'ClassComponent',
      3: 'HostRoot',
      5: 'HostComponent',
      6: 'HostText',
      7: 'Fragment',
      9: 'ContextConsumer',
      10: 'ContextProvider',
      11: 'ForwardRef',
      13: 'Suspense',
      14: 'MemoComponent',
      15: 'SimpleMemoComponent',
      22: 'Offscreen',
    })[tag] || 'Fiber';
    const componentName = (fiber) => {
      const type = fiber && (fiber.elementType || fiber.type);
      if (typeof type === 'string') return type;
      if (typeof type === 'function') return type.displayName || type.name || tagName(fiber.tag);
      if (type && typeof type === 'object') {
        if (typeof type.displayName === 'string') return type.displayName;
        if (typeof type.name === 'string') return type.name;
        if (type.render) return type.render.displayName || type.render.name || 'ForwardRef';
        if (type.type) {
          const nested = type.type;
          if (typeof nested === 'function') return nested.displayName || nested.name || tagName(fiber.tag);
          if (typeof nested === 'string') return nested;
          if (nested && typeof nested.displayName === 'string') return nested.displayName;
        }
      }
      return tagName(fiber && fiber.tag);
    };
    const textFromProps = (props) => {
      if (typeof props === 'string' || typeof props === 'number') return String(props);
      if (!props || typeof props !== 'object') return null;
      const children = props.children;
      if (typeof children === 'string' || typeof children === 'number') return String(children);
      if (Array.isArray(children)) {
        const text = children.filter((item) => typeof item === 'string' || typeof item === 'number').join('');
        return text || null;
      }
      return null;
    };
    const compactProps = (fiber) => {
      const props = fiber && fiber.memoizedProps && typeof fiber.memoizedProps === 'object' ? fiber.memoizedProps : {};
      const out = {};
      for (const key of ['testID', 'testId', 'nativeID', 'accessibilityLabel', 'accessibilityRole', 'accessibilityHint', 'placeholder', 'placeholderText', 'href', 'disabled']) {
        const value = props[key];
        if (value == null) continue;
        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') out[key] = value;
      }
      const text = textFromProps(props);
      if (text) out.text = text;
      return out;
    };
    const sourceFromFiber = (fiber) => {
      const source = fiber && fiber._debugSource;
      if (!source || typeof source !== 'object') return null;
      return {
        fileName: source.fileName || null,
        lineNumber: source.lineNumber || null,
        columnNumber: source.columnNumber || null,
      };
    };
    const serializeFiberTree = () => {
      const hook = globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__;
      if (!hook || typeof hook.getFiberRoots !== 'function' || !hook.renderers) {
        return { available: false, source: 'react-devtools-hook', reason: 'React DevTools fiber roots are not available.', action };
      }
      const roots = [];
      for (const rendererId of Array.from(hook.renderers.keys())) {
        for (const root of Array.from(hook.getFiberRoots(rendererId) || [])) roots.push({ rendererId, root });
      }
      let nodeCount = 0;
      const seen = new Set();
      const walk = (fiber, depth) => {
        if (!fiber || seen.has(fiber) || depth > maxDepth || nodeCount >= maxNodes) return null;
        seen.add(fiber);
        nodeCount += 1;
        const children = [];
        let child = fiber.child;
        while (child && nodeCount < maxNodes) {
          const serialized = walk(child, depth + 1);
          if (serialized) children.push(serialized);
          child = child.sibling;
        }
        const props = compactProps(fiber);
        const node = {
          name: componentName(fiber),
          tag: tagName(fiber.tag),
          key: fiber.key == null ? null : String(fiber.key),
          props: Object.keys(props).length ? props : undefined,
          source: sourceFromFiber(fiber),
          children,
        };
        if (!node.source) delete node.source;
        if (!node.children.length) delete node.children;
        return node;
      };
      const tree = roots.map(({ rendererId, root }) => {
        const current = root && root.current;
        const node = walk(current, 0);
        return node ? { rendererId, ...node } : null;
      }).filter(Boolean);
      return {
        available: tree.length > 0,
        action,
        source: 'react-devtools-hook',
        sources: ['runtime', 'react-devtools-hook'],
        tree,
        rootCount: roots.length,
        nodeCount,
        truncated: nodeCount >= maxNodes,
        limits: { maxDepth, maxNodes },
        bridgeTree: null,
      };
    };
    if (action === 'tree') {
      const payload = bridgeTree();
      const fiberPayload = serializeFiberTree();
      if (fiberPayload.available && (!payload || isRouterShellOnly(payload))) return { ...fiberPayload, bridgeTree: payload };
      if (payload) return payload;
      return fiberPayload;
    }
    if (!bridge) return { available: false, sources: ['runtime', 'app-instrumentation'], source: 'app-instrumentation', reason: 'React Native bridge is not installed.', action };
    if (action === 'fiber') return bridge.fiber ? bridge.fiber(ref) : { available: false, sources: ['runtime', 'app-instrumentation'], action, ref, reason: 'Fiber inspection is not exposed by the app bridge.' };
    const perfBridge = globalThis.__EXPO98_PERF_BRIDGE__ ||
      globalThis.__EXPO_IOS_PERF_BRIDGE__ ||
      (globalThis.__EXPO98_INSTRUMENTATION__?.performance || globalThis.__EXPO_IOS_INSTRUMENTATION__?.performance);
    if (action === 'renders-start') {
      if (bridge.renders && bridge.renders.start) return bridge.renders.start();
      if (perfBridge?.renders?.start) return perfBridge.renders.start();
      return { available: true, sources: ['runtime', 'app-instrumentation'], action, renders: { recording: true, commits: [] } };
    }
    if (action === 'renders-stop') {
      if (bridge.renders && bridge.renders.stop) return bridge.renders.stop();
      if (perfBridge?.renders?.stop) return perfBridge.renders.stop();
      return { available: true, sources: ['runtime', 'app-instrumentation'], action, renders: { recording: false, commits: [] } };
    }
    if (action === 'renders-read') {
      if (bridge.renders && bridge.renders.read) return bridge.renders.read();
      if (perfBridge?.renders?.read) return perfBridge.renders.read();
      return { available: true, sources: ['runtime', 'app-instrumentation'], action, renders: { recording: false, commits: [] } };
    }
    return { available: false, sources: ['runtime', 'app-instrumentation'], source: 'app-instrumentation', reason: 'Unsupported React Native bridge action.', action };
  })()`;
}
function rnRealValidation(payload, action, subaction) {
  if (payload.available === false) {
    return realValidation({
      state: "unvalidated",
      evidence: [
        {
          source: String(payload.source ?? "react-native"),
          command: `rn.${action}`,
          confidence: "low"
        }
      ],
      missingEvidence: [
        {
          signal: "react-native-runtime-bridge",
          reason: String(payload.reason ?? "React Native runtime evidence was unavailable."),
          recommendedFix: "Launch a Hermes dev target and mount the dev-only RN bridge/profiler instrumentation."
        }
      ]
    });
  }
  const commits = Array.isArray(payload.renders?.commits) ? payload.renders.commits : [];
  const hasCommitDurations = commits.some(
    (commit) => Number.isFinite(Number(commit.durationMs ?? commit.actualDuration))
  );
  if (action === "renders") {
    return realValidation({
      state: hasCommitDurations ? "validated" : "partial",
      claimsAllowed: { renderCost: hasCommitDurations },
      evidence: [
        {
          source: String(payload.source ?? payload.sources?.[0] ?? "app-instrumentation"),
          command: `rn.renders.${subaction ?? "read"}`,
          confidence: hasCommitDurations ? "medium" : "low"
        }
      ],
      missingEvidence: hasCommitDurations ? [] : [
        {
          signal: "react-profiler-commit-durations",
          reason: "Render bridge returned no commit duration records.",
          recommendedFix: "Mount a React Profiler wrapper in development and rerun rn renders start/read/stop."
        }
      ]
    });
  }
  return realValidation({
    state: "validated",
    evidence: [
      {
        source: String(payload.source ?? payload.sources?.[0] ?? "react-native"),
        command: `rn.${action}`,
        confidence: "medium"
      }
    ]
  });
}
function rnLimitations(extra = []) {
  return [
    ...extra.map(String),
    "private React Native hooks and fiber fields are version-dependent and may be incomplete or unavailable."
  ];
}
async function readLatestRefCache6(args = {}, deps = {}) {
  if (deps.readLatestRefCache) return deps.readLatestRefCache(args);
  const stateRoot = resolveExpoStateRoot11(args);
  const session = await readLatestSession7(stateRoot);
  if (!session?.lastSnapshotId) return null;
  return readJsonFile11(
    join15(sessionDirectory5(stateRoot, String(session.sessionId)), "refs.json")
  ).catch(() => null);
}
async function readLatestSession7(stateRoot) {
  const sessionsRoot = join15(stateRoot, "sessions");
  const entries = await readdir10(sessionsRoot, { withFileTypes: true }).catch(() => []);
  const sessions = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const record = await readJsonFile11(join15(sessionsRoot, entry.name, "session.json")).catch(
      () => null
    );
    if (record) sessions.push(record);
  }
  sessions.sort(
    (a, b) => String(asRecord18(b)?.updatedAt ?? asRecord18(b)?.createdAt).localeCompare(
      String(asRecord18(a)?.updatedAt ?? asRecord18(a)?.createdAt)
    )
  );
  return asRecord18(sessions[0]);
}
function resolveExpoStateRoot11(args = {}) {
  if (args.stateDir) {
    const resolved = resolve15(args.stateDir);
    return basename11(resolved) === "runs" ? resolve15(join15(resolved, "..")) : resolved;
  }
  const root = resolve15(args.root ?? args.cwd ?? process.cwd());
  return join15(root, ".scratch", "expo98");
}
function sessionDirectory5(stateRoot, sessionId) {
  return join15(stateRoot, "sessions", sessionId);
}
async function readJsonFile11(file) {
  return JSON.parse(await readFile20(file, "utf8"));
}
function requireString21(value, name) {
  if (typeof value !== "string" || value.trim().length === 0)
    throw new Error(`${name} must be a non-empty string.`);
  return value.trim();
}
function asRecord18(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}
function wantsRawOutput(args) {
  return args.raw === true || args.detail === "raw" || args.detail === "full";
}
function summarizeRnTreePayload(payload) {
  if (payload.available === false) return payload;
  const tree = Array.isArray(payload.tree) ? payload.tree : [];
  const elements = Array.isArray(payload.elements) ? payload.elements : [];
  const target = compactTarget(payload.target);
  const viewport = asRecord18(payload.viewport);
  const structure = compactStructure(tree, elements);
  const visibleText = visibleTextRecords(elements);
  const controls = controlRecords(elements, visibleText);
  const componentPath = inferComponentPath(tree, elements);
  return {
    available: payload.available !== false,
    source: payload.source,
    sources: payload.sources,
    evidenceSource: payload.evidenceSource,
    domain: payload.domain,
    action: payload.action,
    route: payload.route ?? payload.routeHint ?? null,
    screen: {
      route: componentPath.find((name) => /^Route\(/.test(name)) ?? null,
      component: componentPath.find((name) => /Route\(|Layout|Screen|SignIn|Schedule|Console/.test(name)) ?? null,
      path: componentPath
    },
    counts: {
      sampledElements: numberOrNull2(payload.elementCount) ?? (elements.length || null),
      relevantNodes: countRelevantNodes(structure),
      visibleText: visibleText.length,
      controls: controls.length,
      rawTreeRoots: tree.length || null
    },
    viewport: viewport ? pickDefined4({
      width: viewport.width,
      height: viewport.height,
      scale: viewport.scale,
      fontScale: viewport.fontScale
    }) : null,
    target,
    structure,
    visibleText,
    controls,
    rawAvailable: true,
    rawHint: "Rerun rn tree with --raw true for full component stacks, CDP transport, and unpruned trees.",
    limitations: [
      "Output is pruned for agent relevance; infrastructure wrappers, native host views, component stacks, and transport internals are omitted by default.",
      ...arrayOfStrings(payload.limitations)
    ]
  };
}
function compactTarget(value) {
  const target = asRecord18(value);
  if (!target) return null;
  return pickDefined4({
    appId: target.appId,
    deviceName: target.deviceName,
    title: target.title
  });
}
function compactStructure(tree, elements) {
  const fromTree = flattenTreeResults(tree.flatMap((node) => simplifyTreeNode(node, 0)));
  if (fromTree.length > 0) return fromTree.slice(0, 80);
  return pathTreeFromElements(elements);
}
function simplifyTreeNode(value, depth) {
  if (depth > 60) return [];
  const node = asRecord18(value);
  if (!node) return [];
  const name = nodeName(node);
  const element = asRecord18(node.element);
  const children = Array.isArray(node.children) ? node.children.flatMap((child) => simplifyTreeNode(child, depth + 1)) : [];
  const details = elementDetails(element ?? node);
  const meaningful = isRelevantName(name) || Object.keys(details).length > 0;
  if (!meaningful) return children;
  return [
    pickDefined4({
      component: name,
      ...details,
      children: children.length > 0 ? children : void 0
    })
  ];
}
function flattenTreeResults(nodes) {
  const compacted = [];
  for (const node of nodes) {
    const children = Array.isArray(node.children) ? flattenTreeResults(node.children) : [];
    compacted.push({ ...node, ...children.length > 0 ? { children } : {} });
  }
  return compacted;
}
function pathTreeFromElements(elements) {
  const root = { component: "root", children: /* @__PURE__ */ new Map() };
  for (const element of elements) {
    const path16 = relevantPathFromElement(element);
    if (path16.length === 0) continue;
    let cursor = root;
    for (const name of path16) {
      let child = cursor.children.get(name);
      if (!child) {
        child = { component: name, children: /* @__PURE__ */ new Map() };
        cursor.children.set(name, child);
      }
      cursor = child;
    }
    const details = elementDetails(element);
    Object.assign(cursor, details);
  }
  return [...root.children.values()].map(pathNodeToRecord);
}
function pathNodeToRecord(node) {
  const children = [...node.children.values()].map(pathNodeToRecord);
  return pickDefined4({
    component: node.component,
    label: node.label,
    role: node.role,
    testID: node.testID,
    box: node.box,
    children: children.length > 0 ? children : void 0
  });
}
function visibleTextRecords(elements) {
  const records = [];
  const seen = /* @__PURE__ */ new Set();
  for (const element of elements) {
    const label = optionalNonemptyString(element.label ?? asRecord18(element.element)?.label);
    if (!label || seen.has(label)) continue;
    const name = optionalNonemptyString(element.name ?? asRecord18(element.element)?.name);
    const role = optionalNonemptyString(element.role ?? asRecord18(element.element)?.role);
    const testID = optionalNonemptyString(element.testID ?? asRecord18(element.element)?.testID);
    if (role || testID || name === "Text" || name === "RCTText" || label.length > 1) {
      seen.add(label);
      records.push(
        pickDefined4({
          text: label,
          component: name,
          path: relevantPathFromElement(element),
          box: boxFromFrame(element.frame ?? asRecord18(element.element)?.frame)
        })
      );
    }
  }
  return records.slice(0, 80);
}
function controlRecords(elements, textRecords) {
  const controls = [];
  for (const element of elements) {
    const elementRecord = asRecord18(element.element) ?? element;
    const role = optionalNonemptyString(element.role ?? elementRecord.role);
    const testID = optionalNonemptyString(element.testID ?? elementRecord.testID);
    const name = optionalNonemptyString(element.name ?? elementRecord.name);
    const isInput = /TextInput|Input/i.test(String(name));
    if (!role && !testID && !isInput) continue;
    const box = boxFromFrame(element.frame ?? elementRecord.frame);
    const inferredLabel = optionalNonemptyString(element.label ?? elementRecord.label) ?? inferControlLabel(box, textRecords);
    controls.push(
      pickDefined4({
        type: isInput ? "input" : role ?? "control",
        label: inferredLabel,
        testID,
        component: name,
        path: relevantPathFromElement(element),
        box
      })
    );
  }
  return controls.slice(0, 60);
}
function inferControlLabel(box, textRecords) {
  if (!box) return void 0;
  for (const record of textRecords) {
    const textBox = asRecord18(record.box);
    if (!textBox) continue;
    const centerX = Number(textBox.x) + Number(textBox.width) / 2;
    const centerY = Number(textBox.y) + Number(textBox.height) / 2;
    if (centerX >= box.x && centerX <= box.x + box.width && centerY >= box.y && centerY <= box.y + box.height) {
      return String(record.text);
    }
  }
  return void 0;
}
function inferComponentPath(tree, elements) {
  for (const element of elements) {
    const path17 = relevantPathFromElement(element).filter(
      (name) => !["Text", "View", "Pressable", "SymbolModule"].includes(name)
    );
    if (path17.length > 0) return path17.slice(0, 16);
  }
  const path16 = [];
  let cursor = asRecord18(tree[0]);
  let depth = 0;
  while (cursor && depth < 40) {
    const name = nodeName(cursor);
    if (isRelevantName(name)) path16.push(name);
    const child = Array.isArray(cursor.children) ? asRecord18(cursor.children[0]) : null;
    cursor = child;
    depth += 1;
  }
  return unique(path16).slice(0, 16);
}
function relevantPathFromElement(element) {
  const hierarchy = Array.isArray(element.hierarchy) ? element.hierarchy : [];
  const path16 = hierarchy.map((item) => nodeName(item)).filter((name) => Boolean(name && isRelevantName(name)));
  const elementName = optionalNonemptyString(element.name);
  if (elementName && isRelevantName(elementName)) path16.push(elementName);
  return unique(path16).slice(0, 24);
}
function nodeName(value) {
  const record = asRecord18(value);
  return optionalNonemptyString(record?.name ?? record?.component) ?? null;
}
function isRelevantName(name) {
  if (!name) return false;
  if (/^RCT|^RNC|^RNS|ViewManagerAdapter|HostRoot|HostComponent|HostText/.test(name)) return false;
  if (WRAPPER_NAMES.has(name)) return false;
  if (/^(Screen|ScreenStack|ScreenStackItem|InnerScreen|Suspender|Freeze|DelayedFreeze)$/.test(name))
    return false;
  if (/^(View|Animated\(View\)|ScrollView|Text)$/.test(name)) return false;
  return true;
}
var WRAPPER_NAMES = /* @__PURE__ */ new Set([
  "withDevTools(App)",
  "App",
  "ExpoRoot",
  "ContextNavigator",
  "Content",
  "SceneView",
  "WrappedScreenComponent",
  "Anonymous",
  "anonymous",
  "ForwardRef",
  "StaticContainer",
  "EnsureSingleNavigator",
  "NavigationProvider",
  "PreventRemoveProvider",
  "NavigationStateListenerProvider",
  "NavigationContent",
  "BaseNavigationContainer",
  "NavigationContainerInner",
  "ThemeProvider",
  "SafeAreaProvider",
  "SafeAreaProviderCompat",
  "RNCSafeAreaProvider",
  "RNSSafeAreaView",
  "NativeStackNavigator",
  "Screen"
]);
function elementDetails(element) {
  const label = optionalNonemptyString(element.label);
  const text = optionalNonemptyString(element.text);
  const role = optionalNonemptyString(element.role);
  const testID = optionalNonemptyString(element.testID);
  const box = boxFromFrame(element.frame ?? element.box);
  const actions = Array.isArray(element.actions) && element.actions.length > 0 ? element.actions.map(String).slice(0, 10) : void 0;
  return pickDefined4({ label, text, role, testID, box, actions });
}
function boxFromFrame(value) {
  const frame = asRecord18(value);
  if (!frame) return void 0;
  const x = numberOrNull2(frame.x ?? frame.left);
  const y = numberOrNull2(frame.y ?? frame.top);
  const width = numberOrNull2(frame.width);
  const height = numberOrNull2(frame.height);
  if (x == null || y == null || width == null || height == null) return void 0;
  return { x: round(x), y: round(y), width: round(width), height: round(height) };
}
function countRelevantNodes(nodes) {
  let count = 0;
  for (const node of nodes) {
    count += 1;
    if (Array.isArray(node.children))
      count += countRelevantNodes(node.children);
  }
  return count;
}
function arrayOfStrings(value) {
  return Array.isArray(value) ? value.map(String) : [];
}
function optionalNonemptyString(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : void 0;
}
function numberOrNull2(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
function round(value) {
  return Math.round(value * 100) / 100;
}
function unique(values) {
  const seen = /* @__PURE__ */ new Set();
  return values.filter((value) => {
    if (seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}
function pickDefined4(record) {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== void 0));
}

// src/commands/router-sitemap/src/main/index.ts
import { promises as fs9 } from "node:fs";
import path13 from "node:path";
function routeFromFile(relativeFile, dependencies = {}) {
  const paths = dependencies.path ?? defaultPath2;
  const noExt = relativeFile.replace(/\.(jsx?|tsx?)$/, "");
  const rawSegments = noExt.split(paths.sep);
  if (rawSegments.some((segment) => segment === "_layout")) return { kind: "layout" };
  if (rawSegments.some((segment) => segment.startsWith("+"))) return { kind: "special" };
  const segments = [];
  for (const rawSegment of rawSegments) {
    if (rawSegment === "index") continue;
    if (/^\(.+\)$/.test(rawSegment)) continue;
    segments.push(formatRouteSegment(rawSegment));
  }
  return { kind: "route", route: `/${segments.join("/")}`.replace(/\/$/, "") || "/", segments };
}
async function walkFiles(root, dependencies = {}) {
  const deps = resolveDependencies(dependencies);
  const entries = await deps.fs.readdir(root, { withFileTypes: true });
  const result = [];
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = deps.path.join(root, entry.name);
    if (entry.isDirectory()) {
      result.push(...await walkFiles(full, dependencies));
    } else if (entry.isFile()) {
      result.push(full);
    }
  }
  return result;
}
async function expoRouterSitemap(args = {}, dependencies = {}) {
  const deps = resolveDependencies(dependencies);
  const cwd = await normalizeCwd3(args.cwd, deps);
  const appDir = deps.path.resolve(cwd, args.appDir ?? "app");
  if (!await deps.fs.pathExists(appDir)) {
    return toolJson({
      cwd,
      appDir,
      routes: [],
      specialFiles: [],
      warning: "App directory was not found."
    });
  }
  const { routes, specialFiles } = await collectRoutes(appDir, deps, { sortSpecialFiles: true });
  return toolJson({ cwd, appDir, routeCount: routes.length, routes, specialFiles });
}
async function expoRouteContext(cwd, dependencies = {}) {
  const deps = resolveDependencies(dependencies);
  const appDir = deps.path.join(cwd, "app");
  const appExists = await deps.fs.pathExists(appDir);
  const { routes, specialFiles } = appExists ? await collectRoutes(appDir, deps) : { routes: [], specialFiles: [] };
  const typedRoutesPath = deps.path.join(cwd, ".expo", "types", "router.d.ts");
  const hasTypedRoutes = await deps.fs.pathExists(typedRoutesPath);
  const typedRoutes = hasTypedRoutes ? parseTypedRoutes(await deps.fs.readFile(typedRoutesPath, "utf8")) : [];
  return {
    appDir: appExists ? appDir : null,
    routeCount: routes.length,
    routes,
    specialFiles,
    typedRoutesPath: hasTypedRoutes ? typedRoutesPath : null,
    typedRoutes
  };
}
async function collectRoutes(appDir, deps, options = {}) {
  const files = await walkFiles(appDir, { fs: deps.fs, path: deps.path });
  const routeFiles = files.filter((file) => /\.(jsx?|tsx?)$/.test(file));
  const routes = [];
  const specialFiles = [];
  for (const file of routeFiles) {
    const parsed = routeFromFile(deps.path.relative(appDir, file), { path: deps.path });
    if (parsed.kind === "route") {
      routes.push({ route: parsed.route, file, segments: parsed.segments });
    } else {
      specialFiles.push({ kind: parsed.kind, file });
    }
  }
  routes.sort((a, b) => a.route.localeCompare(b.route));
  if (options.sortSpecialFiles) specialFiles.sort((a, b) => a.file.localeCompare(b.file));
  return { routes, specialFiles };
}
function formatRouteSegment(segment) {
  if (/^\[\.\.\..+\]$/.test(segment)) return `*${segment.slice(4, -1)}`;
  if (/^\[\[.+\]\]$/.test(segment)) return `:${segment.slice(2, -2)}?`;
  if (/^\[.+\]$/.test(segment)) return `:${segment.slice(1, -1)}`;
  return segment;
}
function parseTypedRoutes(source) {
  return [
    ...new Set(
      source.match(/pathname:\s*`([^`]+)`/g)?.map((match) => match.replace(/^pathname:\s*`|`$/g, "")) ?? []
    )
  ].sort();
}
async function normalizeCwd3(cwd, deps) {
  const resolved = deps.path.resolve(cwd ?? deps.processCwd);
  const stat8 = await deps.fs.stat(resolved);
  if (!stat8?.isDirectory()) throw new Error(`Directory does not exist: ${resolved}`);
  return resolved;
}
function resolveDependencies(dependencies) {
  const paths = dependencies.path ?? defaultPath2;
  return {
    fs: {
      stat: dependencies.fs?.stat ?? defaultStat,
      pathExists: dependencies.fs?.pathExists ?? defaultPathExists2,
      readdir: dependencies.fs?.readdir ?? defaultReaddir,
      readFile: dependencies.fs?.readFile ?? defaultReadFile
    },
    path: paths,
    processCwd: dependencies.processCwd ?? "."
  };
}
var defaultPath2 = {
  sep: path13.sep,
  resolve: (...parts) => path13.resolve(...parts.filter((part) => Boolean(part))),
  join: (...parts) => path13.join(...parts),
  relative: (from, to) => path13.relative(from, to)
};
async function defaultStat(filePath) {
  return fs9.stat(filePath).catch(() => null);
}
async function defaultPathExists2(filePath) {
  return fs9.access(filePath).then(
    () => true,
    () => false
  );
}
async function defaultReaddir(dirPath, options) {
  return fs9.readdir(dirPath, options);
}
async function defaultReadFile(filePath, encoding) {
  return fs9.readFile(filePath, encoding);
}

// src/commands/runtime-inspector-actions/src/main/index.ts
import { execFile as nodeExecFile10 } from "node:child_process";
import { readFile as readFile21 } from "node:fs/promises";
import path14 from "node:path";
var INSPECTOR_ACTIONS = [
  "probe",
  "toggle",
  "install-comment-menu",
  "read-comments",
  "clear-comments",
  "open-dev-menu"
];
async function runtimeInspector(args, deps = defaultRuntimeInspectorDependencies) {
  const metroPort = clampNumber19(args.metroPort ?? 8081, 1, 65535);
  const action = normalizeRuntimeInspectorAction(args.action ?? "probe");
  const commentTitle = requireOptionalString9(args.commentTitle) ?? "Codex: Add UI comment";
  const maxComments = clampNumber19(args.maxComments ?? 50, 1, 500);
  if (action === "open-dev-menu") {
    return toolJson(await deps.openIosDevMenu({ ...args, metroPort }));
  }
  const targets = await deps.fetchMetroTargets(metroPort).catch(() => []);
  const targetList = Array.isArray(targets) ? targets : [];
  const webSocketDebuggerUrl = asString2(asRecord19(targetList[0])?.webSocketDebuggerUrl);
  if (!webSocketDebuggerUrl) {
    return toolJson({ available: false, action, reason: "No Metro inspector target.", metroPort });
  }
  const expression = runtimeInspectorExpression({ action, commentTitle, maxComments });
  const result = await deps.evaluateHermesExpression(webSocketDebuggerUrl, expression, {
    timeoutMs: 8e3
  });
  return toolJson({
    action,
    metroPort,
    target: targetSummary9(targetList[0]),
    inspector: getPath2(result, ["result", "result", "value"]) ?? null,
    protocolError: getPath2(result, ["result", "exceptionDetails"]) ?? asRecord19(result)?.error ?? null,
    cdp: asRecord19(result)?.diagnostics ?? asRecord19(result)?.cdp ?? null
  });
}
var defaultRuntimeInspectorDependencies = {
  fetchMetroTargets: (metroPort) => metroTargets(metroPort),
  evaluateHermesExpression,
  openIosDevMenu: (args) => openIosDevMenu(args, defaultOpenDevMenuDependencies)
};
var defaultOpenDevMenuDependencies = {
  broadcastMetroMessage,
  resolveIosDevice: (device, options) => resolveIosDevice(requireOptionalString9(device), options),
  openDevClientForMessageSocket: async (args) => unwrapToolJson(
    await openExpoRoute({
      device: args.device.udid,
      bundleId: args.bundleId,
      url: args.devClientUrl
    })
  ),
  execFile: execFile8,
  readJsonFile: async (file) => JSON.parse(await readFile21(file, "utf8")),
  resolvePath: (file) => path14.resolve(file),
  truncate: truncate14
};
function normalizeRuntimeInspectorAction(value) {
  const action = requireString22(value, "action");
  if (!INSPECTOR_ACTIONS.includes(action)) {
    throw new Error(`Unknown inspector action: ${action}`);
  }
  return action;
}
async function openIosDevMenu(args, deps) {
  const metroPort = clampNumber19(args.metroPort ?? 8081, 1, 65535);
  const policy = await policyDecision(args, "open-dev-menu", "device", deps);
  if (!policy.allowed) {
    return policyDeniedPayload({ domain: "runtime-inspector", action: "open-dev-menu", policy });
  }
  let messageSocket = await deps.broadcastMetroMessage(metroPort, "devMenu");
  if (messageSocket.available) {
    return {
      available: true,
      action: "open-dev-menu",
      platform: "ios",
      transport: "metro-message-socket",
      metroPort,
      requestedDevice: args.device ?? null,
      messageSocket,
      note: "This uses Expo/Metro's /message websocket devMenu broadcast, matching the Expo CLI toggle developer menu path."
    };
  }
  const device = await deps.resolveIosDevice(args.device, { preferBooted: true });
  const devClientUrl = requireOptionalString9(args.devClientUrl);
  let devClientRepair = null;
  if (devClientUrl) {
    devClientRepair = await deps.openDevClientForMessageSocket({
      device,
      bundleId: args.bundleId,
      devClientUrl,
      restartDevClient: args.restartDevClient === true,
      metroPort,
      crashCheckMs: args.crashCheckMs
    });
    if (Array.isArray(devClientRepair.crashReports) && devClientRepair.crashReports.length > 0) {
      return {
        available: false,
        action: "open-dev-menu",
        platform: "ios",
        device,
        metroPort,
        devClientRepair,
        messageSocket,
        reason: "The app generated an iOS crash report after opening the development client URL."
      };
    }
    messageSocket = await deps.broadcastMetroMessage(metroPort, "devMenu");
    if (messageSocket.available) {
      return {
        available: true,
        action: "open-dev-menu",
        platform: "ios",
        transport: "metro-message-socket",
        metroPort,
        requestedDevice: args.device ?? null,
        device,
        devClientRepair,
        messageSocket,
        note: "Opened the supplied Expo development client URL, then used Metro's /message websocket devMenu broadcast."
      };
    }
  }
  const command = ["xcrun", "simctl", "io", device.udid, "shake"];
  const result = await deps.execFile(command[0], command.slice(1), {
    timeout: 15e3,
    rejectOnError: false
  });
  const truncateFn = deps.truncate ?? truncate14;
  return {
    available: !result.error,
    action: "open-dev-menu",
    platform: "ios",
    device,
    command,
    stdout: truncateFn(result.stdout),
    stderr: truncateFn(result.stderr),
    error: result.error,
    messageSocket,
    devClientRepair,
    note: "Tried Expo/Metro's /message websocket devMenu broadcast first, then fell back to the simulator shake gesture."
  };
}
function runtimeInspectorExpression(args) {
  return runtimeInspectorProgram([
    runtimeInspectorInputs(args),
    runtimeInspectorStateSection(),
    runtimeInspectorProbeSection(),
    runtimeInspectorCommentMenuSection(),
    runtimeInspectorDispatchSection()
  ]);
}
function runtimeInspectorProgram(sections) {
  return `(() => {
${sections.join("\n")}
  })()`;
}
function runtimeInspectorInputs(args) {
  return `    const action = ${JSON.stringify(args.action)};
    const commentTitle = ${JSON.stringify(args.commentTitle)};
    const maxComments = ${JSON.stringify(args.maxComments)};`;
}
function runtimeInspectorStateSection() {
  return `    const stateKey = '__CODEX_SIMULATOR_REVIEW__';
    const state = globalThis[stateKey] ||= {
      createdAt: new Date().toISOString(),
      comments: [],
      menuInstalled: false,
      commentTitle: null,
      errors: []
    };

    function commentSummary() {
      return {
        stateKey,
        menuInstalled: !!state.menuInstalled,
        commentTitle: state.commentTitle || null,
        commentCount: state.comments.length,
        comments: state.comments.slice(-maxComments),
        errors: state.errors.slice(-20)
      };
    }`;
}
function runtimeInspectorProbeSection() {
  return `    function capabilityProbe() {
      return {
        available: true,
        action,
        runtime: {
          dev: typeof __DEV__ !== 'undefined' ? __DEV__ : null,
          hermes: !!globalThis.HermesInternal,
          metroRequire: !!(globalThis.__r || globalThis.metroRequire),
          reactDevToolsHook: !!globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__
        },
        capabilities: {
          toggleElementInspector: false,
          devMenuCommentPrompt: false,
          alertPrompt: false,
          alertOnly: false
        },
        modules: {
          nativeDevSettings: null,
          devSettings: null,
          alert: null,
          nativeDevSettingsCandidates: [],
          devSettingsCandidates: [],
          alertCandidates: []
        },
        comments: commentSummary(),
        limitations: [
          'toggle uses React Native NativeDevSettings.toggleElementInspector, which is a native toggle rather than an explicit show/hide setter.',
          'dev-menu comments are simulator-side and readable by Codex, but they are not automatically attached to a tapped React element.',
          'Automatic element-bound comments require a dev-only overlay mounted in the app tree so it can capture coordinates and touch ownership.'
        ],
        recommendedWorkflow: [
          'Run inspector probe to confirm runtime hooks.',
          'Run inspector toggle to show the built-in RN element inspector in the simulator.',
          'Run inspector install-comment-menu, open the dev menu, and use the Codex comment item while reviewing ambiguous controls.',
          'Run inspector read-comments before final handoff and include comments in the acceptance matrix.'
        ]
      };
    }`;
}
function runtimeInspectorCommentMenuSection() {
  return `    function installCommentMenu() {
      state.menuInstalled = true;
      state.commentTitle = commentTitle;
      return {
        available: true,
        action,
        installed: true,
        comments: commentSummary(),
        instructions: [
          'Open the simulator dev menu.',
          'Choose ' + commentTitle + '.',
          'Type the element or workflow comment in the native prompt.',
          'Run inspector read-comments to retrieve the stored comments.'
        ],
        limitation: 'Comments entered this way are human-authored notes, not automatically bound to a touched element.'
      };
    }`;
}
function runtimeInspectorDispatchSection() {
  return `    if (action === 'probe') return capabilityProbe();
    if (action === 'toggle') return { available: false, action, reason: 'Native DevSettings.toggleElementInspector was not found in this Hermes runtime.', probe: capabilityProbe() };
    if (action === 'install-comment-menu') return installCommentMenu();
    if (action === 'read-comments') return { available: true, action, ...commentSummary() };
    if (action === 'clear-comments') {
      state.comments = [];
      return { available: true, action, ...commentSummary() };
    }
    return { available: false, action, reason: 'Unknown inspector action: ' + action };`;
}
function targetSummary9(target) {
  const record = asRecord19(target);
  if (!record) return null;
  return {
    title: record.title,
    appId: record.appId,
    deviceName: record.deviceName,
    description: record.description
  };
}
function clampNumber19(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new Error(`Expected a finite number, got ${value}.`);
  }
  return Math.min(Math.max(number, min), max);
}
function requireString22(value, field) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${field} must be a non-empty string.`);
  }
  return value.trim();
}
function requireOptionalString9(value) {
  if (value === void 0 || value === null || value === "") return null;
  return requireString22(value, "value");
}
function truncate14(value, limit = 4e4) {
  const text = String(value ?? "");
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}
[truncated ${text.length - limit} characters]`;
}
function getPath2(value, path16) {
  let current = value;
  for (const part of path16) {
    current = asRecord19(current)?.[part];
    if (current === void 0) return void 0;
  }
  return current;
}
function asString2(value) {
  return typeof value === "string" && value.length > 0 ? value : null;
}
function asRecord19(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : null;
}
async function broadcastMetroMessage(metroPort, method, params) {
  if (!method)
    return { available: false, reason: "No Metro message method was requested.", metroPort };
  if (typeof WebSocket !== "function")
    return {
      available: false,
      reason: "This Node runtime does not expose a WebSocket client.",
      metroPort
    };
  const url = `ws://127.0.0.1:${metroPort}/message?role=debugger&name=expo98`;
  try {
    await cdpMessage(url, { method, params: params ?? {} }, 2500);
    return { available: true, metroPort, method, url };
  } catch (error) {
    return { available: false, metroPort, method, url, reason: formatError11(error) };
  }
}
async function cdpMessage(url, payload, timeoutMs) {
  const ws = new WebSocket(url);
  await waitForOpen2(ws, timeoutMs);
  try {
    ws.send(JSON.stringify(payload));
  } finally {
    ws.close();
  }
}
function waitForOpen2(ws, timeoutMs) {
  return new Promise((resolve18, reject) => {
    const timer = setTimeout(() => reject(new Error("Timed out opening WebSocket.")), timeoutMs);
    ws.addEventListener(
      "open",
      () => {
        clearTimeout(timer);
        resolve18();
      },
      { once: true }
    );
    ws.addEventListener(
      "error",
      () => {
        clearTimeout(timer);
        reject(new Error("WebSocket connection failed."));
      },
      { once: true }
    );
  });
}
function execFile8(command, args, options) {
  return new Promise((resolve18) => {
    nodeExecFile10(
      command,
      args,
      { timeout: options.timeout, maxBuffer: 4 * 1024 * 1024 },
      (error, stdout, stderr) => {
        resolve18({
          stdout: String(stdout ?? ""),
          stderr: String(stderr ?? ""),
          error: error ? { message: error.message } : null
        });
      }
    );
  });
}
function formatError11(error) {
  return error instanceof Error ? error.message : String(error);
}

// src/commands/snapshot-evidence/src/main/filters.ts
function buildSnapshotFilters(args = {}) {
  return {
    interactiveOnly: args.interactive === true,
    compact: args.compact === true,
    depth: args.depth === void 0 ? null : clampNumber20(args.depth, 1, 100),
    includeSource: args.source === true,
    includeBounds: args.bounds === true
  };
}
function clampNumber20(value, min, max) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) {
    throw new Error(`Expected a finite number, got ${value}.`);
  }
  return Math.max(min, Math.min(max, numberValue));
}

// src/commands/snapshot-evidence/src/main/ids.ts
function createSnapshotId(now4, randomSuffix) {
  const timestamp = now4.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z").replace("T", "-").toLowerCase();
  return `snapshot-${timestamp}-${randomSuffix}`;
}

// src/commands/snapshot-evidence/src/main/accessibility.ts
function flattenAccessibilityNodes(tree, filters) {
  const roots = Array.isArray(tree) ? tree : [tree];
  const nodes = [];
  const visit = (node, depth) => {
    if (!isRecord7(node)) {
      return;
    }
    if (filters.depth !== null && depth > filters.depth) {
      return;
    }
    const normalized = normalizeAccessibilityNode(node);
    if ((!filters.interactiveOnly || normalized.actions.length > 0) && (!filters.compact || normalized.label || normalized.text || normalized.actions.length > 0)) {
      nodes.push(normalized);
    }
    const children = Array.isArray(node.children) ? node.children : [];
    for (const child of children) {
      visit(child, depth + 1);
    }
  };
  for (const root of roots) {
    visit(root, 0);
  }
  return nodes;
}
function normalizeAccessibilityRole(role) {
  const text = String(role ?? "").replace(/^AX/, "").toLowerCase();
  if (text === "statictext") return "text";
  if (text === "button") return "button";
  if (text === "textfield" || text === "textbox") return "textbox";
  if (text === "switch") return "switch";
  if (text === "link") return "link";
  return text || null;
}
function normalizeFrame(frame) {
  if (!isRecord7(frame)) {
    return null;
  }
  const x = Number(frame.x ?? frame.left);
  const y = Number(frame.y ?? frame.top);
  const width = Number(frame.width);
  const height = Number(frame.height);
  if (![x, y, width, height].every(Number.isFinite)) {
    return null;
  }
  return { x, y, width, height };
}
function actionsForAccessibilityRole(role) {
  if (role === "button" || role === "link") return ["tap", "inspect"];
  if (role === "textbox") return ["tap", "fill", "focus", "inspect"];
  if (role === "switch") return ["tap", "inspect"];
  return [];
}
function normalizeSource(source) {
  if (!isRecord7(source)) {
    return null;
  }
  const line = Number(source.line ?? source.lineNumber);
  const column = Number(source.column ?? source.columnNumber);
  return {
    file: stringOrNull2(source.file ?? source.fileName),
    line: Number.isFinite(line) ? line : null,
    column: Number.isFinite(column) ? column : null
  };
}
function refRecordFromNode(node, index, snapshotId, targetId, filters) {
  return {
    ref: `@e${index}`,
    snapshotId,
    targetId,
    stale: false,
    role: node.role,
    label: node.label,
    text: node.text,
    placeholder: node.placeholder,
    testID: node.testID,
    nativeID: node.nativeID,
    component: node.component,
    source: filters.includeSource ? normalizeSource(node.source) : null,
    box: filters.includeBounds ? node.box : null,
    actions: node.actions
  };
}
function snapshotNodeFromAccessibility(node, ref, filters) {
  return {
    ref,
    role: node.role,
    label: node.label,
    text: node.text,
    testID: node.testID,
    source: filters.includeSource ? normalizeSource(node.source) : null,
    box: filters.includeBounds ? node.box : null,
    actions: node.actions
  };
}
function normalizeAccessibilityNode(node) {
  const role = normalizeAccessibilityRole(node.role_description ?? node.role ?? node.type ?? null);
  const label = nullableField(node.AXLabel ?? node.label ?? node.title);
  return {
    role,
    label,
    text: nullableField(node.AXValue ?? node.value ?? (role === "text" ? label : null)),
    placeholder: nullableField(node.placeholder),
    testID: nullableField(node.testID ?? node.testId ?? node.nativeID),
    nativeID: nullableField(node.nativeID),
    component: nullableField(node.component ?? node.name),
    source: node.source ?? null,
    box: normalizeFrame(node.frame),
    actions: actionsForAccessibilityRole(role),
    raw: node
  };
}
function isRecord7(value) {
  return Boolean(value) && typeof value === "object";
}
function nullableField(value) {
  return value === void 0 || value === null ? null : String(value);
}
function stringOrNull2(value) {
  return value === void 0 || value === null ? null : String(value);
}

// src/commands/snapshot-evidence/src/main/persistence.ts
var NATIVE_LIMITATIONS = [
  "Native accessibility snapshots expose semantic UI where available; React component props and private fiber details are not included."
];
async function persistNativeSnapshot(input, deps) {
  const snapshotId = createSnapshotId(deps.now(), deps.randomSuffix());
  const targetId = input.session.activeTargetId ?? "";
  const nodes = flattenAccessibilityNodes(input.accessibilityTree, input.filters);
  const refs = nodes.map(
    (node, index) => refRecordFromNode(node, index + 1, snapshotId, targetId, input.filters)
  );
  const snapshotPath = snapshotJsonPath(input.stateRoot, input.session.sessionId, snapshotId);
  const generatedAt = deps.now().toISOString();
  const snapshot = {
    snapshotId,
    targetId,
    routeHint: null,
    source: ["native-accessibility"],
    semanticBridge: input.semanticBridge,
    generatedAt,
    filters: input.filters,
    refs,
    tree: nodes.map(
      (node, index) => snapshotNodeFromAccessibility(node, `@e${index + 1}`, input.filters)
    ),
    artifacts: {
      json: snapshotPath,
      screenshot: null,
      annotatedScreenshot: null
    },
    limitations: NATIVE_LIMITATIONS
  };
  await persistSnapshotArtifacts(
    input.stateRoot,
    input.session,
    snapshot,
    input.semanticBridge,
    deps
  );
  return snapshot;
}
async function persistSemanticSnapshot(input, deps) {
  const snapshotId = createSnapshotId(deps.now(), deps.randomSuffix());
  const targetId = input.session.activeTargetId ?? "";
  const refs = input.semanticBridge.refs.map((record, index) => ({
    ...record,
    ref: `@e${index + 1}`,
    snapshotId,
    targetId,
    stale: false,
    role: record.role ?? null,
    label: record.label ?? null,
    text: record.text ?? null,
    placeholder: record.placeholder ?? null,
    testID: record.testID ?? null,
    nativeID: record.nativeID ?? null,
    component: record.component ?? null,
    source: record.source ?? null,
    box: record.box ?? null,
    actions: record.actions ?? []
  }));
  const snapshotPath = snapshotJsonPath(input.stateRoot, input.session.sessionId, snapshotId);
  const generatedAt = deps.now().toISOString();
  const snapshot = {
    snapshotId,
    targetId,
    routeHint: input.semanticBridge.routeHint,
    source: [input.semanticBridge.source],
    semanticBridge: input.semanticBridge,
    generatedAt,
    filters: input.filters,
    refs,
    tree: refs.map((record) => ({
      ref: record.ref,
      role: record.role,
      label: record.label,
      text: record.text,
      testID: record.testID,
      source: input.filters.includeSource ? record.source : null,
      box: input.filters.includeBounds ? record.box : null,
      actions: record.actions
    })),
    artifacts: {
      json: snapshotPath,
      screenshot: null,
      annotatedScreenshot: null
    },
    limitations: input.semanticBridge.limitations
  };
  await persistSnapshotArtifacts(
    input.stateRoot,
    input.session,
    snapshot,
    input.semanticBridge,
    deps
  );
  return snapshot;
}
function snapshotDirectory(stateRoot, sessionId) {
  return `${stateRoot}/sessions/${sessionId}/snapshots`;
}
function snapshotJsonPath(stateRoot, sessionId, snapshotId) {
  return `${snapshotDirectory(stateRoot, sessionId)}/${snapshotId}.json`;
}
async function persistSnapshotArtifacts(stateRoot, session, snapshot, semanticBridge, deps) {
  await deps.ensureDirectory(snapshotDirectory(stateRoot, session.sessionId));
  await deps.writeJsonFile(snapshot.artifacts.json, snapshot);
  await deps.writeJsonFile(`${stateRoot}/sessions/${session.sessionId}/refs.json`, {
    snapshotId: snapshot.snapshotId,
    targetId: snapshot.targetId,
    source: snapshot.source,
    semanticBridge,
    refs: snapshot.refs
  });
  await deps.updateSessionRecord(stateRoot, {
    ...session,
    lastSnapshotId: snapshot.snapshotId,
    updatedAt: snapshot.generatedAt
  });
}

// src/commands/snapshot-evidence/src/main/ref-commands.ts
import { readdir as readdir11, readFile as readFile22 } from "node:fs/promises";
import { join as join16 } from "node:path";
async function refsCommand(args = {}, deps = defaultRefCommandDependencies) {
  const cache = await readLatestRefCache7(resolveStateRoot(args), deps);
  if (!cache) {
    return { available: false, reason: "No snapshot exists for the current session." };
  }
  return { available: true, ...cache };
}
async function getRefCommand(args, deps = defaultRefCommandDependencies) {
  const field = requireString23(args.field, "field");
  const ref = requireString23(args.ref, "ref");
  if (!/^@e\d+$/.test(ref)) {
    return { available: false, reason: "Ref must look like @e1.", ref };
  }
  const cache = await readLatestRefCache7(resolveStateRoot(args), deps);
  if (!cache) {
    return { available: false, reason: "No snapshot exists for the current session." };
  }
  const record = cache.refs.find((item) => item.ref === ref);
  if (!record) {
    return { available: false, reason: "Ref not found in the latest snapshot.", ref };
  }
  return {
    ref,
    field,
    stale: record.stale,
    value: refFieldValue(record, field)
  };
}
var defaultRefCommandDependencies = {
  readLatestSession: async (stateRoot) => {
    const sessionsRoot = join16(stateRoot, "sessions");
    const entries = await readdir11(sessionsRoot, { withFileTypes: true }).catch(() => []);
    const sessions = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const record = await readJson4(join16(sessionsRoot, entry.name, "session.json")).catch(
        () => null
      );
      if (record) sessions.push(record);
    }
    sessions.sort(
      (left, right) => String(right.updatedAt ?? right.createdAt).localeCompare(
        String(left.updatedAt ?? left.createdAt)
      )
    );
    return sessions[0] ?? null;
  },
  readJsonFile: readJson4
};
function resolveStateRoot(args) {
  return args.stateRoot ?? resolveExpoStateRoot6(args);
}
async function readJson4(file) {
  return JSON.parse(await readFile22(file, "utf8"));
}
function refFieldValue(record, field) {
  switch (field) {
    case "text":
      return record.text ?? record.label ?? null;
    case "props":
      return {
        role: record.role,
        label: record.label,
        placeholder: record.placeholder,
        testID: record.testID,
        nativeID: record.nativeID,
        component: record.component,
        actions: record.actions
      };
    case "box":
      return record.box;
    case "style":
      return null;
    case "source":
      return record.source;
    default:
      throw new Error(`Unknown ref field: ${field}`);
  }
}
async function readLatestRefCache7(stateRoot, deps) {
  const session = await deps.readLatestSession(stateRoot);
  if (!session?.lastSnapshotId) {
    return null;
  }
  try {
    return await deps.readJsonFile(`${stateRoot}/sessions/${session.sessionId}/refs.json`);
  } catch {
    return null;
  }
}
function requireString23(value, name) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${name} is required.`);
  }
  return value.trim();
}

// src/commands/snapshot-evidence/src/main/snapshot-command.ts
import { execFile as nodeExecFile11 } from "node:child_process";
import { mkdir as mkdir13, readdir as readdir12, readFile as readFile23, writeFile as writeFile10 } from "node:fs/promises";
import { join as join17 } from "node:path";

// src/state/session-run-records/src/main/ids.ts
var systemClock2 = () => /* @__PURE__ */ new Date();
var randomBase36Suffix = () => Math.random().toString(36).slice(2, 8);
function createSessionId(name, at, randomSuffix = randomBase36Suffix) {
  const timestamp = at.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "").replace("T", "-").toLowerCase();
  return `${name}-${timestamp}-${randomSuffix()}`;
}
function createRunId(at, randomSuffix = randomBase36Suffix) {
  const timestamp = at.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z").replace("T", "-");
  return `${timestamp}-${randomSuffix()}`;
}

// src/commands/snapshot-evidence/src/main/snapshot-command.ts
async function snapshotCommand(args = {}, deps = defaultSnapshotDependencies) {
  const stateRoot = args.stateRoot ?? resolveExpoStateRoot6(args);
  const session = await deps.readLatestSession(stateRoot);
  if (!session) {
    return {
      available: false,
      reason: "No session exists. Run `expo98 --json session new review` first."
    };
  }
  if (!session.activeTargetId) {
    return {
      available: false,
      reason: "No target selected for the current session.",
      sessionId: session.sessionId
    };
  }
  const target = await deps.readSelectedTarget(stateRoot, session);
  if (!target?.device?.id) {
    return {
      available: false,
      reason: "Selected target metadata is missing.",
      targetId: session.activeTargetId
    };
  }
  const filters = buildSnapshotFilters(args);
  const semanticBridge = await deps.captureSemanticBridge(args, { stateRoot, session, filters }).catch((error) => ({
    available: false,
    source: "plugin-bridge-semantic",
    code: "transport-failure",
    reason: formatError12(error)
  }));
  if (semanticBridge.available === true) {
    return persistSemanticSnapshot({ stateRoot, session, filters, semanticBridge }, deps);
  }
  const axe = await deps.findAxeCli();
  if (!axe) {
    return {
      available: false,
      reason: "axe CLI is not installed or not on PATH.",
      targetId: session.activeTargetId,
      semanticBridge
    };
  }
  const result = await deps.describeNativeUi(axe, target.device.id);
  if (result.error) {
    return {
      available: false,
      reason: "Native accessibility snapshot failed.",
      targetId: session.activeTargetId,
      stderr: truncate15(result.stderr),
      error: result.error,
      semanticBridge
    };
  }
  return persistNativeSnapshot(
    {
      stateRoot,
      session,
      filters,
      semanticBridge,
      accessibilityTree: JSON.parse(result.stdout || "[]")
    },
    deps
  );
}
var defaultSnapshotDependencies = {
  now: () => /* @__PURE__ */ new Date(),
  randomSuffix: randomBase36Suffix,
  ensureDirectory: async (path16) => {
    await mkdir13(path16, { recursive: true });
  },
  writeJsonFile: writeJson,
  updateSessionRecord: async (stateRoot, record) => {
    await mkdir13(sessionDirectory3(stateRoot, record.sessionId), { recursive: true });
    await writeJson(sessionJsonPath(stateRoot, record.sessionId), record);
    return record;
  },
  readLatestSession: async (stateRoot) => {
    const sessionsRoot = join17(stateRoot, "sessions");
    const entries = await readdir12(sessionsRoot, { withFileTypes: true }).catch(() => []);
    const sessions = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const record = await readJson5(join17(sessionsRoot, entry.name, "session.json")).catch(
        () => null
      );
      if (record) sessions.push(record);
    }
    sessions.sort(
      (left, right) => String(right.updatedAt ?? right.createdAt).localeCompare(
        String(left.updatedAt ?? left.createdAt)
      )
    );
    return sessions[0] ?? null;
  },
  readSelectedTarget: async (stateRoot, session) => {
    return readJson5(join17(sessionDirectory3(stateRoot, session.sessionId), "target.json")).catch(
      () => null
    );
  },
  captureSemanticBridge,
  findAxeCli: () => commandPath3("axe"),
  describeNativeUi: (axePath, deviceId) => execFile9(axePath, ["describe-ui", "--udid", deviceId], { timeout: 12e3 })
};
async function captureSemanticBridge(args, context) {
  const metroPort = clampNumber21(args.metroPort ?? 8081, 1, 65535);
  const targets = await metroTargets(metroPort);
  const target = targets.find((item) => item.webSocketDebuggerUrl) ?? targets[0] ?? null;
  const webSocketDebuggerUrl = target?.webSocketDebuggerUrl ?? null;
  if (!webSocketDebuggerUrl) {
    return {
      available: false,
      source: "plugin-bridge-semantic",
      code: "no-runtime-target",
      reason: "No Metro inspector target.",
      metroPort,
      target
    };
  }
  const result = await evaluateHermesExpression(
    webSocketDebuggerUrl,
    semanticBridgeExpression(context.filters),
    { timeoutMs: 5e3 }
  );
  const value = result.result?.result?.value;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      available: false,
      source: "plugin-bridge-semantic",
      code: "transport-failure",
      reason: result.error ?? "Hermes runtime did not return semantic bridge data.",
      metroPort,
      target,
      transport: result.diagnostics ?? result.cdp ?? null
    };
  }
  const normalized = normalizeSemanticBridgeSnapshot(value, context.filters);
  if (!normalized.refs.length) {
    return {
      available: false,
      source: normalized.source,
      code: "app-bridge-unavailable",
      reason: normalized.reason ?? "No semantic or React Native bridge data is installed in the app runtime.",
      metroPort,
      target,
      transport: result.diagnostics ?? result.cdp ?? null,
      raw: value
    };
  }
  return {
    available: true,
    source: normalized.source,
    bridgeVersion: normalized.bridgeVersion,
    routeHint: normalized.routeHint,
    refs: normalized.refs,
    rawCount: normalized.rawCount,
    metroPort,
    transport: result.diagnostics ?? result.cdp ?? null,
    limitations: normalized.limitations
  };
}
function semanticBridgeExpression(filters) {
  return `(() => {
    const filters = ${JSON.stringify(filters)};
    const callBridge = (candidate, source) => {
      if (!candidate) return null;
      let payload = candidate;
      if (typeof candidate === 'function') payload = candidate({ filters });
      else if (candidate.snapshot && typeof candidate.snapshot === 'function') payload = candidate.snapshot({ filters });
      else if (candidate.tree && typeof candidate.tree === 'function') payload = candidate.tree({ filters });
      else if (candidate.refs && typeof candidate.refs === 'function') payload = candidate.refs({ filters });
      if (!payload) return null;
      if (typeof payload === 'object' && typeof payload.then === 'function') {
        return { available: false, source, reason: 'Bridge probe returned an async value; expose a synchronous snapshot/tree method for CLI capture.' };
      }
      if (Array.isArray(payload)) return { available: true, source, refs: payload };
      if (typeof payload === 'object') return { available: payload.available !== false, source: payload.source || source, ...payload };
      return null;
    };
    const instrumentation = globalThis.__EXPO98_INSTRUMENTATION__ || globalThis.__EXPO_IOS_INSTRUMENTATION__ || {};
    const probes = [
      ['plugin-bridge-semantic', globalThis.__EXPO98_SEMANTIC_BRIDGE__ ||
      globalThis.__EXPO_IOS_SEMANTIC_BRIDGE__],
      ['app-instrumentation', instrumentation.semantic],
      ['app-instrumentation', instrumentation.snapshot],
      ['app-rn-bridge', globalThis.__EXPO98_RN_BRIDGE__ ||
      globalThis.__EXPO_IOS_RN_BRIDGE__],
    ];
    const failures = [];
    for (const [source, candidate] of probes) {
      try {
        const payload = callBridge(candidate, source);
        if (payload && payload.available !== false) return payload;
        if (payload && payload.available === false) failures.push({ source, reason: payload.reason || 'Bridge probe returned unavailable.' });
      } catch (error) {
        failures.push({ source, reason: error && error.message ? error.message : String(error) });
      }
    }
    return {
      available: false,
      source: failures[0] ? failures[0].source : 'app-instrumentation',
      reason: failures[0] ? failures[0].reason : 'No semantic or React Native bridge global was found.',
      failures,
    };
  })()`;
}
function normalizeSemanticBridgeSnapshot(value, filters) {
  const source = typeof value.source === "string" ? value.source : "app-instrumentation";
  const rawRefs = flattenSemanticNodes(
    firstArray(value.refs, value.tree, value.nodes, value.elements, value.items),
    filters
  );
  const refs = rawRefs.map((node) => normalizeSemanticRef(node, filters)).filter((node) => Boolean(node));
  return {
    source,
    bridgeVersion: typeof value.bridgeVersion === "string" ? value.bridgeVersion : typeof value.version === "string" ? value.version : null,
    routeHint: typeof value.routeHint === "string" ? value.routeHint : typeof value.route === "string" ? value.route : null,
    refs,
    rawCount: rawRefs.length,
    reason: typeof value.reason === "string" ? value.reason : void 0,
    limitations: Array.isArray(value.limitations) ? value.limitations.map(String) : [
      "Semantic snapshot data comes from app-side dev instrumentation exposed through Hermes Runtime.evaluate."
    ]
  };
}
function flattenSemanticNodes(nodes, filters) {
  const flattened = [];
  const visit = (node, depth) => {
    if (filters.depth !== null && depth > filters.depth) return;
    flattened.push(node);
    const record = asRecord20(node);
    const children = Array.isArray(record?.children) ? record.children : [];
    for (const child of children) visit(child, depth + 1);
  };
  for (const node of nodes) visit(node, 1);
  return flattened;
}
function normalizeSemanticRef(node, filters) {
  const record = asRecord20(node);
  if (!record) return null;
  const element = asRecord20(record.element);
  const role = stringOrNull3(
    record.role ?? element?.role ?? record.accessibilityRole ?? element?.accessibilityRole ?? record.type
  );
  const explicitActions = actionsFrom(
    record.actions ?? element?.actions ?? record.accessibilityActions ?? element?.accessibilityActions ?? record.handlers
  );
  const component = stringOrNull3(
    record.component ?? record.componentName ?? record.displayName ?? record.name ?? record.type
  );
  const actions = explicitActions.length ? explicitActions : actionsForRoleOrComponent(role, component);
  if (filters.interactiveOnly && actions.length === 0 && !role) return null;
  return {
    role,
    label: stringOrNull3(
      record.label ?? element?.label ?? record.accessibilityLabel ?? element?.accessibilityLabel ?? record.title ?? element?.title
    ),
    text: stringOrNull3(record.text ?? element?.text ?? record.value ?? element?.value),
    placeholder: stringOrNull3(
      record.placeholder ?? element?.placeholder ?? record.placeholderText ?? element?.placeholderText
    ),
    testID: stringOrNull3(
      record.testID ?? element?.testID ?? record.testId ?? element?.testId ?? record.testid
    ),
    nativeID: stringOrNull3(
      record.nativeID ?? element?.nativeID ?? record.nativeId ?? element?.nativeId
    ),
    component,
    source: record.source ?? element?.source ?? record.sourceLocation ?? element?.sourceLocation ?? record._source ?? element?._source ?? null,
    box: normalizeBox(
      record.box ?? element?.box ?? record.bounds ?? element?.bounds ?? record.frame ?? element?.frame ?? record.layout ?? element?.layout
    ),
    actions,
    disabled: typeof record.disabled === "boolean" ? record.disabled : void 0,
    raw: node
  };
}
function actionsForRoleOrComponent(role, component) {
  if (role === "button" || role === "link") return ["tap", "inspect"];
  if (role === "textbox") return ["tap", "fill", "focus", "inspect"];
  if (role === "switch") return ["tap", "inspect"];
  if (component && /TextInput/i.test(component)) return ["tap", "fill", "focus", "inspect"];
  return [];
}
function firstArray(...values) {
  for (const value of values) {
    if (Array.isArray(value)) return value;
  }
  return [];
}
function actionsFrom(value) {
  if (!Array.isArray(value)) return [];
  return value.map(
    (item) => typeof item === "string" ? item : stringOrNull3(asRecord20(item)?.name ?? asRecord20(item)?.action)
  ).filter((item) => Boolean(item));
}
function normalizeBox(value) {
  const record = asRecord20(value);
  if (!record) return null;
  const x = numberOrNull3(record.x ?? record.left);
  const y = numberOrNull3(record.y ?? record.top);
  const width = numberOrNull3(record.width ?? record.w);
  const height = numberOrNull3(record.height ?? record.h);
  return x == null || y == null || width == null || height == null ? null : { x, y, width, height };
}
function clampNumber21(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`Expected a finite number, got ${String(value)}.`);
  return Math.min(Math.max(number, min), max);
}
function stringOrNull3(value) {
  return typeof value === "string" && value.length > 0 ? value : null;
}
function numberOrNull3(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
function asRecord20(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}
function commandPath3(command) {
  return new Promise((resolve18) => {
    nodeExecFile11("which", [command], { timeout: 5e3 }, (error, stdout) => {
      resolve18(error ? null : String(stdout ?? "").trim() || null);
    });
  });
}
function execFile9(file, args, options) {
  return new Promise((resolve18) => {
    nodeExecFile11(
      file,
      args,
      { timeout: options.timeout, maxBuffer: 4 * 1024 * 1024 },
      (error, stdout, stderr) => {
        resolve18({
          stdout: String(stdout ?? ""),
          stderr: String(stderr ?? ""),
          error: error ? { message: error.message, code: error.code, signal: error.signal } : void 0
        });
      }
    );
  });
}
async function readJson5(file) {
  return JSON.parse(await readFile23(file, "utf8"));
}
async function writeJson(file, value) {
  await writeFile10(file, `${JSON.stringify(value, null, 2)}
`, "utf8");
}
function formatError12(error) {
  if (!error) {
    return "Unknown error";
  }
  const record = error;
  const parts = [record.message ?? String(error)];
  if (record.stdout) parts.push(`stdout:
${truncate15(record.stdout)}`);
  if (record.stderr) parts.push(`stderr:
${truncate15(record.stderr)}`);
  return parts.join("\n\n");
}
function truncate15(value, limit = 4e3) {
  const text = String(value ?? "");
  return text.length <= limit ? text : `${text.slice(0, limit)}
[truncated ${text.length - limit} characters]`;
}

// src/commands/ux-context-capture/src/main/index.ts
import { execFile as nodeExecFile12 } from "node:child_process";
import { stat as stat7 } from "node:fs/promises";
import path15 from "node:path";
var REVIEW_CONTEXT_QUESTIONS = [
  "Is the screen blank because of empty data, loading, failed network, or render failure?",
  "Which route/source file likely owns the visible screen?",
  "Is the app connected to Metro and running Hermes/Fabric/New Architecture?",
  "What colors, contrast, visual density, and coarse composition does the current screen expose?",
  "Which React components and host elements are likely composing the current screen?",
  "Which labels, text nodes, roles, test IDs, and source owner hints map visible UI back to code?",
  "Does the app expose a usable simulator hierarchy, or is screenshot/coordinate review the only reliable UI surface?",
  "Are recent native logs showing failed requests, reloads, exceptions, or slow local calls during the reviewed state?"
];
async function captureUxContext(args = {}, deps = defaultUxContextDependencies) {
  const startedAt = nowMs2(deps);
  const cwd = await deps.normalizeProjectCwd(args.cwd, { allowMissingPackageJson: true });
  const device = await deps.resolveIosDevice(args.device, { preferBooted: true });
  const metroPort = clampNumber22(args.metroPort ?? 8081, 1, 65535);
  const context = {
    capturedAt: now3(deps).toISOString(),
    cwd,
    device,
    elapsedMs: null,
    app: null,
    screenshot: null,
    visualAnalysis: null,
    metro: null,
    runtime: null,
    componentHierarchy: null,
    routes: null,
    hierarchy: null,
    logs: null,
    reviewQuestionsThisCanAnswer: REVIEW_CONTEXT_QUESTIONS
  };
  const projectSummary2 = await safeToolSection3(() => deps.expoProjectRuntimeSummary(cwd));
  context.project = projectSummary2.ok ? projectSummary2.value : projectSummary2;
  const metroSummary = args.includeRuntime === false ? { ok: false, skipped: true, reason: "includeRuntime is false" } : await safeToolSection3(
    () => deps.inspectMetro(metroPort, {
      includeComponents: args.includeComponents !== false,
      componentFilter: requireOptionalString10(args.componentFilter)
    })
  );
  if (metroSummary.ok === true) {
    context.metro = metroSummary.value.metro;
    context.runtime = metroSummary.value.runtime;
  } else {
    context.metro = metroSummary;
    context.runtime = metroSummary;
  }
  context.componentHierarchy = context.runtime?.componentHierarchy ?? (args.includeRuntime === false ? { skipped: true, reason: "includeRuntime is false" } : args.includeComponents === false ? { skipped: true, reason: "includeComponents is false" } : { available: false, reason: "No component hierarchy returned by runtime probe." });
  if (context.runtime && typeof context.runtime === "object" && "componentHierarchy" in context.runtime) {
    delete context.runtime.componentHierarchy;
  }
  const inferredBundleId = requireOptionalString10(args.bundleId) ?? firstMetroAppId(context.metro) ?? appConfigBundleId(context.project) ?? null;
  const processName = requireOptionalString10(args.processName) ?? processNameFromBundleId(inferredBundleId);
  if (inferredBundleId) {
    const appInfo = await safeToolSection3(
      () => deps.iosInstalledAppInfo(String(device.udid), inferredBundleId)
    );
    context.app = appInfo.ok ? appInfo.value : { bundleId: inferredBundleId, ...appInfo };
  } else {
    context.app = {
      bundleId: null,
      warning: "Could not infer bundleId. Pass bundleId for app container details and precise log filtering."
    };
  }
  if (args.includeScreenshot !== false) {
    const screenshot = await safeToolSection3(
      () => deps.captureIosScreenshot(String(device.udid), args.outputPath)
    );
    context.screenshot = screenshot.ok ? screenshot.value : screenshot;
    if (screenshot.ok && args.includeImageAnalysis !== false) {
      const outputPath = screenshot.value.outputPath;
      const analysis = await safeToolSection3(() => deps.analyzePngScreenshot(String(outputPath)));
      context.visualAnalysis = analysis.ok ? analysis.value : analysis;
    }
  } else {
    context.screenshot = { skipped: true, reason: "includeScreenshot is false" };
    context.visualAnalysis = { skipped: true, reason: "No screenshot captured." };
  }
  context.routes = await safeToolSection3(() => deps.expoRouteContext(cwd));
  if (context.routes.ok) context.routes = context.routes.value;
  if (args.includeHierarchy !== false) {
    const hierarchy = await safeToolSection3(() => deps.describeIosHierarchy(String(device.udid)));
    context.hierarchy = hierarchy.ok ? hierarchy.value : hierarchy;
  } else {
    context.hierarchy = { skipped: true, reason: "includeHierarchy is false" };
  }
  if (args.includeLogs) {
    const logsLast = args.logsLast ?? "60s";
    if (!/^\d+[smhd]$/.test(logsLast))
      throw new Error("logsLast must look like 30s, 2m, 1h, or 1d.");
    const logs = await safeToolSection3(
      () => deps.collectFilteredIosLogs(String(device.udid), {
        last: logsLast,
        bundleId: inferredBundleId,
        processName
      })
    );
    context.logs = logs.ok ? logs.value : logs;
  } else {
    context.logs = {
      skipped: true,
      reason: "includeLogs is false. Set includeLogs=true for recent filtered iOS logs.",
      suggestedFilter: processName ? `process == "${processName}"` : inferredBundleId ? `process CONTAINS "${processNameFromBundleId(inferredBundleId)}"` : null
    };
  }
  context.elapsedMs = nowMs2(deps) - startedAt;
  return toolJson(context);
}
var defaultUxContextDependencies = {
  normalizeProjectCwd: defaultNormalizeProjectCwd3,
  resolveIosDevice: (device, options) => resolveIosDevice(requireOptionalString10(device), options),
  expoProjectRuntimeSummary: async (cwd) => unwrapToolJson(await projectInfo({ cwd })),
  inspectMetro: async (metroPort) => {
    const metro = await metroStatusPayload({ metroPort });
    return {
      metro,
      runtime: {
        available: metro.available,
        targetCount: metro.targetCount,
        targets: metro.targets
      }
    };
  },
  iosInstalledAppInfo: async (udid, bundleId) => {
    const result = await execFile10("xcrun", ["simctl", "get_app_container", udid, bundleId], {
      timeout: 15e3,
      rejectOnError: false
    });
    return {
      available: !result.error,
      bundleId,
      containerPath: result.error ? null : String(result.stdout ?? "").trim(),
      stderr: truncate16(result.stderr),
      error: result.error ?? null
    };
  },
  captureIosScreenshot: async (udid, outputPath) => unwrapToolJson(
    await automationTakeScreenshot({
      platform: "ios",
      device: udid,
      outputPath: String(outputPath)
    })
  ),
  analyzePngScreenshot: async (outputPath) => {
    const details = await stat7(outputPath).catch(() => null);
    return details ? {
      available: true,
      outputPath,
      bytes: details.size,
      modifiedAt: details.mtime.toISOString()
    } : { available: false, outputPath, reason: "Screenshot file was not found." };
  },
  expoRouteContext,
  describeIosHierarchy: async (udid) => {
    const result = await execFile10("axe", ["describe-ui", "--udid", udid], {
      timeout: 2e4,
      rejectOnError: false
    });
    return {
      available: !result.error,
      tool: "axe",
      stdout: truncate16(result.stdout),
      stderr: truncate16(result.stderr),
      error: result.error ?? null
    };
  },
  collectFilteredIosLogs: async (udid, options) => collectAppLogs({
    platform: "ios",
    device: udid,
    last: options.last,
    bundleId: options.bundleId ?? void 0,
    processName: options.processName ?? void 0
  }),
  now: () => /* @__PURE__ */ new Date(),
  nowMs: () => Date.now()
};
async function safeToolSection3(fn) {
  try {
    return { ok: true, value: await fn() };
  } catch (error) {
    return { ok: false, error: formatError13(error) };
  }
}
function requireOptionalString10(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
function processNameFromBundleId(bundleId) {
  if (!bundleId) return null;
  const last = String(bundleId).split(".").filter(Boolean).at(-1);
  return last ? last.replace(/[^a-zA-Z0-9_-]/g, "") : null;
}
function clampNumber22(value, min, max) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) {
    throw new Error(`Expected a finite number, got ${value}.`);
  }
  return Math.min(Math.max(numberValue, min), max);
}
function firstMetroAppId(metro) {
  const targets = asRecord21(metro)?.targets;
  if (!Array.isArray(targets)) return null;
  const target = targets.find((candidate) => asRecord21(candidate)?.appId);
  return typeof target?.appId === "string" ? target.appId : null;
}
function appConfigBundleId(project) {
  const bundleId = asRecord21(asRecord21(project)?.appConfig)?.iosBundleIdentifier;
  return typeof bundleId === "string" && bundleId.length > 0 ? bundleId : null;
}
function asRecord21(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}
function now3(deps) {
  return deps.now?.() ?? /* @__PURE__ */ new Date();
}
function nowMs2(deps) {
  return deps.nowMs?.() ?? Date.now();
}
async function defaultNormalizeProjectCwd3(cwd) {
  const resolved = path15.resolve(requireOptionalString10(cwd) ?? ".");
  const details = await stat7(resolved).catch(() => null);
  if (!details?.isDirectory()) throw new Error(`Directory does not exist: ${resolved}`);
  return resolved;
}
function execFile10(file, args, options) {
  return new Promise((resolve18) => {
    nodeExecFile12(
      file,
      args,
      { timeout: options.timeout, maxBuffer: 4 * 1024 * 1024 },
      (error, stdout, stderr) => {
        resolve18({
          stdout: String(stdout ?? ""),
          stderr: String(stderr ?? ""),
          error
        });
      }
    );
  });
}
function truncate16(value, limit = 4e4) {
  const text = String(value ?? "");
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}
[truncated ${text.length - limit} characters]`;
}
function formatError13(error) {
  return error instanceof Error ? error.message : String(error);
}

// src/core/cli-executable-wrapper/src/main/index.ts
var DEFAULT_PROCESS_ARGV_OFFSET = 2;
function createCliExecutable(deps) {
  return {
    argv: () => cliArgv2(readArgv(deps.argv), deps.argvOffset),
    run: () => runCliExecutable(deps)
  };
}
async function runCliExecutable(deps) {
  const argv = cliArgv2(readArgv(deps.argv), deps.argvOffset);
  try {
    const exitCode = await deps.main(argv);
    deps.setExitCode(exitCode);
    return exitCode;
  } catch (error) {
    deps.writeCliError(error);
    const exitCode = deps.exitCodeForError(error);
    deps.setExitCode(exitCode);
    return exitCode;
  }
}
function cliArgv2(processArgv, argvOffset = DEFAULT_PROCESS_ARGV_OFFSET) {
  const offset = Number.isFinite(argvOffset) && argvOffset >= 0 ? Math.floor(argvOffset) : DEFAULT_PROCESS_ARGV_OFFSET;
  return processArgv.slice(offset);
}
function readArgv(argv) {
  return typeof argv === "function" ? argv() : argv;
}

// src/core/cli-facade-entrypoint/src/main/index.ts
function defaultLastCliOptions() {
  return {
    json: false,
    plain: false,
    quiet: false,
    debug: false,
    maxOutput: null,
    contentBoundaries: false,
    allowRuntimeEval: null,
    confirmActions: null
  };
}
function createCliFacade(deps) {
  let lastCliOptions = defaultLastCliOptions();
  async function main(argv) {
    lastCliOptions = defaultLastCliOptions();
    const parsed = deps.parseCliArgs(argv);
    lastCliOptions = parsed.globals;
    return deps.dispatchCommand(parsed);
  }
  async function run(argv) {
    try {
      return await main(argv);
    } catch (error) {
      deps.writeCliError(error, lastCliOptions);
      return deps.exitCodeForError(error);
    }
  }
  return {
    main,
    run,
    getLastCliOptions: () => ({ ...lastCliOptions })
  };
}

// src/core/cli-help-surface/src/main/index.ts
var CLI_VERSION4 = "0.1.0";
function cliHelpText2(version = CLI_VERSION4) {
  return [
    `expo98 ${version}`,
    "",
    "Usage:",
    "  expo98 [global flags] <command> [options]",
    "",
    "Global flags:",
    ...indent(GLOBAL_FLAGS),
    "",
    "Discovery:",
    ...indent(DISCOVERY_COMMANDS),
    "",
    "Simulator and app actions:",
    ...indent(SIMULATOR_AND_APP_COMMANDS),
    "",
    "Evidence and runtime:",
    ...indent(EVIDENCE_AND_RUNTIME_COMMANDS),
    "",
    "Examples:",
    ...indent(EXAMPLES)
  ].join("\n") + "\n";
}
function indent(lines) {
  return lines.map((line) => `  ${line}`);
}

// src/core/cli-runtime-composition/src/main/index.ts
function createCliRuntime(deps) {
  const handlers = deps.bindHandlers(deps.handlerImplementations);
  const dispatchDependencies = {
    handlers,
    projectArgs: deps.commandArgs,
    startRunRecord: deps.startRunRecord,
    stdout: deps.stdout,
    stderr: deps.stderr,
    printHelp: deps.printHelp,
    cliVersion: deps.cliVersion
  };
  const facade = deps.createCliFacade({
    parseCliArgs: deps.parseCliArgs,
    dispatchCommand: (parsed) => deps.dispatchCommand(parsed, dispatchDependencies),
    writeCliError: deps.writeCliError,
    exitCodeForError: deps.exitCodeForError
  });
  return {
    main: (argv) => facade.main(argv),
    run: (argv) => facade.run(argv),
    getLastCliOptions: () => facade.getLastCliOptions(),
    handlers,
    dispatchDependencies
  };
}

// src/core/policy-redaction/src/main/command-boundary.ts
import { mkdir as mkdir14, readFile as readFile24, writeFile as writeFile11 } from "node:fs/promises";
import { dirname as dirname10, resolve as resolve16 } from "node:path";
async function policyCommand(args = {}) {
  const action = requireString24(args.action ?? "show", "action");
  if (action !== "show" && action !== "check") {
    throw new Error(`Unknown policy action: ${action}`);
  }
  const policyPath = requireOptionalString11(args.actionPolicy);
  const resolvedPolicyPath = policyPath ? resolve16(policyPath) : null;
  const policy = resolvedPolicyPath ? await readJsonFile12(resolvedPolicyPath) : null;
  if (action === "show") {
    return toolJson({
      available: true,
      action,
      source: resolvedPolicyPath,
      policy: policy ?? defaultPolicySummary(),
      limitations: [
        "No policy file means read-only commands are allowed and state-changing commands are denied by default."
      ]
    });
  }
  const subject = requireString24(args.subject, "subject");
  const name = requireString24(args.name, "name");
  const policyAction = subject === "action" ? name : `${subject}.${name}`;
  const sideEffect = actionSideEffect(policyAction);
  const decision = sideEffect === "read" ? {
    checked: true,
    action: policyAction,
    sideEffect,
    allowed: true,
    source: resolvedPolicyPath,
    reason: POLICY_REASONS.READ_ALLOWED
  } : decideActionPolicy({
    action: policyAction,
    sideEffect,
    policy,
    source: resolvedPolicyPath,
    allowRuntimeEval: isTrueFlag(args.allowRuntimeEval)
  });
  return toolJson({
    available: true,
    action: "check",
    subject,
    name,
    policyAction,
    decision
  });
}
async function redactCommand(args = {}) {
  const file = resolve16(requireString24(args.file, "file"));
  const raw = await readFile24(file, "utf8");
  let payload;
  try {
    payload = redactJson(JSON.parse(raw));
  } catch {
    payload = redactText(raw);
  }
  const outputPath = requireOptionalString11(args.outputPath);
  const resolvedOutputPath = outputPath ? resolve16(outputPath) : null;
  if (resolvedOutputPath) {
    await mkdir14(dirname10(resolvedOutputPath), { recursive: true });
    const text = typeof payload === "string" ? payload : JSON.stringify(payload, null, 2);
    await writeFile11(resolvedOutputPath, `${text}
`, "utf8");
  }
  return toolJson({
    available: true,
    action: "redact",
    inputPath: file,
    outputPath: resolvedOutputPath,
    redacted: payload
  });
}
async function readJsonFile12(file) {
  return JSON.parse(await readFile24(file, "utf8"));
}
function requireString24(value, field) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${field} must be a non-empty string.`);
  }
  return value.trim();
}
function requireOptionalString11(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
function isTrueFlag(value) {
  return value === true || value === "true";
}

// src/core/tool-handler-registry/src/main/index.ts
function handlerSymbols() {
  return TOOL_HANDLER_BINDINGS.map(([, handlerSymbol]) => handlerSymbol);
}
function bindHandlers(implementations) {
  const missing = handlerSymbols().filter(
    (handlerSymbol) => implementations[handlerSymbol] === void 0
  );
  if (missing.length > 0) {
    throw new Error(`Missing handler implementations: ${missing.join(", ")}`);
  }
  const nonFunctions = handlerSymbols().filter(
    (handlerSymbol) => typeof implementations[handlerSymbol] !== "function"
  );
  if (nonFunctions.length > 0) {
    throw new Error(`Handler implementations must be functions: ${nonFunctions.join(", ")}`);
  }
  return Object.fromEntries(
    TOOL_HANDLER_BINDINGS.map(([toolName, handlerSymbol]) => [
      toolName,
      implementations[handlerSymbol]
    ])
  );
}

// src/state/session-run-records/src/main/domain.ts
var CLI_NAME5 = CURRENT_CLI_NAME;

// src/state/session-run-records/src/main/session-service.ts
import { mkdir as mkdir16, readdir as readdir13, rm } from "node:fs/promises";
import { join as join18 } from "node:path";

// src/state/session-run-records/src/main/json-store.ts
import { mkdir as mkdir15, readFile as readFile25, writeFile as writeFile12 } from "node:fs/promises";
import { dirname as dirname11 } from "node:path";
async function writeJsonFile10(file, value) {
  await mkdir15(dirname11(file), { recursive: true });
  await writeFile12(file, `${JSON.stringify(value, null, 2)}
`, "utf8");
}
async function readJsonFile13(file) {
  return JSON.parse(await readFile25(file, "utf8"));
}

// src/state/session-run-records/src/main/validation.ts
function requireString25(value, field) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${field} must be a non-empty string.`);
  }
  return value.trim();
}
function requireOptionalString12(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

// src/state/session-run-records/src/main/session-service.ts
async function sessionCommand(args = {}, deps = {}) {
  const action = requireString25(args.action ?? "new", "action");
  if (!["new", "list", "show", "close", "clean"].includes(action)) {
    throw new Error(`Unknown session action: ${action}`);
  }
  const stateRoot = resolveExpoStateRoot6(args);
  if (action === "list") {
    return toolJson({
      available: true,
      action,
      stateRoot,
      sessions: await listSessions(stateRoot)
    });
  }
  if (action === "show") {
    return toolJson(await showSession({ stateRoot, name: requireOptionalString12(args.name) }));
  }
  if (action === "close") {
    return toolJson(
      await closeSession({ stateRoot, name: requireOptionalString12(args.name), now: deps.now })
    );
  }
  if (action === "clean") {
    return toolJson(
      await cleanSessions({
        stateRoot,
        olderThan: requireOptionalString12(args.olderThan) ?? void 0,
        now: deps.now
      })
    );
  }
  return toolJson(
    await createSession({
      stateRoot,
      name: requireOptionalString12(args.name) ?? void 0,
      now: deps.now,
      randomSuffix: deps.randomSuffix
    })
  );
}
function parseDurationMs(value) {
  const match = /^(\d+)([smhd])$/.exec(String(value));
  if (!match) {
    throw new Error("duration must look like 30s, 2m, 1h, or 7d.");
  }
  const amount = Number(match[1]);
  const unit = match[2];
  return amount * { s: 1e3, m: 6e4, h: 36e5, d: 864e5 }[unit];
}
function normalizeSessionName(value) {
  const name = requireString25(value, "name").toLowerCase().replace(/[^a-z0-9_.-]+/g, "-").replace(/^-+|-+$/g, "");
  if (!name) {
    throw new Error("name must include at least one letter or number.");
  }
  return name.slice(0, 48);
}
async function createSession(input) {
  const name = normalizeSessionName(input.name ?? "review");
  const now4 = input.now ?? systemClock2;
  const created = now4();
  const createdAt = created.toISOString();
  const sessionId = createSessionId(name, created, input.randomSuffix ?? randomBase36Suffix);
  const artifactDir = join18(sessionDirectory3(input.stateRoot, sessionId), "artifacts");
  await mkdir16(artifactDir, { recursive: true });
  const record = {
    schemaVersion: 1,
    sessionId,
    name,
    artifactDir,
    createdAt,
    updatedAt: createdAt,
    activeTargetId: null,
    lastSnapshotId: null,
    sidecars: []
  };
  await writeJsonFile10(sessionJsonPath(input.stateRoot, sessionId), record);
  return record;
}
async function listSessions(stateRoot) {
  const sessionsDir = join18(stateRoot, "sessions");
  const entries = await readdir13(sessionsDir, { withFileTypes: true }).catch(() => []);
  const sessions = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const record = await readJsonFile13(
      join18(sessionsDir, entry.name, "session.json")
    ).catch(() => null);
    if (record) {
      sessions.push(record);
    }
  }
  return sessions.sort(
    (left, right) => String(left.createdAt ?? "").localeCompare(String(right.createdAt ?? ""))
  );
}
async function showSession(input) {
  const sessions = await listSessions(input.stateRoot);
  const requested = requireOptionalString12(input.name);
  const session = requested ? sessions.find((item) => item.name === requested || item.sessionId === requested) : sessions.at(-1);
  return session ? { available: true, action: "show", session } : { available: false, action: "show", reason: "Session not found.", name: requested };
}
async function closeSession(input) {
  const sessions = await listSessions(input.stateRoot);
  const requested = requireOptionalString12(input.name);
  const session = requested ? sessions.find((item) => item.name === requested || item.sessionId === requested) : sessions.at(-1);
  if (!session) {
    return { available: false, action: "close", reason: "Session not found.", name: requested };
  }
  const closedAt = (input.now ?? systemClock2)().toISOString();
  const closed = { ...session, closedAt, updatedAt: closedAt, sidecars: [] };
  await writeJsonFile10(sessionJsonPath(input.stateRoot, session.sessionId), closed);
  return { available: true, action: "close", session: closed };
}
async function cleanSessions(input) {
  const olderThan = input.olderThan ?? "7d";
  const cutoff = (input.now ?? systemClock2)().getTime() - parseDurationMs(olderThan);
  const sessions = await listSessions(input.stateRoot);
  const removed = [];
  for (const session of sessions) {
    const created = Date.parse(session.createdAt ?? session.updatedAt ?? "0");
    if (Number.isFinite(created) && created < cutoff) {
      await rm(sessionDirectory3(input.stateRoot, session.sessionId), {
        recursive: true,
        force: true
      });
      removed.push(session.sessionId);
    }
  }
  return { available: true, action: "clean", stateRoot: input.stateRoot, olderThan, removed };
}

// src/state/session-run-records/src/main/run-recorder.ts
import { mkdir as mkdir17 } from "node:fs/promises";
import { join as join19, resolve as resolve17 } from "node:path";
async function startRunRecord(input) {
  if (!input.globals.record && !input.globals.stateDir) {
    return { path: null, async finish() {
    } };
  }
  const now4 = input.now ?? systemClock2;
  const startedAt = now4().toISOString();
  const runId = createRunId(new Date(startedAt), input.randomSuffix ?? randomBase36Suffix);
  const root = resolve17(String(input.globals.root ?? input.args.cwd ?? input.cwd ?? process.cwd()));
  const stateDir = resolve17(
    String(input.globals.stateDir ?? join19(root, ".scratch", "expo98", "runs"))
  );
  const recordPath = join19(stateDir, `${runId}.json`);
  const baseRecord = {
    schemaVersion: 1,
    runId,
    cli: { name: CLI_NAME5, version: CLI_VERSION },
    command: input.command,
    args: redactValue(stripUndefined(input.args)),
    root,
    stateDir,
    startedAt,
    finishedAt: null,
    status: "running",
    exitCode: null
  };
  await mkdir17(stateDir, { recursive: true });
  await writeJsonFile10(recordPath, baseRecord);
  return {
    path: recordPath,
    async finish({ status, exitCode, payload, error }) {
      await writeJsonFile10(recordPath, {
        ...baseRecord,
        finishedAt: now4().toISOString(),
        status,
        exitCode,
        summary: summarizeRunPayload(payload),
        error: error ? sanitizeErrorMessage(formatError3(error)) : null
      });
    }
  };
}
function summarizeRunPayload(payload) {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const record = payload;
  const summary = {
    keys: Object.keys(record).slice(0, 40)
  };
  if (typeof record.available === "boolean") {
    summary.available = record.available;
  }
  if (record.routeCount !== void 0) {
    summary.routeCount = record.routeCount;
  }
  if (Array.isArray(record.events)) {
    summary.eventCount = record.events.length;
  }
  return summary;
}
function stripUndefined(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, child]) => child !== void 0)
  );
}

// src/state/target-management/src/main/validation.ts
function requireString26(value, field) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${field} must be a non-empty string.`);
  }
  return value.trim();
}
function clampNumber23(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new Error(`Expected a finite number, got ${value}.`);
  }
  return Math.min(Math.max(number, min), max);
}

// src/state/target-management/src/main/target-record.ts
function normalizeDeviceState(state) {
  if (state === "Booted") {
    return "booted";
  }
  if (state === "Shutdown") {
    return "shutdown";
  }
  if (state === "connected") {
    return "connected";
  }
  return "unknown";
}
function stableIdPart(value) {
  return String(value ?? "unknown").toLowerCase().replace(/[^a-z0-9_.-]+/g, "-").replace(/^-+|-+$/g, "") || "unknown";
}
function processNameFromBundleId2(bundleId) {
  if (!bundleId) {
    return null;
  }
  const last = String(bundleId).split(".").filter(Boolean).at(-1);
  return last ? last.replace(/[^a-zA-Z0-9_-]/g, "") || null : null;
}
function clampMetroPort(value) {
  return clampNumber23(value ?? 8081, 1, 65535);
}
function targetRecord(input) {
  const bundleId = input.metroTarget?.appId ?? null;
  const targetId = [
    input.platform,
    input.device.id,
    bundleId ?? input.metroTarget?.id ?? input.metroTarget?.title ?? "no-runtime",
    input.metroTarget ? input.metroPort : "no-metro"
  ].map(stableIdPart).join(":");
  return {
    targetId,
    platform: input.platform,
    device: {
      id: input.device.id,
      name: input.device.name ?? null,
      state: input.device.state ?? "unknown"
    },
    app: {
      bundleId,
      processName: processNameFromBundleId2(bundleId),
      running: null
    },
    metro: {
      port: input.metroTarget ? input.metroPort : null,
      status: input.metroTarget ? "available" : "unavailable",
      targetId: input.metroTarget?.id ?? null,
      title: input.metroTarget?.title ?? null,
      appId: input.metroTarget?.appId ?? null,
      debuggerUrl: input.metroTarget?.webSocketDebuggerUrl ?? null
    },
    selected: targetId === (input.selectedTargetId ?? null),
    stale: false
  };
}

// src/state/target-management/src/main/discovery.ts
async function discoverTargets(args, deps) {
  const platform = args.platform ?? "all";
  const metroPort = clampMetroPort(args.metroPort);
  const selectedTargetId2 = args.selectedTargetId ?? null;
  const targets = [];
  if (platform === "ios" || platform === "all") {
    const devices = await deps.listIosSimulatorTargets();
    const metroPayload = await deps.fetchMetroTargets(metroPort).catch(() => []);
    const metroTargets2 = normalizeMetroTargets(metroPayload);
    for (const device of devices) {
      const matchingMetroTargets = metroTargets2.filter(
        (target) => !target.deviceName || target.deviceName === device.name
      );
      if (matchingMetroTargets.length === 0) {
        targets.push(
          targetRecord({ platform: "ios", device, metroPort, metroTarget: null, selectedTargetId: selectedTargetId2 })
        );
      } else {
        for (const metroTarget of matchingMetroTargets) {
          targets.push(
            targetRecord({ platform: "ios", device, metroPort, metroTarget, selectedTargetId: selectedTargetId2 })
          );
        }
      }
    }
  }
  return targets.sort(compareTargets);
}
function compareTargets(left, right) {
  return Number(right.selected) - Number(left.selected) || Number(right.metro.status === "available") - Number(left.metro.status === "available") || deviceName(left).localeCompare(deviceName(right));
}
function deviceName(target) {
  return target.device.name ?? "";
}
function normalizeSimulatorDevices(rawDevices) {
  return rawDevices.map((device) => ({
    id: String(device.udid ?? ""),
    name: typeof device.name === "string" ? device.name : String(device.udid ?? ""),
    state: normalizeDeviceState(device.state)
  })).sort(
    (left, right) => Number(right.state === "booted") - Number(left.state === "booted") || String(left.name).localeCompare(String(right.name))
  );
}
function normalizeMetroTargets(payload) {
  if (!Array.isArray(payload)) {
    return [];
  }
  return payload.flatMap((item) => {
    if (!isRecord8(item)) {
      return [];
    }
    return [
      {
        id: optionalString8(item.id),
        title: optionalString8(item.title),
        appId: optionalString8(item.appId),
        webSocketDebuggerUrl: optionalString8(item.webSocketDebuggerUrl),
        deviceName: optionalString8(item.deviceName)
      }
    ];
  });
}
function isRecord8(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function optionalString8(value) {
  return typeof value === "string" ? value : null;
}

// src/state/target-management/src/main/target-service.ts
import { execFile as nodeExecFile13 } from "node:child_process";
import { mkdir as mkdir18, readdir as readdir14, readFile as readFile26, writeFile as writeFile13 } from "node:fs/promises";
import { join as join20 } from "node:path";
async function listTargets(args, deps = defaultTargetDependencies) {
  const session = await deps.readLatestSession(args.stateRoot);
  const targets = await discoverTargets(
    { ...args, selectedTargetId: session?.activeTargetId ?? null },
    deps
  );
  return { available: targets.length > 0, targets };
}
async function selectTarget(args, deps = defaultTargetDependencies) {
  const session = await deps.readLatestSession(args.stateRoot);
  if (!session) {
    return {
      available: false,
      reason: "No session exists. Run `expo98 --json session new review` first."
    };
  }
  const targetId = requireString26(args.targetId, "targetId");
  const targets = await discoverTargets(
    { ...args, selectedTargetId: session.activeTargetId },
    deps
  );
  const target = targets.find((item) => item.targetId === targetId);
  if (!target) {
    return { available: false, reason: "Target not found.", targetId, targets };
  }
  const selected = { ...target, selected: true, stale: false };
  await deps.updateSessionRecord(args.stateRoot, {
    ...session,
    activeTargetId: selected.targetId,
    updatedAt: (args.now ?? (() => /* @__PURE__ */ new Date()))().toISOString()
  });
  await deps.writePersistedTarget(args.stateRoot, session.sessionId, selected);
  return selected;
}
async function getCurrentTarget(args, deps = defaultTargetDependencies) {
  const session = await deps.readLatestSession(args.stateRoot);
  if (!session) {
    return {
      available: false,
      reason: "No session exists. Run `expo98 --json session new review` first."
    };
  }
  if (!session.activeTargetId) {
    return {
      available: false,
      reason: "No target selected for the current session.",
      sessionId: session.sessionId
    };
  }
  const targets = await discoverTargets(
    { ...args, selectedTargetId: session.activeTargetId },
    deps
  );
  const current = targets.find((item) => item.targetId === session.activeTargetId);
  if (current) {
    return {
      available: true,
      sessionId: session.sessionId,
      target: { ...current, selected: true, stale: false }
    };
  }
  const persisted = await deps.readPersistedTarget(args.stateRoot, session.sessionId).catch(() => null);
  return {
    available: false,
    reason: "Selected target is stale.",
    sessionId: session.sessionId,
    target: persisted ? { ...persisted, selected: true, stale: true } : { targetId: session.activeTargetId, selected: true, stale: true }
  };
}
async function targetCommand(args, deps = defaultTargetDependencies) {
  const effectiveArgs = {
    ...args,
    stateRoot: args.stateRoot ?? resolveExpoStateRoot6(args)
  };
  const action = requireString26(args.action ?? "list", "action");
  if (!["list", "select", "current"].includes(action)) {
    throw new Error(`Unknown target action: ${action}`);
  }
  if (action === "list") {
    return listTargets(effectiveArgs, deps);
  }
  if (action === "select") {
    return selectTarget(effectiveArgs, deps);
  }
  return getCurrentTarget(effectiveArgs, deps);
}
var defaultTargetDependencies = {
  readLatestSession: async (stateRoot) => {
    const sessionsRoot = join20(stateRoot, "sessions");
    const entries = await readdir14(sessionsRoot, { withFileTypes: true }).catch(() => []);
    const sessions = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const record = await readJson6(join20(sessionsRoot, entry.name, "session.json")).catch(
        () => null
      );
      if (record) sessions.push(record);
    }
    sessions.sort(
      (left, right) => String(right.updatedAt ?? right.createdAt).localeCompare(
        String(left.updatedAt ?? left.createdAt)
      )
    );
    return sessions[0] ?? null;
  },
  updateSessionRecord: async (stateRoot, record) => {
    await mkdir18(sessionDirectory3(stateRoot, record.sessionId), { recursive: true });
    await writeJson2(sessionJsonPath(stateRoot, record.sessionId), record);
    return record;
  },
  readPersistedTarget: async (stateRoot, sessionId) => {
    return readJson6(join20(sessionDirectory3(stateRoot, sessionId), "target.json")).catch(
      () => null
    );
  },
  writePersistedTarget: async (stateRoot, sessionId, target) => {
    await mkdir18(sessionDirectory3(stateRoot, sessionId), { recursive: true });
    await writeJson2(join20(sessionDirectory3(stateRoot, sessionId), "target.json"), target);
  },
  listIosSimulatorTargets: async () => {
    const result = await execFile11("xcrun", ["simctl", "list", "devices", "available", "--json"], {
      timeout: 2e4
    });
    const parsed = JSON.parse(result.stdout || "{}");
    return normalizeSimulatorDevices(Object.values(parsed.devices ?? {}).flat());
  },
  fetchMetroTargets: async (port) => {
    const response = await fetch(`http://localhost:${port}/json/list`);
    if (!response.ok) return [];
    return response.json();
  }
};
async function execFile11(file, args, options) {
  return new Promise((resolve18, reject) => {
    nodeExecFile13(
      file,
      args,
      { timeout: options.timeout, maxBuffer: 4 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          Object.assign(error, { stdout, stderr });
          reject(error);
          return;
        }
        resolve18({ stdout: String(stdout ?? ""), stderr: String(stderr ?? "") });
      }
    );
  });
}
async function readJson6(file) {
  return JSON.parse(await readFile26(file, "utf8"));
}
async function writeJson2(file, value) {
  await writeFile13(file, `${JSON.stringify(value, null, 2)}
`, "utf8");
}

// src/bundled-cli.ts
var CLI_VERSION5 = "0.1.0";
var runtime;
var runToolInCurrentRuntime = async (toolName, args) => {
  const handler = runtime.handlers[toolName];
  if (!handler) {
    throw new Error(`Unknown batch tool: ${toolName}`);
  }
  return handler(args);
};
function runBatchCommand(args) {
  return batchCommand(args, { runToolAndEmitPayload: runToolInCurrentRuntime });
}
var handlerImplementations = {
  doctor: expo98Doctor,
  projectInfo,
  expoRouterSitemap,
  listDevices,
  sessionCommand,
  targetCommand,
  snapshotCommand,
  refsCommand,
  getRefCommand,
  findCommand,
  waitCommand,
  batchCommand: runBatchCommand,
  bootSimulator,
  openUrl,
  launchApp,
  terminateApp,
  reloadApp,
  installApp,
  uninstallApp,
  refActionCommand,
  clipboardCommand,
  keyboardCommand,
  setEnvironmentCommand,
  collectAppLogs,
  automationTakeScreenshot,
  automationTap,
  automationGesture,
  openExpoRoute,
  captureUxContext,
  annotateScreen,
  runtimeInspector,
  reviewOverlay,
  reviewNextStep,
  removedAnnotationServerCommand,
  devtoolsCommand,
  consoleCommand,
  errorsCommand,
  metroCommand,
  navigationCommand,
  networkCommand,
  storageCommand,
  stateCommand,
  controlsCommand,
  bridgeCommand,
  accessibilityCommand,
  dialogCommand,
  sheetCommand,
  recordCommand,
  diffCommand,
  debugInspectCommand,
  highlightCommand,
  expoCommand,
  rnCommand,
  perfCommand,
  dashboardCommand,
  reviewCommand,
  policyCommand,
  redactCommand,
  skillsCommand,
  installCommand,
  upgradeCommand,
  releaseCommand,
  liveBacklogCommand,
  traceInteraction
};
runtime = createCliRuntime({
  parseCliArgs,
  commandArgs,
  dispatchCommand,
  bindHandlers,
  createCliFacade,
  writeCliError: (error, options) => {
    const text = formatCliError(error, options);
    if (text !== null) {
      process.stderr.write(text);
    }
  },
  exitCodeForError,
  handlerImplementations,
  startRunRecord: (entry) => startRunRecord(entry),
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
  printHelp: () => cliHelpText2(CLI_VERSION5),
  cliVersion: CLI_VERSION5
});
var executable = createCliExecutable({
  argv: () => process.argv,
  main: (argv) => runtime.run(argv),
  setExitCode: (exitCode) => {
    process.exitCode = exitCode;
  },
  writeCliError: (error) => {
    process.stderr.write(formatCliError(error, runtime.getLastCliOptions()) ?? "");
  },
  exitCodeForError
});
void executable.run();
async function expo98Doctor(args = {}) {
  const result = await doctor(args);
  const payload = unwrapToolJson(result);
  const cli = typeof payload.cli === "object" && payload.cli !== null ? { ...payload.cli, name: "expo98", bin: "expo98" } : { name: "expo98", version: CLI_VERSION5, bin: "expo98" };
  return toolJson({
    ...payload,
    cli,
    runtime: {
      node: process.version,
      supported: Number(process.versions.node.split(".")[0] ?? 0) >= 20,
      required: ">=20"
    },
    package: {
      name: "expo98",
      entrypoint: "cli/expo98.mjs",
      bundledExecutable: true,
      compatibilityBin: COMPATIBILITY_CLI_NAME
    }
  });
}
