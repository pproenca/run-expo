export type {
  DeviceState,
  DeviceSummary,
  DiscoverTargetsArgs,
  DiscoveryDependencies,
  DiscoveryPlatform,
  MetroTarget,
  Platform,
  SessionRecord,
  TargetAction,
  TargetCommandArgs,
  TargetCommandResult,
  TargetCurrentResult,
  TargetDependencies,
  TargetListResult,
  TargetRecord,
  TargetUnavailableResult,
} from "./domain.js";
export { normalizeMetroTargets, normalizeSimulatorDevices, discoverTargets } from "./discovery.js";
export { getCurrentTarget, listTargets, selectTarget, targetCommand } from "./target-service.js";
export {
  clampMetroPort,
  normalizeDeviceState,
  processNameFromBundleId,
  stableIdPart,
  targetRecord,
} from "./target-record.js";
