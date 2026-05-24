import { pickDefined } from "../common.js";
import type { CommandProjectionContext, CommandProjector, ProjectedCommandArgs } from "../types.js";

export const runtimeEvidenceCommandProjectors: Record<string, CommandProjector> = {
  devtools: projectDevtoolsArgs,
  console: projectDiagnosticsArgs,
  errors: projectDiagnosticsArgs,
  metro: projectMetroArgs,
  navigation: projectNavigationArgs,
  network: projectNetworkArgs,
  storage: projectStorageArgs,
  state: projectStateArgs,
  controls: projectControlsArgs,
  bridge: projectBridgeArgs,
  accessibility: projectAccessibilityArgs,
  dialog: projectDialogArgs,
  sheet: projectSheetArgs,
  record: projectRecordArgs,
  diff: projectDiffArgs,
  expo: projectExpoArgs,
  rn: projectRnArgs,
  perf: projectPerfArgs,
  profiler: projectPerfArgs,
};

function projectDevtoolsArgs({ args, globals, cwd }: CommandProjectionContext): ProjectedCommandArgs {
  return pickDefined({
    action: args.action ?? args._[0],
    subaction: args.subaction ?? (args._[0] === "events" ? args._[1] : undefined),
    metroPort: args.metroPort,
    cwd,
    root: globals.root,
    stateDir: globals.stateDir,
  });
}

function projectDiagnosticsArgs({ args, cwd }: CommandProjectionContext): ProjectedCommandArgs {
  return pickDefined({ action: args.clear === true ? "clear" : args.action ?? args._[0], limit: args.limit, metroPort: args.metroPort, cwd });
}

function projectMetroArgs({ args, cwd }: CommandProjectionContext): ProjectedCommandArgs {
  return pickDefined({ action: args.action ?? args._[0], stackFile: args.stackFile ?? args.file ?? args._[1], metroPort: args.metroPort, cwd });
}

function projectNavigationArgs({ args, globals, cwd }: CommandProjectionContext): ProjectedCommandArgs {
  return pickDefined({
    action: args.action ?? args._[0],
    tab: args.tab ?? args._[1],
    route: args.route ?? (args._[0] === "deep-link" ? args._[1] : undefined),
    url: args.url,
    scheme: args.scheme,
    query: args.query,
    device: args.device,
    metroPort: args.metroPort,
    actionPolicy: args.actionPolicy ?? globals.actionPolicy,
    cwd,
    root: globals.root,
    stateDir: globals.stateDir,
  });
}

function projectNetworkArgs({ args, globals, cwd }: CommandProjectionContext): ProjectedCommandArgs {
  return pickDefined({
    action: args.action ?? args._[0],
    harAction: args.harAction ?? (args._[0] === "har" ? args._[1] : undefined),
    requestId: args.requestId ?? (args._[0] === "request" ? args._[1] : undefined),
    outputPath: args.outputPath ?? (args._[0] === "har" && args._[1] === "stop" ? args._[2] : undefined),
    limit: args.limit,
    metroPort: args.metroPort,
    cwd,
    root: globals.root,
    stateDir: globals.stateDir,
  });
}

function projectStorageArgs({ args, globals, cwd }: CommandProjectionContext): ProjectedCommandArgs {
  return pickDefined({
    store: args.store ?? args._[0],
    action: args.action ?? args._[1] ?? "list",
    key: args.key ?? args._[2],
    value: args.value ?? args._[3],
    limit: args.limit,
    metroPort: args.metroPort,
    actionPolicy: args.actionPolicy ?? globals.actionPolicy,
    cwd,
  });
}

function projectStateArgs({ args, globals, cwd }: CommandProjectionContext): ProjectedCommandArgs {
  return pickDefined({ action: args.action ?? args._[0] ?? "list", name: args.name ?? args._[1], metroPort: args.metroPort, actionPolicy: args.actionPolicy ?? globals.actionPolicy, cwd });
}

function projectControlsArgs({ args, globals, cwd }: CommandProjectionContext): ProjectedCommandArgs {
  return pickDefined({ action: args.action ?? args._[0] ?? "list", name: args.name ?? args._[1], metroPort: args.metroPort, actionPolicy: args.actionPolicy ?? globals.actionPolicy, cwd });
}

function projectBridgeArgs({ args, globals, cwd }: CommandProjectionContext): ProjectedCommandArgs {
  return pickDefined({
    action: args.action ?? args._[0] ?? "status",
    metroPort: args.metroPort,
    domain: args.domain ?? args._[1],
    command: args.command ?? args._[2],
    actionPolicy: args.actionPolicy ?? globals.actionPolicy,
    cwd,
    confirmActions: args.confirmActions ?? globals.confirmActions,
  });
}

function projectAccessibilityArgs({ args, globals, cwd }: CommandProjectionContext): ProjectedCommandArgs {
  return pickDefined({ action: args.action ?? args._[0] ?? "tree", ref: args.ref ?? args._[1], device: args.device, metroPort: args.metroPort, dryRun: args.dryRun, cwd, root: globals.root, stateDir: globals.stateDir });
}

function projectDialogArgs({ args, cwd }: CommandProjectionContext): ProjectedCommandArgs {
  return pickDefined({ action: args.action ?? args._[0] ?? "status", text: args.text ?? args._[1], metroPort: args.metroPort, cwd });
}

function projectSheetArgs({ args, cwd }: CommandProjectionContext): ProjectedCommandArgs {
  return pickDefined({ action: args.action ?? args._[0] ?? "status", metroPort: args.metroPort, cwd });
}

function projectRecordArgs({ args, globals, cwd }: CommandProjectionContext): ProjectedCommandArgs {
  return pickDefined({ action: args.action ?? args._[0] ?? "start", outputPath: args.outputPath ?? args._[1], cwd, root: globals.root, stateDir: globals.stateDir });
}

function projectDiffArgs({ args, globals, cwd }: CommandProjectionContext): ProjectedCommandArgs {
  return pickDefined({
    kind: args.kind ?? args._[0],
    baseline: args.baseline ?? args._[1],
    current: args.current ?? args._[2],
    routeA: args.routeA ?? (args._[0] === "route" ? args._[1] : undefined),
    routeB: args.routeB ?? (args._[0] === "route" ? args._[2] : undefined),
    screenshot: args.screenshot,
    outputPath: args.outputPath,
    cwd,
    root: globals.root,
    stateDir: globals.stateDir,
  });
}

function projectExpoArgs({ args, cwd }: CommandProjectionContext): ProjectedCommandArgs {
  return pickDefined({ action: args.action ?? args._[0] ?? "modules", cwd });
}

function projectRnArgs({ args, globals, cwd }: CommandProjectionContext): ProjectedCommandArgs {
  return pickDefined({
    action: args.action ?? args._[0] ?? "tree",
    subaction: args.subaction ?? (args._[0] === "renders" ? args._[1] : undefined),
    ref: args.ref ?? (["inspect", "fiber"].includes(String(args._[0])) ? args._[1] : undefined),
    metroPort: args.metroPort,
    raw: args.raw,
    detail: args.detail,
    cwd,
    root: globals.root,
    stateDir: globals.stateDir,
  });
}

function projectPerfArgs({ command, args, globals, cwd }: CommandProjectionContext): ProjectedCommandArgs {
  return pickDefined({
    action: command === "profiler" ? "ettrace" : args.action ?? args._[0] ?? "summary",
    subaction: command === "profiler"
      ? args.subaction ?? args.action ?? args._[0] ?? "start"
      : args.subaction ?? (["mark", "measure", "budget", "ettrace", "memgraph", "interaction"].includes(String(args._[0])) ? args._[1] : undefined),
    label: args.label ?? (args._[0] === "action" ? args._[1] : ["measure", "interaction"].includes(String(args._[0])) ? args._[2] : undefined),
    interaction: args.interaction ?? (args._[0] === "report" ? args._[1] : undefined),
    bundleArtifact: args.bundleArtifact ?? (args._[0] === "bundle" ? args._[1] : undefined),
    baseline: args.baseline,
    candidate: args.candidate,
    file: args.file,
    nativeArtifact: args.nativeArtifact ?? (command === "profiler" ? args._[1] : ["ettrace", "memgraph"].includes(String(args._[0])) ? args._[2] : undefined),
    outputPath: args.outputPath,
    buildKind: args.buildKind,
    samples: args.samples,
    seconds: args.seconds,
    pid: args.pid,
    metroPort: args.metroPort,
    cwd,
    root: globals.root,
    stateDir: globals.stateDir,
  });
}
