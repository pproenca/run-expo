import type { CliArgs, CliGlobals, CommandProjectionContext } from "./types.js";

export function createProjectionContext(command: string, args: CliArgs, globals: CliGlobals): CommandProjectionContext {
  const cwd = args.cwd ?? globals.root;
  return {
    command,
    args,
    globals,
    cwd,
    common: {
      cwd,
      device: args.device,
      platform: args.platform,
      metroPort: args.metroPort,
      bundleId: args.bundleId,
      processName: args.processName,
      devClientUrl: args.devClientUrl,
      restartDevClient: args.restartDevClient,
      crashCheckMs: args.crashCheckMs,
      actionPolicy: args.actionPolicy ?? globals.actionPolicy,
    },
  };
}

export function pickDefined(object: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined));
}
