export interface CliArgs {
  _: unknown[];
  [key: string]: unknown;
}

export interface CliGlobals {
  root?: unknown;
  stateDir?: unknown;
  actionPolicy?: unknown;
  allowRuntimeEval?: unknown;
  confirmActions?: unknown;
  [key: string]: unknown;
}

export function commandArgs(command: string, args: CliArgs, globals: CliGlobals = {}): Record<string, unknown> {
  const cwd = args.cwd ?? globals.root;
  const common = {
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
  };
  switch (command) {
    case "doctor":
      return pickDefined({ cwd, fix: args.fix });
    case "project-info":
      return pickDefined({ cwd });
    case "routes":
      return pickDefined({ cwd, appDir: args.appDir });
    case "devices":
      return pickDefined({ platform: args.platform, limit: args.limit });
    case "session":
      return pickDefined({
        action: args.action ?? args._[0],
        name: args.name ?? args._[1],
        olderThan: args.olderThan,
        cwd,
        root: globals.root,
        stateDir: globals.stateDir,
      });
    case "target":
      return pickDefined({
        action: args.action ?? args._[0],
        targetId: args.targetId ?? args._[1],
        platform: args.platform,
        metroPort: args.metroPort,
        cwd,
        root: globals.root,
        stateDir: globals.stateDir,
      });
    case "snapshot":
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
    case "refs":
      return pickDefined({ cwd, root: globals.root, stateDir: globals.stateDir });
    case "get":
      return pickDefined({
        field: args.field ?? args._[0],
        ref: args.ref ?? args._[1],
        cwd,
        root: globals.root,
        stateDir: globals.stateDir,
      });
    case "find":
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
    case "wait": {
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
    case "batch":
      return pickDefined({
        steps: args.steps ?? args._,
        bail: args.bail,
        cwd,
        root: globals.root,
        stateDir: globals.stateDir,
      });
    case "boot-simulator":
      return pickDefined({ device: args.device, openSimulator: args.openSimulator, actionPolicy: args.actionPolicy ?? globals.actionPolicy });
    case "open-url":
      return pickDefined({ platform: args.platform, device: args.device, url: args.url ?? args._[0] });
    case "launch-app":
      return pickDefined({ ...common, packageName: args.packageName, activity: args.activity });
    case "terminate-app":
    case "reload-app":
    case "install-app":
    case "uninstall-app":
      return pickDefined({
        ...common,
        appPath: args.appPath ?? args._[0],
        packageName: args.packageName,
        actionPolicy: args.actionPolicy ?? globals.actionPolicy,
        dryRun: args.dryRun,
      });
    case "open-dev-menu":
      return pickDefined({ ...common, action: "open-dev-menu" });
    case "long-press":
    case "dbltap":
    case "fill":
    case "focus":
    case "blur":
    case "select":
    case "check":
    case "uncheck":
    case "drag":
    case "scroll":
    case "scroll-into-view": {
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
    case "type":
    case "press":
      return pickDefined({
        ...common,
        action: command,
        text: args.text ?? args._[0],
        key: args.key ?? args._[0],
        dryRun: args.dryRun,
      });
    case "clipboard":
    case "keyboard":
      return pickDefined({
        ...common,
        action: args.action ?? args._[0],
        text: args.text ?? args._[1],
        key: args.key ?? args._[1],
        dryRun: args.dryRun,
      });
    case "set":
      return pickDefined({
        ...common,
        domain: args.domain ?? args._[0],
        value: args.value ?? args._[1],
        extra: args.extra ?? args._.slice(2),
        actionPolicy: args.actionPolicy ?? globals.actionPolicy,
        dryRun: args.dryRun,
      });
    case "logs":
      return pickDefined({ ...common, last: args.last, lines: args.lines, predicate: args.predicate });
    case "screenshot":
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
    case "tap":
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
    case "gesture":
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
    case "open-route":
      return pickDefined({
        cwd,
        device: args.device,
        url: args.url,
        scheme: args.scheme,
        route: args.route ?? args._[0],
        query: args.query,
        authCookie: args.authCookie,
      });
    case "ux-context":
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
    case "annotate-screen":
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
    case "inspector":
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
    case "review-overlay":
    case "review-overlay-server":
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
    case "review-next":
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
    case "trace":
      return pickDefined({
        cwd,
        metroPort: args.metroPort,
        action: args.action ?? args._[0],
        componentFilter: args.componentFilter,
        maxEvents: args.maxEvents,
        includeEvents: args.includeEvents,
      });
    case "annotation-server":
      return pickDefined({ dir: args.dir, port: args.port });
    case "devtools":
      return pickDefined({
        action: args.action ?? args._[0],
        subaction: args.subaction ?? (args._[0] === "events" ? args._[1] : undefined),
        metroPort: args.metroPort,
        cwd,
        root: globals.root,
        stateDir: globals.stateDir,
      });
    case "console":
    case "errors":
      return pickDefined({
        action: args.clear === true ? "clear" : args.action ?? args._[0],
        limit: args.limit,
        metroPort: args.metroPort,
        cwd,
      });
    case "metro":
      return pickDefined({
        action: args.action ?? args._[0],
        stackFile: args.stackFile ?? args.file ?? args._[1],
        metroPort: args.metroPort,
        cwd,
      });
    case "navigation":
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
    case "network":
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
    case "storage":
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
    case "state":
      return pickDefined({
        action: args.action ?? args._[0] ?? "list",
        name: args.name ?? args._[1],
        metroPort: args.metroPort,
        actionPolicy: args.actionPolicy ?? globals.actionPolicy,
        cwd,
      });
    case "controls":
      return pickDefined({
        action: args.action ?? args._[0] ?? "list",
        name: args.name ?? args._[1],
        metroPort: args.metroPort,
        actionPolicy: args.actionPolicy ?? globals.actionPolicy,
        cwd,
      });
    case "bridge":
      return pickDefined({
        action: args.action ?? args._[0] ?? "status",
        metroPort: args.metroPort,
        domain: args.domain ?? args._[1],
        command: args.command ?? args._[2],
        actionPolicy: args.actionPolicy ?? globals.actionPolicy,
        cwd,
        confirmActions: args.confirmActions ?? globals.confirmActions,
      });
    case "accessibility":
      return pickDefined({
        action: args.action ?? args._[0] ?? "tree",
        ref: args.ref ?? args._[1],
        device: args.device,
        metroPort: args.metroPort,
        dryRun: args.dryRun,
        cwd,
        root: globals.root,
        stateDir: globals.stateDir,
      });
    case "dialog":
      return pickDefined({
        action: args.action ?? args._[0] ?? "status",
        text: args.text ?? args._[1],
        metroPort: args.metroPort,
        cwd,
      });
    case "sheet":
      return pickDefined({
        action: args.action ?? args._[0] ?? "status",
        metroPort: args.metroPort,
        cwd,
      });
    case "record":
      return pickDefined({
        action: args.action ?? args._[0] ?? "start",
        outputPath: args.outputPath ?? args._[1],
        cwd,
        root: globals.root,
        stateDir: globals.stateDir,
      });
    case "diff":
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
    case "expo":
      return pickDefined({
        action: args.action ?? args._[0] ?? "modules",
        cwd,
      });
    case "rn":
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
    case "perf":
    case "profiler":
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
    case "dashboard":
      return pickDefined({
        action: args.action ?? args._[0] ?? "status",
        outputPath: args.outputPath,
        port: args.port,
        cwd,
        root: globals.root,
        stateDir: globals.stateDir,
      });
    case "inspect":
    case "highlight":
      return pickDefined({
        ...common,
        ref: args.ref ?? args._[0],
        durationMs: args.durationMs,
        outputPath: args.outputPath,
        cwd,
        root: globals.root,
        stateDir: globals.stateDir,
      });
    case "review":
      return pickDefined({
        action: args.action ?? args._[0],
        outputPath: args.outputPath,
        cwd,
        root: globals.root,
        stateDir: globals.stateDir,
      });
    case "policy":
      return pickDefined({
        action: args.action ?? args._[0],
        subject: args.subject ?? args._[1],
        name: args.name ?? args._[2],
        actionPolicy: args.actionPolicy ?? globals.actionPolicy,
        cwd,
      });
    case "redact":
      return pickDefined({
        file: args.file ?? args._[0],
        outputPath: args.outputPath,
      });
    case "skills":
      return pickDefined({
        action: args.action ?? args._[0] ?? "list",
        name: args.name ?? args._[1],
      });
    case "install":
    case "upgrade":
      return pickDefined({
        action: args.action ?? args._[0] ?? "check",
        prefix: args.prefix,
      });
    case "release":
      return pickDefined({
        action: args.action ?? args._[0] ?? "check",
        cwd,
      });
    case "live-backlog":
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
    default:
      return {};
  }
}

export function pickDefined(object: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined));
}
