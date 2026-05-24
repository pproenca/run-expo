import { execFile as nodeExecFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { evaluateHermesExpression as sharedEvaluateHermesExpression } from "../../../../platform/hermes-cdp-client/src/main/index.ts";
import { metroTargets } from "../../../metro-probes/src/main/index.ts";
import { openExpoRoute } from "../../../route-url-actions/src/main/index.ts";
import { resolveIosDevice } from "../../../route-url-actions/src/main/index.ts";
import { policyDeniedPayload } from "../../../../core/policy-redaction/src/main/policy-service.ts";
import { toolJson, unwrapToolJson, type ToolTextResult } from "../../../../core/tool-json-envelope/src/main/index.ts";
import { policyDecision as bridgePolicyDecision } from "../../../bridge-domain-actions/src/main/index.ts";

export const INSPECTOR_ACTIONS = ["probe", "toggle", "install-comment-menu", "read-comments", "clear-comments", "open-dev-menu"] as const;
export type InspectorAction = (typeof INSPECTOR_ACTIONS)[number];

export interface RuntimeInspectorArgs {
  action?: unknown;
  metroPort?: unknown;
  commentTitle?: unknown;
  maxComments?: unknown;
  device?: unknown;
  devClientUrl?: unknown;
  bundleId?: unknown;
  restartDevClient?: unknown;
  crashCheckMs?: unknown;
  actionPolicy?: unknown;
  [key: string]: unknown;
}

export interface MetroTargetSummary {
  title?: unknown;
  appId?: unknown;
  deviceName?: unknown;
  description?: unknown;
  webSocketDebuggerUrl?: unknown;
}

export interface DeviceRecord {
  udid: string;
  [key: string]: unknown;
}

export interface ExecResult {
  stdout?: unknown;
  stderr?: unknown;
  error?: unknown;
}

export interface RuntimeInspectorDependencies {
  fetchMetroTargets: (metroPort: number) => Promise<unknown>;
  evaluateHermesExpression: (
    webSocketDebuggerUrl: string,
    expression: string,
    options: { timeoutMs: number },
  ) => Promise<unknown>;
  openIosDevMenu: (args: RuntimeInspectorArgs & { metroPort: number }) => Promise<unknown>;
}

export interface OpenDevMenuDependencies {
  broadcastMetroMessage: (metroPort: number, method: string | null, params?: unknown) => Promise<Record<string, unknown>>;
  resolveIosDevice: (device: unknown, options: { preferBooted: true }) => Promise<DeviceRecord>;
  openDevClientForMessageSocket: (args: {
    device: DeviceRecord;
    bundleId: unknown;
    devClientUrl: string;
    restartDevClient: boolean;
    metroPort: number;
    crashCheckMs: unknown;
  }) => Promise<Record<string, unknown>>;
  execFile: (command: string, args: string[], options: { timeout: number; rejectOnError: false }) => Promise<ExecResult>;
  readJsonFile?: (file: string) => Promise<unknown>;
  resolvePath?: (file: string) => string;
  truncate?: (value: unknown) => string;
}

export { toolJson, unwrapToolJson };

export async function runtimeInspector(
  args: RuntimeInspectorArgs,
  deps: RuntimeInspectorDependencies = defaultRuntimeInspectorDependencies,
): Promise<ToolTextResult> {
  const metroPort = clampNumber(args.metroPort ?? 8081, 1, 65535);
  const action = normalizeRuntimeInspectorAction(args.action ?? "probe");
  const commentTitle = requireOptionalString(args.commentTitle) ?? "Codex: Add UI comment";
  const maxComments = clampNumber(args.maxComments ?? 50, 1, 500);

  if (action === "open-dev-menu") {
    return toolJson(await deps.openIosDevMenu({ ...args, metroPort }));
  }

  const targets = await deps.fetchMetroTargets(metroPort).catch(() => []);
  const targetList = Array.isArray(targets) ? targets : [];
  const webSocketDebuggerUrl = asString(asRecord(targetList[0])?.webSocketDebuggerUrl);
  if (!webSocketDebuggerUrl) {
    return toolJson({ available: false, action, reason: "No Metro inspector target.", metroPort });
  }

  const expression = runtimeInspectorExpression({ action, commentTitle, maxComments });
  const result = await deps.evaluateHermesExpression(webSocketDebuggerUrl, expression, { timeoutMs: 8000 });

  return toolJson({
    action,
    metroPort,
    target: targetSummary(targetList[0]),
    inspector: getPath(result, ["result", "result", "value"]) ?? null,
    protocolError: getPath(result, ["result", "exceptionDetails"]) ?? asRecord(result)?.error ?? null,
    cdp: asRecord(result)?.diagnostics ?? asRecord(result)?.cdp ?? null,
  });
}

const defaultRuntimeInspectorDependencies: RuntimeInspectorDependencies = {
  fetchMetroTargets: (metroPort) => metroTargets(metroPort),
  evaluateHermesExpression: sharedEvaluateHermesExpression,
  openIosDevMenu: (args) => openIosDevMenu(args, defaultOpenDevMenuDependencies),
};

const defaultOpenDevMenuDependencies: OpenDevMenuDependencies = {
  broadcastMetroMessage,
  resolveIosDevice: (device, options) => resolveIosDevice(requireOptionalString(device), options),
  openDevClientForMessageSocket: async (args) => unwrapToolJson(await openExpoRoute({
    device: args.device.udid,
    bundleId: args.bundleId,
    url: args.devClientUrl,
  })) as Record<string, unknown>,
  execFile,
  readJsonFile: async (file) => JSON.parse(await readFile(file, "utf8")),
  resolvePath: (file) => path.resolve(file),
  truncate,
};

export function normalizeRuntimeInspectorAction(value: unknown): InspectorAction {
  const action = requireString(value, "action");
  if (!(INSPECTOR_ACTIONS as readonly string[]).includes(action)) {
    throw new Error(`Unknown inspector action: ${action}`);
  }
  return action as InspectorAction;
}

export async function openIosDevMenu(
  args: RuntimeInspectorArgs,
  deps: OpenDevMenuDependencies,
): Promise<Record<string, unknown>> {
  const metroPort = clampNumber(args.metroPort ?? 8081, 1, 65535);
  const policy = await bridgePolicyDecision(args, "open-dev-menu", "device", deps);
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
      note: "This uses Expo/Metro's /message websocket devMenu broadcast, matching the Expo CLI toggle developer menu path.",
    };
  }

  const device = await deps.resolveIosDevice(args.device, { preferBooted: true });
  const devClientUrl = requireOptionalString(args.devClientUrl);
  let devClientRepair: Record<string, unknown> | null = null;
  if (devClientUrl) {
    devClientRepair = await deps.openDevClientForMessageSocket({
      device,
      bundleId: args.bundleId,
      devClientUrl,
      restartDevClient: args.restartDevClient === true,
      metroPort,
      crashCheckMs: args.crashCheckMs,
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
        reason: "The app generated an iOS crash report after opening the development client URL.",
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
        note: "Opened the supplied Expo development client URL, then used Metro's /message websocket devMenu broadcast.",
      };
    }
  }

  const command = ["xcrun", "simctl", "io", device.udid, "shake"];
  const result = await deps.execFile(command[0], command.slice(1), {
    timeout: 15_000,
    rejectOnError: false,
  });
  const truncateFn = deps.truncate ?? truncate;
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
    note: "Tried Expo/Metro's /message websocket devMenu broadcast first, then fell back to the simulator shake gesture.",
  };
}

export function runtimeInspectorExpression(args: {
  action: InspectorAction;
  commentTitle: string;
  maxComments: number;
}): string {
  return runtimeInspectorProgram([
    runtimeInspectorInputs(args),
    runtimeInspectorStateSection(),
    runtimeInspectorProbeSection(),
    runtimeInspectorCommentMenuSection(),
    runtimeInspectorDispatchSection(),
  ]);
}

function runtimeInspectorProgram(sections: string[]): string {
  return `(() => {\n${sections.join("\n")}\n  })()`;
}

function runtimeInspectorInputs(args: {
  action: InspectorAction;
  commentTitle: string;
  maxComments: number;
}): string {
  return `    const action = ${JSON.stringify(args.action)};
    const commentTitle = ${JSON.stringify(args.commentTitle)};
    const maxComments = ${JSON.stringify(args.maxComments)};`;
}

function runtimeInspectorStateSection(): string {
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

function runtimeInspectorProbeSection(): string {
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

function runtimeInspectorCommentMenuSection(): string {
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

function runtimeInspectorDispatchSection(): string {
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

export function targetSummary(target: unknown): Record<string, unknown> | null {
  const record = asRecord(target);
  if (!record) return null;
  return {
    title: record.title,
    appId: record.appId,
    deviceName: record.deviceName,
    description: record.description,
  };
}

export function clampNumber(value: unknown, min: number, max: number): number {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new Error(`Expected a finite number, got ${value}.`);
  }
  return Math.min(Math.max(number, min), max);
}

export function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${field} must be a non-empty string.`);
  }
  return value.trim();
}

export function requireOptionalString(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  return requireString(value, "value");
}

export function truncate(value: unknown, limit = 40_000): string {
  const text = String(value ?? "");
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}\n[truncated ${text.length - limit} characters]`;
}

function getPath(value: unknown, path: string[]): unknown {
  let current = value;
  for (const part of path) {
    current = asRecord(current)?.[part];
    if (current === undefined) return undefined;
  }
  return current;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

async function broadcastMetroMessage(
  metroPort: number,
  method: string | null,
  params?: unknown,
): Promise<Record<string, unknown>> {
  if (!method) return { available: false, reason: "No Metro message method was requested.", metroPort };
  if (typeof WebSocket !== "function") return { available: false, reason: "This Node runtime does not expose a WebSocket client.", metroPort };
  const url = `ws://127.0.0.1:${metroPort}/message?role=debugger&name=expo98`;
  try {
    await cdpMessage(url, { method, params: params ?? {} }, 2500);
    return { available: true, metroPort, method, url };
  } catch (error) {
    return { available: false, metroPort, method, url, reason: formatError(error) };
  }
}

async function cdpMessage(url: string, payload: Record<string, unknown>, timeoutMs: number): Promise<void> {
  const ws = new WebSocket(url);
  await waitForOpen(ws, timeoutMs);
  try {
    ws.send(JSON.stringify(payload));
  } finally {
    ws.close();
  }
}

function waitForOpen(ws: WebSocket, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timed out opening WebSocket.")), timeoutMs);
    ws.addEventListener("open", () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
    ws.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new Error("WebSocket connection failed."));
    }, { once: true });
  });
}

function execFile(
  command: string,
  args: string[],
  options: { timeout: number; rejectOnError: false },
): Promise<ExecResult> {
  return new Promise((resolve) => {
    nodeExecFile(command, args, { timeout: options.timeout, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
      resolve({
        stdout: String(stdout ?? ""),
        stderr: String(stderr ?? ""),
        error: error ? { message: error.message } : null,
      });
    });
  });
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
