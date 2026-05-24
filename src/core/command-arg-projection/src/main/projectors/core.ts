import { pickDefined } from "../common.js";
import type { CommandProjectionContext, CommandProjector, ProjectedCommandArgs } from "../types.js";

export const coreCommandProjectors: Record<string, CommandProjector> = {
  doctor: projectDoctorArgs,
  "project-info": projectProjectInfoArgs,
  routes: projectRoutesArgs,
  devices: projectDevicesArgs,
  session: projectSessionArgs,
  target: projectTargetArgs,
  snapshot: projectSnapshotArgs,
  refs: projectRefsArgs,
  get: projectGetArgs,
  find: projectFindArgs,
  wait: projectWaitArgs,
  batch: projectBatchArgs,
};

function projectDoctorArgs({ args, cwd }: CommandProjectionContext): ProjectedCommandArgs {
  return pickDefined({ cwd, fix: args.fix });
}

function projectProjectInfoArgs({ cwd }: CommandProjectionContext): ProjectedCommandArgs {
  return pickDefined({ cwd });
}

function projectRoutesArgs({ args, cwd }: CommandProjectionContext): ProjectedCommandArgs {
  return pickDefined({ cwd, appDir: args.appDir });
}

function projectDevicesArgs({ args }: CommandProjectionContext): ProjectedCommandArgs {
  return pickDefined({ platform: args.platform, limit: args.limit });
}

function projectSessionArgs({
  args,
  globals,
  cwd,
}: CommandProjectionContext): ProjectedCommandArgs {
  return pickDefined({
    action: args.action ?? args._[0],
    name: args.name ?? args._[1],
    olderThan: args.olderThan,
    cwd,
    root: globals.root,
    stateDir: globals.stateDir,
  });
}

function projectTargetArgs({ args, globals, cwd }: CommandProjectionContext): ProjectedCommandArgs {
  return pickDefined({
    action: args.action ?? args._[0],
    targetId: args.targetId ?? args._[1],
    platform: args.platform,
    metroPort: args.metroPort,
    cwd,
    root: globals.root,
    stateDir: globals.stateDir,
  });
}

function projectSnapshotArgs({
  args,
  globals,
  cwd,
}: CommandProjectionContext): ProjectedCommandArgs {
  return pickDefined({
    interactive: args.interactive,
    compact: args.compact,
    depth: args.depth,
    source: args.source,
    bounds: args.bounds,
    metroPort: args.metroPort,
    cwd,
    root: globals.root,
    stateDir: globals.stateDir,
  });
}

function projectRefsArgs({ globals, cwd }: CommandProjectionContext): ProjectedCommandArgs {
  return pickDefined({ cwd, root: globals.root, stateDir: globals.stateDir });
}

function projectGetArgs({ args, globals, cwd }: CommandProjectionContext): ProjectedCommandArgs {
  return pickDefined({
    field: args.field ?? args._[0],
    ref: args.ref ?? args._[1],
    cwd,
    root: globals.root,
    stateDir: globals.stateDir,
  });
}

function projectFindArgs({ args, globals, cwd }: CommandProjectionContext): ProjectedCommandArgs {
  return pickDefined({
    kind: args.kind ?? args._[0],
    value: args.value ?? args._[1],
    action: args.action ?? args._[2],
    name: args.name ?? (args._[0] === "nth" ? args._[2] : undefined),
    text: args.text ?? args._[3],
    dryRun: args.dryRun,
    cwd,
    root: globals.root,
    stateDir: globals.stateDir,
  });
}

function projectWaitArgs({ args, globals, cwd }: CommandProjectionContext): ProjectedCommandArgs {
  const first = args._[0];
  return pickDefined({
    ref: args.ref ?? (/^@e\d+$/.test(String(first ?? "")) ? first : undefined),
    ms: args.ms ?? (/^\d+$/.test(String(first ?? "")) ? Number(first) : undefined),
    state: args.state,
    text: args.text,
    route: args.route,
    metroReady: args.metroReady,
    appReady: args.appReady,
    noSpinner: args.noSpinner,
    fn: args.fn,
    allowRuntimeEval: globals.allowRuntimeEval,
    actionPolicy: args.actionPolicy ?? globals.actionPolicy,
    metroPort: args.metroPort,
    timeoutMs: args.timeoutMs,
    cwd,
    root: globals.root,
    stateDir: globals.stateDir,
  });
}

function projectBatchArgs({ args, globals, cwd }: CommandProjectionContext): ProjectedCommandArgs {
  return pickDefined({
    steps: args.steps ?? args._,
    bail: args.bail,
    cwd,
    root: globals.root,
    stateDir: globals.stateDir,
  });
}
