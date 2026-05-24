import { pickDefined } from "../common.js";
import type { CommandProjectionContext, CommandProjector, ProjectedCommandArgs } from "../types.js";

export const deviceCommandProjectors: Record<string, CommandProjector> = {
  "boot-simulator": projectBootSimulatorArgs,
  "open-url": projectOpenUrlArgs,
  "launch-app": projectLaunchAppArgs,
  "terminate-app": projectAppPackageArgs,
  "reload-app": projectAppPackageArgs,
  "install-app": projectAppPackageArgs,
  "uninstall-app": projectAppPackageArgs,
  "open-dev-menu": projectOpenDevMenuArgs,
};

function projectBootSimulatorArgs({
  args,
  globals,
}: CommandProjectionContext): ProjectedCommandArgs {
  return pickDefined({
    device: args.device,
    openSimulator: args.openSimulator,
    actionPolicy: args.actionPolicy ?? globals.actionPolicy,
  });
}

function projectOpenUrlArgs({ args, globals }: CommandProjectionContext): ProjectedCommandArgs {
  return pickDefined({
    platform: args.platform,
    device: args.device,
    url: args.url ?? args._[0],
    actionPolicy: args.actionPolicy ?? globals.actionPolicy,
  });
}

function projectLaunchAppArgs({ args, common }: CommandProjectionContext): ProjectedCommandArgs {
  return pickDefined({ ...common, packageName: args.packageName, activity: args.activity });
}

function projectAppPackageArgs({
  args,
  globals,
  common,
}: CommandProjectionContext): ProjectedCommandArgs {
  return pickDefined({
    ...common,
    appPath: args.appPath ?? args._[0],
    packageName: args.packageName,
    actionPolicy: args.actionPolicy ?? globals.actionPolicy,
    dryRun: args.dryRun,
  });
}

function projectOpenDevMenuArgs({ common }: CommandProjectionContext): ProjectedCommandArgs {
  return pickDefined({ ...common, action: "open-dev-menu" });
}
