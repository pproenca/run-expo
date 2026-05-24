import { execFile as nodeExecFile } from "node:child_process";
import { mkdir as fsMkdir, readdir as fsReaddir, writeFile as fsWriteFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  commandAliases,
  manipulatingCommandNames,
} from "../../../../core/command-surface/src/main/index.ts";
import {
  toolJson,
  type ToolTextResult,
} from "../../../../core/tool-json-envelope/src/main/index.ts";

export interface LiveBacklogDependencies {
  mkdir?: (path: string, options?: { recursive?: boolean }) => Promise<void> | void;
  writeFile?: (path: string, data: string, encoding: "utf8") => Promise<void> | void;
  readdir?: (path: string) => Promise<string[]> | string[];
  execFile?: (
    file: string,
    argv: string[],
    options: { cwd: string; timeout: number; maxBuffer: number; rejectOnError: false },
  ) =>
    | Promise<{ stdout: string; stderr: string; error?: { code?: number } | null }>
    | { stdout: string; stderr: string; error?: { code?: number } | null };
  now?: () => Date;
  processExecPath?: string;
  cliWrapperPath?: string;
}

export interface LiveBacklogArgs extends Record<string, unknown> {
  _?: unknown[];
  action?: unknown;
  cwd?: string;
  scope?: string;
  outputDir?: string;
  metroPort?: unknown;
  bundleId?: string;
  device?: string;
  devClientUrl?: string;
  actionPolicy?: string;
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

export interface LiveBacklogTemplate {
  id?: string;
  argv: string[];
  scope?: string;
  expectedClass?: string;
  requirements?: string[];
  rationale?: string;
  setupFiles?: Array<{ path: string; content: string }>;
}

export interface LiveBacklogMatrix {
  schemaVersion: 1;
  scope: string;
  source: {
    dispatcher: "commandAliases";
    dispatcherCommandCount: number;
    dispatcherCommands: string[];
    help: "cliHelpText";
    helpCommandCount: number;
    helpCommands: string[];
    fullRowCount: number;
    rowSubsetCount: number;
    rowSubset: string[];
    unrepresentedDispatcherCommands: string[];
    unrepresentedHelpCommands: string[];
  };
  rows: LiveBacklogRow[];
}

export interface BacklogJsonPayload {
  ok?: unknown;
  data?: unknown;
  available?: unknown;
  action?: unknown;
  reason?: unknown;
  [key: string]: unknown;
}

export interface BacklogPayloadSummary {
  ok: unknown;
  available?: boolean;
  action: unknown;
  reason: unknown;
  keys: string[];
}

export interface LiveBacklogSelfCheck {
  ok: boolean;
  issueCount: number;
  issues: Array<Record<string, unknown>>;
  adapterFindings: AdapterFinding[];
  adapterFindingCount: number;
  missingAdapterCount: number;
  hiddenPreflightPolicy: {
    allowed: false;
    statement: string;
  };
}

export interface LiveBacklogRunArgs extends LiveBacklogArgs {
  cwd: string;
  outputDir: string;
}

export interface BacklogRowResult {
  id: string;
  command: string;
  exactCommand: string[];
  startedAt: string;
  finishedAt: string;
  exitCode: number | string;
  classification: string;
  requirements: string[];
  mutatesRuntime: boolean;
  stdoutPath: string;
  stderrPath: string;
  exitCodePath: string;
  runRecordPaths: string[];
  artifactPaths: string[];
  parsedSummary: BacklogPayloadSummary | null;
}

export interface LiveBacklogSummary {
  rowCount: number;
  classifications: Record<string, number>;
  defectCount: number;
  environmentBlockedCount: number;
  unexplainedPartialCount: number;
}

export interface AdapterFinding {
  command: string;
  domain: string;
  status: "wired" | "missing" | "stub" | "runtime-dependent";
  reason: string;
  sourceFile: string;
  recommendedFix: string | null;
}

const EXIT_SUCCESS = 0;
const EXIT_INVALID_USAGE = 2;

export const COMMAND_ALIASES: Record<string, string> = commandAliases();

export const LIVE_BACKLOG_MANIPULATING_COMMANDS = manipulatingCommandNames();

const ADAPTER_SELF_CHECK_FINDINGS: AdapterFinding[] = [
  {
    command: "snapshot",
    domain: "semantic",
    status: "wired",
    reason:
      "Semantic snapshot capture evaluates app instrumentation through the shared Hermes CDP transport and falls back to native accessibility only when bridge data is unavailable.",
    sourceFile: "src/commands/snapshot-evidence/src/main/snapshot-command.ts",
    recommendedFix: null,
  },
  {
    command: "rn tree|rn fiber|rn renders",
    domain: "react-native",
    status: "wired",
    reason:
      "React Native introspection delegates to bridge-domain Runtime.evaluate using __EXPO_IOS_RN_BRIDGE__ and instrumentation fallbacks.",
    sourceFile: "src/commands/rn-introspection/src/main/index.ts",
    recommendedFix: null,
  },
  {
    command: "console|errors",
    domain: "diagnostics",
    status: "wired",
    reason: "Runtime diagnostics use the shared Hermes CDP evaluator by default.",
    sourceFile: "src/commands/devtools-diagnostics/src/main/index.ts",
    recommendedFix: null,
  },
  {
    command:
      "navigation|network|dialog|sheet|storage|state|controls|perf|trace|inspector|metro reload",
    domain: "runtime",
    status: "wired",
    reason:
      "Runtime.evaluate-backed commands share the Hermes CDP transport with loopback URL normalization and Metro Origin headers.",
    sourceFile: "src/platform/hermes-cdp-client/src/main/index.ts",
    recommendedFix: null,
  },
  {
    command: "network waterfall",
    domain: "validation",
    status: "runtime-dependent",
    reason:
      "Waterfall output is wired, but phase-level timing is only validated when the app bridge emits startedAt/endedAt and metadata-only request rows.",
    sourceFile: "src/commands/network-evidence/src/main/index.ts",
    recommendedFix:
      "Mount the upgraded dev-only network bridge before making network waterfall claims.",
  },
  {
    command: "perf action|perf interaction|perf report",
    domain: "performance-validation",
    status: "runtime-dependent",
    reason:
      "Performance outputs now include realValidation and mark placeholder action/frame metrics partial until interaction, render, frame, or native sample evidence is present.",
    sourceFile: "src/commands/perf-evidence/src/main/index.ts",
    recommendedFix: "Use perf interaction start/stop and perf report for bottleneck claims.",
  },
  {
    command: "rn renders|trace read",
    domain: "render-validation",
    status: "runtime-dependent",
    reason:
      "Render cost claims require React Profiler commit durations; empty commit arrays are reported as partial evidence.",
    sourceFile: "src/commands/rn-introspection/src/main/index.ts",
    recommendedFix: "Mount the dev-only Profiler wrapper and rerun rn renders start/read/stop.",
  },
];

export async function liveBacklogCommand(
  args: LiveBacklogArgs = {},
  deps: LiveBacklogDependencies = defaultLiveBacklogDependencies,
): Promise<ToolTextResult> {
  const action = requireString(args.action ?? firstPositional(args) ?? "matrix", "action");
  if (!["matrix", "self-check", "run"].includes(action))
    throw new Error(`Unknown live-backlog action: ${action}`);
  const cwd = resolve(args.cwd ?? process.cwd());
  const scope = args.scope ?? "smoke";
  const matrix = buildLiveBacklogMatrix({ ...args, cwd, scope });
  const selfCheck = liveBacklogSelfCheck(matrix);
  if (action === "self-check") {
    return toolJson({
      available: selfCheck.ok,
      action,
      cwd,
      scope,
      selfCheck,
      source: matrix.source,
      rowCount: matrix.rows.length,
    });
  }
  if (action === "matrix") {
    return toolJson({
      available: true,
      action,
      cwd,
      scope,
      source: matrix.source,
      selfCheck,
      rowCount: matrix.rows.length,
      rows: matrix.rows,
    });
  }
  if (!selfCheck.ok) {
    return toolJson({
      available: false,
      action,
      cwd,
      scope,
      source: matrix.source,
      selfCheck,
      reason: "Live backlog self-check failed before executing rows.",
    });
  }

  const outputDir = resolve(
    args.outputDir ?? join(cwd, ".scratch", "expo98", "live-backlog", isoStamp(deps)),
  );
  await (deps.mkdir ?? fsMkdir)(outputDir, { recursive: true });
  const rows: BacklogRowResult[] = [];
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

const defaultLiveBacklogDependencies: LiveBacklogDependencies = {
  execFile,
};

export function buildLiveBacklogMatrix(args: LiveBacklogArgs = {}): LiveBacklogMatrix {
  const dispatcherCommands = Object.keys(COMMAND_ALIASES).sort();
  const helpCommands = parseHelpCommandNames(cliHelpText()).sort();
  const allRows = orderLiveBacklogRows(
    dispatcherCommands.map((command) => liveBacklogRowForCommand(command, args)),
  );
  const smokeCommands = new Set([
    "doctor",
    "project-info",
    "routes",
    "devices",
    "metro",
    "devtools",
    "console",
    "errors",
    "expo",
    "bridge",
    "policy",
    "skills",
    "install",
    "upgrade",
    "live-backlog",
  ]);
  const rows =
    args.scope === "smoke" || !args.scope
      ? allRows.filter((row) => smokeCommands.has(row.command))
      : allRows;
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
      unrepresentedDispatcherCommands: dispatcherCommands.filter(
        (command) => !representedCommands.has(command),
      ),
      unrepresentedHelpCommands: helpCommands.filter(
        (command) => COMMAND_ALIASES[command] && !representedCommands.has(command),
      ),
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

export function liveBacklogRowForCommand(
  command: string,
  args: LiveBacklogArgs = {},
): LiveBacklogRow {
  const template = liveBacklogTemplate(command, args);
  const requirements = template.requirements ?? inferLiveBacklogRequirements(command);
  return {
    id: template.id ?? command.replace(/[^a-z0-9]+/g, "-"),
    command,
    exactCommand: ["expo98", "--json", ...template.argv],
    argv: template.argv,
    scope: template.scope ?? "full",
    expectedClass: template.expectedClass ?? (requirements.length ? "live-pass" : "static-pass"),
    requirements,
    mutatesRuntime: LIVE_BACKLOG_MANIPULATING_COMMANDS.includes(command),
    captures: ["stdout", "stderr", "exit-code", "run-record"],
    artifacts: [],
    source: {
      dispatcher: true,
      helpListed: parseHelpCommandNames(cliHelpText()).includes(command),
    },
    rationale: template.rationale ?? "Source-derived CLI command row.",
  };
}

export function liveBacklogTemplate(
  command: string,
  _args: LiveBacklogArgs = {},
): LiveBacklogTemplate {
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
      return {
        argv: ["snapshot", "--interactive", "true", "--source", "true", "--bounds", "true"],
      };
    case "refs":
      return { argv: ["refs"] };
    case "get":
      return { argv: ["get", "source", "@e1"], expectedClass: "expected-usage-error" };
    case "find":
      return { argv: ["find", "text", "Customers"], expectedClass: "expected-usage-error" };
    case "wait":
      return {
        argv: ["wait", "--text", "Customers", "--timeout-ms", "100"],
        expectedClass: "expected-usage-error",
      };
    case "batch":
      return { argv: ["batch", '["doctor"]', "--bail", "true"] };
    case "boot-simulator":
      return { argv: ["boot-simulator", ...deviceArg], requirements: ["simulator"], scope: "full" };
    case "open-url":
      return {
        argv: ["open-url", "exp://127.0.0.1:8081", ...deviceArg],
        requirements: ["simulator"],
        scope: "full",
      };
    case "launch-app":
      return {
        argv: ["launch-app", ...deviceArg, ...bundleArg, "--crash-check-ms", "1000"],
        requirements: ["simulator", "installed-app", "crash-monitor"],
        scope: "full",
      };
    case "terminate-app":
      return {
        argv: ["terminate-app", ...deviceArg, ...bundleArg],
        requirements: ["simulator", "installed-app"],
        scope: "full",
      };
    case "reload-app":
      return {
        argv: ["reload-app", ...deviceArg, ...bundleArg],
        requirements: ["simulator", "installed-app"],
        scope: "full",
      };
    case "open-dev-menu":
      return {
        argv: [
          "open-dev-menu",
          ...metroArg,
          ...deviceArg,
          ...bundleArg,
          "--dev-client-url",
          "__DEV_CLIENT_URL__",
          "--crash-check-ms",
          "1000",
        ],
        requirements: ["metro-message", "simulator", "crash-monitor"],
        scope: "full",
      };
    case "install-app":
      return {
        argv: ["install-app", "__APP_PATH__", ...deviceArg, ...policyArg, "--dry-run", "true"],
        expectedClass: "expected-usage-error",
        scope: "full",
      };
    case "uninstall-app":
      return {
        argv: ["uninstall-app", ...bundleArg, ...deviceArg, ...policyArg, "--dry-run", "true"],
        requirements: ["simulator", "action-policy"],
        scope: "full",
      };
    case "long-press":
      return {
        argv: ["long-press", "@e1", "--dry-run", "true"],
        expectedClass: "expected-usage-error",
      };
    case "dbltap":
      return {
        argv: ["dbltap", "@e1", "--dry-run", "true"],
        expectedClass: "expected-usage-error",
      };
    case "fill":
      return {
        argv: ["fill", "@e1", "hello", "--dry-run", "true"],
        expectedClass: "expected-usage-error",
      };
    case "type":
      return {
        argv: ["type", "hello", "--dry-run", "true"],
        requirements: ["simulator"],
        scope: "full",
      };
    case "press":
      return {
        argv: ["press", "Return", "--dry-run", "true"],
        requirements: ["simulator"],
        scope: "full",
      };
    case "focus":
      return { argv: ["focus", "@e1", "--dry-run", "true"], expectedClass: "expected-usage-error" };
    case "blur":
      return { argv: ["blur", "@e1", "--dry-run", "true"], expectedClass: "expected-usage-error" };
    case "select":
      return {
        argv: ["select", "@e1", "value", "--dry-run", "true"],
        expectedClass: "expected-usage-error",
      };
    case "check":
      return { argv: ["check", "@e1", "--dry-run", "true"], expectedClass: "expected-usage-error" };
    case "uncheck":
      return {
        argv: ["uncheck", "@e1", "--dry-run", "true"],
        expectedClass: "expected-usage-error",
      };
    case "drag":
      return {
        argv: ["drag", "@e1", "--to-x", "10", "--to-y", "10", "--dry-run", "true"],
        expectedClass: "expected-usage-error",
      };
    case "scroll":
      return {
        argv: ["scroll", "@e1", "--dy", "200", "--dry-run", "true"],
        expectedClass: "expected-usage-error",
      };
    case "scroll-into-view":
      return {
        argv: ["scroll-into-view", "@e1", "--dry-run", "true"],
        expectedClass: "expected-usage-error",
      };
    case "clipboard":
      return { argv: ["clipboard", "read"], requirements: ["simulator"], scope: "full" };
    case "keyboard":
      return {
        argv: ["keyboard", "press", "Return", "--dry-run", "true"],
        requirements: ["simulator"],
        scope: "full",
      };
    case "set":
      return {
        argv: ["set", "appearance", "dark", ...policyArg],
        requirements: ["simulator", "action-policy"],
        scope: "full",
      };
    case "logs":
      return {
        argv: ["logs", "--bundle-id", "__BUNDLE_ID__", "--limit", "20"],
        requirements: ["simulator-or-device-logs"],
      };
    case "screenshot":
      return {
        argv: ["screenshot", "--output-path", "__ROW_DIR__/screenshot.png"],
        requirements: ["simulator-screenshot"],
        scope: "full",
      };
    case "tap":
      return {
        argv: ["tap", "--x", "1", "--y", "1", "--dry-run", "true"],
        requirements: ["simulator"],
        scope: "full",
      };
    case "gesture":
      return {
        argv: ["gesture", "tap", "--x", "1", "--y", "1", "--dry-run", "true"],
        requirements: ["simulator"],
        scope: "full",
      };
    case "open-route":
      return {
        argv: ["open-route", "/", ...cwdArg, ...policyArg],
        requirements: ["project-scheme", "simulator", "action-policy"],
        scope: "full",
      };
    case "ux-context":
      return { argv: ["ux-context", ...cwdArg, ...metroArg], requirements: ["simulator", "metro"] };
    case "annotate-screen":
      return {
        argv: ["annotate-screen", "prepare", ...cwdArg, "--output-dir", "__ROW_DIR__/annotations"],
      };
    case "inspector":
      return { argv: ["inspector", "probe", ...metroArg], requirements: ["hermes-target"] };
    case "review-overlay":
      return { argv: ["review-overlay", "read", "--output-dir", "__ROW_DIR__", ...cwdArg] };
    case "review-overlay-server":
      return {
        argv: ["review-overlay-server", "--output-dir", "__ROW_DIR__", "--port", "0", ...cwdArg],
      };
    case "review-next":
      return {
        argv: [
          "review-next",
          "--surface",
          "live-backlog",
          "--stage",
          "intake",
          "--issue",
          "live verification",
        ],
      };
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
      return {
        argv: ["navigation", "state", ...metroArg],
        requirements: ["hermes-target", "app-bridge"],
      };
    case "network":
      return {
        argv: ["network", "requests", ...metroArg],
        requirements: ["hermes-target", "app-bridge"],
      };
    case "storage":
      return {
        argv: ["storage", "async", "list", ...metroArg],
        requirements: ["hermes-target", "app-bridge"],
      };
    case "state":
      return {
        argv: ["state", "list", ...metroArg],
        requirements: ["hermes-target", "app-bridge"],
      };
    case "controls":
      return {
        argv: ["controls", "list", ...metroArg],
        requirements: ["hermes-target", "app-bridge"],
      };
    case "bridge":
      return { argv: ["bridge", "status", ...cwdArg] };
    case "accessibility":
      return {
        argv: ["accessibility", "tree"],
        requirements: ["accessibility-tooling"],
        scope: "full",
      };
    case "dialog":
      return {
        argv: ["dialog", "status", ...metroArg],
        requirements: ["hermes-target", "app-bridge"],
      };
    case "sheet":
      return {
        argv: ["sheet", "status", ...metroArg],
        requirements: ["hermes-target", "app-bridge"],
      };
    case "record":
      return {
        argv: ["record", "start", "--output-path", "__ROW_DIR__/recording.mov"],
        requirements: ["simulator"],
        scope: "full",
      };
    case "diff":
      return {
        argv: ["diff", "snapshot", "--baseline", "__ROW_DIR__/missing-baseline.json"],
        expectedClass: "expected-usage-error",
      };
    case "inspect":
      return { argv: ["inspect", "@e1"], expectedClass: "expected-usage-error" };
    case "highlight":
      return {
        argv: ["highlight", "@e1", "--output-path", "__ROW_DIR__/highlight.json"],
        expectedClass: "expected-usage-error",
      };
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
      return {
        argv: [
          "redact",
          "__ROW_DIR__/redact-input.json",
          "--output-path",
          "__ROW_DIR__/redacted.json",
        ],
        setupFiles: [{ path: "redact-input.json", content: '{"token":"secret"}\n' }],
      };
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

export function inferLiveBacklogRequirements(command: string): string[] {
  if (
    [
      "console",
      "errors",
      "inspector",
      "trace",
      "navigation",
      "network",
      "storage",
      "state",
      "controls",
      "dialog",
      "sheet",
      "rn",
    ].includes(command)
  )
    return ["hermes-target"];
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

export function liveBacklogSelfCheck(matrix: LiveBacklogMatrix): LiveBacklogSelfCheck {
  const issues: Array<Record<string, unknown>> = [];
  const adapterFindings = ADAPTER_SELF_CHECK_FINDINGS.map((finding) => ({ ...finding }));
  for (const command of matrix.source.unrepresentedDispatcherCommands)
    issues.push({ type: "missing-dispatcher-row", command });
  for (const command of matrix.source.unrepresentedHelpCommands)
    issues.push({ type: "missing-help-row", command });
  for (const finding of adapterFindings) {
    if (finding.status === "missing" || finding.status === "stub") {
      issues.push({
        type: "missing-adapter",
        command: finding.command,
        domain: finding.domain,
        sourceFile: finding.sourceFile,
      });
    }
  }
  for (const command of LIVE_BACKLOG_MANIPULATING_COMMANDS) {
    if (COMMAND_ALIASES[command] && !matrix.source.dispatcherCommands.includes(command))
      issues.push({ type: "missing-live-action-dispatcher", command });
  }
  for (const row of matrix.rows) {
    if (!Array.isArray(row.argv) || row.argv.length === 0)
      issues.push({ type: "missing-command-argv", rowId: row.id });
    for (const capture of ["stdout", "stderr", "exit-code"]) {
      if (!row.captures.includes(capture))
        issues.push({ type: "missing-capture", rowId: row.id, capture });
    }
  }
  return {
    ok: issues.length === 0,
    issueCount: issues.length,
    issues,
    adapterFindings,
    adapterFindingCount: adapterFindings.length,
    missingAdapterCount: adapterFindings.filter(
      (finding) => finding.status === "missing" || finding.status === "stub",
    ).length,
    hiddenPreflightPolicy: {
      allowed: false,
      statement:
        "Simulator, app lifecycle, Metro, Hermes, dev-client, gesture, screenshot, accessibility, log, and crash-report actions must be represented as live-backlog rows.",
    },
  };
}

export async function runLiveBacklogRow(
  row: LiveBacklogRow,
  args: LiveBacklogRunArgs,
  deps: LiveBacklogDependencies = defaultLiveBacklogDependencies,
): Promise<BacklogRowResult> {
  const rowDir = join(args.outputDir, row.id);
  await (deps.mkdir ?? fsMkdir)(rowDir, { recursive: true });
  for (const file of liveBacklogTemplate(row.command, args).setupFiles ?? []) {
    await (deps.writeFile ?? fsWriteFile)(join(rowDir, file.path), file.content, "utf8");
  }
  if (row.argv.includes("__ACTION_POLICY__")) {
    await writeJsonFile(
      join(rowDir, "action-policy.json"),
      {
        allow: [
          "set.appearance",
          "install-app",
          "uninstall-app",
          "storage.set",
          "storage.clear",
          "state.load",
          "state.clear",
          "controls.press",
          "navigation.back",
          "navigation.tab",
        ],
      },
      deps,
    );
  }
  if (row.argv.includes("__APP_PATH__")) {
    await (deps.mkdir ?? fsMkdir)(join(rowDir, "missing.app"), { recursive: true });
  }
  const stateDir = join(rowDir, "runs");
  const argv = [
    "--json",
    "--state-dir",
    stateDir,
    ...materializeLiveBacklogArgv(row.argv, args, rowDir),
  ];
  const executable = deps.processExecPath ?? process.execPath;
  const cli = deps.cliWrapperPath ?? join(resolve("."), "cli", "expo98.mjs");
  const exactCommand = [executable, cli, ...argv];
  const startedAt = (deps.now?.() ?? new Date()).toISOString();
  if (!deps.execFile) throw new Error("No subprocess adapter is configured.");
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

export function materializeLiveBacklogArgv(
  argv: string[],
  args: LiveBacklogRunArgs,
  rowDir: string,
): string[] {
  const replacements: Record<string, string> = {
    __CWD__: args.cwd,
    __METRO_PORT__: String(args.metroPort ?? 8081),
    __BUNDLE_ID__: args.bundleId ?? "com.maddie.console",
    __DEVICE__: args.device ?? "booted",
    __DEV_CLIENT_URL__:
      args.devClientUrl ??
      "exp+maddie://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A8081",
    __ACTION_POLICY__: args.actionPolicy ?? join(rowDir, "action-policy.json"),
    __OUTPUT_DIR__: args.outputDir,
    __ROW_DIR__: rowDir,
    __APP_PATH__: join(rowDir, "missing.app"),
  };
  return argv.map((part) => {
    let materialized = part;
    for (const [token, value] of Object.entries(replacements)) {
      materialized = materialized.split(token).join(value);
    }
    return materialized;
  });
}

export function parseBacklogJson(stdout: string): BacklogJsonPayload | null {
  try {
    const parsed: unknown = JSON.parse(stdout);
    return asRecord(parsed);
  } catch {
    return null;
  }
}

export function classifyLiveBacklogRow(
  row: Pick<LiveBacklogRow, "requirements" | "expectedClass" | "mutatesRuntime">,
  exitCode: number | string,
  parsed: BacklogJsonPayload | null,
): string {
  if (exitCode === EXIT_INVALID_USAGE) return "expected-usage-error";
  if (exitCode !== EXIT_SUCCESS) {
    if (row.requirements.length > 0) return "environment-blocked";
    if (row.expectedClass === "expected-usage-error") return "expected-usage-error";
    return "defect";
  }
  const data = asRecord(parsed?.data) ?? parsed;
  const requiresRuntime = row.requirements.some((requirement) =>
    ["metro", "metro-message", "hermes-target", "app-bridge"].includes(requirement),
  );
  if (requiresRuntime && !hasLiveRuntimeEvidence(data, row.requirements))
    return "environment-blocked";
  if (data?.available === false) {
    if (row.expectedClass === "expected-usage-error") return "expected-usage-error";
    if (requiresRuntime || row.requirements.length > 0) return "environment-blocked";
    return "designed-unavailable";
  }
  if (row.expectedClass === "expected-usage-error") return "expected-usage-error";
  return row.requirements.length > 0 || row.mutatesRuntime ? "live-pass" : "static-pass";
}

export function hasLiveRuntimeEvidence(data: unknown, requirements: string[]): boolean {
  const record = asRecord(data);
  if (!record) return false;
  if (requirements.includes("hermes-target")) {
    const target = asRecord(record.target);
    const cdp = asRecord(record.cdp);
    const metro = asRecord(record.metro);
    const metroTargets = Array.isArray(metro?.targets) ? metro.targets : [];
    return Boolean(
      target?.webSocketDebuggerUrl ||
      (Array.isArray(cdp?.calls) && cdp.calls.length > 0) ||
      metroTargets.some((targetEntry) => Boolean(asRecord(targetEntry)?.webSocketDebuggerUrl)),
    );
  }
  if (requirements.includes("metro")) {
    const metro = asRecord(record.metro);
    const context = asRecord(record.context);
    const contextMetro = asRecord(context?.metro);
    return (
      record.status === "available" ||
      metro?.status === "available" ||
      metro?.status === "packager-status:running" ||
      contextMetro?.status === "available" ||
      contextMetro?.status === "packager-status:running" ||
      Number(metro?.targetCount ?? contextMetro?.targetCount ?? 0) > 0 ||
      (Array.isArray(record.targets) && record.targets.length > 0) ||
      (Array.isArray(metro?.targets) && metro.targets.length > 0)
    );
  }
  if (requirements.includes("metro-message")) {
    const messageSocket = asRecord(record.messageSocket);
    return messageSocket?.available === true || record.transport === "metro-message-socket";
  }
  if (requirements.includes("app-bridge")) {
    return (
      record.source === "app-instrumentation" ||
      (Array.isArray(record.sources) && record.sources.includes("app-instrumentation"))
    );
  }
  return true;
}

export function summarizeBacklogPayload(
  parsed: BacklogJsonPayload | null,
): BacklogPayloadSummary | null {
  const data = asRecord(parsed?.data) ?? parsed;
  if (!data || typeof data !== "object") return null;
  return {
    ok: parsed?.ok,
    available: typeof data.available === "boolean" ? data.available : undefined,
    action: data.action,
    reason: data.reason,
    keys: Object.keys(data).slice(0, 20),
  };
}

export async function listJsonFiles(
  dir: string,
  deps: Pick<LiveBacklogDependencies, "readdir"> = {},
): Promise<string[]> {
  const entries = await Promise.resolve((deps.readdir ?? fsReaddir)(dir)).catch(() => []);
  return entries
    .filter((entry: string) => entry.endsWith(".json"))
    .sort()
    .map((entry: string) => join(dir, entry));
}

export function summarizeLiveBacklogRows(
  rows: Array<Pick<BacklogRowResult, "classification">>,
): LiveBacklogSummary {
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
  return `Discovery:\n${commands.map((command) => `  ${command}`).join("\n")}\nExamples:\n  expo98 doctor\n`;
}

export function requireString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0)
    throw new Error(`${name} must be a non-empty string.`);
  return value.trim();
}

async function writeJsonFile(
  file: string,
  value: unknown,
  deps: Pick<LiveBacklogDependencies, "writeFile"> = {},
): Promise<void> {
  await (deps.writeFile ?? fsWriteFile)(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function isoStamp(deps: Pick<LiveBacklogDependencies, "now"> = {}): string {
  return (deps.now?.() ?? new Date()).toISOString().replace(/[:.]/g, "-");
}

function firstPositional(args: Record<string, unknown>): unknown {
  return Array.isArray(args._) ? args._[0] : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function execFile(
  file: string,
  argv: string[],
  options: { cwd: string; timeout: number; maxBuffer: number; rejectOnError: false },
): Promise<{ stdout: string; stderr: string; error?: { code?: number } | null }> {
  return new Promise((resolve) => {
    nodeExecFile(
      file,
      argv,
      {
        cwd: options.cwd,
        timeout: options.timeout,
        maxBuffer: options.maxBuffer,
      },
      (error, stdout, stderr) => {
        resolve({
          stdout: String(stdout ?? ""),
          stderr: String(stderr ?? ""),
          error:
            error && typeof error === "object" && "code" in error
              ? { code: Number((error as { code?: unknown }).code) }
              : error
                ? { code: 1 }
                : null,
        });
      },
    );
  });
}
