import { pickDefined } from "../common.js";
import type { CommandProjectionContext, CommandProjector, ProjectedCommandArgs } from "../types.js";

export const interactionCommandProjectors: Record<string, CommandProjector> = {
  "long-press": projectRefActionArgs,
  dbltap: projectRefActionArgs,
  fill: projectRefActionArgs,
  focus: projectRefActionArgs,
  blur: projectRefActionArgs,
  select: projectRefActionArgs,
  check: projectRefActionArgs,
  uncheck: projectRefActionArgs,
  drag: projectRefActionArgs,
  scroll: projectRefActionArgs,
  "scroll-into-view": projectRefActionArgs,
  type: projectKeyboardTextAliasArgs,
  press: projectKeyboardTextAliasArgs,
  clipboard: projectClipboardKeyboardArgs,
  keyboard: projectClipboardKeyboardArgs,
  set: projectSetEnvironmentArgs,
  logs: projectLogsArgs,
  screenshot: projectScreenshotArgs,
  tap: projectTapArgs,
  gesture: projectGestureArgs,
  "open-route": projectOpenRouteArgs,
  "ux-context": projectUxContextArgs,
  "annotate-screen": projectAnnotateScreenArgs,
  inspector: projectInspectorArgs,
  "review-overlay": projectReviewOverlayArgs,
  "review-overlay-server": projectReviewOverlayArgs,
  "review-next": projectReviewNextArgs,
  trace: projectTraceArgs,
  "annotation-server": projectAnnotationServerArgs,
};

function projectRefActionArgs({ command, args, globals, cwd, common }: CommandProjectionContext): ProjectedCommandArgs {
  const first = args._[0];
  const second = args._[1];
  const third = args._[2];
  const scrollRef = command === "scroll" && /^@e\d+$/.test(String(first ?? "")) ? first : undefined;
  return pickDefined({
    ...common,
    command,
    ref: args.ref ?? scrollRef ?? (command === "scroll" ? undefined : first),
    targetRef: args.targetRef ?? (command === "drag" ? second : undefined),
    text: args.text ?? (command === "fill" || command === "select" ? args._[1] : undefined),
    direction: args.direction ?? (command === "scroll" ? (scrollRef ? second : first) : undefined),
    amount: args.amount ?? (command === "scroll" ? (scrollRef ? third : second) : undefined),
    durationMs: args.durationMs,
    dryRun: args.dryRun,
    cwd,
    root: globals.root,
    stateDir: globals.stateDir,
  });
}

function projectKeyboardTextAliasArgs({ command, args, common }: CommandProjectionContext): ProjectedCommandArgs {
  return pickDefined({ ...common, action: command, text: args.text ?? args._[0], key: args.key ?? args._[0], dryRun: args.dryRun });
}

function projectClipboardKeyboardArgs({ args, common }: CommandProjectionContext): ProjectedCommandArgs {
  return pickDefined({ ...common, action: args.action ?? args._[0], text: args.text ?? args._[1], key: args.key ?? args._[1], dryRun: args.dryRun });
}

function projectSetEnvironmentArgs({ args, globals, common }: CommandProjectionContext): ProjectedCommandArgs {
  return pickDefined({
    ...common,
    domain: args.domain ?? args._[0],
    value: args.value ?? args._[1],
    extra: args.extra ?? args._.slice(2),
    actionPolicy: args.actionPolicy ?? globals.actionPolicy,
    dryRun: args.dryRun,
  });
}

function projectLogsArgs({ args, common }: CommandProjectionContext): ProjectedCommandArgs {
  return pickDefined({ ...common, last: args.last, lines: args.lines, predicate: args.predicate });
}

function projectScreenshotArgs({ args, globals, cwd }: CommandProjectionContext): ProjectedCommandArgs {
  return pickDefined({
    platform: args.platform,
    device: args.device,
    outputPath: args.outputPath,
    annotate: args.annotate,
    full: args.full,
    fullSegments: args.fullSegments,
    cwd,
    root: globals.root,
    stateDir: globals.stateDir,
  });
}

function projectTapArgs({ args, globals, cwd }: CommandProjectionContext): ProjectedCommandArgs {
  return pickDefined({
    platform: args.platform,
    device: args.device,
    x: args.x,
    y: args.y,
    ref: args.ref ?? args._[0],
    actionPolicy: args.actionPolicy ?? globals.actionPolicy,
    dryRun: args.dryRun,
    cwd,
    root: globals.root,
    stateDir: globals.stateDir,
  });
}

function projectGestureArgs({ args, globals, cwd }: CommandProjectionContext): ProjectedCommandArgs {
  return pickDefined({
    platform: args.platform,
    device: args.device,
    gesture: args.gesture ?? args._[0],
    x: args.x,
    y: args.y,
    startX: args.startX,
    startY: args.startY,
    endX: args.endX,
    endY: args.endY,
    durationMs: args.durationMs,
    holdMs: args.holdMs,
    repeat: args.repeat,
    intervalMs: args.intervalMs,
    actionPolicy: args.actionPolicy ?? globals.actionPolicy,
    dryRun: args.dryRun,
    captureBeforeAfter: args.captureBeforeAfter,
    outputDir: args.outputDir,
    includeTrace: args.includeTrace,
    cwd,
    metroPort: args.metroPort,
    componentFilter: args.componentFilter,
    maxEvents: args.maxEvents,
  });
}

function projectOpenRouteArgs({ args, globals, cwd }: CommandProjectionContext): ProjectedCommandArgs {
  return pickDefined({
    cwd,
    device: args.device,
    url: args.url,
    scheme: args.scheme,
    route: args.route ?? args._[0],
    query: args.query,
    authCookie: args.authCookie,
    actionPolicy: args.actionPolicy ?? globals.actionPolicy,
  });
}

function projectUxContextArgs({ args, common }: CommandProjectionContext): ProjectedCommandArgs {
  return pickDefined({
    ...common,
    outputPath: args.outputPath,
    includeScreenshot: args.includeScreenshot,
    includeImageAnalysis: args.includeImageAnalysis,
    includeHierarchy: args.includeHierarchy,
    includeRuntime: args.includeRuntime,
    includeComponents: args.includeComponents,
    componentFilter: args.componentFilter,
    includeLogs: args.includeLogs,
    logsLast: args.logsLast,
  });
}

function projectAnnotateScreenArgs({ args, globals, cwd }: CommandProjectionContext): ProjectedCommandArgs {
  return pickDefined({
    action: args.action ?? args._[0],
    cwd,
    metroPort: args.metroPort,
    outputDir: args.outputDir,
    overlayDir: args.overlayDir,
    endpointPath: args.endpointPath,
    title: args.title,
    serve: args.serve,
    port: args.port,
    force: args.force,
    confirmActions: args.confirmActions ?? globals.confirmActions,
  });
}

function projectInspectorArgs({ args, cwd }: CommandProjectionContext): ProjectedCommandArgs {
  return pickDefined({
    cwd,
    device: args.device,
    metroPort: args.metroPort,
    bundleId: args.bundleId,
    devClientUrl: args.devClientUrl,
    restartDevClient: args.restartDevClient,
    action: args.action ?? args._[0],
    commentTitle: args.commentTitle,
    maxComments: args.maxComments,
  });
}

function projectReviewOverlayArgs({ command, args, cwd }: CommandProjectionContext): ProjectedCommandArgs {
  return pickDefined({
    cwd,
    action: command === "review-overlay-server" ? "server" : args.action ?? args._[0],
    outputDir: args.outputDir,
    overlayDir: args.overlayDir,
    endpointPath: args.endpointPath,
    metroPort: args.metroPort,
    title: args.title,
    port: args.port,
    serve: args.serve,
    force: args.force,
  });
}

function projectReviewNextArgs({ args, cwd }: CommandProjectionContext): ProjectedCommandArgs {
  return pickDefined({
    cwd,
    surface: args.surface,
    stage: args.stage,
    issue: args.issue ?? args._[0],
    componentFilter: args.componentFilter,
    metroPort: args.metroPort,
    verifierRule: args.verifierRule,
    hasAcceptanceContract: args.hasAcceptanceContract,
    hasScreenshot: args.hasScreenshot,
    hasInteractionProof: args.hasInteractionProof,
    hasStaticVerifier: args.hasStaticVerifier,
    changedGesture: args.changedGesture,
    changedChrome: args.changedChrome,
    changedNavigation: args.changedNavigation,
    addedVisibleControls: args.addedVisibleControls,
  });
}

function projectTraceArgs({ args, cwd }: CommandProjectionContext): ProjectedCommandArgs {
  return pickDefined({
    cwd,
    metroPort: args.metroPort,
    action: args.action ?? args._[0],
    componentFilter: args.componentFilter,
    maxEvents: args.maxEvents,
    includeEvents: args.includeEvents,
  });
}

function projectAnnotationServerArgs({ args }: CommandProjectionContext): ProjectedCommandArgs {
  return pickDefined({ dir: args.dir, port: args.port });
}
