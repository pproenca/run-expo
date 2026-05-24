#!/usr/bin/env node

// src/modules/cli-argv-parser/src/main/index.ts
var EXIT_INVALID_USAGE = 2;
var CliUsageError = class extends Error {
  exitCode = EXIT_INVALID_USAGE;
  constructor(message) {
    super(message);
    this.name = "CliUsageError";
  }
};
function parseCliArgs(argv) {
  const args = { _: [] };
  const globals = defaultGlobals();
  let command = null;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === void 0) continue;
    if (token === "--") {
      args._.push(...argv.slice(index + 1));
      break;
    }
    if (token === "--help" || token === "-h") {
      globals.help = true;
      continue;
    }
    if (token === "--version") {
      globals.version = true;
      continue;
    }
    if (token.startsWith("--")) {
      const eq = token.indexOf("=");
      const rawKey = eq === -1 ? token.slice(2) : token.slice(2, eq);
      const globalKey = normalizeGlobalFlag(rawKey);
      if (globalKey) {
        if (globalFlagTakesValue(rawKey)) {
          const value = eq === -1 ? argv[index + 1] : token.slice(eq + 1);
          if (value === void 0 || value.startsWith("--")) {
            throw new CliUsageError(`--${rawKey} requires a value.`);
          }
          if (eq === -1) index += 1;
          globals[globalKey] = String(value);
        } else {
          globals[globalKey] = true;
        }
        continue;
      }
      if (!command) {
        throw new CliUsageError(`Global flag or command expected before --${rawKey}.`);
      }
      const key = toCamel(rawKey);
      const schemaValue = eq === -1 ? argv[index + 1] : token.slice(eq + 1);
      if (eq === -1 && (schemaValue === void 0 || schemaValue.startsWith("--"))) {
        args[key] = true;
      } else {
        if (eq === -1) index += 1;
        args[key] = coerceCliValue(String(schemaValue));
      }
      continue;
    }
    if (!command) {
      command = token;
      continue;
    }
    args._.push(token);
  }
  return { globals, command, args };
}
function defaultGlobals() {
  return {
    json: false,
    plain: false,
    quiet: false,
    verbose: false,
    debug: false,
    noColor: false,
    noInput: false,
    record: false,
    version: false,
    help: false,
    root: null,
    stateDir: null,
    actionPolicy: null,
    maxOutput: null,
    contentBoundaries: false,
    allowRuntimeEval: null,
    confirmActions: null
  };
}
function normalizeGlobalFlag(rawKey) {
  switch (rawKey) {
    case "json":
    case "plain":
    case "quiet":
    case "verbose":
    case "debug":
    case "record":
      return rawKey;
    case "content-boundaries":
      return "contentBoundaries";
    case "root":
      return "root";
    case "state-dir":
      return "stateDir";
    case "action-policy":
      return "actionPolicy";
    case "max-output":
      return "maxOutput";
    case "allow-runtime-eval":
      return "allowRuntimeEval";
    case "confirm-actions":
      return "confirmActions";
    case "no-color":
      return "noColor";
    case "no-input":
      return "noInput";
    default:
      return null;
  }
}
function globalFlagTakesValue(rawKey) {
  return rawKey === "root" || rawKey === "state-dir" || rawKey === "action-policy" || rawKey === "max-output" || rawKey === "allow-runtime-eval" || rawKey === "confirm-actions";
}
function coerceCliValue(value) {
  if (value === "true") return true;
  if (value === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  return value;
}
function toCamel(value) {
  return value.replace(/-([a-z])/g, (_, char) => char.toUpperCase());
}

// src/modules/command-arg-projection/src/main/index.ts
function commandArgs(command, args, globals = {}) {
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
    actionPolicy: args.actionPolicy ?? globals.actionPolicy
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
        stateDir: globals.stateDir
      });
    case "target":
      return pickDefined({
        action: args.action ?? args._[0],
        targetId: args.targetId ?? args._[1],
        platform: args.platform,
        metroPort: args.metroPort,
        cwd,
        root: globals.root,
        stateDir: globals.stateDir
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
        stateDir: globals.stateDir
      });
    case "refs":
      return pickDefined({ cwd, root: globals.root, stateDir: globals.stateDir });
    case "get":
      return pickDefined({
        field: args.field ?? args._[0],
        ref: args.ref ?? args._[1],
        cwd,
        root: globals.root,
        stateDir: globals.stateDir
      });
    case "find":
      return pickDefined({
        kind: args.kind ?? args._[0],
        value: args.value ?? args._[1],
        action: args.action ?? args._[2],
        name: args.name ?? (args._[0] === "nth" ? args._[2] : void 0),
        text: args.text ?? args._[3],
        dryRun: args.dryRun,
        cwd,
        root: globals.root,
        stateDir: globals.stateDir
      });
    case "wait": {
      const first = args._[0];
      return pickDefined({
        ref: args.ref ?? (/^@e\d+$/.test(String(first ?? "")) ? first : void 0),
        ms: args.ms ?? (/^\d+$/.test(String(first ?? "")) ? Number(first) : void 0),
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
        stateDir: globals.stateDir
      });
    }
    case "batch":
      return pickDefined({
        steps: args.steps ?? args._,
        bail: args.bail,
        cwd,
        root: globals.root,
        stateDir: globals.stateDir
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
        dryRun: args.dryRun
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
      const scrollRef = command === "scroll" && /^@e\d+$/.test(String(first ?? "")) ? first : void 0;
      return pickDefined({
        ...common,
        command,
        ref: args.ref ?? scrollRef ?? (command === "scroll" ? void 0 : first),
        targetRef: args.targetRef ?? (command === "drag" ? second : void 0),
        text: args.text ?? (command === "fill" || command === "select" ? args._[1] : void 0),
        direction: args.direction ?? (command === "scroll" ? scrollRef ? second : first : void 0),
        amount: args.amount ?? (command === "scroll" ? scrollRef ? third : second : void 0),
        durationMs: args.durationMs,
        dryRun: args.dryRun,
        cwd,
        root: globals.root,
        stateDir: globals.stateDir
      });
    }
    case "type":
    case "press":
      return pickDefined({
        ...common,
        action: command,
        text: args.text ?? args._[0],
        key: args.key ?? args._[0],
        dryRun: args.dryRun
      });
    case "clipboard":
    case "keyboard":
      return pickDefined({
        ...common,
        action: args.action ?? args._[0],
        text: args.text ?? args._[1],
        key: args.key ?? args._[1],
        dryRun: args.dryRun
      });
    case "set":
      return pickDefined({
        ...common,
        domain: args.domain ?? args._[0],
        value: args.value ?? args._[1],
        extra: args.extra ?? args._.slice(2),
        actionPolicy: args.actionPolicy ?? globals.actionPolicy,
        dryRun: args.dryRun
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
        stateDir: globals.stateDir
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
        stateDir: globals.stateDir
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
        maxEvents: args.maxEvents
      });
    case "open-route":
      return pickDefined({
        cwd,
        device: args.device,
        url: args.url,
        scheme: args.scheme,
        route: args.route ?? args._[0],
        query: args.query,
        authCookie: args.authCookie
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
        logsLast: args.logsLast
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
        confirmActions: args.confirmActions ?? globals.confirmActions
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
        maxComments: args.maxComments
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
        force: args.force
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
        addedVisibleControls: args.addedVisibleControls
      });
    case "trace":
      return pickDefined({
        cwd,
        metroPort: args.metroPort,
        action: args.action ?? args._[0],
        componentFilter: args.componentFilter,
        maxEvents: args.maxEvents,
        includeEvents: args.includeEvents
      });
    case "annotation-server":
      return pickDefined({ dir: args.dir, port: args.port });
    case "devtools":
      return pickDefined({
        action: args.action ?? args._[0],
        subaction: args.subaction ?? (args._[0] === "events" ? args._[1] : void 0),
        metroPort: args.metroPort,
        cwd,
        root: globals.root,
        stateDir: globals.stateDir
      });
    case "console":
    case "errors":
      return pickDefined({
        action: args.clear === true ? "clear" : args.action ?? args._[0],
        limit: args.limit,
        metroPort: args.metroPort,
        cwd
      });
    case "metro":
      return pickDefined({
        action: args.action ?? args._[0],
        stackFile: args.stackFile ?? args.file ?? args._[1],
        metroPort: args.metroPort,
        cwd
      });
    case "navigation":
      return pickDefined({
        action: args.action ?? args._[0],
        tab: args.tab ?? args._[1],
        route: args.route ?? (args._[0] === "deep-link" ? args._[1] : void 0),
        url: args.url,
        scheme: args.scheme,
        query: args.query,
        device: args.device,
        metroPort: args.metroPort,
        actionPolicy: args.actionPolicy ?? globals.actionPolicy,
        cwd,
        root: globals.root,
        stateDir: globals.stateDir
      });
    case "network":
      return pickDefined({
        action: args.action ?? args._[0],
        harAction: args.harAction ?? (args._[0] === "har" ? args._[1] : void 0),
        requestId: args.requestId ?? (args._[0] === "request" ? args._[1] : void 0),
        outputPath: args.outputPath ?? (args._[0] === "har" && args._[1] === "stop" ? args._[2] : void 0),
        limit: args.limit,
        metroPort: args.metroPort,
        cwd,
        root: globals.root,
        stateDir: globals.stateDir
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
        cwd
      });
    case "state":
      return pickDefined({
        action: args.action ?? args._[0] ?? "list",
        name: args.name ?? args._[1],
        metroPort: args.metroPort,
        actionPolicy: args.actionPolicy ?? globals.actionPolicy,
        cwd
      });
    case "controls":
      return pickDefined({
        action: args.action ?? args._[0] ?? "list",
        name: args.name ?? args._[1],
        metroPort: args.metroPort,
        actionPolicy: args.actionPolicy ?? globals.actionPolicy,
        cwd
      });
    case "bridge":
      return pickDefined({
        action: args.action ?? args._[0] ?? "status",
        metroPort: args.metroPort,
        domain: args.domain ?? args._[1],
        command: args.command ?? args._[2],
        actionPolicy: args.actionPolicy ?? globals.actionPolicy,
        cwd,
        confirmActions: args.confirmActions ?? globals.confirmActions
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
        stateDir: globals.stateDir
      });
    case "dialog":
      return pickDefined({
        action: args.action ?? args._[0] ?? "status",
        text: args.text ?? args._[1],
        metroPort: args.metroPort,
        cwd
      });
    case "sheet":
      return pickDefined({
        action: args.action ?? args._[0] ?? "status",
        metroPort: args.metroPort,
        cwd
      });
    case "record":
      return pickDefined({
        action: args.action ?? args._[0] ?? "start",
        outputPath: args.outputPath ?? args._[1],
        cwd,
        root: globals.root,
        stateDir: globals.stateDir
      });
    case "diff":
      return pickDefined({
        kind: args.kind ?? args._[0],
        baseline: args.baseline ?? args._[1],
        current: args.current ?? args._[2],
        routeA: args.routeA ?? (args._[0] === "route" ? args._[1] : void 0),
        routeB: args.routeB ?? (args._[0] === "route" ? args._[2] : void 0),
        screenshot: args.screenshot,
        outputPath: args.outputPath,
        cwd,
        root: globals.root,
        stateDir: globals.stateDir
      });
    case "expo":
      return pickDefined({
        action: args.action ?? args._[0] ?? "modules",
        cwd
      });
    case "rn":
      return pickDefined({
        action: args.action ?? args._[0] ?? "tree",
        subaction: args.subaction ?? (args._[0] === "renders" ? args._[1] : void 0),
        ref: args.ref ?? (["inspect", "fiber"].includes(String(args._[0])) ? args._[1] : void 0),
        metroPort: args.metroPort,
        raw: args.raw,
        detail: args.detail,
        cwd,
        root: globals.root,
        stateDir: globals.stateDir
      });
    case "perf":
    case "profiler":
      return pickDefined({
        action: command === "profiler" ? "ettrace" : args.action ?? args._[0] ?? "summary",
        subaction: command === "profiler" ? args.subaction ?? args.action ?? args._[0] ?? "start" : args.subaction ?? (["mark", "measure", "budget", "ettrace", "memgraph"].includes(String(args._[0])) ? args._[1] : void 0),
        label: args.label ?? (args._[0] === "action" ? args._[1] : args._[0] === "measure" ? args._[2] : void 0),
        bundleArtifact: args.bundleArtifact ?? (args._[0] === "bundle" ? args._[1] : void 0),
        baseline: args.baseline,
        candidate: args.candidate,
        file: args.file,
        nativeArtifact: args.nativeArtifact ?? (command === "profiler" ? args._[1] : ["ettrace", "memgraph"].includes(String(args._[0])) ? args._[2] : void 0),
        outputPath: args.outputPath,
        buildKind: args.buildKind,
        samples: args.samples,
        metroPort: args.metroPort,
        cwd,
        root: globals.root,
        stateDir: globals.stateDir
      });
    case "dashboard":
      return pickDefined({
        action: args.action ?? args._[0] ?? "status",
        outputPath: args.outputPath,
        port: args.port,
        cwd,
        root: globals.root,
        stateDir: globals.stateDir
      });
    case "inspect":
    case "highlight":
      return pickDefined({
        ...common,
        ref: args.ref ?? args._[0],
        durationMs: args.durationMs,
        cwd,
        root: globals.root,
        stateDir: globals.stateDir
      });
    case "review":
      return pickDefined({
        action: args.action ?? args._[0],
        outputPath: args.outputPath,
        cwd,
        root: globals.root,
        stateDir: globals.stateDir
      });
    case "policy":
      return pickDefined({
        action: args.action ?? args._[0],
        subject: args.subject ?? args._[1],
        name: args.name ?? args._[2],
        actionPolicy: args.actionPolicy ?? globals.actionPolicy,
        cwd
      });
    case "redact":
      return pickDefined({
        file: args.file ?? args._[0],
        outputPath: args.outputPath
      });
    case "skills":
      return pickDefined({
        action: args.action ?? args._[0] ?? "list",
        name: args.name ?? args._[1]
      });
    case "install":
    case "upgrade":
      return pickDefined({
        action: args.action ?? args._[0] ?? "check",
        prefix: args.prefix
      });
    case "release":
      return pickDefined({
        action: args.action ?? args._[0] ?? "check",
        cwd
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
        actionPolicy: args.actionPolicy ?? globals.actionPolicy
      });
    default:
      return {};
  }
}
function pickDefined(object) {
  return Object.fromEntries(Object.entries(object).filter(([, value]) => value !== void 0));
}

// src/modules/command-dispatch-envelope/src/main/index.ts
var EXIT_SUCCESS = 0;
var EXIT_RUNTIME_FAILURE = 1;
var EXIT_INVALID_USAGE2 = 2;
var CLI_NAME = "expo-ios";
var CLI_VERSION = "0.1.0";
var REDACTED = "[redacted]";
var CliUsageError2 = class extends Error {
  exitCode = EXIT_INVALID_USAGE2;
  constructor(message) {
    super(message);
    this.name = "CliUsageError";
  }
};
var ALIASES = {
  "doctor": "doctor",
  "project-info": "project_info",
  "routes": "expo_router_sitemap",
  "devices": "list_devices",
  "session": "session",
  "target": "target",
  "snapshot": "snapshot",
  "refs": "refs",
  "get": "get_ref",
  "find": "find",
  "wait": "wait",
  "batch": "batch",
  "boot-simulator": "boot_simulator",
  "open-url": "open_url",
  "launch-app": "launch_app",
  "terminate-app": "terminate_app",
  "reload-app": "reload_app",
  "open-dev-menu": "runtime_inspector",
  "install-app": "install_app",
  "uninstall-app": "uninstall_app",
  "long-press": "ref_action",
  "dbltap": "ref_action",
  "fill": "ref_action",
  "type": "keyboard",
  "press": "keyboard",
  "focus": "ref_action",
  "blur": "ref_action",
  "select": "ref_action",
  "check": "ref_action",
  "uncheck": "ref_action",
  "drag": "ref_action",
  "scroll": "ref_action",
  "scroll-into-view": "ref_action",
  "clipboard": "clipboard",
  "keyboard": "keyboard",
  "set": "set_environment",
  "logs": "collect_app_logs",
  "screenshot": "automation_take_screenshot",
  "tap": "automation_tap",
  "gesture": "automation_gesture",
  "open-route": "open_expo_route",
  "ux-context": "capture_ux_context",
  "annotate-screen": "annotate_screen",
  "inspector": "runtime_inspector",
  "review-overlay": "review_overlay",
  "review-overlay-server": "review_overlay",
  "review-next": "review_next_step",
  "annotation-server": "annotation_server",
  "devtools": "devtools",
  "console": "console",
  "errors": "errors",
  "metro": "metro",
  "profiler": "perf",
  "navigation": "navigation",
  "network": "network",
  "storage": "storage",
  "state": "state",
  "controls": "controls",
  "bridge": "bridge",
  "accessibility": "accessibility",
  "dialog": "dialog",
  "sheet": "sheet",
  "record": "record",
  "diff": "diff",
  "inspect": "debug_inspect",
  "highlight": "highlight",
  "expo": "expo",
  "rn": "rn",
  "perf": "perf",
  "dashboard": "dashboard",
  "review": "review",
  "policy": "policy",
  "redact": "redact",
  "skills": "skills",
  "install": "install",
  "upgrade": "upgrade",
  "release": "release",
  "live-backlog": "live_backlog",
  "trace": "trace_interaction"
};
async function dispatchCommand(parsed, dependencies) {
  const { globals, command, args } = parsed;
  const stdout = dependencies.stdout ?? (() => {
  });
  const stderr = dependencies.stderr ?? (() => {
  });
  if (globals.json && globals.plain) {
    throw new CliUsageError2("--json and --plain are mutually exclusive.");
  }
  if (globals.version) {
    stdout(`${dependencies.cliVersion ?? CLI_VERSION}
`);
    return EXIT_SUCCESS;
  }
  if (globals.help || !command || command === "help" || args.help) {
    stdout(dependencies.printHelp ? dependencies.printHelp() : "");
    return EXIT_SUCCESS;
  }
  const toolName = ALIASES[command];
  if (!toolName) {
    throw new CliUsageError2(`Unknown command: ${command}`);
  }
  const effectiveArgs = dependencies.projectArgs ? dependencies.projectArgs(command, args, globals) : pickDefined2({ ...args });
  const recorder = await (dependencies.startRunRecord ? dependencies.startRunRecord({ command, args: effectiveArgs, globals }) : noopRecorder());
  try {
    const payload = await runTool(toolName, effectiveArgs, {
      handlers: dependencies.handlers,
      command,
      globals,
      stdout
    });
    await recorder.finish({ status: "completed", exitCode: EXIT_SUCCESS, payload });
    if (globals.debug && recorder.path) {
      stderr(`run-record: ${recorder.path}
`);
    }
    return EXIT_SUCCESS;
  } catch (error) {
    const exitCode = exitCodeForError(error);
    await recorder.finish({ status: "failed", exitCode, error });
    if (globals.debug && recorder.path) {
      stderr(`run-record: ${recorder.path}
`);
    }
    throw error;
  }
}
async function runTool(toolName, args, options) {
  const handler = options.handlers[toolName];
  if (!handler) {
    throw new CliUsageError2(`Unknown tool: ${toolName}`);
  }
  const result = await handler(args);
  const payload = unwrapToolJson(result);
  const redactedPayload = redactValue(payload);
  if (!options.silent) {
    const text = formatCliPayload(redactedPayload, options);
    if (text !== null) {
      (options.stdout ?? (() => {
      }))(text);
    }
  }
  return redactedPayload;
}
function toolJson(value) {
  return { content: [{ type: "text", text: `${JSON.stringify(value, null, 2)}
` }], isError: false };
}
function unwrapToolJson(result) {
  const maybe = result;
  const text = maybe?.content?.[0]?.text;
  if (typeof text !== "string") {
    return result;
  }
  try {
    return JSON.parse(text);
  } catch {
    return { text };
  }
}
function formatCliPayload(payload, options) {
  const globals = options.globals;
  if (globals.quiet && !globals.json) {
    return null;
  }
  const maybeBoundedPayload = globals.contentBoundaries === true ? { contentBoundary: "expo-ios-untrusted-output", payload } : payload;
  if (globals.json) {
    return boundOutput(`${JSON.stringify({ ok: true, data: maybeBoundedPayload }, null, 2)}
`, globals);
  }
  if (globals.plain) {
    return boundOutput(`${plainPayload(options.command, maybeBoundedPayload).join("\n")}
`, globals);
  }
  return boundOutput(`${JSON.stringify(maybeBoundedPayload, null, 2)}
`, globals);
}
function boundOutput(text, globals = { maxOutput: null }) {
  if (globals.maxOutput === null || globals.maxOutput === void 0) {
    return text;
  }
  const max = clampNumber(globals.maxOutput, 1, 1e7);
  if (text.length <= max) {
    return text;
  }
  const suffix = "\n[expo-ios output truncated by --max-output]\n";
  return `${text.slice(0, Math.max(0, max - suffix.length))}${suffix}`;
}
function formatCliError(error, options) {
  if (options.quiet && !options.json) {
    return null;
  }
  const exitCode = exitCodeForError(error);
  const payload = {
    ok: false,
    error: {
      code: errorCodeForExitCode(exitCode),
      message: sanitizeErrorMessage(formatError2(error)),
      exitCode
    }
  };
  if (options.debug) {
    payload.error.name = error?.name ?? "Error";
  }
  if (options.json || options.plain !== true) {
    return `${JSON.stringify(payload, null, 2)}
`;
  }
  return `error: ${payload.error.message}
`;
}
function plainPayload(command, payload) {
  const lines = ["ok: true", `command: ${command}`];
  if (command === "doctor") {
    lines.push(`cli: ${payload.cli?.name ?? CLI_NAME} ${payload.cli?.version ?? CLI_VERSION}`);
    lines.push(`cwd: ${payload.cwd ?? ""}`);
    lines.push(`ios-simulator: ${payload.capabilities?.iosSimulator ? "yes" : "no"}`);
    lines.push(`expo-cli: ${payload.capabilities?.expoCli ? "yes" : "no"}`);
    return lines;
  }
  if (command === "routes") {
    lines.push(`routes: ${payload.routeCount ?? payload.routes?.length ?? 0}`);
    for (const route of payload.routes ?? []) {
      lines.push(`route: ${route.route} ${route.file}`);
    }
    return lines;
  }
  if (command === "review-next") {
    lines.push(`toc-step: ${payload.constraint?.tocStep ?? ""}`);
    lines.push(`next: ${payload.nextStep ?? ""}`);
    for (const suggested of payload.suggestedCommands ?? []) {
      lines.push(`suggested-command: ${suggested}`);
    }
    return lines;
  }
  if (payload.available === false && payload.reason) {
    lines.push("available: false");
    lines.push(`reason: ${payload.reason}`);
    return lines;
  }
  lines.push(`data: ${JSON.stringify(payload)}`);
  return lines;
}
function exitCodeForError(error) {
  const record = error;
  if (record && Number.isInteger(record.exitCode)) {
    return record.exitCode;
  }
  const message = String(record?.message ?? "");
  if (/Unknown command|Unknown tool|requires a value|Expected a finite number|must be a non-empty string|must look like|must not contain whitespace|valid JSON/i.test(message)) {
    return EXIT_INVALID_USAGE2;
  }
  return EXIT_RUNTIME_FAILURE;
}
function errorCodeForExitCode(exitCode) {
  if (exitCode === EXIT_INVALID_USAGE2) return "invalid_usage";
  if (exitCode === EXIT_RUNTIME_FAILURE) return "runtime_failure";
  return "error";
}
function formatError2(error) {
  if (!error) {
    return "Unknown error";
  }
  const record = error;
  const parts = [record.message ?? String(error)];
  if (record.stdout) {
    parts.push(`stdout:
${truncate(record.stdout)}`);
  }
  if (record.stderr) {
    parts.push(`stderr:
${truncate(record.stderr)}`);
  }
  return parts.join("\n\n");
}
function truncate(value, limit = 4e4) {
  const text = String(value ?? "");
  if (text.length <= limit) {
    return text;
  }
  return `${text.slice(0, limit)}
[truncated ${text.length - limit} characters]`;
}
function sanitizeErrorMessage(message) {
  return redactValue(String(message ?? ""));
}
function redactValue(value, key = "") {
  if (typeof value === "string") {
    if (isSecretKey(key)) {
      return REDACTED;
    }
    return value.replace(/([?&](cookie|token|authorization|password|secret)=)[^&]+/gi, `$1${REDACTED}`).replace(/\b(token|authorization|password|secret)=([^\s&]+)/gi, `$1=${REDACTED}`).replace(/(authorization=\[redacted\]\s+)[^\s&]+/gi, `$1${REDACTED}`);
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, key));
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  return Object.fromEntries(Object.entries(value).map(([childKey, childValue]) => [
    childKey,
    isSecretKey(childKey) ? REDACTED : redactValue(childValue, childKey)
  ]));
}
function clampNumber(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new Error(`Expected a finite number, got ${value}.`);
  }
  return Math.min(Math.max(number, min), max);
}
function pickDefined2(object) {
  return Object.fromEntries(Object.entries(object).filter(([, value]) => value !== void 0));
}
function isSecretKey(key) {
  return /token|authorization|cookie|password|secret|apikey|apiKey/i.test(key);
}
function noopRecorder() {
  return { path: null, async finish() {
  } };
}

// src/modules/cli-facade-entrypoint/src/main/index.ts
function defaultLastCliOptions() {
  return {
    json: false,
    plain: false,
    quiet: false,
    debug: false,
    maxOutput: null,
    contentBoundaries: false,
    allowRuntimeEval: null,
    confirmActions: null
  };
}
function createCliFacade(deps) {
  let lastCliOptions = defaultLastCliOptions();
  async function main(argv) {
    const parsed = deps.parseCliArgs(argv);
    lastCliOptions = parsed.globals;
    return deps.dispatchCommand(parsed);
  }
  async function run(argv) {
    try {
      return await main(argv);
    } catch (error) {
      deps.writeCliError(error, lastCliOptions);
      return deps.exitCodeForError(error);
    }
  }
  return {
    main,
    run,
    getLastCliOptions: () => ({ ...lastCliOptions })
  };
}

// src/modules/cli-help-surface/src/main/index.ts
var CLI_VERSION2 = "0.1.0";
var GLOBAL_FLAGS = [
  "--json                 Write { ok, data } JSON to stdout",
  "--plain                Write stable line-oriented output to stdout",
  "--quiet                Suppress non-essential human output",
  "--version              Print CLI version",
  "--root <dir>           Default project root for commands that accept --cwd",
  "--state-dir <dir>      Persist a run record JSON file in this directory",
  "--action-policy <path> Permit gated write/device actions from a JSON policy",
  "--max-output <chars>   Truncate stdout payloads after this many characters",
  "--content-boundaries   Wrap stdout data in an explicit untrusted-output boundary",
  "--allow-runtime-eval <true|false>",
  "                       Permit gated Hermes Runtime.evaluate predicates",
  "--confirm-actions <list>",
  "                       Reserved for interactive confirmations; noninteractive runs deny",
  "--record               Persist a run record under <root>/.scratch/expo-ios/runs",
  "--debug                Include debug fields in machine-readable errors",
  "--no-color             Disable color; output is uncolored by default",
  "--no-input             Reserved for noninteractive safety; this CLI never prompts"
];
var DISCOVERY_COMMANDS = [
  "doctor                 Check local tool availability and project context",
  "project-info           Inspect Expo dependencies and app config",
  "routes                 List Expo Router routes",
  "devices                List iOS simulators and Android devices",
  "session new [name]     Create an evidence session and artifact namespace",
  "target list            List stable simulator/app/Metro target handles",
  "target select <id>     Store the active target on the latest session",
  "target current         Show the selected target for the latest session",
  "snapshot               Capture semantic UI refs for the selected target",
  "refs                   List cached refs from the latest snapshot",
  "get <field> <ref>      Inspect one cached ref field",
  "find <kind> <value>     Locate cached semantic refs and optionally plan an action",
  "wait                   Wait for cached text or ref state evidence",
  "batch                  Run multiple expo-ios command steps in one process"
];
var SIMULATOR_AND_APP_COMMANDS = [
  "boot-simulator         Boot an iOS simulator",
  "open-url <url>         Open a URL/deep link",
  "launch-app             Launch an installed app",
  "terminate-app          Terminate an installed app",
  "reload-app             Relaunch an app as a practical JS reload fallback",
  "open-dev-menu          Open the React Native dev menu on the simulator",
  "install-app            Install an .app/.ipa with an action policy",
  "uninstall-app          Uninstall an app with an action policy",
  "open-route [route]     Open an Expo Router route",
  "screenshot             Capture a simulator/device screenshot",
  "tap                    Tap device coordinates",
  "fill/press/type        Act on focused input or cached semantic refs",
  "long-press/dbltap      Run semantic ref gestures from cached bounds",
  "scroll/drag            Run semantic ref or coordinate gestures",
  "clipboard              Read, write, or paste simulator clipboard text",
  "keyboard               Type text or press a key through local tooling",
  "set                    Mutate explicit simulator environment settings",
  "gesture                Run tap, long-press, drag, or swipe gesture evidence"
];
var EVIDENCE_AND_RUNTIME_COMMANDS = [
  "logs                   Collect recent app/device logs",
  "ux-context             Capture screenshot, route, runtime, hierarchy, and log context",
  "annotate-screen        Prepare/read an in-app annotation overlay",
  "inspector              Toggle RN inspector and install/read simulator comments",
  "review-overlay         Scaffold/run an in-app Codex review overlay",
  "review-next            Suggest the next constraint-focused UI review step",
  "devtools capabilities  Report structured DevTools capability records",
  "console                Read bounded JS console diagnostics",
  "errors                 Read bounded JS error diagnostics",
  "metro status           Report Metro status, targets, and symbolication",
  "navigation             Read or drive app navigation bridge state",
  "network                Read app network evidence and write redacted HAR",
  "storage                Read or mutate app storage through policy gates",
  "state                  List/save/load/clear app state snapshots",
  "controls               List, inspect, or press app-defined controls",
  "bridge                 Plan/check dev-only app bridge install, health, and domains",
  "accessibility          Capture native accessibility tree/audit evidence",
  "dialog                 Report or act on visible dialog blockers",
  "sheet                  Report or dismiss visible sheet/modal blockers",
  "record                 Create recording evidence artifacts",
  "diff                   Write snapshot or screenshot diff artifacts",
  "expo                   Inspect Expo modules, config, doctor, upstream policy, and prebuild risk",
  "rn                     Inspect React Native tree, refs, renders, and fiber evidence",
  "perf                   Measure summary, startup, action, and bundle evidence",
  "dashboard              Start, stop, or report local session observability",
  "skills                 List or print bundled companion skill guidance",
  "install                Check local install target paths",
  "upgrade                Check local upgrade status",
  "release                Run local release packaging checks",
  "live-backlog           Generate or run the source-derived live backlog",
  "trace                  Start/read/stop/clear a Hermes interaction trace",
  "profiler start|stop    Native profiler evidence boundary alias for perf ettrace",
  "inspect <ref>          Inspect cached source/props/bounds plus Metro target status",
  "highlight <ref>        Write a bounded highlight evidence overlay",
  "review report|matrix   Assemble captured evidence into review artifacts",
  "policy show|check      Explain or evaluate action-policy decisions",
  "redact <file>          Redact secrets from a JSON/text file"
];
var EXAMPLES = [
  "expo-ios --json doctor",
  "expo-ios --json session new review",
  "expo-ios --json target list",
  "expo-ios --json snapshot --interactive --source --bounds",
  "expo-ios --json get source @e1",
  "expo-ios --json find role button --name Add tap",
  "expo-ios --json wait --text Customers",
  "expo-ios --json wait @e1 --state visible",
  `expo-ios --json batch '["wait","--text","Customers"]' '["get","source","@e1"]' --bail true`,
  "expo-ios --json screenshot --annotate",
  "expo-ios --json open-route /customers --cwd apps/mobile --scheme myapp",
  "expo-ios --json annotate-screen prepare --cwd apps/mobile --serve true",
  "expo-ios --json inspector probe --metro-port 8081",
  "expo-ios --json inspector install-comment-menu --metro-port 8081",
  "expo-ios --json inspector open-dev-menu",
  "expo-ios --json terminate-app --bundle-id com.example.app",
  "expo-ios --json reload-app --bundle-id com.example.app",
  'expo-ios --json fill @e1 "hello"',
  "expo-ios --json clipboard read",
  "expo-ios --json set appearance dark --action-policy expo-ios.policy.json",
  "expo-ios --json review-overlay scaffold --cwd apps/mobile",
  "expo-ios --json review-overlay prepare --cwd apps/mobile --serve true",
  'expo-ios --json review-next --surface calendar --stage pre-patch --issue "drag creates scroll conflict"',
  "expo-ios --json devtools capabilities --metro-port 8081",
  "expo-ios --json expo upstream-policy --cwd apps/mobile",
  "expo-ios --json console --limit 50 --metro-port 8081",
  "expo-ios --json errors --limit 50 --metro-port 8081",
  "expo-ios --json metro status --metro-port 8081",
  "expo-ios --json navigation state --metro-port 8081",
  "expo-ios --json navigation deep-link /customers --scheme myapp",
  "expo-ios --json network requests --metro-port 8081",
  "expo-ios --json network har stop network.har --metro-port 8081",
  "expo-ios --json storage async list --metro-port 8081",
  "expo-ios --json controls list --metro-port 8081",
  "expo-ios --json bridge plan --cwd apps/mobile",
  "expo-ios --json bridge health --cwd apps/mobile --metro-port 8081",
  "expo-ios --json bridge domains storage set --cwd apps/mobile --metro-port 8081",
  "expo-ios --json accessibility tree",
  "expo-ios --json dialog status --metro-port 8081",
  "expo-ios --json diff snapshot --baseline before.json",
  "expo-ios --json expo modules --cwd apps/mobile",
  "expo-ios --json rn tree --metro-port 8081",
  "expo-ios --json rn inspect @e1",
  "expo-ios --json perf summary --metro-port 8081",
  'expo-ios --json perf action "open customer" --metro-port 8081',
  "expo-ios --json perf bundle dist/index.ios.bundle",
  "expo-ios --json perf compare --baseline before.json --candidate after.json",
  "expo-ios --json perf budget check --file expo-ios.perf.json --candidate after.json",
  "expo-ios --json perf memgraph capture heap.memgraph",
  "expo-ios --json profiler start",
  "expo-ios --json inspect @e1",
  "expo-ios --json policy check action uninstall-app --action-policy expo-ios.policy.json",
  "expo-ios --json redact run-record.json --output-path run-record.redacted.json",
  "expo-ios --json dashboard start",
  "expo-ios --json skills get expo-ios-cli",
  "expo-ios --json release check",
  "expo-ios --json gesture long-press --x 160 --y 720 --duration-ms 900 --dry-run true",
  "expo-ios --json live-backlog matrix --cwd apps/mobile",
  "expo-ios --json trace --action read --metro-port 8081"
];
function cliHelpText(version = CLI_VERSION2) {
  return [
    `expo-ios ${version}`,
    "",
    "Usage:",
    "  expo-ios [global flags] <command> [options]",
    "",
    "Global flags:",
    ...indent(GLOBAL_FLAGS),
    "",
    "Discovery:",
    ...indent(DISCOVERY_COMMANDS),
    "",
    "Simulator and app actions:",
    ...indent(SIMULATOR_AND_APP_COMMANDS),
    "",
    "Evidence and runtime:",
    ...indent(EVIDENCE_AND_RUNTIME_COMMANDS),
    "",
    "Examples:",
    ...indent(EXAMPLES)
  ].join("\n") + "\n";
}
function indent(lines) {
  return lines.map((line) => `  ${line}`);
}

// src/modules/cli-runtime-composition/src/main/index.ts
var CLI_RUNTIME_COMPONENT_SOURCES = [
  component("parseCliArgs", "@expo98/cli-argv-parser", "parseCliArgs"),
  component("commandArgs", "@expo98/command-arg-projection", "commandArgs"),
  component("dispatchCommand", "@expo98/command-dispatch-envelope", "dispatchCommand"),
  component("formatCliError", "@expo98/command-dispatch-envelope", "formatCliError"),
  component("exitCodeForError", "@expo98/command-dispatch-envelope", "exitCodeForError"),
  component("bindHandlers", "@expo98/tool-handler-registry", "bindHandlers"),
  component("handlerImplementationSources", "@expo98/tool-handler-registry", "handlerImplementationSources"),
  component("createCliFacade", "@expo98/cli-facade-entrypoint", "createCliFacade"),
  component("cliHelpText", "@expo98/cli-help-surface", "cliHelpText"),
  component("startRunRecord", "@expo98/session-run-records", "startRunRecord"),
  component("createCliRuntime", "@expo98/cli-runtime-composition", "createCliRuntime"),
  component("createCliExecutable", "@expo98/cli-executable-wrapper", "createCliExecutable")
];
function createCliRuntime(deps) {
  const handlers = deps.bindHandlers(deps.handlerImplementations);
  const dispatchDependencies = {
    handlers,
    projectArgs: deps.commandArgs,
    startRunRecord: deps.startRunRecord,
    stdout: deps.stdout,
    stderr: deps.stderr,
    printHelp: deps.printHelp,
    cliVersion: deps.cliVersion
  };
  const facade = deps.createCliFacade({
    parseCliArgs: deps.parseCliArgs,
    dispatchCommand: (parsed) => deps.dispatchCommand(parsed, dispatchDependencies),
    writeCliError: deps.writeCliError,
    exitCodeForError: deps.exitCodeForError
  });
  return {
    main: (argv) => facade.main(argv),
    run: (argv) => facade.run(argv),
    getLastCliOptions: () => facade.getLastCliOptions(),
    handlers,
    dispatchDependencies
  };
}
function component(role, packageName, exportName, required = true) {
  return { role, packageName, exportName, required };
}

// src/modules/cli-executable-wrapper/src/main/index.ts
var DEFAULT_PROCESS_ARGV_OFFSET = 2;
function createCliExecutable(deps) {
  return {
    argv: () => cliArgv(readArgv(deps.argv), deps.argvOffset),
    run: () => runCliExecutable(deps)
  };
}
async function runCliExecutable(deps) {
  const argv = cliArgv(readArgv(deps.argv), deps.argvOffset);
  try {
    const exitCode = await deps.main(argv);
    deps.setExitCode(exitCode);
    return exitCode;
  } catch (error) {
    deps.writeCliError(error);
    const exitCode = deps.exitCodeForError(error);
    deps.setExitCode(exitCode);
    return exitCode;
  }
}
function cliArgv(processArgv, argvOffset = DEFAULT_PROCESS_ARGV_OFFSET) {
  const offset = Number.isFinite(argvOffset) && argvOffset >= 0 ? Math.floor(argvOffset) : DEFAULT_PROCESS_ARGV_OFFSET;
  return processArgv.slice(offset);
}
function readArgv(argv) {
  return typeof argv === "function" ? argv() : argv;
}

// src/modules/tool-handler-registry/src/main/index.ts
var TOOL_HANDLER_BINDINGS = [
  ["doctor", "doctor"],
  ["project_info", "projectInfo"],
  ["expo_router_sitemap", "expoRouterSitemap"],
  ["list_devices", "listDevices"],
  ["session", "sessionCommand"],
  ["target", "targetCommand"],
  ["snapshot", "snapshotCommand"],
  ["refs", "refsCommand"],
  ["get_ref", "getRefCommand"],
  ["find", "findCommand"],
  ["wait", "waitCommand"],
  ["batch", "batchCommand"],
  ["boot_simulator", "bootSimulator"],
  ["open_url", "openUrl"],
  ["launch_app", "launchApp"],
  ["terminate_app", "terminateApp"],
  ["reload_app", "reloadApp"],
  ["install_app", "installApp"],
  ["uninstall_app", "uninstallApp"],
  ["ref_action", "refActionCommand"],
  ["clipboard", "clipboardCommand"],
  ["keyboard", "keyboardCommand"],
  ["set_environment", "setEnvironmentCommand"],
  ["collect_app_logs", "collectAppLogs"],
  ["automation_take_screenshot", "automationTakeScreenshot"],
  ["automation_tap", "automationTap"],
  ["automation_gesture", "automationGesture"],
  ["open_expo_route", "openExpoRoute"],
  ["capture_ux_context", "captureUxContext"],
  ["annotate_screen", "annotateScreen"],
  ["runtime_inspector", "runtimeInspector"],
  ["review_overlay", "reviewOverlay"],
  ["review_next_step", "reviewNextStep"],
  ["annotation_server", "annotationServer"],
  ["devtools", "devtoolsCommand"],
  ["console", "consoleCommand"],
  ["errors", "errorsCommand"],
  ["metro", "metroCommand"],
  ["navigation", "navigationCommand"],
  ["network", "networkCommand"],
  ["storage", "storageCommand"],
  ["state", "stateCommand"],
  ["controls", "controlsCommand"],
  ["bridge", "bridgeCommand"],
  ["accessibility", "accessibilityCommand"],
  ["dialog", "dialogCommand"],
  ["sheet", "sheetCommand"],
  ["record", "recordCommand"],
  ["diff", "diffCommand"],
  ["debug_inspect", "debugInspectCommand"],
  ["highlight", "highlightCommand"],
  ["expo", "expoCommand"],
  ["rn", "rnCommand"],
  ["perf", "perfCommand"],
  ["dashboard", "dashboardCommand"],
  ["review", "reviewCommand"],
  ["policy", "policyCommand"],
  ["redact", "redactCommand"],
  ["skills", "skillsCommand"],
  ["install", "installCommand"],
  ["upgrade", "upgradeCommand"],
  ["release", "releaseCommand"],
  ["live_backlog", "liveBacklogCommand"],
  ["trace_interaction", "traceInteraction"]
];
var HANDLER_IMPLEMENTATION_SOURCES = [
  source("doctor", "@expo98/project-info-doctor"),
  source("projectInfo", "@expo98/project-info-doctor"),
  source("expoRouterSitemap", "@expo98/router-sitemap"),
  source("listDevices", "@expo98/device-listing"),
  source("sessionCommand", "@expo98/session-run-records"),
  source("targetCommand", "@expo98/target-management"),
  source("snapshotCommand", "@expo98/snapshot-evidence"),
  source("refsCommand", "@expo98/snapshot-evidence"),
  source("getRefCommand", "@expo98/snapshot-evidence"),
  source("findCommand", "@expo98/ref-actions-wait"),
  source("waitCommand", "@expo98/ref-actions-wait"),
  source("batchCommand", "@expo98/batch-orchestration"),
  source("bootSimulator", "@expo98/app-lifecycle-actions"),
  source("openUrl", "@expo98/route-url-actions"),
  source("launchApp", "@expo98/app-lifecycle-actions"),
  source("terminateApp", "@expo98/app-lifecycle-actions"),
  source("reloadApp", "@expo98/app-lifecycle-actions"),
  source("installApp", "@expo98/app-lifecycle-actions"),
  source("uninstallApp", "@expo98/app-lifecycle-actions"),
  source("refActionCommand", "@expo98/interaction-actions"),
  source("clipboardCommand", "@expo98/interaction-actions"),
  source("keyboardCommand", "@expo98/interaction-actions"),
  source("setEnvironmentCommand", "@expo98/interaction-actions"),
  source("collectAppLogs", "@expo98/app-lifecycle-actions"),
  source("automationTakeScreenshot", "@expo98/screenshot-capture"),
  source("automationTap", "@expo98/interaction-actions"),
  source("automationGesture", "@expo98/interaction-actions"),
  source("openExpoRoute", "@expo98/route-url-actions"),
  source("captureUxContext", "@expo98/ux-context-capture"),
  source("annotateScreen", "@expo98/annotate-screen-artifacts"),
  source("runtimeInspector", "@expo98/runtime-inspector-actions"),
  source("reviewOverlay", "@expo98/review-overlay-workflow"),
  source("reviewNextStep", "@expo98/review-next-guidance"),
  source("annotationServer", "@expo98/annotation-server-http"),
  source("devtoolsCommand", "@expo98/devtools-diagnostics"),
  source("consoleCommand", "@expo98/devtools-diagnostics"),
  source("errorsCommand", "@expo98/devtools-diagnostics"),
  source("metroCommand", "@expo98/metro-probes"),
  source("navigationCommand", "@expo98/navigation-deeplinks"),
  source("networkCommand", "@expo98/network-evidence"),
  source("storageCommand", "@expo98/bridge-domain-actions"),
  source("stateCommand", "@expo98/bridge-domain-actions"),
  source("controlsCommand", "@expo98/bridge-domain-actions"),
  source("bridgeCommand", "@expo98/bridge-command-adapter"),
  source("accessibilityCommand", "@expo98/accessibility-actions"),
  source("dialogCommand", "@expo98/modal-blocker-actions"),
  source("sheetCommand", "@expo98/modal-blocker-actions"),
  source("recordCommand", "@expo98/record-artifacts"),
  source("diffCommand", "@expo98/review-evidence-reports"),
  source("debugInspectCommand", "@expo98/debug-inspect-highlight"),
  source("highlightCommand", "@expo98/debug-inspect-highlight"),
  source("expoCommand", "@expo98/expo-introspection-actions"),
  source("rnCommand", "@expo98/rn-introspection"),
  source("perfCommand", "@expo98/perf-evidence"),
  source("dashboardCommand", "@expo98/dashboard-observability"),
  source("reviewCommand", "@expo98/review-evidence-reports"),
  source("policyCommand", "@expo98/policy-redaction"),
  source("redactCommand", "@expo98/policy-redaction"),
  source("skillsCommand", "@expo98/plugin-self-management"),
  source("installCommand", "@expo98/plugin-self-management"),
  source("upgradeCommand", "@expo98/plugin-self-management"),
  source("releaseCommand", "@expo98/plugin-self-management"),
  source("liveBacklogCommand", "@expo98/live-backlog"),
  source("traceInteraction", "@expo98/interaction-trace-expression")
];
function handlerSymbols() {
  return TOOL_HANDLER_BINDINGS.map(([, handlerSymbol]) => handlerSymbol);
}
function bindHandlers(implementations) {
  const missing = handlerSymbols().filter((handlerSymbol) => implementations[handlerSymbol] === void 0);
  if (missing.length > 0) {
    throw new Error(`Missing handler implementations: ${missing.join(", ")}`);
  }
  return Object.fromEntries(TOOL_HANDLER_BINDINGS.map(([toolName, handlerSymbol]) => [
    toolName,
    implementations[handlerSymbol]
  ]));
}
function source(handlerSymbol, packageName, exportName = handlerSymbol) {
  return { handlerSymbol, packageName, exportName };
}

// src/modules/project-info-doctor/src/main/index.ts
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { execFile } from "node:child_process";
var CLI_NAME2 = "expo-ios";
var CLI_VERSION3 = "0.1.0";
var MAX_OUTPUT = 4e4;
var COMMAND_NAMES = ["node", "npx", "xcrun", "open", "plutil", "idb", "axe", "adb"];
var EXPO_REACT_NATIVE_COMPATIBILITY = [
  { expoMajor: 54, reactNativeMajorMinor: "0.81" },
  { expoMajor: 53, reactNativeMajorMinor: "0.79" },
  { expoMajor: 52, reactNativeMajorMinor: "0.76" },
  { expoMajor: 51, reactNativeMajorMinor: "0.74" },
  { expoMajor: 50, reactNativeMajorMinor: "0.73" }
];
async function doctor(args = {}) {
  const cwd = await normalizeCwd(args.cwd).catch(() => path.resolve(args.cwd ?? process.cwd()));
  const commands = {};
  for (const command of COMMAND_NAMES) {
    commands[command] = await commandPath(command, args.deps);
  }
  const projectInfoResult = await safeToolSection(() => projectInfo({ cwd }));
  const repairs = args.fix === true ? await doctorRepairs(cwd) : [];
  return toolJson2({
    cli: { name: CLI_NAME2, version: CLI_VERSION3 },
    cwd,
    auth: { required: false, source: "not-required" },
    commands,
    capabilities: {
      iosSimulator: Boolean(commands.xcrun),
      simulatorScreenshots: Boolean(commands.xcrun),
      iosCoordinateTap: Boolean(commands.idb || commands.axe),
      iosCoordinateGestures: Boolean(commands.idb || commands.axe),
      iosHierarchy: Boolean(commands.axe),
      androidDeviceBridge: Boolean(commands.adb),
      expoCli: Boolean(commands.npx),
      metroHermes: hasRuntimeGlobal("fetch", args.deps?.hasFetch) && hasRuntimeGlobal("WebSocket", args.deps?.hasWebSocket)
    },
    repairs,
    project: projectInfoResult.ok ? unwrapToolJson2(projectInfoResult.value) : projectInfoResult
  });
}
async function doctorRepairs(cwd) {
  const stateRoot = resolveExpoStateRoot({ cwd });
  const runs = path.join(stateRoot, "runs");
  const sessions = path.join(stateRoot, "sessions");
  await fs.mkdir(runs, { recursive: true });
  await fs.mkdir(sessions, { recursive: true });
  return [
    { action: "ensure-directory", path: runs },
    { action: "ensure-directory", path: sessions }
  ];
}
async function projectInfo(args) {
  const cwd = await normalizeCwd(args.cwd);
  const packageJsonPath = await findUp(cwd, "package.json");
  if (!packageJsonPath) {
    return toolJson2({
      cwd,
      isExpoProject: false,
      reason: "No package.json found in this directory or its parents."
    });
  }
  const projectRoot = path.dirname(packageJsonPath);
  const packageJson = asRecord(await readJsonFile(packageJsonPath)) ?? {};
  const allDeps = {
    ...asStringRecord(packageJson.dependencies),
    ...asStringRecord(packageJson.devDependencies)
  };
  const appJsonPath = await pathExists(path.join(projectRoot, "app.json"));
  const appConfigPath = await firstExisting(projectRoot, ["app.config.ts", "app.config.js", "app.config.mjs", "app.config.cjs"]);
  const appJson = appJsonPath ? asRecord(await readJsonFile(path.join(projectRoot, "app.json"))) : null;
  const expoConfig = appJson ? asRecord(appJson.expo) ?? appJson : null;
  const appConfigSummary = await readExpoConfigSummary(projectRoot);
  const easJson = await pathExists(path.join(projectRoot, "eas.json")) ? asRecord(await readJsonFile(path.join(projectRoot, "eas.json"))) : null;
  return toolJson2({
    cwd,
    projectRoot,
    isExpoProject: Boolean(allDeps.expo || expoConfig),
    packageManager: await detectPackageManager(projectRoot),
    expoDependency: allDeps.expo ?? null,
    reactNativeDependency: allDeps["react-native"] ?? null,
    expoRouterDependency: allDeps["expo-router"] ?? null,
    upstreamDependencies: buildUpstreamDependencyReport(projectRoot, allDeps),
    scripts: asRecord(packageJson.scripts) ?? {},
    appConfig: appConfigSummary ? projectInfoAppConfigSummary(appConfigSummary) : expoConfig ? {
      source: appJsonPath ? "app.json" : path.basename(appConfigPath ?? ""),
      name: expoConfig.name ?? null,
      slug: expoConfig.slug ?? null,
      scheme: expoConfig.scheme ?? null,
      iosBundleIdentifier: asRecord(expoConfig.ios)?.bundleIdentifier ?? null,
      androidPackage: asRecord(expoConfig.android)?.package ?? null,
      easProjectId: asRecord(asRecord(expoConfig.extra)?.eas)?.projectId ?? null
    } : null,
    hasDynamicAppConfig: Boolean(appConfigPath),
    eas: easJson ? {
      buildProfiles: Object.keys(asRecord(easJson.build) ?? {}),
      submitProfiles: Object.keys(asRecord(easJson.submit) ?? {}),
      cli: easJson.cli ?? null
    } : null
  });
}
function buildUpstreamDependencyReport(projectRoot, allDeps = {}) {
  const expoVersion = dependencyInfo(allDeps, "expo");
  const reactNativeVersion = dependencyInfo(allDeps, "react-native");
  const metroVersion = dependencyInfo(allDeps, "metro");
  const expoCliVersion = dependencyInfo(allDeps, "@expo/cli");
  const devMiddlewareVersion = dependencyInfo(allDeps, "@react-native/dev-middleware");
  const rozenitePackages = Object.keys(allDeps).filter((name) => name === "rozenite" || name.startsWith("@rozenite/")).sort().map((name) => dependencyInfo(allDeps, name));
  const expoRnCompatibility = classifyExpoReactNativeCompatibility(expoVersion, reactNativeVersion);
  const dependencies = [
    {
      id: "expo-public-api",
      ecosystem: "expo",
      packageName: "expo",
      integrationPoint: "Expo config, dev-client, expo/devtools plugin APIs, and public package exports.",
      classification: "public-api",
      usage: "direct-dependency",
      directDependency: expoVersion.present,
      declaredVersion: expoVersion.declaredVersion,
      resolvedVersion: expoVersion.resolvedVersion,
      status: dependencyStatus(expoVersion),
      compatibility: expoRnCompatibility.forExpo,
      notes: expoVersion.present ? ["Expo is declared by the project and can be used for public API compatibility checks."] : ["Expo is not declared; Expo-specific upstream clients remain unavailable."]
    },
    {
      id: "metro-inspector-http",
      ecosystem: "metro",
      packageName: "metro",
      integrationPoint: "Metro /status, /json/list, /json/version, /symbolicate, and /message HTTP/WebSocket surfaces.",
      classification: "documented-unstable-api",
      usage: "optional-compatibility-shim",
      directDependency: metroVersion.present,
      declaredVersion: metroVersion.declaredVersion,
      resolvedVersion: metroVersion.resolvedVersion,
      status: metroVersion.present ? dependencyStatus(metroVersion) : expoVersion.present ? "inferred-transitive" : "missing",
      compatibility: {
        state: metroVersion.present || expoVersion.present ? "discoverable-at-runtime" : "missing",
        expected: "Metro inspector endpoints are discovered over local HTTP at runtime; direct internal imports are not required."
      },
      notes: ["The CLI may probe Metro's local HTTP endpoints, but Metro server internals are reference-only unless isolated by a shim."]
    },
    {
      id: "hermes-react-native-cdp",
      ecosystem: "hermes-react-native",
      packageName: "react-native",
      integrationPoint: "Hermes inspector Chrome DevTools Protocol websocket exposed by React Native/Metro.",
      classification: "optional-compatibility-shim",
      usage: "optional-compatibility-shim",
      directDependency: reactNativeVersion.present,
      declaredVersion: reactNativeVersion.declaredVersion,
      resolvedVersion: reactNativeVersion.resolvedVersion,
      status: dependencyStatus(reactNativeVersion),
      compatibility: expoRnCompatibility.forReactNative,
      notes: ["CDP method calls must stay behind the expo-ios CDP client because Hermes/RN can expose implementation-specific methods."]
    },
    {
      id: "react-native-devtools",
      ecosystem: "react-native-devtools",
      packageName: "@react-native/dev-middleware",
      integrationPoint: "React Native DevTools launch metadata, panel discovery, and machine-readable domains where available.",
      classification: "documented-unstable-api",
      usage: "internal-reference-only",
      directDependency: devMiddlewareVersion.present,
      declaredVersion: devMiddlewareVersion.declaredVersion,
      resolvedVersion: devMiddlewareVersion.resolvedVersion,
      status: devMiddlewareVersion.present ? dependencyStatus(devMiddlewareVersion) : reactNativeVersion.present ? "reference-only" : "missing",
      compatibility: {
        state: reactNativeVersion.present ? "runtime-target-required" : "missing",
        expected: "React Native DevTools capabilities are confirmed from Metro target metadata before use."
      },
      notes: ["React Native DevTools internals can inform local wrappers, but command code must not depend on private build paths."]
    },
    {
      id: "expo-devtools-plugin",
      ecosystem: "expo-devtools-plugin",
      packageName: "expo",
      integrationPoint: "expo/devtools and useDevToolsPluginClient two-way development plugin APIs.",
      classification: "public-api",
      usage: "direct-dependency",
      directDependency: expoVersion.present,
      declaredVersion: expoVersion.declaredVersion,
      resolvedVersion: expoVersion.resolvedVersion,
      status: dependencyStatus(expoVersion),
      compatibility: {
        state: expoVersion.present ? "available-when-app-registers" : "missing",
        expected: "Plugin domains still require a live development build to register the app-side bridge."
      },
      notes: ["Plugin bridge installation and mutation remain explicit-user-permission operations."]
    },
    {
      id: "rozenite-devtools-bridge",
      ecosystem: "rozenite",
      packageName: rozenitePackages.length > 0 ? rozenitePackages.map((item) => item.name).join(", ") : "rozenite/@rozenite/*",
      integrationPoint: "Rozenite bridge, agent, React Navigation, network, storage, controls, and performance integrations.",
      classification: "optional-compatibility-shim",
      usage: "optional-compatibility-shim",
      directDependency: rozenitePackages.length > 0,
      declaredVersion: rozenitePackages.length > 0 ? rozenitePackages.map((item) => `${item.name}@${item.declaredVersion}`).join(", ") : null,
      resolvedVersion: rozenitePackages.length > 0 ? rozenitePackages.map((item) => `${item.name}@${item.resolvedVersion ?? item.declaredVersion}`).join(", ") : null,
      status: rozenitePackages.length > 0 ? rozenitePackages.some((item) => item.unresolved) ? "declared-unresolved" : "present" : "missing",
      compatibility: {
        state: rozenitePackages.length > 0 ? "optional-present" : "optional-missing",
        expected: "Rozenite-backed domains are preferred only when installed and registered by the app."
      },
      notes: ["Rozenite is optional; absence must produce structured unavailable data, not a CLI failure."]
    },
    {
      id: "expo-cli-internals",
      ecosystem: "expo",
      packageName: "@expo/cli",
      integrationPoint: "Expo CLI private implementation details used only as reference material.",
      classification: "internal-reference-only",
      usage: "internal-reference-only",
      directDependency: expoCliVersion.present,
      declaredVersion: expoCliVersion.declaredVersion,
      resolvedVersion: expoCliVersion.resolvedVersion,
      status: expoCliVersion.present ? dependencyStatus(expoCliVersion) : "not-depended-on",
      compatibility: {
        state: "reference-only",
        expected: "Private Expo CLI build paths must not be imported by command handlers."
      },
      notes: ["If an internal path is ever needed, it must be wrapped by an optional compatibility shim with fallback behavior."]
    }
  ];
  return {
    schemaVersion: 1,
    projectRoot,
    policy: {
      categories: [
        { id: "public-api", mayImportDirectly: true, requiresShim: false },
        { id: "documented-unstable-api", mayImportDirectly: false, requiresShim: true },
        { id: "internal-reference-only", mayImportDirectly: false, requiresShim: true },
        { id: "optional-compatibility-shim", mayImportDirectly: false, requiresShim: true }
      ],
      rules: [
        "Command handlers depend on expo-ios adapters, not raw upstream package objects.",
        "Metro and Hermes runtime availability is confirmed at runtime before a command reports live evidence.",
        "Internal Expo, Metro, React Native, or DevTools source paths are reference material unless isolated behind optional shims.",
        "Missing optional upstream packages produce structured unavailable reports instead of thrown errors."
      ]
    },
    summary: summarizeUpstreamDependencies(dependencies),
    dependencies
  };
}
function dependencyInfo(allDeps, name) {
  const declaredVersion = allDeps[name] ?? null;
  return {
    name,
    present: typeof declaredVersion === "string" && declaredVersion.length > 0,
    declaredVersion,
    resolvedVersion: parseVersionLike(declaredVersion),
    unresolved: typeof declaredVersion === "string" && /^(catalog|workspace|file|link|portal):/.test(declaredVersion)
  };
}
function dependencyStatus(info) {
  if (!info.present) return "missing";
  if (info.unresolved) return "declared-unresolved";
  return "present";
}
function parseVersionLike(version) {
  if (typeof version !== "string") return null;
  const match = version.match(/\d+\.\d+(?:\.\d+)?/);
  return match ? match[0] ?? null : null;
}
function classifyExpoReactNativeCompatibility(expoVersion, reactNativeVersion) {
  const missing = {
    state: "missing",
    expected: "Declare both expo and react-native to classify SDK compatibility."
  };
  if (!expoVersion.present || !reactNativeVersion.present) {
    return { forExpo: missing, forReactNative: missing };
  }
  if (expoVersion.unresolved || reactNativeVersion.unresolved) {
    const unresolved = {
      state: "declared-unresolved",
      expected: "Resolve catalog/workspace dependency versions before treating compatibility as proven.",
      expo: expoVersion.declaredVersion,
      reactNative: reactNativeVersion.declaredVersion
    };
    return { forExpo: unresolved, forReactNative: unresolved };
  }
  const expoMajor = majorFromVersion(expoVersion.declaredVersion);
  const reactNativeMajorMinor = majorMinorFromVersion(reactNativeVersion.declaredVersion);
  const expected = EXPO_REACT_NATIVE_COMPATIBILITY.find((entry) => entry.expoMajor === expoMajor);
  if (!expected) {
    const unknown = {
      state: "unknown",
      expected: "This Expo SDK is not in expo-ios' compatibility table; verify with the project dependency source.",
      expo: expoVersion.declaredVersion,
      reactNative: reactNativeVersion.declaredVersion
    };
    return { forExpo: unknown, forReactNative: unknown };
  }
  const result = {
    state: reactNativeMajorMinor === expected.reactNativeMajorMinor ? "compatible" : "mismatched",
    expected: `Expo SDK ${expected.expoMajor} expects React Native ${expected.reactNativeMajorMinor}.x.`,
    expo: expoVersion.declaredVersion,
    reactNative: reactNativeVersion.declaredVersion
  };
  return { forExpo: result, forReactNative: result };
}
async function normalizeCwd(cwd) {
  const resolved = path.resolve(cwd ?? process.cwd());
  const stat8 = await fs.stat(resolved).catch(() => null);
  if (!stat8?.isDirectory()) throw new Error(`Directory does not exist: ${resolved}`);
  return resolved;
}
async function findUp(startDir, filename) {
  let current = path.resolve(startDir);
  while (true) {
    const candidate = path.join(current, filename);
    if (await pathExists(candidate)) return candidate;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}
async function readJsonFile(file) {
  return JSON.parse(await fs.readFile(file, "utf8"));
}
async function detectPackageManager(projectRoot) {
  let current = path.resolve(projectRoot);
  while (true) {
    if (await pathExists(path.join(current, "pnpm-lock.yaml"))) return "pnpm";
    if (await pathExists(path.join(current, "yarn.lock"))) return "yarn";
    if (await pathExists(path.join(current, "bun.lockb"))) return "bun";
    if (await pathExists(path.join(current, "bun.lock"))) return "bun";
    if (await pathExists(path.join(current, "package-lock.json"))) return "npm";
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return "unknown";
}
async function firstExisting(root, names) {
  for (const name of names) {
    const candidate = path.join(root, name);
    if (await pathExists(candidate)) return candidate;
  }
  return null;
}
async function pathExists(file) {
  return fs.access(file).then(() => true, () => false);
}
async function readExpoConfigSummary(projectRoot) {
  const appJsonPath = path.join(projectRoot, "app.json");
  if (await pathExists(appJsonPath)) {
    const appJson = asRecord(await readJsonFile(appJsonPath)) ?? {};
    const expo = asRecord(appJson.expo) ?? appJson;
    return {
      source: appJsonPath,
      name: expo.name ?? null,
      slug: expo.slug ?? null,
      scheme: expo.scheme ?? null,
      iosBundleIdentifier: asRecord(expo.ios)?.bundleIdentifier ?? null,
      androidPackage: asRecord(expo.android)?.package ?? null,
      easProjectId: asRecord(asRecord(expo.extra)?.eas)?.projectId ?? null,
      userInterfaceStyle: expo.userInterfaceStyle ?? null
    };
  }
  const configPath = await firstExisting(projectRoot, ["app.config.ts", "app.config.js", "app.config.mjs", "app.config.cjs"]);
  if (!configPath) return null;
  const text = await fs.readFile(configPath, "utf8");
  return {
    source: configPath,
    name: regexConfigValue(text, "name"),
    slug: regexConfigValue(text, "slug"),
    scheme: regexConfigValue(text, "scheme"),
    iosBundleIdentifier: regexNestedConfigValue(text, "bundleIdentifier"),
    androidPackage: regexNestedConfigValue(text, "package"),
    easProjectId: regexConfigValue(text, "projectId"),
    userInterfaceStyle: regexConfigValue(text, "userInterfaceStyle"),
    dynamic: true
  };
}
function projectInfoAppConfigSummary(summary) {
  const payload = {
    source: path.basename(String(summary.source)),
    name: summary.name ?? null,
    slug: summary.slug ?? null,
    scheme: summary.scheme ?? null,
    iosBundleIdentifier: summary.iosBundleIdentifier ?? null,
    androidPackage: summary.androidPackage ?? null,
    easProjectId: summary.easProjectId ?? null
  };
  if (summary.userInterfaceStyle != null) payload.userInterfaceStyle = summary.userInterfaceStyle;
  if (summary.dynamic === true) payload.dynamic = true;
  return payload;
}
function resolveExpoStateRoot(args = {}) {
  if (args.stateDir) {
    const resolved = path.resolve(args.stateDir);
    return path.basename(resolved) === "runs" ? path.dirname(resolved) : resolved;
  }
  const root = path.resolve(args.root ?? args.cwd ?? process.cwd());
  return path.join(root, ".scratch", "expo-ios");
}
async function safeToolSection(fn) {
  try {
    return { ok: true, value: await fn() };
  } catch (error) {
    return { ok: false, error: formatError3(error) };
  }
}
function truncate2(value, limit = MAX_OUTPUT) {
  const text = String(value ?? "");
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}
[truncated ${text.length - limit} characters]`;
}
function formatError3(error) {
  if (!error) return "Unknown error";
  const record = asRecord(error);
  const parts = [error instanceof Error ? error.message : String(error)];
  if (record?.stdout) parts.push(`stdout:
${truncate2(record.stdout)}`);
  if (record?.stderr) parts.push(`stderr:
${truncate2(record.stderr)}`);
  return parts.join("\n\n");
}
function toolJson2(value) {
  return { content: [{ type: "text", text: `${JSON.stringify(value, null, 2)}
` }], isError: false };
}
function unwrapToolJson2(result) {
  const content = asRecord(result)?.content;
  const first = Array.isArray(content) ? asRecord(content[0]) : null;
  const text = first?.text;
  if (typeof text !== "string") return result;
  try {
    return JSON.parse(text);
  } catch {
    return { text };
  }
}
async function commandPath(command, deps) {
  if (deps?.commandPath) return deps.commandPath(command);
  const result = await execFilePromise("sh", ["-lc", `command -v ${shellArg(command)}`], {
    timeout: 5e3,
    rejectOnError: false
  });
  return result.stdout.trim() || null;
}
function execFilePromise(file, args, options = {}) {
  return new Promise((resolve15, reject) => {
    execFile(file, args, { timeout: options.timeout }, (error, stdout, stderr) => {
      const result = {
        stdout: String(stdout ?? ""),
        stderr: String(stderr ?? ""),
        error: error ? { message: error.message, code: error.code, signal: error.signal } : null
      };
      if (error && options.rejectOnError !== false) reject(Object.assign(error, result));
      else resolve15(result);
    });
  });
}
function hasRuntimeGlobal(name, override) {
  if (override !== void 0) return override;
  return typeof globalThis[name] === "function";
}
function shellArg(value) {
  return `'${value.replace(/'/g, "'\\''")}'`;
}
function asRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : null;
}
function asStringRecord(value) {
  const record = asRecord(value);
  if (!record) return {};
  return Object.fromEntries(
    Object.entries(record).filter((entry) => typeof entry[1] === "string")
  );
}
function majorFromVersion(version) {
  const parsed = parseVersionLike(version);
  if (!parsed) return null;
  return Number(parsed.split(".")[0]);
}
function majorMinorFromVersion(version) {
  const parsed = parseVersionLike(version);
  if (!parsed) return null;
  const [major, minor] = parsed.split(".");
  return `${major}.${minor ?? "0"}`;
}
function regexConfigValue(text, key) {
  return new RegExp(`\\b${key}\\s*:\\s*["'\`]([^"'\`]+)["'\`]`).exec(text)?.[1] ?? null;
}
function regexNestedConfigValue(text, key) {
  return new RegExp(`\\b${key}\\s*:\\s*["'\`]([^"'\`]+)["'\`]`).exec(text)?.[1] ?? null;
}
function summarizeUpstreamDependencies(dependencies) {
  const statuses = {};
  for (const dependency of dependencies) {
    statuses[dependency.status] = (statuses[dependency.status] ?? 0) + 1;
  }
  return {
    total: dependencies.length,
    directDependencies: dependencies.filter((dependency) => dependency.usage === "direct-dependency").length,
    internalReferenceOnly: dependencies.filter((dependency) => dependency.classification === "internal-reference-only").length,
    optionalCompatibilityShims: dependencies.filter((dependency) => dependency.classification === "optional-compatibility-shim").length,
    statuses,
    mismatched: dependencies.filter((dependency) => dependency.compatibility?.state === "mismatched").map((dependency) => dependency.id),
    missing: dependencies.filter((dependency) => dependency.status === "missing").map((dependency) => dependency.id)
  };
}

// src/modules/router-sitemap/src/main/index.ts
import { promises as fs2 } from "node:fs";
import path2 from "node:path";
function routeFromFile(relativeFile, dependencies = {}) {
  const paths = dependencies.path ?? defaultPath;
  const noExt = relativeFile.replace(/\.(jsx?|tsx?)$/, "");
  const rawSegments = noExt.split(paths.sep);
  if (rawSegments.some((segment) => segment === "_layout")) return { kind: "layout" };
  if (rawSegments.some((segment) => segment.startsWith("+"))) return { kind: "special" };
  const segments = [];
  for (const rawSegment of rawSegments) {
    if (rawSegment === "index") continue;
    if (/^\(.+\)$/.test(rawSegment)) continue;
    segments.push(formatRouteSegment(rawSegment));
  }
  return { kind: "route", route: `/${segments.join("/")}`.replace(/\/$/, "") || "/", segments };
}
async function walkFiles(root, dependencies = {}) {
  const deps = resolveDependencies(dependencies);
  const entries = await deps.fs.readdir(root, { withFileTypes: true });
  const result = [];
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = deps.path.join(root, entry.name);
    if (entry.isDirectory()) {
      result.push(...await walkFiles(full, dependencies));
    } else if (entry.isFile()) {
      result.push(full);
    }
  }
  return result;
}
async function expoRouterSitemap(args = {}, dependencies = {}) {
  const deps = resolveDependencies(dependencies);
  const cwd = await normalizeCwd2(args.cwd, deps);
  const appDir = deps.path.resolve(cwd, args.appDir ?? "app");
  if (!await deps.fs.pathExists(appDir)) {
    return toolJson3({
      cwd,
      appDir,
      routes: [],
      specialFiles: [],
      warning: "App directory was not found."
    });
  }
  const { routes, specialFiles } = await collectRoutes(appDir, deps, { sortSpecialFiles: true });
  return toolJson3({ cwd, appDir, routeCount: routes.length, routes, specialFiles });
}
async function expoRouteContext(cwd, dependencies = {}) {
  const deps = resolveDependencies(dependencies);
  const appDir = deps.path.join(cwd, "app");
  const appExists = await deps.fs.pathExists(appDir);
  const { routes, specialFiles } = appExists ? await collectRoutes(appDir, deps) : { routes: [], specialFiles: [] };
  const typedRoutesPath = deps.path.join(cwd, ".expo", "types", "router.d.ts");
  const hasTypedRoutes = await deps.fs.pathExists(typedRoutesPath);
  const typedRoutes = hasTypedRoutes ? parseTypedRoutes(await deps.fs.readFile(typedRoutesPath, "utf8")) : [];
  return {
    appDir: appExists ? appDir : null,
    routeCount: routes.length,
    routes,
    specialFiles,
    typedRoutesPath: hasTypedRoutes ? typedRoutesPath : null,
    typedRoutes
  };
}
async function collectRoutes(appDir, deps, options = {}) {
  const files = await walkFiles(appDir, { fs: deps.fs, path: deps.path });
  const routeFiles = files.filter((file) => /\.(jsx?|tsx?)$/.test(file));
  const routes = [];
  const specialFiles = [];
  for (const file of routeFiles) {
    const parsed = routeFromFile(deps.path.relative(appDir, file), { path: deps.path });
    if (parsed.kind === "route") {
      routes.push({ route: parsed.route, file, segments: parsed.segments });
    } else {
      specialFiles.push({ kind: parsed.kind, file });
    }
  }
  routes.sort((a, b) => a.route.localeCompare(b.route));
  if (options.sortSpecialFiles) specialFiles.sort((a, b) => a.file.localeCompare(b.file));
  return { routes, specialFiles };
}
function formatRouteSegment(segment) {
  if (/^\[\.\.\..+\]$/.test(segment)) return `*${segment.slice(4, -1)}`;
  if (/^\[\[.+\]\]$/.test(segment)) return `:${segment.slice(2, -2)}?`;
  if (/^\[.+\]$/.test(segment)) return `:${segment.slice(1, -1)}`;
  return segment;
}
function parseTypedRoutes(source2) {
  return [...new Set(source2.match(/pathname:\s*`([^`]+)`/g)?.map((match) => match.replace(/^pathname:\s*`|`$/g, "")) ?? [])].sort();
}
async function normalizeCwd2(cwd, deps) {
  const resolved = deps.path.resolve(cwd ?? deps.processCwd);
  const stat8 = await deps.fs.stat(resolved);
  if (!stat8?.isDirectory()) throw new Error(`Directory does not exist: ${resolved}`);
  return resolved;
}
function toolJson3(value) {
  return { content: [{ type: "text", text: `${JSON.stringify(value, null, 2)}
` }] };
}
function resolveDependencies(dependencies) {
  const paths = dependencies.path ?? defaultPath;
  return {
    fs: {
      stat: dependencies.fs?.stat ?? defaultStat,
      pathExists: dependencies.fs?.pathExists ?? defaultPathExists,
      readdir: dependencies.fs?.readdir ?? defaultReaddir,
      readFile: dependencies.fs?.readFile ?? defaultReadFile
    },
    path: paths,
    processCwd: dependencies.processCwd ?? "."
  };
}
var defaultPath = {
  sep: path2.sep,
  resolve: (...parts) => path2.resolve(...parts.filter((part) => Boolean(part))),
  join: (...parts) => path2.join(...parts),
  relative: (from, to) => path2.relative(from, to)
};
async function defaultStat(filePath) {
  return fs2.stat(filePath).catch(() => null);
}
async function defaultPathExists(filePath) {
  return fs2.access(filePath).then(() => true, () => false);
}
async function defaultReaddir(dirPath, options) {
  return fs2.readdir(dirPath, options);
}
async function defaultReadFile(filePath, encoding) {
  return fs2.readFile(filePath, encoding);
}

// src/modules/device-listing/src/main/index.ts
import { execFile as nodeExecFile } from "node:child_process";
var MAX_OUTPUT2 = 4e4;
function clampNumber2(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new Error(`Expected a finite number, got ${String(value)}.`);
  }
  return Math.min(Math.max(number, min), max);
}
async function safeToolSection2(fn) {
  try {
    return { ok: true, value: await fn() };
  } catch (error) {
    return { ok: false, error: formatError4(error) };
  }
}
async function listIosPhysicalDevices(limit, dependencies) {
  const { stdout } = await dependencies.execFile("xcrun", ["devicectl", "list", "devices", "--json-output", "-"], {
    timeout: 2e4,
    maxBuffer: 4 * 1024 * 1024
  });
  const parsed = JSON.parse(stdout);
  const devices = devicesFromPhysicalPayload(parsed);
  return devices.slice(0, limit).map((device) => ({
    name: stringOrNull(deviceProperty(device, "deviceProperties", "name") ?? device.name),
    identifier: stringOrNull(device.identifier ?? device.udid),
    platform: stringOrNull(deviceProperty(device, "deviceProperties", "platform") ?? device.platform),
    model: stringOrNull(deviceProperty(device, "hardwareProperties", "marketingName") ?? device.model),
    connectionType: stringOrNull(deviceProperty(device, "connectionProperties", "transportType") ?? device.connectionType),
    state: stringOrNull(deviceProperty(device, "connectionProperties", "pairingState") ?? device.state)
  }));
}
async function listDevices(args = {}, dependencies = defaultDeviceListingDependencies) {
  const platform = args.platform ?? "all";
  const limit = clampNumber2(args.limit ?? 40, 1, 200);
  const payload = {};
  if (platform === "ios" || platform === "all") {
    payload.ios = await safeToolSection2(async () => listIosSimulators(limit, dependencies));
    payload.iosPhysical = await safeToolSection2(async () => listIosPhysicalDevices(limit, dependencies));
  }
  if (platform === "android" || platform === "all") {
    payload.android = await safeToolSection2(async () => listAndroidDevices(limit, dependencies));
  }
  return toolJson4(payload);
}
var defaultDeviceListingDependencies = {
  execFile: (file, args, options = {}) => new Promise((resolve15, reject) => {
    nodeExecFile(file, args, {
      timeout: options.timeout,
      maxBuffer: options.maxBuffer
    }, (error, stdout, stderr) => {
      if (error) {
        Object.assign(error, { stdout, stderr });
        reject(error);
        return;
      }
      resolve15({ stdout: String(stdout ?? ""), stderr: String(stderr ?? "") });
    });
  })
};
async function listAndroidDevices(limit, dependencies) {
  const { stdout } = await dependencies.execFile("adb", ["devices", "-l"], { timeout: 2e4 });
  return stdout.split(/\r?\n/).slice(1).map((line) => line.trim()).filter(Boolean).map((line) => {
    const [serial = "", state = "", ...details] = line.split(/\s+/);
    return { serial, state, details: details.join(" ") };
  }).slice(0, limit);
}
async function listIosSimulators(limit, dependencies) {
  const { stdout } = await dependencies.execFile("xcrun", ["simctl", "list", "devices", "available", "--json"], {
    timeout: 2e4,
    maxBuffer: 4 * 1024 * 1024
  });
  const parsed = JSON.parse(stdout);
  const devices = isRecord(parsed) && isRecord(parsed.devices) ? parsed.devices : {};
  return Object.entries(devices).flatMap(([runtime2, runtimeDevices]) => {
    if (!Array.isArray(runtimeDevices)) throw new Error(`devices.${runtime2} must be an array.`);
    return runtimeDevices.map((device) => {
      const record = isRecord(device) ? device : {};
      return {
        runtime: runtime2,
        name: record.name,
        udid: record.udid,
        state: record.state,
        isAvailable: record.isAvailable
      };
    });
  }).sort(
    (left, right) => Number(right.state === "Booted") - Number(left.state === "Booted") || String(left.name).localeCompare(String(right.name))
  ).slice(0, limit);
}
function deviceProperty(device, objectKey, propertyKey) {
  const parent = device[objectKey];
  return isRecord(parent) ? parent[propertyKey] : void 0;
}
function devicesFromPhysicalPayload(value) {
  if (!isRecord(value)) throw new Error("physical device payload must be an object.");
  const rawDevices = isRecord(value.result) && "devices" in value.result ? value.result.devices : value.devices;
  if (!Array.isArray(rawDevices)) throw new Error("physical devices must be an array.");
  return rawDevices.map((device) => {
    if (!isRecord(device)) throw new Error("physical device entry must be an object.");
    return device;
  });
}
function formatError4(error) {
  if (!error) return "Unknown error";
  const record = isRecord(error) ? error : {};
  const message = error instanceof Error ? error.message : String(error);
  const parts = [message];
  if (record.stdout) parts.push(`stdout:
${truncate3(record.stdout)}`);
  if (record.stderr) parts.push(`stderr:
${truncate3(record.stderr)}`);
  return parts.join("\n\n");
}
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function stringOrNull(value) {
  return value == null ? null : String(value);
}
function toolJson4(value) {
  return {
    content: [{ type: "text", text: `${JSON.stringify(value, null, 2)}
` }],
    isError: false
  };
}
function truncate3(value, limit = MAX_OUTPUT2) {
  const text = String(value ?? "");
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}
[truncated ${text.length - limit} characters]`;
}

// src/modules/session-run-records/src/main/domain.ts
var CLI_NAME3 = "expo-ios";
var CLI_VERSION4 = "0.1.0";
var REDACTED2 = "[redacted]";
var MAX_OUTPUT3 = 4e4;

// src/modules/session-run-records/src/main/ids.ts
var systemClock = () => /* @__PURE__ */ new Date();
var randomBase36Suffix = () => Math.random().toString(36).slice(2, 8);
function createSessionId(name, at, randomSuffix = randomBase36Suffix) {
  const timestamp = at.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "").replace("T", "-").toLowerCase();
  return `${name}-${timestamp}-${randomSuffix()}`;
}
function createRunId(at, randomSuffix = randomBase36Suffix) {
  const timestamp = at.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z").replace("T", "-");
  return `${timestamp}-${randomSuffix()}`;
}

// src/modules/session-run-records/src/main/paths.ts
import { basename as basename2, join as join2, resolve as resolve2 } from "node:path";
function resolveExpoStateRoot2(args = {}) {
  if (args.stateDir) {
    const resolved = resolve2(args.stateDir);
    return basename2(resolved) === "runs" ? resolve2(join2(resolved, "..")) : resolved;
  }
  const root = resolve2(args.root ?? args.cwd ?? process.cwd());
  return join2(root, ".scratch", "expo-ios");
}
function sessionDirectory(stateRoot, sessionId) {
  return join2(stateRoot, "sessions", sessionId);
}
function sessionJsonPath(stateRoot, sessionId) {
  return join2(sessionDirectory(stateRoot, sessionId), "session.json");
}

// src/modules/session-run-records/src/main/session-service.ts
import { mkdir as mkdir3, readdir, rm } from "node:fs/promises";
import { join as join3 } from "node:path";

// src/modules/session-run-records/src/main/json-store.ts
import { mkdir as mkdir2, readFile as readFile2, writeFile } from "node:fs/promises";
import { dirname as dirname2 } from "node:path";
async function writeJsonFile(file, value) {
  await mkdir2(dirname2(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}
`, "utf8");
}
async function readJsonFile2(file) {
  return JSON.parse(await readFile2(file, "utf8"));
}

// src/modules/session-run-records/src/main/validation.ts
function requireString(value, field) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${field} must be a non-empty string.`);
  }
  return value.trim();
}
function requireOptionalString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

// src/modules/session-run-records/src/main/session-service.ts
async function sessionCommand(args = {}, deps = {}) {
  const action = requireString(args.action ?? "new", "action");
  if (!["new", "list", "show", "close", "clean"].includes(action)) {
    throw new Error(`Unknown session action: ${action}`);
  }
  const stateRoot = resolveExpoStateRoot2(args);
  if (action === "list") {
    return toolJson5({ available: true, action, stateRoot, sessions: await listSessions(stateRoot) });
  }
  if (action === "show") {
    return toolJson5(await showSession({ stateRoot, name: requireOptionalString(args.name) }));
  }
  if (action === "close") {
    return toolJson5(await closeSession({ stateRoot, name: requireOptionalString(args.name), now: deps.now }));
  }
  if (action === "clean") {
    return toolJson5(await cleanSessions({ stateRoot, olderThan: requireOptionalString(args.olderThan) ?? void 0, now: deps.now }));
  }
  return toolJson5(await createSession({
    stateRoot,
    name: requireOptionalString(args.name) ?? void 0,
    now: deps.now,
    randomSuffix: deps.randomSuffix
  }));
}
function toolJson5(value) {
  return { content: [{ type: "text", text: `${JSON.stringify(value, null, 2)}
` }], isError: false };
}
function parseDurationMs(value) {
  const match = /^(\d+)([smhd])$/.exec(String(value));
  if (!match) {
    throw new Error("duration must look like 30s, 2m, 1h, or 7d.");
  }
  const amount = Number(match[1]);
  const unit = match[2];
  return amount * { s: 1e3, m: 6e4, h: 36e5, d: 864e5 }[unit];
}
function normalizeSessionName(value) {
  const name = requireString(value, "name").toLowerCase().replace(/[^a-z0-9_.-]+/g, "-").replace(/^-+|-+$/g, "");
  if (!name) {
    throw new Error("name must include at least one letter or number.");
  }
  return name.slice(0, 48);
}
async function createSession(input) {
  const name = normalizeSessionName(input.name ?? "review");
  const now4 = input.now ?? systemClock;
  const created = now4();
  const createdAt = created.toISOString();
  const sessionId = createSessionId(name, created, input.randomSuffix ?? randomBase36Suffix);
  const artifactDir = join3(sessionDirectory(input.stateRoot, sessionId), "artifacts");
  await mkdir3(artifactDir, { recursive: true });
  const record = {
    schemaVersion: 1,
    sessionId,
    name,
    artifactDir,
    createdAt,
    updatedAt: createdAt,
    activeTargetId: null,
    lastSnapshotId: null,
    sidecars: []
  };
  await writeJsonFile(sessionJsonPath(input.stateRoot, sessionId), record);
  return record;
}
async function listSessions(stateRoot) {
  const sessionsDir = join3(stateRoot, "sessions");
  const entries = await readdir(sessionsDir, { withFileTypes: true }).catch(() => []);
  const sessions = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const record = await readJsonFile2(join3(sessionsDir, entry.name, "session.json")).catch(() => null);
    if (record) {
      sessions.push(record);
    }
  }
  return sessions.sort((left, right) => String(left.createdAt ?? "").localeCompare(String(right.createdAt ?? "")));
}
async function showSession(input) {
  const sessions = await listSessions(input.stateRoot);
  const requested = requireOptionalString(input.name);
  const session = requested ? sessions.find((item) => item.name === requested || item.sessionId === requested) : sessions.at(-1);
  return session ? { available: true, action: "show", session } : { available: false, action: "show", reason: "Session not found.", name: requested };
}
async function closeSession(input) {
  const sessions = await listSessions(input.stateRoot);
  const requested = requireOptionalString(input.name);
  const session = requested ? sessions.find((item) => item.name === requested || item.sessionId === requested) : sessions.at(-1);
  if (!session) {
    return { available: false, action: "close", reason: "Session not found.", name: requested };
  }
  const closedAt = (input.now ?? systemClock)().toISOString();
  const closed = { ...session, closedAt, updatedAt: closedAt, sidecars: [] };
  await writeJsonFile(sessionJsonPath(input.stateRoot, session.sessionId), closed);
  return { available: true, action: "close", session: closed };
}
async function cleanSessions(input) {
  const olderThan = input.olderThan ?? "7d";
  const cutoff = (input.now ?? systemClock)().getTime() - parseDurationMs(olderThan);
  const sessions = await listSessions(input.stateRoot);
  const removed = [];
  for (const session of sessions) {
    const created = Date.parse(session.createdAt ?? session.updatedAt ?? "0");
    if (Number.isFinite(created) && created < cutoff) {
      await rm(sessionDirectory(input.stateRoot, session.sessionId), { recursive: true, force: true });
      removed.push(session.sessionId);
    }
  }
  return { available: true, action: "clean", stateRoot: input.stateRoot, olderThan, removed };
}

// src/modules/session-run-records/src/main/run-recorder.ts
import { mkdir as mkdir4 } from "node:fs/promises";
import { join as join4, resolve as resolve3 } from "node:path";

// src/modules/session-run-records/src/main/redaction.ts
var SECRET_KEY_PATTERN = /token|authorization|cookie|password|secret|apikey|apiKey/i;
var URL_QUERY_SECRET_PATTERN = /([?&](cookie|token|authorization|password|secret)=)[^&]+/gi;
function redactValue2(value, key = "") {
  if (typeof value === "string") {
    if (isSecretKey2(key)) {
      return REDACTED2;
    }
    return value.replace(URL_QUERY_SECRET_PATTERN, `$1${REDACTED2}`);
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactValue2(item, key));
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value).map(([childKey, childValue]) => [
      childKey,
      isSecretKey2(childKey) ? REDACTED2 : redactValue2(childValue, childKey)
    ])
  );
}
function sanitizeErrorMessage2(message) {
  return redactValue2(String(message ?? ""));
}
function formatError5(error) {
  if (!error) {
    return "Unknown error";
  }
  const record = error;
  const parts = [record.message ?? String(error)];
  if (record.stdout) {
    parts.push(`stdout:
${truncate4(record.stdout)}`);
  }
  if (record.stderr) {
    parts.push(`stderr:
${truncate4(record.stderr)}`);
  }
  return parts.join("\n\n");
}
function isSecretKey2(key) {
  return SECRET_KEY_PATTERN.test(key);
}
function truncateOutput(value, limit = MAX_OUTPUT3) {
  const text = String(value ?? "");
  if (text.length <= limit) {
    return text;
  }
  return `${text.slice(0, limit)}
[truncated ${text.length - limit} characters]`;
}
var truncate4 = truncateOutput;

// src/modules/session-run-records/src/main/run-recorder.ts
async function startRunRecord(input) {
  if (!input.globals.record && !input.globals.stateDir) {
    return { path: null, async finish() {
    } };
  }
  const now4 = input.now ?? systemClock;
  const startedAt = now4().toISOString();
  const runId = createRunId(new Date(startedAt), input.randomSuffix ?? randomBase36Suffix);
  const root = resolve3(String(input.globals.root ?? input.args.cwd ?? input.cwd ?? process.cwd()));
  const stateDir = resolve3(String(input.globals.stateDir ?? join4(root, ".scratch", "expo-ios", "runs")));
  const recordPath = join4(stateDir, `${runId}.json`);
  const baseRecord = {
    schemaVersion: 1,
    runId,
    cli: { name: CLI_NAME3, version: CLI_VERSION4 },
    command: input.command,
    args: redactValue2(stripUndefined(input.args)),
    root,
    stateDir,
    startedAt,
    finishedAt: null,
    status: "running",
    exitCode: null
  };
  await mkdir4(stateDir, { recursive: true });
  await writeJsonFile(recordPath, baseRecord);
  return {
    path: recordPath,
    async finish({ status, exitCode, payload, error }) {
      await writeJsonFile(recordPath, {
        ...baseRecord,
        finishedAt: now4().toISOString(),
        status,
        exitCode,
        summary: summarizeRunPayload(payload),
        error: error ? sanitizeErrorMessage2(formatError5(error)) : null
      });
    }
  };
}
function summarizeRunPayload(payload) {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const record = payload;
  const summary = {
    keys: Object.keys(record).slice(0, 40)
  };
  if (typeof record.available === "boolean") {
    summary.available = record.available;
  }
  if (record.routeCount !== void 0) {
    summary.routeCount = record.routeCount;
  }
  if (Array.isArray(record.events)) {
    summary.eventCount = record.events.length;
  }
  return summary;
}
function stripUndefined(value) {
  return Object.fromEntries(Object.entries(value).filter(([, child]) => child !== void 0));
}

// src/modules/target-management/src/main/validation.ts
function requireString2(value, field) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${field} must be a non-empty string.`);
  }
  return value.trim();
}
function clampNumber3(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new Error(`Expected a finite number, got ${value}.`);
  }
  return Math.min(Math.max(number, min), max);
}

// src/modules/target-management/src/main/target-record.ts
function normalizeDeviceState(state) {
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
function stableIdPart(value) {
  return String(value ?? "unknown").toLowerCase().replace(/[^a-z0-9_.-]+/g, "-").replace(/^-+|-+$/g, "") || "unknown";
}
function processNameFromBundleId(bundleId) {
  if (!bundleId) {
    return null;
  }
  const last = String(bundleId).split(".").filter(Boolean).at(-1);
  return last ? last.replace(/[^a-zA-Z0-9_-]/g, "") || null : null;
}
function clampMetroPort(value) {
  return clampNumber3(value ?? 8081, 1, 65535);
}
function targetRecord(input) {
  const bundleId = input.metroTarget?.appId ?? null;
  const targetId = [
    input.platform,
    input.device.id,
    bundleId ?? input.metroTarget?.id ?? input.metroTarget?.title ?? "no-runtime",
    input.metroTarget ? input.metroPort : "no-metro"
  ].map(stableIdPart).join(":");
  return {
    targetId,
    platform: input.platform,
    device: {
      id: input.device.id,
      name: input.device.name ?? null,
      state: input.device.state ?? "unknown"
    },
    app: {
      bundleId,
      processName: processNameFromBundleId(bundleId),
      running: null
    },
    metro: {
      port: input.metroTarget ? input.metroPort : null,
      status: input.metroTarget ? "available" : "unavailable",
      targetId: input.metroTarget?.id ?? null,
      title: input.metroTarget?.title ?? null,
      appId: input.metroTarget?.appId ?? null,
      debuggerUrl: input.metroTarget?.webSocketDebuggerUrl ?? null
    },
    selected: targetId === (input.selectedTargetId ?? null),
    stale: false
  };
}

// src/modules/target-management/src/main/discovery.ts
async function discoverTargets(args, deps) {
  const platform = args.platform ?? "all";
  const metroPort = clampMetroPort(args.metroPort);
  const selectedTargetId2 = args.selectedTargetId ?? null;
  const targets = [];
  if (platform === "ios" || platform === "all") {
    const devices = await deps.listIosSimulatorTargets();
    const metroPayload = await deps.fetchMetroTargets(metroPort).catch(() => []);
    const metroTargets2 = normalizeMetroTargets(metroPayload);
    for (const device of devices) {
      const matchingMetroTargets = metroTargets2.filter((target) => !target.deviceName || target.deviceName === device.name);
      if (matchingMetroTargets.length === 0) {
        targets.push(targetRecord({ platform: "ios", device, metroPort, metroTarget: null, selectedTargetId: selectedTargetId2 }));
      } else {
        for (const metroTarget of matchingMetroTargets) {
          targets.push(targetRecord({ platform: "ios", device, metroPort, metroTarget, selectedTargetId: selectedTargetId2 }));
        }
      }
    }
  }
  return targets.sort(compareTargets);
}
function compareTargets(left, right) {
  return Number(right.selected) - Number(left.selected) || Number(right.metro.status === "available") - Number(left.metro.status === "available") || deviceName(left).localeCompare(deviceName(right));
}
function deviceName(target) {
  return target.device.name ?? "";
}
function normalizeSimulatorDevices(rawDevices) {
  return rawDevices.map((device) => ({
    id: String(device.udid ?? ""),
    name: typeof device.name === "string" ? device.name : String(device.udid ?? ""),
    state: normalizeDeviceState(device.state)
  })).sort((left, right) => Number(right.state === "booted") - Number(left.state === "booted") || String(left.name).localeCompare(String(right.name)));
}
function normalizeMetroTargets(payload) {
  if (!Array.isArray(payload)) {
    return [];
  }
  return payload.flatMap((item) => {
    if (!isRecord2(item)) {
      return [];
    }
    return [{
      id: optionalString(item.id),
      title: optionalString(item.title),
      appId: optionalString(item.appId),
      webSocketDebuggerUrl: optionalString(item.webSocketDebuggerUrl),
      deviceName: optionalString(item.deviceName)
    }];
  });
}
function isRecord2(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function optionalString(value) {
  return typeof value === "string" ? value : null;
}

// src/modules/target-management/src/main/target-service.ts
import { execFile as nodeExecFile2 } from "node:child_process";
import { mkdir as mkdir5, readdir as readdir2, readFile as readFile3, writeFile as writeFile2 } from "node:fs/promises";
import { join as join5 } from "node:path";
async function listTargets(args, deps = defaultTargetDependencies) {
  const session = await deps.readLatestSession(args.stateRoot);
  const targets = await discoverTargets({ ...args, selectedTargetId: session?.activeTargetId ?? null }, deps);
  return { available: targets.length > 0, targets };
}
async function selectTarget(args, deps = defaultTargetDependencies) {
  const session = await deps.readLatestSession(args.stateRoot);
  if (!session) {
    return { available: false, reason: "No session exists. Run `expo-ios --json session new review` first." };
  }
  const targetId = requireString2(args.targetId, "targetId");
  const targets = await discoverTargets({ ...args, selectedTargetId: session.activeTargetId }, deps);
  const target = targets.find((item) => item.targetId === targetId);
  if (!target) {
    return { available: false, reason: "Target not found.", targetId, targets };
  }
  const selected = { ...target, selected: true, stale: false };
  await deps.updateSessionRecord(args.stateRoot, {
    ...session,
    activeTargetId: selected.targetId,
    updatedAt: (args.now ?? (() => /* @__PURE__ */ new Date()))().toISOString()
  });
  await deps.writePersistedTarget(args.stateRoot, session.sessionId, selected);
  return selected;
}
async function getCurrentTarget(args, deps = defaultTargetDependencies) {
  const session = await deps.readLatestSession(args.stateRoot);
  if (!session) {
    return { available: false, reason: "No session exists. Run `expo-ios --json session new review` first." };
  }
  if (!session.activeTargetId) {
    return {
      available: false,
      reason: "No target selected for the current session.",
      sessionId: session.sessionId
    };
  }
  const targets = await discoverTargets({ ...args, selectedTargetId: session.activeTargetId }, deps);
  const current = targets.find((item) => item.targetId === session.activeTargetId);
  if (current) {
    return {
      available: true,
      sessionId: session.sessionId,
      target: { ...current, selected: true, stale: false }
    };
  }
  const persisted = await deps.readPersistedTarget(args.stateRoot, session.sessionId).catch(() => null);
  return {
    available: false,
    reason: "Selected target is stale.",
    sessionId: session.sessionId,
    target: persisted ? { ...persisted, selected: true, stale: true } : { targetId: session.activeTargetId, selected: true, stale: true }
  };
}
async function targetCommand(args, deps = defaultTargetDependencies) {
  const effectiveArgs = { ...args, stateRoot: args.stateRoot ?? resolveExpoStateRoot2(args) };
  const action = requireString2(args.action ?? "list", "action");
  if (!["list", "select", "current"].includes(action)) {
    throw new Error(`Unknown target action: ${action}`);
  }
  if (action === "list") {
    return listTargets(effectiveArgs, deps);
  }
  if (action === "select") {
    return selectTarget(effectiveArgs, deps);
  }
  return getCurrentTarget(effectiveArgs, deps);
}
var defaultTargetDependencies = {
  readLatestSession: async (stateRoot) => {
    const sessionsRoot = join5(stateRoot, "sessions");
    const entries = await readdir2(sessionsRoot, { withFileTypes: true }).catch(() => []);
    const sessions = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const record = await readJson(join5(sessionsRoot, entry.name, "session.json")).catch(() => null);
      if (record) sessions.push(record);
    }
    sessions.sort((left, right) => String(right.updatedAt ?? right.createdAt).localeCompare(String(left.updatedAt ?? left.createdAt)));
    return sessions[0] ?? null;
  },
  updateSessionRecord: async (stateRoot, record) => {
    await mkdir5(sessionDirectory(stateRoot, record.sessionId), { recursive: true });
    await writeJson(sessionJsonPath(stateRoot, record.sessionId), record);
    return record;
  },
  readPersistedTarget: async (stateRoot, sessionId) => {
    return readJson(join5(sessionDirectory(stateRoot, sessionId), "target.json")).catch(() => null);
  },
  writePersistedTarget: async (stateRoot, sessionId, target) => {
    await mkdir5(sessionDirectory(stateRoot, sessionId), { recursive: true });
    await writeJson(join5(sessionDirectory(stateRoot, sessionId), "target.json"), target);
  },
  listIosSimulatorTargets: async () => {
    const result = await execFile2("xcrun", ["simctl", "list", "devices", "available", "--json"], { timeout: 2e4 });
    const parsed = JSON.parse(result.stdout || "{}");
    return normalizeSimulatorDevices(Object.values(parsed.devices ?? {}).flat());
  },
  fetchMetroTargets: async (port) => {
    const response = await fetch(`http://localhost:${port}/json/list`);
    if (!response.ok) return [];
    return response.json();
  }
};
async function execFile2(file, args, options) {
  return new Promise((resolve15, reject) => {
    nodeExecFile2(file, args, { timeout: options.timeout, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        Object.assign(error, { stdout, stderr });
        reject(error);
        return;
      }
      resolve15({ stdout: String(stdout ?? ""), stderr: String(stderr ?? "") });
    });
  });
}
async function readJson(file) {
  return JSON.parse(await readFile3(file, "utf8"));
}
async function writeJson(file, value) {
  await writeFile2(file, `${JSON.stringify(value, null, 2)}
`, "utf8");
}

// src/modules/snapshot-evidence/src/main/filters.ts
function buildSnapshotFilters(args = {}) {
  return {
    interactiveOnly: args.interactive === true,
    compact: args.compact === true,
    depth: args.depth === void 0 ? null : clampNumber4(args.depth, 1, 100),
    includeSource: args.source === true,
    includeBounds: args.bounds === true
  };
}
function clampNumber4(value, min, max) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) {
    throw new Error(`Expected a finite number, got ${value}.`);
  }
  return Math.max(min, Math.min(max, numberValue));
}

// src/modules/snapshot-evidence/src/main/ids.ts
function createSnapshotId(now4, randomSuffix) {
  const timestamp = now4.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z").replace("T", "-").toLowerCase();
  return `snapshot-${timestamp}-${randomSuffix}`;
}

// src/modules/snapshot-evidence/src/main/accessibility.ts
function flattenAccessibilityNodes(tree, filters) {
  const roots = Array.isArray(tree) ? tree : [tree];
  const nodes = [];
  const visit = (node, depth) => {
    if (!isRecord3(node)) {
      return;
    }
    if (filters.depth !== null && depth > filters.depth) {
      return;
    }
    const normalized = normalizeAccessibilityNode(node);
    if ((!filters.interactiveOnly || normalized.actions.length > 0) && (!filters.compact || normalized.label || normalized.text || normalized.actions.length > 0)) {
      nodes.push(normalized);
    }
    const children = Array.isArray(node.children) ? node.children : [];
    for (const child of children) {
      visit(child, depth + 1);
    }
  };
  for (const root of roots) {
    visit(root, 0);
  }
  return nodes;
}
function normalizeAccessibilityRole(role) {
  const text = String(role ?? "").replace(/^AX/, "").toLowerCase();
  if (text === "statictext") return "text";
  if (text === "button") return "button";
  if (text === "textfield" || text === "textbox") return "textbox";
  if (text === "switch") return "switch";
  if (text === "link") return "link";
  return text || null;
}
function normalizeFrame(frame) {
  if (!isRecord3(frame)) {
    return null;
  }
  const x = Number(frame.x ?? frame.left);
  const y = Number(frame.y ?? frame.top);
  const width = Number(frame.width);
  const height = Number(frame.height);
  if (![x, y, width, height].every(Number.isFinite)) {
    return null;
  }
  return { x, y, width, height };
}
function actionsForAccessibilityRole(role) {
  if (role === "button" || role === "link") return ["tap", "inspect"];
  if (role === "textbox") return ["tap", "fill", "focus", "inspect"];
  if (role === "switch") return ["tap", "inspect"];
  return [];
}
function normalizeSource(source2) {
  if (!isRecord3(source2)) {
    return null;
  }
  const line = Number(source2.line ?? source2.lineNumber);
  const column = Number(source2.column ?? source2.columnNumber);
  return {
    file: stringOrNull2(source2.file ?? source2.fileName),
    line: Number.isFinite(line) ? line : null,
    column: Number.isFinite(column) ? column : null
  };
}
function refRecordFromNode(node, index, snapshotId, targetId, filters) {
  return {
    ref: `@e${index}`,
    snapshotId,
    targetId,
    stale: false,
    role: node.role,
    label: node.label,
    text: node.text,
    placeholder: node.placeholder,
    testID: node.testID,
    nativeID: node.nativeID,
    component: node.component,
    source: filters.includeSource ? normalizeSource(node.source) : null,
    box: filters.includeBounds ? node.box : null,
    actions: node.actions
  };
}
function snapshotNodeFromAccessibility(node, ref, filters) {
  return {
    ref,
    role: node.role,
    label: node.label,
    text: node.text,
    testID: node.testID,
    source: filters.includeSource ? normalizeSource(node.source) : null,
    box: filters.includeBounds ? node.box : null,
    actions: node.actions
  };
}
function normalizeAccessibilityNode(node) {
  const role = normalizeAccessibilityRole(node.role_description ?? node.role ?? node.type ?? null);
  const label = nullableField(node.AXLabel ?? node.label ?? node.title);
  return {
    role,
    label,
    text: nullableField(node.AXValue ?? node.value ?? (role === "text" ? label : null)),
    placeholder: nullableField(node.placeholder),
    testID: nullableField(node.testID ?? node.testId ?? node.nativeID),
    nativeID: nullableField(node.nativeID),
    component: nullableField(node.component ?? node.name),
    source: node.source ?? null,
    box: normalizeFrame(node.frame),
    actions: actionsForAccessibilityRole(role),
    raw: node
  };
}
function isRecord3(value) {
  return Boolean(value) && typeof value === "object";
}
function nullableField(value) {
  return value === void 0 || value === null ? null : String(value);
}
function stringOrNull2(value) {
  return value === void 0 || value === null ? null : String(value);
}

// src/modules/snapshot-evidence/src/main/persistence.ts
var NATIVE_LIMITATIONS = [
  "Native accessibility snapshots expose semantic UI where available; React component props and private fiber details are not included."
];
async function persistNativeSnapshot(input, deps) {
  const snapshotId = createSnapshotId(deps.now(), deps.randomSuffix());
  const targetId = input.session.activeTargetId ?? "";
  const nodes = flattenAccessibilityNodes(input.accessibilityTree, input.filters);
  const refs = nodes.map((node, index) => refRecordFromNode(node, index + 1, snapshotId, targetId, input.filters));
  const snapshotPath = snapshotJsonPath(input.stateRoot, input.session.sessionId, snapshotId);
  const generatedAt = deps.now().toISOString();
  const snapshot = {
    snapshotId,
    targetId,
    routeHint: null,
    source: ["native-accessibility"],
    semanticBridge: input.semanticBridge,
    generatedAt,
    filters: input.filters,
    refs,
    tree: nodes.map((node, index) => snapshotNodeFromAccessibility(node, `@e${index + 1}`, input.filters)),
    artifacts: {
      json: snapshotPath,
      screenshot: null,
      annotatedScreenshot: null
    },
    limitations: NATIVE_LIMITATIONS
  };
  await persistSnapshotArtifacts(input.stateRoot, input.session, snapshot, input.semanticBridge, deps);
  return snapshot;
}
async function persistSemanticSnapshot(input, deps) {
  const snapshotId = createSnapshotId(deps.now(), deps.randomSuffix());
  const targetId = input.session.activeTargetId ?? "";
  const refs = input.semanticBridge.refs.map((record, index) => ({
    ...record,
    ref: `@e${index + 1}`,
    snapshotId,
    targetId,
    stale: false,
    role: record.role ?? null,
    label: record.label ?? null,
    text: record.text ?? null,
    placeholder: record.placeholder ?? null,
    testID: record.testID ?? null,
    nativeID: record.nativeID ?? null,
    component: record.component ?? null,
    source: record.source ?? null,
    box: record.box ?? null,
    actions: record.actions ?? []
  }));
  const snapshotPath = snapshotJsonPath(input.stateRoot, input.session.sessionId, snapshotId);
  const generatedAt = deps.now().toISOString();
  const snapshot = {
    snapshotId,
    targetId,
    routeHint: input.semanticBridge.routeHint,
    source: [input.semanticBridge.source],
    semanticBridge: input.semanticBridge,
    generatedAt,
    filters: input.filters,
    refs,
    tree: refs.map((record) => ({
      ref: record.ref,
      role: record.role,
      label: record.label,
      text: record.text,
      testID: record.testID,
      source: input.filters.includeSource ? record.source : null,
      box: input.filters.includeBounds ? record.box : null,
      actions: record.actions
    })),
    artifacts: {
      json: snapshotPath,
      screenshot: null,
      annotatedScreenshot: null
    },
    limitations: input.semanticBridge.limitations
  };
  await persistSnapshotArtifacts(input.stateRoot, input.session, snapshot, input.semanticBridge, deps);
  return snapshot;
}
function snapshotDirectory(stateRoot, sessionId) {
  return `${stateRoot}/sessions/${sessionId}/snapshots`;
}
function snapshotJsonPath(stateRoot, sessionId, snapshotId) {
  return `${snapshotDirectory(stateRoot, sessionId)}/${snapshotId}.json`;
}
async function persistSnapshotArtifacts(stateRoot, session, snapshot, semanticBridge, deps) {
  await deps.ensureDirectory(snapshotDirectory(stateRoot, session.sessionId));
  await deps.writeJsonFile(snapshot.artifacts.json, snapshot);
  await deps.writeJsonFile(`${stateRoot}/sessions/${session.sessionId}/refs.json`, {
    snapshotId: snapshot.snapshotId,
    targetId: snapshot.targetId,
    source: snapshot.source,
    semanticBridge,
    refs: snapshot.refs
  });
  await deps.updateSessionRecord(stateRoot, {
    ...session,
    lastSnapshotId: snapshot.snapshotId,
    updatedAt: snapshot.generatedAt
  });
}

// src/modules/snapshot-evidence/src/main/ref-commands.ts
import { readdir as readdir3, readFile as readFile4 } from "node:fs/promises";
import { join as join6 } from "node:path";
async function refsCommand(args = {}, deps = defaultRefCommandDependencies) {
  const cache = await readLatestRefCache(resolveStateRoot(args), deps);
  if (!cache) {
    return { available: false, reason: "No snapshot exists for the current session." };
  }
  return { available: true, ...cache };
}
async function getRefCommand(args, deps = defaultRefCommandDependencies) {
  const field = requireString3(args.field, "field");
  const ref = requireString3(args.ref, "ref");
  if (!/^@e\d+$/.test(ref)) {
    return { available: false, reason: "Ref must look like @e1.", ref };
  }
  const cache = await readLatestRefCache(resolveStateRoot(args), deps);
  if (!cache) {
    return { available: false, reason: "No snapshot exists for the current session." };
  }
  const record = cache.refs.find((item) => item.ref === ref);
  if (!record) {
    return { available: false, reason: "Ref not found in the latest snapshot.", ref };
  }
  return {
    ref,
    field,
    stale: record.stale,
    value: refFieldValue(record, field)
  };
}
var defaultRefCommandDependencies = {
  readLatestSession: async (stateRoot) => {
    const sessionsRoot = join6(stateRoot, "sessions");
    const entries = await readdir3(sessionsRoot, { withFileTypes: true }).catch(() => []);
    const sessions = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const record = await readJson2(join6(sessionsRoot, entry.name, "session.json")).catch(() => null);
      if (record) sessions.push(record);
    }
    sessions.sort((left, right) => String(right.updatedAt ?? right.createdAt).localeCompare(String(left.updatedAt ?? left.createdAt)));
    return sessions[0] ?? null;
  },
  readJsonFile: readJson2
};
function resolveStateRoot(args) {
  return args.stateRoot ?? resolveExpoStateRoot2(args);
}
async function readJson2(file) {
  return JSON.parse(await readFile4(file, "utf8"));
}
function refFieldValue(record, field) {
  switch (field) {
    case "text":
      return record.text ?? record.label ?? null;
    case "props":
      return {
        role: record.role,
        label: record.label,
        placeholder: record.placeholder,
        testID: record.testID,
        nativeID: record.nativeID,
        component: record.component,
        actions: record.actions
      };
    case "box":
      return record.box;
    case "style":
      return null;
    case "source":
      return record.source;
    default:
      throw new Error(`Unknown ref field: ${field}`);
  }
}
async function readLatestRefCache(stateRoot, deps) {
  const session = await deps.readLatestSession(stateRoot);
  if (!session?.lastSnapshotId) {
    return null;
  }
  try {
    return await deps.readJsonFile(`${stateRoot}/sessions/${session.sessionId}/refs.json`);
  } catch {
    return null;
  }
}
function requireString3(value, name) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${name} is required.`);
  }
  return value.trim();
}

// src/modules/snapshot-evidence/src/main/snapshot-command.ts
import { execFile as nodeExecFile3 } from "node:child_process";
import { mkdir as mkdir6, readdir as readdir4, readFile as readFile5, writeFile as writeFile3 } from "node:fs/promises";
import { join as join7 } from "node:path";

// src/modules/hermes-cdp-client/src/main/index.ts
import WebSocket2 from "ws";
async function evaluateHermesExpression(webSocketDebuggerUrl, expression, options) {
  return cdpCall(webSocketDebuggerUrl, [
    { method: "Runtime.enable", params: {} },
    { method: "Runtime.evaluate", params: { expression, returnByValue: true, awaitPromise: true } }
  ], options.timeoutMs);
}
async function cdpCall(webSocketDebuggerUrl, calls, timeoutMs) {
  const candidates = loopbackWebSocketCandidates(webSocketDebuggerUrl);
  const errors = [];
  for (const candidate of candidates) {
    const origin = metroOriginForWebSocket(candidate);
    const ws = new WebSocket2(candidate, { headers: { Origin: origin } });
    try {
      await waitForOpen(ws, Math.min(timeoutMs, 2500));
      let id = 0;
      let last = null;
      for (const call of calls) {
        id += 1;
        ws.send(JSON.stringify({ id, method: call.method, params: call.params }));
        last = await waitForMessage(ws, id, timeoutMs);
      }
      const cdpError = last && typeof last.error === "string" ? last.error : null;
      return {
        ...last ?? {},
        ...cdpError ? { error: cdpError } : {},
        cdp: last,
        diagnostics: {
          webSocketDebuggerUrl,
          connectedUrl: candidate,
          origin,
          attempts: candidates.length
        }
      };
    } catch (error) {
      errors.push(`${candidate}: ${formatError6(error)}`);
      try {
        ws.close();
      } catch {
      }
    } finally {
      try {
        ws.close();
      } catch {
      }
    }
  }
  return {
    error: errors.length > 0 ? errors.join("; ") : "Hermes websocket connection failed.",
    diagnostics: {
      webSocketDebuggerUrl,
      attemptedUrls: candidates
    }
  };
}
function loopbackWebSocketCandidates(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return [url];
  }
  const candidates = [];
  const add = (candidate) => {
    if (!candidates.includes(candidate)) candidates.push(candidate);
  };
  add(parsed.toString());
  const loopbackHosts = /* @__PURE__ */ new Set(["localhost", "127.0.0.1", "::1", "[::1]", "0.0.0.0"]);
  if (loopbackHosts.has(parsed.hostname)) {
    for (const host of ["127.0.0.1", "localhost", "[::1]"]) {
      const candidate = new URL(parsed.toString());
      candidate.hostname = host;
      add(candidate.toString());
    }
  }
  return candidates;
}
function metroOriginForWebSocket(url) {
  try {
    const parsed = new URL(url);
    const port = parsed.port ? `:${parsed.port}` : "";
    return `http://127.0.0.1${port}`;
  } catch {
    return "http://127.0.0.1";
  }
}
function waitForOpen(ws, timeoutMs) {
  return new Promise((resolve15, reject) => {
    const timer = setTimeout(() => reject(new Error("Timed out opening WebSocket.")), timeoutMs);
    ws.once("open", () => {
      clearTimeout(timer);
      resolve15();
    });
    ws.once("error", (error) => {
      clearTimeout(timer);
      reject(error instanceof Error ? error : new Error("WebSocket connection failed."));
    });
  });
}
function waitForMessage(ws, id, timeoutMs) {
  return new Promise((resolve15, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("Timed out waiting for CDP response."));
    }, timeoutMs);
    const onMessage = (data) => {
      let parsed;
      try {
        parsed = JSON.parse(data.toString());
      } catch {
        return;
      }
      if (!isRecord4(parsed) || parsed.id !== id) return;
      cleanup();
      resolve15(parsed.error ? { error: parsed.error } : parsed);
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      clearTimeout(timer);
      ws.off("message", onMessage);
      ws.off("error", onError);
    };
    ws.on("message", onMessage);
    ws.once("error", onError);
  });
}
function isRecord4(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function formatError6(error) {
  const record = isRecord4(error) ? error : null;
  return typeof record?.message === "string" ? record.message : String(error);
}

// src/modules/metro-probes/src/main/index.ts
import { promises as fs3 } from "node:fs";
import path3 from "node:path";
var LIMITATIONS = [
  "This command probes existing Metro HTTP endpoints only and never starts Metro implicitly.",
  "Connected targets can be stale when multiple apps or devices are attached."
];
var MAX_OUTPUT4 = 16384;
function toolJson6(value) {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}
function clampNumber5(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new Error(`Expected a finite number, got ${String(value)}.`);
  }
  return Math.min(Math.max(number, min), max);
}
function formatError7(error) {
  if (!error) return "Unknown error";
  const record = asRecord2(error);
  const message = record ? record.message : void 0;
  const parts = [message == null ? String(error) : String(message)];
  if (record?.stdout) parts.push(`stdout:
${truncate5(record.stdout)}`);
  if (record?.stderr) parts.push(`stderr:
${truncate5(record.stderr)}`);
  return parts.join("\n\n");
}
function targetSummary(target) {
  if (!target) return null;
  return {
    id: target.id ?? null,
    title: target.title ?? null,
    description: target.description ?? null,
    appId: target.appId ?? null,
    deviceName: target.deviceName ?? null,
    devtoolsFrontendUrl: target.devtoolsFrontendUrl ?? null,
    webSocketDebuggerUrl: target.webSocketDebuggerUrl ?? null,
    reactNative: target.reactNative ?? null,
    capabilities: target.capabilities ?? {
      hermesRuntime: typeof target.webSocketDebuggerUrl === "string" && target.webSocketDebuggerUrl.startsWith("ws"),
      devtoolsFrontend: typeof target.devtoolsFrontendUrl === "string" && target.devtoolsFrontendUrl.length > 0,
      reactNative: Boolean(target.reactNative)
    }
  };
}
async function metroCommand(args = {}, deps = {}) {
  const action = requireString4(args.action ?? "status", "action");
  if (action === "reload") return toolJson6(await (deps.metroReloadPayload ?? ((nextArgs) => metroReloadPayload(nextArgs, deps)))(args));
  if (action === "symbolicate") {
    return toolJson6(await (deps.metroSymbolicatePayload ?? ((nextArgs) => metroSymbolicatePayload(nextArgs, deps)))(args));
  }
  if (action !== "status") throw new Error(`Unknown metro action: ${action}`);
  return toolJson6(await (deps.metroStatusPayload ?? ((nextArgs) => metroStatusPayload(nextArgs, deps)))(args));
}
async function metroStatusPayload(args = {}, deps = {}) {
  const metroPort = clampNumber5(args.metroPort ?? 8081, 1, 65535);
  return new MetroInspectorClient(metroPort, deps).statusPayload();
}
async function metroTargets(metroPort, deps = {}) {
  const result = await new MetroInspectorClient(metroPort, deps).targets();
  return result.targets;
}
var MetroInspectorClient = class {
  constructor(metroPort, deps = {}) {
    this.metroPort = metroPort;
    this.baseUrl = `http://127.0.0.1:${metroPort}`;
    this.fetchLocalText = deps.fetchLocalText ?? defaultFetchLocalText;
    this.fetchLocalJson = deps.fetchLocalJson ?? defaultFetchLocalJson;
    this.fetchLocalLoopback = deps.fetchLocalLoopback ?? defaultFetchLocalLoopback;
  }
  baseUrl;
  fetchLocalText;
  fetchLocalJson;
  fetchLocalLoopback;
  async status() {
    try {
      const text = await this.fetchLocalText(`${this.baseUrl}/status`, { timeoutMs: 1500 });
      return { available: true, endpoint: "/status", text, error: null };
    } catch (error) {
      return { available: false, endpoint: "/status", text: null, error: formatError7(error) };
    }
  }
  async version() {
    try {
      const value = await this.fetchLocalJson(`${this.baseUrl}/json/version`, { timeoutMs: 1500 });
      return { available: true, endpoint: "/json/version", value, error: null };
    } catch (error) {
      return { available: false, endpoint: "/json/version", value: null, error: formatError7(error) };
    }
  }
  async targets() {
    let raw;
    try {
      raw = await this.fetchLocalJson(`${this.baseUrl}/json/list`, { timeoutMs: 2500 });
    } catch (error) {
      return {
        available: false,
        endpoint: "/json/list",
        targets: [],
        malformedTargets: [],
        reason: formatError7(error)
      };
    }
    if (!Array.isArray(raw)) {
      return {
        available: false,
        endpoint: "/json/list",
        targets: [],
        malformedTargets: [{ index: null, reason: "Metro target list was not an array.", shape: responseShape(raw) }],
        reason: "Metro target list was malformed."
      };
    }
    const targets = [];
    const malformedTargets = [];
    raw.forEach((target, index) => {
      const normalized = this.normalizeTarget(target, index);
      if (normalized.target) targets.push(normalized.target);
      if (normalized.error) malformedTargets.push(normalized.error);
    });
    return {
      available: true,
      endpoint: "/json/list",
      targets,
      malformedTargets,
      reason: malformedTargets.length > 0 ? "Some Metro targets were malformed and skipped." : null
    };
  }
  normalizeTarget(target, index = 0) {
    const record = asRecord2(target);
    if (!record || Array.isArray(target)) {
      return { target: null, error: { index, reason: "Target was not an object.", shape: responseShape(target) } };
    }
    const normalized = {
      id: optionalString2(record.id),
      title: optionalString2(record.title),
      description: optionalString2(record.description),
      appId: optionalString2(record.appId),
      deviceName: optionalString2(record.deviceName),
      devtoolsFrontendUrl: optionalString2(record.devtoolsFrontendUrl),
      webSocketDebuggerUrl: optionalString2(record.webSocketDebuggerUrl),
      reactNative: record.reactNative && typeof record.reactNative === "object" ? record.reactNative : null,
      capabilities: {
        hermesRuntime: typeof record.webSocketDebuggerUrl === "string" && record.webSocketDebuggerUrl.startsWith("ws"),
        devtoolsFrontend: typeof record.devtoolsFrontendUrl === "string" && record.devtoolsFrontendUrl.length > 0,
        reactNative: Boolean(record.reactNative)
      }
    };
    if (!normalized.id && !normalized.title && !normalized.webSocketDebuggerUrl && !normalized.devtoolsFrontendUrl) {
      return {
        target: null,
        error: {
          index,
          reason: "Target did not include any stable identifying metadata.",
          shape: responseShape(target)
        }
      };
    }
    return { target: normalized, error: null };
  }
  async symbolicate(stack) {
    try {
      const response = await this.fetchLocalLoopback(`${this.baseUrl}/symbolicate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ stack }),
        timeoutMs: 1500
      });
      const value = response.ok ? await response.json().catch(() => null) : null;
      return {
        available: response.ok,
        endpoint: "/symbolicate",
        status: response.status,
        reason: response.ok ? null : `Metro symbolicate HTTP ${response.status}`,
        value
      };
    } catch (error) {
      return {
        available: false,
        endpoint: "/symbolicate",
        status: null,
        reason: formatError7(error),
        value: null
      };
    }
  }
  async probeSymbolication() {
    const result = await this.symbolicate([]);
    return {
      available: result.available,
      endpoint: "/symbolicate",
      status: result.status,
      reason: result.reason
    };
  }
  async statusPayload() {
    const statusResult = await this.status();
    const targetsResult = statusResult.available ? await this.targets() : {
      available: false,
      endpoint: "/json/list",
      targets: [],
      malformedTargets: [],
      reason: "Metro is unavailable."
    };
    const versionResult = statusResult.available ? await this.version() : { available: false, endpoint: "/json/version", value: null, error: "Metro is unavailable." };
    const symbolication = statusResult.available ? await this.probeSymbolication() : { available: false, reason: "Metro is unavailable.", endpoint: "/symbolicate" };
    return {
      available: statusResult.available,
      reason: statusResult.available ? null : "Metro is not reachable on the requested port.",
      metroPort: this.metroPort,
      status: statusResult.available ? "available" : "unavailable",
      statusText: statusResult.text,
      error: statusResult.error ?? null,
      version: versionResult.value,
      versionError: versionResult.error ?? null,
      targetCount: targetsResult.targets.length,
      targets: targetsResult.targets.map(targetSummary),
      targetDiscovery: {
        endpoint: "/json/list",
        available: targetsResult.available,
        reason: targetsResult.reason,
        malformedTargets: targetsResult.malformedTargets
      },
      symbolication,
      limitations: LIMITATIONS
    };
  }
};
function optionalString2(value) {
  return typeof value === "string" && value.length > 0 ? value : null;
}
function requireString4(value, field) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${field} must be a non-empty string.`);
  }
  return value.trim();
}
function responseShape(value) {
  if (value == null) return null;
  if (Array.isArray(value)) return { type: "array", length: value.length };
  if (typeof value !== "object") return { type: typeof value };
  const record = value;
  const shape = { type: "object", keys: Object.keys(record).slice(0, 20) };
  if (typeof record.type === "string") shape.resultType = record.type;
  if (record.result && typeof record.result === "object") shape.result = responseShape(record.result);
  return shape;
}
function truncate5(value, limit = MAX_OUTPUT4) {
  const text = String(value ?? "");
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}
[truncated ${text.length - limit} characters]`;
}
function asRecord2(value) {
  return value && typeof value === "object" ? value : null;
}
async function metroReloadPayload(args, deps = {}) {
  const metroPort = clampNumber5(args.metroPort ?? 8081, 1, 65535);
  const targets = await metroTargets(metroPort, deps);
  const webSocketDebuggerUrl = targets[0]?.webSocketDebuggerUrl ?? null;
  if (!webSocketDebuggerUrl) {
    return { available: false, action: "reload", reason: "No Metro inspector target.", metroPort };
  }
  const evaluate = deps.evaluateHermesExpression ?? evaluateHermesExpression;
  const result = await evaluate(webSocketDebuggerUrl, `(() => {
    const devSettings = globalThis.NativeModules?.DevSettings || globalThis.__fbBatchedBridgeConfig?.remoteModuleConfig?.DevSettings;
    if (globalThis.location && typeof globalThis.location.reload === 'function') { globalThis.location.reload(); return { available: true, strategy: 'location.reload' }; }
    if (devSettings && typeof devSettings.reload === 'function') { devSettings.reload(); return { available: true, strategy: 'DevSettings.reload' }; }
    return { available: false, reason: 'No runtime reload hook was available.' };
  })()`, { timeoutMs: 3e3 });
  const value = result.result?.result?.value;
  return {
    ...isPlainObject(value) ? value : { available: false, reason: result.error ?? "Runtime reload did not return a value." },
    action: "reload",
    metroPort,
    target: targetSummary(targets[0])
  };
}
async function metroSymbolicatePayload(args, deps = {}) {
  const stackFile = requireString4(args.stackFile ?? positionalArg(args._, 0) ?? args.file, "stackFile");
  const resolvePath2 = deps.resolvePath ?? path3.resolve;
  const readTextFile = deps.readTextFile ?? fs3.readFile;
  const resolvedStackFile = resolvePath2(stackFile);
  const stack = parseComponentStackFrames(await readTextFile(resolvedStackFile, "utf8"));
  const metroPort = clampNumber5(args.metroPort ?? 8081, 1, 65535);
  const result = await postMetroSymbolicate(metroPort, stack, deps);
  return { available: true, action: "symbolicate", metroPort, stackFile: resolvedStackFile, frameCount: stack.length, result };
}
function parseComponentStackFrames(stack) {
  const frames = [];
  for (const line of String(stack).split("\n")) {
    const match = /^\s*at\s+(.*?)\s+\((http.*):(\d+):(\d+)\)$/.exec(line);
    if (!match) continue;
    frames.push({
      methodName: match[1]?.trim() || "<anonymous>",
      file: match[2] ?? "",
      lineNumber: Number(match[3]),
      column: Number(match[4])
    });
  }
  return frames;
}
async function postMetroSymbolicate(metroPort, stack, deps = {}) {
  const result = await new MetroInspectorClient(metroPort, deps).symbolicate(stack);
  if (!result.available) throw new Error(result.reason ?? "Metro symbolication failed.");
  return result.value;
}
function positionalArg(value, index) {
  return Array.isArray(value) ? value[index] : void 0;
}
function isPlainObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}
async function defaultFetchLocalText(url, options) {
  const response = await defaultFetchLocalLoopback(url, options);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}
async function defaultFetchLocalJson(url, options) {
  return JSON.parse(await defaultFetchLocalText(url, options));
}
async function defaultFetchLocalLoopback(url, options = {}) {
  const timeoutMs = options.timeoutMs ?? 1500;
  const { timeoutMs: _timeoutMs, ...request } = options;
  const candidates = loopbackUrlCandidates(url);
  let lastError = null;
  for (const candidate of candidates) {
    try {
      return await fetchWithTimeout(candidate, timeoutMs, request);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError ?? new Error("Local fetch failed");
}
function loopbackUrlCandidates(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return [url];
  }
  if (!["127.0.0.1", "localhost", "[::1]", "::1"].includes(parsed.hostname)) return [url];
  const candidates = [];
  for (const host of ["127.0.0.1", "localhost", "[::1]"]) {
    const candidate = new URL(url);
    candidate.host = `${host}${parsed.port ? `:${parsed.port}` : ""}`;
    if (!candidates.includes(candidate.toString())) candidates.push(candidate.toString());
  }
  return candidates;
}
async function fetchWithTimeout(url, timeoutMs, init) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

// src/modules/snapshot-evidence/src/main/snapshot-command.ts
async function snapshotCommand(args = {}, deps = defaultSnapshotDependencies) {
  const stateRoot = args.stateRoot ?? resolveExpoStateRoot2(args);
  const session = await deps.readLatestSession(stateRoot);
  if (!session) {
    return {
      available: false,
      reason: "No session exists. Run `expo-ios --json session new review` first."
    };
  }
  if (!session.activeTargetId) {
    return {
      available: false,
      reason: "No target selected for the current session.",
      sessionId: session.sessionId
    };
  }
  const target = await deps.readSelectedTarget(stateRoot, session);
  if (!target?.device?.id) {
    return {
      available: false,
      reason: "Selected target metadata is missing.",
      targetId: session.activeTargetId
    };
  }
  const filters = buildSnapshotFilters(args);
  const semanticBridge = await deps.captureSemanticBridge(args, { stateRoot, session, filters }).catch((error) => ({
    available: false,
    source: "plugin-bridge-semantic",
    code: "transport-failure",
    reason: formatError8(error)
  }));
  if (semanticBridge.available === true) {
    return persistSemanticSnapshot({ stateRoot, session, filters, semanticBridge }, deps);
  }
  const axe = await deps.findAxeCli();
  if (!axe) {
    return {
      available: false,
      reason: "axe CLI is not installed or not on PATH.",
      targetId: session.activeTargetId,
      semanticBridge
    };
  }
  const result = await deps.describeNativeUi(axe, target.device.id);
  if (result.error) {
    return {
      available: false,
      reason: "Native accessibility snapshot failed.",
      targetId: session.activeTargetId,
      stderr: truncate6(result.stderr),
      error: result.error,
      semanticBridge
    };
  }
  return persistNativeSnapshot({
    stateRoot,
    session,
    filters,
    semanticBridge,
    accessibilityTree: JSON.parse(result.stdout || "[]")
  }, deps);
}
var defaultSnapshotDependencies = {
  now: () => /* @__PURE__ */ new Date(),
  randomSuffix: randomBase36Suffix,
  ensureDirectory: (path12) => mkdir6(path12, { recursive: true }),
  writeJsonFile: writeJson2,
  updateSessionRecord: async (stateRoot, record) => {
    await mkdir6(sessionDirectory(stateRoot, record.sessionId), { recursive: true });
    await writeJson2(sessionJsonPath(stateRoot, record.sessionId), record);
    return record;
  },
  readLatestSession: async (stateRoot) => {
    const sessionsRoot = join7(stateRoot, "sessions");
    const entries = await readdir4(sessionsRoot, { withFileTypes: true }).catch(() => []);
    const sessions = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const record = await readJson3(join7(sessionsRoot, entry.name, "session.json")).catch(() => null);
      if (record) sessions.push(record);
    }
    sessions.sort((left, right) => String(right.updatedAt ?? right.createdAt).localeCompare(String(left.updatedAt ?? left.createdAt)));
    return sessions[0] ?? null;
  },
  readSelectedTarget: async (stateRoot, session) => {
    return readJson3(join7(sessionDirectory(stateRoot, session.sessionId), "target.json")).catch(() => null);
  },
  captureSemanticBridge,
  findAxeCli: () => commandPath2("axe"),
  describeNativeUi: (axePath, deviceId) => execFile3(axePath, ["describe-ui", "--udid", deviceId], { timeout: 12e3 })
};
async function captureSemanticBridge(args, context) {
  const metroPort = clampNumber6(args.metroPort ?? 8081, 1, 65535);
  const targets = await metroTargets(metroPort);
  const target = targets.find((item) => item.webSocketDebuggerUrl) ?? targets[0] ?? null;
  const webSocketDebuggerUrl = target?.webSocketDebuggerUrl ?? null;
  if (!webSocketDebuggerUrl) {
    return {
      available: false,
      source: "plugin-bridge-semantic",
      code: "no-runtime-target",
      reason: "No Metro inspector target.",
      metroPort,
      target
    };
  }
  const result = await evaluateHermesExpression(webSocketDebuggerUrl, semanticBridgeExpression(context.filters), { timeoutMs: 5e3 });
  const value = result.result?.result?.value;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      available: false,
      source: "plugin-bridge-semantic",
      code: "transport-failure",
      reason: result.error ?? "Hermes runtime did not return semantic bridge data.",
      metroPort,
      target,
      transport: result.diagnostics ?? result.cdp ?? null
    };
  }
  const normalized = normalizeSemanticBridgeSnapshot(value, context.filters);
  if (!normalized.refs.length) {
    return {
      available: false,
      source: normalized.source,
      code: "app-bridge-unavailable",
      reason: normalized.reason ?? "No semantic or React Native bridge data is installed in the app runtime.",
      metroPort,
      target,
      transport: result.diagnostics ?? result.cdp ?? null,
      raw: value
    };
  }
  return {
    available: true,
    source: normalized.source,
    bridgeVersion: normalized.bridgeVersion,
    routeHint: normalized.routeHint,
    refs: normalized.refs,
    rawCount: normalized.rawCount,
    metroPort,
    transport: result.diagnostics ?? result.cdp ?? null,
    limitations: normalized.limitations
  };
}
function semanticBridgeExpression(filters) {
  return `(() => {
    const filters = ${JSON.stringify(filters)};
    const callBridge = (candidate, source) => {
      if (!candidate) return null;
      let payload = candidate;
      if (typeof candidate === 'function') payload = candidate({ filters });
      else if (candidate.snapshot && typeof candidate.snapshot === 'function') payload = candidate.snapshot({ filters });
      else if (candidate.tree && typeof candidate.tree === 'function') payload = candidate.tree({ filters });
      else if (candidate.refs && typeof candidate.refs === 'function') payload = candidate.refs({ filters });
      if (!payload) return null;
      if (typeof payload === 'object' && typeof payload.then === 'function') {
        return { available: false, source, reason: 'Bridge probe returned an async value; expose a synchronous snapshot/tree method for CLI capture.' };
      }
      if (Array.isArray(payload)) return { available: true, source, refs: payload };
      if (typeof payload === 'object') return { available: payload.available !== false, source: payload.source || source, ...payload };
      return null;
    };
    const instrumentation = globalThis.__EXPO_IOS_INSTRUMENTATION__ || {};
    const probes = [
      ['plugin-bridge-semantic', globalThis.__EXPO_IOS_SEMANTIC_BRIDGE__],
      ['app-instrumentation', instrumentation.semantic],
      ['app-instrumentation', instrumentation.snapshot],
      ['app-rn-bridge', globalThis.__EXPO_IOS_RN_BRIDGE__],
    ];
    const failures = [];
    for (const [source, candidate] of probes) {
      try {
        const payload = callBridge(candidate, source);
        if (payload && payload.available !== false) return payload;
        if (payload && payload.available === false) failures.push({ source, reason: payload.reason || 'Bridge probe returned unavailable.' });
      } catch (error) {
        failures.push({ source, reason: error && error.message ? error.message : String(error) });
      }
    }
    return {
      available: false,
      source: failures[0] ? failures[0].source : 'app-instrumentation',
      reason: failures[0] ? failures[0].reason : 'No semantic or React Native bridge global was found.',
      failures,
    };
  })()`;
}
function normalizeSemanticBridgeSnapshot(value, filters) {
  const source2 = typeof value.source === "string" ? value.source : "app-instrumentation";
  const rawRefs = firstArray(value.refs, value.tree, value.nodes, value.elements, value.items);
  const refs = rawRefs.map((node) => normalizeSemanticRef(node, filters)).filter((node) => Boolean(node));
  return {
    source: source2,
    bridgeVersion: typeof value.bridgeVersion === "string" ? value.bridgeVersion : typeof value.version === "string" ? value.version : null,
    routeHint: typeof value.routeHint === "string" ? value.routeHint : typeof value.route === "string" ? value.route : null,
    refs,
    rawCount: rawRefs.length,
    reason: typeof value.reason === "string" ? value.reason : void 0,
    limitations: Array.isArray(value.limitations) ? value.limitations.map(String) : [
      "Semantic snapshot data comes from app-side dev instrumentation exposed through Hermes Runtime.evaluate."
    ]
  };
}
function normalizeSemanticRef(node, filters) {
  const record = asRecord3(node);
  if (!record) return null;
  const role = stringOrNull3(record.role ?? record.accessibilityRole ?? record.type);
  const actions = actionsFrom(record.actions ?? record.accessibilityActions ?? record.handlers);
  if (filters.interactiveOnly && actions.length === 0 && !role) return null;
  return {
    role,
    label: stringOrNull3(record.label ?? record.accessibilityLabel ?? record.title ?? record.name),
    text: stringOrNull3(record.text ?? record.children ?? record.value),
    placeholder: stringOrNull3(record.placeholder ?? record.placeholderText),
    testID: stringOrNull3(record.testID ?? record.testId ?? record.testid),
    nativeID: stringOrNull3(record.nativeID ?? record.nativeId),
    component: stringOrNull3(record.component ?? record.componentName ?? record.displayName ?? record.name ?? record.type),
    source: record.source ?? record.sourceLocation ?? record._source ?? null,
    box: normalizeBox(record.box ?? record.bounds ?? record.frame ?? record.layout),
    actions,
    disabled: typeof record.disabled === "boolean" ? record.disabled : void 0,
    raw: node
  };
}
function firstArray(...values) {
  for (const value of values) {
    if (Array.isArray(value)) return value;
  }
  return [];
}
function actionsFrom(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => typeof item === "string" ? item : stringOrNull3(asRecord3(item)?.name ?? asRecord3(item)?.action)).filter((item) => Boolean(item));
}
function normalizeBox(value) {
  const record = asRecord3(value);
  if (!record) return null;
  const x = numberOrNull(record.x ?? record.left);
  const y = numberOrNull(record.y ?? record.top);
  const width = numberOrNull(record.width ?? record.w);
  const height = numberOrNull(record.height ?? record.h);
  return x == null || y == null || width == null || height == null ? null : { x, y, width, height };
}
function clampNumber6(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`Expected a finite number, got ${String(value)}.`);
  return Math.min(Math.max(number, min), max);
}
function stringOrNull3(value) {
  return typeof value === "string" && value.length > 0 ? value : null;
}
function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
function asRecord3(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}
function commandPath2(command) {
  return new Promise((resolve15) => {
    nodeExecFile3("which", [command], { timeout: 5e3 }, (error, stdout) => {
      resolve15(error ? null : String(stdout ?? "").trim() || null);
    });
  });
}
function execFile3(file, args, options) {
  return new Promise((resolve15) => {
    nodeExecFile3(file, args, { timeout: options.timeout, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
      resolve15({
        stdout: String(stdout ?? ""),
        stderr: String(stderr ?? ""),
        error: error ? { message: error.message, code: error.code, signal: error.signal } : void 0
      });
    });
  });
}
async function readJson3(file) {
  return JSON.parse(await readFile5(file, "utf8"));
}
async function writeJson2(file, value) {
  await writeFile3(file, `${JSON.stringify(value, null, 2)}
`, "utf8");
}
function formatError8(error) {
  if (!error) {
    return "Unknown error";
  }
  const record = error;
  const parts = [record.message ?? String(error)];
  if (record.stdout) parts.push(`stdout:
${truncate6(record.stdout)}`);
  if (record.stderr) parts.push(`stderr:
${truncate6(record.stderr)}`);
  return parts.join("\n\n");
}
function truncate6(value, limit = 4e3) {
  const text = String(value ?? "");
  return text.length <= limit ? text : `${text.slice(0, limit)}
[truncated ${text.length - limit} characters]`;
}

// src/modules/ref-actions-wait/src/main/common.ts
function toolJson7(value) {
  return { content: [{ type: "text", text: `${JSON.stringify(value, null, 2)}
` }] };
}
function unwrapToolJson3(result) {
  const text = result?.content?.[0]?.text;
  if (typeof text !== "string") {
    return result;
  }
  try {
    return JSON.parse(text);
  } catch {
    return { text };
  }
}
function requireString5(value, field) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${field} must be a non-empty string.`);
  }
  return value.trim();
}
function clampNumber7(value, min, max) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) {
    throw new Error(`Expected a finite number, got ${value}.`);
  }
  return Math.min(Math.max(numberValue, min), max);
}
function normalizeFinderText(value) {
  return String(value ?? "").toLowerCase().trim();
}

// src/modules/ref-actions-wait/src/main/defaults.ts
import { readdir as readdir5, readFile as readFile6 } from "node:fs/promises";
import { join as join8 } from "node:path";

// src/modules/ref-actions-wait/src/main/ref-actions.ts
async function planRefAction(args, deps = defaultRefActionDependencies) {
  const action = requireString5(args.action, "action");
  const ref = requireString5(args.ref, "ref");
  const cache = await deps.readLatestRefCache(args);
  if (!cache) {
    return { available: false, reason: "No snapshot exists for the current session." };
  }
  const record = cache.refs.find((item) => item.ref === ref);
  if (!record) {
    return { available: false, reason: "Ref not found in the latest snapshot.", ref };
  }
  if (record.stale) {
    return { available: false, reason: "Ref is stale. Capture a new snapshot before acting.", ref };
  }
  if (!record.actions.includes(action)) {
    return {
      available: false,
      reason: "Action is not available for this ref.",
      ref,
      action,
      availableActions: record.actions
    };
  }
  return {
    available: true,
    dryRun: true,
    plan: {
      action,
      ref,
      targetId: record.targetId,
      box: record.box ?? null,
      point: record.box ? centerPoint(record.box) : null
    }
  };
}
function centerPoint(box) {
  return {
    x: box.x + box.width / 2,
    y: box.y + box.height / 2
  };
}

// src/modules/ref-actions-wait/src/main/defaults.ts
var defaultRefActionDependencies = {
  readLatestRefCache: readLatestRefCache2,
  planFinderAction: (args) => planRefAction(args, defaultRefActionDependencies)
};
async function readLatestRefCache2(args = {}) {
  const stateRoot = resolveExpoStateRoot2(args);
  const session = await readLatestSession2(stateRoot);
  if (!session?.sessionId || !session.lastSnapshotId) return null;
  try {
    return await readJson4(join8(stateRoot, "sessions", session.sessionId, "refs.json"));
  } catch {
    return null;
  }
}
async function readLatestSession2(stateRoot) {
  const sessionsRoot = join8(stateRoot, "sessions");
  const entries = await readdir5(sessionsRoot, { withFileTypes: true }).catch(() => []);
  const sessions = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const session = await readJson4(join8(sessionsRoot, entry.name, "session.json")).catch(() => null);
    if (session && typeof session === "object") sessions.push(session);
  }
  sessions.sort(
    (left, right) => String(right.updatedAt ?? right.createdAt ?? "").localeCompare(String(left.updatedAt ?? left.createdAt ?? ""))
  );
  return sessions[0] ?? null;
}
async function readJson4(path12) {
  return JSON.parse(await readFile6(path12, "utf8"));
}

// src/modules/ref-actions-wait/src/main/find.ts
async function findCommand(args, deps = defaultRefActionDependencies) {
  const kind = requireString5(args.kind, "kind").toLowerCase();
  const value = requireString5(args.value, "value");
  const cache = await deps.readLatestRefCache(args);
  if (!cache) {
    return toolJson7({ available: false, reason: "No snapshot exists for the current session." });
  }
  const matches = findMatches(cache.refs, kind, value, args.name);
  const payload = {
    available: matches.length > 0,
    kind,
    value,
    name: args.name ?? null,
    matches
  };
  if (args.action) {
    payload.actionResult = matches[0] ? await finderActionResult({ ...args, ref: matches[0].ref }, deps) : { available: false, reason: "No matching ref for action.", action: args.action };
  }
  return toolJson7(payload);
}
async function finderActionResult(args, deps) {
  const action = requireString5(args.action, "action");
  const dryRun = args.dryRun !== false;
  if (!["tap", "inspect", "long-press", "fill", "scroll-into-view", "focus"].includes(action)) {
    return { available: false, reason: `Unsupported finder action: ${action}`, action };
  }
  if (deps.planFinderAction) {
    return deps.planFinderAction({ ...args, action, dryRun });
  }
  if (action === "tap" || ["long-press", "fill", "scroll-into-view", "focus"].includes(action)) {
    return unwrapToolJson3(toolJson7(await planUnavailable(action)));
  }
  if (action === "inspect") {
    return { available: false, reason: "Inspect action is not wired in this module.", ref: args.ref };
  }
  return { available: false, reason: `Unsupported finder action: ${action}`, action };
}
function findMatches(refs, kind, value, name) {
  if (kind === "first") {
    const match = refs.find(
      (record) => refMatches(record, "source", value, name) || refMatches(record, "text", value, name) || refMatches(record, "label", value, name)
    );
    return match ? [match] : [];
  }
  if (kind === "nth") {
    const index = clampNumber7(Number(value), 1, Number.MAX_SAFE_INTEGER) - 1;
    const needle = requireString5(name, "name");
    const matches = refs.filter(
      (record) => refMatches(record, "source", needle) || refMatches(record, "text", needle) || refMatches(record, "label", needle)
    );
    return matches[index] ? [matches[index]] : [];
  }
  return refs.filter((record) => refMatches(record, kind, value, name));
}
function refMatches(record, kind, value, name) {
  const expected = normalizeFinderText(value);
  if (kind === "role") {
    if (normalizeFinderText(record.role) !== expected) return false;
    if (!name) return true;
    const accessibleName = normalizeFinderText([record.label, record.text].filter(Boolean).join(" "));
    return accessibleName.includes(normalizeFinderText(name));
  }
  if (kind === "text") return normalizeFinderText(record.text ?? record.label).includes(expected);
  if (kind === "label") return normalizeFinderText(record.label).includes(expected);
  if (kind === "placeholder") return normalizeFinderText(record.placeholder).includes(expected);
  if (kind === "testid") return normalizeFinderText(record.testID ?? record.nativeID).includes(expected);
  if (kind === "source") {
    return normalizeFinderText([record.component, record.source?.file].filter(Boolean).join(" ")).includes(expected);
  }
  throw new Error(`Unknown finder kind: ${kind}`);
}
async function planUnavailable(action) {
  return { available: false, reason: `No action planner configured for ${action}.`, action };
}

// src/modules/ref-actions-wait/src/main/wait.ts
async function waitCommand(args, deps = defaultRefActionDependencies) {
  const now4 = deps.now ?? Date.now;
  const sleep = deps.sleep ?? defaultSleep;
  const started = now4();
  const timeoutMs = clampNumber7(args.timeoutMs ?? 5e3, 0, 6e4);
  const intervalMs = Math.min(Math.max(Math.floor(timeoutMs / 10), 25), 250);
  const predicate = waitPredicate(args);
  if (!predicate) {
    const ms = clampNumber7(args.ms ?? 0, 0, 6e4);
    if (ms > 0) await sleep(ms);
    return toolJson7({ matched: true, predicate: { kind: "sleep", ms }, elapsedMs: now4() - started });
  }
  if (predicate.kind === "metro-ready" || predicate.kind === "app-ready" || predicate.kind === "fn") {
    if (!deps.waitRuntimePredicate) {
      return toolJson7({
        matched: false,
        available: false,
        reason: "Runtime wait predicates require a runtime adapter.",
        predicate,
        timeoutMs,
        elapsedMs: now4() - started
      });
    }
    const runtimeResult = await deps.waitRuntimePredicate(predicate, args, { started, timeoutMs, intervalMs });
    return toolJson7(runtimeResult);
  }
  let lastCache = null;
  do {
    lastCache = await deps.readLatestRefCache(args);
    if (!lastCache) {
      return toolJson7({
        matched: false,
        reason: "No snapshot exists for the current session.",
        predicate,
        lastEvidence: null
      });
    }
    const result = evaluateWaitPredicate(lastCache, predicate);
    if (result.final || result.matched) {
      const payload = result.payload?.matched ? { ...result.payload, elapsedMs: now4() - started } : result.payload;
      return toolJson7(payload);
    }
    if (now4() - started >= timeoutMs) break;
    await sleep(Math.min(intervalMs, timeoutMs - (now4() - started)));
  } while (now4() - started <= timeoutMs);
  return toolJson7(timeoutWaitPayload(predicate, lastCache, timeoutMs, now4() - started));
}
function waitPredicate(args = {}) {
  if (args.metroReady === true) return { kind: "metro-ready" };
  if (args.appReady === true) return { kind: "app-ready" };
  if (args.fn !== void 0) return { kind: "fn", expression: requireString5(args.fn, "fn") };
  if (args.route !== void 0) return { kind: "route", route: requireString5(args.route, "route") };
  if (args.noSpinner === true) return { kind: "no-spinner" };
  if (args.text !== void 0) return { kind: "text", text: requireString5(args.text, "text") };
  if (args.ref !== void 0 || args.state !== void 0) {
    return {
      kind: "ref-state",
      ref: requireString5(args.ref, "ref"),
      state: requireString5(args.state ?? "visible", "state").toLowerCase()
    };
  }
  return null;
}
function evaluateWaitPredicate(cache, predicate) {
  if (predicate.kind === "text") {
    const expected = normalizeFinderText(predicate.text);
    const ref = cache.refs.find(
      (record) => !record.stale && normalizeFinderText([record.text, record.label].filter(Boolean).join(" ")).includes(expected)
    );
    if (!ref) return { matched: false, final: false };
    return {
      matched: true,
      final: true,
      payload: { matched: true, predicate, ref, lastEvidence: waitEvidence(cache) }
    };
  }
  if (predicate.kind === "ref-state") {
    if (!/^@e\d+$/.test(predicate.ref)) {
      return {
        matched: false,
        final: true,
        payload: { matched: false, reason: "Ref must look like @e1.", ref: predicate.ref }
      };
    }
    if (!["visible", "hidden"].includes(predicate.state)) {
      throw new Error(`Unknown wait state: ${predicate.state}`);
    }
    const ref = cache.refs.find((record) => record.ref === predicate.ref);
    if (!ref) {
      return {
        matched: false,
        final: true,
        payload: { matched: false, reason: "Ref not found in the latest snapshot.", ref: predicate.ref }
      };
    }
    if (ref.stale) {
      return {
        matched: false,
        final: true,
        payload: {
          matched: false,
          reason: "Ref is stale. Capture a new snapshot before waiting on it.",
          ref: predicate.ref
        }
      };
    }
    const visible = refHasVisibleEvidence(ref);
    const matched = predicate.state === "visible" ? visible : !visible;
    if (!matched) return { matched: false, final: false };
    return {
      matched: true,
      final: true,
      payload: { matched: true, predicate, ref, lastEvidence: waitEvidence(cache) }
    };
  }
  if (predicate.kind === "route") {
    const expected = normalizeFinderText(predicate.route);
    const ref = cache.refs.find(
      (record) => !record.stale && normalizeFinderText([record.text, record.label].filter(Boolean).join(" ")).includes(expected)
    );
    if (!ref) return { matched: false, final: false };
    return {
      matched: true,
      final: true,
      payload: { matched: true, predicate, ref, lastEvidence: waitEvidence(cache) }
    };
  }
  if (predicate.kind === "no-spinner") {
    const spinner = cache.refs.find(
      (record) => /spinner|loading|progress/i.test([record.role, record.label, record.text].filter(Boolean).join(" "))
    );
    if (spinner) return { matched: false, final: false };
    return {
      matched: true,
      final: true,
      payload: { matched: true, predicate, lastEvidence: waitEvidence(cache) }
    };
  }
  throw new Error(`Unknown wait predicate: ${predicate.kind}`);
}
function timeoutWaitPayload(predicate, cache, timeoutMs, elapsedMs) {
  const refState = predicate;
  const label = predicate.kind === "text" ? "text" : `${refState.ref} to become ${refState.state}`;
  return {
    matched: false,
    reason: `Timed out waiting for ${label}.`,
    predicate,
    timeoutMs,
    elapsedMs,
    lastEvidence: waitEvidence(cache, { includeSampleRefs: true })
  };
}
function waitEvidence(cache, options = {}) {
  if (!cache) return null;
  return {
    snapshotId: cache.snapshotId ?? null,
    targetId: cache.targetId ?? null,
    refCount: cache.refs?.length ?? 0,
    ...options.includeSampleRefs ? { sampleRefs: (cache.refs ?? []).slice(0, 5).map((record) => waitSampleRef(record)) } : {}
  };
}
function refHasVisibleEvidence(record) {
  return Boolean(
    record?.box || normalizeFinderText(record?.text) || normalizeFinderText(record?.label)
  );
}
function waitSampleRef(record) {
  return {
    ref: record.ref,
    role: record.role ?? null,
    label: record.label ?? null,
    text: record.text ?? null,
    stale: record.stale === true
  };
}
function defaultSleep(ms) {
  return new Promise((resolve15) => setTimeout(resolve15, ms));
}

// src/modules/batch-orchestration/src/main/domain.ts
var EXIT_RUNTIME_FAILURE3 = 1;
var EXIT_INVALID_USAGE4 = 2;
var CliUsageError4 = class extends Error {
  exitCode = EXIT_INVALID_USAGE4;
  constructor(message) {
    super(message);
    this.name = "CliUsageError";
  }
};

// src/modules/batch-orchestration/src/main/tool-json.ts
function toolJson8(value) {
  return { content: [{ type: "text", text: `${JSON.stringify(value, null, 2)}
` }], isError: false };
}
function unwrapToolJson4(result) {
  const maybe = result;
  const text = maybe?.content?.[0]?.text;
  if (typeof text !== "string") {
    return result;
  }
  try {
    return JSON.parse(text);
  } catch {
    return { text };
  }
}

// src/modules/batch-orchestration/src/main/errors.ts
var REDACTED3 = "[redacted]";
var SECRET_KEY_PATTERN2 = /token|authorization|cookie|password|secret|apikey|apiKey/i;
var URL_QUERY_SECRET_PATTERN2 = /([?&](cookie|token|authorization|password|secret)=)[^&]+/gi;
var FREEFORM_SECRET_PATTERN = /\b(token|authorization|password|secret)=([^\s&]+)/gi;
var BEARER_SECRET_PATTERN = /(authorization=\[redacted\]\s+)[^\s&]+/gi;
var MAX_OUTPUT5 = 4e4;
function batchStepError(error) {
  const exitCode = exitCodeForError3(error);
  return {
    code: errorCodeForExitCode3(exitCode),
    message: sanitizeErrorMessage3(formatError9(error)),
    exitCode
  };
}
function exitCodeForError3(error) {
  const record = error;
  if (record && Number.isInteger(record.exitCode)) {
    return record.exitCode;
  }
  const message = String(record?.message ?? "");
  if (/Unknown command|Unknown tool|requires a value|Expected a finite number|must be a non-empty string|must look like|must not contain whitespace|valid JSON/i.test(message)) {
    return EXIT_INVALID_USAGE4;
  }
  return EXIT_RUNTIME_FAILURE3;
}
function errorCodeForExitCode3(exitCode) {
  if (exitCode === EXIT_INVALID_USAGE4) return "invalid_usage";
  if (exitCode === EXIT_RUNTIME_FAILURE3) return "runtime_failure";
  return "error";
}
function formatError9(error) {
  if (!error) return "Unknown error";
  const record = error;
  const parts = [record.message ?? String(error)];
  if (record.stdout) parts.push(`stdout:
${truncate7(record.stdout)}`);
  if (record.stderr) parts.push(`stderr:
${truncate7(record.stderr)}`);
  return parts.join("\n\n");
}
function truncate7(value, limit = MAX_OUTPUT5) {
  const text = String(value ?? "");
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}
[truncated ${text.length - limit} characters]`;
}
function sanitizeErrorMessage3(message) {
  return redactValue4(String(message ?? ""));
}
function redactValue4(value, key = "") {
  if (typeof value === "string") {
    if (isSecretKey3(key)) return REDACTED3;
    return value.replace(URL_QUERY_SECRET_PATTERN2, `$1${REDACTED3}`).replace(FREEFORM_SECRET_PATTERN, `$1=${REDACTED3}`).replace(BEARER_SECRET_PATTERN, `$1${REDACTED3}`);
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactValue4(item, key));
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  return Object.fromEntries(Object.entries(value).map(([childKey, childValue]) => [
    childKey,
    isSecretKey3(childKey) ? REDACTED3 : redactValue4(childValue, childKey)
  ]));
}
function isSecretKey3(key) {
  return SECRET_KEY_PATTERN2.test(key);
}

// src/modules/batch-orchestration/src/main/cli.ts
function parseCliArgs2(argv) {
  const args = { _: [] };
  const globals = defaultGlobals2();
  let command = null;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === void 0) continue;
    if (token === "--") {
      args._.push(...argv.slice(index + 1));
      break;
    }
    if (token === "--help" || token === "-h") {
      globals.help = true;
      continue;
    }
    if (token === "--version") {
      globals.version = true;
      continue;
    }
    if (token.startsWith("--")) {
      const eq = token.indexOf("=");
      const rawKey = eq === -1 ? token.slice(2) : token.slice(2, eq);
      const globalKey = normalizeGlobalFlag2(rawKey);
      if (globalKey) {
        if (globalFlagTakesValue2(rawKey)) {
          const value = eq === -1 ? argv[index + 1] : token.slice(eq + 1);
          if (value === void 0 || value.startsWith("--")) {
            throw new CliUsageError4(`--${rawKey} requires a value.`);
          }
          if (eq === -1) index += 1;
          globals[globalKey] = String(value);
        } else {
          globals[globalKey] = true;
        }
        continue;
      }
      if (!command) {
        throw new CliUsageError4(`Global flag or command expected before --${rawKey}.`);
      }
      const key = toCamel2(rawKey);
      const schemaValue = eq === -1 ? argv[index + 1] : token.slice(eq + 1);
      if (eq === -1 && (schemaValue === void 0 || schemaValue.startsWith("--"))) {
        args[key] = true;
      } else {
        if (eq === -1) index += 1;
        args[key] = coerceCliValue2(String(schemaValue));
      }
      continue;
    }
    if (!command) {
      command = token;
      continue;
    }
    args._.push(token);
  }
  return { globals, command, args };
}
function coerceCliValue2(value) {
  if (value === "true") return true;
  if (value === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  return value;
}
function parseJsonArgument(value, flag) {
  try {
    return JSON.parse(value);
  } catch (error) {
    throw new Error(`${flag} must be valid JSON: ${formatError9(error)}`);
  }
}
function pickDefined3(object) {
  return Object.fromEntries(Object.entries(object).filter(([, value]) => value !== void 0));
}
function defaultGlobals2() {
  return {
    json: false,
    plain: false,
    quiet: false,
    verbose: false,
    debug: false,
    noColor: false,
    noInput: false,
    record: false,
    version: false,
    help: false,
    root: null,
    stateDir: null,
    actionPolicy: null,
    maxOutput: null,
    contentBoundaries: false,
    allowRuntimeEval: null,
    confirmActions: null
  };
}
function normalizeGlobalFlag2(rawKey) {
  switch (rawKey) {
    case "json":
    case "plain":
    case "quiet":
    case "verbose":
    case "debug":
    case "record":
      return rawKey;
    case "content-boundaries":
      return "contentBoundaries";
    case "root":
      return "root";
    case "state-dir":
      return "stateDir";
    case "action-policy":
      return "actionPolicy";
    case "max-output":
      return "maxOutput";
    case "allow-runtime-eval":
      return "allowRuntimeEval";
    case "confirm-actions":
      return "confirmActions";
    case "no-color":
      return "noColor";
    case "no-input":
      return "noInput";
    default:
      return null;
  }
}
function globalFlagTakesValue2(rawKey) {
  return rawKey === "root" || rawKey === "state-dir" || rawKey === "action-policy" || rawKey === "max-output" || rawKey === "allow-runtime-eval" || rawKey === "confirm-actions";
}
function toCamel2(value) {
  return value.replace(/-([a-z])/g, (_, char) => char.toUpperCase());
}

// src/modules/batch-orchestration/src/main/command-map.ts
var ALIASES2 = {
  "session": "session",
  "target": "target",
  "snapshot": "snapshot",
  "refs": "refs",
  "get": "get_ref",
  "find": "find",
  "wait": "wait",
  "batch": "batch",
  "tap": "automation_tap",
  "fill": "ref_action",
  "scroll-into-view": "ref_action"
};
function commandAliases() {
  return { ...ALIASES2 };
}
function commandArgs2(command, args, globals = {}) {
  const cwd = args.cwd ?? globals.root;
  switch (command) {
    case "session":
      return pickDefined3({
        action: args.action ?? args._[0],
        name: args.name ?? args._[1],
        olderThan: args.olderThan,
        cwd,
        root: globals.root,
        stateDir: globals.stateDir
      });
    case "target":
      return pickDefined3({
        action: args.action ?? args._[0],
        targetId: args.targetId ?? args._[1],
        platform: args.platform,
        metroPort: args.metroPort,
        cwd,
        root: globals.root,
        stateDir: globals.stateDir
      });
    case "snapshot":
      return pickDefined3({
        interactive: args.interactive,
        compact: args.compact,
        depth: args.depth,
        source: args.source,
        bounds: args.bounds,
        metroPort: args.metroPort,
        cwd,
        root: globals.root,
        stateDir: globals.stateDir
      });
    case "refs":
      return pickDefined3({ cwd, root: globals.root, stateDir: globals.stateDir });
    case "get":
      return pickDefined3({
        field: args.field ?? args._[0],
        ref: args.ref ?? args._[1],
        cwd,
        root: globals.root,
        stateDir: globals.stateDir
      });
    case "find":
      return pickDefined3({
        kind: args.kind ?? args._[0],
        value: args.value ?? args._[1],
        action: args.action ?? args._[2],
        name: args.name ?? (args._[0] === "nth" ? args._[2] : void 0),
        text: args.text ?? args._[3],
        dryRun: args.dryRun,
        cwd,
        root: globals.root,
        stateDir: globals.stateDir
      });
    case "wait": {
      const first = args._[0];
      return pickDefined3({
        ref: args.ref ?? (/^@e\d+$/.test(String(first ?? "")) ? first : void 0),
        ms: args.ms ?? (/^\d+$/.test(String(first ?? "")) ? Number(first) : void 0),
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
        stateDir: globals.stateDir
      });
    }
    case "batch":
      return pickDefined3({
        steps: args.steps ?? args._,
        bail: args.bail,
        cwd,
        root: globals.root,
        stateDir: globals.stateDir
      });
    case "tap":
      return pickDefined3({
        platform: args.platform,
        device: args.device,
        x: args.x,
        y: args.y,
        ref: args.ref ?? args._[0],
        dryRun: args.dryRun,
        cwd,
        root: globals.root,
        stateDir: globals.stateDir
      });
    case "fill":
    case "scroll-into-view": {
      const first = args._[0];
      return pickDefined3({
        command,
        ref: args.ref ?? first,
        text: args.text ?? (command === "fill" ? args._[1] : void 0),
        durationMs: args.durationMs,
        dryRun: args.dryRun,
        cwd,
        root: globals.root,
        stateDir: globals.stateDir
      });
    }
    default:
      return {};
  }
}

// src/modules/batch-orchestration/src/main/batch.ts
import { execFile as nodeExecFile4 } from "node:child_process";
async function batchCommand(args, deps = defaultBatchDependencies) {
  const steps = normalizeBatchSteps(args.steps ?? []);
  const bail = args.bail === true;
  const results = [];
  let failureIndex = null;
  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index];
    if (!step) continue;
    try {
      const result = await runBatchStep(step, args, deps);
      results.push({ index, command: result.command, ok: true, data: result.data });
    } catch (error) {
      if (failureIndex === null) failureIndex = index;
      results.push({
        index,
        command: Array.isArray(step) ? step[0] ?? null : null,
        ok: false,
        error: batchStepError(error)
      });
      if (bail) break;
    }
  }
  return toolJson8({
    ok: failureIndex === null,
    bail,
    failureIndex,
    steps: results
  });
}
var defaultBatchDependencies = {
  runTool: runToolViaCli
};
function normalizeBatchSteps(steps) {
  if (!Array.isArray(steps)) {
    throw new CliUsageError4("batch requires one or more command steps.");
  }
  return steps.map((step, index) => {
    const parsed = typeof step === "string" ? parseJsonArgument(step, `step ${index + 1}`) : step;
    if (!Array.isArray(parsed) || parsed.length === 0) {
      throw new CliUsageError4(`batch step ${index + 1} must be a non-empty argv array.`);
    }
    return parsed.map((part) => String(part));
  });
}
async function runBatchStep(step, batchArgs, deps) {
  const parsed = parseCliArgs2(step);
  const { command, args, globals } = parsed;
  if (!command) throw new CliUsageError4("Batch step is missing a command.");
  const aliases = commandAliases();
  const toolName = aliases[command];
  if (!toolName) throw new CliUsageError4(`Unknown command: ${command}`);
  const mergedGlobals = {
    ...globals,
    json: true,
    plain: false,
    quiet: true,
    root: globals.root ?? batchArgs.root ?? null,
    stateDir: globals.stateDir ?? batchArgs.stateDir ?? null
  };
  const effectiveArgs = commandArgs2(command, args, mergedGlobals);
  const result = await deps.runTool(toolName, effectiveArgs, { command, globals: mergedGlobals, silent: true });
  return { command, data: redactValue4(unwrapToolJson4(result)) };
}
async function runToolViaCli(_toolName, args, options) {
  const cliPath = process.argv[1];
  if (!cliPath) {
    throw new Error("batch requires a CLI entrypoint to run steps.");
  }
  const argv = cliArgv2(options.command, args, options.globals);
  const result = await execFile4(process.execPath, [cliPath, ...argv], {
    timeout: 12e4,
    rejectOnError: false
  });
  if (result.error) {
    const message = [result.error.message, result.stderr].filter(Boolean).join("\n");
    throw new Error(message || `Batch step failed: ${options.command}`);
  }
  const parsed = parseCliJson(result.stdout);
  return parsed && typeof parsed === "object" && "data" in parsed ? parsed.data : parsed;
}
function cliArgv2(command, args, globals) {
  const argv = ["--json", "--quiet"];
  if (typeof globals.root === "string" && globals.root) argv.push("--root", globals.root);
  if (typeof globals.stateDir === "string" && globals.stateDir) argv.push("--state-dir", globals.stateDir);
  argv.push(command);
  for (const [key, value] of Object.entries(args)) {
    if (value === void 0 || value === null || key === "root" || key === "stateDir") continue;
    const flag = `--${kebabCase(key)}`;
    if (value === true) {
      argv.push(flag);
    } else {
      argv.push(flag, typeof value === "object" ? JSON.stringify(value) : String(value));
    }
  }
  return argv;
}
function parseCliJson(stdout) {
  const text = stdout.trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { text };
  }
}
function execFile4(file, args, options) {
  return new Promise((resolve15) => {
    nodeExecFile4(file, args, { timeout: options.timeout }, (error, stdout, stderr) => {
      resolve15({
        stdout: String(stdout ?? ""),
        stderr: String(stderr ?? ""),
        error
      });
    });
  });
}
function kebabCase(value) {
  return value.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`);
}

// src/modules/app-lifecycle-actions/src/main/index.ts
import { execFile as nodeExecFile5 } from "node:child_process";
import * as fs4 from "node:fs/promises";
import { homedir } from "node:os";
import { join as joinPath, resolve as resolvePath } from "node:path";
var MAX_OUTPUT6 = 4e4;
var defaultAppLifecycleDependencies = {
  execFile: defaultExecFile,
  resolveIosDevice: defaultResolveIosDevice,
  wait: (ms) => new Promise((resolve15) => setTimeout(resolve15, ms)),
  now: () => Date.now(),
  policyDecision: defaultPolicyDecision,
  runtimeSummary: defaultRuntimeSummary,
  listDiagnosticReports: defaultListDiagnosticReports
};
async function bootSimulator(args, deps = defaultAppLifecycleDependencies) {
  const policy = await deps.policyDecision(args, "boot-simulator", "device");
  if (!policy.allowed) return policyDeniedPayload("boot-simulator", policy);
  const requestedDevice = optionalString3(args.device) ?? void 0;
  const device = await deps.resolveIosDevice(requestedDevice, { preferBooted: true });
  const bootResult = await deps.execFile("xcrun", ["simctl", "boot", device.udid], {
    timeout: 6e4,
    rejectOnError: false
  });
  const shouldOpen = args.openSimulator !== false;
  if (shouldOpen) {
    await deps.execFile("open", ["-a", "Simulator"], { timeout: 1e4, rejectOnError: false });
  }
  return {
    requestedDevice: requestedDevice ?? null,
    device,
    openSimulator: shouldOpen,
    stdout: truncateSubprocessOutput(bootResult.stdout),
    stderr: truncateSubprocessOutput(bootResult.stderr)
  };
}
async function launchApp(args, deps = defaultAppLifecycleDependencies) {
  const platform = platformArg(args.platform);
  const policy = await deps.policyDecision(args, "launch-app", "device");
  if (!policy.allowed) return policyDeniedPayload("launch-app", policy);
  if (platform === "android") {
    const packageName = requireString6(args.packageName ?? args.bundleId, "packageName");
    const activity = optionalString3(args.activity);
    const commandArgs3 = activity ? ["shell", "am", "start", "-n", `${packageName}/${activity}`] : ["shell", "monkey", "-p", packageName, "1"];
    const result2 = await deps.execFile("adb", androidDeviceArgs(args.device, commandArgs3), {
      timeout: 3e4,
      rejectOnError: false
    });
    return {
      platform,
      packageName,
      stdout: truncateSubprocessOutput(result2.stdout),
      stderr: truncateSubprocessOutput(result2.stderr)
    };
  }
  const bundleId = requireString6(args.bundleId ?? args.packageName, "bundleId");
  const device = await deps.resolveIosDevice(optionalString3(args.device) ?? void 0, { preferBooted: true });
  const startedAt = deps.now();
  const result = await deps.execFile("xcrun", ["simctl", "launch", device.udid, bundleId], {
    timeout: 3e4,
    rejectOnError: false
  });
  return attachIosCrashEvidence(
    {
      platform,
      device,
      bundleId,
      available: !result.error,
      stdout: truncateSubprocessOutput(result.stdout),
      stderr: truncateSubprocessOutput(result.stderr),
      error: result.error ?? null
    },
    {
      platform,
      bundleId,
      processName: args.processName,
      sinceMs: startedAt,
      waitMs: args.crashCheckMs,
      action: "launch-app"
    },
    deps
  );
}
async function terminateApp(args, deps = defaultAppLifecycleDependencies) {
  const platform = platformArg(args.platform);
  const policy = await deps.policyDecision(args, "terminate-app", "device");
  if (!policy.allowed) return policyDeniedPayload("terminate-app", policy);
  const bundleId = await resolveBundleId(args, deps);
  if (args.dryRun === true) {
    return { available: true, dryRun: true, action: "terminate-app", platform, bundleId };
  }
  if (platform === "android") {
    const result2 = await deps.execFile("adb", androidDeviceArgs(args.device, ["shell", "am", "force-stop", bundleId]), {
      timeout: 2e4,
      rejectOnError: false
    });
    return {
      available: !result2.error,
      action: "terminate-app",
      platform,
      packageName: bundleId,
      stdout: truncateSubprocessOutput(result2.stdout),
      stderr: truncateSubprocessOutput(result2.stderr),
      error: result2.error ?? null
    };
  }
  const device = await deps.resolveIosDevice(optionalString3(args.device) ?? void 0, { preferBooted: true });
  const result = await deps.execFile("xcrun", ["simctl", "terminate", device.udid, bundleId], {
    timeout: 2e4,
    rejectOnError: false
  });
  return {
    available: !result.error,
    action: "terminate-app",
    platform,
    device,
    bundleId,
    stdout: truncateSubprocessOutput(result.stdout),
    stderr: truncateSubprocessOutput(result.stderr),
    error: result.error ?? null
  };
}
async function reloadApp(args, deps = defaultAppLifecycleDependencies) {
  const policy = await deps.policyDecision(args, "reload-app", "device");
  if (!policy.allowed) return policyDeniedPayload("reload-app", policy);
  const bundleId = await resolveBundleId(args, deps);
  if (args.dryRun === true) {
    return { available: true, dryRun: true, action: "reload-app", bundleId };
  }
  const terminated = await terminateApp({ ...args, bundleId }, deps);
  const launched = await launchApp({ ...args, bundleId }, deps);
  return {
    available: launched.available === false || launched.error ? false : true,
    action: "reload-app",
    bundleId,
    strategy: "terminate-and-launch",
    terminated,
    launched
  };
}
async function attachIosCrashEvidence(payload, options, deps) {
  if (options.platform !== "ios") return payload;
  const evidence = await iosCrashEvidence(options, deps);
  const crashReports = Array.isArray(evidence.crashReports) ? evidence.crashReports : [];
  if (crashReports.length === 0) return { ...payload, ...evidence };
  return {
    ...payload,
    ...evidence,
    available: false,
    reason: `The app generated ${crashReports.length} matching iOS crash report(s) after ${String(options.action)}.`
  };
}
async function iosCrashEvidence(args, deps = defaultAppLifecycleDependencies) {
  const sinceMs = finiteNumber(args.sinceMs ?? deps.now());
  const delay = clampNumber8(args.waitMs ?? 0, 0, 3e4);
  if (delay > 0) await deps.wait(delay);
  const bundleId = optionalString3(args.bundleId);
  const processName = optionalString3(args.processName);
  const crashReports = await matchingIosCrashReports({ bundleId, processName, sinceMs }, deps);
  return {
    crashCheck: {
      action: String(args.action ?? "launch-app"),
      bundleId: bundleId ?? null,
      processName: processName ?? null,
      since: new Date(sinceMs).toISOString(),
      waitedMs: delay,
      reportCount: crashReports.length
    },
    crashReports
  };
}
async function matchingIosCrashReports(args, deps = defaultAppLifecycleDependencies) {
  const bundleId = optionalString3(args.bundleId);
  const processName = optionalString3(args.processName);
  if (!bundleId && !processName) return [];
  const reports = await deps.listDiagnosticReports();
  const sinceMs = finiteNumber(args.sinceMs ?? 0);
  const wantedProcess = processName?.toLowerCase() ?? null;
  const matches = [];
  for (const report of reports) {
    if (!report.isFile) continue;
    if (!/(\.ips|\.crash)$/.test(report.name)) continue;
    if (report.mtimeMs < sinceMs) continue;
    const metadata = parseCrashReportMetadata(report.content);
    const metadataBundle = stringFrom(metadata?.bundleID ?? metadata?.bundleId);
    const metadataName = stringFrom(metadata?.app_name ?? metadata?.name ?? metadata?.procName);
    const nameMatches = wantedProcess ? report.name.toLowerCase().includes(wantedProcess) || metadataName?.toLowerCase() === wantedProcess : false;
    if (bundleId && metadataBundle === bundleId || nameMatches) {
      matches.push({
        path: report.path,
        file: report.name,
        mtime: report.mtimeIso,
        appName: metadataName,
        bundleId: metadataBundle,
        incidentId: stringFrom(metadata?.incident_id ?? metadata?.incident)
      });
    }
  }
  return matches.sort((left, right) => String(left.path).localeCompare(String(right.path)));
}
async function installApp(args, deps = defaultAppLifecycleDependencies) {
  const platform = platformArg(args.platform);
  const appPath = resolvePath(requireString6(args.appPath, "appPath"));
  const policy = await deps.policyDecision(args, "install-app", "device");
  if (!policy.allowed) return policyDeniedPayload("install-app", policy);
  if (args.dryRun === true) {
    return { available: true, dryRun: true, action: "install-app", platform, appPath, policy };
  }
  if (platform === "android") {
    const result2 = await deps.execFile("adb", androidDeviceArgs(args.device, ["install", "-r", appPath]), {
      timeout: 12e4,
      rejectOnError: false
    });
    return {
      available: !result2.error,
      action: "install-app",
      platform,
      appPath,
      stdout: truncateSubprocessOutput(result2.stdout),
      stderr: truncateSubprocessOutput(result2.stderr),
      error: result2.error ?? null,
      policy
    };
  }
  const device = await deps.resolveIosDevice(optionalString3(args.device) ?? void 0, { preferBooted: true });
  const result = await deps.execFile("xcrun", ["simctl", "install", device.udid, appPath], {
    timeout: 12e4,
    rejectOnError: false
  });
  return {
    available: !result.error,
    action: "install-app",
    platform,
    device,
    appPath,
    stdout: truncateSubprocessOutput(result.stdout),
    stderr: truncateSubprocessOutput(result.stderr),
    error: result.error ?? null,
    policy
  };
}
async function uninstallApp(args, deps = defaultAppLifecycleDependencies) {
  const platform = platformArg(args.platform);
  const policy = await deps.policyDecision(args, "uninstall-app", "device");
  if (!policy.allowed) return policyDeniedPayload("uninstall-app", policy);
  const bundleId = await resolveBundleId(args, deps);
  if (args.dryRun === true) {
    return { available: true, dryRun: true, action: "uninstall-app", platform, bundleId, policy };
  }
  if (platform === "android") {
    const result2 = await deps.execFile("adb", androidDeviceArgs(args.device, ["uninstall", bundleId]), {
      timeout: 6e4,
      rejectOnError: false
    });
    return {
      available: !result2.error,
      action: "uninstall-app",
      platform,
      packageName: bundleId,
      stdout: truncateSubprocessOutput(result2.stdout),
      stderr: truncateSubprocessOutput(result2.stderr),
      error: result2.error ?? null,
      policy
    };
  }
  const device = await deps.resolveIosDevice(optionalString3(args.device) ?? void 0, { preferBooted: true });
  const result = await deps.execFile("xcrun", ["simctl", "uninstall", device.udid, bundleId], {
    timeout: 6e4,
    rejectOnError: false
  });
  return {
    available: !result.error,
    action: "uninstall-app",
    platform,
    device,
    bundleId,
    stdout: truncateSubprocessOutput(result.stdout),
    stderr: truncateSubprocessOutput(result.stderr),
    error: result.error ?? null,
    policy
  };
}
async function resolveBundleId(args, deps = defaultAppLifecycleDependencies) {
  const explicit = optionalString3(args.bundleId ?? args.packageName);
  if (explicit) return explicit;
  const cwd = optionalString3(args.cwd) ?? ".";
  const summary = await deps.runtimeSummary(cwd).catch(() => null);
  const inferred = optionalString3(summary?.appConfig?.iosBundleIdentifier ?? summary?.appConfig?.androidPackage);
  if (!inferred) throw new Error("bundleId must be provided or inferable from Expo app config.");
  return inferred;
}
async function collectAppLogs(args, deps = defaultAppLifecycleDependencies) {
  const platform = platformArg(args.platform);
  if (platform === "android") {
    const device2 = optionalString3(args.device);
    const lines = String(clampNumber8(args.lines ?? 500, 1, 5e3));
    const result2 = await deps.execFile("adb", androidDeviceArgs(device2, ["logcat", "-d", "-t", lines]), {
      timeout: 3e4,
      maxBuffer: 4 * 1024 * 1024,
      rejectOnError: false
    });
    return {
      platform,
      device: device2 ?? null,
      stdout: truncateSubprocessOutput(result2.stdout),
      stderr: truncateSubprocessOutput(result2.stderr)
    };
  }
  const device = await deps.resolveIosDevice(optionalString3(args.device) ?? void 0, { preferBooted: true });
  const last = optionalString3(args.last) ?? "2m";
  if (!/^\d+[smhd]$/.test(last)) throw new Error("last must look like 30s, 2m, 1h, or 1d.");
  const predicate = optionalString3(args.predicate) ?? iosLogPredicate(args);
  const commandArgs3 = ["simctl", "spawn", device.udid, "log", "show", "--style", "compact", "--last", last];
  if (predicate) commandArgs3.push("--predicate", predicate);
  const result = await deps.execFile("xcrun", commandArgs3, {
    timeout: 45e3,
    maxBuffer: 5 * 1024 * 1024,
    rejectOnError: false
  });
  return {
    platform,
    device,
    last,
    predicate: predicate ?? null,
    stdout: truncateSubprocessOutput(result.stdout),
    stderr: truncateSubprocessOutput(result.stderr)
  };
}
function iosLogPredicate(args) {
  const processName = optionalString3(args.processName);
  if (processName) return `process == "${escapePredicateValue(processName)}"`;
  const bundleId = optionalString3(args.bundleId);
  const inferredProcess = bundleId?.split(".").filter(Boolean).at(-1);
  return inferredProcess ? `process CONTAINS "${escapePredicateValue(inferredProcess)}"` : null;
}
function defaultExecFile(file, args, options = {}) {
  return new Promise((resolve15, reject) => {
    nodeExecFile5(file, args, {
      timeout: options.timeout,
      maxBuffer: options.maxBuffer ?? MAX_OUTPUT6
    }, (error, stdout, stderr) => {
      if (error && options.rejectOnError !== false) {
        Object.assign(error, { stdout, stderr });
        reject(error);
        return;
      }
      resolve15({
        stdout: String(stdout ?? ""),
        stderr: String(stderr ?? ""),
        error: error ? { message: error.message, code: error.code, signal: error.signal } : null
      });
    });
  });
}
async function defaultResolveIosDevice(requested) {
  if (requested && /^[0-9A-Fa-f-]{20,}$/.test(requested)) {
    return { udid: requested, name: requested, state: "unknown" };
  }
  const { stdout } = await defaultExecFile("xcrun", ["simctl", "list", "devices", "available", "--json"], {
    timeout: 2e4,
    maxBuffer: 4 * 1024 * 1024
  });
  const parsed = JSON.parse(String(stdout ?? "{}"));
  const devices = Object.entries(parsed.devices ?? {}).flatMap(
    ([runtime2, runtimeDevices]) => (Array.isArray(runtimeDevices) ? runtimeDevices : []).map((device) => {
      const record = isRecord5(device) ? device : {};
      return {
        udid: String(record.udid ?? ""),
        name: String(record.name ?? ""),
        state: stringFrom(record.state) ?? void 0,
        runtime: runtime2,
        isAvailable: record.isAvailable === void 0 ? void 0 : Boolean(record.isAvailable)
      };
    })
  ).filter((device) => device.udid && device.name);
  if (requested) {
    const exact = devices.find((device) => device.udid === requested || device.name === requested);
    if (exact) return exact;
    const partial = devices.find((device) => device.name.toLowerCase().includes(requested.toLowerCase()));
    if (partial) return partial;
    throw new Error(`No available iOS simulator matched: ${requested}`);
  }
  const booted = devices.find((device) => device.state === "Booted");
  if (booted) return booted;
  const iphone = [...devices].reverse().find((device) => /iPhone/.test(device.name));
  if (iphone) return iphone;
  if (devices[0]) return devices[0];
  throw new Error("No available iOS simulators found.");
}
async function defaultPolicyDecision(args, action, sideEffect) {
  const policyPath = optionalString3(args.actionPolicy);
  if (!policyPath) {
    return {
      checked: true,
      action,
      sideEffect,
      allowed: false,
      source: null,
      reason: "No action policy allowed this state-changing operation."
    };
  }
  const policy = JSON.parse(await fs4.readFile(resolvePath(policyPath), "utf8"));
  const allowed = Array.isArray(policy.allow) && policy.allow.includes(action) || policy.actions?.[action] === true || policy.actions?.[action] === "allow";
  return {
    checked: true,
    action,
    sideEffect,
    allowed,
    source: resolvePath(policyPath),
    reason: allowed ? "Action allowed by policy." : "Action policy did not allow this operation."
  };
}
async function defaultRuntimeSummary(cwd) {
  const appJsonPath = resolvePath(cwd, "app.json");
  const text = await fs4.readFile(appJsonPath, "utf8").catch(() => null);
  if (!text) return null;
  const parsed = JSON.parse(text);
  const expo = isRecord5(parsed.expo) ? parsed.expo : parsed;
  const ios = isRecord5(expo.ios) ? expo.ios : {};
  const android = isRecord5(expo.android) ? expo.android : {};
  return {
    appConfig: {
      iosBundleIdentifier: stringFrom(ios.bundleIdentifier) ?? stringFrom(expo.bundleIdentifier),
      androidPackage: stringFrom(android.package) ?? stringFrom(expo.package)
    }
  };
}
async function defaultListDiagnosticReports() {
  const directory = joinPath(homedir(), "Library", "Logs", "DiagnosticReports");
  const entries = await fs4.readdir(directory, { withFileTypes: true }).catch(() => []);
  const reports = await Promise.all(entries.filter((entry) => entry.isFile() && /\.(ips|crash)$/.test(entry.name)).map(async (entry) => {
    const file = joinPath(directory, entry.name);
    const stat8 = await fs4.stat(file);
    return {
      name: entry.name,
      path: file,
      isFile: true,
      mtimeMs: stat8.mtimeMs,
      mtimeIso: stat8.mtime.toISOString(),
      content: await fs4.readFile(file, "utf8").catch(() => "")
    };
  }));
  return reports;
}
function truncateSubprocessOutput(value, limit = MAX_OUTPUT6) {
  const text = value == null ? "" : String(value);
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}
[truncated ${text.length - limit} characters]`;
}
function androidDeviceArgs(device, args) {
  const requested = optionalString3(device);
  return requested ? ["-s", requested, ...args] : args;
}
function clampNumber8(value, min, max) {
  const number = finiteNumber(value);
  return Math.min(max, Math.max(min, number));
}
function escapePredicateValue(value) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
function isRecord5(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function finiteNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`Expected a finite number, got ${String(value)}.`);
  return number;
}
function optionalString3(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
function platformArg(value) {
  return value === "android" ? "android" : "ios";
}
function policyDeniedPayload(action, policy) {
  return {
    available: false,
    domain: "app",
    action,
    source: "policy",
    evidenceSource: "policy",
    code: "policy-denied",
    denied: true,
    reason: "Policy denied action.",
    policy
  };
}
function parseCrashReportMetadata(content) {
  const firstLine = content.split(/\r?\n/, 1)[0]?.trim();
  if (!firstLine?.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(firstLine);
    return isRecord5(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
function requireString6(value, field) {
  const text = optionalString3(value);
  if (!text) throw new Error(`${field} must be a non-empty string.`);
  return text;
}
function stringFrom(value) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

// src/modules/route-url-actions/src/main/index.ts
import { execFile as nodeExecFile6 } from "node:child_process";
import * as fs5 from "node:fs/promises";
import path4 from "node:path";
var MAX_OUTPUT7 = 4e4;
function requireString7(value, field) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${field} must be a non-empty string.`);
  }
  return value.trim();
}
function requireOptionalString2(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
async function buildExpoRouteUrl(cwd, args = {}) {
  const scheme = requireOptionalString2(args.scheme) ?? await inferExpoScheme(cwd);
  if (!scheme) throw new Error("Could not infer Expo scheme. Pass scheme or url.");
  const rawRoute = requireOptionalString2(args.route) ?? "/";
  const route = rawRoute.startsWith("/") ? rawRoute.slice(1) : rawRoute;
  const params = new URLSearchParams(requireOptionalString2(args.query) ?? "");
  const authCookie = requireOptionalString2(args.authCookie);
  if (authCookie) params.set("cookie", authCookie);
  const query = params.toString();
  return `${scheme}:///${route}${query ? `?${query}` : ""}`;
}
async function inferExpoScheme(cwd) {
  const appJsonPath = path4.join(cwd, "app.json");
  if (await pathExists2(appJsonPath)) {
    const appJson = await readJsonFile3(appJsonPath);
    const expo = isRecord6(appJson.expo) ? appJson.expo : {};
    const scheme = expo.scheme ?? appJson.scheme;
    if (typeof scheme === "string" && scheme.trim()) return scheme.trim();
  }
  const configPath = await firstExisting2(cwd, ["app.config.ts", "app.config.js", "app.config.mjs", "app.config.cjs"]);
  if (!configPath) return null;
  const text = await fs5.readFile(configPath, "utf8");
  const match = /\bscheme\s*:\s*["'`]([^"'`]+)["'`]/.exec(text);
  return match?.[1] ?? null;
}
function redactUrlAuthCookie(url) {
  try {
    const parsed = new URL(url);
    for (const key of [...parsed.searchParams.keys()]) {
      if (isSensitiveQueryKey(key)) parsed.searchParams.set(key, "[redacted]");
    }
    return parsed.toString();
  } catch {
    return redactSensitiveUrlQuery(url);
  }
}
function androidDeviceArgs2(device, args) {
  return device ? ["-s", device, ...args] : [...args];
}
async function resolveIosDevice(requested, options = {}, deps = {}) {
  if (requested && /^[0-9A-Fa-f-]{20,}$/.test(requested)) {
    return { udid: requested, name: requested, state: "unknown" };
  }
  const execFile11 = deps.execFile ?? defaultExecFile2;
  const { stdout } = await execFile11("xcrun", ["simctl", "list", "devices", "available", "--json"], {
    timeout: 2e4,
    maxBuffer: 4 * 1024 * 1024
  });
  const parsed = JSON.parse(String(stdout ?? "{}"));
  const devices = Object.entries(parsed.devices ?? {}).flatMap(
    ([runtime2, runtimeDevices]) => (Array.isArray(runtimeDevices) ? runtimeDevices : []).map((device) => ({ ...device, runtime: runtime2 }))
  );
  if (requested) {
    const exact = devices.find((device) => device.udid === requested || device.name === requested);
    if (exact) return exact;
    const partial = devices.find((device) => String(device.name).toLowerCase().includes(requested.toLowerCase()));
    if (partial) return partial;
    throw new Error(`No available iOS simulator matched: ${requested}`);
  }
  if (options.preferBooted) {
    const booted = devices.find((device) => device.state === "Booted");
    if (booted) return booted;
  }
  const iphone = [...devices].reverse().find((device) => /iPhone/.test(device.name));
  if (iphone) return iphone;
  if (devices[0]) return devices[0];
  throw new Error("No available iOS simulators found.");
}
async function openUrl(args, deps = {}) {
  const platform = args.platform ?? "ios";
  const url = requireString7(args.url, "url");
  if (/\s/.test(url)) throw new Error("url must not contain whitespace.");
  const execFile11 = deps.execFile ?? defaultExecFile2;
  if (platform === "android") {
    const adbArgs = androidDeviceArgs2(args.device, ["shell", "am", "start", "-a", "android.intent.action.VIEW", "-d", url]);
    const result2 = await execFile11("adb", adbArgs, { timeout: 3e4, rejectOnError: false });
    return toolJson9(redactToolPayload({ platform, device: args.device ?? null, stdout: truncate8(result2.stdout), stderr: truncate8(result2.stderr) }));
  }
  const device = await resolveIosDevice(args.device, { preferBooted: true }, deps);
  const result = await execFile11("xcrun", ["simctl", "openurl", device.udid, url], {
    timeout: 3e4,
    rejectOnError: false
  });
  return toolJson9(redactToolPayload({ platform, device, stdout: truncate8(result.stdout), stderr: truncate8(result.stderr) }));
}
async function openExpoRoute(args, deps = {}) {
  const cwd = await normalizeProjectCwd(args.cwd, { allowMissingPackageJson: true });
  const device = await resolveIosDevice(args.device, { preferBooted: true }, deps);
  const url = args.url ? requireString7(args.url, "url") : await buildExpoRouteUrl(cwd, args);
  if (/\s/.test(url)) throw new Error("url must not contain whitespace.");
  const execFile11 = deps.execFile ?? defaultExecFile2;
  const result = await execFile11("xcrun", ["simctl", "openurl", device.udid, url], {
    timeout: 3e4,
    rejectOnError: false
  });
  return toolJson9(redactToolPayload({
    platform: "ios",
    device,
    url: redactUrlAuthCookie(url),
    stdout: truncate8(result.stdout),
    stderr: truncate8(result.stderr),
    error: normalizeExecError(result.error)
  }));
}
async function normalizeProjectCwd(cwd, options = {}) {
  const resolved = await normalizeCwd3(cwd);
  if (options.allowMissingPackageJson) return resolved;
  const packageJson = await findUp2(resolved, "package.json");
  if (!packageJson) throw new Error(`No package.json found from ${resolved}. Pass cwd for an Expo project.`);
  return path4.dirname(packageJson);
}
async function normalizeCwd3(cwd) {
  const resolved = path4.resolve(cwd ?? ".");
  const stat8 = await fs5.stat(resolved).catch(() => null);
  if (!stat8?.isDirectory()) throw new Error(`Directory does not exist: ${resolved}`);
  return resolved;
}
async function findUp2(startDir, filename) {
  let current = path4.resolve(startDir);
  while (true) {
    const candidate = path4.join(current, filename);
    if (await pathExists2(candidate)) return candidate;
    const parent = path4.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}
async function firstExisting2(root, names) {
  for (const name of names) {
    const candidate = path4.join(root, name);
    if (await pathExists2(candidate)) return candidate;
  }
  return null;
}
async function pathExists2(file) {
  return fs5.access(file).then(() => true, () => false);
}
async function readJsonFile3(file) {
  return JSON.parse(await fs5.readFile(file, "utf8"));
}
function toolJson9(value) {
  return { content: [{ type: "text", text: `${JSON.stringify(value, null, 2)}
` }] };
}
function truncate8(value, limit = MAX_OUTPUT7) {
  const text = String(value ?? "");
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}
[truncated ${text.length - limit} characters]`;
}
function redactToolPayload(value) {
  return redactUnknown(value);
}
function redactUnknown(value) {
  if (typeof value === "string") return redactSensitiveUrlQuery(value);
  if (Array.isArray(value)) return value.map((item) => redactUnknown(item));
  if (isRecord6(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactUnknown(item)]));
  }
  return value;
}
function normalizeExecError(error) {
  if (!error) return error ?? null;
  return redactToolPayload({
    message: typeof error.message === "string" ? error.message : void 0,
    code: error.code ?? null,
    signal: error.signal ?? null
  });
}
function redactSensitiveUrlQuery(value) {
  return value.replace(
    /([?&][^=\s&]*(?:cookie|token|authorization|password|secret)[^=\s&]*=)[^&\s]+/gi,
    "$1[redacted]"
  );
}
function isSensitiveQueryKey(key) {
  return /cookie|token|authorization|password|secret/i.test(key);
}
function isRecord6(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
var defaultExecFile2 = (file, args, options = {}) => new Promise((resolve15, reject) => {
  const { timeout = 6e4, maxBuffer = MAX_OUTPUT7, rejectOnError = true } = options;
  nodeExecFile6(file, [...args], { timeout: Number(timeout), maxBuffer: Number(maxBuffer) }, (error, stdout, stderr) => {
    if (error && rejectOnError) {
      Object.assign(error, { stdout, stderr });
      reject(error);
      return;
    }
    resolve15({
      stdout: String(stdout ?? ""),
      stderr: String(stderr ?? ""),
      error: error ? { message: error.message, code: error.code, signal: error.signal } : void 0
    });
  });
});

// src/modules/interaction-actions/src/main/index.ts
import { execFile as nodeExecFile7, spawn as nodeSpawn } from "node:child_process";
import * as fs7 from "node:fs/promises";
import { tmpdir as osTmpdir } from "node:os";
import { basename as basename4, join as joinPath2 } from "node:path";

// src/modules/interaction-trace-expression/src/main/index.ts
async function traceInteraction(args = {}, deps = defaultTraceInteractionDependencies) {
  const metroPort = clampNumber9(args.metroPort ?? 8081, 1, 65535);
  const action = args.action;
  const maxEvents = clampNumber9(args.maxEvents ?? 300, 1, 2e3);
  const includeEvents = args.includeEvents === true;
  const componentFilter = requireOptionalString3(args.componentFilter);
  const targets = await deps.fetchMetroTargets(metroPort).catch(() => []);
  const targetList = Array.isArray(targets) ? targets : [];
  const webSocketDebuggerUrl = asString(asRecord4(targetList[0])?.webSocketDebuggerUrl);
  if (!webSocketDebuggerUrl) {
    return toolJson10({
      available: false,
      action,
      reason: "No Metro inspector target.",
      metroPort,
      limitations: [
        "No Hermes Runtime.evaluate trace was collected.",
        "React commits, layout changes, animation frames, and handler-bearing components are unavailable for this read."
      ]
    });
  }
  const expression = interactionTraceExpression({ action, maxEvents, componentFilter, includeEvents });
  const result = await deps.evaluateHermesExpression(webSocketDebuggerUrl, expression, { timeoutMs: 8e3 });
  return toolJson10({
    action,
    metroPort,
    target: targetSummary2(targetList[0]),
    trace: getPath(result, ["result", "result", "value"]) ?? null,
    protocolError: getPath(result, ["result", "exceptionDetails"]) ?? asRecord4(result)?.error ?? null,
    cdp: asRecord4(result)?.diagnostics ?? asRecord4(result)?.cdp ?? null
  });
}
var defaultTraceInteractionDependencies = {
  fetchMetroTargets: (metroPort) => metroTargets(metroPort),
  evaluateHermesExpression
};
function toolJson10(value) {
  return { content: [{ type: "text", text: `${JSON.stringify(value, null, 2)}
` }], isError: false };
}
function interactionTraceExpression({ action, maxEvents, componentFilter, includeEvents }) {
  return `(() => {
    const action = ${JSON.stringify(action)};
    const maxEvents = ${JSON.stringify(maxEvents)};
    const includeEvents = ${JSON.stringify(Boolean(includeEvents))};
    const componentFilter = ${JSON.stringify(componentFilter ?? "")};
    const filterNeedle = String(componentFilter || '').toLowerCase();
    const now = () => Math.round((typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now()) * 10) / 10;
    const globalKey = '__EXPO_LOCAL_DEV_INTERACTION_TRACE__';
    const tracer = globalThis[globalKey] ||= {
      installed: false,
      startedAt: null,
      events: [],
      lastSnapshot: new Map(),
      originals: {},
      errors: []
    };

    function short(value, max = 160) {
      if (value == null) return null;
      const text = String(value);
      return text.length > max ? text.slice(0, max) + '...' : text;
    }

    function push(type, payload = {}) {
      const event = { t: now(), type, ...payload };
      tracer.events.push(event);
      const hardLimit = Math.max(2000, maxEvents * 3);
      if (tracer.events.length > hardLimit) tracer.events.splice(0, tracer.events.length - hardLimit);
      return event;
    }

    function primitive(value) {
      return value == null || ['string', 'number', 'boolean'].includes(typeof value);
    }

    function typeName(type) {
      if (!type) return null;
      if (typeof type === 'string') return type;
      return type.displayName || type.name || type.render?.displayName || type.render?.name || type.type?.displayName || type.type?.name || null;
    }

    function fiberName(fiber) {
      return typeName(fiber.elementType) || typeName(fiber.type) || fiber._debugName || tagName(fiber.tag);
    }

    function tagName(tag) {
      const names = { 0: 'FunctionComponent', 1: 'ClassComponent', 3: 'HostRoot', 5: 'HostComponent', 6: 'HostText', 7: 'Fragment', 10: 'ContextProvider', 11: 'ForwardRef', 14: 'MemoComponent', 15: 'SimpleMemoComponent' };
      return names[tag] || ('FiberTag' + tag);
    }

    function debugSource(fiber) {
      const source = fiber?._debugSource;
      if (!source) return null;
      return { fileName: source.fileName || null, lineNumber: source.lineNumber || null, columnNumber: source.columnNumber || null };
    }

    function ownerName(fiber) {
      return fiber?._debugOwner ? fiberName(fiber._debugOwner) : null;
    }

    function flattenText(value, out = []) {
      if (out.join(' ').length > 220) return out;
      if (typeof value === 'string' || typeof value === 'number') {
        const text = String(value).trim();
        if (text) out.push(short(text, 100));
      } else if (Array.isArray(value)) {
        for (const item of value.slice(0, 16)) flattenText(item, out);
      }
      return out;
    }

    const layoutKeys = [
      'display','position','top','right','bottom','left','width','height','minWidth','minHeight','maxWidth','maxHeight',
      'flex','flexGrow','flexShrink','flexBasis','flexDirection','alignItems','alignSelf','justifyContent',
      'gap','rowGap','columnGap','margin','marginTop','marginRight','marginBottom','marginLeft',
      'padding','paddingTop','paddingRight','paddingBottom','paddingLeft','textAlign','overflow',
      'transform','opacity'
    ];
    const classKeys = ['className', 'contentContainerClassName'];
    const styleKeys = ['style', 'contentContainerStyle', 'containerStyle', 'indicatorStyle'];
    const handlerKeys = [
      'onScroll','onScrollBeginDrag','onScrollEndDrag','onMomentumScrollBegin','onMomentumScrollEnd',
      'onTouchStart','onTouchMove','onTouchEnd','onResponderGrant','onResponderMove','onResponderRelease',
      'onStartShouldSetResponder','onMoveShouldSetResponder','onGestureEvent','onHandlerStateChange',
      'onPress','onPressIn','onPressOut','onLongPress'
    ];

    function summarizeStyle(style, depth = 0) {
      if (!style || depth > 4) return null;
      if (typeof style === 'number') return { stylesheetId: style };
      if (Array.isArray(style)) {
        const merged = {};
        for (const item of style.slice(0, 12)) {
          const part = summarizeStyle(item, depth + 1);
          if (part && typeof part === 'object' && !Array.isArray(part)) Object.assign(merged, part);
        }
        return Object.keys(merged).length ? merged : null;
      }
      if (typeof style !== 'object') return null;
      const summary = {};
      for (const key of layoutKeys) {
        if (primitive(style[key])) summary[key] = style[key];
        else if (key === 'transform' && Array.isArray(style[key])) {
          try { summary[key] = JSON.parse(JSON.stringify(style[key].slice(0, 8))); } catch {}
        }
      }
      return Object.keys(summary).length ? summary : null;
    }

    function summarizeProps(props) {
      if (!props || typeof props !== 'object') return {};
      const summary = {};
      for (const key of ['accessibilityLabel','accessibilityRole','testID','nativeID','pointerEvents']) {
        if (primitive(props[key])) summary[key] = short(props[key], 140);
      }
      const text = flattenText(props.children).join(' ');
      if (text) summary.text = short(text, 180);
      for (const key of classKeys) {
        if (typeof props[key] === 'string' && props[key].trim()) summary[key] = short(props[key], 240);
      }
      for (const key of styleKeys) {
        const style = summarizeStyle(props[key]);
        if (style) summary[key] = style;
      }
      const handlers = handlerKeys.filter((key) => typeof props[key] === 'function');
      if (handlers.length) summary.handlers = handlers;
      return summary;
    }

    function matches(info) {
      if (!filterNeedle) return true;
      return [info.name, info.owner, info.label, info.testID, info.text, info.className, info.contentContainerClassName, info.source?.fileName]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(filterNeedle));
    }

    function walk(root) {
      const nodes = [];
      let truncated = false;
      function visit(fiber, depth, parentId, path) {
        if (!fiber || nodes.length >= 1800) {
          if (fiber) truncated = true;
          return;
        }
        const props = summarizeProps(fiber.memoizedProps);
        const label = props.accessibilityLabel || props.text || null;
        const info = {
          id: nodes.length + 1,
          parentId,
          depth,
          path,
          name: fiberName(fiber),
          owner: ownerName(fiber),
          label,
          text: props.text || null,
          testID: props.testID || null,
          role: props.accessibilityRole || null,
          className: props.className || null,
          contentContainerClassName: props.contentContainerClassName || null,
          source: debugSource(fiber),
          layout: {
            className: props.className || null,
            contentContainerClassName: props.contentContainerClassName || null,
            style: props.style || null,
            contentContainerStyle: props.contentContainerStyle || null,
            containerStyle: props.containerStyle || null,
            indicatorStyle: props.indicatorStyle || null,
            pointerEvents: props.pointerEvents || null
          },
          handlers: props.handlers || []
        };
        nodes.push(info);
        let child = fiber.child;
        let index = 0;
        while (child) {
          visit(child, depth + 1, info.id, path + '.' + index);
          child = child.sibling;
          index += 1;
        }
      }
      visit(root?.current?.child, 0, null, '0');
      return { nodes, truncated };
    }

    function layoutSignature(info) {
      return JSON.stringify(info.layout || {});
    }

    function handleCommit(root, reason = 'reactCommit') {
      const result = walk(root);
      const changed = [];
      const active = [];
      for (const info of result.nodes) {
        const sig = layoutSignature(info);
        const prev = tracer.lastSnapshot.get(info.path);
        if (matches(info) && (info.handlers.length || info.label || info.testID || /Animated|Scroll|Gesture|Pressable|Calendar|Draft|Event|Glass|Tab|Screen|Route/.test(info.name))) {
          active.push({
            id: info.id,
            parentId: info.parentId,
            depth: info.depth,
            name: info.name,
            owner: info.owner,
            label: info.label,
            role: info.role,
            testID: info.testID,
            handlers: info.handlers,
            layout: info.layout
          });
        }
        if (matches(info) && prev && prev !== sig) {
          changed.push({
            id: info.id,
            parentId: info.parentId,
            depth: info.depth,
            name: info.name,
            owner: info.owner,
            label: info.label,
            role: info.role,
            testID: info.testID,
            before: safeParse(prev),
            after: info.layout
          });
        }
        tracer.lastSnapshot.set(info.path, sig);
      }
      push(reason, {
        nodeCount: result.nodes.length,
        truncated: result.truncated,
        changedLayout: changed.slice(0, 40),
        activeElements: active.slice(0, 24)
      });
    }

    function safeParse(text) {
      try { return JSON.parse(text); } catch { return text; }
    }

    function compactLayout(layout) {
      if (!layout || typeof layout !== 'object') return null;
      return {
        className: layout.className || null,
        contentContainerClassName: layout.contentContainerClassName || null,
        style: layout.style || null,
        contentContainerStyle: layout.contentContainerStyle || null,
        containerStyle: layout.containerStyle || null,
        indicatorStyle: layout.indicatorStyle || null,
        pointerEvents: layout.pointerEvents || null
      };
    }

    function compactElement(info) {
      if (!info || typeof info !== 'object') return null;
      return {
        id: info.id ?? null,
        parentId: info.parentId ?? null,
        depth: info.depth ?? null,
        name: info.name || null,
        owner: info.owner || null,
        label: info.label || null,
        role: info.role || null,
        testID: info.testID || null,
        handlers: Array.isArray(info.handlers) ? info.handlers.slice(0, 16) : [],
        layout: compactLayout(info.layout)
      };
    }

    function compactChange(change) {
      if (!change || typeof change !== 'object') return null;
      return {
        id: change.id ?? null,
        parentId: change.parentId ?? null,
        depth: change.depth ?? null,
        name: change.name || null,
        owner: change.owner || null,
        label: change.label || null,
        role: change.role || null,
        testID: change.testID || null,
        before: compactLayout(change.before),
        after: compactLayout(change.after)
      };
    }

    function compactEvent(event) {
      const out = {
        t: event.t,
        type: event.type
      };
      if (event.filter != null) out.filter = event.filter;
      if (event.message) out.message = event.message;
      if (event.nodeCount != null) out.nodeCount = event.nodeCount;
      if (event.truncated != null) out.truncated = event.truncated;
      if (event.frameTime != null) out.frameTime = event.frameTime;
      if (event.changedLayout?.length) {
        out.changedLayoutCount = event.changedLayout.length;
        out.changedComponents = event.changedLayout.slice(0, 8).map((item) => ({
          name: item?.name || null,
          owner: item?.owner || null,
          label: item?.label || null,
          testID: item?.testID || null
        }));
      }
      if (event.activeElements?.length) {
        out.activeElementCount = event.activeElements.length;
        out.activeComponents = event.activeElements.slice(0, 8).map((item) => ({
          name: item?.name || null,
          owner: item?.owner || null,
          label: item?.label || null,
          testID: item?.testID || null,
          handlers: Array.isArray(item?.handlers) ? item.handlers.slice(0, 8) : []
        }));
      }
      return out;
    }

    function install() {
      tracer.filter = componentFilter || null;
      if (tracer.installed) {
        push('traceAlreadyInstalled', { filter: tracer.filter });
        return;
      }
      tracer.installed = true;
      tracer.startedAt = new Date().toISOString();
      const hook = globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__;
      if (hook && typeof hook.getFiberRoots === 'function') {
        tracer.originals.onCommitFiberRoot = hook.onCommitFiberRoot;
        hook.onCommitFiberRoot = function tracedCommit(...args) {
          try { handleCommit(args[1]); } catch (error) { tracer.errors.push(short(error?.message || error, 220)); }
          if (typeof tracer.originals.onCommitFiberRoot === 'function') return tracer.originals.onCommitFiberRoot.apply(this, args);
        };
        for (const rendererId of Array.from(hook.renderers?.keys?.() || [])) {
          for (const root of Array.from(hook.getFiberRoots(rendererId) || [])) {
            try { handleCommit(root, 'initialTree'); } catch (error) { tracer.errors.push(short(error?.message || error, 220)); }
          }
        }
      } else {
        push('warning', { message: 'React DevTools hook not available; only requestAnimationFrame patch can be installed.' });
      }
      if (typeof globalThis.requestAnimationFrame === 'function' && !tracer.originals.requestAnimationFrame) {
        tracer.originals.requestAnimationFrame = globalThis.requestAnimationFrame;
        globalThis.requestAnimationFrame = function tracedRaf(callback) {
          push('requestAnimationFrame', {});
          return tracer.originals.requestAnimationFrame.call(this, function tracedRafCallback(ts) {
            push('animationFrame', { frameTime: ts });
            return callback(ts);
          });
        };
      }
      push('traceStarted', { filter: tracer.filter });
    }

    function read() {
      const events = tracer.events.slice(-maxEvents);
      const counts = {};
      const handlers = {};
      const components = {};
      const layoutChanges = [];
      const activeElements = new Map();
      for (const event of events) {
        counts[event.type] = (counts[event.type] || 0) + 1;
        if (event.handler) handlers[event.handler] = (handlers[event.handler] || 0) + 1;
        if (event.component) components[event.component] = (components[event.component] || 0) + 1;
        if (event.changedLayout?.length) {
          layoutChanges.push(...event.changedLayout);
          for (const item of event.changedLayout) {
            if (item?.name) components[item.name] = (components[item.name] || 0) + 1;
          }
        }
        if (event.activeElements?.length) {
          for (const item of event.activeElements) {
            if (item?.name) components[item.name] = (components[item.name] || 0) + 1;
            for (const handler of item?.handlers || []) handlers[handler] = (handlers[handler] || 0) + 1;
            const key = [item?.name, item?.owner, item?.label, item?.testID, item?.depth].filter(Boolean).join('|');
            if (key) activeElements.set(key, compactElement(item));
          }
        }
      }
      const top = (object) => Object.entries(object).sort((a, b) => b[1] - a[1]).slice(0, 20).map(([name, count]) => ({ name, count }));
      const compactEvents = events.map(compactEvent);
      const response = {
        available: true,
        installed: tracer.installed,
        startedAt: tracer.startedAt,
        filter: tracer.filter || null,
        eventCount: tracer.events.length,
        returnedEventCount: events.length,
        counts,
        topDeclaredHandlers: top(handlers),
        topComponents: top(components),
        activeElements: Array.from(activeElements.values()).slice(-30),
        layoutChanges: layoutChanges.slice(-40).map(compactChange).filter(Boolean),
        recentEvents: compactEvents.slice(-20),
        errors: tracer.errors.slice(-20),
        interpretationHints: [
          'Scroll or drag bugs usually show reactCommit/layout changes and handler-bearing components such as onScroll/onResponderMove/onGestureEvent near the affected subtree.',
          'This tracer does not wrap app event handlers; topDeclaredHandlers reports handler props present in the committed tree, not handler invocations.',
          'If requestAnimationFrame/animationFrame is active but no React commits occur, the animation may be native-driver/Reanimated/UI-thread and needs screenshot/video or native instrumentation.',
          'changedLayout is declared prop/class/style churn, not final Yoga frame movement.'
        ]
      };
      if (includeEvents) response.events = events;
      return response;
    }

    function stop() {
      const hook = globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__;
      if (hook && tracer.originals && Object.prototype.hasOwnProperty.call(tracer.originals, 'onCommitFiberRoot')) {
        hook.onCommitFiberRoot = tracer.originals.onCommitFiberRoot;
      }
      if (tracer.originals?.requestAnimationFrame) {
        globalThis.requestAnimationFrame = tracer.originals.requestAnimationFrame;
      }
      tracer.installed = false;
      push('traceStopped', {});
      return read();
    }

    if (action === 'start') {
      tracer.events = [];
      tracer.errors = [];
      tracer.lastSnapshot = new Map();
      install();
      return read();
    }
    if (action === 'read') return read();
    if (action === 'clear') {
      tracer.events = [];
      tracer.errors = [];
      tracer.lastSnapshot = new Map();
      push('traceCleared', {});
      return read();
    }
    if (action === 'stop') return stop();
    return { available: false, reason: 'Unknown trace action: ' + action };
  })()`;
}
function targetSummary2(target) {
  const record = asRecord4(target);
  if (!record) return null;
  return {
    title: record.title,
    appId: record.appId,
    deviceName: record.deviceName,
    description: record.description
  };
}
function requireOptionalString3(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
function clampNumber9(value, min, max) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) {
    throw new Error(`Expected a finite number, got ${value}.`);
  }
  return Math.min(Math.max(numberValue, min), max);
}
function getPath(value, path12) {
  let current = value;
  for (const key of path12) {
    current = asRecord4(current)?.[key];
  }
  return current;
}
function asString(value) {
  return typeof value === "string" && value.trim() ? value : null;
}
function asRecord4(value) {
  return value && typeof value === "object" ? value : null;
}

// src/modules/screenshot-capture/src/main/index.ts
import * as fs6 from "node:fs/promises";
import * as os from "node:os";
import * as path5 from "node:path";
import { execFile as execFile5, spawn } from "node:child_process";
var MAX_OUTPUT8 = 4e4;
async function automationTakeScreenshot(args, deps = {}) {
  if (args.full === true) {
    return toolJson11(await (deps.captureFullScreenshot ?? captureFullScreenshot)(args, deps));
  }
  if (args.annotate === true) {
    return toolJson11(await (deps.annotatedScreenshot ?? annotatedScreenshot)(args, deps));
  }
  return toolJson11(await (deps.captureScreenshot ?? captureScreenshot)(args, deps));
}
async function captureFullScreenshot(args, deps = {}) {
  const platform = args.platform ?? "ios";
  if (platform !== "ios") {
    return {
      available: false,
      reason: "Segmented full-page capture is currently implemented for iOS simulator targets only.",
      mode: "full",
      platform
    };
  }
  const axe = await commandPath3("axe", deps);
  if (!axe) {
    return {
      available: false,
      reason: "Full-page capture requires the axe CLI to perform real simulator scroll gestures.",
      mode: "full",
      platform
    };
  }
  const magick = await commandPath3("magick", deps);
  if (!magick) {
    return {
      available: false,
      reason: "Full-page capture requires ImageMagick's magick command to stitch captured viewport segments.",
      mode: "full",
      platform
    };
  }
  const device = await resolveIosDevice2(args.device, deps);
  const outputPath = path5.resolve(
    args.outputPath ?? path5.join(os.tmpdir(), "expo-ios-screenshots", `full-screenshot-${safeTimestamp(deps)}.png`)
  );
  const segmentCount = clampNumber10(args.fullSegments ?? args.segments ?? 3, 1, 12);
  const segmentDir = path5.join(path5.dirname(outputPath), `${path5.basename(outputPath, path5.extname(outputPath))}-segments`);
  await mkdir8(segmentDir, deps);
  const segments = [];
  const firstPath = path5.join(segmentDir, "segment-000.png");
  const first = await (deps.captureScreenshot ?? captureScreenshot)(
    { ...args, full: false, annotate: false, outputPath: firstPath, device: device.udid, platform },
    deps
  );
  if (isUnavailable(first)) return first;
  segments.push(firstPath);
  const dimensions = await imageDimensions(magick, firstPath, deps);
  const width = dimensions?.width ?? 390;
  const height = dimensions?.height ?? 844;
  const startX = Math.max(1, Math.round(width / 2));
  const startY = Math.max(1, Math.round(height * 0.82));
  const endY = Math.max(1, Math.round(height * 0.28));
  const gestureResults = [];
  for (let index = 1; index < segmentCount; index += 1) {
    const gesture = await execFilePromise2(axe, [
      "swipe",
      "--start-x",
      String(startX),
      "--start-y",
      String(startY),
      "--end-x",
      String(startX),
      "--end-y",
      String(endY),
      "--duration",
      "0.45",
      "--udid",
      device.udid
    ], { timeout: 1e4, rejectOnError: false }, deps);
    gestureResults.push({
      index,
      stdout: truncate9(gesture.stdout),
      stderr: truncate9(gesture.stderr),
      error: gesture.error ?? null
    });
    if (gesture.error) break;
    await wait(300, deps);
    const segmentPath = path5.join(segmentDir, `segment-${String(index).padStart(3, "0")}.png`);
    const segment = await (deps.captureScreenshot ?? captureScreenshot)(
      { ...args, full: false, annotate: false, outputPath: segmentPath, device: device.udid, platform },
      deps
    );
    if (isUnavailable(segment)) break;
    segments.push(segmentPath);
  }
  for (let index = 1; index < segments.length; index += 1) {
    await execFilePromise2(axe, [
      "swipe",
      "--start-x",
      String(startX),
      "--start-y",
      String(endY),
      "--end-x",
      String(startX),
      "--end-y",
      String(startY),
      "--duration",
      "0.25",
      "--udid",
      device.udid
    ], { timeout: 1e4, rejectOnError: false }, deps);
  }
  await mkdir8(path5.dirname(outputPath), deps);
  const stitch = await execFilePromise2(magick, [...segments, "-append", outputPath], {
    timeout: 3e4,
    rejectOnError: false
  }, deps);
  if (stitch.error || !await defaultPathExists2(outputPath, deps)) {
    return {
      available: false,
      reason: "Captured scroll segments but failed to stitch the full screenshot artifact.",
      mode: "full",
      platform,
      device,
      outputPath,
      segmentDir,
      segments,
      stitch: {
        stdout: truncate9(stitch.stdout),
        stderr: truncate9(stitch.stderr),
        error: stitch.error
      }
    };
  }
  return {
    available: true,
    mode: "full",
    strategy: "segmented-scroll-stitch",
    platform,
    device,
    outputPath,
    segmentDir,
    segments,
    segmentCount: segments.length,
    tools: { gesture: "axe", stitch: "magick" },
    limitation: "iOS Simulator does not expose a stable native full-page screenshot API for arbitrary React Native views; this artifact stitches real viewport screenshots captured after simulator scroll gestures.",
    gestures: gestureResults,
    stitch: {
      stdout: truncate9(stitch.stdout),
      stderr: truncate9(stitch.stderr)
    }
  };
}
async function imageDimensions(magick, imagePath, deps = {}) {
  const result = await execFilePromise2(magick, ["identify", "-format", "%w %h", imagePath], {
    timeout: 5e3,
    rejectOnError: false
  }, deps);
  if (result.error) return null;
  const match = String(result.stdout ?? "").trim().match(/^(\d+)\s+(\d+)$/);
  if (!match) return null;
  return { width: Number(match[1]), height: Number(match[2]) };
}
async function captureScreenshot(args, deps = {}) {
  const platform = args.platform ?? "ios";
  const outputPath = path5.resolve(
    args.outputPath ?? path5.join(os.tmpdir(), "expo-ios-screenshots", `screenshot-${safeTimestamp(deps)}.png`)
  );
  await mkdir8(path5.dirname(outputPath), deps);
  if (platform === "android") {
    await adbScreenshot(args.device, outputPath, deps);
    return { platform, device: args.device ?? null, outputPath };
  }
  const device = await resolveIosDevice2(args.device, deps);
  const result = await execFilePromise2("xcrun", ["simctl", "io", device.udid, "screenshot", outputPath], {
    timeout: 3e4,
    rejectOnError: false
  }, deps);
  if (result.error || !await defaultPathExists2(outputPath, deps)) {
    return {
      available: false,
      reason: "Screenshot tooling failed.",
      platform,
      device,
      outputPath,
      stdout: truncate9(result.stdout),
      stderr: truncate9(result.stderr),
      error: result.error
    };
  }
  return {
    platform,
    device,
    outputPath,
    stdout: truncate9(result.stdout),
    stderr: truncate9(result.stderr)
  };
}
async function annotatedScreenshot(args, deps = {}) {
  const cache = await readLatestRefCache3(args, deps);
  if (!cache) {
    return { available: false, reason: "No snapshot exists for the current session." };
  }
  const labelMap = buildScreenshotLabelMap(cache);
  if (labelMap.available === false) return labelMap;
  const screenshot = asRecord5(await captureScreenshot({ ...args, annotate: false }, deps));
  if (screenshot.available === false) return screenshot;
  const outputPath = String(screenshot.outputPath);
  const artifacts = annotatedScreenshotArtifactPaths(outputPath);
  const labels = asRecord5(labelMap).labels ?? [];
  await writeJsonFile2(artifacts.labelMap, {
    schemaVersion: 1,
    createdAt: deps.nowIso?.() ?? (/* @__PURE__ */ new Date()).toISOString(),
    screenshot: outputPath,
    annotatedImage: artifacts.annotatedImage,
    snapshotId: cache.snapshotId,
    targetId: cache.targetId,
    labels
  }, deps);
  await writeFile5(artifacts.annotatedImage, annotatedScreenshotSvg({ screenshotPath: outputPath, labels }), "utf8", deps);
  return {
    ...screenshot,
    available: true,
    annotated: true,
    snapshotId: cache.snapshotId,
    targetId: cache.targetId,
    artifacts: {
      screenshot: outputPath,
      annotatedImage: artifacts.annotatedImage,
      labelMap: artifacts.labelMap
    },
    labels
  };
}
function buildScreenshotLabelMap(cache) {
  const refs = cache.refs ?? [];
  const targetMismatch = refs.filter(
    (record) => record.snapshotId !== cache.snapshotId || record.targetId !== cache.targetId
  );
  if (targetMismatch.length > 0) {
    return {
      available: false,
      reason: "Ref cache contains refs from a different snapshot or target.",
      snapshotId: cache.snapshotId ?? null,
      targetId: cache.targetId ?? null,
      mismatchedRefs: targetMismatch.map((record) => record.ref)
    };
  }
  const activeRefs = refs.filter((record) => record.stale !== true);
  const missingBounds = activeRefs.filter((record) => !record.box);
  if (missingBounds.length > 0) {
    return {
      available: false,
      reason: "Cannot annotate screenshot because one or more refs do not include bounds.",
      snapshotId: cache.snapshotId ?? null,
      targetId: cache.targetId ?? null,
      missingRefs: missingBounds.map((record) => record.ref)
    };
  }
  if (activeRefs.length === 0) {
    return {
      available: false,
      reason: "No bounded refs are available for annotation.",
      snapshotId: cache.snapshotId ?? null,
      targetId: cache.targetId ?? null
    };
  }
  return {
    available: true,
    labels: activeRefs.map((record, index) => ({
      ref: record.ref,
      label: record.label ?? record.text ?? record.role ?? record.ref,
      role: record.role ?? null,
      text: record.text ?? null,
      source: record.source ?? null,
      box: record.box,
      snapshotId: cache.snapshotId,
      targetId: cache.targetId,
      index: index + 1
    }))
  };
}
function annotatedScreenshotArtifactPaths(outputPath) {
  const ext = path5.extname(outputPath);
  const base = ext ? outputPath.slice(0, -ext.length) : outputPath;
  return {
    labelMap: `${base}.labels.json`,
    annotatedImage: `${base}.annotated.svg`
  };
}
function annotatedScreenshotSvg(args) {
  const { width, height } = screenshotOverlaySize(args.labels);
  const imageHref = escapeHtml(path5.basename(args.screenshotPath));
  const labelSvg = args.labels.map((label) => {
    const box = label.box;
    const textX = Math.max(0, box.x);
    const textY = Math.max(16, box.y - 6);
    const text = `${label.index}. ${label.ref}`;
    return [
      `<rect x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" fill="none" stroke="#ff3b30" stroke-width="2"/>`,
      `<rect x="${textX}" y="${textY - 15}" width="${Math.max(44, text.length * 8)}" height="18" fill="#ff3b30"/>`,
      `<text x="${textX + 4}" y="${textY - 2}" fill="#fff" font-family="Menlo, monospace" font-size="12">${escapeHtml(text)}</text>`
    ].join("\n");
  }).join("\n");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <image href="${imageHref}" x="0" y="0" width="${width}" height="${height}" preserveAspectRatio="xMinYMin meet"/>
  ${labelSvg}
</svg>
`;
}
function screenshotOverlaySize(labels) {
  const maxX = Math.max(390, ...labels.map((label) => label.box.x + label.box.width + 24));
  const maxY = Math.max(844, ...labels.map((label) => label.box.y + label.box.height + 24));
  return { width: Math.ceil(maxX), height: Math.ceil(maxY) };
}
function escapeHtml(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function clampNumber10(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new Error(`Expected a finite number, got ${value}.`);
  }
  return Math.min(Math.max(number, min), max);
}
function truncate9(value, limit = MAX_OUTPUT8) {
  const text = String(value ?? "");
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}
[truncated ${text.length - limit} characters]`;
}
async function pathExists3(file, deps) {
  return deps.access(file).then(() => true, () => false);
}
function toolJson11(value) {
  return {
    content: [{ type: "text", text: `${JSON.stringify(value, null, 2)}
` }],
    isError: false
  };
}
async function execFilePromise2(file, args, options, deps = {}) {
  if (deps.execFile) return deps.execFile(file, args, options);
  return new Promise((resolve15, reject) => {
    execFile5(file, args, { timeout: options.timeout, maxBuffer: options.maxBuffer ?? MAX_OUTPUT8 }, (error, stdout, stderr) => {
      if (error && options.rejectOnError !== false) {
        reject(error);
        return;
      }
      const execError = error;
      resolve15({
        stdout: String(stdout ?? ""),
        stderr: String(stderr ?? ""),
        error: execError ? { message: execError.message, code: execError.code, signal: execError.signal } : null
      });
    });
  });
}
async function commandPath3(command, deps) {
  if (deps.commandPath) return deps.commandPath(command);
  const result = await execFilePromise2("sh", ["-lc", `command -v ${command}`], {
    timeout: 5e3,
    rejectOnError: false
  }, deps);
  return String(result.stdout ?? "").trim() || null;
}
async function resolveIosDevice2(requested, deps) {
  if (deps.resolveIosDevice) return deps.resolveIosDevice(requested, { preferBooted: true });
  if (requested && /^[0-9A-Fa-f-]{20,}$/.test(requested)) {
    return { udid: requested, name: requested, state: "unknown" };
  }
  const { stdout } = await execFilePromise2("xcrun", ["simctl", "list", "devices", "available", "--json"], {
    timeout: 2e4,
    maxBuffer: 4 * 1024 * 1024
  }, deps);
  const parsed = JSON.parse(String(stdout ?? "{}"));
  const devices = Object.entries(parsed.devices ?? {}).flatMap(
    ([runtime2, runtimeDevices]) => runtimeDevices.map((device) => ({ ...device, runtime: runtime2 }))
  );
  if (requested) {
    const exact = devices.find((device) => device.udid === requested || device.name === requested);
    if (exact) return exact;
    const partial = devices.find((device) => device.name.toLowerCase().includes(requested.toLowerCase()));
    if (partial) return partial;
    throw new Error(`No available iOS simulator matched: ${requested}`);
  }
  const booted = devices.find((device) => device.state === "Booted");
  if (booted) return booted;
  const iphone = [...devices].reverse().find((device) => /iPhone/.test(device.name));
  if (iphone) return iphone;
  if (devices[0]) return devices[0];
  throw new Error("No available iOS simulators found.");
}
async function adbScreenshot(device, outputPath, deps) {
  if (deps.adbScreenshot) return deps.adbScreenshot(device, outputPath);
  const args = device ? ["-s", device, "exec-out", "screencap", "-p"] : ["exec-out", "screencap", "-p"];
  await new Promise((resolve15, reject) => {
    const child = spawnProcess("adb", args, deps);
    let stderr = "";
    const chunks = [];
    let byteLength = 0;
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("adb screenshot timed out after 30000ms"));
    }, 3e4);
    child.stdout.on("data", (chunk) => {
      chunks.push(chunk);
      byteLength += chunk.byteLength;
    });
    child.stderr.setEncoding?.("utf8");
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        fs6.writeFile(outputPath, Buffer.concat(chunks, byteLength)).then(resolve15, reject);
      } else {
        reject(new Error(`adb screenshot failed with code ${code}: ${stderr}`));
      }
    });
  });
}
function spawnProcess(file, args, deps) {
  if (deps.spawnProcess) return deps.spawnProcess(file, args, { stdio: ["ignore", "pipe", "pipe"] });
  return spawn(file, args, { stdio: ["ignore", "pipe", "pipe"] });
}
async function defaultPathExists2(file, deps) {
  if (deps.pathExists) return deps.pathExists(file);
  return pathExists3(file, { access: fs6.access });
}
async function mkdir8(directory, deps) {
  if (deps.mkdir) return deps.mkdir(directory, { recursive: true });
  await fs6.mkdir(directory, { recursive: true });
}
async function readLatestRefCache3(args, deps) {
  if (deps.readLatestRefCache) return deps.readLatestRefCache(args);
  const stateRoot = resolveExpoStateRoot3(args);
  const session = await readLatestSession3(stateRoot, deps);
  if (!session?.lastSnapshotId || typeof session.sessionId !== "string") return null;
  return readJsonFile4(path5.join(stateRoot, "sessions", session.sessionId, "refs.json"), deps).then((value) => asRecord5(value)).catch(() => null);
}
async function writeJsonFile2(file, value, deps) {
  if (deps.writeJsonFile) return deps.writeJsonFile(file, value);
  await fs6.writeFile(file, `${JSON.stringify(value, null, 2)}
`, "utf8");
}
async function writeFile5(file, contents, encoding, deps) {
  if (deps.writeFile) return deps.writeFile(file, contents, encoding);
  await fs6.writeFile(file, contents, encoding);
}
async function wait(ms, deps) {
  if (deps.wait) return deps.wait(ms);
  await new Promise((resolve15) => setTimeout(resolve15, ms));
}
function safeTimestamp(deps) {
  return (deps.nowIso?.() ?? (/* @__PURE__ */ new Date()).toISOString()).replace(/[:.]/g, "-");
}
function isUnavailable(value) {
  return Boolean(value && typeof value === "object" && value.available === false);
}
function asRecord5(value) {
  return value && typeof value === "object" ? value : {};
}
function resolveExpoStateRoot3(args = {}) {
  if (args.stateDir) {
    const resolved = path5.resolve(args.stateDir);
    return path5.basename(resolved) === "runs" ? path5.dirname(resolved) : resolved;
  }
  const root = path5.resolve(args.root ?? args.cwd ?? process.env.PWD ?? ".");
  return path5.join(root, ".scratch", "expo-ios");
}
async function readLatestSession3(stateRoot, deps) {
  const sessionsRoot = path5.join(stateRoot, "sessions");
  const entries = await readDir(sessionsRoot, deps).catch(() => []);
  const sessions = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const record = await readJsonFile4(path5.join(sessionsRoot, entry.name, "session.json"), deps).catch(() => null);
    if (record) sessions.push(asRecord5(record));
  }
  sessions.sort((a, b) => String(b.updatedAt ?? b.createdAt).localeCompare(String(a.updatedAt ?? a.createdAt)));
  return sessions[0] ?? null;
}
async function readDir(directory, deps) {
  if (deps.readDir) return deps.readDir(directory, { withFileTypes: true });
  return fs6.readdir(directory, { withFileTypes: true });
}
async function readJsonFile4(file, deps) {
  if (deps.readJsonFile) return deps.readJsonFile(file);
  return JSON.parse(await fs6.readFile(file, "utf8"));
}

// src/modules/interaction-actions/src/main/index.ts
var MAX_OUTPUT9 = 4e4;
var defaultInteractionDependencies = {
  commandPath: defaultCommandPath,
  execFile: defaultExecFile3,
  resolveIosDevice: defaultResolveIosDevice2,
  planRefAction: async () => ({ available: false, reason: "Ref actions require a current snapshot." }),
  readRefRecord: async () => ({ available: false, reason: "No snapshot exists for the current session." }),
  refPoint: async () => ({ available: false, reason: "Ref point lookup requires a current snapshot." }),
  scrollPlan: async () => ({ available: false, reason: "Scroll planning requires a current snapshot." }),
  policyDecision: defaultPolicyDecision2,
  captureScreenshot: (args) => automationTakeScreenshot(args),
  traceInteraction: (args) => traceInteraction(args),
  wait: (ms) => new Promise((resolve15) => setTimeout(resolve15, ms)),
  now: () => /* @__PURE__ */ new Date(),
  tmpdir: osTmpdir,
  mkdir: (path12, options) => fs7.mkdir(path12, options),
  joinPath: joinPath2
};
async function automationTap(args, deps = defaultInteractionDependencies) {
  return automationTapInternal(args, deps, false);
}
async function automationTapInternal(args, deps, policyChecked) {
  const policyDenied = policyChecked ? null : await policyGate(args, "tap", "interaction", deps);
  if (policyDenied) return policyDenied;
  if (args.ref) {
    const planned = await deps.planRefAction({ ...args, action: "tap" });
    if (args.dryRun === true || planned.available === false) return planned;
    const point = asRecord6(asRecord6(planned.plan).point);
    if (!isFinitePoint(point)) {
      return { available: false, reason: "Ref does not include tappable bounds.", ref: args.ref };
    }
    return automationTapInternal({ ...args, ref: void 0, x: point.x, y: point.y }, deps, true);
  }
  const platform = platformArg2(args.platform);
  const x = String(clampNumber11(args.x, 0, Number.MAX_SAFE_INTEGER));
  const y = String(clampNumber11(args.y, 0, Number.MAX_SAFE_INTEGER));
  if (args.dryRun === true) {
    const iosTool = platform === "ios" ? await resolveIosInteractionTool(deps) : null;
    const iosCommand = iosTool?.tool === "axe" ? ["axe", "tap", "-x", x, "-y", y, "--udid", optionalString4(args.device) ?? "<booted-device>"] : ["idb", "ui", "tap", x, y, "--udid", optionalString4(args.device) ?? "<booted-device>"];
    return {
      available: true,
      dryRun: true,
      platform,
      device: optionalString4(args.device),
      tool: platform === "android" ? "adb" : iosTool?.tool ?? "idb",
      point: { x: Number(x), y: Number(y) },
      command: platform === "android" ? ["adb", ...androidDeviceArgs3(optionalString4(args.device), ["shell", "input", "tap", x, y])] : iosCommand
    };
  }
  if (platform === "android") {
    const result2 = await deps.execFile("adb", androidDeviceArgs3(optionalString4(args.device), ["shell", "input", "tap", x, y]), {
      timeout: 2e4,
      rejectOnError: false
    });
    return { platform, device: optionalString4(args.device), x: Number(x), y: Number(y), stdout: truncate10(result2.stdout), stderr: truncate10(result2.stderr) };
  }
  const tool = await resolveIosInteractionTool(deps);
  if (!tool) {
    throw new Error(
      "iOS coordinate taps require the idb or axe CLI, but neither is installed or on PATH. Install idb or axe for iOS coordinate automation."
    );
  }
  const device = await deps.resolveIosDevice(optionalString4(args.device) ?? void 0, { preferBooted: true });
  const command = tool.tool === "axe" ? ["tap", "-x", x, "-y", y, "--udid", device.udid] : ["ui", "tap", x, y, "--udid", device.udid];
  const result = await deps.execFile(tool.path, command, { timeout: 2e4, rejectOnError: false });
  return { platform, device, tool: tool.tool, x: Number(x), y: Number(y), stdout: truncate10(result.stdout), stderr: truncate10(result.stderr) };
}
async function refActionCommand(args, deps = defaultInteractionDependencies) {
  const command = requireString8(args.command, "command");
  if (command === "scroll-into-view") {
    const record = await deps.readRefRecord(args.ref, args);
    return record.available === false ? record : { available: true, action: command, ref: args.ref, reason: "Ref is present in the current snapshot.", record: record.record };
  }
  if (command === "blur") {
    const policyDenied = await policyGate(args, "ref.blur", "ref", deps);
    if (policyDenied) return policyDenied;
    return keyboardCommand({ ...args, action: "press", key: "Enter" }, deps);
  }
  if (["focus", "check", "uncheck", "select"].includes(command)) {
    const policyDenied = await policyGate(args, `ref.${command}`, "ref", deps);
    if (policyDenied) return policyDenied;
    const tapped = await automationTapInternal({ ...args, ref: args.ref, dryRun: args.dryRun }, deps, true);
    return { ...tapped, action: command, ref: args.ref, value: args.text ?? null };
  }
  if (command === "fill") {
    const policyDenied = await policyGate(args, "ref.fill", "ref", deps);
    if (policyDenied) return policyDenied;
    const ref = requireString8(args.ref, "ref");
    const text = requireString8(args.text, "text");
    if (args.dryRun === true) {
      return { available: true, dryRun: true, action: command, ref, textLength: text.length, steps: ["tap ref", "type text"] };
    }
    const tapped = await automationTapInternal({ ...args, ref }, deps, true);
    if (tapped.available === false) return { ...tapped, action: command, ref };
    const typed = await keyboardCommand({ ...args, action: "type", text }, deps);
    return { available: typed.available !== false, action: command, ref, tap: tapped, type: typed };
  }
  if (command === "long-press" || command === "dbltap") {
    const policyDenied = await policyGate(args, `ref.${command}`, "ref", deps);
    if (policyDenied) return policyDenied;
    const point = await deps.refPoint(args.ref, args);
    if (point.available === false) return point;
    const coordinates = asRecord6(point.point);
    return automationGestureInternal({
      ...args,
      gesture: command === "long-press" ? "long-press" : "tap",
      x: coordinates.x,
      y: coordinates.y,
      repeat: command === "dbltap" ? 2 : 1,
      intervalMs: command === "dbltap" ? 80 : args.intervalMs
    }, deps, true);
  }
  if (command === "drag") {
    const policyDenied = await policyGate(args, "ref.drag", "ref", deps);
    if (policyDenied) return policyDenied;
    const start = await deps.refPoint(args.ref, args);
    const end = await deps.refPoint(args.targetRef, args);
    if (start.available === false) return start;
    if (end.available === false) return { ...end, role: "targetRef" };
    return automationGestureInternal({
      ...args,
      gesture: "drag",
      startX: asRecord6(start.point).x,
      startY: asRecord6(start.point).y,
      endX: asRecord6(end.point).x,
      endY: asRecord6(end.point).y,
      durationMs: args.durationMs ?? 600
    }, deps, true);
  }
  if (command === "scroll") {
    const policyDenied = await policyGate(args, "ref.scroll", "ref", deps);
    if (policyDenied) return policyDenied;
    const plan = await deps.scrollPlan(args);
    if (plan.available === false || args.dryRun === true) return plan;
    return automationGestureInternal({ ...args, gesture: "swipe", ...asRecord6(plan.coordinates), durationMs: args.durationMs ?? 250 }, deps, true);
  }
  throw new Error(`Unknown ref action command: ${command}`);
}
async function clipboardCommand(args, deps = defaultInteractionDependencies) {
  const action = requireString8(args.action ?? "read", "action");
  if (!["read", "write", "paste"].includes(action)) throw new Error(`Unknown clipboard action: ${action}`);
  if (action !== "read") {
    const policyDenied = await policyGate(args, `clipboard.${action}`, "clipboard", deps);
    if (policyDenied) return policyDenied;
  }
  const device = await deps.resolveIosDevice(optionalString4(args.device) ?? void 0, { preferBooted: true });
  if (args.dryRun === true) {
    return { available: true, dryRun: true, action: `clipboard.${action}`, device };
  }
  if (action === "read") {
    const result2 = await deps.execFile("xcrun", ["simctl", "pbpaste", device.udid], { timeout: 1e4, rejectOnError: false });
    return { available: !result2.error, action, device, text: result2.stdout, stderr: truncate10(result2.stderr), error: result2.error ?? null };
  }
  if (action === "write") {
    const text = requireString8(args.text, "text");
    const result2 = await deps.execFile("xcrun", ["simctl", "pbcopy", device.udid], { input: text, timeout: 1e4, rejectOnError: false });
    return { available: !result2.error, action, device, textLength: text.length, stdout: truncate10(result2.stdout), stderr: truncate10(result2.stderr), error: result2.error ?? null };
  }
  const axe = await deps.commandPath("axe");
  if (!axe) return { available: false, action, reason: "clipboard paste requires axe key-combo support.", device };
  const result = await deps.execFile(axe, ["key-combo", "--modifiers", "227", "--key", "25", "--udid", device.udid], {
    timeout: 1e4,
    rejectOnError: false
  });
  return { available: !result.error, action, device, tool: "axe", stdout: truncate10(result.stdout), stderr: truncate10(result.stderr), error: result.error ?? null };
}
async function keyboardCommand(args, deps = defaultInteractionDependencies) {
  const action = requireString8(args.action ?? "type", "action");
  if (!["type", "press"].includes(action)) throw new Error(`Unknown keyboard action: ${action}`);
  const policyDenied = await policyGate(args, `keyboard.${action}`, "keyboard", deps);
  if (policyDenied) return policyDenied;
  const device = await deps.resolveIosDevice(optionalString4(args.device) ?? void 0, { preferBooted: true });
  const axe = await deps.commandPath("axe");
  if (!axe) return { available: false, action, reason: "keyboard commands require the axe CLI.", device };
  if (args.dryRun === true) {
    return { available: true, dryRun: true, action: `keyboard.${action}`, device, tool: "axe" };
  }
  if (action === "type") {
    const text = requireString8(args.text, "text");
    const result2 = await deps.execFile(axe, ["type", text, "--udid", device.udid], { timeout: 2e4, rejectOnError: false });
    return { available: !result2.error, action, device, tool: "axe", textLength: text.length, stdout: truncate10(result2.stdout), stderr: truncate10(result2.stderr), error: result2.error ?? null };
  }
  const key = requireString8(args.key, "key");
  const keycode = keyCodeFor(key);
  const result = await deps.execFile(axe, ["key", String(keycode), "--udid", device.udid], { timeout: 1e4, rejectOnError: false });
  return { available: !result.error, action, device, tool: "axe", key, keycode, stdout: truncate10(result.stdout), stderr: truncate10(result.stderr), error: result.error ?? null };
}
function keyCodeFor(key) {
  const normalized = String(key).toLowerCase();
  const known = {
    enter: 40,
    return: 40,
    tab: 43,
    space: 44,
    backspace: 42,
    delete: 42,
    escape: 41,
    esc: 41
  };
  if (known[normalized]) return known[normalized];
  if (/^\d+$/.test(normalized)) return clampNumber11(Number(normalized), 0, 255);
  if (/^[a-z]$/.test(normalized)) return normalized.charCodeAt(0) - 93;
  throw new Error(`Unknown key: ${key}`);
}
function setEnvironmentPlan(domain, args, device) {
  const value = optionalString4(args.value);
  const extra = Array.isArray(args.extra) ? args.extra : [];
  if (domain === "appearance") {
    if (!["dark", "light"].includes(value ?? "")) throw new Error("appearance must be dark or light.");
    return { available: true, action: domain, device, command: ["xcrun", "simctl", "ui", device.udid, "appearance", value] };
  }
  if (domain === "content-size") {
    const mapped = value === "accessibility" ? "accessibility-large" : requireString8(value, "value");
    return { available: true, action: domain, device, command: ["xcrun", "simctl", "ui", device.udid, "content_size", mapped] };
  }
  if (domain === "location") {
    const lat = requireString8(value, "latitude");
    const lon = requireString8(extra[0], "longitude");
    return { available: true, action: domain, device, command: ["xcrun", "simctl", "location", device.udid, "set", `${lat},${lon}`] };
  }
  if (domain === "permissions") {
    const spec = requireString8(value, "permission");
    const [service, state = "granted"] = spec.split("=");
    const bundleId = optionalString4(args.bundleId) ?? optionalString4(extra[0]);
    if (!bundleId) throw new Error("set permissions requires --bundle-id or a bundle id argument.");
    const action = state === "granted" ? "grant" : state === "denied" ? "revoke" : "reset";
    return { available: true, action: domain, device, command: ["xcrun", "simctl", "privacy", device.udid, action, service, bundleId] };
  }
  if (domain === "locale" || domain === "timezone" || domain === "network" || domain === "orientation" || domain === "keyboard") {
    return {
      available: false,
      action: domain,
      reason: `${domain} mutation is not exposed by stable simctl/axe commands in this CLI yet.`,
      requestedValue: value,
      device
    };
  }
  throw new Error(`Unknown set domain: ${domain}`);
}
async function setEnvironmentCommand(args, deps = defaultInteractionDependencies) {
  const domain = requireString8(args.domain, "domain");
  const device = await deps.resolveIosDevice(optionalString4(args.device) ?? void 0, { preferBooted: true });
  const policy = await deps.policyDecision(args, `set.${domain}`, "device");
  if (!policy.allowed) return policyDeniedPayload2({ domain: "set", action: domain, policy });
  const planned = setEnvironmentPlan(domain, args, device);
  if (args.dryRun === true || planned.available === false) {
    return { ...planned, dryRun: args.dryRun === true, policy };
  }
  const command = planned.command;
  const result = await deps.execFile(command[0] ?? "", command.slice(1), {
    timeout: Number(planned.timeoutMs ?? 2e4),
    rejectOnError: false
  });
  return {
    available: !result.error,
    action: domain,
    device,
    command,
    stdout: truncate10(result.stdout),
    stderr: truncate10(result.stderr),
    error: result.error ?? null,
    policy
  };
}
async function automationGesture(args, deps = defaultInteractionDependencies) {
  return automationGestureInternal(args, deps, false);
}
async function automationGestureInternal(args, deps, policyChecked) {
  const platform = platformArg2(args.platform);
  const gesture = normalizeGesture(args.gesture);
  const policyDenied = policyChecked ? null : await policyGate(args, `gesture.${gesture}`, "gesture", deps);
  if (policyDenied) return policyDenied;
  const repeat = clampNumber11(args.repeat ?? 1, 1, 20);
  const intervalMs = clampNumber11(args.intervalMs ?? 250, 0, 1e4);
  const durationMs = clampNumber11(args.durationMs ?? defaultGestureDurationMs(gesture), 1, 3e4);
  const holdMs = args.holdMs === void 0 ? null : clampNumber11(args.holdMs, 0, 3e4);
  const metroPort = clampNumber11(args.metroPort ?? 8081, 1, 65535);
  const maxEvents = clampNumber11(args.maxEvents ?? 200, 1, 2e3);
  const componentFilter = optionalString4(args.componentFilter);
  const cwd = optionalString4(args.cwd) ?? ".";
  const coordinates = normalizeGestureCoordinates(gesture, args);
  const plan = gestureCommandPlan({ platform, gesture, coordinates, durationMs, holdMs, repeat, intervalMs, device: args.device });
  const reviewQuestionsThisCanAnswer = reviewQuestions();
  if (args.dryRun === true) {
    return {
      available: true,
      dryRun: true,
      platform,
      gesture,
      coordinates,
      durationMs,
      holdMs,
      repeat,
      intervalMs,
      captureBeforeAfter: args.captureBeforeAfter === true,
      includeTrace: args.includeTrace === true,
      plan,
      reviewQuestionsThisCanAnswer
    };
  }
  const evidence = { traceStart: null, traceRead: null, traceStop: null, screenshots: {} };
  if (args.captureBeforeAfter === true) {
    asRecord6(evidence.screenshots).before = await captureGestureScreenshot({ platform, device: args.device, outputDir: args.outputDir, label: "before" }, deps);
  }
  if (args.includeTrace === true) {
    evidence.traceStart = unwrapToolPayload(await deps.traceInteraction({ cwd, metroPort, action: "start", componentFilter, maxEvents, includeEvents: false }));
  }
  const execution = await executeGesturePlanInternal({ platform, device: args.device, gesture, plan, repeat, intervalMs }, deps, true);
  if (args.includeTrace === true) {
    evidence.traceRead = unwrapToolPayload(await deps.traceInteraction({ cwd, metroPort, action: "read", componentFilter, maxEvents, includeEvents: false }));
    evidence.traceStop = unwrapToolPayload(await deps.traceInteraction({ cwd, metroPort, action: "stop", componentFilter, maxEvents, includeEvents: false }));
  }
  if (args.captureBeforeAfter === true) {
    asRecord6(evidence.screenshots).after = await captureGestureScreenshot({ platform, device: args.device, outputDir: args.outputDir, label: "after" }, deps);
  }
  return {
    available: execution.available,
    platform,
    gesture,
    coordinates,
    durationMs,
    holdMs,
    repeat,
    intervalMs,
    plan,
    execution,
    evidence,
    reviewQuestionsThisCanAnswer,
    interferenceReview: {
      requiredHumanCheck: "Compare before/after screenshots and trace summary against the intended gesture owner. This command gathers evidence; it does not know the app's product semantics.",
      possibleSignals: [
        "after screenshot shows unexpected scroll offset or selected state",
        "trace shows commits/layout changes outside the intended component filter",
        "gesture command reports unavailable tooling, meaning the interaction was not actually exercised"
      ]
    }
  };
}
function normalizeGesture(value) {
  const gesture = requireString8(value, "gesture");
  if (gesture === "tap-and-hold") return "long-press";
  if (!["tap", "long-press", "drag", "swipe"].includes(gesture)) throw new Error(`Unknown gesture: ${gesture}`);
  return gesture;
}
function defaultGestureDurationMs(gesture) {
  if (gesture === "long-press") return 900;
  if (gesture === "drag") return 900;
  if (gesture === "swipe") return 250;
  return 80;
}
function normalizeGestureCoordinates(gesture, args) {
  if (gesture === "tap" || gesture === "long-press") {
    return {
      x: clampNumber11(args.x, 0, Number.MAX_SAFE_INTEGER),
      y: clampNumber11(args.y, 0, Number.MAX_SAFE_INTEGER)
    };
  }
  return {
    startX: clampNumber11(args.startX, 0, Number.MAX_SAFE_INTEGER),
    startY: clampNumber11(args.startY, 0, Number.MAX_SAFE_INTEGER),
    endX: clampNumber11(args.endX, 0, Number.MAX_SAFE_INTEGER),
    endY: clampNumber11(args.endY, 0, Number.MAX_SAFE_INTEGER)
  };
}
function gestureCommandPlan(args) {
  const platform = platformArg2(args.platform);
  const gesture = requireString8(args.gesture, "gesture");
  const coordinates = asRecord6(args.coordinates);
  const durationMs = Number(args.durationMs);
  const holdMs = args.holdMs === null ? null : Number(args.holdMs);
  const repeat = Number(args.repeat);
  const intervalMs = Number(args.intervalMs);
  const durationSeconds = formatSeconds(durationMs);
  const holdSeconds = holdMs === null ? null : formatSeconds(holdMs);
  if (platform === "android") {
    const deviceArgs = optionalString4(args.device) ? ["-s", String(args.device)] : [];
    const command2 = gesture === "tap" ? ["adb", ...deviceArgs, "shell", "input", "tap", String(coordinates.x), String(coordinates.y)] : gesture === "long-press" ? ["adb", ...deviceArgs, "shell", "input", "swipe", String(coordinates.x), String(coordinates.y), String(coordinates.x), String(coordinates.y), String(durationMs)] : ["adb", ...deviceArgs, "shell", "input", "swipe", String(coordinates.startX), String(coordinates.startY), String(coordinates.endX), String(coordinates.endY), String(durationMs)];
    return {
      tool: "adb",
      command: command2,
      repeat,
      intervalMs,
      notes: holdMs ? ["Android adb input swipe has duration but no separate hold-before-move primitive."] : []
    };
  }
  const udidArgs = optionalString4(args.device) ? ["--udid", String(args.device)] : ["--udid", "<resolved-booted-simulator-udid>"];
  const command = gesture === "tap" ? ["idb", "ui", "tap", String(coordinates.x), String(coordinates.y), ...udidArgs] : gesture === "long-press" ? ["idb", "ui", "tap", String(coordinates.x), String(coordinates.y), "--duration", durationSeconds, ...udidArgs] : ["idb", "ui", "swipe", String(coordinates.startX), String(coordinates.startY), String(coordinates.endX), String(coordinates.endY), "--duration", durationSeconds, ...udidArgs];
  return {
    tool: "idb",
    command,
    repeat,
    intervalMs,
    notes: holdSeconds ? ["Current idb plan records holdMs as intent; idb swipe supports duration but not a separate hold-before-move flag in this wrapper."] : []
  };
}
async function executeGesturePlanInternal(args, deps, policyChecked) {
  const platform = platformArg2(args.platform);
  const plan = asGesturePlan(args.plan);
  const gesture = optionalString4(args.gesture) ?? "unknown";
  const policyDenied = policyChecked ? null : await policyGate(args, `gesture.${gesture}`, "gesture", deps);
  if (policyDenied) return policyDenied;
  const repeat = clampNumber11(args.repeat ?? plan.repeat, 1, 20);
  const intervalMs = clampNumber11(args.intervalMs ?? plan.intervalMs, 0, 1e4);
  if (platform === "android") {
    const adb = await deps.commandPath("adb");
    if (!adb) return { available: false, reason: "Android gestures require adb, which is not installed or not on PATH.", plan };
    return executeRepeatedCommandInternal(plan.command[0] ?? "adb", plan.command.slice(1), { repeat, intervalMs }, deps);
  }
  const tool = await resolveIosInteractionTool(deps);
  if (!tool) {
    return {
      available: false,
      reason: "iOS complex gestures require the idb or axe CLI, but neither is installed or on PATH.",
      installHint: "Install idb or axe and rerun this command, or use dryRun=true to inspect the intended gesture plan.",
      plan
    };
  }
  const resolvedDevice = args.device ? { udid: String(args.device) } : await deps.resolveIosDevice(void 0, { preferBooted: true });
  if (tool.tool === "axe") {
    const command2 = axeGestureCommandFromPlan({ gesture: args.gesture, plan, udid: resolvedDevice.udid });
    return executeRepeatedCommandInternal(tool.path, command2.slice(1), { repeat, intervalMs, device: resolvedDevice, tool: tool.tool, plannedCommand: command2 }, deps);
  }
  const command = plan.command.map((part) => part === "<resolved-booted-simulator-udid>" ? resolvedDevice.udid : part);
  return executeRepeatedCommandInternal(tool.path, command.slice(1), { repeat, intervalMs, device: resolvedDevice, tool: tool.tool, plannedCommand: command }, deps);
}
function axeGestureCommandFromPlan(args) {
  const gesture = requireString8(args.gesture, "gesture");
  const plan = asGesturePlan(args.plan);
  const udid = requireString8(args.udid, "udid");
  const command = plan.command;
  if (gesture === "tap") return ["axe", "tap", "-x", command[3] ?? "", "-y", command[4] ?? "", "--udid", udid];
  if (gesture === "long-press") {
    const durationIndex2 = command.indexOf("--duration");
    const delay = durationIndex2 === -1 ? "0.9" : command[durationIndex2 + 1] ?? "0.9";
    return ["axe", "touch", "-x", command[3] ?? "", "-y", command[4] ?? "", "--down", "--up", "--delay", delay, "--udid", udid];
  }
  const durationIndex = command.indexOf("--duration");
  const duration = durationIndex === -1 ? null : command[durationIndex + 1];
  const axeCommand = [
    "axe",
    gesture === "drag" ? "drag" : "swipe",
    "--start-x",
    command[3] ?? "",
    "--start-y",
    command[4] ?? "",
    "--end-x",
    command[5] ?? "",
    "--end-y",
    command[6] ?? ""
  ];
  if (duration) axeCommand.push("--duration", duration);
  axeCommand.push("--udid", udid);
  return axeCommand;
}
async function executeRepeatedCommandInternal(command, args, options, deps) {
  const repeat = clampNumber11(options.repeat ?? 1, 1, 20);
  const intervalMs = clampNumber11(options.intervalMs ?? 0, 0, 1e4);
  const runs = [];
  for (let index = 0; index < repeat; index += 1) {
    const result = await deps.execFile(command, args, { timeout: 35e3, rejectOnError: false });
    runs.push({
      index: index + 1,
      command: [command, ...args],
      exitCode: result.error?.code ?? 0,
      stdout: truncate10(result.stdout),
      stderr: truncate10(result.stderr)
    });
    if (index < repeat - 1 && intervalMs > 0) await deps.wait(intervalMs);
  }
  return {
    available: true,
    device: options.device ?? null,
    tool: options.tool ?? basename4(command),
    command: options.plannedCommand ?? [basename4(command), ...args],
    runs
  };
}
async function captureGestureScreenshot(args, deps = defaultInteractionDependencies) {
  const root = optionalString4(args.outputDir) ?? deps.joinPath(deps.tmpdir(), "expo-ios-gestures");
  await deps.mkdir(root, { recursive: true });
  const outputPath = deps.joinPath(root, `${requireString8(args.label, "label")}-${deps.now().toISOString().replace(/[:.]/g, "-")}.png`);
  return unwrapToolPayload(await deps.captureScreenshot({ platform: args.platform, device: args.device, outputPath }));
}
async function defaultCommandPath(command) {
  const result = await defaultExecFile3("which", [command], { timeout: 5e3, rejectOnError: false });
  return result.error ? null : optionalString4(result.stdout);
}
function defaultExecFile3(file, args, options = {}) {
  if (options.input !== void 0) {
    return defaultSpawnFile(file, args, options);
  }
  return new Promise((resolve15, reject) => {
    nodeExecFile7(file, args, { timeout: options.timeout, maxBuffer: MAX_OUTPUT9 }, (error, stdout, stderr) => {
      if (error && options.rejectOnError !== false) {
        Object.assign(error, { stdout, stderr });
        reject(error);
        return;
      }
      resolve15({
        stdout: String(stdout ?? ""),
        stderr: String(stderr ?? ""),
        error: error ? { message: error.message, code: error.code, signal: error.signal } : null
      });
    });
  });
}
function defaultSpawnFile(file, args, options = {}) {
  return new Promise((resolve15, reject) => {
    const child = nodeSpawn(file, args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timeout = options.timeout ? setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      const error = { message: `${file} timed out after ${options.timeout}ms`, code: "ETIMEDOUT", signal: null };
      if (options.rejectOnError !== false) {
        reject(Object.assign(new Error(error.message), { stdout, stderr, code: error.code }));
      } else {
        resolve15({ stdout, stderr, error });
      }
    }, options.timeout) : null;
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      if (options.rejectOnError !== false) {
        reject(Object.assign(error, { stdout, stderr }));
      } else {
        resolve15({ stdout, stderr, error: { message: error.message, code: null, signal: null } });
      }
    });
    child.on("close", (code, signal) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      const error = code === 0 ? null : { message: `${file} exited with code ${code}`, code, signal };
      if (error && options.rejectOnError !== false) {
        reject(Object.assign(new Error(error.message), { stdout, stderr, code, signal }));
      } else {
        resolve15({ stdout, stderr, error });
      }
    });
    child.stdin.end(options.input);
  });
}
async function defaultResolveIosDevice2(requested) {
  if (requested && /^[0-9A-Fa-f-]{20,}$/.test(requested)) {
    return { udid: requested, name: requested, state: "unknown" };
  }
  const { stdout } = await defaultExecFile3("xcrun", ["simctl", "list", "devices", "available", "--json"], {
    timeout: 2e4
  });
  const parsed = JSON.parse(String(stdout ?? "{}"));
  const devices = Object.entries(parsed.devices ?? {}).flatMap(
    ([runtime2, runtimeDevices]) => (Array.isArray(runtimeDevices) ? runtimeDevices : []).map((device) => {
      const record = asRecord6(device);
      return {
        udid: String(record.udid ?? ""),
        name: String(record.name ?? ""),
        state: optionalString4(record.state) ?? void 0,
        runtime: runtime2,
        isAvailable: record.isAvailable === void 0 ? void 0 : Boolean(record.isAvailable)
      };
    })
  ).filter((device) => device.udid && device.name);
  if (requested) {
    const exact = devices.find((device) => device.udid === requested || device.name === requested);
    if (exact) return exact;
    const partial = devices.find((device) => device.name.toLowerCase().includes(requested.toLowerCase()));
    if (partial) return partial;
    throw new Error(`No available iOS simulator matched: ${requested}`);
  }
  const booted = devices.find((device) => device.state === "Booted");
  if (booted) return booted;
  const iphone = [...devices].reverse().find((device) => /iPhone/.test(device.name));
  if (iphone) return iphone;
  if (devices[0]) return devices[0];
  throw new Error("No available iOS simulators found.");
}
async function defaultPolicyDecision2(args, action, sideEffect) {
  const policyPath = optionalString4(args.actionPolicy);
  if (!policyPath) {
    return {
      checked: true,
      action,
      sideEffect,
      allowed: false,
      source: null,
      reason: "No action policy allowed this state-changing operation."
    };
  }
  const policy = JSON.parse(await fs7.readFile(policyPath, "utf8"));
  const allowed = Array.isArray(policy.allow) && policy.allow.includes(action) || policy.actions?.[action] === true || policy.actions?.[action] === "allow";
  return {
    checked: true,
    action,
    sideEffect,
    allowed,
    source: policyPath,
    reason: allowed ? "Action allowed by policy." : "Action policy did not allow this operation."
  };
}
function requireString8(value, field) {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${field} must be a non-empty string.`);
  return value.trim();
}
function clampNumber11(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`Expected a finite number, got ${value}.`);
  return Math.min(Math.max(number, min), max);
}
function truncate10(value, limit = MAX_OUTPUT9) {
  const text = String(value ?? "");
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}
[truncated ${text.length - limit} characters]`;
}
function policyDeniedPayload2({ domain, action, policy }) {
  return {
    available: false,
    domain,
    action,
    source: "policy",
    evidenceSource: "policy",
    code: "policy-denied",
    denied: true,
    reason: "Policy denied action.",
    policy
  };
}
async function policyGate(args, action, domain, deps) {
  const policy = await deps.policyDecision(args, action, "device");
  return policy.allowed ? null : policyDeniedPayload2({ domain, action, policy });
}
async function resolveIosInteractionTool(deps) {
  const idb = await deps.commandPath("idb");
  if (idb) return { tool: "idb", path: idb };
  const axe = await deps.commandPath("axe");
  if (axe) return { tool: "axe", path: axe };
  return null;
}
function androidDeviceArgs3(device, args) {
  return device ? ["-s", device, ...args] : args;
}
function platformArg2(value) {
  return value === "android" ? "android" : "ios";
}
function optionalString4(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
function asRecord6(value) {
  return value && typeof value === "object" ? value : {};
}
function isFinitePoint(value) {
  return Number.isFinite(value.x) && Number.isFinite(value.y);
}
function asGesturePlan(value) {
  const record = asRecord6(value);
  return {
    tool: String(record.tool ?? ""),
    command: Array.isArray(record.command) ? record.command.map(String) : [],
    repeat: Number(record.repeat ?? 1),
    intervalMs: Number(record.intervalMs ?? 0),
    notes: Array.isArray(record.notes) ? record.notes.map(String) : []
  };
}
function unwrapToolPayload(value) {
  if (value && typeof value === "object" && Array.isArray(value.content)) {
    const text = value.content[0]?.text ?? "{}";
    return JSON.parse(text);
  }
  return asRecord6(value);
}
function formatSeconds(ms) {
  return (ms / 1e3).toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}
function reviewQuestions() {
  return [
    "Does a long press stay on the intended target instead of becoming scroll?",
    "Does a drag/swipe create, resize, or scroll according to the intended mode?",
    "Do screenshots before and after show unintended movement, selection, or chrome overlap?",
    "Do React commits/layout changes during the gesture match the expected interaction owner?"
  ];
}

// src/modules/ux-context-capture/src/main/index.ts
import { execFile as nodeExecFile8 } from "node:child_process";
import { stat as stat4 } from "node:fs/promises";
import path6 from "node:path";
var REVIEW_CONTEXT_QUESTIONS = [
  "Is the screen blank because of empty data, loading, failed network, or render failure?",
  "Which route/source file likely owns the visible screen?",
  "Is the app connected to Metro and running Hermes/Fabric/New Architecture?",
  "What colors, contrast, visual density, and coarse composition does the current screen expose?",
  "Which React components and host elements are likely composing the current screen?",
  "Which labels, text nodes, roles, test IDs, and source owner hints map visible UI back to code?",
  "Does the app expose a usable simulator hierarchy, or is screenshot/coordinate review the only reliable UI surface?",
  "Are recent native logs showing failed requests, reloads, exceptions, or slow local calls during the reviewed state?"
];
function toolJson12(value) {
  return { content: [{ type: "text", text: `${JSON.stringify(value, null, 2)}
` }] };
}
async function captureUxContext(args = {}, deps = defaultUxContextDependencies) {
  const startedAt = nowMs(deps);
  const cwd = await deps.normalizeProjectCwd(args.cwd, { allowMissingPackageJson: true });
  const device = await deps.resolveIosDevice(args.device, { preferBooted: true });
  const metroPort = clampNumber12(args.metroPort ?? 8081, 1, 65535);
  const context = {
    capturedAt: now(deps).toISOString(),
    cwd,
    device,
    elapsedMs: null,
    app: null,
    screenshot: null,
    visualAnalysis: null,
    metro: null,
    runtime: null,
    componentHierarchy: null,
    routes: null,
    hierarchy: null,
    logs: null,
    reviewQuestionsThisCanAnswer: REVIEW_CONTEXT_QUESTIONS
  };
  const projectSummary2 = await safeToolSection3(() => deps.expoProjectRuntimeSummary(cwd));
  context.project = projectSummary2.ok ? projectSummary2.value : projectSummary2;
  const metroSummary = args.includeRuntime === false ? { ok: false, skipped: true, reason: "includeRuntime is false" } : await safeToolSection3(() => deps.inspectMetro(metroPort, {
    includeComponents: args.includeComponents !== false,
    componentFilter: requireOptionalString4(args.componentFilter)
  }));
  if (metroSummary.ok === true) {
    context.metro = metroSummary.value.metro;
    context.runtime = metroSummary.value.runtime;
  } else {
    context.metro = metroSummary;
    context.runtime = metroSummary;
  }
  context.componentHierarchy = context.runtime?.componentHierarchy ?? (args.includeRuntime === false ? { skipped: true, reason: "includeRuntime is false" } : args.includeComponents === false ? { skipped: true, reason: "includeComponents is false" } : { available: false, reason: "No component hierarchy returned by runtime probe." });
  if (context.runtime && typeof context.runtime === "object" && "componentHierarchy" in context.runtime) {
    delete context.runtime.componentHierarchy;
  }
  const inferredBundleId = requireOptionalString4(args.bundleId) ?? firstMetroAppId(context.metro) ?? appConfigBundleId(context.project) ?? null;
  const processName = requireOptionalString4(args.processName) ?? processNameFromBundleId2(inferredBundleId);
  if (inferredBundleId) {
    const appInfo = await safeToolSection3(() => deps.iosInstalledAppInfo(String(device.udid), inferredBundleId));
    context.app = appInfo.ok ? appInfo.value : { bundleId: inferredBundleId, ...appInfo };
  } else {
    context.app = { bundleId: null, warning: "Could not infer bundleId. Pass bundleId for app container details and precise log filtering." };
  }
  if (args.includeScreenshot !== false) {
    const screenshot = await safeToolSection3(() => deps.captureIosScreenshot(String(device.udid), args.outputPath));
    context.screenshot = screenshot.ok ? screenshot.value : screenshot;
    if (screenshot.ok && args.includeImageAnalysis !== false) {
      const outputPath = screenshot.value.outputPath;
      const analysis = await safeToolSection3(() => deps.analyzePngScreenshot(String(outputPath)));
      context.visualAnalysis = analysis.ok ? analysis.value : analysis;
    }
  } else {
    context.screenshot = { skipped: true, reason: "includeScreenshot is false" };
    context.visualAnalysis = { skipped: true, reason: "No screenshot captured." };
  }
  context.routes = await safeToolSection3(() => deps.expoRouteContext(cwd));
  if (context.routes.ok) context.routes = context.routes.value;
  if (args.includeHierarchy !== false) {
    const hierarchy = await safeToolSection3(() => deps.describeIosHierarchy(String(device.udid)));
    context.hierarchy = hierarchy.ok ? hierarchy.value : hierarchy;
  } else {
    context.hierarchy = { skipped: true, reason: "includeHierarchy is false" };
  }
  if (args.includeLogs) {
    const logsLast = args.logsLast ?? "60s";
    if (!/^\d+[smhd]$/.test(logsLast)) throw new Error("logsLast must look like 30s, 2m, 1h, or 1d.");
    const logs = await safeToolSection3(() => deps.collectFilteredIosLogs(String(device.udid), {
      last: logsLast,
      bundleId: inferredBundleId,
      processName
    }));
    context.logs = logs.ok ? logs.value : logs;
  } else {
    context.logs = {
      skipped: true,
      reason: "includeLogs is false. Set includeLogs=true for recent filtered iOS logs.",
      suggestedFilter: processName ? `process == "${processName}"` : inferredBundleId ? `process CONTAINS "${processNameFromBundleId2(inferredBundleId)}"` : null
    };
  }
  context.elapsedMs = nowMs(deps) - startedAt;
  return toolJson12(context);
}
var defaultUxContextDependencies = {
  normalizeProjectCwd: defaultNormalizeProjectCwd,
  resolveIosDevice: (device, options) => resolveIosDevice(requireOptionalString4(device), options),
  expoProjectRuntimeSummary: async (cwd) => unwrapToolJson5(await projectInfo({ cwd })),
  inspectMetro: async (metroPort) => {
    const metro = await metroStatusPayload({ metroPort });
    return { metro, runtime: { available: metro.available, targetCount: metro.targetCount, targets: metro.targets } };
  },
  iosInstalledAppInfo: async (udid, bundleId) => {
    const result = await execFile6("xcrun", ["simctl", "get_app_container", udid, bundleId], {
      timeout: 15e3,
      rejectOnError: false
    });
    return {
      available: !result.error,
      bundleId,
      containerPath: result.error ? null : String(result.stdout ?? "").trim(),
      stderr: truncate11(result.stderr),
      error: result.error ?? null
    };
  },
  captureIosScreenshot: async (udid, outputPath) => unwrapToolJson5(await automationTakeScreenshot({
    platform: "ios",
    device: udid,
    outputPath
  })),
  analyzePngScreenshot: async (outputPath) => {
    const details = await stat4(outputPath).catch(() => null);
    return details ? { available: true, outputPath, bytes: details.size, modifiedAt: details.mtime.toISOString() } : { available: false, outputPath, reason: "Screenshot file was not found." };
  },
  expoRouteContext,
  describeIosHierarchy: async (udid) => {
    const result = await execFile6("axe", ["describe-ui", "--udid", udid], {
      timeout: 2e4,
      rejectOnError: false
    });
    return {
      available: !result.error,
      tool: "axe",
      stdout: truncate11(result.stdout),
      stderr: truncate11(result.stderr),
      error: result.error ?? null
    };
  },
  collectFilteredIosLogs: async (udid, options) => collectAppLogs({
    platform: "ios",
    device: udid,
    last: options.last,
    bundleId: options.bundleId ?? void 0,
    processName: options.processName ?? void 0
  }),
  now: () => /* @__PURE__ */ new Date(),
  nowMs: () => Date.now()
};
async function safeToolSection3(fn) {
  try {
    return { ok: true, value: await fn() };
  } catch (error) {
    return { ok: false, error: formatError10(error) };
  }
}
function requireOptionalString4(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
function processNameFromBundleId2(bundleId) {
  if (!bundleId) return null;
  const last = String(bundleId).split(".").filter(Boolean).at(-1);
  return last ? last.replace(/[^a-zA-Z0-9_-]/g, "") : null;
}
function clampNumber12(value, min, max) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) {
    throw new Error(`Expected a finite number, got ${value}.`);
  }
  return Math.min(Math.max(numberValue, min), max);
}
function firstMetroAppId(metro) {
  const targets = asRecord7(metro)?.targets;
  if (!Array.isArray(targets)) return null;
  const target = targets.find((candidate) => asRecord7(candidate)?.appId);
  return typeof target?.appId === "string" ? target.appId : null;
}
function appConfigBundleId(project) {
  const bundleId = asRecord7(asRecord7(project)?.appConfig)?.iosBundleIdentifier;
  return typeof bundleId === "string" && bundleId.length > 0 ? bundleId : null;
}
function asRecord7(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}
function now(deps) {
  return deps.now?.() ?? /* @__PURE__ */ new Date();
}
function nowMs(deps) {
  return deps.nowMs?.() ?? Date.now();
}
function unwrapToolJson5(result) {
  const text = result?.content?.[0]?.text;
  if (typeof text !== "string") return result;
  try {
    return JSON.parse(text);
  } catch {
    return { text };
  }
}
async function defaultNormalizeProjectCwd(cwd) {
  const resolved = path6.resolve(requireOptionalString4(cwd) ?? ".");
  const details = await stat4(resolved).catch(() => null);
  if (!details?.isDirectory()) throw new Error(`Directory does not exist: ${resolved}`);
  return resolved;
}
function execFile6(file, args, options) {
  return new Promise((resolve15) => {
    nodeExecFile8(file, args, { timeout: options.timeout, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
      resolve15({
        stdout: String(stdout ?? ""),
        stderr: String(stderr ?? ""),
        error
      });
    });
  });
}
function truncate11(value, limit = 4e4) {
  const text = String(value ?? "");
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}
[truncated ${text.length - limit} characters]`;
}
function formatError10(error) {
  return error instanceof Error ? error.message : String(error);
}

// src/modules/review-overlay-workflow/src/main/index.ts
import { openSync } from "node:fs";
import { mkdir as mkdir10, readFile as readFile11, stat as stat5, writeFile as writeFile6 } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import path7 from "node:path";
import { spawn as spawn2 } from "node:child_process";
var REVIEW_OVERLAY_ACTIONS = /* @__PURE__ */ new Set(["prepare", "scaffold", "server", "read", "clear"]);
function toolJson13(value) {
  return { content: [{ type: "text", text: `${JSON.stringify(value, null, 2)}
` }] };
}
async function reviewOverlay(args = {}, deps = defaultReviewOverlayDependencies) {
  const action = requireOptionalString5(args.action) ?? "prepare";
  if (!REVIEW_OVERLAY_ACTIONS.has(action)) {
    throw new Error(`Unknown review-overlay action: ${action}`);
  }
  if (action === "scaffold") return toolJson13(await scaffoldReviewOverlay(args, deps));
  const cwd = await deps.normalizeProjectCwd(args.cwd, { allowMissingPackageJson: true }).catch(() => deps.resolvePath(String(args.cwd ?? deps.fallbackCwd())));
  const outputDir = deps.resolvePath(requireOptionalString5(args.outputDir) ?? deps.joinPath(cwd, ".scratch", "codex-review-overlay"));
  const eventsPath = deps.joinPath(outputDir, "events.json");
  if (action === "read") {
    const data2 = await deps.readEvents(eventsPath, { metroPort: args.metroPort });
    return toolJson13({ outputDir, eventsPath, ...data2 });
  }
  if (action === "clear") {
    const data2 = await deps.createEventsFile({ outputDir, title: args.title, reset: true });
    return toolJson13({ outputDir, eventsPath, cleared: true, ...data2 });
  }
  if (action === "server") {
    return deps.reviewOverlayServer({ dir: outputDir, port: args.port, endpointPath: args.endpointPath });
  }
  const title = requireOptionalString5(args.title) ?? "Codex in-app review";
  const data = await deps.createEventsFile({ outputDir, title, reset: false });
  let server = null;
  if (args.serve === true) {
    const port = args.port ? clampNumber13(args.port, 1, 65535) : await deps.findAvailablePort(17655);
    const endpointPath = normalizeEndpointPath(args.endpointPath);
    const logPath = deps.joinPath(outputDir, "review-overlay-server.log");
    const logFd = await deps.openLogFile(logPath, "a");
    const child = await deps.spawnDetached(deps.execPath, [
      deps.scriptPath,
      "review-overlay-server",
      "--output-dir",
      outputDir,
      "--port",
      String(port),
      "--endpoint-path",
      endpointPath
    ], {
      detached: true,
      stdio: ["ignore", logFd, logFd]
    });
    child.unref?.();
    server = {
      url: `http://127.0.0.1:${port}/`,
      endpoint: `http://127.0.0.1:${port}${endpointPath}`,
      eventsUrl: `http://127.0.0.1:${port}/events.json`,
      pid: child.pid,
      logPath,
      stop: `kill ${child.pid}`
    };
  }
  return toolJson13({
    outputDir,
    eventsPath,
    server,
    ...data,
    instructions: [
      "Run review-overlay scaffold once, then mount CodexReviewOverlay inside the app root in development only.",
      server ? `Pass endpoint="${server.endpoint}" to CodexReviewOverlay. In iOS Simulator, 127.0.0.1 points at the Mac host.` : "Start with --serve true or run review-overlay server before using the overlay in the simulator.",
      `Codex can read in-app review events from ${eventsPath}.`
    ]
  });
}
var defaultReviewOverlayDependencies = {
  normalizeProjectCwd: defaultNormalizeProjectCwd2,
  fallbackCwd: () => process.cwd(),
  resolvePath: (...parts) => path7.resolve(...parts.filter((part) => Boolean(part))),
  joinPath: (...parts) => path7.join(...parts),
  relativePath: (from, to) => path7.relative(from, to),
  createEventsFile,
  readEvents,
  reviewOverlayServer,
  mkdir: mkdir10,
  writeFile: writeFile6,
  pathExists: async (file) => stat5(file).then(() => true, () => false),
  findAvailablePort,
  openLogFile: (file) => openSync(file, "a"),
  spawnDetached: (command, argv, options) => spawn2(command, argv, options),
  execPath: process.execPath,
  scriptPath: process.argv[1] ?? ""
};
async function scaffoldReviewOverlay(args = {}, deps) {
  const cwd = await deps.normalizeProjectCwd(args.cwd, { allowMissingPackageJson: true }).catch(() => deps.resolvePath(String(args.cwd ?? deps.fallbackCwd())));
  const overlayDir = deps.resolvePath(cwd, requireOptionalString5(args.overlayDir) ?? "codex-review-overlay");
  const componentPath = deps.joinPath(overlayDir, "CodexReviewOverlay.tsx");
  const indexPath = deps.joinPath(overlayDir, "index.ts");
  if (await deps.pathExists(componentPath) && args.force !== true) {
    throw new Error(`${componentPath} already exists. Pass --force true to overwrite.`);
  }
  await deps.mkdir(overlayDir, { recursive: true });
  await deps.writeFile(componentPath, codexReviewOverlayComponentSource(), "utf8");
  await deps.writeFile(indexPath, `export { CodexReviewOverlay } from "./CodexReviewOverlay";
export { default } from "./CodexReviewOverlay";
`, "utf8");
  return {
    overlayDir,
    componentPath,
    indexPath,
    integration: {
      import: `import { CodexReviewOverlay } from "${relativeImportFromAppRoot(cwd, overlayDir, deps)}";`,
      jsx: `{__DEV__ ? <CodexReviewOverlay endpoint="http://127.0.0.1:17655/events" screenName="Schedule" inspectedViewRef={inspectedViewRef} /> : null}`,
      note: "Mount this near the root layout so it floats above the current screen. Wrap only the app content, not the overlay, in a host View ref with collapsable={false}; pass that ref as inspectedViewRef so comments identify the tapped app element."
    },
    capabilities: [
      "single Comment control inside the app",
      "inactive state leaves the app interactive",
      "mouse-over preview after Comment resolves native elements before selection",
      "next click after Comment resolves the touched native element and owner hierarchy",
      "Copy action writes Agentation-style feedback markdown to the Mac clipboard",
      "bounding boxes around commented elements",
      "gesture metadata for tap, hold, and scroll conflict notes",
      "local JSON event sync readable by Codex"
    ]
  };
}
function relativeImportFromAppRoot(cwd, overlayDir, deps) {
  const rel = (deps?.relativePath(cwd, overlayDir) ?? relativePathFallback(cwd, overlayDir)).replace(/\\/g, "/");
  return rel.startsWith(".") ? rel : `./${rel}`;
}
function normalizeEndpointPath(value) {
  const raw = requireOptionalString5(value) ?? "/events";
  const endpoint = raw.startsWith("/") ? raw : `/${raw}`;
  if (!/^\/[A-Za-z0-9_./-]+$/.test(endpoint)) throw new Error("endpointPath must be a simple URL path.");
  return endpoint;
}
function requireOptionalString5(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
function clampNumber13(value, min, max) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) {
    throw new Error(`Expected a finite number, got ${value}.`);
  }
  return Math.min(Math.max(numberValue, min), max);
}
function codexReviewOverlayComponentSource() {
  return `import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

export function CodexReviewOverlay({ endpoint = "http://127.0.0.1:17655/events", screenName = "Screen", inspectedViewRef }) {
  const [active, setActive] = useState(false);
  const [events, setEvents] = useState([]);
  const sequence = useRef(0);

  const submit = useCallback(async (event) => {
    const payload = {
      id: "overlay-" + Date.now().toString(36) + "-" + sequence.current++,
      screenName,
      createdAt: new Date().toISOString(),
      ...event,
    };
    setEvents((current) => current.concat(payload));
    try {
      await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch {}
  }, [endpoint, screenName]);

  const label = useMemo(() => active ? "Tap target" : "Comment", [active]);

  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      <View pointerEvents="box-none" style={styles.toolbar}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Codex review comment"
          onPress={() => setActive((value) => !value)}
          style={[styles.button, active ? styles.active : null]}
        >
          <Text style={styles.buttonText}>{label}</Text>
        </Pressable>
      </View>
      {active ? (
        <Pressable
          accessibilityLabel="Codex review target surface"
          style={StyleSheet.absoluteFill}
          onPress={(event) => {
            const { locationX, locationY, pageX, pageY } = event.nativeEvent;
            submit({
              type: "tap-comment",
              gesture: { locationX, locationY, pageX, pageY },
              element: { refAvailable: Boolean(inspectedViewRef?.current) },
            });
            setActive(false);
          }}
        />
      ) : null}
      <View pointerEvents="none" style={styles.counter}>
        <Text style={styles.counterText}>{events.length}</Text>
      </View>
    </View>
  );
}

export default CodexReviewOverlay;

const styles = StyleSheet.create({
  toolbar: { position: "absolute", top: 48, right: 16, zIndex: 9999 },
  button: { backgroundColor: "#0a84ff", borderRadius: 18, paddingHorizontal: 14, paddingVertical: 9 },
  active: { backgroundColor: "#ff453a" },
  buttonText: { color: "white", fontWeight: "700" },
  counter: { position: "absolute", top: 92, right: 16, minWidth: 24, alignItems: "center" },
  counterText: { color: "white", backgroundColor: "rgba(0,0,0,0.55)", borderRadius: 12, overflow: "hidden", paddingHorizontal: 7, paddingVertical: 2 },
});
`;
}
function relativePathFallback(from, to) {
  const fromParts = from.split("/").filter(Boolean);
  const toParts = to.split("/").filter(Boolean);
  while (fromParts.length && toParts.length && fromParts[0] === toParts[0]) {
    fromParts.shift();
    toParts.shift();
  }
  return [...fromParts.map(() => ".."), ...toParts].join("/") || ".";
}
async function defaultNormalizeProjectCwd2(cwd) {
  const resolved = path7.resolve(requireOptionalString5(cwd) ?? ".");
  const details = await stat5(resolved).catch(() => null);
  if (!details?.isDirectory()) throw new Error(`Directory does not exist: ${resolved}`);
  return resolved;
}
async function createEventsFile(args) {
  await mkdir10(args.outputDir, { recursive: true });
  const eventsPath = path7.join(args.outputDir, "events.json");
  const existing = await readJson5(eventsPath).catch(() => null);
  const payload = args.reset || !existing ? {
    version: 1,
    title: requireOptionalString5(args.title) ?? "Codex in-app review",
    createdAt: (/* @__PURE__ */ new Date()).toISOString(),
    events: []
  } : existing;
  await writeFile6(eventsPath, `${JSON.stringify(payload, null, 2)}
`, "utf8");
  return { eventsPath, eventCount: Array.isArray(payload.events) ? payload.events.length : 0, title: payload.title ?? null };
}
async function readEvents(eventsPath, options = {}) {
  const payload = await readJson5(eventsPath).catch(() => null);
  if (!payload) {
    return { available: false, reason: "No review overlay events file exists.", eventCount: 0, events: [], metroPort: options.metroPort ?? null };
  }
  const events = Array.isArray(payload.events) ? payload.events : [];
  return { available: true, eventCount: events.length, events, title: payload.title ?? null, metroPort: options.metroPort ?? null };
}
async function reviewOverlayServer(args) {
  const dir = path7.resolve(args.dir);
  const port = args.port ? clampNumber13(args.port, 1, 65535) : await findAvailablePort(17655);
  const endpointPath = normalizeEndpointPath(args.endpointPath);
  await mkdir10(dir, { recursive: true });
  await createEventsFile({ outputDir: dir, reset: false });
  const server = createHttpServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", async () => {
      const url = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);
      const eventsPath = path7.join(dir, "events.json");
      if (request.method === "GET" && url.pathname === "/events.json") {
        const text = await readFile11(eventsPath, "utf8").catch(() => '{"events":[]}\n');
        response.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
        response.end(text);
        return;
      }
      if (request.method === "POST" && url.pathname === endpointPath) {
        const current = await readJson5(eventsPath).catch(() => ({ version: 1, events: [] }));
        const events = Array.isArray(current.events) ? current.events : [];
        events.push(JSON.parse(body || "{}"));
        const next = { ...current, events, updatedAt: (/* @__PURE__ */ new Date()).toISOString() };
        await writeFile6(eventsPath, `${JSON.stringify(next, null, 2)}
`, "utf8");
        response.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
        response.end(`${JSON.stringify({ ok: true, eventsPath, eventCount: events.length }, null, 2)}
`);
        return;
      }
      response.writeHead(404, { "content-type": "application/json; charset=utf-8" });
      response.end('{"ok":false,"error":"not found"}\n');
    });
  });
  await new Promise((resolve15) => server.listen(port, "127.0.0.1", () => resolve15()));
  const payload = { ok: true, url: `http://127.0.0.1:${port}/`, endpoint: `http://127.0.0.1:${port}${endpointPath}`, eventsUrl: `http://127.0.0.1:${port}/events.json`, dir };
  process.stdout.write(`${JSON.stringify(payload, null, 2)}
`);
  return await new Promise(() => {
  });
}
async function readJson5(file) {
  return JSON.parse(await readFile11(file, "utf8"));
}
function findAvailablePort(start) {
  return new Promise((resolve15) => {
    const tryPort = (port) => {
      const server = createNetServer();
      server.once("error", () => tryPort(port + 1));
      server.once("listening", () => {
        server.close(() => resolve15(port));
      });
      server.listen(port, "127.0.0.1");
    };
    tryPort(start);
  });
}

// src/modules/annotate-screen-artifacts/src/main/index.ts
var ANNOTATE_ACTIONS = /* @__PURE__ */ new Set(["prepare", "read", "clear", "scaffold", "server"]);
var SCAFFOLD_CONFIRMATION = "annotate-overlay-scaffold";
function toolJson14(value) {
  return { content: [{ type: "text", text: `${JSON.stringify(value, null, 2)}
` }] };
}
async function annotateScreen(args = {}, deps = defaultAnnotateScreenDependencies) {
  const positionals = Array.isArray(args._) ? args._ : [];
  const action = requireOptionalString6(args.action ?? positionals[0]) ?? "prepare";
  if (!ANNOTATE_ACTIONS.has(action)) {
    throw new Error(`Unknown annotate-screen action: ${action}`);
  }
  if (action === "scaffold" && !hasExplicitConfirmation(args.confirmActions, SCAFFOLD_CONFIRMATION)) {
    return toolJson14({
      available: false,
      action,
      source: "policy",
      evidenceSource: "policy",
      code: "confirmation-required",
      reason: `Refusing to mutate app files without explicit --confirm-actions ${SCAFFOLD_CONFIRMATION}.`,
      requiredConfirmation: SCAFFOLD_CONFIRMATION,
      mutation: {
        writesAppFiles: true,
        developmentOnly: true
      }
    });
  }
  const result = await deps.reviewOverlay({
    ...args,
    action,
    title: args.title ?? "Codex in-app annotations"
  });
  const payload = unwrapToolJson6(result);
  return toolJson14({
    ...isRecord7(payload) ? payload : { value: payload },
    command: "annotate-screen",
    annotationSurface: "in-app-overlay",
    compatibility: {
      legacyBoard: "removed",
      replacement: "review-overlay"
    }
  });
}
var defaultAnnotateScreenDependencies = {
  reviewOverlay
};
function unwrapToolJson6(result) {
  const text = result?.content?.[0]?.text;
  if (typeof text !== "string") return result;
  try {
    return JSON.parse(text);
  } catch {
    return { text };
  }
}
function hasExplicitConfirmation(value, required) {
  if (typeof value !== "string") return false;
  return value.split(/[,\s]+/).filter(Boolean).includes(required);
}
function requireOptionalString6(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
function isRecord7(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// src/modules/runtime-inspector-actions/src/main/index.ts
import { execFile as nodeExecFile9 } from "node:child_process";
var INSPECTOR_ACTIONS = ["probe", "toggle", "install-comment-menu", "read-comments", "clear-comments", "open-dev-menu"];
function toolJson15(value) {
  return {
    content: [{ type: "text", text: `${JSON.stringify(value, null, 2)}
` }],
    isError: false
  };
}
function unwrapToolJson7(value) {
  const content = asRecord8(value)?.content;
  if (!Array.isArray(content)) return value;
  const first = asRecord8(content[0]);
  if (first?.type !== "text" || typeof first.text !== "string") return value;
  try {
    return JSON.parse(first.text);
  } catch {
    return { text: first.text };
  }
}
async function runtimeInspector(args, deps = defaultRuntimeInspectorDependencies) {
  const metroPort = clampNumber14(args.metroPort ?? 8081, 1, 65535);
  const action = normalizeRuntimeInspectorAction(args.action ?? "probe");
  const commentTitle = requireOptionalString7(args.commentTitle) ?? "Codex: Add UI comment";
  const maxComments = clampNumber14(args.maxComments ?? 50, 1, 500);
  if (action === "open-dev-menu") {
    return toolJson15(await deps.openIosDevMenu({ ...args, metroPort }));
  }
  const targets = await deps.fetchMetroTargets(metroPort).catch(() => []);
  const targetList = Array.isArray(targets) ? targets : [];
  const webSocketDebuggerUrl = asString2(asRecord8(targetList[0])?.webSocketDebuggerUrl);
  if (!webSocketDebuggerUrl) {
    return toolJson15({ available: false, action, reason: "No Metro inspector target.", metroPort });
  }
  const expression = runtimeInspectorExpression({ action, commentTitle, maxComments });
  const result = await deps.evaluateHermesExpression(webSocketDebuggerUrl, expression, { timeoutMs: 8e3 });
  return toolJson15({
    action,
    metroPort,
    target: targetSummary3(targetList[0]),
    inspector: getPath2(result, ["result", "result", "value"]) ?? null,
    protocolError: getPath2(result, ["result", "exceptionDetails"]) ?? asRecord8(result)?.error ?? null,
    cdp: asRecord8(result)?.diagnostics ?? asRecord8(result)?.cdp ?? null
  });
}
var defaultRuntimeInspectorDependencies = {
  fetchMetroTargets: (metroPort) => metroTargets(metroPort),
  evaluateHermesExpression,
  openIosDevMenu: (args) => openIosDevMenu(args, defaultOpenDevMenuDependencies)
};
var defaultOpenDevMenuDependencies = {
  broadcastMetroMessage,
  resolveIosDevice: (device, options) => resolveIosDevice(requireOptionalString7(device), options),
  openDevClientForMessageSocket: async (args) => unwrapToolJson7(await openExpoRoute({
    device: args.device.udid,
    bundleId: args.bundleId,
    url: args.devClientUrl
  })),
  execFile: execFile7,
  truncate: truncate12
};
function normalizeRuntimeInspectorAction(value) {
  const action = requireString9(value, "action");
  if (!INSPECTOR_ACTIONS.includes(action)) {
    throw new Error(`Unknown inspector action: ${action}`);
  }
  return action;
}
async function openIosDevMenu(args, deps) {
  const metroPort = clampNumber14(args.metroPort ?? 8081, 1, 65535);
  let messageSocket = await deps.broadcastMetroMessage(metroPort, "devMenu");
  if (messageSocket.available) {
    return {
      available: true,
      action: "open-dev-menu",
      platform: "ios",
      transport: "metro-message-socket",
      metroPort,
      requestedDevice: args.device ?? null,
      messageSocket,
      note: "This uses Expo/Metro's /message websocket devMenu broadcast, matching the Expo CLI toggle developer menu path."
    };
  }
  const device = await deps.resolveIosDevice(args.device, { preferBooted: true });
  const devClientUrl = requireOptionalString7(args.devClientUrl);
  let devClientRepair = null;
  if (devClientUrl) {
    devClientRepair = await deps.openDevClientForMessageSocket({
      device,
      bundleId: args.bundleId,
      devClientUrl,
      restartDevClient: args.restartDevClient === true,
      metroPort,
      crashCheckMs: args.crashCheckMs
    });
    if (Array.isArray(devClientRepair.crashReports) && devClientRepair.crashReports.length > 0) {
      return {
        available: false,
        action: "open-dev-menu",
        platform: "ios",
        device,
        metroPort,
        devClientRepair,
        messageSocket,
        reason: "The app generated an iOS crash report after opening the development client URL."
      };
    }
    messageSocket = await deps.broadcastMetroMessage(metroPort, "devMenu");
    if (messageSocket.available) {
      return {
        available: true,
        action: "open-dev-menu",
        platform: "ios",
        transport: "metro-message-socket",
        metroPort,
        requestedDevice: args.device ?? null,
        device,
        devClientRepair,
        messageSocket,
        note: "Opened the supplied Expo development client URL, then used Metro's /message websocket devMenu broadcast."
      };
    }
  }
  const command = ["xcrun", "simctl", "io", device.udid, "shake"];
  const result = await deps.execFile(command[0], command.slice(1), {
    timeout: 15e3,
    rejectOnError: false
  });
  const truncateFn = deps.truncate ?? truncate12;
  return {
    available: !result.error,
    action: "open-dev-menu",
    platform: "ios",
    device,
    command,
    stdout: truncateFn(result.stdout),
    stderr: truncateFn(result.stderr),
    error: result.error,
    messageSocket,
    devClientRepair,
    note: "Tried Expo/Metro's /message websocket devMenu broadcast first, then fell back to the simulator shake gesture."
  };
}
function runtimeInspectorExpression(args) {
  return `(() => {
    const action = ${JSON.stringify(args.action)};
    const commentTitle = ${JSON.stringify(args.commentTitle)};
    const maxComments = ${JSON.stringify(args.maxComments)};
    const stateKey = '__CODEX_SIMULATOR_REVIEW__';
    const state = globalThis[stateKey] ||= {
      createdAt: new Date().toISOString(),
      comments: [],
      menuInstalled: false,
      commentTitle: null,
      errors: []
    };

    function commentSummary() {
      return {
        stateKey,
        menuInstalled: !!state.menuInstalled,
        commentTitle: state.commentTitle || null,
        commentCount: state.comments.length,
        comments: state.comments.slice(-maxComments),
        errors: state.errors.slice(-20)
      };
    }

    function capabilityProbe() {
      return {
        available: true,
        action,
        runtime: {
          dev: typeof __DEV__ !== 'undefined' ? __DEV__ : null,
          hermes: !!globalThis.HermesInternal,
          metroRequire: !!(globalThis.__r || globalThis.metroRequire),
          reactDevToolsHook: !!globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__
        },
        capabilities: {
          toggleElementInspector: false,
          devMenuCommentPrompt: false,
          alertPrompt: false,
          alertOnly: false
        },
        modules: {
          nativeDevSettings: null,
          devSettings: null,
          alert: null,
          nativeDevSettingsCandidates: [],
          devSettingsCandidates: [],
          alertCandidates: []
        },
        comments: commentSummary(),
        limitations: [
          'toggle uses React Native NativeDevSettings.toggleElementInspector, which is a native toggle rather than an explicit show/hide setter.',
          'dev-menu comments are simulator-side and readable by Codex, but they are not automatically attached to a tapped React element.',
          'Automatic element-bound comments require a dev-only overlay mounted in the app tree so it can capture coordinates and touch ownership.'
        ],
        recommendedWorkflow: [
          'Run inspector probe to confirm runtime hooks.',
          'Run inspector toggle to show the built-in RN element inspector in the simulator.',
          'Run inspector install-comment-menu, open the dev menu, and use the Codex comment item while reviewing ambiguous controls.',
          'Run inspector read-comments before final handoff and include comments in the acceptance matrix.'
        ]
      };
    }

    function installCommentMenu() {
      state.menuInstalled = true;
      state.commentTitle = commentTitle;
      return {
        available: true,
        action,
        installed: true,
        comments: commentSummary(),
        instructions: [
          'Open the simulator dev menu.',
          'Choose ' + commentTitle + '.',
          'Type the element or workflow comment in the native prompt.',
          'Run inspector read-comments to retrieve the stored comments.'
        ],
        limitation: 'Comments entered this way are human-authored notes, not automatically bound to a touched element.'
      };
    }

    if (action === 'probe') return capabilityProbe();
    if (action === 'toggle') return { available: false, action, reason: 'Native DevSettings.toggleElementInspector was not found in this Hermes runtime.', probe: capabilityProbe() };
    if (action === 'install-comment-menu') return installCommentMenu();
    if (action === 'read-comments') return { available: true, action, ...commentSummary() };
    if (action === 'clear-comments') {
      state.comments = [];
      return { available: true, action, ...commentSummary() };
    }
    return { available: false, action, reason: 'Unknown inspector action: ' + action };
  })()`;
}
function targetSummary3(target) {
  const record = asRecord8(target);
  if (!record) return null;
  return {
    title: record.title,
    appId: record.appId,
    deviceName: record.deviceName,
    description: record.description
  };
}
function clampNumber14(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new Error(`Expected a finite number, got ${value}.`);
  }
  return Math.min(Math.max(number, min), max);
}
function requireString9(value, field) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${field} must be a non-empty string.`);
  }
  return value.trim();
}
function requireOptionalString7(value) {
  if (value === void 0 || value === null || value === "") return null;
  return requireString9(value, "value");
}
function truncate12(value, limit = 4e4) {
  const text = String(value ?? "");
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}
[truncated ${text.length - limit} characters]`;
}
function getPath2(value, path12) {
  let current = value;
  for (const part of path12) {
    current = asRecord8(current)?.[part];
    if (current === void 0) return void 0;
  }
  return current;
}
function asString2(value) {
  return typeof value === "string" && value.length > 0 ? value : null;
}
function asRecord8(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : null;
}
async function broadcastMetroMessage(metroPort, method, params) {
  if (!method) return { available: false, reason: "No Metro message method was requested.", metroPort };
  if (typeof WebSocket !== "function") return { available: false, reason: "This Node runtime does not expose a WebSocket client.", metroPort };
  const url = `ws://127.0.0.1:${metroPort}/message?role=debugger&name=expo98`;
  try {
    await cdpMessage(url, { method, params: params ?? {} }, 2500);
    return { available: true, metroPort, method, url };
  } catch (error) {
    return { available: false, metroPort, method, url, reason: formatError11(error) };
  }
}
async function cdpMessage(url, payload, timeoutMs) {
  const ws = new WebSocket(url);
  await waitForOpen2(ws, timeoutMs);
  try {
    ws.send(JSON.stringify(payload));
  } finally {
    ws.close();
  }
}
function waitForOpen2(ws, timeoutMs) {
  return new Promise((resolve15, reject) => {
    const timer = setTimeout(() => reject(new Error("Timed out opening WebSocket.")), timeoutMs);
    ws.addEventListener("open", () => {
      clearTimeout(timer);
      resolve15();
    }, { once: true });
    ws.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new Error("WebSocket connection failed."));
    }, { once: true });
  });
}
function execFile7(command, args, options) {
  return new Promise((resolve15) => {
    nodeExecFile9(command, args, { timeout: options.timeout, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
      resolve15({
        stdout: String(stdout ?? ""),
        stderr: String(stderr ?? ""),
        error: error ? { message: error.message } : null
      });
    });
  });
}
function formatError11(error) {
  return error instanceof Error ? error.message : String(error);
}

// src/modules/review-next-guidance/src/main/index.ts
var SUBORDINATE_RULE = "Do not patch or call done until the current constraint is proven or deliberately elevated.";
var NON_GOALS = ["Do not change unrelated app contracts, data shape, or navigation model without a separate reason."];
function toolJson16(value) {
  return { content: [{ type: "text", text: `${JSON.stringify(value, null, 2)}
` }] };
}
async function reviewNextStep(args = {}) {
  const surface = args.surface ?? "generic";
  const stage = args.stage ?? "intake";
  const issue = requireOptionalString8(args.issue) ?? "unspecified UI review issue";
  const cwd = requireOptionalString8(args.cwd) ?? ".";
  const metroPort = clampNumber15(args.metroPort ?? 8081, 1, 65535);
  const componentFilter = requireOptionalString8(args.componentFilter);
  const verifierRule = requireOptionalString8(args.verifierRule);
  const flags = reviewFlags(args);
  const requiredFlows = reviewFlowsForSurface(surface);
  const suggestedCommands = reviewCommandSuggestions({ cwd, metroPort, componentFilter, flags, stage });
  const questionTriggers = reviewQuestionTriggers(flags, verifierRule);
  const constraint = chooseReviewConstraint({ stage, flags, verifierRule });
  return toolJson16({
    issue,
    surface,
    stage,
    constraint,
    nextStep: constraint.nextStep,
    subordinateRule: SUBORDINATE_RULE,
    requiredFlows,
    questionTriggers,
    suggestedCommands,
    stopConditions: reviewStopConditions({ flags, verifierRule }),
    acceptanceContractTemplate: {
      userGoal: "<role + task>",
      firstScreenInvariants: requiredFlows.firstScreenInvariants,
      ambiguousSemantics: questionTriggers,
      representativeAction: requiredFlows.representativeAction,
      evidenceRequired: requiredFlows.evidenceRequired,
      nonGoals: NON_GOALS
    }
  });
}
function chooseReviewConstraint(args) {
  const workflowVerifier = args.verifierRule && verifierRuleMatchesChangedWorkflow(args.verifierRule, args.flags);
  if (!args.flags.hasAcceptanceContract && args.stage !== "handoff") {
    return {
      name: "decision clarity",
      tocStep: "exploit",
      reason: "The limiting constraint is not code; it is the missing acceptance contract.",
      nextStep: "Write the acceptance contract and resolve ambiguous control/gesture/chrome semantics before editing."
    };
  }
  if (!args.flags.hasScreenshot && (args.stage === "intake" || args.stage === "pre-patch")) {
    return {
      name: "baseline evidence",
      tocStep: "exploit",
      reason: "The screen cannot be reviewed reliably without visible runtime evidence.",
      nextStep: "Capture ux-context or a screenshot, then inspect the image against the first-screen invariants."
    };
  }
  if (workflowVerifier) {
    return {
      name: "workflow blocker",
      tocStep: "elevate",
      reason: `Verifier rule ${args.verifierRule} maps to the changed workflow.`,
      nextStep: "Treat the verifier finding as blocking, fix the underlying workflow, or record an explicit product exception."
    };
  }
  if ((args.flags.changedGesture || args.stage === "interaction") && !args.flags.hasInteractionProof) {
    return {
      name: "interaction proof",
      tocStep: "elevate",
      reason: "The touched workflow depends on direct manipulation, so screenshots and static checks are insufficient.",
      nextStep: "Run the representative action in the simulator or an equivalent interaction test, then compare preview and committed state."
    };
  }
  if ((args.flags.changedChrome || args.flags.changedNavigation) && !args.flags.hasInteractionProof) {
    return {
      name: "chrome/navigation proof",
      tocStep: "subordinate",
      reason: "Chrome and navigation changes can silently break safe area, tab, sheet, or return behavior.",
      nextStep: "Exercise tab/header/sheet/back behavior on the target route and inspect safe-area clearance."
    };
  }
  if (args.flags.addedVisibleControls && !args.flags.hasInteractionProof) {
    return {
      name: "affordance validation",
      tocStep: "exploit",
      reason: "New always-visible controls may reduce discoverability debt while damaging the direct object model.",
      nextStep: "Prove object-level feedback is insufficient, then verify the added controls do not clutter or compete with the primary surface."
    };
  }
  if (!args.flags.hasStaticVerifier && args.stage !== "intake") {
    return {
      name: "static pattern gate",
      tocStep: "subordinate",
      reason: "The local native-feel rule gate has not been run for the changed iOS surface.",
      nextStep: "Run verify-native-experience and classify findings by whether they map to the touched workflow."
    };
  }
  return {
    name: "handoff proof",
    tocStep: "subordinate",
    reason: "The main constraints appear covered; the remaining work is to make proof inspectable.",
    nextStep: "Finish with an acceptance matrix: invariant, evidence, pass/fail, and remaining risk."
  };
}
function reviewFlowsForSurface(surface) {
  if (surface === "calendar" || surface === "timeline") {
    return {
      firstScreenInvariants: [
        "current day remains visibly distinct",
        "current time is visible or the screen explains why not",
        "date context is still visible after positioning near now",
        "bottom tab/home-indicator chrome does not crop or cover working time"
      ],
      representativeAction: "Open today, tap an empty slot, drag a time range, confirm the draft range, scroll without creating, and drag without scrolling.",
      evidenceRequired: [
        "before and after ux-context or screenshot",
        "interaction proof for tap-to-create and drag-to-create",
        "safe-area/tab clearance proof",
        "verify-native-experience classification for gesture, tab, safe-area, and visible-text rules"
      ],
      flows: [
        "fresh-open temporal context",
        "day switch away and back to today",
        "tap-to-create draft",
        "short and long drag-to-create",
        "scroll-vs-drag conflict",
        "bottom chrome and safe-area clearance",
        "today selected, today not selected, past, future, occupied, and free states"
      ]
    };
  }
  if (surface === "navigation") {
    return {
      firstScreenInvariants: ["selected tab/title is clear", "back or dismiss behavior is predictable", "content clears system chrome"],
      representativeAction: "Enter the route, navigate forward, back out, switch tabs, and return.",
      evidenceRequired: ["ux-context or screenshot", "manual/smoke navigation walkthrough", "safe-area proof"],
      flows: ["deep link/cold entry", "tab switch", "back/dismiss", "return to prior state"]
    };
  }
  if (surface === "form") {
    return {
      firstScreenInvariants: ["primary fields are visible", "keyboard does not hide focused input", "submit state is clear"],
      representativeAction: "Focus a field, submit invalid data, recover, submit valid data, and confirm the result.",
      evidenceRequired: ["focused keyboard state", "invalid/recovery state", "success or saved state"],
      flows: ["focus/keyboard", "invalid submit", "recovery", "valid submit"]
    };
  }
  if (surface === "list") {
    return {
      firstScreenInvariants: ["rows are readable", "selected/empty/loading/error state is clear", "row actions do not conflict with scroll"],
      representativeAction: "Scroll, select a row, perform row action if present, and return.",
      evidenceRequired: ["ux-context or screenshot", "scroll/row interaction proof"],
      flows: ["loading/empty/error", "scroll", "row select", "row action"]
    };
  }
  if (surface === "editor") {
    return {
      firstScreenInvariants: ["editable object is clear", "tool state is visible", "chrome does not cover the canvas/content"],
      representativeAction: "Create or edit the object, preview the change, cancel, then commit and confirm saved state.",
      evidenceRequired: ["before/after screenshot", "interaction proof", "saved-state proof"],
      flows: ["edit", "preview", "cancel", "commit"]
    };
  }
  return {
    firstScreenInvariants: ["location/state is clear", "primary action is visible or directly discoverable", "system chrome does not cover content"],
    representativeAction: "Exercise the primary user action from the visible surface and confirm the committed state matches the preview.",
    evidenceRequired: ["ux-context or screenshot", "representative action proof", "static verifier classification"],
    flows: ["fresh open", "primary action", "cancel/recover", "commit", "return"]
  };
}
function reviewQuestionTriggers(flags, verifierRule) {
  const questions = [];
  if (flags.changedChrome || flags.changedNavigation) {
    questions.push("What should this control/chrome mean: navigation, disclosure, filter, picker, or title menu?");
  }
  if (flags.changedGesture) {
    questions.push("Which gesture owns the surface when scroll and direct manipulation overlap?");
  }
  if (flags.addedVisibleControls) {
    questions.push("Can object-level feedback solve discoverability before adding always-visible controls?");
  }
  if (verifierRule) {
    questions.push(`Does verifier rule ${verifierRule} map to the changed workflow or an unrelated legacy surface?`);
  }
  return questions;
}
function reviewCommandSuggestions(args) {
  const base = [
    `expo-ios --json ux-context --cwd ${shellArg2(args.cwd)} --metro-port ${args.metroPort}${args.componentFilter ? ` --component-filter ${shellArg2(args.componentFilter)}` : ""}`
  ];
  if (args.flags.changedGesture || args.flags.changedChrome || args.flags.changedNavigation || args.flags.addedVisibleControls || args.stage === "interaction") {
    base.push(
      `expo-ios --json inspector probe --metro-port ${args.metroPort}`,
      `expo-ios --json inspector toggle --metro-port ${args.metroPort}`,
      `expo-ios --json inspector install-comment-menu --metro-port ${args.metroPort}`,
      "expo-ios --json inspector open-dev-menu",
      `expo-ios --json inspector read-comments --metro-port ${args.metroPort}`,
      `expo-ios --json review-overlay scaffold --cwd ${shellArg2(args.cwd)}`,
      `expo-ios --json review-overlay prepare --cwd ${shellArg2(args.cwd)} --serve true`,
      `expo-ios --json review-overlay read --cwd ${shellArg2(args.cwd)}`
    );
  }
  if (args.flags.changedGesture || args.stage === "interaction") {
    base.push(
      `expo-ios --json trace --action start --metro-port ${args.metroPort}${args.componentFilter ? ` --component-filter ${shellArg2(args.componentFilter)}` : ""}`,
      "# reproduce the representative gesture in the simulator, or use expo-ios gesture when coordinates are known",
      "expo-ios --json gesture drag --start-x <x1> --start-y <y1> --end-x <x2> --end-y <y2> --duration-ms 900 --capture-before-after true",
      "expo-ios --json gesture long-press --x <x> --y <y> --duration-ms 900 --capture-before-after true",
      `expo-ios --json trace --action read --metro-port ${args.metroPort} --max-events 200`,
      `expo-ios --json trace --action stop --metro-port ${args.metroPort}`
    );
  }
  if (!args.flags.hasStaticVerifier && args.stage !== "intake") {
    base.push("verify-native-experience <expo-app> --strict");
  }
  return base;
}
function reviewStopConditions(args) {
  const stops = [];
  if (!args.flags.hasAcceptanceContract) stops.push("Stop before patching: acceptance contract is missing.");
  if (args.flags.changedGesture && !args.flags.hasInteractionProof) stops.push("Stop before handoff: gesture/direct-manipulation proof is missing.");
  if (args.flags.changedChrome && !args.flags.hasInteractionProof) stops.push("Stop before handoff: tab/header/safe-area behavior has not been exercised.");
  if (args.verifierRule && verifierRuleMatchesChangedWorkflow(args.verifierRule, args.flags)) {
    stops.push(`Stop before handoff: verifier rule ${args.verifierRule} maps to the changed workflow.`);
  }
  return stops;
}
function verifierRuleMatchesChangedWorkflow(rule, flags) {
  const normalized = String(rule ?? "").toLowerCase();
  if (flags.changedGesture && /(gesture|panresponder|reanimated|handler|swipe|drag)/.test(normalized)) return true;
  if ((flags.changedChrome || flags.changedNavigation) && /(tab|safe|navigation|header|sheet|modal|back)/.test(normalized)) return true;
  if (/(text|button|row|visible|wrapper)/.test(normalized)) return true;
  return false;
}
function reviewFlags(args) {
  return {
    hasAcceptanceContract: args.hasAcceptanceContract === true,
    hasScreenshot: args.hasScreenshot === true,
    hasInteractionProof: args.hasInteractionProof === true,
    hasStaticVerifier: args.hasStaticVerifier === true,
    changedGesture: args.changedGesture === true,
    changedChrome: args.changedChrome === true,
    changedNavigation: args.changedNavigation === true,
    addedVisibleControls: args.addedVisibleControls === true
  };
}
function shellArg2(value) {
  const text = String(value);
  if (/^[A-Za-z0-9_./:@=-]+$/.test(text)) return text;
  return `'${text.replace(/'/g, "'\\''")}'`;
}
function requireOptionalString8(value) {
  if (value == null) return void 0;
  if (typeof value !== "string") throw new Error("Expected optional string.");
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : void 0;
}
function clampNumber15(value, min, max) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return min;
  return Math.max(min, Math.min(max, Math.trunc(numberValue)));
}

// src/modules/annotation-server-http/src/main/index.ts
async function annotationServer(args = {}) {
  return annotationServerDeprecationPayload(args);
}
function annotationServerDeprecationPayload(args = {}) {
  return {
    available: false,
    action: "annotation-server",
    code: "external-annotation-server-removed",
    reason: "The external annotation server has been removed. Use the in-app annotation overlay instead.",
    requested: {
      dir: typeof args.dir === "string" ? args.dir : null,
      port: args.port ?? null
    },
    replacement: {
      prepare: "annotate-screen prepare --serve true",
      server: "annotate-screen server",
      read: "annotate-screen read",
      scaffold: "annotate-screen scaffold --confirm-actions annotate-overlay-scaffold"
    },
    limitations: [
      "Annotation UI must be mounted inside the Expo/React Native app.",
      "This compatibility command does not serve external annotation boards."
    ]
  };
}

// src/modules/devtools-diagnostics/src/main/index.ts
var DEVTOOLS_EVENTS_LIMITATIONS = [
  "This v1 collector records DevTools capability/session events, not a raw Chrome DevTools Protocol stream."
];
var DIAGNOSTICS_LIMITATIONS = [
  "Start Metro and connect a debuggable Hermes target before reading JS diagnostics."
];
var MAX_OUTPUT10 = 4e4;
var MAX_ARRAY_ITEMS = 500;
var defaultDevtoolsDiagnosticsDependencies = {
  evaluateHermesExpression
};
function toolJson17(value) {
  return { content: [{ type: "text", text: JSON.stringify(sanitizePayload(value), null, 2) }] };
}
function requireString10(value, name) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${name} must be a non-empty string.`);
  }
  return value.trim();
}
function clampNumber16(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new Error(`Expected a finite number, got ${String(value)}.`);
  }
  return Math.min(Math.max(number, min), max);
}
function truncate13(value, max = MAX_OUTPUT10) {
  const text = String(value ?? "");
  if (text.length <= max) return text;
  return `${text.slice(0, max)}
...[truncated ${text.length - max} chars]`;
}
function targetSummary4(target) {
  if (!target) return null;
  return {
    id: target.id ?? null,
    title: target.title ?? null,
    description: target.description ?? null,
    appId: target.appId ?? null,
    deviceName: target.deviceName ?? null,
    devtoolsFrontendUrl: target.devtoolsFrontendUrl ?? null,
    webSocketDebuggerUrl: target.webSocketDebuggerUrl ?? null,
    reactNative: target.reactNative ?? null,
    capabilities: target.capabilities ?? {
      hermesRuntime: typeof target.webSocketDebuggerUrl === "string" && target.webSocketDebuggerUrl.startsWith("ws"),
      devtoolsFrontend: typeof target.devtoolsFrontendUrl === "string" && target.devtoolsFrontendUrl.length > 0,
      reactNative: Boolean(target.reactNative)
    }
  };
}
async function devtoolsCommand(args = {}, deps = defaultDevtoolsDiagnosticsDependencies) {
  const action = requireString10(args.action ?? "capabilities", "action");
  if (action === "status" || action === "panels") return toolJson17(await devtoolsStatusPayload(args, action, deps));
  if (action === "open") return toolJson17(await devtoolsOpenPayload(args, deps));
  if (action === "events") return toolJson17(await devtoolsEventsPayload(args, deps));
  if (action !== "capabilities") throw new Error(`Unknown devtools action: ${action}`);
  const metro = await metroStatusPayload2(args, deps);
  const rnDevTools = reactNativeDevToolsReport(metro);
  const hasTarget = metro.targets.length > 0;
  const hasRuntime = metro.targets.some((target) => target.webSocketDebuggerUrl);
  const hasDevtoolsFrontend = rnDevTools.frontend.available;
  const hasNetworkPanel = metro.targets.some(targetHasDevtoolsNetworkPanel);
  return toolJson17({
    action,
    metroPort: metro.metroPort,
    reactNativeDevTools: rnDevTools,
    capabilities: [
      capabilityRecord({
        name: "metro-http",
        source: "metro",
        transport: "http",
        available: metro.available,
        confidence: metro.available ? "high" : "low",
        reason: metro.available ? null : metro.reason ?? null,
        readCommands: ["metro status", "target list", "devtools capabilities"],
        writeCommands: [],
        artifactTypes: ["json"],
        repairHints: metro.available ? [] : ["Start Metro for the Maddie Native app and rerun with the correct --metro-port."],
        limitations: metro.available ? ["Reports Metro server and target discovery only; it does not prove the app UI is ready."] : ["Metro was not reachable on the requested port."]
      }),
      capabilityRecord({
        name: "metro-symbolication",
        source: "metro",
        transport: "http",
        available: metro.symbolication.available,
        confidence: metro.symbolication.available ? "high" : "low",
        reason: metro.symbolication.available ? null : metro.symbolication.reason ?? null,
        readCommands: ["metro symbolicate"],
        writeCommands: [],
        artifactTypes: ["json"],
        repairHints: metro.symbolication.available ? [] : ["Confirm Metro is serving the current bundle and source maps."],
        limitations: metro.symbolication.available ? ["Symbolication quality depends on source maps for the current bundle."] : ["The Metro /symbolicate endpoint did not accept a probe request."]
      }),
      capabilityRecord({
        name: "hermes-runtime",
        source: "hermes-inspector",
        transport: "websocket",
        available: hasRuntime,
        confidence: hasRuntime ? "medium" : "low",
        reason: hasRuntime ? null : hasTarget ? "No target exposes a websocket debugger URL." : "No Metro inspector target.",
        readCommands: ["console", "errors", "rn tree", "trace --action read"],
        writeCommands: ["trace --action start", "trace --action stop", "inspector install-comment-menu"],
        artifactTypes: ["json", "run-record"],
        repairHints: hasRuntime ? [] : ["Open Maddie Native in a debuggable development build and confirm /json/list includes webSocketDebuggerUrl."],
        limitations: hasRuntime ? ["Runtime signals are unavailable in disconnected, production, or non-Hermes targets."] : ["Console, errors, React tree, and runtime globals cannot be read without an inspector websocket."]
      }),
      capabilityRecord({
        name: "react-native-devtools",
        source: "react-native-devtools",
        transport: "metro-http",
        available: hasDevtoolsFrontend,
        confidence: hasDevtoolsFrontend ? "medium" : "low",
        reason: hasDevtoolsFrontend ? null : "No target advertises a React Native DevTools frontend URL.",
        readCommands: ["devtools status", "devtools panels", "devtools open"],
        writeCommands: ["devtools open"],
        artifactTypes: ["json"],
        repairHints: hasDevtoolsFrontend ? [] : ["Connect a React Native target to Metro that advertises devtoolsFrontendUrl."],
        limitations: hasDevtoolsFrontend ? ["The CLI can open and report the DevTools frontend; interactive panel state remains owned by React Native DevTools."] : ["React Native DevTools cannot be opened without a Metro target frontend URL."]
      }),
      capabilityRecord({
        name: "react-native-devtools-network-panel",
        source: "react-native-devtools",
        transport: "metro-http",
        available: hasNetworkPanel,
        confidence: hasNetworkPanel ? "medium" : "low",
        reason: hasNetworkPanel ? null : "No target advertises unstable_enableNetworkPanel=true in its DevTools frontend URL.",
        readCommands: ["devtools panels", "devtools open"],
        writeCommands: [],
        artifactTypes: ["human-visible-panel"],
        repairHints: hasNetworkPanel ? [] : ["Enable or connect a React Native DevTools target whose frontend URL includes unstable_enableNetworkPanel=true."],
        limitations: hasNetworkPanel ? ["The panel is an interactive DevTools UI surface; command-line HAR/export still uses app bridge evidence."] : ["Use the app network bridge for CLI-readable request evidence when the DevTools network panel is absent."]
      }),
      capabilityRecord({
        name: "console",
        source: "runtime-diagnostics",
        transport: "hermes-runtime",
        available: hasRuntime,
        confidence: hasRuntime ? "medium" : "low",
        reason: hasRuntime ? null : "No runtime diagnostics source is available.",
        readCommands: ["console"],
        writeCommands: [],
        artifactTypes: ["json", "run-record"],
        repairHints: hasRuntime ? [] : ["Connect Hermes runtime and install diagnostics instrumentation if the buffer is empty."],
        limitations: [
          "JS console diagnostics require app/runtime instrumentation or a readable runtime buffer.",
          "Native device logs are a different evidence stream; use logs for those."
        ]
      }),
      capabilityRecord({
        name: "errors",
        source: "runtime-diagnostics",
        transport: "hermes-runtime",
        available: hasRuntime,
        confidence: hasRuntime ? "medium" : "low",
        reason: hasRuntime ? null : "No runtime diagnostics source is available.",
        readCommands: ["errors"],
        writeCommands: [],
        artifactTypes: ["json", "run-record"],
        repairHints: hasRuntime ? [] : ["Connect Hermes runtime and verify the app exposes bounded error diagnostics."],
        limitations: [
          "Error diagnostics depend on runtime buffers and may not include native crashes.",
          "Use logs and trace evidence for lower-level failures."
        ]
      })
    ],
    metro
  });
}
async function devtoolsStatusPayload(args = {}, action = "status", deps = {}) {
  const metro = await metroStatusPayload2(args, deps);
  const reactNativeDevTools = reactNativeDevToolsReport(metro);
  const panels = reactNativeDevTools.panels;
  const payload = {
    available: metro.available,
    action,
    metroPort: metro.metroPort,
    metro,
    target: reactNativeDevTools.target,
    frontend: reactNativeDevTools.frontend,
    attachmentState: reactNativeDevTools.attachmentState,
    attachmentRisk: reactNativeDevTools.attachmentRisk,
    panels,
    machineReadableDomains: panels.filter((panel) => panel.kind === "machine-readable-domain"),
    humanVisiblePanels: panels.filter((panel) => panel.kind === "human-visible-panel")
  };
  return sanitizePayload(payload);
}
function reactNativeDevToolsReport(metro) {
  const target = metro.targets.find((item) => item.devtoolsFrontendUrl) ?? metro.targets[0] ?? null;
  const frontendUrl = frontendUrlForTarget(target, metro.metroPort);
  const hasNetworkPanel = targetHasDevtoolsNetworkPanel(target);
  const hasRuntime = Boolean(target?.webSocketDebuggerUrl);
  const attachmentState = detectDevToolsAttachmentState(target);
  const attachmentRisk = {
    level: hasRuntime || frontendUrl ? "medium" : "low",
    mayDetachHumanDebugger: Boolean(hasRuntime || frontendUrl),
    reason: hasRuntime || frontendUrl ? "Opening React Native DevTools can attach to the selected target and may affect an existing human debugger session." : "No debuggable React Native target is available."
  };
  const panels = [
    devtoolsPanelRecord({
      name: "debugger",
      kind: "human-visible-panel",
      available: Boolean(frontendUrl),
      transport: "react-native-devtools",
      source: "devtoolsFrontendUrl",
      readCommands: ["devtools open"],
      writeCommands: ["devtools open"],
      artifactTypes: ["human-visible-panel"],
      limitations: ["Interactive debugger state is owned by React Native DevTools."],
      repairHints: frontendUrl ? [] : ["Connect a Metro target that advertises devtoolsFrontendUrl."]
    }),
    devtoolsPanelRecord({
      name: "network",
      kind: "human-visible-panel",
      available: hasNetworkPanel,
      transport: "react-native-devtools",
      source: "devtoolsFrontendUrl",
      readCommands: ["devtools panels", "devtools open"],
      writeCommands: [],
      artifactTypes: ["human-visible-panel"],
      limitations: ["The network panel is human-visible; CLI-readable HAR still requires network bridge evidence."],
      repairHints: hasNetworkPanel ? [] : ["Use the app network bridge or connect a target with unstable_enableNetworkPanel=true."]
    }),
    devtoolsPanelRecord({
      name: "console",
      kind: "machine-readable-domain",
      available: hasRuntime,
      transport: "hermes-runtime",
      source: "runtime-diagnostics",
      readCommands: ["console"],
      writeCommands: [],
      artifactTypes: ["json", "run-record"],
      limitations: ["Requires a readable runtime diagnostics buffer for bounded CLI output."],
      repairHints: hasRuntime ? [] : ["Connect Hermes runtime and enable app diagnostics instrumentation."]
    }),
    devtoolsPanelRecord({
      name: "errors",
      kind: "machine-readable-domain",
      available: hasRuntime,
      transport: "hermes-runtime",
      source: "runtime-diagnostics",
      readCommands: ["errors"],
      writeCommands: [],
      artifactTypes: ["json", "run-record"],
      limitations: ["Runtime JS errors are separate from native crash reports."],
      repairHints: hasRuntime ? [] : ["Connect Hermes runtime and use logs/crash reports for native failures."]
    }),
    devtoolsPanelRecord({
      name: "react-components",
      kind: "machine-readable-domain",
      available: hasRuntime,
      transport: "react-devtools-hook",
      source: "react-devtools-hook",
      readCommands: ["rn tree", "rn inspect", "snapshot"],
      writeCommands: [],
      artifactTypes: ["json", "run-record"],
      limitations: ["Component tree evidence depends on development runtime hooks and may omit private fiber details."],
      repairHints: hasRuntime ? [] : ["Connect Hermes runtime and confirm React DevTools hook availability."]
    })
  ];
  return sanitizePayload({
    target,
    frontend: { available: Boolean(frontendUrl), url: frontendUrl, launchPath: frontendUrl ? "metro-devtools-frontend-url" : null },
    attachmentState,
    attachmentRisk,
    panels
  });
}
async function devtoolsOpenPayload(args = {}, deps = {}) {
  const metro = await metroStatusPayload2(args, deps);
  const reactNativeDevTools = reactNativeDevToolsReport(metro);
  const target = reactNativeDevTools.target;
  const url = reactNativeDevTools.frontend.url;
  if (!url) {
    return sanitizePayload({
      available: false,
      action: "open",
      reason: "No DevTools frontend URL is available.",
      metro,
      reactNativeDevTools
    });
  }
  const result = await execFile8(deps, "open", [url], { timeout: 1e4, rejectOnError: false });
  return sanitizePayload({
    available: !result.error,
    action: "open",
    url,
    target,
    launchPath: "metro-devtools-frontend-url",
    mirrorsUpstreamLaunch: true,
    attachmentState: reactNativeDevTools.attachmentState,
    attachmentRisk: reactNativeDevTools.attachmentRisk,
    stdout: truncate13(result.stdout),
    stderr: truncate13(result.stderr),
    error: result.error ?? null
  });
}
async function devtoolsEventsPayload(args = {}, deps = {}) {
  const subaction = requireString10(args.subaction ?? "read", "subaction");
  if (!["start", "read", "stop"].includes(subaction)) throw new Error(`Unknown devtools events action: ${subaction}`);
  const stateRoot = resolveExpoStateRoot4(args, deps);
  const eventsDir = joinPath3(stateRoot, "artifacts", "devtools-events");
  await mkdir11(deps, eventsDir, { recursive: true });
  const file = joinPath3(eventsDir, "events.json");
  const existing = await readJsonFile5(deps, file).catch(() => ({ events: [] }));
  const previousEvents = Array.isArray(asRecord9(existing)?.events) ? asRecord9(existing)?.events : [];
  const event = {
    type: `devtools.${subaction}`,
    timestamp: now2(deps),
    metro: sanitizePayload(await metroStatusPayload2(args, deps))
  };
  const payload = {
    available: true,
    action: "events",
    subaction,
    artifact: file,
    events: subaction === "start" ? [event] : [...previousEvents, event],
    limitations: DEVTOOLS_EVENTS_LIMITATIONS
  };
  const sanitized = sanitizePayload(payload);
  await writeJsonFile3(deps, file, sanitized);
  return sanitized;
}
async function consoleCommand(args = {}, deps = defaultDevtoolsDiagnosticsDependencies) {
  return diagnosticMessagesCommand("console", args, deps);
}
async function errorsCommand(args = {}, deps = defaultDevtoolsDiagnosticsDependencies) {
  return diagnosticMessagesCommand("errors", args, deps);
}
async function diagnosticMessagesCommand(kind, args = {}, deps = defaultDevtoolsDiagnosticsDependencies) {
  const action = args.action ?? "read";
  const metroPort = clampNumber16(args.metroPort ?? 8081, 1, 65535);
  const limit = clampNumber16(args.limit ?? 100, 1, 1e3);
  const targetDiscovery = await metroTargetDiscovery(metroPort, deps);
  const targets = targetDiscovery.targets;
  const webSocketDebuggerUrl = targets[0]?.webSocketDebuggerUrl ?? null;
  if (!webSocketDebuggerUrl) {
    return toolJson17({
      available: false,
      kind,
      source: "hermes-runtime",
      reason: targetDiscovery.reason ?? "No Metro inspector target.",
      metroPort,
      messages: [],
      targetDiscovery,
      limitations: DIAGNOSTICS_LIMITATIONS
    });
  }
  if (action === "clear") {
    const result2 = await evaluateHermesExpression2(deps, webSocketDebuggerUrl, clearDiagnosticsExpression(kind), { timeoutMs: 5e3 });
    return toolJson17({
      ...valueFromHermes(result2) ?? { available: false, reason: result2?.error ?? "Runtime diagnostics did not return a value." },
      kind,
      action,
      metroPort,
      target: targetSummary4(targets[0]),
      cdp: result2?.diagnostics ?? result2?.cdp ?? null
    });
  }
  const result = await evaluateHermesExpression2(deps, webSocketDebuggerUrl, diagnosticsExpression({ kind, limit }), { timeoutMs: 5e3 });
  const value = valueFromHermes(result);
  if (!value) {
    return toolJson17({
      available: false,
      kind,
      source: "hermes-runtime",
      reason: result?.error ?? "Runtime diagnostics did not return a value.",
      metroPort,
      messages: [],
      cdp: result?.diagnostics ?? result?.cdp ?? null
    });
  }
  const record = asRecord9(value) ?? {};
  const messages = Array.isArray(record.messages) ? record.messages.slice(-limit) : [];
  return toolJson17({
    ...record,
    kind,
    metroPort,
    target: targetSummary4(targets[0]),
    messages,
    limit,
    cdp: result?.diagnostics ?? result?.cdp ?? null
  });
}
function diagnosticsExpression({ kind, limit }) {
  return `(() => {
    const kind = ${JSON.stringify(kind)};
    const limit = ${Number(limit)};
    const diagnostics = globalThis.__EXPO_IOS_DIAGNOSTICS__ || globalThis.__CODEX_DIAGNOSTICS__ || {};
    const raw = diagnostics[kind] || diagnostics[kind === 'errors' ? 'error' : 'logs'] || [];
    const messages = Array.isArray(raw) ? raw.slice(-limit).map((entry, index) => ({
      index,
      level: entry && typeof entry === 'object' ? (entry.level || (kind === 'errors' ? 'error' : 'log')) : (kind === 'errors' ? 'error' : 'log'),
      message: entry && typeof entry === 'object' ? String(entry.message || entry.text || entry.value || '') : String(entry),
      timestamp: entry && typeof entry === 'object' ? (entry.timestamp || entry.time || null) : null,
      source: entry && typeof entry === 'object' ? (entry.source || null) : null,
      stack: entry && typeof entry === 'object' ? (entry.stack || null) : null
    })) : [];
    return {
      available: Array.isArray(raw),
      source: Array.isArray(raw) ? 'runtime-diagnostics-buffer' : 'missing-runtime-diagnostics-buffer',
      total: Array.isArray(raw) ? raw.length : 0,
      messages,
      limitations: Array.isArray(raw)
        ? ['Runtime diagnostics reflect the app-provided buffer; native logs are not included.']
        : ['Install or enable runtime diagnostics instrumentation to populate this buffer.']
    };
  })()`;
}
function capabilityRecord(args) {
  return {
    name: args.name,
    source: args.source,
    transport: args.transport,
    available: args.available === true,
    confidence: args.confidence,
    reason: args.reason,
    readCommands: args.readCommands ?? [],
    writeCommands: args.writeCommands ?? [],
    artifactTypes: args.artifactTypes ?? [],
    repairHints: args.repairHints ?? [],
    limitations: args.limitations
  };
}
function detectDevToolsAttachmentState(target) {
  if (!target) return { state: "unavailable", detectable: false, reason: "No Metro target." };
  const raw = target.reactNative ?? {};
  const attached = raw.debuggerFrontendConnected ?? raw.debuggerConnected ?? raw.isDebuggerConnected ?? target.attached;
  if (attached === true) return { state: "attached", detectable: true };
  if (attached === false) return { state: "not-attached", detectable: true };
  return { state: "unknown", detectable: false, reason: "Metro target metadata did not expose debugger attachment state." };
}
function targetHasDevtoolsNetworkPanel(target) {
  const url = target?.devtoolsFrontendUrl;
  if (!url) return false;
  try {
    const parsed = new URL(url, "http://127.0.0.1");
    return parsed.searchParams.get("unstable_enableNetworkPanel") === "true";
  } catch {
    return /[?&]unstable_enableNetworkPanel=true(?:&|$)/.test(String(url));
  }
}
function devtoolsPanelRecord(args) {
  return {
    name: args.name,
    kind: args.kind,
    machineReadable: args.kind === "machine-readable-domain",
    humanVisible: args.kind === "human-visible-panel",
    available: args.available === true,
    transport: args.transport,
    source: args.source,
    readCommands: args.readCommands,
    writeCommands: args.writeCommands,
    artifactTypes: args.artifactTypes,
    limitations: args.limitations,
    repairHints: args.repairHints
  };
}
function frontendUrlForTarget(target, metroPort) {
  const url = target?.devtoolsFrontendUrl;
  if (!url) return null;
  return url.startsWith("http") ? url : `http://127.0.0.1:${metroPort}${url}`;
}
async function metroStatusPayload2(args, deps) {
  if (deps.metroStatusPayload) return deps.metroStatusPayload(args);
  const metroPort = clampNumber16(args.metroPort ?? 8081, 1, 65535);
  const baseUrl = `http://127.0.0.1:${metroPort}`;
  const status = await fetchText(deps, `${baseUrl}/status`, 1500);
  if (!status.available) {
    return {
      available: false,
      reason: "Metro is not reachable on the requested port.",
      metroPort,
      status: "unavailable",
      statusText: null,
      error: status.error,
      symbolication: { available: false, reason: "Metro is unavailable." },
      targetCount: 0,
      targets: []
    };
  }
  const targetDiscovery = await fetchMetroTargets(deps, metroPort);
  const version = await fetchJson(deps, `${baseUrl}/json/version`, 1500).catch((error) => ({
    __error: formatError12(error)
  }));
  const symbolication = await probeMetroSymbolication(deps, metroPort);
  return {
    available: true,
    reason: null,
    metroPort,
    status: "available",
    statusText: status.text,
    version: asRecord9(version)?.__error ? null : version,
    versionError: asRecord9(version)?.__error ?? null,
    symbolication,
    targetCount: targetDiscovery.targets.length,
    targets: targetDiscovery.targets,
    targetDiscovery
  };
}
async function fetchMetroTargets(deps, metroPort) {
  const raw = await fetchJson(deps, `http://127.0.0.1:${metroPort}/json/list`, 2500).catch((error2) => ({
    __error: formatError12(error2)
  }));
  const error = asRecord9(raw)?.__error;
  if (typeof error === "string") {
    return { available: false, endpoint: "/json/list", targets: [], malformedTargets: [], reason: error };
  }
  if (!Array.isArray(raw)) {
    return {
      available: false,
      endpoint: "/json/list",
      targets: [],
      malformedTargets: [{ index: null, reason: "Metro target list was not an array.", shape: responseShape2(raw) }],
      reason: "Metro target list was malformed."
    };
  }
  const targets = [];
  const malformedTargets = [];
  raw.forEach((entry, index) => {
    const normalized = normalizeMetroTarget(entry, index);
    if (normalized.target) targets.push(normalized.target);
    if (normalized.error) malformedTargets.push(normalized.error);
  });
  return {
    available: true,
    endpoint: "/json/list",
    targets,
    malformedTargets,
    reason: malformedTargets.length > 0 ? "Some Metro targets were malformed and skipped." : null
  };
}
async function metroTargetDiscovery(metroPort, deps) {
  if (typeof deps.targetDiscovery === "function") return deps.targetDiscovery(metroPort);
  if (deps.targetDiscovery) return deps.targetDiscovery;
  return fetchMetroTargets(deps, metroPort);
}
function clearDiagnosticsExpression(kind) {
  return `(() => {
      const diagnostics = globalThis.__EXPO_IOS_DIAGNOSTICS__ || globalThis.__CODEX_DIAGNOSTICS__;
      if (!diagnostics) return { available: false, cleared: false, reason: 'Runtime diagnostics buffer is not installed.' };
      if (Array.isArray(diagnostics[${JSON.stringify(kind)}])) diagnostics[${JSON.stringify(kind)}].length = 0;
      return { available: true, cleared: true };
    })()`;
}
async function evaluateHermesExpression2(deps, webSocketDebuggerUrl, expression, options) {
  const evaluate = deps.evaluateHermesExpression ?? evaluateHermesExpression;
  return evaluate(webSocketDebuggerUrl, expression, options);
}
function valueFromHermes(result) {
  return result?.result?.result?.value;
}
async function execFile8(deps, file, args, options) {
  if (deps.execFile) return deps.execFile(file, args, options);
  const childProcess = await import("node:child_process");
  return new Promise((resolve15) => {
    childProcess.execFile(file, args, { timeout: options.timeout }, (error, stdout, stderr) => {
      resolve15({
        stdout,
        stderr,
        error: error ? formatError12(error) : null
      });
    });
  });
}
function resolveExpoStateRoot4(args, deps) {
  if (deps.resolveExpoStateRoot) return deps.resolveExpoStateRoot(args);
  const explicit = typeof args.stateDir === "string" && args.stateDir.length > 0 ? args.stateDir : null;
  if (explicit?.endsWith("/runs")) return explicit.slice(0, -"/runs".length);
  return explicit ?? joinPath3(typeof args.root === "string" ? args.root : ".", ".scratch", "expo-ios");
}
async function mkdir11(deps, dir, options) {
  if (deps.mkdir) return deps.mkdir(dir, options);
  const fs10 = await import("node:fs/promises");
  return fs10.mkdir(dir, options);
}
async function readJsonFile5(deps, file) {
  if (!deps.readJsonFile) {
    const fs10 = await import("node:fs/promises");
    return JSON.parse(await fs10.readFile(file, "utf8"));
  }
  return deps.readJsonFile(file);
}
async function writeJsonFile3(deps, file, payload) {
  const redacted = sanitizePayload(deps.redactValue ? deps.redactValue(payload) : payload);
  if (!deps.writeJsonFile) {
    const fs10 = await import("node:fs/promises");
    await fs10.writeFile(file, `${JSON.stringify(redacted, null, 2)}
`, "utf8");
    return void 0;
  }
  return deps.writeJsonFile(file, redacted);
}
function now2(deps) {
  return deps.now ? deps.now() : (/* @__PURE__ */ new Date()).toISOString();
}
function joinPath3(...parts) {
  const absolute = parts[0]?.startsWith("/") === true;
  const joined = parts.flatMap((part) => part.split("/")).filter((part, index) => part.length > 0 || absolute && index === 0).join("/");
  return absolute ? `/${joined}`.replace(/\/+/g, "/") : joined.replace(/\/+/g, "/");
}
function asRecord9(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}
async function probeMetroSymbolication(deps, metroPort) {
  try {
    const response = asFetchResponse(await fetchWithTimeout2(deps, `http://127.0.0.1:${metroPort}/symbolicate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ stack: [] }),
      timeoutMs: 1500
    }));
    return {
      available: response.ok,
      endpoint: "/symbolicate",
      status: response.status,
      reason: response.ok ? null : `Metro symbolicate HTTP ${response.status}`
    };
  } catch (error) {
    return { available: false, endpoint: "/symbolicate", status: null, reason: formatError12(error) };
  }
}
async function fetchText(deps, url, timeoutMs) {
  try {
    const response = asFetchResponse(await fetchWithTimeout2(deps, url, { timeoutMs }));
    return { available: response.ok, text: await response.text(), error: response.ok ? null : `HTTP ${response.status}` };
  } catch (error) {
    return { available: false, text: null, error: formatError12(error) };
  }
}
async function fetchJson(deps, url, timeoutMs) {
  const response = asFetchResponse(await fetchWithTimeout2(deps, url, { timeoutMs }));
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}
async function fetchWithTimeout2(deps, url, options) {
  const fetcher = deps.fetch ?? globalThis.fetch;
  if (!fetcher) throw new Error("fetch is not available in this runtime.");
  const timeoutMs = Number(options.timeoutMs ?? 1500);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const { timeoutMs: _timeoutMs, ...requestOptions } = options;
    return await fetcher(url, { ...requestOptions, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
function asFetchResponse(value) {
  const response = value;
  return {
    ok: response.ok === true,
    status: typeof response.status === "number" ? response.status : 0,
    text: typeof response.text === "function" ? response.text.bind(response) : async () => "",
    json: typeof response.json === "function" ? response.json.bind(response) : async () => null
  };
}
function normalizeMetroTarget(value, index) {
  const record = asRecord9(value);
  if (!record) {
    return { target: null, error: { index, reason: "Target was not an object.", shape: responseShape2(value) } };
  }
  const target = {
    id: optionalString5(record.id),
    title: optionalString5(record.title),
    description: optionalString5(record.description),
    appId: optionalString5(record.appId),
    deviceName: optionalString5(record.deviceName),
    devtoolsFrontendUrl: optionalString5(record.devtoolsFrontendUrl),
    webSocketDebuggerUrl: optionalString5(record.webSocketDebuggerUrl),
    reactNative: asRecord9(record.reactNative),
    attached: record.attached
  };
  if (!target.id && !target.title && !target.webSocketDebuggerUrl && !target.devtoolsFrontendUrl) {
    return {
      target: null,
      error: { index, reason: "Target did not include any stable identifying metadata.", shape: responseShape2(value) }
    };
  }
  return { target, error: null };
}
function optionalString5(value) {
  return typeof value === "string" && value.length > 0 ? value : null;
}
function responseShape2(value) {
  if (Array.isArray(value)) return { type: "array", length: value.length };
  if (value && typeof value === "object") return { type: "object", keys: Object.keys(value).slice(0, 20) };
  return { type: typeof value };
}
function sanitizePayload(value) {
  return boundValue(redactValue5(value));
}
function boundValue(value) {
  if (typeof value === "string") return truncate13(value);
  if (Array.isArray(value)) return value.slice(-MAX_ARRAY_ITEMS).map(boundValue);
  const record = asRecord9(value);
  if (!record) return value;
  return Object.fromEntries(Object.entries(record).map(([key, nested]) => [key, boundValue(nested)]));
}
function redactValue5(value) {
  if (typeof value === "string") return redactString(value);
  if (Array.isArray(value)) return value.map(redactValue5);
  const record = asRecord9(value);
  if (!record) return value;
  return Object.fromEntries(Object.entries(record).map(([key, nested]) => [
    key,
    isSensitiveKey(key) ? "[redacted]" : redactValue5(nested)
  ]));
}
function redactString(value) {
  try {
    const parsed = new URL(value);
    let changed = false;
    for (const key of [...parsed.searchParams.keys()]) {
      if (isSensitiveKey(key)) {
        parsed.searchParams.set(key, "[redacted]");
        changed = true;
      }
    }
    return changed ? parsed.toString() : value;
  } catch {
    return value.replace(/([?&](?:cookie|token|authorization|password|secret|api[-_]?key|apikey)=)[^&\s]+/gi, "$1[redacted]");
  }
}
function isSensitiveKey(key) {
  return /token|authorization|cookie|password|secret|apikey|apiKey/i.test(key);
}
function formatError12(error) {
  const record = asRecord9(error);
  const message = record?.message;
  return message == null ? String(error) : String(message);
}

// src/modules/navigation-deeplinks/src/main/index.ts
var EXPO_IOS_BRIDGE_VERSION = "1.0.0";
var NAVIGATION_LIMITATIONS = [
  "Navigation state and imperative navigation actions require the dev-only app instrumentation bridge.",
  "Use open-route or navigation deep-link when only URL navigation is available."
];
function clampNumber17(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`Expected a finite number, got ${String(value)}.`);
  return Math.min(Math.max(number, min), max);
}
function targetSummary5(target) {
  if (!target) return null;
  return {
    id: target.id ?? null,
    title: target.title ?? null,
    description: target.description ?? null,
    appId: target.appId ?? null,
    deviceName: target.deviceName ?? null,
    devtoolsFrontendUrl: target.devtoolsFrontendUrl ?? null,
    webSocketDebuggerUrl: target.webSocketDebuggerUrl ?? null,
    reactNative: target.reactNative ?? null,
    capabilities: target.capabilities ?? {
      hermesRuntime: typeof target.webSocketDebuggerUrl === "string" && target.webSocketDebuggerUrl.startsWith("ws"),
      devtoolsFrontend: typeof target.devtoolsFrontendUrl === "string" && target.devtoolsFrontendUrl.length > 0,
      reactNative: Boolean(target.reactNative)
    }
  };
}
function navigationTransport(metroPort, target, cdp = null) {
  return {
    name: "metro-inspector-hermes-cdp",
    metroPort,
    protocol: "Runtime.evaluate",
    target: targetSummary5(target),
    cdp
  };
}
function navigationUnavailable(args) {
  return {
    available: false,
    action: args.action,
    source: "app-instrumentation",
    evidenceSource: "unavailable",
    reason: args.reason,
    metroPort: args.metroPort,
    target: args.target ?? null,
    transport: navigationTransport(args.metroPort, args.target ?? null),
    policy: args.policy ?? null,
    limitations: NAVIGATION_LIMITATIONS
  };
}
async function navigationPolicyDecision(args, action, deps = {}) {
  const sideEffect = action === "state" ? "read" : "device";
  if (action === "state") {
    return {
      checked: true,
      action: `navigation.${action}`,
      sideEffect,
      allowed: true,
      reason: "Read action does not require policy approval."
    };
  }
  if (action === "deep-link") {
    return {
      checked: true,
      action: `navigation.${action}`,
      sideEffect,
      allowed: true,
      reason: "Deep-link navigation uses the existing open-route fallback policy."
    };
  }
  if (!deps.policyDecision) {
    return {
      checked: true,
      action: `navigation.${action}`,
      sideEffect,
      allowed: false,
      source: null,
      reason: "No action policy allowed this state-changing operation."
    };
  }
  return deps.policyDecision(args, `navigation.${action}`, "device");
}
async function navigationCommand(args = {}, deps = defaultNavigationDependencies) {
  const action = requireString11(args.action ?? "state", "action");
  if (!["state", "back", "pop-to-root", "tab", "deep-link"].includes(action)) {
    throw new Error(`Unknown navigation action: ${action}`);
  }
  if (action === "deep-link") return toolJson18(await navigationDeepLink(args, deps));
  const metroPort = clampNumber17(args.metroPort ?? 8081, 1, 65535);
  const policy = await navigationPolicyDecision(args, action, deps);
  if (!policy.allowed) {
    return toolJson18({
      available: false,
      action,
      metroPort,
      source: "policy",
      evidenceSource: "policy",
      reason: policy.reason,
      policy,
      transport: navigationTransport(metroPort, null, null)
    });
  }
  const targets = deps.metroTargets ? await deps.metroTargets(metroPort) : [];
  const target = targets[0] ?? null;
  const webSocketDebuggerUrl = target?.webSocketDebuggerUrl ?? null;
  if (!webSocketDebuggerUrl) {
    return toolJson18(navigationUnavailable({ action, metroPort, reason: "No Metro inspector target.", policy }));
  }
  if (!deps.evaluateHermesExpression) {
    return toolJson18(navigationUnavailable({
      action,
      metroPort,
      reason: "No Hermes evaluator is configured.",
      target: targetSummary5(target),
      policy
    }));
  }
  const result = await deps.evaluateHermesExpression(
    webSocketDebuggerUrl,
    navigationExpression({ action, tab: args.tab ?? args._?.[1] }),
    { timeoutMs: 5e3 }
  );
  const value = result?.result?.result?.value;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return toolJson18(navigationUnavailable({
      action,
      metroPort,
      reason: result?.error ?? "Navigation bridge did not return a value.",
      target: targetSummary5(target),
      policy
    }));
  }
  return toolJson18({
    ...value,
    action,
    metroPort,
    target: targetSummary5(target),
    transport: navigationTransport(metroPort, target, result?.diagnostics),
    evidenceSource: "source" in value && typeof value.source === "string" ? value.source : "unknown",
    policy
  });
}
async function navigationDeepLink(args = {}, deps = defaultNavigationDependencies) {
  const policy = await navigationPolicyDecision(args, "deep-link", deps);
  if (!policy.allowed) return { available: false, action: "deep-link", reason: policy.reason, policy };
  if (!deps.openExpoRoute) {
    return { available: false, action: "deep-link", reason: "No open-route adapter is configured.", policy };
  }
  const route = args.route ?? args._?.[1] ?? args._?.[0];
  const openedRaw = unwrapToolJson8(await deps.openExpoRoute({ ...args, route }));
  if (!openedRaw || typeof openedRaw !== "object" || Array.isArray(openedRaw)) {
    return {
      available: false,
      action: "deep-link",
      source: "open-route",
      evidenceSource: "deep-link",
      reason: "Open-route result was malformed.",
      policy
    };
  }
  const opened = sanitizeOpenRouteResult(openedRaw);
  return {
    available: true,
    action: "deep-link",
    source: "open-route",
    evidenceSource: "deep-link",
    transport: {
      name: "simulator-open-url",
      command: "open-route",
      target: opened.device ?? null
    },
    policy,
    deepLink: opened,
    evidence: {
      targetId: await selectedTargetId(args, deps),
      sessionId: await latestSessionId(args, deps),
      route: route ?? opened.route ?? null,
      url: opened.url ?? null
    }
  };
}
var defaultNavigationDependencies = {
  metroTargets: (metroPort) => metroTargets(metroPort),
  evaluateHermesExpression,
  openExpoRoute
};
function navigationExpression(args) {
  return `(() => {
    const action = ${JSON.stringify(args.action)};
    const tab = ${JSON.stringify(args.tab ?? null)};
    const expectedBridgeVersion = ${JSON.stringify(EXPO_IOS_BRIDGE_VERSION)};
    const pluginBridge = globalThis.__EXPO_IOS_DEVTOOLS_BRIDGE__ ||
      globalThis.__EXPO_IOS_PLUGIN_BRIDGE__ ||
      globalThis.__ROZENITE_AGENT_BRIDGE__;
    if (pluginBridge && typeof pluginBridge === 'object') {
      const metadata = pluginBridge.metadata || pluginBridge.expoIosDevtoolsBridgeMetadata || pluginBridge.bridgeMetadata || {};
      const bridgeVersion = metadata.bridgeVersion || pluginBridge.bridgeVersion || pluginBridge.version || null;
      if (bridgeVersion && bridgeVersion !== expectedBridgeVersion) {
        return {
          available: false,
          action,
          source: 'plugin-bridge',
          domain: 'navigation',
          code: 'version-mismatch',
          bridgeVersion,
          expectedBridgeVersion,
          reason: 'Navigation plugin bridge version is not compatible with this CLI.',
          state: null
        };
      }
      const domains = pluginBridge.domainRegistry || pluginBridge.domains || {};
      const navigation = pluginBridge.navigation ||
        (pluginBridge.domains && !Array.isArray(pluginBridge.domains) ? pluginBridge.domains.navigation : null) ||
        (pluginBridge.domainRegistry ? pluginBridge.domainRegistry.navigation : null);
      const callTool = typeof pluginBridge.callTool === 'function' ? pluginBridge.callTool.bind(pluginBridge) : null;
      const callNavigation = (name, payload = {}) => {
        if (navigation && typeof navigation[name] === 'function') return navigation[name](payload);
        if (navigation && navigation.actions && typeof navigation.actions[name] === 'function') return navigation.actions[name](payload);
        if (callTool) return callTool('navigation.' + name, payload);
        return null;
      };
      const hasNavigation = Boolean(navigation || callTool || (Array.isArray(domains) && domains.some((domain) => domain?.name === 'navigation')));
      if (hasNavigation) {
        if (action === 'state') {
          return {
            available: true,
            action,
            source: 'plugin-bridge',
            domain: 'navigation',
            bridgeVersion,
            state: navigation && typeof navigation.state !== 'function' ? navigation.state || null : callNavigation('state')
          };
        }
        if (action === 'back') {
          return { available: true, action, source: 'plugin-bridge', domain: 'navigation', bridgeVersion, result: callNavigation('back') };
        }
        if (action === 'pop-to-root') {
          return { available: true, action, source: 'plugin-bridge', domain: 'navigation', bridgeVersion, result: callNavigation('pop-to-root') || callNavigation('popToRoot') };
        }
        if (action === 'tab') {
          return { available: true, action, source: 'plugin-bridge', domain: 'navigation', bridgeVersion, tab, result: callNavigation('tab', { tab }) };
        }
      }
    }
    const bridge = globalThis.__EXPO_IOS_NAVIGATION_BRIDGE__ ||
      (globalThis.__EXPO_IOS_INSTRUMENTATION__ && globalThis.__EXPO_IOS_INSTRUMENTATION__.navigation);
    if (!bridge) {
      return {
        available: false,
        action,
        source: 'app-instrumentation',
        reason: 'Navigation bridge is not installed.',
        state: null
      };
    }
    if (action === 'state') {
      return {
        available: true,
        action,
        source: 'app-instrumentation',
        state: typeof bridge.state === 'function' ? bridge.state() : bridge.state || null
      };
    }
    if (action === 'back') {
      return {
        available: true,
        action,
        source: 'app-instrumentation',
        result: typeof bridge.back === 'function' ? bridge.back() : null
      };
    }
    if (action === 'pop-to-root') {
      return {
        available: true,
        action,
        source: 'app-instrumentation',
        result: typeof bridge.popToRoot === 'function' ? bridge.popToRoot() : null
      };
    }
    if (action === 'tab') {
      return {
        available: true,
        action,
        source: 'app-instrumentation',
        tab,
        result: typeof bridge.tab === 'function' ? bridge.tab(tab) : null
      };
    }
    return { available: false, action, source: 'app-instrumentation', reason: 'Unsupported navigation action.' };
  })()`;
}
async function selectedTargetId(args = {}, deps = {}) {
  return deps.selectedTargetId ? deps.selectedTargetId(args) : null;
}
async function latestSessionId(args = {}, deps = {}) {
  return deps.latestSessionId ? deps.latestSessionId(args) : null;
}
function requireString11(value, field) {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${field} must be a non-empty string.`);
  return value.trim();
}
function toolJson18(value) {
  return { content: [{ type: "text", text: `${JSON.stringify(value, null, 2)}
` }] };
}
function unwrapToolJson8(result) {
  if (isToolTextResult(result)) {
    const text = result.content[0]?.text;
    if (typeof text === "string") {
      try {
        return JSON.parse(text);
      } catch {
        return text;
      }
    }
  }
  return result;
}
function isToolTextResult(value) {
  return Array.isArray(value.content);
}
function sanitizeOpenRouteResult(result) {
  return sanitizeSensitiveUrlStrings(result);
}
function sanitizeSensitiveUrlStrings(value) {
  if (typeof value === "string") return redactSensitiveUrlQuery2(value);
  if (Array.isArray(value)) return value.map((item) => sanitizeSensitiveUrlStrings(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, sanitizeSensitiveUrlStrings(item)])
    );
  }
  return value;
}
function redactSensitiveUrlQuery2(value) {
  return value.replace(
    /([?&][^=\s&]*(?:cookie|token|authorization|password|secret)[^=\s&]*=)[^&\s]+/gi,
    "$1[redacted]"
  );
}

// src/modules/network-evidence/src/main/index.ts
import { promises as fs8 } from "node:fs";
import path8 from "node:path";
var CLI_NAME4 = "expo-ios";
var CLI_VERSION5 = "0.1.0";
var EXPO_IOS_BRIDGE_VERSION2 = "1.0.0";
var REDACTED4 = "[redacted]";
var UNAVAILABLE_LIMITATIONS = [
  "Network evidence requires dev-only app instrumentation that patches fetch/XHR or an equivalent app network adapter.",
  "Native networking stacks are unavailable unless the app exposes them through the bridge."
];
function clampNumber18(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`Expected a finite number, got ${String(value)}.`);
  return Math.min(Math.max(number, min), max);
}
async function networkCommand(args = {}, deps = defaultNetworkDependencies) {
  const action = requireString12(args.action ?? "status", "action");
  if (!["status", "requests", "request", "clear", "har"].includes(action)) {
    throw new Error(`Unknown network action: ${action}`);
  }
  const harAction = action === "har" ? requireString12(args.harAction ?? "start", "harAction") : null;
  const bridgeAction = action === "har" ? `har-${harAction}` : action;
  if (harAction && !["start", "stop"].includes(harAction)) {
    throw new Error(`Unknown network HAR action: ${harAction}`);
  }
  const metroPort = clampNumber18(args.metroPort ?? 8081, 1, 65535);
  const limit = clampNumber18(args.limit ?? 100, 1, 1e3);
  const targets = await deps.metroTargets(metroPort);
  const target = targets.find((item) => item.webSocketDebuggerUrl) ?? targets[0] ?? null;
  const webSocketDebuggerUrl = target?.webSocketDebuggerUrl ?? null;
  if (!webSocketDebuggerUrl) {
    return toolJson19(networkUnavailable({
      action: bridgeAction,
      metroPort,
      code: "no-runtime-target",
      reason: "No Metro inspector target."
    }));
  }
  if (!deps.evaluateHermesExpression) {
    return toolJson19(networkUnavailable({
      action: bridgeAction,
      metroPort,
      code: "transport-failure",
      reason: "No Hermes evaluator is configured.",
      target: targetSummary6(target)
    }));
  }
  const result = await deps.evaluateHermesExpression(
    webSocketDebuggerUrl,
    networkExpression({ action: bridgeAction, requestId: args.requestId, limit }),
    { timeoutMs: 5e3 }
  );
  const value = result?.result?.result?.value;
  if (!value) {
    return toolJson19(networkUnavailable({
      action: bridgeAction,
      metroPort,
      code: "transport-failure",
      reason: result?.error ?? "Network bridge did not return a value.",
      target: targetSummary6(target),
      transport: networkTransport(metroPort, target, result?.diagnostics)
    }));
  }
  const transport = networkTransport(metroPort, target, result.diagnostics);
  const redacted = normalizeNetworkEvidence(redactNetworkEvidence(value), bridgeAction);
  const clock = deps.clock ?? systemClock2;
  if (bridgeAction === "har-stop" && redacted.available !== false) {
    const paths = deps.path ?? defaultPath2;
    const stateRoot = (deps.resolveExpoStateRoot ?? defaultResolveExpoStateRoot)(args);
    const timestamp = clock.now().toISOString().replace(/[:.]/g, "-");
    const outputPath = paths.resolve(args.outputPath ?? paths.join(stateRoot, "artifacts", `network-${timestamp}.har`));
    const captureTiming = networkCaptureTiming(redacted, clock);
    const har = annotateHar(redacted.har ?? harFromNetworkRequests(redacted.requests ?? [], clock), {
      source: redacted.source ?? "unknown",
      transport,
      limitations: networkLimitations(redacted),
      captureTiming
    });
    const fileSystem = deps.fileSystem ?? defaultFileSystem;
    await fileSystem.mkdir(paths.dirname(outputPath), { recursive: true });
    await fileSystem.writeJsonFile(outputPath, har);
    return toolJson19({
      ...redacted,
      action: bridgeAction,
      metroPort,
      target: targetSummary6(target),
      transport,
      evidenceSource: redacted.source ?? "unknown",
      limitations: networkLimitations(redacted),
      captureTiming,
      artifact: outputPath,
      har
    });
  }
  return toolJson19({
    ...redacted,
    action: bridgeAction,
    metroPort,
    target: targetSummary6(target),
    transport,
    evidenceSource: redacted.source ?? "unknown",
    limitations: networkLimitations(redacted),
    captureTiming: networkCaptureTiming(redacted, clock)
  });
}
var defaultNetworkDependencies = {
  metroTargets: defaultMetroTargets,
  evaluateHermesExpression
};
async function defaultMetroTargets(metroPort) {
  try {
    const response = await fetch(`http://localhost:${metroPort}/json/list`);
    if (!response.ok) return [];
    const parsed = await response.json();
    return Array.isArray(parsed) ? parsed.map((target) => target) : [];
  } catch {
    return [];
  }
}
function networkUnavailable(input) {
  const code = input.code ?? "unavailable";
  const evidenceSource = input.source ?? (code === "no-runtime-target" ? "runtime-target" : "app-instrumentation");
  return {
    available: false,
    action: input.action,
    source: evidenceSource,
    evidenceSource: "unavailable",
    code,
    reason: input.reason,
    metroPort: input.metroPort,
    target: input.target ?? null,
    transport: input.transport ?? {
      name: "metro-inspector-hermes-cdp",
      metroPort: input.metroPort,
      protocol: "Runtime.evaluate",
      target: input.target ?? null,
      cdp: null
    },
    requests: [],
    limitations: UNAVAILABLE_LIMITATIONS
  };
}
function networkExpression(input) {
  const { action, requestId, limit } = input;
  return `(() => {
    const action = ${JSON.stringify(action)};
    const requestId = ${JSON.stringify(requestId ?? null)};
    const limit = ${Number(limit)};
    const expectedBridgeVersion = ${JSON.stringify(EXPO_IOS_BRIDGE_VERSION2)};
    const pluginBridge = globalThis.__EXPO_IOS_DEVTOOLS_BRIDGE__ ||
      globalThis.__EXPO_IOS_PLUGIN_BRIDGE__ ||
      globalThis.__ROZENITE_AGENT_BRIDGE__;
    const pluginMetadata = pluginBridge?.metadata || pluginBridge?.expoIosDevtoolsBridgeMetadata || pluginBridge?.bridgeMetadata || {};
    const pluginVersion = pluginMetadata.bridgeVersion || pluginBridge?.bridgeVersion || pluginBridge?.version || null;
    const pluginNetwork = pluginBridge?.network ||
      (pluginBridge?.domains && !Array.isArray(pluginBridge.domains) ? pluginBridge.domains.network : null) ||
      (pluginBridge?.domainRegistry ? pluginBridge.domainRegistry.network : null);
    const pluginCallTool = typeof pluginBridge?.callTool === 'function' ? pluginBridge.callTool.bind(pluginBridge) : null;
    const callNetwork = (name, payload = {}) => {
      if (pluginNetwork && typeof pluginNetwork[name] === 'function') return pluginNetwork[name](payload);
      if (pluginNetwork && pluginNetwork.actions && typeof pluginNetwork.actions[name] === 'function') return pluginNetwork.actions[name](payload);
      if (pluginCallTool) return pluginBridge.callTool('network.' + name, payload);
      return null;
    };
    const hasPluginNetwork = Boolean(pluginNetwork || pluginCallTool || (Array.isArray(pluginBridge?.domains) && pluginBridge.domains.some((domain) => domain?.name === 'network')));
    if (hasPluginNetwork) {
      if (pluginVersion && pluginVersion !== expectedBridgeVersion) {
        return { available: false, action, source: 'plugin-bridge', code: 'version-mismatch', bridgeVersion: pluginVersion, expectedBridgeVersion, reason: 'Network plugin bridge version is not compatible with this CLI.', requests: [] };
      }
      const list = () => {
        const raw = pluginNetwork && typeof pluginNetwork.requests === 'function'
          ? pluginNetwork.requests({ limit })
          : pluginNetwork?.requests || callNetwork('requests', { limit }) || [];
        return Array.isArray(raw) ? raw.slice(-limit) : raw;
      };
      if (action === 'status') return { available: true, action, source: 'plugin-bridge', domain: 'network', bridgeVersion: pluginVersion, hooks: pluginNetwork?.hooks || callNetwork('status') || { fetch: true, xhr: true } };
      if (action === 'requests') return { available: true, action, source: 'plugin-bridge', domain: 'network', bridgeVersion: pluginVersion, requests: list() };
      if (action === 'request') {
        const requests = list();
        if (!Array.isArray(requests)) return { available: false, action, source: 'plugin-bridge', code: 'malformed-payload', reason: 'Network plugin bridge returned a malformed request list.', requests: [] };
        const found = requests.find((request) => request && request.id === requestId) || null;
        return found
          ? { available: true, action, source: 'plugin-bridge', domain: 'network', bridgeVersion: pluginVersion, request: found }
          : { available: false, action, source: 'plugin-bridge', code: 'no-observed-traffic', reason: 'Request not found.', requestId, requests: [] };
      }
      if (action === 'clear') return { available: true, action, source: 'plugin-bridge', domain: 'network', bridgeVersion: pluginVersion, cleared: callNetwork('clear') ?? true };
      if (action === 'har-start') return { available: true, action, source: 'plugin-bridge', domain: 'network', bridgeVersion: pluginVersion, started: callNetwork('har-start') ?? true, startedAt: new Date().toISOString() };
      if (action === 'har-stop') {
        const har = callNetwork('har-stop');
        return { available: true, action, source: 'plugin-bridge', domain: 'network', bridgeVersion: pluginVersion, har: har?.log ? har : null, requests: list(), stoppedAt: new Date().toISOString() };
      }
    }
    const devtoolsNetwork = globalThis.__REACT_NATIVE_DEVTOOLS_NETWORK__ ||
      globalThis.__RN_DEVTOOLS_NETWORK__ ||
      globalThis.__REACT_DEVTOOLS_NETWORK__;
    if (devtoolsNetwork && typeof devtoolsNetwork === 'object') {
      const list = () => {
        const raw = typeof devtoolsNetwork.requests === 'function' ? devtoolsNetwork.requests({ limit }) : devtoolsNetwork.requests || [];
        return Array.isArray(raw) ? raw.slice(-limit) : raw;
      };
      if (action === 'status') return { available: true, action, source: 'react-native-devtools-network', hooks: devtoolsNetwork.hooks || { fetch: true, xhr: true } };
      if (action === 'requests') return { available: true, action, source: 'react-native-devtools-network', requests: list() };
      if (action === 'request') {
        const found = list().find((request) => request && request.id === requestId) || null;
        return found
          ? { available: true, action, source: 'react-native-devtools-network', request: found }
          : { available: false, action, source: 'react-native-devtools-network', code: 'no-observed-traffic', reason: 'Request not found.', requestId, requests: [] };
      }
      if (action === 'har-start') return { available: true, action, source: 'react-native-devtools-network', started: true, startedAt: new Date().toISOString() };
      if (action === 'har-stop') return { available: true, action, source: 'react-native-devtools-network', requests: list(), stoppedAt: new Date().toISOString() };
    }
    const bridge = globalThis.__EXPO_IOS_NETWORK_BRIDGE__ ||
      (globalThis.__EXPO_IOS_INSTRUMENTATION__ && globalThis.__EXPO_IOS_INSTRUMENTATION__.network);
    if (!bridge) {
      return {
        available: false,
        action,
        source: 'app-instrumentation',
        code: 'no-bridge-domain',
        reason: 'Network bridge is not installed.',
        requests: []
      };
    }
    const list = () => {
      const raw = typeof bridge.requests === 'function' ? bridge.requests({ limit }) : bridge.requests || [];
      return Array.isArray(raw) ? raw.slice(-limit) : [];
    };
    if (action === 'status') {
      return {
        available: true,
        action,
        source: 'app-instrumentation',
        hooks: typeof bridge.status === 'function' ? bridge.status() : (bridge.hooks || { fetch: true, xhr: true })
      };
    }
    if (action === 'requests') {
      return { available: true, action, source: 'app-instrumentation', requests: list() };
    }
    if (action === 'request') {
      const found = list().find((request) => request && request.id === requestId) || null;
      return found
        ? { available: true, action, source: 'app-instrumentation', request: found }
        : { available: false, action, source: 'app-instrumentation', reason: 'Request not found.', requestId };
    }
    if (action === 'clear') {
      if (typeof bridge.clear === 'function') bridge.clear();
      return { available: true, action, source: 'app-instrumentation', cleared: true };
    }
    if (action === 'har-start') {
      if (typeof bridge.harStart === 'function') return { available: true, action, source: 'app-instrumentation', har: bridge.harStart() };
      return { available: true, action, source: 'app-instrumentation', started: true };
    }
    if (action === 'har-stop') {
      if (typeof bridge.harStop === 'function') return { available: true, action, source: 'app-instrumentation', har: bridge.harStop(), requests: list() };
      return { available: true, action, source: 'app-instrumentation', requests: list() };
    }
    return { available: false, action, source: 'app-instrumentation', reason: 'Unsupported network action.' };
  })()`;
}
function redactNetworkEvidence(value) {
  if (!isRecord8(value)) return value;
  const clone = { ...value };
  if (Array.isArray(clone.requests)) clone.requests = clone.requests.map(redactNetworkRequest);
  if (clone.request) clone.request = redactNetworkRequest(clone.request);
  if (clone.har) clone.har = redactHar(clone.har);
  return clone;
}
function normalizeNetworkEvidence(value, action) {
  if (!isRecord8(value) || Array.isArray(value)) {
    return {
      available: false,
      action,
      source: "runtime",
      code: "malformed-payload",
      reason: "Network runtime returned a malformed payload.",
      requests: []
    };
  }
  const normalized = { ...value };
  if (normalized.requests !== void 0 && !Array.isArray(normalized.requests)) {
    return {
      ...normalized,
      available: false,
      action,
      code: "malformed-payload",
      reason: "Network runtime returned a malformed request list.",
      requests: []
    };
  }
  if ((action === "requests" || action === "har-stop") && normalized.available !== false && Array.isArray(normalized.requests) && normalized.requests.length === 0) {
    return {
      ...normalized,
      available: false,
      action,
      code: "no-observed-traffic",
      reason: "No network traffic was observed by the selected upstream/bridge path.",
      requests: []
    };
  }
  return normalized;
}
function networkTransport(metroPort, target, cdp = null) {
  return {
    name: "metro-inspector-hermes-cdp",
    metroPort,
    protocol: "Runtime.evaluate",
    target: targetSummary6(target),
    cdp
  };
}
function networkLimitations(value) {
  const record = isRecord8(value) ? value : {};
  const limitations = [
    "Network evidence is limited to traffic observed by the selected React Native DevTools or app bridge network domain.",
    "Headers, cookies, credentials, request bodies, and response bodies are redacted before stdout and artifact writes."
  ];
  if (record.source === "app-instrumentation") {
    limitations.push("Legacy app instrumentation was used because no upstream DevTools or plugin bridge network domain was available.");
  }
  if (record.available === false && record.code === "no-observed-traffic") {
    limitations.push("No observed traffic is not proof that the app made no native network requests outside the selected domain.");
  }
  return limitations;
}
function networkCaptureTiming(value, clock = systemClock2) {
  const record = isRecord8(value) ? value : {};
  const requests = Array.isArray(record.requests) ? record.requests : record.request ? [record.request] : [];
  const times = requests.map((request) => isRecord8(request) ? request.startedAt : void 0).filter((item) => typeof item === "string" && item.length > 0).sort();
  return {
    startedAt: typeof record.startedAt === "string" ? record.startedAt : times[0] ?? null,
    stoppedAt: typeof record.stoppedAt === "string" ? record.stoppedAt : clock.now().toISOString(),
    observedRequestCount: requests.length
  };
}
function harFromNetworkRequests(requests, clock = systemClock2) {
  return {
    log: {
      version: "1.2",
      creator: { name: CLI_NAME4, version: CLI_VERSION5 },
      entries: requests.map((request) => ({
        startedDateTime: request.startedAt ?? clock.now().toISOString(),
        time: request.durationMs ?? 0,
        request: {
          method: request.method ?? request.request?.method ?? "GET",
          url: request.url ?? request.request?.url ?? "",
          headers: request.headers ?? request.request?.headers ?? {},
          queryString: [],
          cookies: []
        },
        response: {
          status: request.status ?? request.response?.status ?? 0,
          statusText: request.response?.statusText ?? "",
          headers: request.response?.headers ?? {},
          cookies: [],
          content: { size: 0, mimeType: request.response?.mimeType ?? "", text: request.response?.body ?? "" }
        }
      }))
    }
  };
}
function annotateHar(har, metadata) {
  const copy = cloneJson(isRecord8(har) ? har : harFromNetworkRequests([]));
  const log = isRecord8(copy.log) ? copy.log : { version: "1.2", creator: { name: CLI_NAME4, version: CLI_VERSION5 }, entries: [] };
  copy.log = log;
  log._expoIos = {
    source: metadata.source,
    transport: metadata.transport,
    limitations: metadata.limitations,
    captureTiming: metadata.captureTiming,
    redaction: {
      headers: ["authorization", "cookie", "set-cookie", "token", "secret", "api-key"],
      bodies: true,
      query: ["token", "secret", "key", "password", "auth", "session", "cookie"]
    }
  };
  return copy;
}
function targetSummary6(target) {
  if (!target) return null;
  return {
    id: target.id ?? null,
    title: target.title ?? null,
    description: target.description ?? null,
    appId: target.appId ?? null,
    deviceName: target.deviceName ?? null,
    devtoolsFrontendUrl: target.devtoolsFrontendUrl ?? null,
    webSocketDebuggerUrl: target.webSocketDebuggerUrl ?? null,
    reactNative: target.reactNative ?? null,
    capabilities: target.capabilities ?? {
      hermesRuntime: typeof target.webSocketDebuggerUrl === "string" && target.webSocketDebuggerUrl.startsWith("ws"),
      devtoolsFrontend: typeof target.devtoolsFrontendUrl === "string" && target.devtoolsFrontendUrl.length > 0,
      reactNative: Boolean(target.reactNative)
    }
  };
}
function toolJson19(value) {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}
function requireString12(value, field) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${field} must be a non-empty string.`);
  }
  return value.trim();
}
function redactNetworkRequest(request) {
  if (!isRecord8(request)) return request;
  const content = isRecord8(request.content) ? { ...request.content, text: request.content.text ? REDACTED4 : request.content.text } : void 0;
  return {
    ...request,
    url: redactNetworkUrl(request.url),
    request: request.request ? redactNetworkMessage(request.request) : void 0,
    response: request.response ? redactNetworkMessage(request.response) : void 0,
    headers: request.headers ? redactHeaders(request.headers) : void 0,
    cookies: request.cookies ? REDACTED4 : void 0,
    body: request.body ? REDACTED4 : void 0,
    postData: request.postData ? REDACTED4 : void 0,
    content
  };
}
function redactNetworkMessage(message) {
  if (!isRecord8(message)) return message;
  const content = isRecord8(message.content) ? { ...message.content, text: message.content.text ? REDACTED4 : message.content.text } : void 0;
  return {
    ...message,
    url: redactNetworkUrl(message.url),
    headers: message.headers ? redactHeaders(message.headers) : void 0,
    cookies: message.cookies ? REDACTED4 : void 0,
    body: message.body ? REDACTED4 : void 0,
    postData: message.postData ? REDACTED4 : void 0,
    content
  };
}
function redactHeaders(headers) {
  if (Array.isArray(headers)) {
    return headers.map((header) => {
      if (!isRecord8(header)) return header;
      const name = String(header.name ?? "");
      return {
        ...header,
        value: /authorization|cookie|token|secret|api[-_]?key|password|set-cookie/i.test(name) ? REDACTED4 : header.value
      };
    });
  }
  if (!isRecord8(headers)) return headers;
  return Object.fromEntries(Object.entries(headers).map(([key, value]) => [
    key,
    /authorization|cookie|token|secret|api[-_]?key|password|set-cookie/i.test(key) ? REDACTED4 : value
  ]));
}
function redactNetworkUrl(url) {
  if (!url) return url;
  try {
    const parsed = new URL(String(url));
    for (const key of [...parsed.searchParams.keys()]) {
      if (/token|secret|key|password|auth|session|cookie/i.test(key)) parsed.searchParams.set(key, REDACTED4);
    }
    parsed.username = parsed.username ? REDACTED4 : "";
    parsed.password = parsed.password ? REDACTED4 : "";
    return parsed.toString();
  } catch {
    return String(url).replace(/([?&][^=]*(token|secret|key|password|auth|session|cookie)[^=]*=)[^&]+/gi, `$1${REDACTED4}`);
  }
}
function redactHar(har) {
  if (!isRecord8(har)) return har;
  const copy = cloneJson(har);
  const entries = isRecord8(copy.log) ? copy.log.entries : void 0;
  if (Array.isArray(entries)) {
    for (const entry of entries) {
      if (!isRecord8(entry)) continue;
      if (entry.request) entry.request = redactNetworkMessage(entry.request);
      if (entry.response) entry.response = redactNetworkMessage(entry.response);
    }
  }
  return copy;
}
function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}
function isRecord8(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}
var systemClock2 = {
  now: () => /* @__PURE__ */ new Date()
};
var defaultPath2 = {
  resolve: (filePath) => path8.resolve(filePath),
  join: (...segments) => path8.join(...segments),
  dirname: (filePath) => path8.dirname(filePath)
};
var defaultFileSystem = {
  mkdir: (filePath, options) => fs8.mkdir(filePath, options).then(() => void 0),
  writeJsonFile: (filePath, value) => fs8.writeFile(filePath, `${JSON.stringify(value, null, 2)}
`, "utf8")
};
function defaultResolveExpoStateRoot(args) {
  if (typeof args.stateDir === "string" && args.stateDir.length > 0) return args.stateDir;
  return ".scratch/expo-ios";
}

// src/modules/bridge-domain-actions/src/main/index.ts
import { readFile as readFile12 } from "node:fs/promises";
import path9 from "node:path";
var EXPO_IOS_BRIDGE_VERSION3 = "1.0.0";
var MAX_OUTPUT11 = 4e4;
var MAX_ARRAY_ITEMS2 = 1e3;
function toolJson20(value) {
  return { content: [{ type: "text", text: stringifyBoundedJson(value) }] };
}
async function storageCommand(args = {}, deps = defaultBridgeDomainDependencies) {
  const positionals = Array.isArray(args._) ? args._ : [];
  const store = requireString13(args.store ?? positionals[0], "store");
  const action = requireString13(args.action ?? positionals[1] ?? "list", "action");
  if (!["list", "get", "set", "clear"].includes(action)) throw new Error(`Unknown storage action: ${action}`);
  const key = args.key ?? positionals[2];
  const sideEffect = action === "list" || action === "get" ? "read" : "write";
  const policy = await policyDecision(args, `storage.${action}`, sideEffect, deps);
  if (!policy.allowed) return toolJson20(policyDeniedPayload3({ domain: "storage", action, policy }));
  const value = action === "set" ? parseStorageValue(args.value ?? positionals[3]) : null;
  return toolJson20(await bridgeDomainCommand({
    args,
    domain: "storage",
    action,
    expression: storageExpression({
      store,
      action,
      key,
      value,
      limit: clampNumber19(args.limit ?? 100, 1, 1e3)
    }),
    policy
  }, deps));
}
async function stateCommand(args = {}, deps = defaultBridgeDomainDependencies) {
  const positionals = Array.isArray(args._) ? args._ : [];
  const action = requireString13(args.action ?? positionals[0] ?? "list", "action");
  if (!["list", "save", "load", "clear"].includes(action)) throw new Error(`Unknown state action: ${action}`);
  const sideEffect = action === "list" || action === "save" ? "read" : "write";
  const policy = await policyDecision(args, `state.${action}`, sideEffect, deps);
  if (!policy.allowed) return toolJson20(policyDeniedPayload3({ domain: "state", action, policy }));
  return toolJson20(await bridgeDomainCommand({
    args,
    domain: "state",
    action,
    expression: stateExpression({ action, name: args.name ?? positionals[1] }),
    policy
  }, deps));
}
async function controlsCommand(args = {}, deps = defaultBridgeDomainDependencies) {
  const positionals = Array.isArray(args._) ? args._ : [];
  const action = requireString13(args.action ?? positionals[0] ?? "list", "action");
  if (!["list", "get", "press"].includes(action)) throw new Error(`Unknown controls action: ${action}`);
  const sideEffect = action === "press" ? "device" : "read";
  const policy = await policyDecision(args, `controls.${action}`, sideEffect, deps);
  if (!policy.allowed) return toolJson20(policyDeniedPayload3({ domain: "controls", action, policy }));
  return toolJson20(await bridgeDomainCommand({
    args,
    domain: "controls",
    action,
    expression: controlsExpression({ action, name: args.name ?? positionals[1] }),
    policy
  }, deps));
}
var defaultBridgeDomainDependencies = {
  metroTargets: (metroPort) => metroTargets(metroPort),
  evaluateHermesExpression,
  readJsonFile: async (file) => JSON.parse(await readFile12(file, "utf8")),
  resolvePath: (file) => path9.resolve(file)
};
async function bridgeDomainCommand(input, deps = defaultBridgeDomainDependencies) {
  const metroPort = clampNumber19(input.args.metroPort ?? 8081, 1, 65535);
  const sideEffect = bridgeActionSideEffect(input.domain, input.action);
  if (sideEffect !== "read" && input.policy?.allowed !== true) {
    return policyDeniedPayload3({ domain: input.domain, action: input.action, policy: input.policy ?? {
      checked: true,
      action: `${input.domain}.${input.action}`,
      sideEffect,
      allowed: false,
      source: null,
      reason: "No action policy allowed this state-changing operation."
    } });
  }
  const targets = deps.metroTargets ? await deps.metroTargets(metroPort) : [];
  const target = targets[0] ?? null;
  const webSocketDebuggerUrl = target?.webSocketDebuggerUrl ?? null;
  if (!webSocketDebuggerUrl) {
    return domainUnavailable({
      domain: input.domain,
      action: input.action,
      metroPort,
      code: "no-runtime-target",
      reason: "No Metro inspector target.",
      policy: input.policy
    });
  }
  if (!deps.evaluateHermesExpression) {
    return domainUnavailable({
      domain: input.domain,
      action: input.action,
      metroPort,
      code: "transport-failure",
      reason: `${input.domain} bridge did not return a value.`,
      target: targetSummary7(target),
      policy: input.policy
    });
  }
  const result = await deps.evaluateHermesExpression(webSocketDebuggerUrl, input.expression, { timeoutMs: 5e3 });
  const value = result?.result?.result?.value;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return domainUnavailable({
      domain: input.domain,
      action: input.action,
      metroPort,
      code: "transport-failure",
      reason: result?.error ?? `${input.domain} bridge did not return a value.`,
      target: targetSummary7(target),
      transport: bridgeRuntimeTransport(metroPort, target, result?.diagnostics ?? result?.cdp ?? null),
      policy: input.policy
    });
  }
  const redacted = sanitizePayload2(deps.redactValue ? deps.redactValue(value) : value);
  return sanitizePayload2({
    ...redacted,
    domain: input.domain,
    action: input.action,
    metroPort,
    target: targetSummary7(target),
    transport: bridgeRuntimeTransport(metroPort, target, result?.diagnostics ?? result?.cdp ?? null),
    evidenceSource: typeof redacted.source === "string" ? redacted.source : "unknown",
    policy: input.policy
  });
}
function domainUnavailable(args) {
  return sanitizePayload2({
    available: false,
    domain: args.domain,
    action: args.action,
    source: "app-instrumentation",
    evidenceSource: "unavailable",
    code: args.code ?? "unavailable",
    reason: args.reason,
    metroPort: args.metroPort,
    target: targetSummary7(args.target),
    transport: args.transport ?? bridgeRuntimeTransport(args.metroPort, args.target ?? null, null),
    policy: args.policy ?? null,
    limitations: [`${args.domain} evidence requires the dev-only app instrumentation bridge.`]
  });
}
function bridgeRuntimeTransport(metroPort, target, cdp = null) {
  return sanitizePayload2({
    name: "metro-inspector-hermes-cdp",
    metroPort,
    protocol: "Runtime.evaluate",
    target: targetSummary7(target),
    cdp
  });
}
function policyDeniedPayload3(args) {
  return sanitizePayload2({
    available: false,
    domain: args.domain,
    action: args.action,
    source: "policy",
    evidenceSource: "policy",
    code: "policy-denied",
    denied: true,
    reason: "Policy denied action.",
    policy: args.policy
  });
}
async function policyDecision(args, action, sideEffect, deps = {}) {
  if (sideEffect === "read") {
    return { checked: true, action, sideEffect, allowed: true, source: null, reason: "Read action does not require policy approval." };
  }
  const policyPath = optionalString6(args.actionPolicy);
  if (!policyPath) {
    return { checked: true, action, sideEffect, allowed: false, source: null, reason: "No action policy allowed this state-changing operation." };
  }
  const resolved = deps.resolvePath ? deps.resolvePath(policyPath) : policyPath;
  if (!deps.readJsonFile) throw new Error("policyDecision requires readJsonFile when actionPolicy is supplied.");
  const policy = await deps.readJsonFile(resolved);
  const allowed = policyAllowsAction(policy, action);
  return {
    checked: true,
    action,
    sideEffect,
    allowed,
    source: resolved,
    reason: allowed ? "Action allowed by policy." : "Action policy did not allow this operation."
  };
}
function policyAllowsAction(policy, action) {
  const record = asRecord10(policy);
  if (Array.isArray(record?.allow) && record.allow.includes(action)) return true;
  const actions = asRecord10(record?.actions);
  return actions?.[action] === "allow" || actions?.[action] === true;
}
function parseStorageValue(value) {
  if (value === void 0) throw new Error("storage set requires a JSON value.");
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch (error) {
    throw new Error(`Invalid JSON for --value: ${formatError13(error)}`);
  }
}
function storageExpression(args) {
  return `(() => {
    const store = ${JSON.stringify(args.store)};
    const action = ${JSON.stringify(args.action)};
    const key = ${JSON.stringify(args.key ?? null)};
    const value = ${JSON.stringify(args.value)};
    const limit = ${Number(args.limit)};
    const expectedBridgeVersion = ${JSON.stringify(EXPO_IOS_BRIDGE_VERSION3)};
    const pluginBridge = globalThis.__EXPO_IOS_DEVTOOLS_BRIDGE__ ||
      globalThis.__EXPO_IOS_PLUGIN_BRIDGE__ ||
      globalThis.__ROZENITE_AGENT_BRIDGE__;
    const pluginMetadata = pluginBridge?.metadata || pluginBridge?.expoIosDevtoolsBridgeMetadata || pluginBridge?.bridgeMetadata || {};
    const pluginVersion = pluginMetadata.bridgeVersion || pluginBridge?.bridgeVersion || pluginBridge?.version || null;
    const pluginStorage = pluginBridge?.storage ||
      (pluginBridge?.domains && !Array.isArray(pluginBridge.domains) ? pluginBridge.domains.storage : null) ||
      (pluginBridge?.domainRegistry ? pluginBridge.domainRegistry.storage : null);
    const pluginCallTool = typeof pluginBridge?.callTool === 'function' ? pluginBridge.callTool.bind(pluginBridge) : null;
    const callStorage = (name, payload = {}) => {
      if (pluginStorage && typeof pluginStorage[name] === 'function') return pluginStorage[name](payload);
      if (pluginStorage && pluginStorage.actions && typeof pluginStorage.actions[name] === 'function') return pluginStorage.actions[name](payload);
      if (pluginCallTool) return pluginCallTool('storage.' + name, payload);
      return null;
    };
    const hasPluginStorage = Boolean(pluginStorage || pluginCallTool || (Array.isArray(pluginBridge?.domains) && pluginBridge.domains.some((domain) => domain?.name === 'storage')));
    if (hasPluginStorage) {
      if (pluginVersion && pluginVersion !== expectedBridgeVersion) {
        return { available: false, source: 'plugin-bridge', domain: 'storage', code: 'version-mismatch', bridgeVersion: pluginVersion, expectedBridgeVersion, reason: 'Storage plugin bridge version is not compatible with this CLI.', store, action };
      }
      const adapters = pluginStorage?.adapters || pluginStorage?.stores || pluginStorage || {};
      const adapter = adapters[store] || (pluginStorage?.store && pluginStorage.store(store)) || null;
      const read = (targetKey) => adapter && typeof adapter.get === 'function' ? adapter.get(targetKey) : adapter?.values?.[targetKey];
      if (!adapter && !pluginCallTool) return { available: false, source: 'plugin-bridge', domain: 'storage', code: 'missing-domain', reason: 'Storage bridge store is not registered.', store, action };
      if (action === 'list') {
        const keys = adapter ? (adapter.list ? adapter.list() : adapter.keys || []) : callStorage('list', { store, limit });
        return { available: true, source: 'plugin-bridge', domain: 'storage', bridgeVersion: pluginVersion, store, action, keys: (Array.isArray(keys) ? keys : []).slice(0, limit) };
      }
      if (action === 'get') return { available: true, source: 'plugin-bridge', domain: 'storage', bridgeVersion: pluginVersion, store, action, key, value: adapter ? read(key) : callStorage('get', { store, key }) };
      if (action === 'set') {
        const before = adapter ? read(key) : null;
        const result = adapter && typeof adapter.set === 'function' ? adapter.set(key, value) : callStorage('set', { store, key, value });
        const after = adapter ? read(key) : null;
        return { available: true, source: 'plugin-bridge', domain: 'storage', bridgeVersion: pluginVersion, store, action, key, before, after, result: result || { ok: true } };
      }
      if (action === 'clear') {
        const beforeKeys = adapter ? (adapter.list ? adapter.list() : adapter.keys || []) : [];
        const result = adapter && typeof adapter.clear === 'function' ? adapter.clear() : callStorage('clear', { store });
        const afterKeys = adapter ? (adapter.list ? adapter.list() : adapter.keys || []) : [];
        return { available: true, source: 'plugin-bridge', domain: 'storage', bridgeVersion: pluginVersion, store, action, before: { keys: beforeKeys }, after: { keys: afterKeys }, result: result || { ok: true } };
      }
    } else if (pluginBridge) {
      return { available: false, source: 'plugin-bridge', domain: 'storage', code: 'missing-domain', reason: 'Storage bridge domain is not registered.', store, action };
    }
    const bridge = globalThis.__EXPO_IOS_STORAGE_BRIDGE__ ||
      (globalThis.__EXPO_IOS_INSTRUMENTATION__ && globalThis.__EXPO_IOS_INSTRUMENTATION__.storage);
    if (!bridge) return { available: false, source: 'app-instrumentation', code: 'unavailable-bridge', reason: 'Storage bridge is not installed.', store, action };
    const adapter = bridge[store];
    if (!adapter) return { available: false, source: 'app-instrumentation', reason: 'Unsupported storage store.', store, action };
    if (action === 'list') return { available: true, source: 'app-instrumentation', store, action, keys: (adapter.list ? adapter.list() : adapter.keys || []).slice(0, limit) };
    if (action === 'get') return { available: true, source: 'app-instrumentation', store, action, key, value: adapter.get ? adapter.get(key) : (adapter.values || {})[key] };
    if (action === 'set') return { available: true, source: 'app-instrumentation', store, action, key, result: adapter.set ? adapter.set(key, value) : { ok: true } };
    if (action === 'clear') return { available: true, source: 'app-instrumentation', store, action, result: adapter.clear ? adapter.clear() : { ok: true } };
    return { available: false, source: 'app-instrumentation', reason: 'Unsupported storage action.', store, action };
  })()`;
}
function stateExpression(args) {
  return `(() => {
    const action = ${JSON.stringify(args.action)};
    const name = ${JSON.stringify(args.name ?? null)};
    const bridge = globalThis.__EXPO_IOS_STATE_BRIDGE__ ||
      (globalThis.__EXPO_IOS_INSTRUMENTATION__ && globalThis.__EXPO_IOS_INSTRUMENTATION__.state);
    if (!bridge) return { available: false, source: 'app-instrumentation', reason: 'State bridge is not installed.', action };
    if (action === 'list') return { available: true, source: 'app-instrumentation', action, states: bridge.list ? bridge.list() : bridge.states || [] };
    if (action === 'save') return { available: true, source: 'app-instrumentation', action, name, result: bridge.save ? bridge.save(name) : { ok: true, name } };
    if (action === 'load') return { available: true, source: 'app-instrumentation', action, name, result: bridge.load ? bridge.load(name) : { ok: true, name } };
    if (action === 'clear') return { available: true, source: 'app-instrumentation', action, name, result: bridge.clear ? bridge.clear(name) : { ok: true, name } };
    return { available: false, source: 'app-instrumentation', reason: 'Unsupported state action.', action };
  })()`;
}
function controlsExpression(args) {
  return `(() => {
    const action = ${JSON.stringify(args.action)};
    const name = ${JSON.stringify(args.name ?? null)};
    const expectedBridgeVersion = ${JSON.stringify(EXPO_IOS_BRIDGE_VERSION3)};
    const pluginBridge = globalThis.__EXPO_IOS_DEVTOOLS_BRIDGE__ ||
      globalThis.__EXPO_IOS_PLUGIN_BRIDGE__ ||
      globalThis.__ROZENITE_AGENT_BRIDGE__;
    const pluginMetadata = pluginBridge?.metadata || pluginBridge?.expoIosDevtoolsBridgeMetadata || pluginBridge?.bridgeMetadata || {};
    const pluginVersion = pluginMetadata.bridgeVersion || pluginBridge?.bridgeVersion || pluginBridge?.version || null;
    const pluginControls = pluginBridge?.controls ||
      (pluginBridge?.domains && !Array.isArray(pluginBridge.domains) ? pluginBridge.domains.controls : null) ||
      (pluginBridge?.domainRegistry ? pluginBridge.domainRegistry.controls : null);
    const pluginCallTool = typeof pluginBridge?.callTool === 'function' ? pluginBridge.callTool.bind(pluginBridge) : null;
    const callControls = (command, payload = {}) => {
      if (pluginControls && typeof pluginControls[command] === 'function') return pluginControls[command](payload);
      if (pluginControls && pluginControls.actions && typeof pluginControls.actions[command] === 'function') return pluginControls.actions[command](payload);
      if (pluginCallTool) return pluginCallTool('controls.' + command, payload);
      return null;
    };
    const hasPluginControls = Boolean(pluginControls || pluginCallTool || (Array.isArray(pluginBridge?.domains) && pluginBridge.domains.some((domain) => domain?.name === 'controls')));
    if (hasPluginControls) {
      if (pluginVersion && pluginVersion !== expectedBridgeVersion) {
        return { available: false, source: 'plugin-bridge', domain: 'controls', code: 'version-mismatch', bridgeVersion: pluginVersion, expectedBridgeVersion, reason: 'Controls plugin bridge version is not compatible with this CLI.', action };
      }
      const listControls = () => {
        const raw = pluginControls && typeof pluginControls.list === 'function'
          ? pluginControls.list()
          : pluginControls?.controls || callControls('list') || [];
        return Array.isArray(raw) ? raw : [];
      };
      if (action === 'list') return { available: true, source: 'plugin-bridge', domain: 'controls', bridgeVersion: pluginVersion, action, controls: listControls() };
      if (action === 'get') return { available: true, source: 'plugin-bridge', domain: 'controls', bridgeVersion: pluginVersion, action, name, control: pluginControls && typeof pluginControls.get === 'function' ? pluginControls.get(name) : listControls().find((control) => control.name === name) || null };
      if (action === 'press') {
        const before = pluginControls && typeof pluginControls.get === 'function' ? pluginControls.get(name) : listControls().find((control) => control.name === name) || null;
        const result = pluginControls && typeof pluginControls.press === 'function' ? pluginControls.press(name) : callControls('press', { name });
        const after = pluginControls && typeof pluginControls.get === 'function' ? pluginControls.get(name) : listControls().find((control) => control.name === name) || null;
        return { available: true, source: 'plugin-bridge', domain: 'controls', bridgeVersion: pluginVersion, action, name, before, after, result: result || { ok: true, name } };
      }
    } else if (pluginBridge) {
      return { available: false, source: 'plugin-bridge', domain: 'controls', code: 'missing-domain', reason: 'Controls bridge domain is not registered.', action };
    }
    const bridge = globalThis.__EXPO_IOS_CONTROLS_BRIDGE__ ||
      (globalThis.__EXPO_IOS_INSTRUMENTATION__ && globalThis.__EXPO_IOS_INSTRUMENTATION__.controls);
    if (!bridge) return { available: false, source: 'app-instrumentation', code: 'unavailable-bridge', reason: 'Controls bridge is not installed.', action };
    if (action === 'list') return { available: true, source: 'app-instrumentation', action, controls: bridge.list ? bridge.list() : bridge.controls || [] };
    if (action === 'get') return { available: true, source: 'app-instrumentation', action, name, control: bridge.get ? bridge.get(name) : (bridge.controls || []).find((control) => control.name === name) || null };
    if (action === 'press') return { available: true, source: 'app-instrumentation', action, name, result: bridge.press ? bridge.press(name) : { ok: true, name } };
    return { available: false, source: 'app-instrumentation', reason: 'Unsupported controls action.', action };
  })()`;
}
function targetSummary7(target) {
  if (!target) return null;
  return sanitizePayload2({
    id: target.id ?? null,
    title: target.title ?? null,
    description: target.description ?? null,
    appId: target.appId ?? null,
    deviceName: target.deviceName ?? null,
    devtoolsFrontendUrl: target.devtoolsFrontendUrl ?? null,
    webSocketDebuggerUrl: target.webSocketDebuggerUrl ?? null,
    reactNative: target.reactNative ?? null,
    capabilities: target.capabilities ?? {
      hermesRuntime: typeof target.webSocketDebuggerUrl === "string" && target.webSocketDebuggerUrl.startsWith("ws"),
      devtoolsFrontend: typeof target.devtoolsFrontendUrl === "string" && target.devtoolsFrontendUrl.length > 0,
      reactNative: Boolean(target.reactNative)
    }
  });
}
function clampNumber19(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`Expected a finite number, got ${String(value)}.`);
  return Math.min(Math.max(number, min), max);
}
function requireString13(value, name) {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${name} must be a non-empty string.`);
  return value.trim();
}
function optionalString6(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}
function sanitizePayload2(value) {
  return boundValue2(redactValue6(value));
}
function stringifyBoundedJson(value) {
  const sanitized = sanitizePayload2(value);
  const text = JSON.stringify(sanitized, null, 2);
  if (text.length <= MAX_OUTPUT11) return text;
  const record = asRecord10(sanitized);
  const envelope = {
    available: false,
    source: "output-boundary",
    evidenceSource: "output-boundary",
    code: "output-truncated",
    outputTruncated: true,
    originalLength: text.length,
    domain: record?.domain,
    action: record?.action,
    preview: ""
  };
  let budget = MAX_OUTPUT11 - JSON.stringify(envelope, null, 2).length - 128;
  envelope.preview = text.slice(0, Math.max(0, budget));
  let output = JSON.stringify(envelope, null, 2);
  while (output.length > MAX_OUTPUT11 && typeof envelope.preview === "string") {
    budget -= output.length - MAX_OUTPUT11 + 128;
    envelope.preview = envelope.preview.slice(0, Math.max(0, budget));
    output = JSON.stringify(envelope, null, 2);
  }
  return output;
}
function bridgeActionSideEffect(domain, action) {
  if (domain === "storage") return action === "list" || action === "get" ? "read" : "write";
  if (domain === "state") return action === "list" || action === "save" ? "read" : "write";
  if (domain === "controls") return action === "press" ? "device" : "read";
  return "unknown";
}
function boundValue2(value) {
  if (typeof value === "string") return truncate14(value);
  if (Array.isArray(value)) return value.slice(-MAX_ARRAY_ITEMS2).map(boundValue2);
  const record = asRecord10(value);
  if (!record) return value;
  return Object.fromEntries(Object.entries(record).map(([key, nested]) => [key, boundValue2(nested)]));
}
function redactValue6(value) {
  if (typeof value === "string") return redactString2(value);
  if (Array.isArray(value)) return value.map(redactValue6);
  const record = asRecord10(value);
  if (!record) return value;
  return Object.fromEntries(Object.entries(record).map(([key, nested]) => [
    key,
    isSensitiveKey2(key) ? "[redacted]" : redactValue6(nested)
  ]));
}
function redactString2(value) {
  try {
    const parsed = new URL(value);
    let changed = false;
    for (const key of [...parsed.searchParams.keys()]) {
      if (isSensitiveKey2(key)) {
        parsed.searchParams.set(key, "[redacted]");
        changed = true;
      }
    }
    return changed ? parsed.toString() : value;
  } catch {
    return value.replace(/([?&](?:cookie|token|authorization|password|secret|api[-_]?key|apikey)=)[^&\s]+/gi, "$1[redacted]");
  }
}
function isSensitiveKey2(key) {
  return /token|authorization|cookie|password|secret|apikey|apiKey/i.test(key);
}
function truncate14(value, max = MAX_OUTPUT11) {
  const text = String(value ?? "");
  if (text.length <= max) return text;
  return `${text.slice(0, max)}
...[truncated ${text.length - max} chars]`;
}
function asRecord10(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}
function formatError13(error) {
  const record = asRecord10(error);
  return record?.message == null ? String(error) : String(record.message);
}

// src/modules/bridge-command-adapter/src/main/index.ts
import { promises as fs9 } from "node:fs";
import path10 from "node:path";
var EXPO_IOS_BRIDGE_VERSION4 = "1.0.0";
var BRIDGE_SCHEMA_VERSION = 1;
async function bridgeCommand(args = {}, dependencies = {}) {
  const action = requireBridgeAction(args.action ?? "status");
  const io = bridgeCommandIo(dependencies);
  const cwd = await resolveProjectCwd(args.cwd, io);
  const status = await bridgeInstallStatus(cwd, io);
  const plan = bridgeInstallPlan(cwd, status);
  if (action === "status") return toolJson21({ available: true, action, ...status });
  if (action === "plan") return toolJson21({ available: true, action, status: status.state, projectRoot: status.projectRoot, plan });
  if (action === "health" || action === "domains") {
    return toolJson21(await io.bridgeHealthPayload(args, { action, status, plan }));
  }
  const permission = action === "install" ? "bridge-install" : "bridge-remove";
  if (!hasExplicitConfirmation2(args.confirmActions, permission)) {
    return toolJson21({
      available: false,
      action,
      status: status.state,
      projectRoot: status.projectRoot,
      reason: `Refusing to mutate app files without explicit --confirm-actions ${permission}.`,
      requiredConfirmation: permission,
      plan
    });
  }
  if (action === "install") {
    await io.mkdir(io.joinPath(cwd, ".expo-ios"), { recursive: true });
    await io.mkdir(io.joinPath(cwd, "src"), { recursive: true });
    await io.writeJsonFile(io.joinPath(cwd, ".expo-ios", "bridge.json"), bridgeMetadata());
    await io.writeFile(io.joinPath(cwd, "src", "expo-ios-devtools-bridge.ts"), bridgeSource(), "utf8");
    return toolJson21({ available: true, action, projectRoot: cwd, installed: true, status: (await bridgeInstallStatus(cwd, io)).state, plan });
  }
  await removeIgnoringErrors(io, io.joinPath(cwd, ".expo-ios", "bridge.json"));
  await removeIgnoringErrors(io, io.joinPath(cwd, "src", "expo-ios-devtools-bridge.ts"));
  return toolJson21({ available: true, action, projectRoot: cwd, removed: true, status: (await bridgeInstallStatus(cwd, io)).state, plan });
}
async function bridgeInstallStatus(projectRoot, dependencies = {}) {
  const io = bridgeCommandIo(dependencies);
  const packageJsonPath = io.joinPath(projectRoot, "package.json");
  const packageJson = await readJsonOrNull(io.readJsonFile, packageJsonPath);
  const deps = packageJson ? dependencyMap(packageJson) : {};
  const metadataPath = io.joinPath(projectRoot, ".expo-ios", "bridge.json");
  const sourcePath = io.joinPath(projectRoot, "src", "expo-ios-devtools-bridge.ts");
  const metadata = await readJsonOrNull(io.readJsonFile, metadataPath);
  const sourceExists = await Promise.resolve(io.pathExists(sourcePath));
  const hasExpo = typeof deps.expo === "string";
  const rozenitePackages = Object.keys(deps).filter((name) => name === "rozenite" || name.startsWith("@rozenite/")).sort();
  let state = "absent";
  const issues = [];
  if (!hasExpo) {
    state = "incompatible";
    issues.push({
      code: "missing-expo",
      message: "The project does not declare expo, so an Expo DevTools bridge cannot be installed safely."
    });
  } else if (metadata || sourceExists) {
    if (!metadata || !sourceExists) {
      state = "stale";
      issues.push({
        code: "partial-install",
        message: "Bridge metadata and source file are not both present."
      });
    } else if (metadataProperty(metadata, "bridgeVersion") !== EXPO_IOS_BRIDGE_VERSION4 || metadataProperty(metadata, "schemaVersion") !== BRIDGE_SCHEMA_VERSION) {
      state = "stale";
      issues.push({
        code: "version-mismatch",
        message: `Bridge version ${String(metadataProperty(metadata, "bridgeVersion") ?? "unknown")} does not match ${EXPO_IOS_BRIDGE_VERSION4}.`
      });
    } else if (metadataProperty(metadata, "developmentOnly") !== true) {
      state = "incompatible";
      issues.push({
        code: "not-development-only",
        message: "Bridge metadata must declare developmentOnly: true."
      });
    } else {
      state = "present";
    }
  }
  return {
    projectRoot,
    state,
    bridgeVersion: metadataProperty(metadata, "bridgeVersion") ?? null,
    expectedBridgeVersion: EXPO_IOS_BRIDGE_VERSION4,
    developmentOnly: metadataProperty(metadata, "developmentOnly") === true,
    metadataPath,
    sourcePath,
    files: { metadata: Boolean(metadata), source: sourceExists },
    dependencies: {
      expo: deps.expo ?? null,
      rozenite: rozenitePackages.map((name) => ({ name, version: deps[name] }))
    },
    issues
  };
}
function bridgeInstallPlan(projectRoot, status) {
  return {
    permissionRequired: true,
    requiredConfirmations: ["bridge-install", "bridge-remove"],
    developmentOnly: true,
    productionExclusion: [
      "Bridge code must be imported only from development-only app entrypoints or guarded by __DEV__.",
      "Production/release builds must not import src/expo-ios-devtools-bridge.ts."
    ],
    filesToAddOrChange: [
      {
        path: status.metadataPath,
        action: status.files.metadata ? "update" : "add",
        purpose: "Versioned bridge metadata for stale/incompatible detection and removal."
      },
      {
        path: status.sourcePath,
        action: status.files.source ? "update" : "add",
        purpose: "Development-only Expo/Rozenite bridge registration shim."
      }
    ],
    removalPlan: [
      { path: status.metadataPath, action: "delete" },
      { path: status.sourcePath, action: "delete" }
    ],
    runtimeHealthCheckExpectations: [
      "Metro target is available.",
      "Hermes inspector is available.",
      "Bridge metadata version matches CLI expected version.",
      "App registers readable and writable domains separately.",
      "Mutation domains remain action-policy gated."
    ],
    status: status.state,
    issues: status.issues
  };
}
function bridgeMetadata() {
  return {
    schemaVersion: BRIDGE_SCHEMA_VERSION,
    bridgeVersion: EXPO_IOS_BRIDGE_VERSION4,
    developmentOnly: true,
    generatedBy: "expo-ios",
    domains: ["navigation", "network", "storage", "controls", "performance", "snapshot"]
  };
}
function bridgeSource() {
  return `// Generated by expo-ios. Import this file only from development-only app code guarded by __DEV__.
export const expoIosDevtoolsBridgeMetadata = ${JSON.stringify(bridgeMetadata(), null, 2)} as const;

export function registerExpoIosDevtoolsBridge() {
  if (typeof __DEV__ === "undefined") return { registered: false, reason: "development-mode-required" };
  if (!__DEV__) return { registered: false, reason: "production-build" };
  const bridge = {
    registered: true,
    metadata: expoIosDevtoolsBridgeMetadata,
    bridgeVersion: expoIosDevtoolsBridgeMetadata.bridgeVersion,
    domains: expoIosDevtoolsBridgeMetadata.domains.map((name) => ({ name })),
  };
  globalThis.__EXPO_IOS_DEVTOOLS_BRIDGE__ = bridge;
  return { registered: true, metadata: expoIosDevtoolsBridgeMetadata };
}
`;
}
function toolJson21(value) {
  return { content: [{ type: "text", text: `${JSON.stringify(value, null, 2)}
` }], isError: false };
}
function requireString14(value, field) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${field} must be a non-empty string.`);
  }
  return value.trim();
}
function hasExplicitConfirmation2(value, required) {
  return String(value ?? "").split(",").map((item) => item.trim()).includes(required);
}
async function normalizeProjectCwd2(cwd, options = {}) {
  const resolved = path10.resolve(cwd ?? process.cwd());
  const stat8 = await fs9.stat(resolved).catch(() => null);
  if (!stat8?.isDirectory()) {
    throw new Error(`Directory does not exist: ${resolved}`);
  }
  if (options.allowMissingPackageJson) return resolved;
  return resolved;
}
async function readJsonFile6(file) {
  return JSON.parse(await fs9.readFile(file, "utf8"));
}
async function pathExists4(file) {
  return fs9.access(file).then(() => true, () => false);
}
async function writeJsonFile4(file, value) {
  await fs9.writeFile(file, `${JSON.stringify(value, null, 2)}
`, "utf8");
}
function bridgeCommandIo(dependencies) {
  return {
    normalizeProjectCwd: dependencies.normalizeProjectCwd ?? normalizeProjectCwd2,
    bridgeHealthPayload: dependencies.bridgeHealthPayload ?? defaultBridgeHealthPayload,
    readJsonFile: dependencies.readJsonFile ?? readJsonFile6,
    pathExists: dependencies.pathExists ?? pathExists4,
    mkdir: dependencies.mkdir ?? fs9.mkdir,
    writeJsonFile: dependencies.writeJsonFile ?? writeJsonFile4,
    writeFile: dependencies.writeFile ?? fs9.writeFile,
    rm: dependencies.rm ?? fs9.rm,
    joinPath: dependencies.joinPath ?? path10.join,
    resolvePath: dependencies.resolvePath ?? path10.resolve,
    currentCwd: dependencies.currentCwd ?? process.cwd
  };
}
async function resolveProjectCwd(cwd, io) {
  try {
    return await io.normalizeProjectCwd(cwd, { allowMissingPackageJson: true });
  } catch {
    return io.resolvePath(cwd ?? io.currentCwd());
  }
}
async function defaultBridgeHealthPayload() {
  return {
    available: false,
    health: "unavailable",
    reason: "Bridge health payload dependency was not provided."
  };
}
async function removeIgnoringErrors(io, file) {
  try {
    await io.rm(file, { force: true });
  } catch {
  }
}
function requireBridgeAction(value) {
  const action = requireString14(value, "action");
  if (isBridgeAction(action)) return action;
  throw new Error(`Unknown bridge action: ${action}`);
}
function isBridgeAction(action) {
  return ["status", "plan", "health", "domains", "install", "remove"].includes(action);
}
async function readJsonOrNull(read, file) {
  try {
    return await read(file);
  } catch {
    return null;
  }
}
function dependencyMap(packageJson) {
  const record = asRecord11(packageJson);
  return {
    ...asRecord11(record?.dependencies),
    ...asRecord11(record?.devDependencies)
  };
}
function metadataProperty(metadata, key) {
  return asRecord11(metadata)?.[key];
}
function asRecord11(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : void 0;
}

// src/modules/accessibility-actions/src/main/index.ts
import { readdir as readdir8, readFile as readFile13 } from "node:fs/promises";
import { execFile as nodeExecFile10 } from "node:child_process";
import { basename as basename5, join as join10, resolve as resolve5 } from "node:path";
var FOCUS_LIMITATION = "Native iOS accessibility focus APIs are not exposed by stable local simulator tooling here; this command focuses the element through the available ref tap path.";
function toolJson22(value) {
  return { content: [{ type: "text", text: `${JSON.stringify(value, null, 2)}
` }] };
}
async function accessibilityCommand(args = {}, deps = defaultAccessibilityDependencies) {
  const positionals = Array.isArray(args._) ? args._ : [];
  const action = requireString15(args.action ?? positionals[0] ?? "tree", "action");
  if (!["tree", "inspect", "audit", "focus"].includes(action)) throw new Error(`Unknown accessibility action: ${action}`);
  if (action === "focus") {
    const ref = requireString15(args.ref ?? positionals[1], "ref");
    if (!deps.refActionCommand) return toolJson22({ available: false, action, ref, reason: "No ref action adapter is configured." });
    const result = unwrapToolJson9(await deps.refActionCommand({ ...args, command: "focus", ref }));
    return toolJson22({
      ...result,
      action,
      source: result.source ?? "ref-action",
      limitations: [FOCUS_LIMITATION]
    });
  }
  if (action === "inspect") {
    const ref = requireString15(args.ref ?? positionals[1], "ref");
    const cache = await readLatestRefCache4(args, deps);
    if (!cache) return toolJson22({ available: false, action, reason: "No snapshot exists for the current session.", ref });
    const record = (cache.refs ?? []).find((item) => item.ref === ref);
    return toolJson22(record ? { available: true, action, ref, snapshotId: cache.snapshotId, targetId: cache.targetId, record } : { available: false, action, reason: "Ref not found in the latest snapshot.", ref });
  }
  if (action === "audit") {
    const cache = await readLatestRefCache4(args, deps);
    if (!cache) return toolJson22({ available: false, action, reason: "No snapshot exists for the current session.", issues: [] });
    const issues = auditAccessibilityRefs(cache);
    return toolJson22({ available: true, action, snapshotId: cache.snapshotId, targetId: cache.targetId, issueCount: issues.length, issues });
  }
  return toolJson22(await accessibilityTreePayload(args, deps));
}
var defaultAccessibilityDependencies = {
  commandPath: defaultCommandPath2,
  resolveIosDevice: (device, options) => resolveIosDevice(typeof device === "string" ? device : null, options),
  execFile: defaultExecFile4,
  refActionCommand: (args) => toolJson22({
    available: false,
    action: "focus",
    ref: args.ref ?? null,
    reason: "Accessibility focus requires a current ref action adapter."
  })
};
function defaultCommandPath2(command) {
  return new Promise((resolve15) => {
    nodeExecFile10("which", [command], { timeout: 5e3 }, (error, stdout) => {
      resolve15(error ? null : String(stdout ?? "").trim() || null);
    });
  });
}
function defaultExecFile4(file, argv, options) {
  return new Promise((resolve15) => {
    nodeExecFile10(file, argv, {
      timeout: options.timeout,
      maxBuffer: options.maxBuffer
    }, (error, stdout, stderr) => {
      resolve15({
        stdout: String(stdout ?? ""),
        stderr: String(stderr ?? ""),
        error: error ? { message: error.message, code: error.code, signal: error.signal } : void 0
      });
    });
  });
}
async function accessibilityTreePayload(args, deps = {}) {
  const semanticBridge = await semanticBridgeTree(args, deps);
  const axe = deps.commandPath ? await deps.commandPath("axe") : null;
  if (!axe) return { available: false, action: "tree", reason: "axe CLI is not installed or not on PATH.", semanticBridge };
  if (!deps.resolveIosDevice) return { available: false, action: "tree", reason: "No iOS device resolver is configured." };
  if (!deps.execFile) return { available: false, action: "tree", reason: "No subprocess adapter is configured." };
  const device = await deps.resolveIosDevice(args.device, { preferBooted: true });
  const result = await deps.execFile(axe, ["describe-ui", "--udid", String(device.udid)], {
    timeout: 12e3,
    maxBuffer: 4 * 1024 * 1024,
    rejectOnError: false
  });
  if (result.error) {
    return { available: false, action: "tree", reason: "Native accessibility tree failed.", stderr: truncate15(result.stderr), error: result.error, semanticBridge };
  }
  const tree = JSON.parse(result.stdout || "[]");
  return {
    available: true,
    action: "tree",
    source: semanticBridge?.available ? ["plugin-bridge-semantic", "native-accessibility"] : "native-accessibility",
    device,
    tree,
    semanticBridge
  };
}
function auditAccessibilityRefs(cache) {
  return (cache.refs ?? []).filter((record) => (record.actions ?? []).length > 0 && !record.label && !record.text).map((record) => ({ ref: record.ref, rule: "interactive-name", message: "Interactive ref has no label or text." }));
}
async function readLatestRefCache4(args = {}, deps = {}) {
  if (deps.readLatestRefCache) return deps.readLatestRefCache(args);
  const stateRoot = resolveExpoStateRoot5(args);
  const session = asRecord12(await readLatestSession4(stateRoot));
  if (!session?.lastSnapshotId) return null;
  return readJsonFile7(join10(sessionDirectory2(stateRoot, String(session.sessionId)), "refs.json")).catch(() => null);
}
async function semanticBridgeTree(args, deps = {}) {
  if (!deps.semanticBridgeSnapshot) return null;
  try {
    return await deps.semanticBridgeSnapshot(args, {
      stateRoot: resolveExpoStateRoot5(args),
      session: { activeTargetId: null },
      filters: { interactiveOnly: false, compact: false, depth: null, includeSource: true, includeBounds: true }
    });
  } catch (error) {
    return { available: false, source: "plugin-bridge-semantic", code: "transport-failure", reason: formatError14(error) };
  }
}
async function readLatestSession4(stateRoot) {
  const sessionsRoot = join10(stateRoot, "sessions");
  const entries = await readdir8(sessionsRoot, { withFileTypes: true }).catch(() => []);
  const sessions = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const record = await readJsonFile7(join10(sessionsRoot, entry.name, "session.json")).catch(() => null);
    if (record) sessions.push(record);
  }
  sessions.sort((a, b) => String(asRecord12(b)?.updatedAt ?? asRecord12(b)?.createdAt).localeCompare(String(asRecord12(a)?.updatedAt ?? asRecord12(a)?.createdAt)));
  return sessions[0] ?? null;
}
function resolveExpoStateRoot5(args = {}) {
  if (args.stateDir) {
    const resolved = resolve5(args.stateDir);
    return basename5(resolved) === "runs" ? resolve5(join10(resolved, "..")) : resolved;
  }
  const root = resolve5(args.root ?? args.cwd ?? process.cwd());
  return join10(root, ".scratch", "expo-ios");
}
function sessionDirectory2(stateRoot, sessionId) {
  return join10(stateRoot, "sessions", sessionId);
}
async function readJsonFile7(file) {
  return JSON.parse(await readFile13(file, "utf8"));
}
function requireString15(value, name) {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${name} must be a non-empty string.`);
  return value.trim();
}
function truncate15(value, max = 4e4) {
  const text = String(value ?? "");
  if (text.length <= max) return text;
  return `${text.slice(0, max)}...[truncated ${text.length - max} chars]`;
}
function unwrapToolJson9(result) {
  return JSON.parse(result.content[0]?.text ?? "null");
}
function formatError14(error) {
  const record = error && typeof error === "object" ? error : null;
  return record?.message == null ? String(error) : String(record.message);
}
function asRecord12(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

// src/modules/modal-blocker-actions/src/main/index.ts
var MAX_OUTPUT12 = 4e4;
var MAX_ARRAY_ITEMS3 = 1e3;
function toolJson23(value) {
  return { content: [{ type: "text", text: stringifyBoundedJson2(value) }] };
}
async function dialogCommand(args = {}, deps = defaultModalBridgeDependencies) {
  return modalBridgeCommand({ args, domain: "dialog", actions: ["status", "accept", "dismiss"] }, deps);
}
async function sheetCommand(args = {}, deps = defaultModalBridgeDependencies) {
  return modalBridgeCommand({ args, domain: "sheet", actions: ["status", "dismiss"] }, deps);
}
var defaultModalBridgeDependencies = {
  metroTargets: (metroPort) => metroTargets(metroPort),
  evaluateHermesExpression
};
async function modalBridgeCommand(input, deps) {
  const positionals = Array.isArray(input.args._) ? input.args._ : [];
  const action = requireString16(input.args.action ?? positionals[0] ?? "status", "action");
  if (!input.actions.includes(action)) throw new Error(`Unknown ${input.domain} action: ${action}`);
  const sideEffect = action === "status" ? "read" : "device";
  const policy = {
    checked: true,
    action: `${input.domain}.${action}`,
    sideEffect,
    allowed: true,
    reason: "Modal action is non-destructive."
  };
  return toolJson23(await bridgeDomainCommand2({
    args: input.args,
    domain: input.domain,
    action,
    expression: modalExpression({
      domain: input.domain,
      action,
      text: input.args.text ?? positionals[1]
    }),
    policy
  }, deps));
}
async function bridgeDomainCommand2(input, deps) {
  const metroPort = clampNumber20(input.args.metroPort ?? 8081, 1, 65535);
  const targets = deps.metroTargets ? await deps.metroTargets(metroPort) : [];
  const target = targets[0] ?? null;
  const webSocketDebuggerUrl = target?.webSocketDebuggerUrl ?? null;
  if (!webSocketDebuggerUrl) {
    return domainUnavailable2({
      domain: input.domain,
      action: input.action,
      metroPort,
      code: "no-runtime-target",
      reason: "No Metro inspector target.",
      policy: input.policy
    });
  }
  if (!deps.evaluateHermesExpression) {
    return domainUnavailable2({
      domain: input.domain,
      action: input.action,
      metroPort,
      code: "transport-failure",
      reason: `${input.domain} bridge did not return a value.`,
      target: targetSummary8(target),
      policy: input.policy
    });
  }
  const result = await deps.evaluateHermesExpression(webSocketDebuggerUrl, input.expression, { timeoutMs: 5e3 });
  const value = result?.result?.result?.value;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return domainUnavailable2({
      domain: input.domain,
      action: input.action,
      metroPort,
      code: "transport-failure",
      reason: result?.error ?? `${input.domain} bridge did not return a value.`,
      target: targetSummary8(target),
      transport: bridgeRuntimeTransport2(metroPort, target, result?.diagnostics ?? result?.cdp ?? null),
      policy: input.policy
    });
  }
  const redacted = sanitizePayload3(deps.redactValue ? deps.redactValue(value) : value);
  return sanitizePayload3({
    ...redacted,
    domain: input.domain,
    action: input.action,
    metroPort,
    target: targetSummary8(target),
    transport: bridgeRuntimeTransport2(metroPort, target, result?.diagnostics ?? result?.cdp ?? null),
    evidenceSource: typeof redacted.source === "string" ? redacted.source : "unknown",
    policy: input.policy
  });
}
function domainUnavailable2(args) {
  return sanitizePayload3({
    available: false,
    domain: args.domain,
    action: args.action,
    source: "app-instrumentation",
    evidenceSource: "unavailable",
    code: args.code ?? "unavailable",
    reason: args.reason,
    metroPort: args.metroPort,
    target: targetSummary8(args.target),
    transport: args.transport ?? bridgeRuntimeTransport2(args.metroPort, args.target ?? null, null),
    policy: args.policy ?? null,
    limitations: [`${args.domain} evidence requires the dev-only app instrumentation bridge.`]
  });
}
function bridgeRuntimeTransport2(metroPort, target, cdp = null) {
  return sanitizePayload3({
    name: "metro-inspector-hermes-cdp",
    metroPort,
    protocol: "Runtime.evaluate",
    target: targetSummary8(target),
    cdp
  });
}
function modalExpression(args) {
  const globalName = args.domain === "dialog" ? "__EXPO_IOS_DIALOG_BRIDGE__" : "__EXPO_IOS_SHEET_BRIDGE__";
  return `(() => {
    const action = ${JSON.stringify(args.action)};
    const text = ${JSON.stringify(args.text ?? null)};
    const bridge = globalThis.${globalName} ||
      (globalThis.__EXPO_IOS_INSTRUMENTATION__ && globalThis.__EXPO_IOS_INSTRUMENTATION__[${JSON.stringify(args.domain)}]);
    if (!bridge) return { available: false, source: 'app-instrumentation', reason: ${JSON.stringify(`${args.domain} bridge is not installed.`)}, action };
    if (action === 'status') return { available: true, source: 'app-instrumentation', action, visible: !!bridge.visible, ${args.domain}: bridge.current || null };
    if (action === 'accept') return { available: true, source: 'app-instrumentation', action, result: bridge.accept ? bridge.accept(text) : { accepted: true, text } };
    if (action === 'dismiss') return { available: true, source: 'app-instrumentation', action, result: bridge.dismiss ? bridge.dismiss() : { dismissed: true } };
    return { available: false, source: 'app-instrumentation', reason: 'Unsupported modal action.', action };
  })()`;
}
function targetSummary8(target) {
  if (!target) return null;
  return sanitizePayload3({
    id: target.id ?? null,
    title: target.title ?? null,
    description: target.description ?? null,
    appId: target.appId ?? null,
    deviceName: target.deviceName ?? null,
    devtoolsFrontendUrl: target.devtoolsFrontendUrl ?? null,
    webSocketDebuggerUrl: target.webSocketDebuggerUrl ?? null,
    reactNative: target.reactNative ?? null,
    capabilities: target.capabilities ?? {
      hermesRuntime: typeof target.webSocketDebuggerUrl === "string" && target.webSocketDebuggerUrl.startsWith("ws"),
      devtoolsFrontend: typeof target.devtoolsFrontendUrl === "string" && target.devtoolsFrontendUrl.length > 0,
      reactNative: Boolean(target.reactNative)
    }
  });
}
function clampNumber20(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`Expected a finite number, got ${String(value)}.`);
  return Math.min(Math.max(number, min), max);
}
function requireString16(value, name) {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${name} must be a non-empty string.`);
  return value.trim();
}
function sanitizePayload3(value) {
  return boundValue3(redactValue7(value));
}
function stringifyBoundedJson2(value) {
  const sanitized = sanitizePayload3(value);
  const text = JSON.stringify(sanitized, null, 2);
  if (text.length <= MAX_OUTPUT12) return text;
  const record = asRecord13(sanitized);
  const envelope = {
    available: false,
    source: "output-boundary",
    evidenceSource: "output-boundary",
    code: "output-truncated",
    outputTruncated: true,
    originalLength: text.length,
    domain: record?.domain,
    action: record?.action,
    preview: ""
  };
  let budget = MAX_OUTPUT12 - JSON.stringify(envelope, null, 2).length - 128;
  envelope.preview = text.slice(0, Math.max(0, budget));
  let output = JSON.stringify(envelope, null, 2);
  while (output.length > MAX_OUTPUT12 && typeof envelope.preview === "string") {
    budget -= output.length - MAX_OUTPUT12 + 128;
    envelope.preview = envelope.preview.slice(0, Math.max(0, budget));
    output = JSON.stringify(envelope, null, 2);
  }
  return output;
}
function boundValue3(value) {
  if (typeof value === "string") return truncate16(value);
  if (Array.isArray(value)) return value.slice(-MAX_ARRAY_ITEMS3).map(boundValue3);
  const record = asRecord13(value);
  if (!record) return value;
  return Object.fromEntries(Object.entries(record).map(([key, nested]) => [key, boundValue3(nested)]));
}
function redactValue7(value) {
  if (typeof value === "string") return redactString3(value);
  if (Array.isArray(value)) return value.map(redactValue7);
  const record = asRecord13(value);
  if (!record) return value;
  return Object.fromEntries(Object.entries(record).map(([key, nested]) => [
    key,
    isSensitiveKey3(key) ? "[redacted]" : redactValue7(nested)
  ]));
}
function redactString3(value) {
  try {
    const parsed = new URL(value);
    let changed = false;
    for (const key of [...parsed.searchParams.keys()]) {
      if (isSensitiveKey3(key)) {
        parsed.searchParams.set(key, "[redacted]");
        changed = true;
      }
    }
    return changed ? parsed.toString() : value;
  } catch {
    return value.replace(/([?&](?:cookie|token|authorization|password|secret|api[-_]?key|apikey)=)[^&\s]+/gi, "$1[redacted]");
  }
}
function isSensitiveKey3(key) {
  return /token|authorization|cookie|password|secret|apikey|apiKey/i.test(key);
}
function truncate16(value, max = MAX_OUTPUT12) {
  const text = String(value ?? "");
  if (text.length <= max) return text;
  return `${text.slice(0, max)}
...[truncated ${text.length - max} chars]`;
}
function asRecord13(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

// src/modules/record-artifacts/src/main/index.ts
import { access as access4, mkdir as mkdir12, readdir as readdir9, readFile as readFile14, writeFile as writeFile7 } from "node:fs/promises";
import { basename as basename6, dirname as dirname4, join as join11, resolve as resolve6 } from "node:path";
var RECORD_LIMITATION = "This tracer-bullet command records metadata; native video capture is implemented by a later adapter.";
function toolJson24(value) {
  return { content: [{ type: "text", text: `${JSON.stringify(value, null, 2)}
` }] };
}
async function recordCommand(args = {}, deps = {}) {
  const positionals = Array.isArray(args._) ? args._ : [];
  const action = requireString17(args.action ?? positionals[0] ?? "start", "action");
  if (!["start", "stop"].includes(action)) throw new Error(`Unknown record action: ${action}`);
  const stateRoot = resolveExpoStateRoot6(args);
  const session = asRecord14(await readLatestSession5(stateRoot));
  const recordDir = join11(stateRoot, "artifacts", "recordings");
  await mkdir12(recordDir, { recursive: true });
  const metadataPath = runRecordMetadataPath(stateRoot);
  if (action === "start") {
    const metadata2 = {
      available: true,
      action,
      startedAt: now3(deps).toISOString(),
      sessionId: session?.sessionId ?? null,
      targetId: session?.activeTargetId ?? null,
      status: "recording",
      limitations: [RECORD_LIMITATION]
    };
    await writeJsonFile5(metadataPath, metadata2);
    return toolJson24({ ...metadata2, metadataPath });
  }
  const outputPath = resolve6(String(args.outputPath ?? positionals[1] ?? join11(recordDir, `recording-${isoStamp(deps)}.mov`)));
  await mkdir12(dirname4(outputPath), { recursive: true });
  if (!await pathExists5(outputPath)) await writeFile7(outputPath, "recording placeholder\n", "utf8");
  const metadata = {
    available: true,
    action,
    stoppedAt: now3(deps).toISOString(),
    sessionId: session?.sessionId ?? null,
    targetId: session?.activeTargetId ?? null,
    outputPath,
    metadataPath,
    status: "stopped"
  };
  await writeJsonFile5(metadataPath, metadata);
  return toolJson24(metadata);
}
function runRecordMetadataPath(stateRoot) {
  return join11(stateRoot, "artifacts", "recordings", "recording.json");
}
async function readLatestSession5(stateRoot) {
  const sessionsRoot = join11(stateRoot, "sessions");
  const entries = await readdir9(sessionsRoot, { withFileTypes: true }).catch(() => []);
  const sessions = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const record = await readJsonFile8(join11(sessionsRoot, entry.name, "session.json")).catch(() => null);
    if (record) sessions.push(record);
  }
  sessions.sort((a, b) => String(asRecord14(b)?.updatedAt ?? asRecord14(b)?.createdAt).localeCompare(String(asRecord14(a)?.updatedAt ?? asRecord14(a)?.createdAt)));
  return sessions[0] ?? null;
}
function resolveExpoStateRoot6(args = {}) {
  if (args.stateDir) {
    const resolved = resolve6(args.stateDir);
    return basename6(resolved) === "runs" ? resolve6(join11(resolved, "..")) : resolved;
  }
  const root = resolve6(args.root ?? args.cwd ?? process.cwd());
  return join11(root, ".scratch", "expo-ios");
}
async function readJsonFile8(file) {
  return JSON.parse(await readFile14(file, "utf8"));
}
async function writeJsonFile5(file, value) {
  await writeFile7(file, `${JSON.stringify(value, null, 2)}
`, "utf8");
}
async function pathExists5(file) {
  try {
    await access4(file);
    return true;
  } catch {
    return false;
  }
}
function requireString17(value, name) {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${name} must be a non-empty string.`);
  return value.trim();
}
function isoStamp(deps) {
  return now3(deps).toISOString().replace(/[:.]/g, "-");
}
function now3(deps) {
  return deps.now ? deps.now() : /* @__PURE__ */ new Date();
}
function asRecord14(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

// src/modules/review-evidence-reports/src/main/index.ts
import { mkdir as mkdir13, readdir as readdir10, readFile as readFile15, stat as stat6, writeFile as writeFile8 } from "node:fs/promises";
import { basename as basename7, dirname as dirname5, join as join12, resolve as resolve7 } from "node:path";
var REVIEW_LIMITATION = "Review reports assemble evidence already captured by other commands; they do not independently judge UI quality.";
var ROUTE_DIFF_LIMITATION = "Route diff captures route-open evidence and optional screenshots; semantic visual comparison is left to the caller.";
function toolJson25(value) {
  return { content: [{ type: "text", text: `${JSON.stringify(value, null, 2)}
` }] };
}
async function reviewCommand(args = {}, deps = defaultReviewDiffDependencies) {
  const positionals = Array.isArray(args._) ? args._ : [];
  const action = requireString18(args.action ?? positionals[0] ?? "report", "action");
  if (!["report", "matrix"].includes(action)) throw new Error(`Unknown review action: ${action}`);
  const stateRoot = resolveExpoStateRoot7(args);
  const session = await readLatestSession6(stateRoot);
  const outputPath = resolve7(String(args.outputPath ?? join12(stateRoot, "artifacts", `review-${action}-${isoStamp2(deps)}.json`)));
  await mkdir13(dirname5(outputPath), { recursive: true });
  const runs = await listRunRecords(stateRoot);
  const latestRefs = await readLatestRefCache5(args);
  const payload = action === "matrix" ? reviewMatrixPayload({ stateRoot, session, runs, latestRefs, outputPath }) : reviewReportPayload({ stateRoot, session, runs, latestRefs, outputPath });
  await writeJsonFile6(outputPath, payload);
  return toolJson25(payload);
}
async function diffCommand(args = {}, deps = defaultReviewDiffDependencies) {
  const positionals = Array.isArray(args._) ? args._ : [];
  const kind = requireString18(args.kind ?? positionals[0], "kind");
  if (!["snapshot", "screenshot", "route"].includes(kind)) throw new Error(`Unknown diff kind: ${kind}`);
  const normalizedArgs = {
    ...args,
    kind,
    baseline: args.baseline ?? positionals[1],
    current: args.current ?? positionals[2],
    routeA: args.routeA ?? (kind === "route" ? positionals[1] : void 0),
    routeB: args.routeB ?? (kind === "route" ? positionals[2] : void 0)
  };
  const stateRoot = resolveExpoStateRoot7(normalizedArgs);
  const session = await readLatestSession6(stateRoot);
  const outputPath = resolve7(String(normalizedArgs.outputPath ?? join12(stateRoot, "artifacts", `diff-${kind}-${isoStamp2(deps)}.json`)));
  await mkdir13(dirname5(outputPath), { recursive: true });
  const diff = kind === "snapshot" ? await snapshotDiffPayload(normalizedArgs) : kind === "route" ? await routeDiffPayload(normalizedArgs, deps) : await screenshotDiffPayload(normalizedArgs);
  const payload = {
    ...diff,
    kind,
    sessionId: asRecord15(session)?.sessionId ?? null,
    targetId: asRecord15(session)?.activeTargetId ?? null,
    outputPath
  };
  await writeJsonFile6(outputPath, payload);
  return toolJson25(payload);
}
var defaultReviewDiffDependencies = {
  openExpoRoute,
  captureScreenshot,
  now: () => /* @__PURE__ */ new Date(),
  nowMs: () => Date.now()
};
function reviewReportPayload(args) {
  const session = asRecord15(args.session);
  const artifacts = collectExpoIosArtifacts(args.stateRoot);
  return {
    available: true,
    action: "report",
    outputPath: args.outputPath,
    stateRoot: args.stateRoot,
    sessionId: session?.sessionId ?? null,
    activeTargetId: session?.activeTargetId ?? null,
    lastSnapshotId: session?.lastSnapshotId ?? null,
    runCount: args.runs.length,
    recentRuns: args.runs.slice(-25).map(runSummary),
    refCount: Array.isArray(args.latestRefs?.refs) ? args.latestRefs.refs.length : 0,
    artifacts,
    limitations: [REVIEW_LIMITATION]
  };
}
function reviewMatrixPayload(args) {
  const session = asRecord15(args.session);
  const commands = new Set(args.runs.map((run) => run.command).filter(Boolean));
  const checks = [
    { name: "session", passed: Boolean(session), evidence: session ? sessionDirectory3(args.stateRoot, String(session.sessionId)) : null },
    { name: "target", passed: Boolean(session?.activeTargetId), evidence: session?.activeTargetId ?? null },
    { name: "snapshot", passed: Boolean(args.latestRefs?.snapshotId), evidence: args.latestRefs?.snapshotId ?? null },
    { name: "screenshot", passed: commands.has("screenshot") || commands.has("annotate-screen"), evidence: "run-records" },
    { name: "runtime", passed: commands.has("devtools") || commands.has("inspector") || commands.has("ux-context"), evidence: "run-records" },
    { name: "diagnostics", passed: commands.has("console") || commands.has("errors") || commands.has("logs"), evidence: "run-records" },
    { name: "interaction", passed: commands.has("tap") || commands.has("gesture") || commands.has("fill"), evidence: "run-records" }
  ];
  return {
    available: true,
    action: "matrix",
    outputPath: args.outputPath,
    stateRoot: args.stateRoot,
    sessionId: session?.sessionId ?? null,
    checks,
    passed: checks.every((check) => check.passed),
    runCount: args.runs.length
  };
}
async function routeDiffPayload(args = {}, deps = defaultReviewDiffDependencies) {
  const routeA = requireString18(args.routeA, "routeA");
  const routeB = requireString18(args.routeB, "routeB");
  const screenshot = args.screenshot === true;
  if (!deps.openExpoRoute) return { available: false, routeA, routeB, reason: "No open-route adapter is configured." };
  const openedA = unwrapToolJson10(await deps.openExpoRoute({ ...args, route: routeA }));
  const shotA = screenshot ? await captureRouteScreenshot(args, deps, `route-a-${nowMs2(deps)}.png`) : null;
  const openedB = unwrapToolJson10(await deps.openExpoRoute({ ...args, route: routeB }));
  const shotB = screenshot ? await captureRouteScreenshot(args, deps, `route-b-${nowMs2(deps)}.png`) : null;
  return {
    available: true,
    routeA,
    routeB,
    openedA,
    openedB,
    screenshots: screenshot ? { before: shotA?.outputPath ?? null, after: shotB?.outputPath ?? null } : null,
    limitations: [ROUTE_DIFF_LIMITATION]
  };
}
async function snapshotDiffPayload(args = {}) {
  const baseline = await readJsonFile9(resolve7(requireString18(args.baseline, "baseline")));
  const current = args.current ? await readJsonFile9(resolve7(requireString18(args.current, "current"))) : await latestSnapshotJson(args);
  if (!current) return { available: false, reason: "No current snapshot exists for the current session." };
  const beforeRefs = new Set(refsFromSnapshot(baseline));
  const afterRefs = new Set(refsFromSnapshot(current));
  return {
    available: true,
    baselineSnapshotId: asRecord15(baseline)?.snapshotId ?? null,
    currentSnapshotId: asRecord15(current)?.snapshotId ?? null,
    addedRefs: [...afterRefs].filter((ref) => !beforeRefs.has(ref)),
    removedRefs: [...beforeRefs].filter((ref) => !afterRefs.has(ref)),
    beforeCount: beforeRefs.size,
    afterCount: afterRefs.size
  };
}
async function screenshotDiffPayload(args = {}) {
  const baseline = resolve7(requireString18(args.baseline, "baseline"));
  const current = resolve7(requireString18(args.current, "current"));
  const [before, after] = await Promise.all([stat6(baseline), stat6(current)]);
  return {
    available: true,
    baseline,
    current,
    byteDelta: after.size - before.size,
    changed: before.size !== after.size
  };
}
async function latestSnapshotJson(args = {}) {
  const cache = await readLatestRefCache5(args);
  if (!cache?.snapshotId) return null;
  const stateRoot = resolveExpoStateRoot7(args);
  const session = await readLatestSession6(stateRoot);
  const sessionId = asRecord15(session)?.sessionId;
  if (!sessionId) return cache;
  return readJsonFile9(join12(sessionDirectory3(stateRoot, String(sessionId)), "snapshots", `${cache.snapshotId}.json`)).catch(() => cache);
}
async function readLatestSession6(stateRoot) {
  const sessionsRoot = join12(stateRoot, "sessions");
  const entries = await readdir10(sessionsRoot, { withFileTypes: true }).catch(() => []);
  const sessions = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const record = await readJsonFile9(join12(sessionsRoot, entry.name, "session.json")).catch(() => null);
    if (record) sessions.push(record);
  }
  sessions.sort((a, b) => String(asRecord15(b)?.updatedAt ?? asRecord15(b)?.createdAt).localeCompare(String(asRecord15(a)?.updatedAt ?? asRecord15(a)?.createdAt)));
  return sessions[0] ?? null;
}
async function readLatestRefCache5(args = {}) {
  const stateRoot = resolveExpoStateRoot7(args);
  const session = asRecord15(await readLatestSession6(stateRoot));
  if (!session?.lastSnapshotId) return null;
  return readJsonFile9(join12(sessionDirectory3(stateRoot, String(session.sessionId)), "refs.json")).catch(() => null);
}
async function listRunRecords(stateRoot) {
  const runsRoot = join12(stateRoot, "runs");
  const entries = await readdir10(runsRoot, { withFileTypes: true }).catch(() => []);
  const records = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const file = join12(runsRoot, entry.name);
    const record = asRecord15(await readJsonFile9(file).catch(() => null));
    if (record) records.push({ ...record, path: file });
  }
  records.sort((a, b) => String(a.startedAt ?? a.createdAt ?? "").localeCompare(String(b.startedAt ?? b.createdAt ?? "")));
  return records;
}
function runSummary(run) {
  return {
    command: run.command ?? null,
    status: run.status ?? null,
    exitCode: run.exitCode ?? null,
    startedAt: run.startedAt ?? run.createdAt ?? null,
    completedAt: run.completedAt ?? run.finishedAt ?? null,
    path: run.path ?? null,
    summary: run.summary ?? null
  };
}
function collectExpoIosArtifacts(stateRoot) {
  return {
    runs: join12(stateRoot, "runs"),
    sessions: join12(stateRoot, "sessions"),
    artifacts: join12(stateRoot, "artifacts")
  };
}
function resolveExpoStateRoot7(args = {}) {
  if (args.stateDir) {
    const resolved = resolve7(args.stateDir);
    return basename7(resolved) === "runs" ? resolve7(join12(resolved, "..")) : resolved;
  }
  const root = resolve7(args.root ?? args.cwd ?? process.cwd());
  return join12(root, ".scratch", "expo-ios");
}
function sessionDirectory3(stateRoot, sessionId) {
  return join12(stateRoot, "sessions", sessionId);
}
async function readJsonFile9(file) {
  return JSON.parse(await readFile15(file, "utf8"));
}
async function writeJsonFile6(file, value) {
  await writeFile8(file, `${JSON.stringify(value, null, 2)}
`, "utf8");
}
function requireString18(value, name) {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${name} must be a non-empty string.`);
  return value.trim();
}
function refsFromSnapshot(snapshot) {
  const refs = asRecord15(snapshot)?.refs;
  if (!Array.isArray(refs)) return [];
  return refs.map((record) => asRecord15(record)?.ref).filter((ref) => typeof ref === "string");
}
async function captureRouteScreenshot(args, deps, filename) {
  if (!deps.captureScreenshot) return null;
  const outputPath = join12(resolveExpoStateRoot7(args), "artifacts", filename);
  return deps.captureScreenshot({ ...args, outputPath });
}
function unwrapToolJson10(result) {
  const text = result.content[0]?.text ?? "null";
  return JSON.parse(text);
}
function isoStamp2(deps) {
  return (deps.now ? deps.now() : /* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-");
}
function nowMs2(deps) {
  return deps.nowMs ? deps.nowMs() : Date.now();
}
function asRecord15(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

// src/modules/debug-inspect-highlight/src/main/index.ts
import { mkdir as fsMkdir, readdir as readdir11, readFile as readFile16, writeFile as fsWriteFile } from "node:fs/promises";
import { basename as basename8, dirname as dirname6, join as join13, resolve as resolve8 } from "node:path";
function toolJson26(value) {
  return { content: [{ type: "text", text: `${JSON.stringify(value, null, 2)}
` }] };
}
async function debugInspectCommand(args = {}, deps = {}) {
  return toolJson26(await debugInspectPayload(args, deps));
}
async function debugInspectPayload(args = {}, deps = {}) {
  const ref = requireString19(args.ref ?? firstPositional(args), "ref");
  const found = await readRefRecord(ref, args, deps);
  const stateRoot = resolveExpoStateRoot8(args);
  const session = await latestSession(stateRoot, deps);
  if (found.available === false) {
    return {
      ...found,
      action: "inspect",
      sessionId: session?.sessionId ?? null
    };
  }
  const metroPort = clampNumber21(args.metroPort ?? 8081, 1, 65535);
  const metro = await metroStatus({ metroPort }, deps);
  const target = session ? await selectedTarget(stateRoot, session, deps) : null;
  const record = found.record;
  const sessionId = String(session?.sessionId ?? "");
  return {
    available: true,
    action: "inspect",
    ref,
    sessionId: session?.sessionId ?? null,
    snapshotId: found.cache.snapshotId,
    targetId: found.cache.targetId,
    target,
    metro: {
      available: metro.available === true,
      port: metroPort,
      targetCount: metro.targetCount ?? 0,
      firstTarget: metro.targets?.[0] ?? null
    },
    element: {
      ref,
      role: record.role ?? null,
      label: record.label ?? null,
      text: record.text ?? null,
      testID: record.testID ?? record.nativeID ?? null,
      box: record.box ?? null,
      source: record.source ?? null,
      component: record.component ?? null,
      props: record.props ?? null,
      actions: record.actions ?? [],
      stale: record.stale === true
    },
    evidence: {
      refCache: join13(sessionDirectory4(stateRoot, sessionId), "refs.json"),
      snapshotId: found.cache.snapshotId
    },
    limitations: [
      "Inspect is assembled from the latest cached semantic/native ref snapshot plus Metro target status.",
      "Props and source are present only when the snapshot source includes them."
    ]
  };
}
async function highlightCommand(args = {}, deps = {}) {
  const ref = requireString19(args.ref ?? firstPositional(args), "ref");
  const found = await readRefRecord(ref, args, deps);
  if (found.available === false) return toolJson26({ ...found, action: "highlight" });
  const box = found.record.box;
  if (!box) {
    return toolJson26({
      available: false,
      action: "highlight",
      ref,
      reason: "Ref does not include bounds. Capture a snapshot with --bounds before highlighting.",
      record: found.record
    });
  }
  const stateRoot = resolveExpoStateRoot8(args);
  const timestamp = (deps.now?.() ?? /* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-");
  const outputPath = join13(stateRoot, "artifacts", `highlight-${ref.replace(/[^a-z0-9]/gi, "")}-${timestamp}.svg`);
  await (deps.mkdir ?? fsMkdir)(dirname6(outputPath), { recursive: true });
  await (deps.writeFile ?? fsWriteFile)(outputPath, highlightSvg({ ref, record: found.record, durationMs: args.durationMs }), "utf8");
  return toolJson26({
    available: true,
    action: "highlight",
    ref,
    durationMs: args.durationMs ?? null,
    snapshotId: found.cache.snapshotId,
    targetId: found.cache.targetId,
    outputPath,
    record: found.record,
    limitations: ["Highlight writes an evidence overlay artifact from cached bounds; it does not draw inside the running app."]
  });
}
function highlightSvg({ ref, record, durationMs }) {
  const box = asBox(record.box);
  const width = Math.max(390, Math.ceil(box.x + box.width + 24));
  const height = Math.max(844, Math.ceil(box.y + box.height + 24));
  const label = `${ref} ${record.label ?? record.text ?? record.role ?? ""}`.trim();
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="100%" height="100%" fill="rgba(0,0,0,0.08)"/>
  <rect x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" fill="rgba(255,204,0,0.25)" stroke="#ffcc00" stroke-width="4"/>
  <text x="${Math.max(4, box.x)}" y="${Math.max(18, box.y - 8)}" fill="#111" font-family="Menlo, monospace" font-size="14">${escapeHtml2(label)}</text>
  <text x="8" y="${height - 12}" fill="#444" font-family="Menlo, monospace" font-size="11">${escapeHtml2(durationMs ? `durationMs=${durationMs}` : "static highlight evidence")}</text>
</svg>
`;
}
async function readRefRecord(ref, args = {}, deps = {}) {
  const cache = await readLatestRefCache6(args, deps);
  if (!cache) return { available: false, reason: "No snapshot exists for the current session.", ref };
  const record = (cache.refs ?? []).find((item) => item.ref === ref);
  if (!record) return { available: false, reason: "Ref not found in the latest snapshot.", ref };
  if (record.stale) return { available: false, reason: "Ref is stale. Capture a new snapshot before acting.", ref };
  return { available: true, record, cache };
}
async function readLatestRefCache6(args = {}, deps = {}) {
  if (deps.readLatestRefCache) return deps.readLatestRefCache(args);
  const stateRoot = resolveExpoStateRoot8(args);
  const session = await readLatestSession7(stateRoot);
  if (!session?.lastSnapshotId) return null;
  return readJsonFile10(join13(sessionDirectory4(stateRoot, String(session.sessionId)), "refs.json")).catch(() => null);
}
async function readLatestSession7(stateRoot) {
  const sessionsRoot = join13(stateRoot, "sessions");
  const entries = await readdir11(sessionsRoot, { withFileTypes: true }).catch(() => []);
  const sessions = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const record = await readJsonFile10(join13(sessionsRoot, entry.name, "session.json")).catch(() => null);
    if (record) sessions.push(record);
  }
  sessions.sort((a, b) => String(asRecord16(b)?.updatedAt ?? asRecord16(b)?.createdAt).localeCompare(String(asRecord16(a)?.updatedAt ?? asRecord16(a)?.createdAt)));
  return asRecord16(sessions[0]);
}
async function readSelectedTarget(stateRoot, session) {
  return readJsonFile10(join13(sessionDirectory4(stateRoot, String(session.sessionId)), "target.json")).then(asRecord16).catch(() => null);
}
function resolveExpoStateRoot8(args = {}) {
  if (args.stateDir) {
    const resolved = resolve8(args.stateDir);
    return basename8(resolved) === "runs" ? resolve8(join13(resolved, "..")) : resolved;
  }
  const root = resolve8(args.root ?? args.cwd ?? process.cwd());
  return join13(root, ".scratch", "expo-ios");
}
function sessionDirectory4(stateRoot, sessionId) {
  return join13(stateRoot, "sessions", sessionId);
}
async function readJsonFile10(file) {
  return JSON.parse(await readFile16(file, "utf8"));
}
function requireString19(value, name) {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${name} must be a non-empty string.`);
  return value.trim();
}
function clampNumber21(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`Expected a finite number, got ${String(value)}.`);
  return Math.min(Math.max(number, min), max);
}
function escapeHtml2(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
async function latestSession(stateRoot, deps) {
  return deps.readLatestSession ? deps.readLatestSession(stateRoot) : readLatestSession7(stateRoot);
}
async function selectedTarget(stateRoot, session, deps) {
  return deps.readSelectedTarget ? deps.readSelectedTarget(stateRoot, session) : readSelectedTarget(stateRoot, session);
}
async function metroStatus(args, deps) {
  return deps.metroStatusPayload ? deps.metroStatusPayload(args) : { available: false, targetCount: 0, targets: [] };
}
function asBox(value) {
  const record = asRecord16(value);
  const x = Number(record?.x);
  const y = Number(record?.y);
  const width = Number(record?.width);
  const height = Number(record?.height);
  if (![x, y, width, height].every(Number.isFinite)) throw new Error("record.box must include finite x, y, width, and height.");
  return { x, y, width, height };
}
function firstPositional(args) {
  return Array.isArray(args._) ? args._[0] : void 0;
}
function asRecord16(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

// src/modules/expo-introspection-actions/src/main/index.ts
import { access as access5, readFile as readFile17, stat as stat7 } from "node:fs/promises";
import path11 from "node:path";
var EXPO_ACTIONS = ["modules", "config", "doctor", "upstream-policy", "prebuild-plan"];
function toolJson27(value) {
  return {
    content: [{ type: "text", text: `${JSON.stringify(value, null, 2)}
` }],
    isError: false
  };
}
function unwrapToolJson11(value) {
  const text = asRecord17(value)?.content;
  if (!Array.isArray(text)) return value;
  const first = asRecord17(text[0]);
  if (first?.type !== "text" || typeof first.text !== "string") return value;
  try {
    return JSON.parse(first.text);
  } catch {
    return { text: first.text };
  }
}
async function expoCommand(args = {}, deps = defaultExpoCommandDependencies) {
  const action = requireString20(args.action ?? "modules", "action");
  if (!isExpoAction(action)) throw new Error(`Unknown Expo action: ${action}`);
  const cwd = await deps.normalizeProjectCwd(args.cwd, { allowMissingPackageJson: true }).catch(() => deps.resolvePath(args.cwd ?? deps.currentWorkingDirectory()));
  const summary = await deps.runtimeSummary(cwd);
  if (action === "doctor") {
    return toolJson27({
      available: true,
      action,
      sources: ["project", "native"],
      projectRoot: summary.projectRoot,
      summary: unwrapToolJson11(await deps.doctor({ cwd: summary.projectRoot }))
    });
  }
  if (action === "upstream-policy") {
    const info = asRecord17(unwrapToolJson11(await deps.projectInfo({ cwd: summary.projectRoot }))) ?? {};
    return toolJson27({
      available: Boolean(info.isExpoProject),
      action,
      sources: ["project"],
      projectRoot: summary.projectRoot,
      report: info.upstreamDependencies ?? deps.buildUpstreamDependencyReport(summary.projectRoot, {}),
      limitations: [
        "Static dependency policy cannot prove a runtime target is registered; run DevTools and bridge health checks for live domains."
      ]
    });
  }
  if (action === "config") {
    return toolJson27({
      available: true,
      action,
      sources: ["project"],
      ...summary,
      limitations: expoConfigLimitations(summary)
    });
  }
  const modules = await expoModuleRecords(summary.projectRoot, deps);
  if (action === "modules") {
    return toolJson27({
      available: true,
      action,
      sources: ["project"],
      projectRoot: summary.projectRoot,
      expoDependency: summary.expoDependency,
      reactNativeDependency: summary.reactNativeDependency,
      modules,
      limitations: ["Static dependency inspection cannot prove which native modules are currently compiled into the running app."]
    });
  }
  const risks = await expoPrebuildRisks(summary.projectRoot, modules, deps);
  return toolJson27({
    available: true,
    action,
    sources: ["project"],
    projectRoot: summary.projectRoot,
    riskLevel: expoPrebuildRiskLevel(risks),
    risks,
    modules: modules.filter((module) => module.category === "config-plugin"),
    appConfig: summary.appConfig,
    limitations: [
      "This static plan flags rebuild risk; it does not run expo prebuild or mutate native projects.",
      "Dynamic app.config files are read with conservative string extraction only."
    ]
  });
}
var defaultExpoCommandDependencies = {
  normalizeProjectCwd: defaultNormalizeProjectCwd3,
  resolvePath: (input) => path11.resolve(input),
  currentWorkingDirectory: () => process.cwd(),
  runtimeSummary: async (cwd) => {
    const info = asRecord17(unwrapToolJson11(await projectInfo({ cwd }))) ?? {};
    return {
      projectRoot: String(info.projectRoot ?? cwd),
      expoDependency: info.expoDependency ?? null,
      reactNativeDependency: info.reactNativeDependency ?? null,
      appConfig: asRecord17(info.appConfig)
    };
  },
  doctor,
  projectInfo,
  buildUpstreamDependencyReport,
  findUp: findUp3,
  readJsonFile: async (filePath) => JSON.parse(await readFile17(filePath, "utf8")),
  joinPath: (...parts) => path11.join(...parts),
  pathExists: async (filePath) => access5(filePath).then(() => true, () => false),
  firstExisting: async (projectRoot, names) => {
    for (const name of names) {
      const candidate = path11.join(projectRoot, name);
      if (await access5(candidate).then(() => true, () => false)) return candidate;
    }
    return null;
  },
  readTextFile: (filePath) => readFile17(filePath, "utf8")
};
async function expoModuleRecords(projectRoot, deps) {
  const packageJsonPath = await deps.findUp(projectRoot, "package.json");
  const packageJson = packageJsonPath ? asRecord17(await deps.readJsonFile(packageJsonPath)) ?? {} : {};
  const allDeps = {
    ...asRecord17(packageJson.dependencies),
    ...asRecord17(packageJson.devDependencies)
  };
  return Object.entries(allDeps).filter(([name]) => isExpoRelatedPackage(name)).sort(([left], [right]) => left.localeCompare(right)).map(([name, version]) => ({
    name,
    version,
    category: expoModuleCategory(name)
  }));
}
function isExpoRelatedPackage(name) {
  return name === "expo" || name.startsWith("expo-") || name.startsWith("@expo/") || name.startsWith("@config-plugins/") || name.includes("config-plugin");
}
function expoModuleCategory(name) {
  if (name.startsWith("@config-plugins/") || name.includes("config-plugin")) return "config-plugin";
  if (name === "expo" || name.startsWith("expo-") || name.startsWith("@expo/")) return "expo";
  return "other";
}
async function expoPrebuildRisks(projectRoot, modules, deps) {
  const risks = [];
  for (const platformDir of ["ios", "android"]) {
    if (await deps.pathExists(deps.joinPath(projectRoot, platformDir))) {
      risks.push({
        kind: "native-project-present",
        platform: platformDir,
        severity: "high",
        message: `${platformDir} native project exists; config and native module changes may require a rebuild.`
      });
    }
  }
  for (const module of modules.filter((item) => item.category === "config-plugin")) {
    risks.push({
      kind: "config-plugin",
      package: module.name,
      severity: "medium",
      message: "Config-plugin dependency can affect native prebuild output."
    });
  }
  for (const plugin of await readExpoAppConfigPlugins(projectRoot, deps)) {
    risks.push({
      kind: "app-config-plugin",
      plugin,
      severity: "medium",
      message: "App config plugin can affect native prebuild output."
    });
  }
  return risks;
}
async function readExpoAppConfigPlugins(projectRoot, deps) {
  const appJsonPath = deps.joinPath(projectRoot, "app.json");
  if (await deps.pathExists(appJsonPath)) {
    const appJson = asRecord17(await deps.readJsonFile(appJsonPath));
    const expoConfig = asRecord17(appJson?.expo);
    const plugins = expoConfig?.plugins ?? appJson?.plugins ?? [];
    return Array.isArray(plugins) ? plugins.map(formatExpoPluginEntry) : [];
  }
  const configPath = await deps.firstExisting(projectRoot, ["app.config.ts", "app.config.js", "app.config.mjs", "app.config.cjs"]);
  if (!configPath) return [];
  const text = await deps.readTextFile(configPath);
  const match = /\bplugins\s*:\s*\[([\s\S]*?)\]/m.exec(text);
  if (!match) return [];
  return [...match[1].matchAll(/["'`]([^"'`]+)["'`]/g)].map((item) => item[1]);
}
function formatExpoPluginEntry(entry) {
  if (typeof entry === "string") return entry;
  if (Array.isArray(entry)) return String(entry[0] ?? "");
  return JSON.stringify(entry);
}
function expoConfigLimitations(summary) {
  return summary.appConfig?.dynamic ? ["Dynamic Expo config was summarized with static string extraction and may omit computed values."] : ["Expo config is summarized from project files; native runtime overrides are not included."];
}
function expoPrebuildRiskLevel(risks) {
  if (risks.some((risk) => risk.kind === "native-project-present")) return "high";
  return risks.length > 0 ? "medium" : "low";
}
function requireString20(value, field) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${field} must be a non-empty string.`);
  }
  return value.trim();
}
function isExpoAction(action) {
  return EXPO_ACTIONS.includes(action);
}
function asRecord17(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : null;
}
async function defaultNormalizeProjectCwd3(cwd) {
  const resolved = path11.resolve(cwd ?? ".");
  const details = await stat7(resolved).catch(() => null);
  if (!details?.isDirectory()) throw new Error(`Directory does not exist: ${resolved}`);
  return resolved;
}
async function findUp3(projectRoot, filename) {
  let current = path11.resolve(projectRoot);
  while (true) {
    const candidate = path11.join(current, filename);
    if (await access5(candidate).then(() => true, () => false)) return candidate;
    const parent = path11.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

// src/modules/rn-introspection/src/main/index.ts
import { readdir as readdir12, readFile as readFile18 } from "node:fs/promises";
import { basename as basename9, join as join14, resolve as resolve9 } from "node:path";
function toolJson28(value) {
  return { content: [{ type: "text", text: `${JSON.stringify(value, null, 2)}
` }] };
}
async function rnCommand(args = {}, deps = defaultRnDependencies) {
  const positionals = Array.isArray(args._) ? args._ : [];
  const action = requireString21(args.action ?? positionals[0] ?? "tree", "action");
  if (!["tree", "inspect", "renders", "fiber"].includes(action)) throw new Error(`Unknown React Native action: ${action}`);
  if (action === "inspect") return toolJson28(await rnInspectPayload(args, deps));
  const subaction = action === "renders" ? requireString21(args.subaction ?? positionals[1] ?? "read", "subaction") : null;
  if (subaction && !["start", "stop", "read"].includes(subaction)) throw new Error(`Unknown React Native renders action: ${subaction}`);
  const bridgeAction = action === "renders" ? `renders-${subaction}` : action;
  const bridgePayload = await deps.bridgeDomainCommand({
    args,
    domain: "rn",
    action: bridgeAction,
    expression: rnExpression({ action: bridgeAction, ref: args.ref, depth: args.depth, limit: args.limit }),
    policy: {
      checked: true,
      action: `rn.${bridgeAction}`,
      sideEffect: "read",
      allowed: true,
      reason: "React Native introspection is read-only."
    }
  });
  const outputPayload = action === "tree" && !wantsRawOutput(args) ? summarizeRnTreePayload(bridgePayload) : bridgePayload;
  return toolJson28({
    ...outputPayload,
    action,
    ...subaction ? { subaction, bridgeAction } : {},
    limitations: rnLimitations(outputPayload.limitations)
  });
}
var defaultRnDependencies = {
  bridgeDomainCommand: defaultBridgeDomainCommand
};
async function defaultBridgeDomainCommand(request) {
  return bridgeDomainCommand(request);
}
async function rnInspectPayload(args = {}, deps = {}) {
  const positionals = Array.isArray(args._) ? args._ : [];
  const ref = requireString21(args.ref ?? positionals[1] ?? positionals[0], "ref");
  const cache = await readLatestRefCache7(args, deps);
  if (!cache) {
    return {
      available: false,
      action: "inspect",
      ref,
      sources: ["snapshot-cache"],
      reason: "No snapshot exists for the current session.",
      limitations: rnLimitations()
    };
  }
  const record = (cache.refs ?? []).find((item) => item.ref === ref);
  if (!record) {
    return {
      available: false,
      action: "inspect",
      ref,
      sources: ["native-accessibility", "snapshot-cache"],
      reason: "Ref not found in the latest snapshot.",
      snapshotId: cache.snapshotId,
      targetId: cache.targetId,
      limitations: rnLimitations()
    };
  }
  return {
    available: true,
    action: "inspect",
    ref,
    sources: ["native-accessibility", "snapshot-cache"],
    snapshotId: cache.snapshotId,
    targetId: cache.targetId,
    record,
    limitations: rnLimitations([
      "Inspect uses cached semantic/native accessibility evidence and does not expose private fiber internals."
    ])
  };
}
function rnExpression({ action, ref, depth, limit }) {
  return `(() => {
    const action = ${JSON.stringify(action)};
    const ref = ${JSON.stringify(ref ?? null)};
    const maxDepth = Math.max(1, Math.min(Number(${JSON.stringify(depth ?? 30)}) || 30, 80));
    const maxNodes = Math.max(1, Math.min(Number(${JSON.stringify(limit ?? 500)}) || 500, 2000));
    const bridge = globalThis.__EXPO_IOS_RN_BRIDGE__ ||
      (globalThis.__EXPO_IOS_INSTRUMENTATION__ && globalThis.__EXPO_IOS_INSTRUMENTATION__.rn);
    const bridgeTree = () => bridge && bridge.tree ? bridge.tree() : bridge ? { available: true, sources: ['runtime', 'app-instrumentation'], action, tree: bridge.tree || [] } : null;
    const isRouterShellOnly = (payload) => {
      const tree = payload && Array.isArray(payload.tree) ? payload.tree : [];
      if (tree.length !== 1) return false;
      const root = tree[0] || {};
      const children = Array.isArray(root.children) ? root.children : [];
      return String(root.name || '') === 'RootLayout' && children.length === 1 && String(children[0]?.name || '') === 'ExpoRouterStack';
    };
    const tagName = (tag) => ({
      0: 'FunctionComponent',
      1: 'ClassComponent',
      3: 'HostRoot',
      5: 'HostComponent',
      6: 'HostText',
      7: 'Fragment',
      9: 'ContextConsumer',
      10: 'ContextProvider',
      11: 'ForwardRef',
      13: 'Suspense',
      14: 'MemoComponent',
      15: 'SimpleMemoComponent',
      22: 'Offscreen',
    })[tag] || 'Fiber';
    const componentName = (fiber) => {
      const type = fiber && (fiber.elementType || fiber.type);
      if (typeof type === 'string') return type;
      if (typeof type === 'function') return type.displayName || type.name || tagName(fiber.tag);
      if (type && typeof type === 'object') {
        if (typeof type.displayName === 'string') return type.displayName;
        if (typeof type.name === 'string') return type.name;
        if (type.render) return type.render.displayName || type.render.name || 'ForwardRef';
        if (type.type) {
          const nested = type.type;
          if (typeof nested === 'function') return nested.displayName || nested.name || tagName(fiber.tag);
          if (typeof nested === 'string') return nested;
          if (nested && typeof nested.displayName === 'string') return nested.displayName;
        }
      }
      return tagName(fiber && fiber.tag);
    };
    const textFromProps = (props) => {
      if (typeof props === 'string' || typeof props === 'number') return String(props);
      if (!props || typeof props !== 'object') return null;
      const children = props.children;
      if (typeof children === 'string' || typeof children === 'number') return String(children);
      if (Array.isArray(children)) {
        const text = children.filter((item) => typeof item === 'string' || typeof item === 'number').join('');
        return text || null;
      }
      return null;
    };
    const compactProps = (fiber) => {
      const props = fiber && fiber.memoizedProps && typeof fiber.memoizedProps === 'object' ? fiber.memoizedProps : {};
      const out = {};
      for (const key of ['testID', 'testId', 'nativeID', 'accessibilityLabel', 'accessibilityRole', 'accessibilityHint', 'placeholder', 'placeholderText', 'href', 'disabled']) {
        const value = props[key];
        if (value == null) continue;
        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') out[key] = value;
      }
      const text = textFromProps(props);
      if (text) out.text = text;
      return out;
    };
    const sourceFromFiber = (fiber) => {
      const source = fiber && fiber._debugSource;
      if (!source || typeof source !== 'object') return null;
      return {
        fileName: source.fileName || null,
        lineNumber: source.lineNumber || null,
        columnNumber: source.columnNumber || null,
      };
    };
    const serializeFiberTree = () => {
      const hook = globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__;
      if (!hook || typeof hook.getFiberRoots !== 'function' || !hook.renderers) {
        return { available: false, source: 'react-devtools-hook', reason: 'React DevTools fiber roots are not available.', action };
      }
      const roots = [];
      for (const rendererId of Array.from(hook.renderers.keys())) {
        for (const root of Array.from(hook.getFiberRoots(rendererId) || [])) roots.push({ rendererId, root });
      }
      let nodeCount = 0;
      const seen = new Set();
      const walk = (fiber, depth) => {
        if (!fiber || seen.has(fiber) || depth > maxDepth || nodeCount >= maxNodes) return null;
        seen.add(fiber);
        nodeCount += 1;
        const children = [];
        let child = fiber.child;
        while (child && nodeCount < maxNodes) {
          const serialized = walk(child, depth + 1);
          if (serialized) children.push(serialized);
          child = child.sibling;
        }
        const props = compactProps(fiber);
        const node = {
          name: componentName(fiber),
          tag: tagName(fiber.tag),
          key: fiber.key == null ? null : String(fiber.key),
          props: Object.keys(props).length ? props : undefined,
          source: sourceFromFiber(fiber),
          children,
        };
        if (!node.source) delete node.source;
        if (!node.children.length) delete node.children;
        return node;
      };
      const tree = roots.map(({ rendererId, root }) => {
        const current = root && root.current;
        const node = walk(current, 0);
        return node ? { rendererId, ...node } : null;
      }).filter(Boolean);
      return {
        available: tree.length > 0,
        action,
        source: 'react-devtools-hook',
        sources: ['runtime', 'react-devtools-hook'],
        tree,
        rootCount: roots.length,
        nodeCount,
        truncated: nodeCount >= maxNodes,
        limits: { maxDepth, maxNodes },
        bridgeTree: null,
      };
    };
    if (action === 'tree') {
      const payload = bridgeTree();
      const fiberPayload = serializeFiberTree();
      if (fiberPayload.available && (!payload || isRouterShellOnly(payload))) return { ...fiberPayload, bridgeTree: payload };
      if (payload) return payload;
      return fiberPayload;
    }
    if (!bridge) return { available: false, sources: ['runtime', 'app-instrumentation'], source: 'app-instrumentation', reason: 'React Native bridge is not installed.', action };
    if (action === 'fiber') return bridge.fiber ? bridge.fiber(ref) : { available: false, sources: ['runtime', 'app-instrumentation'], action, ref, reason: 'Fiber inspection is not exposed by the app bridge.' };
    if (action === 'renders-start') return bridge.renders && bridge.renders.start ? bridge.renders.start() : { available: true, sources: ['runtime', 'app-instrumentation'], action, renders: { recording: true } };
    if (action === 'renders-stop') return bridge.renders && bridge.renders.stop ? bridge.renders.stop() : { available: true, sources: ['runtime', 'app-instrumentation'], action, renders: { recording: false } };
    if (action === 'renders-read') return bridge.renders && bridge.renders.read ? bridge.renders.read() : { available: true, sources: ['runtime', 'app-instrumentation'], action, renders: { recording: false, commits: [] } };
    return { available: false, sources: ['runtime', 'app-instrumentation'], source: 'app-instrumentation', reason: 'Unsupported React Native bridge action.', action };
  })()`;
}
function rnLimitations(extra = []) {
  return [
    ...extra.map(String),
    "private React Native hooks and fiber fields are version-dependent and may be incomplete or unavailable."
  ];
}
async function readLatestRefCache7(args = {}, deps = {}) {
  if (deps.readLatestRefCache) return deps.readLatestRefCache(args);
  const stateRoot = resolveExpoStateRoot9(args);
  const session = await readLatestSession8(stateRoot);
  if (!session?.lastSnapshotId) return null;
  return readJsonFile11(join14(sessionDirectory5(stateRoot, String(session.sessionId)), "refs.json")).catch(() => null);
}
async function readLatestSession8(stateRoot) {
  const sessionsRoot = join14(stateRoot, "sessions");
  const entries = await readdir12(sessionsRoot, { withFileTypes: true }).catch(() => []);
  const sessions = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const record = await readJsonFile11(join14(sessionsRoot, entry.name, "session.json")).catch(() => null);
    if (record) sessions.push(record);
  }
  sessions.sort((a, b) => String(asRecord18(b)?.updatedAt ?? asRecord18(b)?.createdAt).localeCompare(String(asRecord18(a)?.updatedAt ?? asRecord18(a)?.createdAt)));
  return asRecord18(sessions[0]);
}
function resolveExpoStateRoot9(args = {}) {
  if (args.stateDir) {
    const resolved = resolve9(args.stateDir);
    return basename9(resolved) === "runs" ? resolve9(join14(resolved, "..")) : resolved;
  }
  const root = resolve9(args.root ?? args.cwd ?? process.cwd());
  return join14(root, ".scratch", "expo-ios");
}
function sessionDirectory5(stateRoot, sessionId) {
  return join14(stateRoot, "sessions", sessionId);
}
async function readJsonFile11(file) {
  return JSON.parse(await readFile18(file, "utf8"));
}
function requireString21(value, name) {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${name} must be a non-empty string.`);
  return value.trim();
}
function asRecord18(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}
function wantsRawOutput(args) {
  return args.raw === true || args.detail === "raw" || args.detail === "full";
}
function summarizeRnTreePayload(payload) {
  if (payload.available === false) return payload;
  const tree = Array.isArray(payload.tree) ? payload.tree : [];
  const elements = Array.isArray(payload.elements) ? payload.elements : [];
  const target = compactTarget(payload.target);
  const viewport = asRecord18(payload.viewport);
  const structure = compactStructure(tree, elements);
  const visibleText = visibleTextRecords(elements);
  const controls = controlRecords(elements, visibleText);
  const componentPath = inferComponentPath(tree, elements);
  return {
    available: payload.available !== false,
    source: payload.source,
    sources: payload.sources,
    evidenceSource: payload.evidenceSource,
    domain: payload.domain,
    action: payload.action,
    route: payload.route ?? payload.routeHint ?? null,
    screen: {
      route: componentPath.find((name) => /^Route\(/.test(name)) ?? null,
      component: componentPath.find((name) => /Route\(|Layout|Screen|SignIn|Schedule|Console/.test(name)) ?? null,
      path: componentPath
    },
    counts: {
      sampledElements: numberOrNull2(payload.elementCount) ?? (elements.length || null),
      relevantNodes: countRelevantNodes(structure),
      visibleText: visibleText.length,
      controls: controls.length,
      rawTreeRoots: tree.length || null
    },
    viewport: viewport ? pickDefined4({
      width: viewport.width,
      height: viewport.height,
      scale: viewport.scale,
      fontScale: viewport.fontScale
    }) : null,
    target,
    structure,
    visibleText,
    controls,
    rawAvailable: true,
    rawHint: "Rerun rn tree with --raw true for full component stacks, CDP transport, and unpruned trees.",
    limitations: [
      "Output is pruned for agent relevance; infrastructure wrappers, native host views, component stacks, and transport internals are omitted by default.",
      ...arrayOfStrings(payload.limitations)
    ]
  };
}
function compactTarget(value) {
  const target = asRecord18(value);
  if (!target) return null;
  return pickDefined4({
    appId: target.appId,
    deviceName: target.deviceName,
    title: target.title
  });
}
function compactStructure(tree, elements) {
  const fromTree = flattenTreeResults(tree.flatMap((node) => simplifyTreeNode(node, 0)));
  if (fromTree.length > 0) return fromTree.slice(0, 80);
  return pathTreeFromElements(elements);
}
function simplifyTreeNode(value, depth) {
  if (depth > 60) return [];
  const node = asRecord18(value);
  if (!node) return [];
  const name = nodeName(node);
  const element = asRecord18(node.element);
  const children = Array.isArray(node.children) ? node.children.flatMap((child) => simplifyTreeNode(child, depth + 1)) : [];
  const details = elementDetails(element ?? node);
  const meaningful = isRelevantName(name) || Object.keys(details).length > 0;
  if (!meaningful) return children;
  return [pickDefined4({
    component: name,
    ...details,
    children: children.length > 0 ? children : void 0
  })];
}
function flattenTreeResults(nodes) {
  const compacted = [];
  for (const node of nodes) {
    const children = Array.isArray(node.children) ? flattenTreeResults(node.children) : [];
    compacted.push({ ...node, ...children.length > 0 ? { children } : {} });
  }
  return compacted;
}
function pathTreeFromElements(elements) {
  const root = { component: "root", children: /* @__PURE__ */ new Map() };
  for (const element of elements) {
    const path12 = relevantPathFromElement(element);
    if (path12.length === 0) continue;
    let cursor = root;
    for (const name of path12) {
      let child = cursor.children.get(name);
      if (!child) {
        child = { component: name, children: /* @__PURE__ */ new Map() };
        cursor.children.set(name, child);
      }
      cursor = child;
    }
    const details = elementDetails(element);
    Object.assign(cursor, details);
  }
  return [...root.children.values()].map(pathNodeToRecord);
}
function pathNodeToRecord(node) {
  const children = [...node.children.values()].map(pathNodeToRecord);
  return pickDefined4({
    component: node.component,
    label: node.label,
    role: node.role,
    testID: node.testID,
    box: node.box,
    children: children.length > 0 ? children : void 0
  });
}
function visibleTextRecords(elements) {
  const records = [];
  const seen = /* @__PURE__ */ new Set();
  for (const element of elements) {
    const label = optionalNonemptyString(element.label ?? asRecord18(element.element)?.label);
    if (!label || seen.has(label)) continue;
    const name = optionalNonemptyString(element.name ?? asRecord18(element.element)?.name);
    const role = optionalNonemptyString(element.role ?? asRecord18(element.element)?.role);
    const testID = optionalNonemptyString(element.testID ?? asRecord18(element.element)?.testID);
    if (role || testID || name === "Text" || name === "RCTText" || label.length > 1) {
      seen.add(label);
      records.push(pickDefined4({
        text: label,
        component: name,
        path: relevantPathFromElement(element),
        box: boxFromFrame(element.frame ?? asRecord18(element.element)?.frame)
      }));
    }
  }
  return records.slice(0, 80);
}
function controlRecords(elements, textRecords) {
  const controls = [];
  for (const element of elements) {
    const elementRecord = asRecord18(element.element) ?? element;
    const role = optionalNonemptyString(element.role ?? elementRecord.role);
    const testID = optionalNonemptyString(element.testID ?? elementRecord.testID);
    const name = optionalNonemptyString(element.name ?? elementRecord.name);
    const isInput = /TextInput|Input/i.test(String(name));
    if (!role && !testID && !isInput) continue;
    const box = boxFromFrame(element.frame ?? elementRecord.frame);
    const inferredLabel = optionalNonemptyString(element.label ?? elementRecord.label) ?? inferControlLabel(box, textRecords);
    controls.push(pickDefined4({
      type: isInput ? "input" : role ?? "control",
      label: inferredLabel,
      testID,
      component: name,
      path: relevantPathFromElement(element),
      box
    }));
  }
  return controls.slice(0, 60);
}
function inferControlLabel(box, textRecords) {
  if (!box) return void 0;
  for (const record of textRecords) {
    const textBox = asRecord18(record.box);
    if (!textBox) continue;
    const centerX = Number(textBox.x) + Number(textBox.width) / 2;
    const centerY = Number(textBox.y) + Number(textBox.height) / 2;
    if (centerX >= box.x && centerX <= box.x + box.width && centerY >= box.y && centerY <= box.y + box.height) {
      return String(record.text);
    }
  }
  return void 0;
}
function inferComponentPath(tree, elements) {
  for (const element of elements) {
    const path13 = relevantPathFromElement(element).filter((name) => !["Text", "View", "Pressable", "SymbolModule"].includes(name));
    if (path13.length > 0) return path13.slice(0, 16);
  }
  const path12 = [];
  let cursor = asRecord18(tree[0]);
  let depth = 0;
  while (cursor && depth < 40) {
    const name = nodeName(cursor);
    if (isRelevantName(name)) path12.push(name);
    const child = Array.isArray(cursor.children) ? asRecord18(cursor.children[0]) : null;
    cursor = child;
    depth += 1;
  }
  return unique(path12).slice(0, 16);
}
function relevantPathFromElement(element) {
  const hierarchy = Array.isArray(element.hierarchy) ? element.hierarchy : [];
  const path12 = hierarchy.map((item) => nodeName(item)).filter((name) => Boolean(name && isRelevantName(name)));
  const elementName = optionalNonemptyString(element.name);
  if (elementName && isRelevantName(elementName)) path12.push(elementName);
  return unique(path12).slice(0, 24);
}
function nodeName(value) {
  const record = asRecord18(value);
  return optionalNonemptyString(record?.name ?? record?.component);
}
function isRelevantName(name) {
  if (!name) return false;
  if (/^RCT|^RNC|^RNS|ViewManagerAdapter|HostRoot|HostComponent|HostText/.test(name)) return false;
  if (WRAPPER_NAMES.has(name)) return false;
  if (/^(Screen|ScreenStack|ScreenStackItem|InnerScreen|Suspender|Freeze|DelayedFreeze)$/.test(name)) return false;
  if (/^(View|Animated\(View\)|ScrollView|Text)$/.test(name)) return false;
  return true;
}
var WRAPPER_NAMES = /* @__PURE__ */ new Set([
  "withDevTools(App)",
  "App",
  "ExpoRoot",
  "ContextNavigator",
  "Content",
  "SceneView",
  "WrappedScreenComponent",
  "Anonymous",
  "anonymous",
  "ForwardRef",
  "StaticContainer",
  "EnsureSingleNavigator",
  "NavigationProvider",
  "PreventRemoveProvider",
  "NavigationStateListenerProvider",
  "NavigationContent",
  "BaseNavigationContainer",
  "NavigationContainerInner",
  "ThemeProvider",
  "SafeAreaProvider",
  "SafeAreaProviderCompat",
  "RNCSafeAreaProvider",
  "RNSSafeAreaView",
  "NativeStackNavigator",
  "Screen"
]);
function elementDetails(element) {
  const label = optionalNonemptyString(element.label);
  const text = optionalNonemptyString(element.text);
  const role = optionalNonemptyString(element.role);
  const testID = optionalNonemptyString(element.testID);
  const box = boxFromFrame(element.frame ?? element.box);
  const actions = Array.isArray(element.actions) && element.actions.length > 0 ? element.actions.map(String).slice(0, 10) : void 0;
  return pickDefined4({ label, text, role, testID, box, actions });
}
function boxFromFrame(value) {
  const frame = asRecord18(value);
  if (!frame) return void 0;
  const x = numberOrNull2(frame.x ?? frame.left);
  const y = numberOrNull2(frame.y ?? frame.top);
  const width = numberOrNull2(frame.width);
  const height = numberOrNull2(frame.height);
  if (x == null || y == null || width == null || height == null) return void 0;
  return { x: round(x), y: round(y), width: round(width), height: round(height) };
}
function countRelevantNodes(nodes) {
  let count = 0;
  for (const node of nodes) {
    count += 1;
    if (Array.isArray(node.children)) count += countRelevantNodes(node.children);
  }
  return count;
}
function arrayOfStrings(value) {
  return Array.isArray(value) ? value.map(String) : [];
}
function optionalNonemptyString(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : void 0;
}
function numberOrNull2(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
function round(value) {
  return Math.round(value * 100) / 100;
}
function unique(values) {
  const seen = /* @__PURE__ */ new Set();
  return values.filter((value) => {
    if (seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}
function pickDefined4(record) {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== void 0));
}

// src/modules/perf-evidence/src/main/index.ts
import { mkdir as fsMkdir2, readFile as readFile19, stat as fsStat, writeFile as fsWriteFile2 } from "node:fs/promises";
import { basename as basename10, dirname as dirname7, join as join15, resolve as resolve10 } from "node:path";
var EXPO_IOS_BRIDGE_VERSION5 = "1.0.0";
var PERF_ACTIONS = ["summary", "startup", "action", "bundle", "mark", "measure", "compare", "budget", "js-thread", "frames", "memory", "ettrace", "memgraph"];
function toolJson29(value) {
  return { content: [{ type: "text", text: `${JSON.stringify(value, null, 2)}
` }] };
}
async function perfCommand(args = {}, deps = {}) {
  const action = requireString22(args.action ?? firstPositional2(args) ?? "summary", "action");
  if (!PERF_ACTIONS.includes(action)) throw new Error(`Unknown performance action: ${action}`);
  if (action === "summary") return toolJson29(await perfSummaryPayload(args, deps));
  if (action === "bundle") return toolJson29(await perfBundlePayload(args, deps));
  if (action === "compare") return toolJson29(await perfComparePayload(args, deps));
  if (action === "budget") return toolJson29(await perfBudgetPayload(args, deps));
  if (action === "memory") return toolJson29(await perfMemoryPayload(args, deps));
  if (action === "ettrace" || action === "memgraph") return toolJson29(await perfNativeProfilerPayload(args, action, deps));
  if (["mark", "measure", "js-thread", "frames"].includes(action)) return toolJson29(await perfInstrumentedPayload(args, action, deps));
  return toolJson29(await perfRuntimePayload(args, action, deps));
}
async function perfSummaryPayload(args = {}, deps = {}) {
  const cwd = await projectCwd(args.cwd, deps);
  const summary = await projectSummary(cwd, deps);
  const metroPort = clampNumber22(args.metroPort ?? 8081, 1, 65535);
  const metro = await metroStatus2({ metroPort }, deps);
  const metrics = [];
  const unavailableSources = [];
  const packageJsonPath = await findUpFile(summary.projectRoot, "package.json", deps);
  if (packageJsonPath) {
    const packageJson = await readJson6(packageJsonPath, deps);
    metrics.push(perfMetric({
      name: "project.dependencies",
      value: Object.keys({ ...packageJson.dependencies ?? {}, ...packageJson.devDependencies ?? {} }).length,
      unit: "count",
      source: "project",
      confidence: "low"
    }));
  } else {
    unavailableSources.push({ source: "project", reason: "No package.json found." });
  }
  if (metro.available) {
    metrics.push(perfMetric({
      name: "metro.targets",
      value: metro.targetCount,
      unit: "count",
      source: "metro",
      confidence: "medium"
    }));
  } else {
    unavailableSources.push({ source: "metro", reason: metro.reason });
  }
  const capabilities = [
    { source: "plugin-bridge-performance", available: metro.targets?.some((target) => target.capabilities?.hermesRuntime) === true, type: "upstream-plugin", confidence: "medium" },
    { source: "expo-devtools-performance", available: metro.available === true, type: "upstream-devtools", confidence: "low" },
    { source: "native-profiler", available: true, type: "native-fallback", confidence: "high" },
    { source: "bundle-artifact", available: false, type: "static-fallback", confidence: "high" }
  ];
  unavailableSources.push({ source: "plugin-bridge-performance", reason: "Run perf startup/action/mark against an app with the performance bridge domain registered." });
  unavailableSources.push({ source: "expo-devtools-performance", reason: "No machine-readable Expo DevTools performance domain was confirmed." });
  unavailableSources.push({ source: "bundle-artifact", reason: "Pass an existing bundle artifact to perf bundle for byte evidence." });
  return {
    available: true,
    action: "summary",
    mode: "development",
    sources: ["project", "metro"],
    capabilities,
    confidence: perfOverallConfidence(metrics),
    context: await perfContext({ args, projectRoot: summary.projectRoot, metro }),
    metrics,
    unavailableSources,
    limitations: perfDevelopmentLimitations(["Summary reports evidence availability and lightweight signals; it is not a performance score."])
  };
}
async function perfRuntimePayload(args = {}, action, deps = {}) {
  const metroPort = clampNumber22(args.metroPort ?? 8081, 1, 65535);
  const targets = await listMetroTargets(metroPort, deps);
  const target = targets[0] ?? null;
  const projectRoot = await projectCwd(args.cwd, deps);
  const metro = target ? { available: true, metroPort, status: "available", statusText: null, targetCount: targets.length, targets: targets.map(targetSummary9) } : await metroStatus2({ metroPort }, deps);
  let bridgePayload = null;
  if (target?.webSocketDebuggerUrl) {
    const result = await evaluateHermes(String(target.webSocketDebuggerUrl), perfExpression({ action, label: args.label }), deps);
    bridgePayload = result?.result?.result?.value ?? null;
  }
  const basePayload = bridgePayload && typeof bridgePayload === "object" ? normalizePerfBridgePayload(redactValue8(bridgePayload), action) : {
    available: false,
    sources: ["runtime", "app-instrumentation"],
    metrics: [],
    code: target ? "malformed-payload" : "no-runtime-target",
    reason: target ? "Performance bridge did not return a value." : "No Metro inspector target."
  };
  const payload = {
    ...basePayload,
    action,
    ...action === "action" ? { actionName: requireString22(args.label, "label") } : {},
    mode: "development",
    context: await perfContext({ args, projectRoot, metro, target }),
    transport: perfTransport(metroPort, target, null),
    evidenceSource: perfEvidenceSource(basePayload),
    confidence: perfOverallConfidence(basePayload.metrics ?? []),
    limitations: perfDevelopmentLimitations(basePayload.limitations)
  };
  return writePerfArtifact(args, action, payload, deps);
}
async function perfInstrumentedPayload(args = {}, action, deps = {}) {
  const subaction = requireOptionalString9(args.subaction);
  const label = requireOptionalString9(args.label);
  const bridgeAction = perfBridgeAction(action, subaction);
  const metroPort = clampNumber22(args.metroPort ?? 8081, 1, 65535);
  const targets = await listMetroTargets(metroPort, deps);
  const target = targets[0] ?? null;
  const projectRoot = await projectCwd(args.cwd, deps);
  const metro = target ? { available: true, metroPort, status: "available", targetCount: targets.length, targets: targets.map(targetSummary9) } : await metroStatus2({ metroPort }, deps);
  let bridgePayload = null;
  if (target?.webSocketDebuggerUrl) {
    const result = await evaluateHermes(String(target.webSocketDebuggerUrl), perfExpression({ action: bridgeAction, label }), deps);
    bridgePayload = result?.result?.result?.value ?? null;
  }
  const basePayload = bridgePayload && typeof bridgePayload === "object" ? normalizePerfBridgePayload(redactValue8(bridgePayload), action) : {
    available: false,
    sources: ["runtime", "app-instrumentation"],
    metrics: [],
    code: target ? "malformed-payload" : "no-runtime-target",
    reason: target ? "Performance bridge did not return a value." : "No Metro inspector target."
  };
  return writePerfArtifact(args, action, {
    ...basePayload,
    action,
    subaction,
    bridgeAction,
    mode: "development",
    context: await perfContext({ args, projectRoot, metro, target }),
    transport: perfTransport(metroPort, target, null),
    evidenceSource: perfEvidenceSource(basePayload),
    confidence: perfOverallConfidence(basePayload.metrics ?? []),
    limitations: perfDevelopmentLimitations(basePayload.limitations)
  }, deps);
}
function perfBridgeAction(action, subaction) {
  if (action === "mark") return `mark-${subaction ?? "list"}`;
  if (action === "measure") return `measure-${subaction ?? "start"}`;
  return action;
}
async function perfComparePayload(args = {}, deps = {}) {
  const baselinePath = resolve10(requireString22(args.baseline, "baseline"));
  const candidatePath = resolve10(requireString22(args.candidate, "candidate"));
  const baseline = await readJson6(baselinePath, deps);
  const candidate = await readJson6(candidatePath, deps);
  const candidateMetrics = metricMap(candidate.metrics ?? []);
  const deltas = [];
  for (const metric of baseline.metrics ?? []) {
    const next = candidateMetrics.get(metric.name);
    if (!next || typeof metric.value !== "number" || typeof next.value !== "number") continue;
    deltas.push({
      metric: metric.name,
      baseline: metric.value,
      candidate: next.value,
      delta: next.value - metric.value,
      unit: next.unit ?? metric.unit,
      improved: next.value <= metric.value,
      confidence: lowerConfidence(metric.confidence, next.confidence)
    });
  }
  return writePerfArtifact(args, "compare", {
    available: true,
    action: "compare",
    sources: ["artifact"],
    baseline: baselinePath,
    candidate: candidatePath,
    deltas,
    confidence: perfOverallConfidence(deltas.map((delta) => ({ confidence: delta.confidence }))),
    limitations: ["Comparison uses only matching metric names and does not infer user impact without workflow context."]
  }, deps);
}
async function perfBudgetPayload(args = {}, deps = {}) {
  const subaction = requireString22(args.subaction ?? "check", "subaction");
  if (subaction !== "check") throw new Error(`Unknown performance budget action: ${subaction}`);
  const budgetPath = resolve10(requireString22(args.file, "file"));
  const candidatePath = resolve10(requireString22(args.candidate, "candidate"));
  const budget = await readJson6(budgetPath, deps);
  const candidate = await readJson6(candidatePath, deps);
  const metrics = metricMap(candidate.metrics ?? []);
  const checks = (budget.budgets ?? []).map((rule) => {
    const metric = metrics.get(rule.metric);
    const value = metric?.value ?? null;
    const passed = typeof value === "number" && (typeof rule.max !== "number" || value <= rule.max) && (typeof rule.min !== "number" || value >= rule.min);
    return { metric: rule.metric, value, min: rule.min ?? null, max: rule.max ?? null, passed, unit: metric?.unit ?? null };
  });
  return writePerfArtifact(args, "budget", {
    available: true,
    action: "budget",
    subaction,
    sources: ["artifact"],
    file: budgetPath,
    candidate: candidatePath,
    passed: checks.every((check) => check.passed),
    checks,
    limitations: ["Budget checks compare numeric metrics only; choose budgets that match build mode and device context."]
  }, deps);
}
async function perfMemoryPayload(args = {}, deps = {}) {
  const samples = clampNumber22(args.samples ?? 1, 1, 100);
  const nativeArtifact = requireOptionalString9(args.nativeArtifact);
  const projectRoot = await projectCwd(args.cwd, deps);
  const metrics = [perfMetric({
    name: "memory.samples",
    value: samples,
    unit: "count",
    source: nativeArtifact ? "memgraph" : "simulator",
    confidence: samples >= 2 || nativeArtifact ? "medium" : "low"
  })];
  const leakAllowed = samples >= 2 || Boolean(nativeArtifact);
  return writePerfArtifact(args, "memory", {
    available: true,
    action: "memory",
    mode: "development",
    sources: nativeArtifact ? ["native-profiler", "memgraph"] : ["simulator"],
    metrics,
    context: await perfContext({ args, projectRoot, metro: null }),
    leakClaim: {
      allowed: leakAllowed,
      reason: leakAllowed ? "Repeated measurements or native artifacts are present." : "Repeated measurements or a native memgraph artifact are required before making a memory-leak claim."
    },
    nativeArtifact: nativeArtifact ? resolve10(nativeArtifact) : null,
    confidence: perfOverallConfidence(metrics),
    limitations: perfDevelopmentLimitations(["A single memory sample is only a hint, not leak evidence."])
  }, deps);
}
async function perfNativeProfilerPayload(args = {}, profiler, deps = {}) {
  const subaction = requireString22(args.subaction ?? (profiler === "memgraph" ? "capture" : "stop"), "subaction");
  const allowed = profiler === "ettrace" ? ["start", "stop"] : ["capture"];
  if (!allowed.includes(subaction)) throw new Error(`Unknown ${profiler} action: ${subaction}`);
  const defaultName = profiler === "ettrace" ? "capture.trace" : "heap.memgraph";
  const nativeArtifact = resolve10(args.nativeArtifact ?? join15(resolveExpoStateRoot10(args), "artifacts", "perf", defaultName));
  await (deps.mkdir ?? fsMkdir2)(dirname7(nativeArtifact), { recursive: true });
  if (subaction !== "start" && !await exists(nativeArtifact, deps)) {
    await (deps.writeFile ?? fsWriteFile2)(nativeArtifact, `${profiler} placeholder
`, "utf8");
  }
  const projectRoot = await projectCwd(args.cwd, deps);
  return writePerfArtifact(args, profiler, {
    available: true,
    action: profiler,
    subaction,
    profiler,
    mode: "development",
    sources: ["native-profiler"],
    nativeArtifact,
    metrics: [],
    context: await perfContext({ args, projectRoot, metro: null }),
    confidence: subaction === "start" ? "low" : "high",
    limitations: [
      `${profiler} metadata records native profiler evidence boundaries; collect and symbolicate native profiler artifacts before making native CPU or memory claims.`,
      "Native profiler workflows are heavier than routine runtime evidence and may require platform tooling outside this CLI."
    ]
  }, deps);
}
async function perfBundlePayload(args = {}, deps = {}) {
  const cwd = await projectCwd(args.cwd, deps);
  const bundleArtifact = requireOptionalString9(args.bundleArtifact);
  const metrics = [];
  const unavailableSources = [];
  let available = false;
  let bundlePath = null;
  if (bundleArtifact) {
    bundlePath = resolve10(bundleArtifact);
    const stat8 = await fileStat(bundlePath, deps);
    if (stat8?.isFile()) {
      available = true;
      metrics.push(perfMetric({ name: "bundle.bytes", value: stat8.size, unit: "bytes", source: "metro", confidence: "high" }));
    } else {
      unavailableSources.push({ source: "bundle-artifact", reason: "Bundle artifact was not found.", path: bundlePath });
    }
  } else {
    unavailableSources.push({ source: "bundle-artifact", reason: "Pass an existing Metro/Expo bundle artifact path." });
  }
  return writePerfArtifact(args, "bundle", {
    available,
    action: "bundle",
    mode: "development",
    sources: available ? ["project", "metro"] : ["project"],
    bundleArtifact: bundlePath,
    metrics,
    unavailableSources,
    context: await perfContext({ args, projectRoot: cwd, metro: null }),
    confidence: perfOverallConfidence(metrics),
    limitations: perfDevelopmentLimitations(["Bundle byte evidence depends on the supplied artifact and does not imply release performance unless the artifact is release-like."])
  }, deps);
}
function metricMap(metrics) {
  return new Map((metrics ?? []).map((metric) => [metric.name, metric]));
}
function lowerConfidence(left, right) {
  const order = ["low", "medium", "high"];
  const leftIndex = order.indexOf(String(left));
  const rightIndex = order.indexOf(String(right));
  return order[Math.min(leftIndex === -1 ? 0 : leftIndex, rightIndex === -1 ? 0 : rightIndex)];
}
function normalizePerfBridgePayload(value, action) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { available: false, action, sources: ["runtime"], source: "runtime", code: "malformed-payload", reason: "Performance runtime returned a malformed payload.", metrics: [] };
  }
  if (value.metrics !== void 0 && !Array.isArray(value.metrics)) {
    return { ...value, available: false, action, code: "malformed-payload", reason: "Performance runtime returned malformed metrics.", metrics: [] };
  }
  const metrics = (value.metrics ?? []).map((metric) => perfMetric({
    name: metric.name,
    value: metric.value,
    unit: metric.unit,
    source: metric.source ?? value.source ?? value.sources?.[0] ?? "runtime",
    confidence: metric.confidence ?? value.confidence ?? "medium"
  }));
  return { ...value, action, metrics };
}
function perfEvidenceSource(value) {
  if (typeof value?.source === "string") return value.source;
  if (Array.isArray(value?.sources) && value.sources.length > 0) return value.sources[0];
  return "unknown";
}
function perfTransport(metroPort, target, cdp = null) {
  return { name: "metro-inspector-hermes-cdp", metroPort, protocol: "Runtime.evaluate", target: targetSummary9(target), cdp };
}
function perfExpression({ action, label }) {
  return `(() => {
    const action = ${JSON.stringify(action)};
    const label = ${JSON.stringify(label ?? null)};
    const expectedBridgeVersion = ${JSON.stringify(EXPO_IOS_BRIDGE_VERSION5)};
    const pluginBridge = globalThis.__EXPO_IOS_DEVTOOLS_BRIDGE__ ||
      globalThis.__EXPO_IOS_PLUGIN_BRIDGE__ ||
      globalThis.__ROZENITE_AGENT_BRIDGE__;
    const pluginMetadata = pluginBridge?.metadata || pluginBridge?.expoIosDevtoolsBridgeMetadata || pluginBridge?.bridgeMetadata || {};
    const pluginVersion = pluginMetadata.bridgeVersion || pluginBridge?.bridgeVersion || pluginBridge?.version || null;
    const pluginPerf = pluginBridge?.performance ||
      pluginBridge?.perf ||
      (pluginBridge?.domains && !Array.isArray(pluginBridge.domains) ? (pluginBridge.domains.performance || pluginBridge.domains.perf) : null) ||
      (pluginBridge?.domainRegistry ? (pluginBridge.domainRegistry.performance || pluginBridge.domainRegistry.perf) : null);
    const pluginCallTool = typeof pluginBridge?.callTool === 'function' ? pluginBridge.callTool.bind(pluginBridge) : null;
    const callPerf = (command, payload = {}) => {
      if (pluginPerf && typeof pluginPerf[command] === 'function') return pluginPerf[command](payload);
      if (pluginPerf && pluginPerf.actions && typeof pluginPerf.actions[command] === 'function') return pluginPerf.actions[command](payload);
      if (pluginCallTool) return pluginCallTool('performance.' + command, payload);
      return null;
    };
    const hasPluginPerf = Boolean(pluginPerf || pluginCallTool || (Array.isArray(pluginBridge?.domains) && pluginBridge.domains.some((domain) => domain?.name === 'performance' || domain?.name === 'perf')));
    if (hasPluginPerf) {
      if (pluginVersion && pluginVersion !== expectedBridgeVersion) {
        return { available: false, source: 'plugin-bridge-performance', sources: ['plugin-bridge', 'rozenite-performance'], code: 'version-mismatch', bridgeVersion: pluginVersion, expectedBridgeVersion, reason: 'Performance plugin bridge version is not compatible with this CLI.', metrics: [] };
      }
      if (action === 'mark-list') return callPerf('mark-list', { label }) || callPerf('marks', { label }) || { available: true, source: 'plugin-bridge-performance', sources: ['plugin-bridge', 'rozenite-performance'], marks: pluginPerf?.marks || [], metrics: [] };
      if (action === 'mark-clear') return callPerf('mark-clear', { label }) || { available: true, source: 'plugin-bridge-performance', sources: ['plugin-bridge', 'rozenite-performance'], cleared: true, metrics: [] };
      if (action === 'measure-start') return callPerf('measure-start', { label }) || { available: true, source: 'plugin-bridge-performance', sources: ['plugin-bridge', 'rozenite-performance'], measure: { name: label, status: 'started' }, metrics: [] };
      if (action === 'measure-stop') return callPerf('measure-stop', { label }) || { available: true, source: 'plugin-bridge-performance', sources: ['plugin-bridge', 'rozenite-performance'], measure: { name: label, status: 'stopped' }, metrics: [] };
      if (action === 'js-thread') return callPerf('js-thread', { label }) || { available: false, source: 'plugin-bridge-performance', sources: ['plugin-bridge', 'rozenite-performance'], code: 'missing-metric', reason: 'JS thread evidence is not exposed by the performance plugin bridge.', metrics: [] };
      if (action === 'frames') return callPerf('frames', { label }) || { available: false, source: 'plugin-bridge-performance', sources: ['plugin-bridge', 'rozenite-performance'], code: 'missing-metric', reason: 'Frame evidence is not exposed by the performance plugin bridge.', metrics: [] };
      if (action === 'startup') return callPerf('startup', { label }) || { available: true, source: 'plugin-bridge-performance', sources: ['plugin-bridge', 'rozenite-performance'], metrics: pluginPerf?.startupMetrics || [] };
      if (action === 'action') return callPerf('action', { label }) || { available: true, source: 'plugin-bridge-performance', sources: ['plugin-bridge', 'rozenite-performance'], actionName: label, metrics: pluginPerf?.actionMetrics || [] };
    } else if (pluginBridge) {
      return { available: false, source: 'plugin-bridge-performance', sources: ['plugin-bridge'], code: 'missing-domain', reason: 'Performance bridge domain is not registered.', metrics: [] };
    }
    const expoDevtoolsPerf = globalThis.__EXPO_DEVTOOLS_PERFORMANCE__ || globalThis.__REACT_NATIVE_DEVTOOLS_PERFORMANCE__;
    if (expoDevtoolsPerf && typeof expoDevtoolsPerf === 'object') {
      const call = (command, payload = {}) => typeof expoDevtoolsPerf[command] === 'function' ? expoDevtoolsPerf[command](payload) : null;
      if (action === 'startup') return call('startup', { label }) || { available: true, source: 'expo-devtools-performance', sources: ['expo-devtools'], metrics: expoDevtoolsPerf.startupMetrics || [] };
      if (action === 'action') return call('action', { label }) || { available: true, source: 'expo-devtools-performance', sources: ['expo-devtools'], actionName: label, metrics: expoDevtoolsPerf.actionMetrics || [] };
      if (action === 'mark-list') return call('marks', { label }) || { available: true, source: 'expo-devtools-performance', sources: ['expo-devtools'], marks: expoDevtoolsPerf.marks || [], metrics: [] };
    }
    const bridge = globalThis.__EXPO_IOS_PERF_BRIDGE__ ||
      (globalThis.__EXPO_IOS_INSTRUMENTATION__ && globalThis.__EXPO_IOS_INSTRUMENTATION__.performance);
    if (!bridge) return { available: false, source: 'app-instrumentation', sources: ['runtime', 'app-instrumentation'], code: 'unavailable-bridge', reason: 'Performance bridge is not installed.', metrics: [] };
    if (action === 'mark-list') return bridge.marks ? bridge.marks() : { available: true, sources: ['runtime', 'app-instrumentation'], marks: performance.getEntriesByType ? performance.getEntriesByType('mark') : [], metrics: [] };
    if (action === 'mark-clear') return bridge.clearMarks ? bridge.clearMarks() : { available: true, sources: ['runtime', 'app-instrumentation'], cleared: true, metrics: [] };
    if (action === 'measure-start') return bridge.measureStart ? bridge.measureStart(label) : { available: true, sources: ['runtime', 'app-instrumentation'], measure: { name: label, status: 'started' }, metrics: [] };
    if (action === 'measure-stop') return bridge.measureStop ? bridge.measureStop(label) : { available: true, sources: ['runtime', 'app-instrumentation'], measure: { name: label, status: 'stopped' }, metrics: [] };
    if (action === 'js-thread') return bridge.jsThread ? bridge.jsThread() : { available: false, sources: ['runtime', 'app-instrumentation'], reason: 'JS thread evidence is not exposed by the performance bridge.', metrics: [] };
    if (action === 'frames') return bridge.frames ? bridge.frames() : { available: false, sources: ['runtime', 'app-instrumentation'], reason: 'Frame evidence is not exposed by the performance bridge.', metrics: [] };
    if (action === 'startup') return bridge.startup ? bridge.startup() : { available: true, sources: ['runtime', 'app-instrumentation'], metrics: bridge.startupMetrics || [] };
    if (action === 'action') return bridge.action ? bridge.action(label) : { available: true, sources: ['runtime', 'app-instrumentation'], actionName: label, metrics: bridge.actionMetrics || [] };
    return { available: false, sources: ['runtime', 'app-instrumentation'], reason: 'Unsupported performance action.', metrics: [] };
  })()`;
}
async function perfContext({ args, projectRoot, metro, target = null }) {
  const buildMode = normalizePerfBuildKind(args.buildKind);
  return {
    projectRoot,
    build: { mode: buildMode, releaseLike: ["preview", "release-export", "production"].includes(buildMode) },
    platform: args.platform ?? "ios",
    device: target?.deviceName ?? null,
    metro: metro ? { port: metro.metroPort ?? args.metroPort ?? 8081, status: metro.available ? "available" : "unavailable", targetCount: metro.targetCount ?? 0, devMode: buildMode === "development" ? true : null } : { port: args.metroPort ?? 8081, status: "not-measured", targetCount: 0, devMode: buildMode === "development" ? true : null },
    coldStart: null,
    samples: 1
  };
}
function normalizePerfBuildKind(value) {
  const buildKind = requireOptionalString9(value) ?? "development";
  if (buildKind === "production") return "production";
  if (["development", "dev-build", "preview", "release-export", "unknown"].includes(buildKind)) return buildKind;
  throw new Error(`Unknown performance build kind: ${buildKind}`);
}
function perfMetric({ name, value, unit, source: source2, confidence }) {
  return { name, value, unit, source: source2, confidence };
}
function perfOverallConfidence(metrics) {
  if (!metrics.length) return "low";
  if (metrics.some((metric) => metric.confidence === "high")) return "high";
  if (metrics.some((metric) => metric.confidence === "medium")) return "medium";
  return "low";
}
function perfDevelopmentLimitations(extra = []) {
  return [
    ...extra.map(String),
    "Development-mode measurements include Metro, dev runtime, and instrumentation overhead and must not be generalized to release performance."
  ];
}
async function writePerfArtifact(args, action, payload, deps = {}) {
  const timestamp = (deps.now?.() ?? /* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-");
  const artifactPath = resolve10(args.outputPath ?? join15(resolveExpoStateRoot10(args), "artifacts", "perf", `${action}-${timestamp}.json`));
  await (deps.mkdir ?? fsMkdir2)(dirname7(artifactPath), { recursive: true });
  const withArtifact = { ...payload, artifacts: [...payload.artifacts ?? [], artifactPath] };
  await writeJsonFile7(artifactPath, withArtifact, deps);
  return withArtifact;
}
function targetSummary9(target) {
  if (!target) return null;
  return {
    id: target.id ?? null,
    title: target.title ?? null,
    description: target.description ?? null,
    appId: target.appId ?? null,
    deviceName: target.deviceName ?? null,
    devtoolsFrontendUrl: target.devtoolsFrontendUrl ?? null,
    webSocketDebuggerUrl: target.webSocketDebuggerUrl ?? null,
    reactNative: target.reactNative ?? null,
    capabilities: target.capabilities ?? {
      hermesRuntime: typeof target.webSocketDebuggerUrl === "string" && target.webSocketDebuggerUrl.startsWith("ws"),
      devtoolsFrontend: typeof target.devtoolsFrontendUrl === "string" && target.devtoolsFrontendUrl.length > 0,
      reactNative: Boolean(target.reactNative)
    }
  };
}
function resolveExpoStateRoot10(args = {}) {
  if (args.stateDir) {
    const resolved = resolve10(args.stateDir);
    return basename10(resolved) === "runs" ? resolve10(join15(resolved, "..")) : resolved;
  }
  const root = resolve10(args.root ?? args.cwd ?? process.cwd());
  return join15(root, ".scratch", "expo-ios");
}
function requireString22(value, name) {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${name} must be a non-empty string.`);
  return value.trim();
}
function requireOptionalString9(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}
function clampNumber22(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`Expected a finite number, got ${String(value)}.`);
  return Math.min(Math.max(number, min), max);
}
async function projectCwd(cwd, deps) {
  if (deps.normalizeProjectCwd) {
    return Promise.resolve(deps.normalizeProjectCwd(cwd, { allowMissingPackageJson: true })).catch(() => resolve10(String(cwd ?? process.cwd())));
  }
  return resolve10(String(cwd ?? process.cwd()));
}
async function projectSummary(cwd, deps) {
  return deps.expoProjectRuntimeSummary ? deps.expoProjectRuntimeSummary(cwd) : { projectRoot: cwd };
}
async function metroStatus2(args, deps) {
  return deps.metroStatusPayload ? deps.metroStatusPayload(args) : metroStatusPayload(args);
}
async function listMetroTargets(metroPort, deps) {
  return deps.metroTargets ? deps.metroTargets(metroPort) : metroTargets(metroPort);
}
async function evaluateHermes(url, expression, deps) {
  return deps.evaluateHermesExpression ? deps.evaluateHermesExpression(url, expression, { timeoutMs: 5e3 }) : evaluateHermesExpression(url, expression, { timeoutMs: 5e3 });
}
async function findUpFile(cwd, name, deps) {
  return deps.findUp ? deps.findUp(cwd, name) : null;
}
async function readJson6(file, deps) {
  if (deps.readJsonFile) return deps.readJsonFile(file);
  return JSON.parse(await readFile19(file, "utf8"));
}
async function writeJsonFile7(file, value, deps) {
  await (deps.writeFile ?? fsWriteFile2)(file, `${JSON.stringify(value, null, 2)}
`, "utf8");
}
async function exists(path12, deps) {
  return deps.pathExists ? deps.pathExists(path12) : fsStat(path12).then(() => true, () => false);
}
async function fileStat(path12, deps) {
  return deps.stat ? deps.stat(path12) : fsStat(path12).catch(() => null);
}
function redactValue8(value) {
  if (Array.isArray(value)) return value.map(redactValue8);
  if (!value || typeof value !== "object") return value;
  const result = {};
  for (const [key, item] of Object.entries(value)) {
    result[key] = /token|authorization|cookie|password|secret|apikey/i.test(key) ? "[redacted]" : redactValue8(item);
  }
  return result;
}
function firstPositional2(args) {
  return Array.isArray(args._) ? args._[0] : void 0;
}

// src/modules/dashboard-observability/src/main/index.ts
import { mkdir as mkdir14, readdir as readdir13, readFile as readFile20, writeFile as writeFile9 } from "node:fs/promises";
import { basename as basename11, dirname as dirname8, join as join16, resolve as resolve11 } from "node:path";
var DASHBOARD_LIMITATION = "The dashboard command records a local static observability view; it does not expose network access unless a future server adapter is added.";
function toolJson30(value) {
  return { content: [{ type: "text", text: `${JSON.stringify(value, null, 2)}
` }] };
}
async function dashboardCommand(args = {}) {
  const positionals = Array.isArray(args._) ? args._ : [];
  const action = requireString23(args.action ?? positionals[0] ?? "status", "action");
  if (!["start", "status", "stop"].includes(action)) throw new Error(`Unknown dashboard action: ${action}`);
  const stateRoot = resolveExpoStateRoot11(args);
  const dashboardDir = join16(stateRoot, "dashboard");
  const statePath = join16(dashboardDir, "dashboard-state.json");
  await mkdir14(dashboardDir, { recursive: true });
  const previous = asRecord19(await readJsonFile12(statePath).catch(() => null));
  const previousArtifacts = asRecord19(previous?.artifacts);
  const status = action === "start" ? "running" : action === "stop" ? "stopped" : previous?.status ?? "stopped";
  const payload = {
    available: true,
    action,
    status,
    port: clampNumber23(args.port ?? previous?.port ?? 0, 0, 65535),
    stateRoot,
    sessions: await dashboardSessions(stateRoot),
    artifacts: {
      json: resolve11(String(args.outputPath ?? previousArtifacts?.json ?? join16(dashboardDir, "dashboard.json"))),
      html: String(previousArtifacts?.html ?? join16(dashboardDir, "index.html"))
    },
    limitations: [DASHBOARD_LIMITATION]
  };
  await writeDashboardHtml(payload.artifacts.html, payload);
  await writeJsonFile8(payload.artifacts.json, payload);
  await writeJsonFile8(statePath, payload);
  return toolJson30(payload);
}
async function dashboardSessions(stateRoot) {
  const sessionsDir = join16(stateRoot, "sessions");
  const names = await readdir13(sessionsDir).catch(() => []);
  const sessions = [];
  for (const name of names.sort()) {
    const sessionPath = join16(sessionsDir, name, "session.json");
    const session = asRecord19(await readJsonFile12(sessionPath).catch(() => null));
    if (session) {
      sessions.push({
        sessionId: session.sessionId ?? name,
        name: session.name ?? null,
        activeTargetId: session.activeTargetId ?? null,
        lastSnapshotId: session.lastSnapshotId ?? null,
        updatedAt: session.updatedAt ?? session.createdAt ?? null,
        path: sessionPath
      });
    }
  }
  return sessions;
}
async function writeDashboardHtml(file, payload) {
  await mkdir14(dirname8(file), { recursive: true });
  await writeFile9(file, `<!doctype html>
<html>
<head><meta charset="utf-8"><title>expo-ios dashboard</title></head>
<body>
<h1>expo-ios dashboard</h1>
<p>Status: ${escapeHtml3(payload.status)}</p>
<p>Sessions: ${payload.sessions.length}</p>
<pre>${escapeHtml3(JSON.stringify(payload.sessions, null, 2))}</pre>
</body>
</html>
`, "utf8");
}
function resolveExpoStateRoot11(args = {}) {
  if (args.stateDir) {
    const resolved = resolve11(args.stateDir);
    return basename11(resolved) === "runs" ? resolve11(join16(resolved, "..")) : resolved;
  }
  const root = resolve11(args.root ?? args.cwd ?? process.cwd());
  return join16(root, ".scratch", "expo-ios");
}
async function readJsonFile12(file) {
  return JSON.parse(await readFile20(file, "utf8"));
}
async function writeJsonFile8(file, value) {
  await mkdir14(dirname8(file), { recursive: true });
  await writeFile9(file, `${JSON.stringify(value, null, 2)}
`, "utf8");
}
function escapeHtml3(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function clampNumber23(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`Expected a finite number, got ${String(value)}.`);
  return Math.min(Math.max(number, min), max);
}
function requireString23(value, name) {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${name} must be a non-empty string.`);
  return value.trim();
}
function asRecord19(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

// src/modules/policy-redaction/src/main/command-boundary.ts
import { mkdir as mkdir15, readFile as readFile21, writeFile as writeFile10 } from "node:fs/promises";
import { dirname as dirname9, resolve as resolve12 } from "node:path";

// src/modules/policy-redaction/src/main/domain.ts
var REDACTED5 = "[redacted]";
var POLICY_REASONS = Object.freeze({
  READ_ALLOWED: "Read action does not require policy approval.",
  MISSING_POLICY: "No action policy allowed this state-changing operation.",
  ACTION_ALLOWED: "Action allowed by policy.",
  ACTION_DENIED: "Action policy did not allow this operation."
});
var BRIDGE_CONFIRMATIONS = Object.freeze({
  install: "bridge-install",
  remove: "bridge-remove"
});
function checkedPolicyDecision({
  action,
  sideEffect,
  allowed,
  source: source2 = null,
  reason
}) {
  return {
    checked: true,
    action,
    sideEffect,
    allowed,
    source: source2,
    reason
  };
}

// src/modules/policy-redaction/src/main/policy-service.ts
function decideActionPolicy({
  action,
  sideEffect,
  policy = null,
  source: source2 = null,
  allowRuntimeEval = false
}) {
  if (action === "wait.fn" && allowRuntimeEval === true) {
    return checkedPolicyDecision({
      action,
      sideEffect: "runtime-eval",
      allowed: true,
      source: "--allow-runtime-eval",
      reason: "Runtime eval allowed by global flag."
    });
  }
  if (sideEffect === "read") {
    return checkedPolicyDecision({
      action,
      sideEffect,
      allowed: true,
      source: null,
      reason: POLICY_REASONS.READ_ALLOWED
    });
  }
  if (!policy) {
    return checkedPolicyDecision({
      action,
      sideEffect,
      allowed: false,
      source: null,
      reason: POLICY_REASONS.MISSING_POLICY
    });
  }
  const allowed = policyAllowsAction2(policy, action);
  return checkedPolicyDecision({
    action,
    sideEffect,
    allowed,
    source: source2,
    reason: allowed ? POLICY_REASONS.ACTION_ALLOWED : POLICY_REASONS.ACTION_DENIED
  });
}
function policyAllowsAction2(policy, action) {
  if (Array.isArray(policy?.allow) && policy.allow.includes(action)) {
    return true;
  }
  if (policy?.actions?.[action] === "allow" || policy?.actions?.[action] === true) {
    return true;
  }
  return false;
}
function defaultPolicySummary() {
  return {
    allow: [],
    defaults: {
      read: "allow",
      write: "deny",
      device: "deny",
      runtimeEval: "deny unless --allow-runtime-eval true or an action policy allows the command"
    }
  };
}
function actionSideEffect(action) {
  if (/^(doctor|project-info|routes|devices|target\.list|target\.current|snapshot|refs|get|find|wait|console|errors|logs|metro\.status|policy|redact|review)/.test(action)) {
    return "read";
  }
  if (/^(storage\.set|storage\.clear|state\.load|state\.clear|install-app|uninstall-app|set\.|wait\.fn)/.test(action)) {
    return "device";
  }
  return "device";
}

// src/modules/policy-redaction/src/main/redactor.ts
var SECRET_KEY_PATTERN3 = /token|authorization|cookie|password|secret|apikey|apiKey/i;
var URL_QUERY_SECRET_PATTERN3 = /([?&](cookie|token|authorization|password|secret)=)[^&]+/gi;
function redactJson(value, key = "") {
  if (typeof value === "string") {
    if (isSecretKey4(key)) {
      return REDACTED5;
    }
    return redactText(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactJson(item, key));
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value).map(([childKey, childValue]) => [
      childKey,
      isSecretKey4(childKey) ? REDACTED5 : redactJson(childValue, childKey)
    ])
  );
}
function redactText(value) {
  return String(value ?? "").replace(
    URL_QUERY_SECRET_PATTERN3,
    `$1${REDACTED5}`
  );
}
function isSecretKey4(key) {
  return SECRET_KEY_PATTERN3.test(key);
}

// src/modules/policy-redaction/src/main/command-boundary.ts
function toolJson31(value) {
  return { content: [{ type: "text", text: `${JSON.stringify(value, null, 2)}
` }], isError: false };
}
async function policyCommand(args = {}) {
  const action = requireString24(args.action ?? "show", "action");
  if (action !== "show" && action !== "check") {
    throw new Error(`Unknown policy action: ${action}`);
  }
  const policyPath = requireOptionalString10(args.actionPolicy);
  const resolvedPolicyPath = policyPath ? resolve12(policyPath) : null;
  const policy = resolvedPolicyPath ? await readJsonFile13(resolvedPolicyPath) : null;
  if (action === "show") {
    return toolJson31({
      available: true,
      action,
      source: resolvedPolicyPath,
      policy: policy ?? defaultPolicySummary(),
      limitations: [
        "No policy file means read-only commands are allowed and state-changing commands are denied by default."
      ]
    });
  }
  const subject = requireString24(args.subject, "subject");
  const name = requireString24(args.name, "name");
  const policyAction = subject === "action" ? name : `${subject}.${name}`;
  const sideEffect = actionSideEffect(policyAction);
  const decision = sideEffect === "read" ? {
    checked: true,
    action: policyAction,
    sideEffect,
    allowed: true,
    source: resolvedPolicyPath,
    reason: POLICY_REASONS.READ_ALLOWED
  } : decideActionPolicy({
    action: policyAction,
    sideEffect,
    policy,
    source: resolvedPolicyPath,
    allowRuntimeEval: args.allowRuntimeEval === true
  });
  return toolJson31({
    available: true,
    action: "check",
    subject,
    name,
    policyAction,
    decision
  });
}
async function redactCommand(args = {}) {
  const file = resolve12(requireString24(args.file, "file"));
  const raw = await readFile21(file, "utf8");
  let payload;
  try {
    payload = redactJson(JSON.parse(raw));
  } catch {
    payload = redactText(raw);
  }
  const outputPath = requireOptionalString10(args.outputPath);
  const resolvedOutputPath = outputPath ? resolve12(outputPath) : null;
  if (resolvedOutputPath) {
    await mkdir15(dirname9(resolvedOutputPath), { recursive: true });
    const text = typeof payload === "string" ? payload : JSON.stringify(payload, null, 2);
    await writeFile10(resolvedOutputPath, `${text}
`, "utf8");
  }
  return toolJson31({
    available: true,
    action: "redact",
    inputPath: file,
    outputPath: resolvedOutputPath,
    redacted: payload
  });
}
async function readJsonFile13(file) {
  return JSON.parse(await readFile21(file, "utf8"));
}
function requireString24(value, field) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${field} must be a non-empty string.`);
  }
  return value.trim();
}
function requireOptionalString10(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

// src/modules/plugin-self-management/src/main/index.ts
import { execFile as nodeExecFile11 } from "node:child_process";
import { existsSync } from "node:fs";
import { access as access6, mkdir as mkdir16, mkdtemp, readdir as readdir14, readFile as readFile22, writeFile as writeFile11 } from "node:fs/promises";
import { homedir as homedir2, tmpdir as tmpdir2 } from "node:os";
import { dirname as dirname10, join as join17, resolve as resolve13 } from "node:path";
var CLI_NAME5 = "expo-ios";
var CLI_VERSION6 = "0.1.0";
function toolJson32(value) {
  return { content: [{ type: "text", text: `${JSON.stringify(value, null, 2)}
` }] };
}
async function skillsCommand(args = {}, deps = {}) {
  const positionals = Array.isArray(args._) ? args._ : [];
  const action = requireString25(args.action ?? positionals[0] ?? "list", "action");
  if (!["list", "get"].includes(action)) throw new Error(`Unknown skills action: ${action}`);
  const skills = await listBundledSkills(deps);
  if (action === "list") {
    return toolJson32({
      available: true,
      action,
      pluginVersion: CLI_VERSION6,
      skills: skills.map(({ content: _content, ...skill2 }) => skill2)
    });
  }
  const name = requireString25(args.name ?? positionals[1], "name");
  const skill = skills.find((item) => item.name === name);
  if (!skill) return toolJson32({ available: false, action, name, reason: "Skill not found.", pluginVersion: CLI_VERSION6 });
  return toolJson32({ available: true, action, pluginVersion: CLI_VERSION6, ...skill });
}
async function listBundledSkills(deps = {}) {
  const skillsRoot = join17(pluginRoot(deps), "skills");
  const entries = await readdir14(skillsRoot, { withFileTypes: true }).catch(() => []);
  const skills = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const file = join17(skillsRoot, entry.name, "SKILL.md");
    const content = await readFile22(file, "utf8").catch(() => null);
    if (!content) continue;
    const metadata = parseSkillFrontmatter(content);
    skills.push({
      name: metadata.name ?? entry.name,
      description: metadata.description ?? "",
      path: file,
      content
    });
  }
  return skills.sort((left, right) => left.name.localeCompare(right.name));
}
function parseSkillFrontmatter(content) {
  const match = /^---\n([\s\S]*?)\n---/.exec(content);
  if (!match) return {};
  const metadata = {};
  for (const line of match[1]?.split("\n") ?? []) {
    const item = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (item?.[1]) metadata[item[1]] = String(item[2] ?? "").replace(/^["']|["']$/g, "");
  }
  return metadata;
}
async function installCommand(args = {}, deps = {}) {
  const positionals = Array.isArray(args._) ? args._ : [];
  const action = requireString25(args.action ?? positionals[0] ?? "check", "action");
  if (action !== "check") throw new Error(`Unknown install action: ${action}`);
  const prefix = resolve13(optionalString7(args.prefix) ?? join17(deps.homeDir ?? homedir2(), ".local"));
  const binPath = join17(prefix, "bin", CLI_NAME5);
  return toolJson32({
    available: true,
    action,
    prefix,
    binPath,
    installed: await pathExists6(binPath),
    installCommand: `make -C ${pluginRoot(deps)} install-local PREFIX=${prefix}`,
    cliPath: cliWrapperPath(deps),
    version: CLI_VERSION6
  });
}
async function upgradeCommand(args = {}, deps = {}) {
  const positionals = Array.isArray(args._) ? args._ : [];
  const action = requireString25(args.action ?? positionals[0] ?? "check", "action");
  if (action !== "check") throw new Error(`Unknown upgrade action: ${action}`);
  const prefix = resolve13(optionalString7(args.prefix) ?? join17(deps.homeDir ?? homedir2(), ".local"));
  return toolJson32({
    available: true,
    action,
    prefix,
    currentVersion: CLI_VERSION6,
    latestVersion: CLI_VERSION6,
    upgradeAvailable: false,
    reason: "No packaged remote upgrade source is configured; local plugin version is authoritative."
  });
}
async function releaseCommand(args = {}, deps = defaultPluginSelfManagementDependencies) {
  const positionals = Array.isArray(args._) ? args._ : [];
  const action = requireString25(args.action ?? positionals[0] ?? "check", "action");
  if (action !== "check") throw new Error(`Unknown release action: ${action}`);
  const outsideCwd = resolve13(String(args.cwd ?? await mkdtemp(join17(deps.tmpDir ?? tmpdir2(), "expo-ios-release-"))));
  await mkdir16(outsideCwd, { recursive: true });
  const fixture = join17(outsideCwd, "routes-fixture");
  await mkdir16(join17(fixture, "app"), { recursive: true });
  await writeJsonFile9(join17(fixture, "package.json"), { dependencies: { expo: "^54.0.0", "expo-router": "^6.0.0" } });
  await writeFile11(join17(fixture, "app", "index.tsx"), "export default function Index() { return null; }\n", "utf8");
  const checks = [
    await releaseCheck("version", ["--version"], outsideCwd, (result) => result.stdout.trim() === CLI_VERSION6, deps),
    await releaseCheck("help", ["--help"], outsideCwd, (result) => result.stdout.includes("perf") && result.stdout.includes("dashboard"), deps),
    await releaseCheck("doctor-json", ["--json", "doctor"], outsideCwd, (result) => JSON.parse(result.stdout).ok === true, deps),
    await releaseCheck("routes-fixture-json", ["--json", "routes", "--cwd", fixture], outsideCwd, (result) => JSON.parse(result.stdout).data.routeCount >= 1, deps)
  ];
  return toolJson32({
    available: checks.every((check) => check.ok),
    action,
    cwd: outsideCwd,
    version: CLI_VERSION6,
    checks,
    limitations: ["Release checks verify local CLI packaging behavior; they do not publish or mutate git state."]
  });
}
var defaultPluginSelfManagementDependencies = {
  execFile: execFile9
};
async function releaseCheck(name, argv, cwd, predicate, deps = defaultPluginSelfManagementDependencies) {
  try {
    if (!deps.execFile) return { name, ok: false, exitCode: 1, error: "No subprocess adapter is configured." };
    const result = await deps.execFile(process.execPath, [cliWrapperPath(deps), ...argv], {
      cwd,
      timeout: 2e4,
      rejectOnError: false
    });
    const ok = predicate(result);
    return {
      name,
      ok,
      exitCode: ok ? 0 : 1,
      stdout: truncate17(result.stdout, 1e3),
      stderr: truncate17(result.stderr, 1e3)
    };
  } catch (error) {
    return { name, ok: false, exitCode: 1, error: formatError15(error) };
  }
}
function cliWrapperPath(deps = {}) {
  return join17(pluginRoot(deps), "cli", "expo98.mjs");
}
function pluginRoot(deps = {}) {
  return resolve13(deps.pluginRoot ?? findPackageRoot(dirname10(new URL(import.meta.url).pathname)));
}
function findPackageRoot(start) {
  let current = resolve13(start);
  while (true) {
    if (existsSync(join17(current, "package.json")) && existsSync(join17(current, "cli"))) return current;
    const parent = dirname10(current);
    if (parent === current) return resolve13(start);
    current = parent;
  }
}
async function pathExists6(file) {
  try {
    await access6(file);
    return true;
  } catch {
    return false;
  }
}
async function writeJsonFile9(file, value) {
  await mkdir16(dirname10(file), { recursive: true });
  await writeFile11(file, `${JSON.stringify(value, null, 2)}
`, "utf8");
}
function requireString25(value, name) {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${name} must be a non-empty string.`);
  return value.trim();
}
function optionalString7(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}
function truncate17(value, max = 4e4) {
  const text = String(value ?? "");
  if (text.length <= max) return text;
  return `${text.slice(0, max)}...[truncated ${text.length - max} chars]`;
}
function formatError15(error) {
  const record = error && typeof error === "object" ? error : null;
  return record?.message == null ? String(error) : String(record.message);
}
function execFile9(file, argv, options) {
  return new Promise((resolve15) => {
    nodeExecFile11(file, argv, { cwd: options.cwd, timeout: options.timeout, maxBuffer: 4 * 1024 * 1024 }, (_error, stdout, stderr) => {
      resolve15({ stdout: String(stdout ?? ""), stderr: String(stderr ?? "") });
    });
  });
}

// src/modules/live-backlog/src/main/index.ts
import { execFile as nodeExecFile12 } from "node:child_process";
import { mkdir as fsMkdir3, readdir as fsReaddir, writeFile as fsWriteFile3 } from "node:fs/promises";
import { join as join18, resolve as resolve14 } from "node:path";
var EXIT_SUCCESS2 = 0;
var EXIT_INVALID_USAGE5 = 2;
var COMMAND_ALIASES = {
  "doctor": "doctor",
  "project-info": "project_info",
  "routes": "expo_router_sitemap",
  "devices": "list_devices",
  "session": "session",
  "target": "target",
  "snapshot": "snapshot",
  "refs": "refs",
  "get": "get_ref",
  "find": "find",
  "wait": "wait",
  "batch": "batch",
  "boot-simulator": "boot_simulator",
  "open-url": "open_url",
  "launch-app": "launch_app",
  "terminate-app": "terminate_app",
  "reload-app": "reload_app",
  "open-dev-menu": "runtime_inspector",
  "install-app": "install_app",
  "uninstall-app": "uninstall_app",
  "long-press": "ref_action",
  "dbltap": "ref_action",
  "fill": "ref_action",
  "type": "keyboard",
  "press": "keyboard",
  "focus": "ref_action",
  "blur": "ref_action",
  "select": "ref_action",
  "check": "ref_action",
  "uncheck": "ref_action",
  "drag": "ref_action",
  "scroll": "ref_action",
  "scroll-into-view": "ref_action",
  "clipboard": "clipboard",
  "keyboard": "keyboard",
  "set": "set_environment",
  "logs": "collect_app_logs",
  "screenshot": "automation_take_screenshot",
  "tap": "automation_tap",
  "gesture": "automation_gesture",
  "open-route": "open_expo_route",
  "ux-context": "capture_ux_context",
  "annotate-screen": "annotate_screen",
  "inspector": "runtime_inspector",
  "review-overlay": "review_overlay",
  "review-overlay-server": "review_overlay",
  "review-next": "review_next_step",
  "annotation-server": "annotation_server",
  "devtools": "devtools",
  "console": "console",
  "errors": "errors",
  "metro": "metro",
  "profiler": "perf",
  "navigation": "navigation",
  "network": "network",
  "storage": "storage",
  "state": "state",
  "controls": "controls",
  "bridge": "bridge",
  "accessibility": "accessibility",
  "dialog": "dialog",
  "sheet": "sheet",
  "record": "record",
  "diff": "diff",
  "inspect": "debug_inspect",
  "highlight": "highlight",
  "expo": "expo",
  "rn": "rn",
  "perf": "perf",
  "dashboard": "dashboard",
  "review": "review",
  "policy": "policy",
  "redact": "redact",
  "skills": "skills",
  "install": "install",
  "upgrade": "upgrade",
  "release": "release",
  "live-backlog": "live_backlog",
  "trace": "trace_interaction"
};
var LIVE_BACKLOG_MANIPULATING_COMMANDS = [
  "boot-simulator",
  "open-url",
  "launch-app",
  "terminate-app",
  "reload-app",
  "open-dev-menu",
  "install-app",
  "uninstall-app",
  "tap",
  "gesture",
  "long-press",
  "dbltap",
  "fill",
  "type",
  "press",
  "focus",
  "blur",
  "select",
  "check",
  "uncheck",
  "drag",
  "scroll",
  "scroll-into-view",
  "clipboard",
  "keyboard",
  "set",
  "navigation",
  "storage",
  "state",
  "controls",
  "dialog",
  "sheet"
];
var ADAPTER_SELF_CHECK_FINDINGS = [
  {
    command: "snapshot",
    domain: "semantic",
    status: "wired",
    reason: "Semantic snapshot capture evaluates app instrumentation through the shared Hermes CDP transport and falls back to native accessibility only when bridge data is unavailable.",
    sourceFile: "src/modules/snapshot-evidence/src/main/snapshot-command.ts",
    recommendedFix: null
  },
  {
    command: "rn tree|rn fiber|rn renders",
    domain: "react-native",
    status: "wired",
    reason: "React Native introspection delegates to bridge-domain Runtime.evaluate using __EXPO_IOS_RN_BRIDGE__ and instrumentation fallbacks.",
    sourceFile: "src/modules/rn-introspection/src/main/index.ts",
    recommendedFix: null
  },
  {
    command: "console|errors",
    domain: "diagnostics",
    status: "wired",
    reason: "Runtime diagnostics use the shared Hermes CDP evaluator by default.",
    sourceFile: "src/modules/devtools-diagnostics/src/main/index.ts",
    recommendedFix: null
  },
  {
    command: "navigation|network|dialog|sheet|storage|state|controls|perf|trace|inspector|metro reload",
    domain: "runtime",
    status: "wired",
    reason: "Runtime.evaluate-backed commands share the Hermes CDP transport with loopback URL normalization and Metro Origin headers.",
    sourceFile: "src/modules/hermes-cdp-client/src/main/index.ts",
    recommendedFix: null
  }
];
function toolJson33(value) {
  return { content: [{ type: "text", text: `${JSON.stringify(value, null, 2)}
` }] };
}
async function liveBacklogCommand(args = {}, deps = defaultLiveBacklogDependencies) {
  const action = requireString26(args.action ?? firstPositional3(args) ?? "matrix", "action");
  if (!["matrix", "self-check", "run"].includes(action)) throw new Error(`Unknown live-backlog action: ${action}`);
  const cwd = resolve14(args.cwd ?? process.cwd());
  const scope = args.scope ?? "smoke";
  const matrix = buildLiveBacklogMatrix({ ...args, cwd, scope });
  const selfCheck = liveBacklogSelfCheck(matrix);
  if (action === "self-check") {
    return toolJson33({ available: selfCheck.ok, action, cwd, scope, selfCheck, source: matrix.source, rowCount: matrix.rows.length });
  }
  if (action === "matrix") {
    return toolJson33({ available: true, action, cwd, scope, source: matrix.source, selfCheck, rowCount: matrix.rows.length, rows: matrix.rows });
  }
  if (!selfCheck.ok) {
    return toolJson33({ available: false, action, cwd, scope, source: matrix.source, selfCheck, reason: "Live backlog self-check failed before executing rows." });
  }
  const outputDir = resolve14(args.outputDir ?? join18(cwd, ".scratch", "expo-ios", "live-backlog", isoStamp3(deps)));
  await (deps.mkdir ?? fsMkdir3)(outputDir, { recursive: true });
  const rows = [];
  for (const row of matrix.rows) {
    rows.push(await runLiveBacklogRow(row, { ...args, cwd, outputDir }, deps));
  }
  const summary = summarizeLiveBacklogRows(rows);
  const report = {
    schemaVersion: 1,
    action,
    cwd,
    scope,
    outputDir,
    generatedAt: (deps.now?.() ?? /* @__PURE__ */ new Date()).toISOString(),
    source: matrix.source,
    selfCheck,
    summary,
    rows,
    hiddenPreflights: [],
    limitations: [
      "The runner executes only commands represented as rows; it does not start Metro, launch apps, or reconnect dev clients outside row execution.",
      "Runtime rows can be classified environment-blocked when Metro/Hermes target evidence is absent; those rows are not live passes."
    ]
  };
  const reportPath = join18(outputDir, "live-backlog-report.json");
  await writeJsonFile10(reportPath, report, deps);
  return toolJson33({ ...report, reportPath });
}
var defaultLiveBacklogDependencies = {
  execFile: execFile10
};
function buildLiveBacklogMatrix(args = {}) {
  const dispatcherCommands = Object.keys(COMMAND_ALIASES).sort();
  const helpCommands = parseHelpCommandNames(cliHelpText2()).sort();
  const allRows = orderLiveBacklogRows(dispatcherCommands.map((command) => liveBacklogRowForCommand(command, args)));
  const smokeCommands = /* @__PURE__ */ new Set(["doctor", "project-info", "routes", "devices", "metro", "devtools", "console", "errors", "expo", "bridge", "policy", "skills", "install", "upgrade", "live-backlog"]);
  const rows = args.scope === "smoke" || !args.scope ? allRows.filter((row) => smokeCommands.has(row.command)) : allRows;
  const representedCommands = new Set(allRows.map((row) => row.command));
  return {
    schemaVersion: 1,
    scope: args.scope ?? "smoke",
    source: {
      dispatcher: "commandAliases",
      dispatcherCommandCount: dispatcherCommands.length,
      dispatcherCommands,
      help: "cliHelpText",
      helpCommandCount: helpCommands.length,
      helpCommands,
      fullRowCount: allRows.length,
      rowSubsetCount: rows.length,
      rowSubset: rows.map((row) => row.command),
      unrepresentedDispatcherCommands: dispatcherCommands.filter((command) => !representedCommands.has(command)),
      unrepresentedHelpCommands: helpCommands.filter((command) => COMMAND_ALIASES[command] && !representedCommands.has(command))
    },
    rows
  };
}
function orderLiveBacklogRows(rows) {
  const terminalRuntimeActions = /* @__PURE__ */ new Set(["terminate-app"]);
  return [
    ...rows.filter((row) => !terminalRuntimeActions.has(row.command)),
    ...rows.filter((row) => terminalRuntimeActions.has(row.command))
  ];
}
function liveBacklogRowForCommand(command, args = {}) {
  const template = liveBacklogTemplate(command, args);
  const requirements = template.requirements ?? inferLiveBacklogRequirements(command);
  return {
    id: template.id ?? command.replace(/[^a-z0-9]+/g, "-"),
    command,
    exactCommand: ["expo-ios", "--json", ...template.argv],
    argv: template.argv,
    scope: template.scope ?? "full",
    expectedClass: template.expectedClass ?? (requirements.length ? "live-pass" : "static-pass"),
    requirements,
    mutatesRuntime: LIVE_BACKLOG_MANIPULATING_COMMANDS.includes(command),
    captures: ["stdout", "stderr", "exit-code", "run-record"],
    artifacts: [],
    source: { dispatcher: true, helpListed: parseHelpCommandNames(cliHelpText2()).includes(command) },
    rationale: template.rationale ?? "Source-derived CLI command row."
  };
}
function liveBacklogTemplate(command, _args = {}) {
  const cwdArg = ["--cwd", "__CWD__"];
  const metroArg = ["--metro-port", "__METRO_PORT__"];
  const bundleArg = ["--bundle-id", "__BUNDLE_ID__"];
  const deviceArg = ["--device", "__DEVICE__"];
  const policyArg = ["--action-policy", "__ACTION_POLICY__"];
  switch (command) {
    case "doctor":
      return { argv: ["doctor"] };
    case "project-info":
      return { argv: ["project-info", ...cwdArg] };
    case "routes":
      return { argv: ["routes", ...cwdArg] };
    case "devices":
      return { argv: ["devices"] };
    case "session":
      return { argv: ["session", "new", "live-backlog"], expectedClass: "static-pass" };
    case "target":
      return { argv: ["target", "list", ...metroArg], requirements: ["metro"] };
    case "snapshot":
      return { argv: ["snapshot", "--interactive", "true", "--source", "true", "--bounds", "true"] };
    case "refs":
      return { argv: ["refs"] };
    case "get":
      return { argv: ["get", "source", "@e1"], expectedClass: "expected-usage-error" };
    case "find":
      return { argv: ["find", "text", "Customers"], expectedClass: "expected-usage-error" };
    case "wait":
      return { argv: ["wait", "--text", "Customers", "--timeout-ms", "100"], expectedClass: "expected-usage-error" };
    case "batch":
      return { argv: ["batch", '["doctor"]', "--bail", "true"] };
    case "boot-simulator":
      return { argv: ["boot-simulator", ...deviceArg], requirements: ["simulator"], scope: "full" };
    case "open-url":
      return { argv: ["open-url", "exp://127.0.0.1:8081", ...deviceArg], requirements: ["simulator"], scope: "full" };
    case "launch-app":
      return { argv: ["launch-app", ...deviceArg, ...bundleArg, "--crash-check-ms", "1000"], requirements: ["simulator", "installed-app", "crash-monitor"], scope: "full" };
    case "terminate-app":
      return { argv: ["terminate-app", ...deviceArg, ...bundleArg], requirements: ["simulator", "installed-app"], scope: "full" };
    case "reload-app":
      return { argv: ["reload-app", ...deviceArg, ...bundleArg], requirements: ["simulator", "installed-app"], scope: "full" };
    case "open-dev-menu":
      return { argv: ["open-dev-menu", ...metroArg, ...deviceArg, ...bundleArg, "--dev-client-url", "__DEV_CLIENT_URL__", "--crash-check-ms", "1000"], requirements: ["metro-message", "simulator", "crash-monitor"], scope: "full" };
    case "install-app":
      return { argv: ["install-app", "__APP_PATH__", ...deviceArg, ...policyArg, "--dry-run", "true"], expectedClass: "expected-usage-error", scope: "full" };
    case "uninstall-app":
      return { argv: ["uninstall-app", ...bundleArg, ...deviceArg, ...policyArg, "--dry-run", "true"], requirements: ["simulator", "action-policy"], scope: "full" };
    case "long-press":
      return { argv: ["long-press", "@e1", "--dry-run", "true"], expectedClass: "expected-usage-error" };
    case "dbltap":
      return { argv: ["dbltap", "@e1", "--dry-run", "true"], expectedClass: "expected-usage-error" };
    case "fill":
      return { argv: ["fill", "@e1", "hello", "--dry-run", "true"], expectedClass: "expected-usage-error" };
    case "type":
      return { argv: ["type", "hello", "--dry-run", "true"], requirements: ["simulator"], scope: "full" };
    case "press":
      return { argv: ["press", "Return", "--dry-run", "true"], requirements: ["simulator"], scope: "full" };
    case "focus":
      return { argv: ["focus", "@e1", "--dry-run", "true"], expectedClass: "expected-usage-error" };
    case "blur":
      return { argv: ["blur", "@e1", "--dry-run", "true"], expectedClass: "expected-usage-error" };
    case "select":
      return { argv: ["select", "@e1", "value", "--dry-run", "true"], expectedClass: "expected-usage-error" };
    case "check":
      return { argv: ["check", "@e1", "--dry-run", "true"], expectedClass: "expected-usage-error" };
    case "uncheck":
      return { argv: ["uncheck", "@e1", "--dry-run", "true"], expectedClass: "expected-usage-error" };
    case "drag":
      return { argv: ["drag", "@e1", "--to-x", "10", "--to-y", "10", "--dry-run", "true"], expectedClass: "expected-usage-error" };
    case "scroll":
      return { argv: ["scroll", "@e1", "--dy", "200", "--dry-run", "true"], expectedClass: "expected-usage-error" };
    case "scroll-into-view":
      return { argv: ["scroll-into-view", "@e1", "--dry-run", "true"], expectedClass: "expected-usage-error" };
    case "clipboard":
      return { argv: ["clipboard", "read"], requirements: ["simulator"], scope: "full" };
    case "keyboard":
      return { argv: ["keyboard", "press", "Return", "--dry-run", "true"], requirements: ["simulator"], scope: "full" };
    case "set":
      return { argv: ["set", "appearance", "dark", ...policyArg], requirements: ["simulator", "action-policy"], scope: "full" };
    case "logs":
      return { argv: ["logs", "--bundle-id", "__BUNDLE_ID__", "--limit", "20"], requirements: ["simulator-or-device-logs"] };
    case "screenshot":
      return { argv: ["screenshot", "--output-path", "__ROW_DIR__/screenshot.png"], requirements: ["simulator-screenshot"], scope: "full" };
    case "tap":
      return { argv: ["tap", "--x", "1", "--y", "1", "--dry-run", "true"], requirements: ["simulator"], scope: "full" };
    case "gesture":
      return { argv: ["gesture", "tap", "--x", "1", "--y", "1", "--dry-run", "true"], requirements: ["simulator"], scope: "full" };
    case "open-route":
      return { argv: ["open-route", "/", ...cwdArg], requirements: ["project-scheme", "simulator"], scope: "full" };
    case "ux-context":
      return { argv: ["ux-context", ...cwdArg, ...metroArg], requirements: ["simulator", "metro"] };
    case "annotate-screen":
      return { argv: ["annotate-screen", "prepare", ...cwdArg, "--output-dir", "__ROW_DIR__/annotations"] };
    case "inspector":
      return { argv: ["inspector", "probe", ...metroArg], requirements: ["hermes-target"] };
    case "review-overlay":
      return { argv: ["review-overlay", "read", "--output-dir", "__ROW_DIR__", ...cwdArg] };
    case "review-overlay-server":
      return { argv: ["review-overlay-server", "--output-dir", "__ROW_DIR__", "--port", "0", ...cwdArg] };
    case "review-next":
      return { argv: ["review-next", "--surface", "live-backlog", "--stage", "intake", "--issue", "live verification"] };
    case "annotation-server":
      return { argv: ["annotation-server", "--dir", "__ROW_DIR__/annotations"] };
    case "devtools":
      return { argv: ["devtools", "capabilities", ...metroArg], requirements: ["metro"] };
    case "console":
      return { argv: ["console", "--limit", "20", ...metroArg], requirements: ["hermes-target"] };
    case "errors":
      return { argv: ["errors", "--limit", "20", ...metroArg], requirements: ["hermes-target"] };
    case "metro":
      return { argv: ["metro", "status", ...metroArg], requirements: ["metro"] };
    case "profiler":
      return { argv: ["profiler", "start"], requirements: ["native-profiler"], scope: "full" };
    case "navigation":
      return { argv: ["navigation", "state", ...metroArg], requirements: ["hermes-target", "app-bridge"] };
    case "network":
      return { argv: ["network", "requests", ...metroArg], requirements: ["hermes-target", "app-bridge"] };
    case "storage":
      return { argv: ["storage", "async", "list", ...metroArg], requirements: ["hermes-target", "app-bridge"] };
    case "state":
      return { argv: ["state", "list", ...metroArg], requirements: ["hermes-target", "app-bridge"] };
    case "controls":
      return { argv: ["controls", "list", ...metroArg], requirements: ["hermes-target", "app-bridge"] };
    case "bridge":
      return { argv: ["bridge", "status", ...cwdArg] };
    case "accessibility":
      return { argv: ["accessibility", "tree"], requirements: ["accessibility-tooling"], scope: "full" };
    case "dialog":
      return { argv: ["dialog", "status", ...metroArg], requirements: ["hermes-target", "app-bridge"] };
    case "sheet":
      return { argv: ["sheet", "status", ...metroArg], requirements: ["hermes-target", "app-bridge"] };
    case "record":
      return { argv: ["record", "start", "--output-path", "__ROW_DIR__/recording.mov"], requirements: ["simulator"], scope: "full" };
    case "diff":
      return { argv: ["diff", "snapshot", "--baseline", "__ROW_DIR__/missing-baseline.json"], expectedClass: "expected-usage-error" };
    case "inspect":
      return { argv: ["inspect", "@e1"], expectedClass: "expected-usage-error" };
    case "highlight":
      return { argv: ["highlight", "@e1", "--output-path", "__ROW_DIR__/highlight.json"], expectedClass: "expected-usage-error" };
    case "expo":
      return { argv: ["expo", "upstream-policy", ...cwdArg] };
    case "rn":
      return { argv: ["rn", "tree", ...metroArg], requirements: ["hermes-target", "app-bridge"] };
    case "perf":
      return { argv: ["perf", "summary", ...metroArg], requirements: ["metro"] };
    case "dashboard":
      return { argv: ["dashboard", "status"] };
    case "review":
      return { argv: ["review", "matrix"] };
    case "policy":
      return { argv: ["policy", "show"] };
    case "redact":
      return { argv: ["redact", "__ROW_DIR__/redact-input.json", "--output-path", "__ROW_DIR__/redacted.json"], setupFiles: [{ path: "redact-input.json", content: '{"token":"secret"}\n' }] };
    case "skills":
      return { argv: ["skills", "list"] };
    case "install":
      return { argv: ["install", "check"] };
    case "upgrade":
      return { argv: ["upgrade", "check"] };
    case "release":
      return { argv: ["release", "check"], scope: "full" };
    case "live-backlog":
      return { argv: ["live-backlog", "self-check"] };
    case "trace":
      return { argv: ["trace", "--action", "read", ...metroArg], requirements: ["hermes-target"] };
    default:
      return { argv: [command], expectedClass: "expected-usage-error" };
  }
}
function inferLiveBacklogRequirements(command) {
  if (["console", "errors", "inspector", "trace", "navigation", "network", "storage", "state", "controls", "dialog", "sheet", "rn"].includes(command)) return ["hermes-target"];
  if (["metro", "devtools", "target"].includes(command)) return ["metro"];
  if (LIVE_BACKLOG_MANIPULATING_COMMANDS.includes(command)) return ["simulator"];
  return [];
}
function parseHelpCommandNames(text) {
  const commands = /* @__PURE__ */ new Set();
  let inCommands = false;
  for (const line of String(text).split(/\r?\n/)) {
    if (/^(Discovery|Simulator and app actions|Evidence and runtime):$/.test(line.trim())) {
      inCommands = true;
      continue;
    }
    if (/^Examples:/.test(line.trim())) break;
    if (!inCommands) continue;
    const match = /^\s{2}([a-z][a-z0-9-]+)\b/.exec(line);
    if (match) commands.add(match[1]);
  }
  return [...commands];
}
function liveBacklogSelfCheck(matrix) {
  const issues = [];
  const adapterFindings = ADAPTER_SELF_CHECK_FINDINGS.map((finding) => ({ ...finding }));
  for (const command of matrix.source.unrepresentedDispatcherCommands) issues.push({ type: "missing-dispatcher-row", command });
  for (const command of matrix.source.unrepresentedHelpCommands) issues.push({ type: "missing-help-row", command });
  for (const finding of adapterFindings) {
    if (finding.status === "missing" || finding.status === "stub") {
      issues.push({ type: "missing-adapter", command: finding.command, domain: finding.domain, sourceFile: finding.sourceFile });
    }
  }
  for (const command of LIVE_BACKLOG_MANIPULATING_COMMANDS) {
    if (COMMAND_ALIASES[command] && !matrix.source.dispatcherCommands.includes(command)) issues.push({ type: "missing-live-action-dispatcher", command });
  }
  for (const row of matrix.rows) {
    if (!Array.isArray(row.argv) || row.argv.length === 0) issues.push({ type: "missing-command-argv", rowId: row.id });
    for (const capture of ["stdout", "stderr", "exit-code"]) {
      if (!row.captures.includes(capture)) issues.push({ type: "missing-capture", rowId: row.id, capture });
    }
  }
  return {
    ok: issues.length === 0,
    issueCount: issues.length,
    issues,
    adapterFindings,
    adapterFindingCount: adapterFindings.length,
    missingAdapterCount: adapterFindings.filter((finding) => finding.status === "missing" || finding.status === "stub").length,
    hiddenPreflightPolicy: {
      allowed: false,
      statement: "Simulator, app lifecycle, Metro, Hermes, dev-client, gesture, screenshot, accessibility, log, and crash-report actions must be represented as live-backlog rows."
    }
  };
}
async function runLiveBacklogRow(row, args, deps = defaultLiveBacklogDependencies) {
  const rowDir = join18(args.outputDir, row.id);
  await (deps.mkdir ?? fsMkdir3)(rowDir, { recursive: true });
  for (const file of liveBacklogTemplate(row.command, args).setupFiles ?? []) {
    await (deps.writeFile ?? fsWriteFile3)(join18(rowDir, file.path), file.content, "utf8");
  }
  if (row.argv.includes("__ACTION_POLICY__")) {
    await writeJsonFile10(join18(rowDir, "action-policy.json"), {
      allow: ["set.appearance", "install-app", "uninstall-app", "storage.set", "storage.clear", "state.load", "state.clear", "controls.press", "navigation.back", "navigation.tab"]
    }, deps);
  }
  if (row.argv.includes("__APP_PATH__")) {
    await (deps.mkdir ?? fsMkdir3)(join18(rowDir, "missing.app"), { recursive: true });
  }
  const stateDir = join18(rowDir, "runs");
  const argv = ["--json", "--state-dir", stateDir, ...materializeLiveBacklogArgv(row.argv, args, rowDir)];
  const executable2 = deps.processExecPath ?? process.execPath;
  const cli = deps.cliWrapperPath ?? join18(resolve14("."), "cli", "expo-ios.mjs");
  const exactCommand = [executable2, cli, ...argv];
  const startedAt = (deps.now?.() ?? /* @__PURE__ */ new Date()).toISOString();
  if (!deps.execFile) throw new Error("No subprocess adapter is configured.");
  const result = await deps.execFile(executable2, [cli, ...argv], {
    cwd: args.cwd,
    timeout: 6e4,
    maxBuffer: 8 * 1024 * 1024,
    rejectOnError: false
  });
  const exitCode = result.error?.code ?? 0;
  const stdoutPath = join18(rowDir, "stdout.json");
  const stderrPath = join18(rowDir, "stderr.log");
  const exitCodePath = join18(rowDir, "exit-code.txt");
  await (deps.writeFile ?? fsWriteFile3)(stdoutPath, result.stdout, "utf8");
  await (deps.writeFile ?? fsWriteFile3)(stderrPath, result.stderr, "utf8");
  await (deps.writeFile ?? fsWriteFile3)(exitCodePath, `${exitCode}
`, "utf8");
  const parsed = parseBacklogJson(result.stdout);
  const classification = classifyLiveBacklogRow(row, exitCode, parsed);
  const runRecords = await listJsonFiles(stateDir, deps);
  return {
    id: row.id,
    command: row.command,
    exactCommand,
    startedAt,
    finishedAt: (deps.now?.() ?? /* @__PURE__ */ new Date()).toISOString(),
    exitCode,
    classification,
    requirements: row.requirements,
    mutatesRuntime: row.mutatesRuntime,
    stdoutPath,
    stderrPath,
    exitCodePath,
    runRecordPaths: runRecords,
    artifactPaths: [stdoutPath, stderrPath, exitCodePath, ...runRecords],
    parsedSummary: summarizeBacklogPayload(parsed)
  };
}
function materializeLiveBacklogArgv(argv, args, rowDir) {
  const replacements = {
    "__CWD__": args.cwd,
    "__METRO_PORT__": String(args.metroPort ?? 8081),
    "__BUNDLE_ID__": args.bundleId ?? "com.maddie.console",
    "__DEVICE__": args.device ?? "booted",
    "__DEV_CLIENT_URL__": args.devClientUrl ?? "exp+maddie://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A8081",
    "__ACTION_POLICY__": args.actionPolicy ?? join18(rowDir, "action-policy.json"),
    "__OUTPUT_DIR__": args.outputDir,
    "__ROW_DIR__": rowDir,
    "__APP_PATH__": join18(rowDir, "missing.app")
  };
  return argv.map((part) => {
    let materialized = part;
    for (const [token, value] of Object.entries(replacements)) {
      materialized = materialized.split(token).join(value);
    }
    return materialized;
  });
}
function parseBacklogJson(stdout) {
  try {
    return JSON.parse(stdout);
  } catch {
    return null;
  }
}
function classifyLiveBacklogRow(row, exitCode, parsed) {
  if (exitCode === EXIT_INVALID_USAGE5) return "expected-usage-error";
  if (exitCode !== EXIT_SUCCESS2) {
    if (row.requirements.length > 0) return "environment-blocked";
    if (row.expectedClass === "expected-usage-error") return "expected-usage-error";
    return "defect";
  }
  const data = parsed?.data ?? parsed;
  const requiresRuntime = row.requirements.some((requirement) => ["metro", "metro-message", "hermes-target", "app-bridge"].includes(requirement));
  if (requiresRuntime && !hasLiveRuntimeEvidence(data, row.requirements)) return "environment-blocked";
  if (data?.available === false) {
    if (row.expectedClass === "expected-usage-error") return "expected-usage-error";
    if (requiresRuntime || row.requirements.length > 0) return "environment-blocked";
    return "designed-unavailable";
  }
  if (row.expectedClass === "expected-usage-error") return "expected-usage-error";
  return row.requirements.length > 0 || row.mutatesRuntime ? "live-pass" : "static-pass";
}
function hasLiveRuntimeEvidence(data, requirements) {
  if (!data || typeof data !== "object") return false;
  if (requirements.includes("hermes-target")) {
    return Boolean(data.target?.webSocketDebuggerUrl || data.cdp?.calls?.length || data.metro?.targets?.some?.((target) => target.webSocketDebuggerUrl));
  }
  if (requirements.includes("metro")) {
    return data.status === "available" || data.metro?.status === "available" || data.metro?.status === "packager-status:running" || data.context?.metro?.status === "available" || data.context?.metro?.status === "packager-status:running" || Number(data.metro?.targetCount ?? data.context?.metro?.targetCount ?? 0) > 0 || Array.isArray(data.targets) && data.targets.length > 0 || Array.isArray(data.metro?.targets) && data.metro.targets.length > 0;
  }
  if (requirements.includes("metro-message")) {
    return data.messageSocket?.available === true || data.transport === "metro-message-socket";
  }
  if (requirements.includes("app-bridge")) {
    return data.source === "app-instrumentation" || data.sources?.includes?.("app-instrumentation");
  }
  return true;
}
function summarizeBacklogPayload(parsed) {
  const data = parsed?.data ?? parsed;
  if (!data || typeof data !== "object") return null;
  return {
    ok: parsed?.ok,
    available: typeof data.available === "boolean" ? data.available : void 0,
    action: data.action,
    reason: data.reason,
    keys: Object.keys(data).slice(0, 20)
  };
}
async function listJsonFiles(dir, deps = {}) {
  const entries = await Promise.resolve((deps.readdir ?? fsReaddir)(dir)).catch(() => []);
  return entries.filter((entry) => entry.endsWith(".json")).sort().map((entry) => join18(dir, entry));
}
function summarizeLiveBacklogRows(rows) {
  const classifications = {};
  for (const row of rows) {
    classifications[row.classification] = (classifications[row.classification] ?? 0) + 1;
  }
  return {
    rowCount: rows.length,
    classifications,
    defectCount: classifications.defect ?? 0,
    environmentBlockedCount: classifications["environment-blocked"] ?? 0,
    unexplainedPartialCount: classifications["unexplained-partial"] ?? 0
  };
}
function cliHelpText2() {
  const commands = Object.keys(COMMAND_ALIASES).sort();
  return `Discovery:
${commands.map((command) => `  ${command}`).join("\n")}
Examples:
  expo-ios doctor
`;
}
function requireString26(value, name) {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${name} must be a non-empty string.`);
  return value.trim();
}
async function writeJsonFile10(file, value, deps = {}) {
  await (deps.writeFile ?? fsWriteFile3)(file, `${JSON.stringify(value, null, 2)}
`, "utf8");
}
function isoStamp3(deps = {}) {
  return (deps.now?.() ?? /* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-");
}
function firstPositional3(args) {
  return Array.isArray(args._) ? args._[0] : void 0;
}
function execFile10(file, argv, options) {
  return new Promise((resolve15) => {
    nodeExecFile12(file, argv, {
      cwd: options.cwd,
      timeout: options.timeout,
      maxBuffer: options.maxBuffer
    }, (error, stdout, stderr) => {
      resolve15({
        stdout: String(stdout ?? ""),
        stderr: String(stderr ?? ""),
        error: error && typeof error === "object" && "code" in error ? { code: Number(error.code) } : error ? { code: 1 } : null
      });
    });
  });
}

// src/bundled-cli.ts
var CLI_VERSION7 = "0.1.0";
var handlerImplementations = {
  doctor: expo98Doctor,
  projectInfo,
  expoRouterSitemap,
  listDevices,
  sessionCommand,
  targetCommand,
  snapshotCommand,
  refsCommand,
  getRefCommand,
  findCommand,
  waitCommand,
  batchCommand,
  bootSimulator,
  openUrl,
  launchApp,
  terminateApp,
  reloadApp,
  installApp,
  uninstallApp,
  refActionCommand,
  clipboardCommand,
  keyboardCommand,
  setEnvironmentCommand,
  collectAppLogs,
  automationTakeScreenshot,
  automationTap,
  automationGesture,
  openExpoRoute,
  captureUxContext,
  annotateScreen,
  runtimeInspector,
  reviewOverlay,
  reviewNextStep,
  annotationServer,
  devtoolsCommand,
  consoleCommand,
  errorsCommand,
  metroCommand,
  navigationCommand,
  networkCommand,
  storageCommand,
  stateCommand,
  controlsCommand,
  bridgeCommand,
  accessibilityCommand,
  dialogCommand,
  sheetCommand,
  recordCommand,
  diffCommand,
  debugInspectCommand,
  highlightCommand,
  expoCommand,
  rnCommand,
  perfCommand,
  dashboardCommand,
  reviewCommand,
  policyCommand,
  redactCommand,
  skillsCommand,
  installCommand,
  upgradeCommand,
  releaseCommand,
  liveBacklogCommand,
  traceInteraction
};
var runtime = createCliRuntime({
  parseCliArgs,
  commandArgs,
  dispatchCommand,
  bindHandlers,
  createCliFacade,
  writeCliError: (error, options) => {
    const text = formatCliError(error, options);
    if (text !== null) {
      process.stderr.write(text);
    }
  },
  exitCodeForError,
  handlerImplementations,
  startRunRecord,
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
  printHelp: () => cliHelpText(CLI_VERSION7).replaceAll("expo-ios", "expo98"),
  cliVersion: CLI_VERSION7
});
var executable = createCliExecutable({
  argv: () => process.argv,
  main: (argv) => runtime.run(argv),
  setExitCode: (exitCode) => {
    process.exitCode = exitCode;
  },
  writeCliError: (error) => {
    process.stderr.write(formatCliError(error, runtime.getLastCliOptions()) ?? "");
  },
  exitCodeForError
});
void executable.run();
async function expo98Doctor(args = {}) {
  const result = await doctor(args);
  const payload = unwrapToolJson(result);
  const cli = typeof payload.cli === "object" && payload.cli !== null ? { ...payload.cli, name: "expo98", bin: "expo98" } : { name: "expo98", version: CLI_VERSION7, bin: "expo98" };
  return toolJson({
    ...payload,
    cli,
    runtime: {
      node: process.version,
      supported: Number(process.versions.node.split(".")[0] ?? 0) >= 20,
      required: ">=20"
    },
    package: {
      name: "expo98",
      entrypoint: "cli/expo98.mjs",
      bundledExecutable: true,
      compatibilityBin: "expo-ios"
    }
  });
}
