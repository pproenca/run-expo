import { execFile as nodeExecFile, spawn as nodeSpawn } from "node:child_process";
import * as fs from "node:fs/promises";
import { tmpdir as osTmpdir } from "node:os";
import { basename, join as joinPath } from "node:path";
import { traceInteraction } from "../../../interaction-trace-expression/src/main/index.ts";
import { automationTakeScreenshot } from "../../../screenshot-capture/src/main/index.ts";

export const MAX_OUTPUT = 40_000;

export type Platform = "ios" | "android";

export type ExecError = {
  message: string;
  code?: number | string | null;
  signal?: string | null;
};

export type ExecResult = {
  stdout?: string | null;
  stderr?: string | null;
  error?: ExecError | null;
};

export type ExecOptions = {
  timeout?: number;
  rejectOnError?: boolean;
  input?: string;
};

export type ExecCall = {
  file: string;
  args: string[];
  options: ExecOptions;
};

export type IosDevice = {
  udid: string;
  name?: string;
  state?: string;
  runtime?: string;
  isAvailable?: boolean;
};

export type ActionPolicyDecision = {
  checked: true;
  action: string;
  sideEffect: "read" | "device" | "write" | "runtime-eval";
  allowed: boolean;
  source: string | null;
  reason: string;
};

export type RefBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type RefRecord = {
  ref: string;
  targetId?: string;
  stale?: boolean;
  role?: string;
  label?: string;
  text?: string;
  box?: RefBox;
  actions?: string[];
};

export type RefCache = {
  refs: RefRecord[];
};

export type ToolTextResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

export type GesturePlan = {
  tool: string;
  command: string[];
  repeat: number;
  intervalMs: number;
  notes: string[];
};

export type InteractionDependencies = {
  commandPath(command: string): Promise<string | null>;
  execFile(file: string, args: string[], options: ExecOptions): Promise<ExecResult>;
  resolveIosDevice(requested: string | undefined, options: { preferBooted: true }): Promise<IosDevice>;
  planRefAction(args: Record<string, unknown>): Promise<Record<string, unknown>>;
  readRefRecord(ref: unknown, args: Record<string, unknown>): Promise<Record<string, unknown>>;
  refPoint(ref: unknown, args: Record<string, unknown>): Promise<Record<string, unknown>>;
  scrollPlan(args: Record<string, unknown>): Promise<Record<string, unknown>>;
  policyDecision(args: Record<string, unknown>, action: string, sideEffect: "device"): Promise<ActionPolicyDecision>;
  captureScreenshot(args: Record<string, unknown>): Promise<ToolTextResult | Record<string, unknown>>;
  traceInteraction(args: Record<string, unknown>): Promise<ToolTextResult | Record<string, unknown>>;
  wait(ms: number): Promise<void>;
  now(): Date;
  tmpdir(): string;
  mkdir(path: string, options: { recursive: true }): Promise<unknown>;
  joinPath(...parts: string[]): string;
};

export type RefActionAdapterDependencies = {
  readLatestRefCache(args?: Record<string, unknown>): Promise<{ refs: RefRecord[] } | null>;
};

export type RefActionModule = {
  planRefAction(args: Record<string, unknown>, deps: RefActionAdapterDependencies): Promise<Record<string, unknown>>;
  refPoint(ref: unknown, deps: RefActionAdapterDependencies): Promise<Record<string, unknown>>;
  scrollPlan(args: Record<string, unknown>, deps: RefActionAdapterDependencies): Promise<Record<string, unknown>>;
};

export type InteractionArgs = Record<string, unknown>;
export type InteractionPayload = Record<string, unknown>;

const defaultInteractionDependencies: InteractionDependencies = {
  commandPath: defaultCommandPath,
  execFile: defaultExecFile,
  resolveIosDevice: defaultResolveIosDevice,
  planRefAction: async () => ({ available: false, reason: "Ref actions require a current snapshot." }),
  readRefRecord: async () => ({ available: false, reason: "No snapshot exists for the current session." }),
  refPoint: async () => ({ available: false, reason: "Ref point lookup requires a current snapshot." }),
  scrollPlan: async () => ({ available: false, reason: "Scroll planning requires a current snapshot." }),
  policyDecision: defaultPolicyDecision,
  captureScreenshot: (args) => automationTakeScreenshot(args),
  traceInteraction: (args) => traceInteraction(args),
  wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now: () => new Date(),
  tmpdir: osTmpdir,
  mkdir: (path, options) => fs.mkdir(path, options),
  joinPath,
};

export async function automationTap(
  args: InteractionArgs,
  deps: InteractionDependencies = defaultInteractionDependencies,
): Promise<InteractionPayload> {
  return automationTapInternal(args, deps, false);
}

async function automationTapInternal(
  args: InteractionArgs,
  deps: InteractionDependencies,
  policyChecked: boolean,
): Promise<InteractionPayload> {
  const policyDenied = policyChecked ? null : await policyGate(args, "tap", "interaction", deps);
  if (policyDenied) return policyDenied;
  if (args.ref) {
    const planned = await deps.planRefAction({ ...args, action: "tap" });
    if (args.dryRun === true || planned.available === false) return planned;
    const point = asRecord(asRecord(planned.plan).point);
    if (!isFinitePoint(point)) {
      return { available: false, reason: "Ref does not include tappable bounds.", ref: args.ref };
    }
    return automationTapInternal({ ...args, ref: undefined, x: point.x, y: point.y }, deps, true);
  }

  const platform = platformArg(args.platform);
  const x = String(clampNumber(args.x, 0, Number.MAX_SAFE_INTEGER));
  const y = String(clampNumber(args.y, 0, Number.MAX_SAFE_INTEGER));
  if (args.dryRun === true) {
    const iosTool = platform === "ios" ? await resolveIosInteractionTool(deps) : null;
    const iosCommand = iosTool?.tool === "axe"
      ? ["axe", "tap", "-x", x, "-y", y, "--udid", optionalString(args.device) ?? "<booted-device>"]
      : ["idb", "ui", "tap", x, y, "--udid", optionalString(args.device) ?? "<booted-device>"];
    return {
      available: true,
      dryRun: true,
      platform,
      device: optionalString(args.device),
      tool: platform === "android" ? "adb" : iosTool?.tool ?? "idb",
      point: { x: Number(x), y: Number(y) },
      command: platform === "android"
        ? ["adb", ...androidDeviceArgs(optionalString(args.device), ["shell", "input", "tap", x, y])]
        : iosCommand,
    };
  }

  if (platform === "android") {
    const result = await deps.execFile("adb", androidDeviceArgs(optionalString(args.device), ["shell", "input", "tap", x, y]), {
      timeout: 20_000,
      rejectOnError: false,
    });
    return { platform, device: optionalString(args.device), x: Number(x), y: Number(y), stdout: truncate(result.stdout), stderr: truncate(result.stderr) };
  }

  const tool = await resolveIosInteractionTool(deps);
  if (!tool) {
    throw new Error(
      "iOS coordinate taps require the idb or axe CLI, but neither is installed or on PATH. Install idb or axe for iOS coordinate automation.",
    );
  }
  const device = await deps.resolveIosDevice(optionalString(args.device) ?? undefined, { preferBooted: true });
  const command = tool.tool === "axe"
    ? ["tap", "-x", x, "-y", y, "--udid", device.udid]
    : ["ui", "tap", x, y, "--udid", device.udid];
  const result = await deps.execFile(tool.path, command, { timeout: 20_000, rejectOnError: false });
  return { platform, device, tool: tool.tool, x: Number(x), y: Number(y), stdout: truncate(result.stdout), stderr: truncate(result.stderr) };
}

export async function refActionCommand(
  args: InteractionArgs,
  deps: InteractionDependencies = defaultInteractionDependencies,
): Promise<InteractionPayload> {
  const command = requireString(args.command, "command");
  if (command === "scroll-into-view") {
    const record = await deps.readRefRecord(args.ref, args);
    return record.available === false
      ? record
      : { available: true, action: command, ref: args.ref, reason: "Ref is present in the current snapshot.", record: record.record };
  }
  if (command === "blur") {
    const policyDenied = await policyGate(args, "ref.blur", "ref", deps);
    if (policyDenied) return policyDenied;
    return keyboardCommand({ ...args, action: "press", key: "Enter" }, deps);
  }
  if (["focus", "check", "uncheck", "select"].includes(command)) {
    const policyDenied = await policyGate(args, `ref.${command}`, "ref", deps);
    if (policyDenied) return policyDenied;
    const tapped = await automationTapInternal({ ...args, ref: args.ref, dryRun: args.dryRun }, deps, true);
    return { ...tapped, action: command, ref: args.ref, value: args.text ?? null };
  }
  if (command === "fill") {
    const policyDenied = await policyGate(args, "ref.fill", "ref", deps);
    if (policyDenied) return policyDenied;
    const ref = requireString(args.ref, "ref");
    const text = requireString(args.text, "text");
    if (args.dryRun === true) {
      return { available: true, dryRun: true, action: command, ref, textLength: text.length, steps: ["tap ref", "type text"] };
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
    const coordinates = asRecord(point.point);
    return automationGestureInternal({
      ...args,
      gesture: command === "long-press" ? "long-press" : "tap",
      x: coordinates.x,
      y: coordinates.y,
      repeat: command === "dbltap" ? 2 : 1,
      intervalMs: command === "dbltap" ? 80 : args.intervalMs,
    }, deps, true);
  }
  if (command === "drag") {
    const policyDenied = await policyGate(args, "ref.drag", "ref", deps);
    if (policyDenied) return policyDenied;
    const start = await deps.refPoint(args.ref, args);
    const end = await deps.refPoint(args.targetRef, args);
    if (start.available === false) return start;
    if (end.available === false) return { ...end, role: "targetRef" };
    return automationGestureInternal({
      ...args,
      gesture: "drag",
      startX: asRecord(start.point).x,
      startY: asRecord(start.point).y,
      endX: asRecord(end.point).x,
      endY: asRecord(end.point).y,
      durationMs: args.durationMs ?? 600,
    }, deps, true);
  }
  if (command === "scroll") {
    const policyDenied = await policyGate(args, "ref.scroll", "ref", deps);
    if (policyDenied) return policyDenied;
    const plan = await deps.scrollPlan(args);
    if (plan.available === false || args.dryRun === true) return plan;
    return automationGestureInternal({ ...args, gesture: "swipe", ...asRecord(plan.coordinates), durationMs: args.durationMs ?? 250 }, deps, true);
  }
  throw new Error(`Unknown ref action command: ${command}`);
}

export async function clipboardCommand(
  args: InteractionArgs,
  deps: InteractionDependencies = defaultInteractionDependencies,
): Promise<InteractionPayload> {
  const action = requireString(args.action ?? "read", "action");
  if (!["read", "write", "paste"].includes(action)) throw new Error(`Unknown clipboard action: ${action}`);
  if (action !== "read") {
    const policyDenied = await policyGate(args, `clipboard.${action}`, "clipboard", deps);
    if (policyDenied) return policyDenied;
  }
  const device = await deps.resolveIosDevice(optionalString(args.device) ?? undefined, { preferBooted: true });
  if (args.dryRun === true) {
    return { available: true, dryRun: true, action: `clipboard.${action}`, device };
  }
  if (action === "read") {
    const result = await deps.execFile("xcrun", ["simctl", "pbpaste", device.udid], { timeout: 10_000, rejectOnError: false });
    return { available: !result.error, action, device, text: result.stdout, stderr: truncate(result.stderr), error: result.error ?? null };
  }
  if (action === "write") {
    const text = requireString(args.text, "text");
    const result = await deps.execFile("xcrun", ["simctl", "pbcopy", device.udid], { input: text, timeout: 10_000, rejectOnError: false });
    return { available: !result.error, action, device, textLength: text.length, stdout: truncate(result.stdout), stderr: truncate(result.stderr), error: result.error ?? null };
  }
  const axe = await deps.commandPath("axe");
  if (!axe) return { available: false, action, reason: "clipboard paste requires axe key-combo support.", device };
  const result = await deps.execFile(axe, ["key-combo", "--modifiers", "227", "--key", "25", "--udid", device.udid], {
    timeout: 10_000,
    rejectOnError: false,
  });
  return { available: !result.error, action, device, tool: "axe", stdout: truncate(result.stdout), stderr: truncate(result.stderr), error: result.error ?? null };
}

export async function keyboardCommand(
  args: InteractionArgs,
  deps: InteractionDependencies = defaultInteractionDependencies,
): Promise<InteractionPayload> {
  const action = requireString(args.action ?? "type", "action");
  if (!["type", "press"].includes(action)) throw new Error(`Unknown keyboard action: ${action}`);
  const policyDenied = await policyGate(args, `keyboard.${action}`, "keyboard", deps);
  if (policyDenied) return policyDenied;
  const device = await deps.resolveIosDevice(optionalString(args.device) ?? undefined, { preferBooted: true });
  const axe = await deps.commandPath("axe");
  if (!axe) return { available: false, action, reason: "keyboard commands require the axe CLI.", device };
  if (args.dryRun === true) {
    return { available: true, dryRun: true, action: `keyboard.${action}`, device, tool: "axe" };
  }
  if (action === "type") {
    const text = requireString(args.text, "text");
    const result = await deps.execFile(axe, ["type", text, "--udid", device.udid], { timeout: 20_000, rejectOnError: false });
    return { available: !result.error, action, device, tool: "axe", textLength: text.length, stdout: truncate(result.stdout), stderr: truncate(result.stderr), error: result.error ?? null };
  }
  const key = requireString(args.key, "key");
  const keycode = keyCodeFor(key);
  const result = await deps.execFile(axe, ["key", String(keycode), "--udid", device.udid], { timeout: 10_000, rejectOnError: false });
  return { available: !result.error, action, device, tool: "axe", key, keycode, stdout: truncate(result.stdout), stderr: truncate(result.stderr), error: result.error ?? null };
}

export function keyCodeFor(key: unknown): number {
  const normalized = String(key).toLowerCase();
  const known: Record<string, number> = {
    enter: 40,
    return: 40,
    tab: 43,
    space: 44,
    backspace: 42,
    delete: 42,
    escape: 41,
    esc: 41,
  };
  if (known[normalized]) return known[normalized];
  if (/^\d+$/.test(normalized)) return clampNumber(Number(normalized), 0, 255);
  if (/^[a-z]$/.test(normalized)) return normalized.charCodeAt(0) - 93;
  throw new Error(`Unknown key: ${key}`);
}

export function setEnvironmentPlan(domain: string, args: InteractionArgs, device: IosDevice): InteractionPayload {
  const value = optionalString(args.value);
  const extra = Array.isArray(args.extra) ? args.extra : [];
  if (domain === "appearance") {
    if (!["dark", "light"].includes(value ?? "")) throw new Error("appearance must be dark or light.");
    return { available: true, action: domain, device, command: ["xcrun", "simctl", "ui", device.udid, "appearance", value] };
  }
  if (domain === "content-size") {
    const mapped = value === "accessibility" ? "accessibility-large" : requireString(value, "value");
    return { available: true, action: domain, device, command: ["xcrun", "simctl", "ui", device.udid, "content_size", mapped] };
  }
  if (domain === "location") {
    const lat = requireString(value, "latitude");
    const lon = requireString(extra[0], "longitude");
    return { available: true, action: domain, device, command: ["xcrun", "simctl", "location", device.udid, "set", `${lat},${lon}`] };
  }
  if (domain === "permissions") {
    const spec = requireString(value, "permission");
    const [service, state = "granted"] = spec.split("=");
    const bundleId = optionalString(args.bundleId) ?? optionalString(extra[0]);
    if (!bundleId) throw new Error("set permissions requires --bundle-id or a bundle id argument.");
    const action = state === "granted" ? "grant" : state === "denied" ? "revoke" : "reset";
    return { available: true, action: domain, device, command: ["xcrun", "simctl", "privacy", device.udid, action, service, bundleId] };
  }
  if (domain === "locale" || domain === "timezone" || domain === "network" || domain === "orientation" || domain === "keyboard") {
    return {
      available: false,
      action: domain,
      reason: `${domain} mutation is not exposed by stable simctl/axe commands in this CLI yet.`,
      requestedValue: value,
      device,
    };
  }
  throw new Error(`Unknown set domain: ${domain}`);
}

export async function setEnvironmentCommand(
  args: InteractionArgs,
  deps: InteractionDependencies = defaultInteractionDependencies,
): Promise<InteractionPayload> {
  const domain = requireString(args.domain, "domain");
  const device = await deps.resolveIosDevice(optionalString(args.device) ?? undefined, { preferBooted: true });
  const policy = await deps.policyDecision(args, `set.${domain}`, "device");
  if (!policy.allowed) return policyDeniedPayload({ domain: "set", action: domain, policy });
  const planned = setEnvironmentPlan(domain, args, device);
  if (args.dryRun === true || planned.available === false) {
    return { ...planned, dryRun: args.dryRun === true, policy };
  }
  const command = planned.command as string[];
  const result = await deps.execFile(command[0] ?? "", command.slice(1), {
    timeout: Number(planned.timeoutMs ?? 20_000),
    rejectOnError: false,
  });
  return {
    available: !result.error,
    action: domain,
    device,
    command,
    stdout: truncate(result.stdout),
    stderr: truncate(result.stderr),
    error: result.error ?? null,
    policy,
  };
}

export async function automationGesture(
  args: InteractionArgs,
  deps: InteractionDependencies = defaultInteractionDependencies,
): Promise<InteractionPayload> {
  return automationGestureInternal(args, deps, false);
}

async function automationGestureInternal(
  args: InteractionArgs,
  deps: InteractionDependencies,
  policyChecked: boolean,
): Promise<InteractionPayload> {
  const platform = platformArg(args.platform);
  const gesture = normalizeGesture(args.gesture);
  const policyDenied = policyChecked ? null : await policyGate(args, `gesture.${gesture}`, "gesture", deps);
  if (policyDenied) return policyDenied;
  const repeat = clampNumber(args.repeat ?? 1, 1, 20);
  const intervalMs = clampNumber(args.intervalMs ?? 250, 0, 10_000);
  const durationMs = clampNumber(args.durationMs ?? defaultGestureDurationMs(gesture), 1, 30_000);
  const holdMs = args.holdMs === undefined ? null : clampNumber(args.holdMs, 0, 30_000);
  const metroPort = clampNumber(args.metroPort ?? 8081, 1, 65_535);
  const maxEvents = clampNumber(args.maxEvents ?? 200, 1, 2_000);
  const componentFilter = optionalString(args.componentFilter);
  const cwd = optionalString(args.cwd) ?? ".";
  const coordinates = normalizeGestureCoordinates(gesture, args);
  const plan = gestureCommandPlan({ platform, gesture, coordinates, durationMs, holdMs, repeat, intervalMs, device: args.device });
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
      reviewQuestionsThisCanAnswer,
    };
  }

  const evidence: InteractionPayload = { traceStart: null, traceRead: null, traceStop: null, screenshots: {} };
  if (args.captureBeforeAfter === true) {
    asRecord(evidence.screenshots).before = await captureGestureScreenshot({ platform, device: args.device, outputDir: args.outputDir, label: "before" }, deps);
  }
  if (args.includeTrace === true) {
    evidence.traceStart = unwrapToolPayload(await deps.traceInteraction({ cwd, metroPort, action: "start", componentFilter, maxEvents, includeEvents: false }));
  }
  const execution = await executeGesturePlanInternal({ platform, device: args.device, gesture, plan, repeat, intervalMs }, deps, true);
  if (args.includeTrace === true) {
    evidence.traceRead = unwrapToolPayload(await deps.traceInteraction({ cwd, metroPort, action: "read", componentFilter, maxEvents, includeEvents: false }));
    evidence.traceStop = unwrapToolPayload(await deps.traceInteraction({ cwd, metroPort, action: "stop", componentFilter, maxEvents, includeEvents: false }));
  }
  if (args.captureBeforeAfter === true) {
    asRecord(evidence.screenshots).after = await captureGestureScreenshot({ platform, device: args.device, outputDir: args.outputDir, label: "after" }, deps);
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
        "gesture command reports unavailable tooling, meaning the interaction was not actually exercised",
      ],
    },
  };
}

export function normalizeGesture(value: unknown): string {
  const gesture = requireString(value, "gesture");
  if (gesture === "tap-and-hold") return "long-press";
  if (!["tap", "long-press", "drag", "swipe"].includes(gesture)) throw new Error(`Unknown gesture: ${gesture}`);
  return gesture;
}

export function defaultGestureDurationMs(gesture: string): number {
  if (gesture === "long-press") return 900;
  if (gesture === "drag") return 900;
  if (gesture === "swipe") return 250;
  return 80;
}

export function normalizeGestureCoordinates(gesture: string, args: InteractionArgs): InteractionPayload {
  if (gesture === "tap" || gesture === "long-press") {
    return {
      x: clampNumber(args.x, 0, Number.MAX_SAFE_INTEGER),
      y: clampNumber(args.y, 0, Number.MAX_SAFE_INTEGER),
    };
  }
  return {
    startX: clampNumber(args.startX, 0, Number.MAX_SAFE_INTEGER),
    startY: clampNumber(args.startY, 0, Number.MAX_SAFE_INTEGER),
    endX: clampNumber(args.endX, 0, Number.MAX_SAFE_INTEGER),
    endY: clampNumber(args.endY, 0, Number.MAX_SAFE_INTEGER),
  };
}

export function gestureCommandPlan(args: InteractionArgs): GesturePlan {
  const platform = platformArg(args.platform);
  const gesture = requireString(args.gesture, "gesture");
  const coordinates = asRecord(args.coordinates);
  const durationMs = Number(args.durationMs);
  const holdMs = args.holdMs === null ? null : Number(args.holdMs);
  const repeat = Number(args.repeat);
  const intervalMs = Number(args.intervalMs);
  const durationSeconds = formatSeconds(durationMs);
  const holdSeconds = holdMs === null ? null : formatSeconds(holdMs);
  if (platform === "android") {
    const deviceArgs = optionalString(args.device) ? ["-s", String(args.device)] : [];
    const command = gesture === "tap"
      ? ["adb", ...deviceArgs, "shell", "input", "tap", String(coordinates.x), String(coordinates.y)]
      : gesture === "long-press"
        ? ["adb", ...deviceArgs, "shell", "input", "swipe", String(coordinates.x), String(coordinates.y), String(coordinates.x), String(coordinates.y), String(durationMs)]
        : ["adb", ...deviceArgs, "shell", "input", "swipe", String(coordinates.startX), String(coordinates.startY), String(coordinates.endX), String(coordinates.endY), String(durationMs)];
    return {
      tool: "adb",
      command,
      repeat,
      intervalMs,
      notes: holdMs ? ["Android adb input swipe has duration but no separate hold-before-move primitive."] : [],
    };
  }
  const udidArgs = optionalString(args.device) ? ["--udid", String(args.device)] : ["--udid", "<resolved-booted-simulator-udid>"];
  const command = gesture === "tap"
    ? ["idb", "ui", "tap", String(coordinates.x), String(coordinates.y), ...udidArgs]
    : gesture === "long-press"
      ? ["idb", "ui", "tap", String(coordinates.x), String(coordinates.y), "--duration", durationSeconds, ...udidArgs]
      : ["idb", "ui", "swipe", String(coordinates.startX), String(coordinates.startY), String(coordinates.endX), String(coordinates.endY), "--duration", durationSeconds, ...udidArgs];
  return {
    tool: "idb",
    command,
    repeat,
    intervalMs,
    notes: holdSeconds ? ["Current idb plan records holdMs as intent; idb swipe supports duration but not a separate hold-before-move flag in this wrapper."] : [],
  };
}

export async function executeGesturePlan(
  args: InteractionArgs,
  deps: InteractionDependencies = defaultInteractionDependencies,
): Promise<InteractionPayload> {
  return executeGesturePlanInternal(args, deps, false);
}

async function executeGesturePlanInternal(
  args: InteractionArgs,
  deps: InteractionDependencies,
  policyChecked: boolean,
): Promise<InteractionPayload> {
  const platform = platformArg(args.platform);
  const plan = asGesturePlan(args.plan);
  const gesture = optionalString(args.gesture) ?? "unknown";
  const policyDenied = policyChecked ? null : await policyGate(args, `gesture.${gesture}`, "gesture", deps);
  if (policyDenied) return policyDenied;
  const repeat = clampNumber(args.repeat ?? plan.repeat, 1, 20);
  const intervalMs = clampNumber(args.intervalMs ?? plan.intervalMs, 0, 10_000);
  if (platform === "android") {
    const adb = await deps.commandPath("adb");
    if (!adb) return { available: false, reason: "Android gestures require adb, which is not installed or not on PATH.", plan };
    return executeRepeatedCommandInternal(plan.command[0] ?? "adb", plan.command.slice(1), { repeat, intervalMs }, deps);
  }

  const tool = await resolveIosInteractionTool(deps);
  if (!tool) {
    return {
      available: false,
      reason: "iOS complex gestures require the idb or axe CLI, but neither is installed or on PATH.",
      installHint: "Install idb or axe and rerun this command, or use dryRun=true to inspect the intended gesture plan.",
      plan,
    };
  }
  const resolvedDevice = args.device ? { udid: String(args.device) } : await deps.resolveIosDevice(undefined, { preferBooted: true });
  if (tool.tool === "axe") {
    const command = axeGestureCommandFromPlan({ gesture: args.gesture, plan, udid: resolvedDevice.udid });
    return executeRepeatedCommandInternal(tool.path, command.slice(1), { repeat, intervalMs, device: resolvedDevice, tool: tool.tool, plannedCommand: command }, deps);
  }
  const command = plan.command.map((part) => part === "<resolved-booted-simulator-udid>" ? resolvedDevice.udid : part);
  return executeRepeatedCommandInternal(tool.path, command.slice(1), { repeat, intervalMs, device: resolvedDevice, tool: tool.tool, plannedCommand: command }, deps);
}

export function axeGestureCommandFromPlan(args: InteractionArgs): string[] {
  const gesture = requireString(args.gesture, "gesture");
  const plan = asGesturePlan(args.plan);
  const udid = requireString(args.udid, "udid");
  const command = plan.command;
  if (gesture === "tap") return ["axe", "tap", "-x", command[3] ?? "", "-y", command[4] ?? "", "--udid", udid];
  if (gesture === "long-press") {
    const durationIndex = command.indexOf("--duration");
    const delay = durationIndex === -1 ? "0.9" : command[durationIndex + 1] ?? "0.9";
    return ["axe", "touch", "-x", command[3] ?? "", "-y", command[4] ?? "", "--down", "--up", "--delay", delay, "--udid", udid];
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
    command[6] ?? "",
  ];
  if (duration) axeCommand.push("--duration", duration);
  axeCommand.push("--udid", udid);
  return axeCommand;
}

export async function executeRepeatedCommand(
  command: string,
  args: string[],
  options: InteractionArgs,
  deps: InteractionDependencies = defaultInteractionDependencies,
): Promise<InteractionPayload> {
  const policyDenied = await policyGate(
    options,
    optionalString(options.policyAction) ?? "execute-command",
    optionalString(options.policyDomain) ?? "interaction",
    deps,
  );
  if (policyDenied) return policyDenied;
  return executeRepeatedCommandInternal(command, args, options, deps);
}

async function executeRepeatedCommandInternal(
  command: string,
  args: string[],
  options: InteractionArgs,
  deps: InteractionDependencies,
): Promise<InteractionPayload> {
  const repeat = clampNumber(options.repeat ?? 1, 1, 20);
  const intervalMs = clampNumber(options.intervalMs ?? 0, 0, 10_000);
  const runs: InteractionPayload[] = [];
  for (let index = 0; index < repeat; index += 1) {
    const result = await deps.execFile(command, args, { timeout: 35_000, rejectOnError: false });
    runs.push({
      index: index + 1,
      command: [command, ...args],
      exitCode: result.error?.code ?? 0,
      stdout: truncate(result.stdout),
      stderr: truncate(result.stderr),
    });
    if (index < repeat - 1 && intervalMs > 0) await deps.wait(intervalMs);
  }
  return {
    available: true,
    device: options.device ?? null,
    tool: options.tool ?? basename(command),
    command: options.plannedCommand ?? [basename(command), ...args],
    runs,
  };
}

export async function captureGestureScreenshot(args: InteractionArgs, deps: InteractionDependencies): Promise<InteractionPayload> {
  const root = optionalString(args.outputDir) ?? deps.joinPath(deps.tmpdir(), "expo-ios-gestures");
  await deps.mkdir(root, { recursive: true });
  const outputPath = deps.joinPath(root, `${requireString(args.label, "label")}-${deps.now().toISOString().replace(/[:.]/g, "-")}.png`);
  return unwrapToolPayload(await deps.captureScreenshot({ platform: args.platform, device: args.device, outputPath }));
}

async function defaultCommandPath(command: string): Promise<string | null> {
  const result = await defaultExecFile("which", [command], { timeout: 5_000, rejectOnError: false });
  return result.error ? null : optionalString(result.stdout);
}

function defaultExecFile(file: string, args: string[], options: ExecOptions = {}): Promise<ExecResult> {
  if (options.input !== undefined) {
    return defaultSpawnFile(file, args, options);
  }
  return new Promise((resolve, reject) => {
    nodeExecFile(file, args, { timeout: options.timeout, maxBuffer: MAX_OUTPUT }, (error, stdout, stderr) => {
      if (error && options.rejectOnError !== false) {
        Object.assign(error, { stdout, stderr });
        reject(error);
        return;
      }
      resolve({
        stdout: String(stdout ?? ""),
        stderr: String(stderr ?? ""),
        error: error ? { message: error.message, code: error.code, signal: error.signal } : null,
      });
    });
  });
}

function defaultSpawnFile(file: string, args: string[], options: ExecOptions = {}): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    const child = nodeSpawn(file, args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timeout = options.timeout ? setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      const error = { message: `${file} timed out after ${options.timeout}ms`, code: "ETIMEDOUT", signal: null };
      if (options.rejectOnError !== false) {
        reject(Object.assign(new Error(error.message), { stdout, stderr, code: error.code }));
      } else {
        resolve({ stdout, stderr, error });
      }
    }, options.timeout) : null;

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      if (options.rejectOnError !== false) {
        reject(Object.assign(error, { stdout, stderr }));
      } else {
        resolve({ stdout, stderr, error: { message: error.message, code: null, signal: null } });
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
        resolve({ stdout, stderr, error });
      }
    });
    child.stdin.end(options.input);
  });
}

async function defaultResolveIosDevice(requested: string | undefined): Promise<IosDevice> {
  if (requested && /^[0-9A-Fa-f-]{20,}$/.test(requested)) {
    return { udid: requested, name: requested, state: "unknown" };
  }
  const { stdout } = await defaultExecFile("xcrun", ["simctl", "list", "devices", "available", "--json"], {
    timeout: 20_000,
  });
  const parsed = JSON.parse(String(stdout ?? "{}")) as { devices?: Record<string, unknown[]> };
  const devices = Object.entries(parsed.devices ?? {}).flatMap(([runtime, runtimeDevices]) =>
    (Array.isArray(runtimeDevices) ? runtimeDevices : []).map((device) => {
      const record = asRecord(device);
      return {
        udid: String(record.udid ?? ""),
        name: String(record.name ?? ""),
        state: optionalString(record.state) ?? undefined,
        runtime,
        isAvailable: record.isAvailable === undefined ? undefined : Boolean(record.isAvailable),
      };
    }),
  ).filter((device) => device.udid && device.name);

  if (requested) {
    const exact = devices.find((device) => device.udid === requested || device.name === requested);
    if (exact) return exact;
    const partial = devices.find((device) => device.name.toLowerCase().includes(requested.toLowerCase()));
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

async function defaultPolicyDecision(
  args: Record<string, unknown>,
  action: string,
  sideEffect: "device",
): Promise<ActionPolicyDecision> {
  const policyPath = optionalString(args.actionPolicy);
  if (!policyPath) {
    return {
      checked: true,
      action,
      sideEffect,
      allowed: false,
      source: null,
      reason: "No action policy allowed this state-changing operation.",
    };
  }

  const policy = JSON.parse(await fs.readFile(policyPath, "utf8")) as {
    allow?: unknown;
    actions?: Record<string, unknown>;
  };
  const allowed = (Array.isArray(policy.allow) && policy.allow.includes(action))
    || policy.actions?.[action] === true
    || policy.actions?.[action] === "allow";
  return {
    checked: true,
    action,
    sideEffect,
    allowed,
    source: policyPath,
    reason: allowed ? "Action allowed by policy." : "Action policy did not allow this operation.",
  };
}

export function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${field} must be a non-empty string.`);
  return value.trim();
}

export function clampNumber(value: unknown, min: number, max: number): number {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`Expected a finite number, got ${value}.`);
  return Math.min(Math.max(number, min), max);
}

export function truncate(value: unknown, limit = MAX_OUTPUT): string {
  const text = String(value ?? "");
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}\n[truncated ${text.length - limit} characters]`;
}

export function toolJson(value: unknown): ToolTextResult {
  return { content: [{ type: "text", text: `${JSON.stringify(value, null, 2)}\n` }], isError: false };
}

export function createRefActionAdapter(
  refDeps: RefActionAdapterDependencies,
  refActions: RefActionModule,
): Pick<InteractionDependencies, "planRefAction" | "readRefRecord" | "refPoint" | "scrollPlan"> {
  return {
    planRefAction: (args) => refActions.planRefAction(args, refDeps),
    readRefRecord: async (ref, args) => readRefRecordFromCache(ref, args, refDeps),
    refPoint: (ref) => refActions.refPoint(ref, refDeps),
    scrollPlan: (args) => refActions.scrollPlan(args, refDeps),
  };
}

function policyDeniedPayload({ domain, action, policy }: { domain: string; action: string; policy: ActionPolicyDecision }): InteractionPayload {
  return {
    available: false,
    domain,
    action,
    source: "policy",
    evidenceSource: "policy",
    code: "policy-denied",
    denied: true,
    reason: "Policy denied action.",
    policy,
  };
}

async function readRefRecordFromCache(
  refValue: unknown,
  args: InteractionArgs,
  deps: RefActionAdapterDependencies,
): Promise<InteractionPayload> {
  const ref = requireString(refValue, "ref");
  const cache = await deps.readLatestRefCache(args);
  if (!cache) return { available: false, reason: "No snapshot exists for the current session.", ref };
  const record = cache.refs.find((item) => item.ref === ref);
  if (!record) return { available: false, reason: "Ref not found in the latest snapshot.", ref };
  if (record.stale) return { available: false, reason: "Ref is stale. Capture a new snapshot before acting.", ref };
  return { available: true, record, cache };
}

async function policyGate(
  args: InteractionArgs,
  action: string,
  domain: string,
  deps: InteractionDependencies,
): Promise<InteractionPayload | null> {
  const policy = await deps.policyDecision(args, action, "device");
  return policy.allowed ? null : policyDeniedPayload({ domain, action, policy });
}

async function resolveIosInteractionTool(deps: InteractionDependencies): Promise<{ tool: "idb" | "axe"; path: string } | null> {
  const idb = await deps.commandPath("idb");
  if (idb) return { tool: "idb", path: idb };
  const axe = await deps.commandPath("axe");
  if (axe) return { tool: "axe", path: axe };
  return null;
}

function androidDeviceArgs(device: string | null, args: string[]): string[] {
  return device ? ["-s", device, ...args] : args;
}

function platformArg(value: unknown): Platform {
  return value === "android" ? "android" : "ios";
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asRecord(value: unknown): InteractionPayload {
  return value && typeof value === "object" ? value as InteractionPayload : {};
}

function isFinitePoint(value: InteractionPayload): value is { x: number; y: number } {
  return Number.isFinite(value.x) && Number.isFinite(value.y);
}

function asGesturePlan(value: unknown): GesturePlan {
  const record = asRecord(value);
  return {
    tool: String(record.tool ?? ""),
    command: Array.isArray(record.command) ? record.command.map(String) : [],
    repeat: Number(record.repeat ?? 1),
    intervalMs: Number(record.intervalMs ?? 0),
    notes: Array.isArray(record.notes) ? record.notes.map(String) : [],
  };
}

function unwrapToolPayload(value: ToolTextResult | Record<string, unknown>): InteractionPayload {
  if (value && typeof value === "object" && Array.isArray((value as ToolTextResult).content)) {
    const text = (value as ToolTextResult).content[0]?.text ?? "{}";
    return JSON.parse(text) as InteractionPayload;
  }
  return asRecord(value);
}

function formatSeconds(ms: number): string {
  return (ms / 1000).toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

function reviewQuestions(): string[] {
  return [
    "Does a long press stay on the intended target instead of becoming scroll?",
    "Does a drag/swipe create, resize, or scroll according to the intended mode?",
    "Do screenshots before and after show unintended movement, selection, or chrome overlap?",
    "Do React commits/layout changes during the gesture match the expected interaction owner?",
  ];
}
