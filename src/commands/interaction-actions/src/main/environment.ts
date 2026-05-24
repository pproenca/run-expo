import { defaultInteractionDependencies } from "./dependencies.js";
import { optionalString, policyDeniedPayload, requireString, truncate } from "./shared.js";
import type { InteractionArgs, InteractionDependencies, InteractionPayload, IosDevice } from "./types.js";

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
