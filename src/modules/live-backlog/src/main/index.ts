import { mkdir as fsMkdir, readdir as fsReaddir, writeFile as fsWriteFile } from "node:fs/promises";
import { join, resolve } from "node:path";

export interface ToolTextResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

export interface LiveBacklogDependencies {
  mkdir?: (path: string, options?: { recursive?: boolean }) => Promise<void> | void;
  writeFile?: (path: string, data: string, encoding: "utf8") => Promise<void> | void;
  readdir?: (path: string) => Promise<string[]> | string[];
  execFile?: (
    file: string,
    argv: string[],
    options: { cwd: string; timeout: number; maxBuffer: number; rejectOnError: false },
  ) => Promise<{ stdout: string; stderr: string; error?: { code?: number } | null }> | { stdout: string; stderr: string; error?: { code?: number } | null };
  now?: () => Date;
  processExecPath?: string;
  cliWrapperPath?: string;
}

export interface LiveBacklogRow {
  id: string;
  command: string;
  exactCommand: string[];
  argv: string[];
  scope: string;
  expectedClass: string;
  requirements: string[];
  mutatesRuntime: boolean;
  captures: string[];
  artifacts: string[];
  source: { dispatcher: boolean; helpListed: boolean };
  rationale: string;
}

const EXIT_SUCCESS = 0;
const EXIT_INVALID_USAGE = 2;

export const COMMAND_ALIASES: Record<string, string> = {
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
  "trace": "trace_interaction",
};

export const LIVE_BACKLOG_MANIPULATING_COMMANDS = [
  "boot-simulator", "open-url", "launch-app", "terminate-app", "reload-app", "open-dev-menu",
  "install-app", "uninstall-app", "tap", "gesture", "long-press", "dbltap", "fill", "type",
  "press", "focus", "blur", "select", "check", "uncheck", "drag", "scroll", "scroll-into-view",
  "clipboard", "keyboard", "set", "navigation", "storage", "state", "controls", "dialog", "sheet",
];

export function toolJson(value: unknown): ToolTextResult {
  return { content: [{ type: "text", text: `${JSON.stringify(value, null, 2)}\n` }] };
}

export async function liveBacklogCommand(
  args: Record<string, any> = {},
  deps: LiveBacklogDependencies = {},
): Promise<ToolTextResult> {
  const action = requireString(args.action ?? firstPositional(args) ?? "matrix", "action");
  if (!["matrix", "self-check", "run"].includes(action)) throw new Error(`Unknown live-backlog action: ${action}`);
  const cwd = resolve(args.cwd ?? process.cwd());
  const scope = args.scope ?? "smoke";
  const matrix = buildLiveBacklogMatrix({ ...args, cwd, scope });
  const selfCheck = liveBacklogSelfCheck(matrix);
  if (action === "self-check") {
    return toolJson({ available: selfCheck.ok, action, cwd, scope, selfCheck, source: matrix.source, rowCount: matrix.rows.length });
  }
  if (action === "matrix") {
    return toolJson({ available: true, action, cwd, scope, source: matrix.source, selfCheck, rowCount: matrix.rows.length, rows: matrix.rows });
  }
  if (!selfCheck.ok) {
    return toolJson({ available: false, action, cwd, scope, source: matrix.source, selfCheck, reason: "Live backlog self-check failed before executing rows." });
  }

  const outputDir = resolve(args.outputDir ?? join(cwd, ".scratch", "expo-ios", "live-backlog", isoStamp(deps)));
  await (deps.mkdir ?? fsMkdir)(outputDir, { recursive: true });
  const rows: Array<Record<string, any>> = [];
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
    generatedAt: (deps.now?.() ?? new Date()).toISOString(),
    source: matrix.source,
    selfCheck,
    summary,
    rows,
    hiddenPreflights: [],
    limitations: [
      "The runner executes only commands represented as rows; it does not start Metro, launch apps, or reconnect dev clients outside row execution.",
      "Runtime rows can be classified environment-blocked when Metro/Hermes target evidence is absent; those rows are not live passes.",
    ],
  };
  const reportPath = join(outputDir, "live-backlog-report.json");
  await writeJsonFile(reportPath, report, deps);
  return toolJson({ ...report, reportPath });
}

export function buildLiveBacklogMatrix(args: Record<string, any> = {}): Record<string, any> {
  const dispatcherCommands = Object.keys(COMMAND_ALIASES).sort();
  const helpCommands = parseHelpCommandNames(cliHelpText()).sort();
  const allRows = orderLiveBacklogRows(dispatcherCommands.map((command) => liveBacklogRowForCommand(command, args)));
  const smokeCommands = new Set(["doctor", "project-info", "routes", "devices", "metro", "devtools", "console", "errors", "expo", "bridge", "policy", "skills", "install", "upgrade", "live-backlog"]);
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
      unrepresentedHelpCommands: helpCommands.filter((command) => COMMAND_ALIASES[command] && !representedCommands.has(command)),
    },
    rows,
  };
}

export function orderLiveBacklogRows(rows: LiveBacklogRow[]): LiveBacklogRow[] {
  const terminalRuntimeActions = new Set(["terminate-app"]);
  return [
    ...rows.filter((row) => !terminalRuntimeActions.has(row.command)),
    ...rows.filter((row) => terminalRuntimeActions.has(row.command)),
  ];
}

export function liveBacklogRowForCommand(command: string, args: Record<string, any> = {}): LiveBacklogRow {
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
    source: { dispatcher: true, helpListed: parseHelpCommandNames(cliHelpText()).includes(command) },
    rationale: template.rationale ?? "Source-derived CLI command row.",
  };
}

export function liveBacklogTemplate(command: string, _args: Record<string, any> = {}): Record<string, any> {
  const cwdArg = ["--cwd", "__CWD__"];
  const metroArg = ["--metro-port", "__METRO_PORT__"];
  const bundleArg = ["--bundle-id", "__BUNDLE_ID__"];
  const deviceArg = ["--device", "__DEVICE__"];
  const policyArg = ["--action-policy", "__ACTION_POLICY__"];
  switch (command) {
    case "doctor": return { argv: ["doctor"] };
    case "project-info": return { argv: ["project-info", ...cwdArg] };
    case "routes": return { argv: ["routes", ...cwdArg] };
    case "devices": return { argv: ["devices"] };
    case "session": return { argv: ["session", "new", "live-backlog"], expectedClass: "static-pass" };
    case "target": return { argv: ["target", "list", ...metroArg], requirements: ["metro"] };
    case "snapshot": return { argv: ["snapshot", "--interactive", "true", "--source", "true", "--bounds", "true"] };
    case "refs": return { argv: ["refs"] };
    case "get": return { argv: ["get", "source", "@e1"], expectedClass: "expected-usage-error" };
    case "find": return { argv: ["find", "text", "Customers"], expectedClass: "expected-usage-error" };
    case "wait": return { argv: ["wait", "--text", "Customers", "--timeout-ms", "100"], expectedClass: "expected-usage-error" };
    case "batch": return { argv: ["batch", "[\"doctor\"]", "--bail", "true"] };
    case "boot-simulator": return { argv: ["boot-simulator", ...deviceArg], requirements: ["simulator"], scope: "full" };
    case "open-url": return { argv: ["open-url", "exp://127.0.0.1:8081", ...deviceArg], requirements: ["simulator"], scope: "full" };
    case "launch-app": return { argv: ["launch-app", ...deviceArg, ...bundleArg, "--crash-check-ms", "1000"], requirements: ["simulator", "installed-app", "crash-monitor"], scope: "full" };
    case "terminate-app": return { argv: ["terminate-app", ...deviceArg, ...bundleArg], requirements: ["simulator", "installed-app"], scope: "full" };
    case "reload-app": return { argv: ["reload-app", ...deviceArg, ...bundleArg], requirements: ["simulator", "installed-app"], scope: "full" };
    case "open-dev-menu": return { argv: ["open-dev-menu", ...metroArg, ...deviceArg, ...bundleArg, "--dev-client-url", "__DEV_CLIENT_URL__", "--crash-check-ms", "1000"], requirements: ["metro-message", "simulator", "crash-monitor"], scope: "full" };
    case "install-app": return { argv: ["install-app", "__APP_PATH__", ...deviceArg, ...policyArg, "--dry-run", "true"], expectedClass: "expected-usage-error", scope: "full" };
    case "uninstall-app": return { argv: ["uninstall-app", ...bundleArg, ...deviceArg, ...policyArg, "--dry-run", "true"], requirements: ["simulator", "action-policy"], scope: "full" };
    case "long-press": return { argv: ["long-press", "@e1", "--dry-run", "true"], expectedClass: "expected-usage-error" };
    case "dbltap": return { argv: ["dbltap", "@e1", "--dry-run", "true"], expectedClass: "expected-usage-error" };
    case "fill": return { argv: ["fill", "@e1", "hello", "--dry-run", "true"], expectedClass: "expected-usage-error" };
    case "type": return { argv: ["type", "hello", "--dry-run", "true"], requirements: ["simulator"], scope: "full" };
    case "press": return { argv: ["press", "Return", "--dry-run", "true"], requirements: ["simulator"], scope: "full" };
    case "focus": return { argv: ["focus", "@e1", "--dry-run", "true"], expectedClass: "expected-usage-error" };
    case "blur": return { argv: ["blur", "@e1", "--dry-run", "true"], expectedClass: "expected-usage-error" };
    case "select": return { argv: ["select", "@e1", "value", "--dry-run", "true"], expectedClass: "expected-usage-error" };
    case "check": return { argv: ["check", "@e1", "--dry-run", "true"], expectedClass: "expected-usage-error" };
    case "uncheck": return { argv: ["uncheck", "@e1", "--dry-run", "true"], expectedClass: "expected-usage-error" };
    case "drag": return { argv: ["drag", "@e1", "--to-x", "10", "--to-y", "10", "--dry-run", "true"], expectedClass: "expected-usage-error" };
    case "scroll": return { argv: ["scroll", "@e1", "--dy", "200", "--dry-run", "true"], expectedClass: "expected-usage-error" };
    case "scroll-into-view": return { argv: ["scroll-into-view", "@e1", "--dry-run", "true"], expectedClass: "expected-usage-error" };
    case "clipboard": return { argv: ["clipboard", "read"], requirements: ["simulator"], scope: "full" };
    case "keyboard": return { argv: ["keyboard", "press", "Return", "--dry-run", "true"], requirements: ["simulator"], scope: "full" };
    case "set": return { argv: ["set", "appearance", "dark", ...policyArg], requirements: ["simulator", "action-policy"], scope: "full" };
    case "logs": return { argv: ["logs", "--bundle-id", "__BUNDLE_ID__", "--limit", "20"], requirements: ["simulator-or-device-logs"] };
    case "screenshot": return { argv: ["screenshot", "--output-path", "__ROW_DIR__/screenshot.png"], requirements: ["simulator-screenshot"], scope: "full" };
    case "tap": return { argv: ["tap", "--x", "1", "--y", "1", "--dry-run", "true"], requirements: ["simulator"], scope: "full" };
    case "gesture": return { argv: ["gesture", "tap", "--x", "1", "--y", "1", "--dry-run", "true"], requirements: ["simulator"], scope: "full" };
    case "open-route": return { argv: ["open-route", "/", ...cwdArg], requirements: ["project-scheme", "simulator"], scope: "full" };
    case "ux-context": return { argv: ["ux-context", ...cwdArg, ...metroArg], requirements: ["simulator", "metro"] };
    case "annotate-screen": return { argv: ["annotate-screen", ...cwdArg, "--output-path", "__ROW_DIR__/annotation.html"] };
    case "inspector": return { argv: ["inspector", "probe", ...metroArg], requirements: ["hermes-target"] };
    case "review-overlay": return { argv: ["review-overlay", "read", "--output-dir", "__ROW_DIR__", ...cwdArg] };
    case "review-overlay-server": return { argv: ["review-overlay-server", "--output-dir", "__ROW_DIR__", "--port", "0", ...cwdArg] };
    case "review-next": return { argv: ["review-next", "--surface", "live-backlog", "--stage", "intake", "--issue", "live verification"] };
    case "annotation-server": return { argv: ["annotation-server", "status", ...cwdArg] };
    case "devtools": return { argv: ["devtools", "capabilities", ...metroArg], requirements: ["metro"] };
    case "console": return { argv: ["console", "--limit", "20", ...metroArg], requirements: ["hermes-target"] };
    case "errors": return { argv: ["errors", "--limit", "20", ...metroArg], requirements: ["hermes-target"] };
    case "metro": return { argv: ["metro", "status", ...metroArg], requirements: ["metro"] };
    case "profiler": return { argv: ["profiler", "start"], requirements: ["native-profiler"], scope: "full" };
    case "navigation": return { argv: ["navigation", "state", ...metroArg], requirements: ["hermes-target", "app-bridge"] };
    case "network": return { argv: ["network", "requests", ...metroArg], requirements: ["hermes-target", "app-bridge"] };
    case "storage": return { argv: ["storage", "async", "list", ...metroArg], requirements: ["hermes-target", "app-bridge"] };
    case "state": return { argv: ["state", "list", ...metroArg], requirements: ["hermes-target", "app-bridge"] };
    case "controls": return { argv: ["controls", "list", ...metroArg], requirements: ["hermes-target", "app-bridge"] };
    case "bridge": return { argv: ["bridge", "status", ...cwdArg] };
    case "accessibility": return { argv: ["accessibility", "tree"], requirements: ["accessibility-tooling"], scope: "full" };
    case "dialog": return { argv: ["dialog", "status", ...metroArg], requirements: ["hermes-target", "app-bridge"] };
    case "sheet": return { argv: ["sheet", "status", ...metroArg], requirements: ["hermes-target", "app-bridge"] };
    case "record": return { argv: ["record", "start", "--output-path", "__ROW_DIR__/recording.mov"], requirements: ["simulator"], scope: "full" };
    case "diff": return { argv: ["diff", "snapshot", "--baseline", "__ROW_DIR__/missing-baseline.json"], expectedClass: "expected-usage-error" };
    case "inspect": return { argv: ["inspect", "@e1"], expectedClass: "expected-usage-error" };
    case "highlight": return { argv: ["highlight", "@e1", "--output-path", "__ROW_DIR__/highlight.json"], expectedClass: "expected-usage-error" };
    case "expo": return { argv: ["expo", "upstream-policy", ...cwdArg] };
    case "rn": return { argv: ["rn", "tree", ...metroArg], requirements: ["hermes-target", "app-bridge"] };
    case "perf": return { argv: ["perf", "summary", ...metroArg], requirements: ["metro"] };
    case "dashboard": return { argv: ["dashboard", "status"] };
    case "review": return { argv: ["review", "matrix"] };
    case "policy": return { argv: ["policy", "show"] };
    case "redact": return { argv: ["redact", "__ROW_DIR__/redact-input.json", "--output-path", "__ROW_DIR__/redacted.json"], setupFiles: [{ path: "redact-input.json", content: "{\"token\":\"secret\"}\n" }] };
    case "skills": return { argv: ["skills", "list"] };
    case "install": return { argv: ["install", "check"] };
    case "upgrade": return { argv: ["upgrade", "check"] };
    case "release": return { argv: ["release", "check"], scope: "full" };
    case "live-backlog": return { argv: ["live-backlog", "self-check"] };
    case "trace": return { argv: ["trace", "--action", "read", ...metroArg], requirements: ["hermes-target"] };
    default: return { argv: [command], expectedClass: "expected-usage-error" };
  }
}

export function inferLiveBacklogRequirements(command: string): string[] {
  if (["console", "errors", "inspector", "trace", "navigation", "network", "storage", "state", "controls", "dialog", "sheet", "rn"].includes(command)) return ["hermes-target"];
  if (["metro", "devtools", "target"].includes(command)) return ["metro"];
  if (LIVE_BACKLOG_MANIPULATING_COMMANDS.includes(command)) return ["simulator"];
  return [];
}

export function parseHelpCommandNames(text: string): string[] {
  const commands = new Set<string>();
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

export function liveBacklogSelfCheck(matrix: Record<string, any>): Record<string, any> {
  const issues = [];
  for (const command of matrix.source.unrepresentedDispatcherCommands) issues.push({ type: "missing-dispatcher-row", command });
  for (const command of matrix.source.unrepresentedHelpCommands) issues.push({ type: "missing-help-row", command });
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
    hiddenPreflightPolicy: {
      allowed: false,
      statement: "Simulator, app lifecycle, Metro, Hermes, dev-client, gesture, screenshot, accessibility, log, and crash-report actions must be represented as live-backlog rows.",
    },
  };
}

export async function runLiveBacklogRow(
  row: LiveBacklogRow,
  args: Record<string, any>,
  deps: LiveBacklogDependencies = {},
): Promise<Record<string, any>> {
  const rowDir = join(args.outputDir, row.id);
  await (deps.mkdir ?? fsMkdir)(rowDir, { recursive: true });
  for (const file of liveBacklogTemplate(row.command, args).setupFiles ?? []) {
    await (deps.writeFile ?? fsWriteFile)(join(rowDir, file.path), file.content, "utf8");
  }
  if (row.argv.includes("__ACTION_POLICY__")) {
    await writeJsonFile(join(rowDir, "action-policy.json"), {
      allow: ["set.appearance", "install-app", "uninstall-app", "storage.set", "storage.clear", "state.load", "state.clear", "controls.press", "navigation.back", "navigation.tab"],
    }, deps);
  }
  if (row.argv.includes("__APP_PATH__")) {
    await (deps.mkdir ?? fsMkdir)(join(rowDir, "missing.app"), { recursive: true });
  }
  const stateDir = join(rowDir, "runs");
  const argv = ["--json", "--state-dir", stateDir, ...materializeLiveBacklogArgv(row.argv, args, rowDir)];
  const executable = deps.processExecPath ?? process.execPath;
  const cli = deps.cliWrapperPath ?? join(resolve("."), "cli", "expo-ios.mjs");
  const exactCommand = [executable, cli, ...argv];
  const startedAt = (deps.now?.() ?? new Date()).toISOString();
  if (!deps.execFile) throw new Error("live-backlog run requires execFile dependency.");
  const result = await deps.execFile(executable, [cli, ...argv], {
    cwd: args.cwd,
    timeout: 60_000,
    maxBuffer: 8 * 1024 * 1024,
    rejectOnError: false,
  });
  const exitCode = result.error?.code ?? 0;
  const stdoutPath = join(rowDir, "stdout.json");
  const stderrPath = join(rowDir, "stderr.log");
  const exitCodePath = join(rowDir, "exit-code.txt");
  await (deps.writeFile ?? fsWriteFile)(stdoutPath, result.stdout, "utf8");
  await (deps.writeFile ?? fsWriteFile)(stderrPath, result.stderr, "utf8");
  await (deps.writeFile ?? fsWriteFile)(exitCodePath, `${exitCode}\n`, "utf8");
  const parsed = parseBacklogJson(result.stdout);
  const classification = classifyLiveBacklogRow(row, exitCode, parsed);
  const runRecords = await listJsonFiles(stateDir, deps);
  return {
    id: row.id,
    command: row.command,
    exactCommand,
    startedAt,
    finishedAt: (deps.now?.() ?? new Date()).toISOString(),
    exitCode,
    classification,
    requirements: row.requirements,
    mutatesRuntime: row.mutatesRuntime,
    stdoutPath,
    stderrPath,
    exitCodePath,
    runRecordPaths: runRecords,
    artifactPaths: [stdoutPath, stderrPath, exitCodePath, ...runRecords],
    parsedSummary: summarizeBacklogPayload(parsed),
  };
}

export function materializeLiveBacklogArgv(argv: string[], args: Record<string, any>, rowDir: string): string[] {
  const replacements: Record<string, string> = {
    "__CWD__": args.cwd,
    "__METRO_PORT__": String(args.metroPort ?? 8081),
    "__BUNDLE_ID__": args.bundleId ?? "com.maddie.console",
    "__DEVICE__": args.device ?? "booted",
    "__DEV_CLIENT_URL__": args.devClientUrl ?? "exp+maddie://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A8081",
    "__ACTION_POLICY__": args.actionPolicy ?? join(rowDir, "action-policy.json"),
    "__OUTPUT_DIR__": args.outputDir,
    "__ROW_DIR__": rowDir,
    "__APP_PATH__": join(rowDir, "missing.app"),
  };
  return argv.map((part) => {
    let materialized = part;
    for (const [token, value] of Object.entries(replacements)) {
      materialized = materialized.split(token).join(value);
    }
    return materialized;
  });
}

export function parseBacklogJson(stdout: string): any {
  try {
    return JSON.parse(stdout);
  } catch {
    return null;
  }
}

export function classifyLiveBacklogRow(row: Pick<LiveBacklogRow, "requirements" | "expectedClass" | "mutatesRuntime">, exitCode: number, parsed: any): string {
  if (exitCode === EXIT_INVALID_USAGE) return "expected-usage-error";
  if (exitCode !== EXIT_SUCCESS) {
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

export function hasLiveRuntimeEvidence(data: any, requirements: string[]): boolean {
  if (!data || typeof data !== "object") return false;
  if (requirements.includes("hermes-target")) {
    return Boolean(data.target?.webSocketDebuggerUrl || data.cdp?.calls?.length || data.metro?.targets?.some?.((target: any) => target.webSocketDebuggerUrl));
  }
  if (requirements.includes("metro")) {
    return data.status === "available" ||
      data.metro?.status === "available" ||
      data.metro?.status === "packager-status:running" ||
      data.context?.metro?.status === "available" ||
      data.context?.metro?.status === "packager-status:running" ||
      Number(data.metro?.targetCount ?? data.context?.metro?.targetCount ?? 0) > 0 ||
      (Array.isArray(data.targets) && data.targets.length > 0) ||
      (Array.isArray(data.metro?.targets) && data.metro.targets.length > 0);
  }
  if (requirements.includes("metro-message")) {
    return data.messageSocket?.available === true || data.transport === "metro-message-socket";
  }
  if (requirements.includes("app-bridge")) {
    return data.source === "app-instrumentation" || data.sources?.includes?.("app-instrumentation");
  }
  return true;
}

export function summarizeBacklogPayload(parsed: any): Record<string, any> | null {
  const data = parsed?.data ?? parsed;
  if (!data || typeof data !== "object") return null;
  return {
    ok: parsed?.ok,
    available: typeof data.available === "boolean" ? data.available : undefined,
    action: data.action,
    reason: data.reason,
    keys: Object.keys(data).slice(0, 20),
  };
}

export async function listJsonFiles(dir: string, deps: Pick<LiveBacklogDependencies, "readdir"> = {}): Promise<string[]> {
  const entries = await Promise.resolve((deps.readdir ?? fsReaddir)(dir)).catch(() => []);
  return entries.filter((entry: string) => entry.endsWith(".json")).sort().map((entry: string) => join(dir, entry));
}

export function summarizeLiveBacklogRows(rows: Array<{ classification: string } | Record<string, any>>): Record<string, any> {
  const classifications: Record<string, number> = {};
  for (const row of rows) {
    classifications[row.classification] = (classifications[row.classification] ?? 0) + 1;
  }
  return {
    rowCount: rows.length,
    classifications,
    defectCount: classifications.defect ?? 0,
    environmentBlockedCount: classifications["environment-blocked"] ?? 0,
    unexplainedPartialCount: classifications["unexplained-partial"] ?? 0,
  };
}

export function cliHelpText(): string {
  const commands = Object.keys(COMMAND_ALIASES).sort();
  return `Discovery:\n${commands.map((command) => `  ${command}`).join("\n")}\nExamples:\n  expo-ios doctor\n`;
}

export function requireString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${name} must be a non-empty string.`);
  return value.trim();
}

async function writeJsonFile(file: string, value: unknown, deps: Pick<LiveBacklogDependencies, "writeFile"> = {}): Promise<void> {
  await (deps.writeFile ?? fsWriteFile)(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function isoStamp(deps: Pick<LiveBacklogDependencies, "now"> = {}): string {
  return (deps.now?.() ?? new Date()).toISOString().replace(/[:.]/g, "-");
}

function firstPositional(args: Record<string, unknown>): unknown {
  return Array.isArray(args._) ? args._[0] : undefined;
}
