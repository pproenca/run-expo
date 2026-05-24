import { createProjectionContext, pickDefined } from "./common.js";
import { coreCommandProjectors } from "./projectors/core.js";
import { deviceCommandProjectors } from "./projectors/device.js";
import { interactionCommandProjectors } from "./projectors/interaction.js";
import { maintenanceCommandProjectors } from "./projectors/maintenance.js";
import { runtimeEvidenceCommandProjectors } from "./projectors/runtime-evidence.js";
import type { CliArgs, CliGlobals, CommandProjector } from "./types.js";

const COMMAND_PROJECTORS: Record<string, CommandProjector> = {
  ...coreCommandProjectors,
  ...deviceCommandProjectors,
  ...interactionCommandProjectors,
  ...runtimeEvidenceCommandProjectors,
  ...maintenanceCommandProjectors,
};

export function commandArgs(command: string, args: CliArgs, globals: CliGlobals = {}): Record<string, unknown> {
  const projector = COMMAND_PROJECTORS[command];
  return projector ? projector(createProjectionContext(command, args, globals)) : {};
}

export { pickDefined };
export type { CliArgs, CliGlobals };
