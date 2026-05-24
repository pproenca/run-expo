import { pickDefined } from "../common.js";
import type { CommandProjectionContext, CommandProjector, ProjectedCommandArgs } from "../types.js";

export const maintenanceCommandProjectors: Record<string, CommandProjector> = {
  dashboard: projectDashboardArgs,
  inspect: projectInspectHighlightArgs,
  highlight: projectInspectHighlightArgs,
  review: projectReviewArgs,
  policy: projectPolicyArgs,
  redact: projectRedactArgs,
  skills: projectSkillsArgs,
  install: projectPluginLifecycleArgs,
  upgrade: projectPluginLifecycleArgs,
  release: projectReleaseArgs,
  "live-backlog": projectLiveBacklogArgs,
};

function projectDashboardArgs({ args, globals, cwd }: CommandProjectionContext): ProjectedCommandArgs {
  return pickDefined({ action: args.action ?? args._[0] ?? "status", outputPath: args.outputPath, port: args.port, cwd, root: globals.root, stateDir: globals.stateDir });
}

function projectInspectHighlightArgs({ args, globals, cwd, common }: CommandProjectionContext): ProjectedCommandArgs {
  return pickDefined({ ...common, ref: args.ref ?? args._[0], durationMs: args.durationMs, outputPath: args.outputPath, cwd, root: globals.root, stateDir: globals.stateDir });
}

function projectReviewArgs({ args, globals, cwd }: CommandProjectionContext): ProjectedCommandArgs {
  return pickDefined({ action: args.action ?? args._[0], outputPath: args.outputPath, cwd, root: globals.root, stateDir: globals.stateDir });
}

function projectPolicyArgs({ args, globals, cwd }: CommandProjectionContext): ProjectedCommandArgs {
  return pickDefined({ action: args.action ?? args._[0], subject: args.subject ?? args._[1], name: args.name ?? args._[2], actionPolicy: args.actionPolicy ?? globals.actionPolicy, cwd });
}

function projectRedactArgs({ args }: CommandProjectionContext): ProjectedCommandArgs {
  return pickDefined({ file: args.file ?? args._[0], outputPath: args.outputPath });
}

function projectSkillsArgs({ args }: CommandProjectionContext): ProjectedCommandArgs {
  return pickDefined({ action: args.action ?? args._[0] ?? "list", name: args.name ?? args._[1] });
}

function projectPluginLifecycleArgs({ args }: CommandProjectionContext): ProjectedCommandArgs {
  return pickDefined({ action: args.action ?? args._[0] ?? "check", prefix: args.prefix });
}

function projectReleaseArgs({ args, cwd }: CommandProjectionContext): ProjectedCommandArgs {
  return pickDefined({ action: args.action ?? args._[0] ?? "check", cwd });
}

function projectLiveBacklogArgs({ args, globals, cwd }: CommandProjectionContext): ProjectedCommandArgs {
  return pickDefined({
    action: args.action ?? args._[0] ?? "matrix",
    cwd,
    outputDir: args.outputDir,
    scope: args.scope,
    metroPort: args.metroPort,
    bundleId: args.bundleId,
    device: args.device,
    devClientUrl: args.devClientUrl,
    actionPolicy: args.actionPolicy ?? globals.actionPolicy,
  });
}
