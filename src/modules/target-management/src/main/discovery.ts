import type { DeviceSummary, DiscoverTargetsArgs, DiscoveryDependencies, MetroTarget, TargetRecord } from "./domain.js";
import { clampMetroPort, normalizeDeviceState, targetRecord } from "./target-record.js";

/**
 * RULE-009: discovers currently selectable iOS targets and annotates the one
 * selected by the caller's session context.
 */
export async function discoverTargets(
  args: DiscoverTargetsArgs,
  deps: DiscoveryDependencies,
): Promise<TargetRecord[]> {
  const platform = args.platform ?? "all";
  const metroPort = clampMetroPort(args.metroPort);
  const selectedTargetId = args.selectedTargetId ?? null;
  const targets: TargetRecord[] = [];

  if (platform === "ios" || platform === "all") {
    const devices = await deps.listIosSimulatorTargets();
    const metroPayload = await deps.fetchMetroTargets(metroPort).catch(() => []);
    const metroTargets = normalizeMetroTargets(metroPayload);

    for (const device of devices) {
      const matchingMetroTargets = metroTargets.filter((target) => !target.deviceName || target.deviceName === device.name);
      if (matchingMetroTargets.length === 0) {
        targets.push(targetRecord({ platform: "ios", device, metroPort, metroTarget: null, selectedTargetId }));
      } else {
        for (const metroTarget of matchingMetroTargets) {
          targets.push(targetRecord({ platform: "ios", device, metroPort, metroTarget, selectedTargetId }));
        }
      }
    }
  }

  return targets.sort(compareTargets);
}

function compareTargets(left: TargetRecord, right: TargetRecord): number {
  return Number(right.selected) - Number(left.selected) ||
    Number(right.metro.status === "available") - Number(left.metro.status === "available") ||
    deviceName(left).localeCompare(deviceName(right));
}

function deviceName(target: TargetRecord): string {
  return target.device.name ?? "";
}

export function normalizeSimulatorDevices(rawDevices: Array<Record<string, unknown>>): DeviceSummary[] {
  return rawDevices.map((device) => ({
    id: String(device.udid ?? ""),
    name: typeof device.name === "string" ? device.name : String(device.udid ?? ""),
    state: normalizeDeviceState(device.state),
  })).sort((left, right) => Number(right.state === "booted") - Number(left.state === "booted") || String(left.name).localeCompare(String(right.name)));
}

export function normalizeMetroTargets(payload: unknown): MetroTarget[] {
  if (!Array.isArray(payload)) {
    return [];
  }
  return payload.flatMap((item) => {
    if (!isRecord(item)) {
      return [];
    }
    return [{
      id: optionalString(item.id),
      title: optionalString(item.title),
      appId: optionalString(item.appId),
      webSocketDebuggerUrl: optionalString(item.webSocketDebuggerUrl),
      deviceName: optionalString(item.deviceName),
    }];
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}
