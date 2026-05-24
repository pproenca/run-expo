import type { DeviceState, DeviceSummary, MetroTarget, Platform, TargetRecord } from "./domain.js";
import { clampNumber } from "./validation.js";

export function normalizeDeviceState(state: unknown): DeviceState {
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

export function stableIdPart(value: unknown): string {
  return String(value ?? "unknown")
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "unknown";
}

export function processNameFromBundleId(bundleId: unknown): string | null {
  if (!bundleId) {
    return null;
  }
  const last = String(bundleId).split(".").filter(Boolean).at(-1);
  return last ? last.replace(/[^a-zA-Z0-9_-]/g, "") || null : null;
}

export function clampMetroPort(value: unknown): number {
  return clampNumber(value ?? 8081, 1, 65_535);
}

/**
 * RULE-009: creates the stable target identity used by selection and stale
 * target checks.
 */
export function targetRecord(input: {
  platform: Platform;
  device: DeviceSummary;
  metroPort: number;
  metroTarget: MetroTarget | null;
  selectedTargetId?: string | null;
}): TargetRecord {
  const bundleId = input.metroTarget?.appId ?? null;
  const targetId = [
    input.platform,
    input.device.id,
    bundleId ?? input.metroTarget?.id ?? input.metroTarget?.title ?? "no-runtime",
    input.metroTarget ? input.metroPort : "no-metro",
  ].map(stableIdPart).join(":");

  return {
    targetId,
    platform: input.platform,
    device: {
      id: input.device.id,
      name: input.device.name ?? null,
      state: input.device.state ?? "unknown",
    },
    app: {
      bundleId,
      processName: processNameFromBundleId(bundleId),
      running: null,
    },
    metro: {
      port: input.metroTarget ? input.metroPort : null,
      status: input.metroTarget ? "available" : "unavailable",
      targetId: input.metroTarget?.id ?? null,
      title: input.metroTarget?.title ?? null,
      appId: input.metroTarget?.appId ?? null,
      debuggerUrl: input.metroTarget?.webSocketDebuggerUrl ?? null,
    },
    selected: targetId === (input.selectedTargetId ?? null),
    stale: false,
  };
}
