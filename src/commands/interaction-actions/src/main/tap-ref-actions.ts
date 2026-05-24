import { defaultInteractionDependencies } from "./dependencies.js";
import { automationGestureInternal } from "./gestures.js";
import { keyboardCommand } from "./keyboard-clipboard.js";
import {
  androidDeviceArgs,
  asRecord,
  clampNumber,
  isFinitePoint,
  optionalString,
  platformArg,
  policyGate,
  requireString,
  resolveIosInteractionTool,
  truncate,
} from "./shared.js";
import type { InteractionArgs, InteractionDependencies, InteractionPayload } from "./types.js";

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
    const iosCommand =
      iosTool?.tool === "axe"
        ? [
            "axe",
            "tap",
            "-x",
            x,
            "-y",
            y,
            "--udid",
            optionalString(args.device) ?? "<booted-device>",
          ]
        : ["idb", "ui", "tap", x, y, "--udid", optionalString(args.device) ?? "<booted-device>"];
    return {
      available: true,
      dryRun: true,
      platform,
      device: optionalString(args.device),
      tool: platform === "android" ? "adb" : (iosTool?.tool ?? "idb"),
      point: { x: Number(x), y: Number(y) },
      command:
        platform === "android"
          ? [
              "adb",
              ...androidDeviceArgs(optionalString(args.device), ["shell", "input", "tap", x, y]),
            ]
          : iosCommand,
    };
  }

  if (platform === "android") {
    const result = await deps.execFile(
      "adb",
      androidDeviceArgs(optionalString(args.device), ["shell", "input", "tap", x, y]),
      {
        timeout: 20_000,
        rejectOnError: false,
      },
    );
    return {
      platform,
      device: optionalString(args.device),
      x: Number(x),
      y: Number(y),
      stdout: truncate(result.stdout),
      stderr: truncate(result.stderr),
    };
  }

  const tool = await resolveIosInteractionTool(deps);
  if (!tool) {
    throw new Error(
      "iOS coordinate taps require the idb or axe CLI, but neither is installed or on PATH. Install idb or axe for iOS coordinate automation.",
    );
  }
  const device = await deps.resolveIosDevice(optionalString(args.device) ?? undefined, {
    preferBooted: true,
  });
  const command =
    tool.tool === "axe"
      ? ["tap", "-x", x, "-y", y, "--udid", device.udid]
      : ["ui", "tap", x, y, "--udid", device.udid];
  const result = await deps.execFile(tool.path, command, { timeout: 20_000, rejectOnError: false });
  return {
    platform,
    device,
    tool: tool.tool,
    x: Number(x),
    y: Number(y),
    stdout: truncate(result.stdout),
    stderr: truncate(result.stderr),
  };
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
      : {
          available: true,
          action: command,
          ref: args.ref,
          reason: "Ref is present in the current snapshot.",
          record: record.record,
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
      true,
    );
    return { ...tapped, action: command, ref: args.ref, value: args.text ?? null };
  }
  if (command === "fill") {
    const policyDenied = await policyGate(args, "ref.fill", "ref", deps);
    if (policyDenied) return policyDenied;
    const ref = requireString(args.ref, "ref");
    const text = requireString(args.text, "text");
    if (args.dryRun === true) {
      return {
        available: true,
        dryRun: true,
        action: command,
        ref,
        textLength: text.length,
        steps: ["tap ref", "type text"],
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
    const coordinates = asRecord(point.point);
    return automationGestureInternal(
      {
        ...args,
        gesture: command === "long-press" ? "long-press" : "tap",
        x: coordinates.x,
        y: coordinates.y,
        repeat: command === "dbltap" ? 2 : 1,
        intervalMs: command === "dbltap" ? 80 : args.intervalMs,
      },
      deps,
      true,
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
        startX: asRecord(start.point).x,
        startY: asRecord(start.point).y,
        endX: asRecord(end.point).x,
        endY: asRecord(end.point).y,
        durationMs: args.durationMs ?? 600,
      },
      deps,
      true,
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
        ...asRecord(plan.coordinates),
        durationMs: args.durationMs ?? 250,
      },
      deps,
      true,
    );
  }
  throw new Error(`Unknown ref action command: ${command}`);
}
