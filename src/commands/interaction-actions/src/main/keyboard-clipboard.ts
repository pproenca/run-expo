import { defaultInteractionDependencies } from "./dependencies.js";
import { optionalString, policyGate, requireString, truncate } from "./shared.js";
import type { InteractionArgs, InteractionDependencies, InteractionPayload } from "./types.js";

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
