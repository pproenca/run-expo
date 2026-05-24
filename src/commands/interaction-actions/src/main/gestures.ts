import { basename } from "node:path";

import { defaultInteractionDependencies } from "./dependencies.js";
import {
  asGesturePlan,
  asRecord,
  clampNumber,
  formatSeconds,
  optionalString,
  platformArg,
  policyGate,
  requireString,
  reviewQuestions,
  resolveIosInteractionTool,
  toolJson,
  truncate,
  unwrapToolPayload,
} from "./shared.js";
import type { GesturePlan, InteractionArgs, InteractionDependencies, InteractionPayload } from "./types.js";

export async function automationGesture(
  args: InteractionArgs,
  deps: InteractionDependencies = defaultInteractionDependencies,
): Promise<InteractionPayload> {
  return automationGestureInternal(args, deps, false);
}

export async function automationGestureInternal(
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

export async function captureGestureScreenshot(
  args: InteractionArgs,
  deps: InteractionDependencies = defaultInteractionDependencies,
): Promise<InteractionPayload> {
  const root = optionalString(args.outputDir) ?? deps.joinPath(deps.tmpdir(), "expo98-gestures");
  await deps.mkdir(root, { recursive: true });
  const outputPath = deps.joinPath(root, `${requireString(args.label, "label")}-${deps.now().toISOString().replace(/[:.]/g, "-")}.png`);
  return unwrapToolPayload(await deps.captureScreenshot({ platform: args.platform, device: args.device, outputPath }));
}
