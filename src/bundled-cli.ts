import { accessibilityCommand } from "./commands/accessibility-actions/src/main/index.ts";
import { annotateScreen } from "./commands/annotate-screen-artifacts/src/main/index.ts";
import { removedAnnotationServerCommand } from "./commands/annotation-server-http/src/main/index.ts";
import {
  bootSimulator,
  collectAppLogs,
  installApp,
  launchApp,
  reloadApp,
  terminateApp,
  uninstallApp,
} from "./commands/app-lifecycle-actions/src/main/index.ts";
import {
  batchCommand,
  type BatchDependencies,
} from "./commands/batch-orchestration/src/main/index.ts";
import { bridgeCommand } from "./commands/bridge-command-adapter/src/main/index.ts";
import {
  controlsCommand,
  stateCommand,
  storageCommand,
} from "./commands/bridge-domain-actions/src/main/index.ts";
import { dashboardCommand } from "./commands/dashboard-observability/src/main/index.ts";
import {
  debugInspectCommand,
  highlightCommand,
} from "./commands/debug-inspect-highlight/src/main/index.ts";
import { listDevices } from "./commands/device-listing/src/main/index.ts";
import {
  consoleCommand,
  devtoolsCommand,
  errorsCommand,
} from "./commands/devtools-diagnostics/src/main/index.ts";
import { expoCommand } from "./commands/expo-introspection-actions/src/main/index.ts";
import {
  automationGesture,
  automationTap,
  clipboardCommand,
  keyboardCommand,
  refActionCommand,
  setEnvironmentCommand,
} from "./commands/interaction-actions/src/main/index.ts";
import { traceInteraction } from "./commands/interaction-trace-expression/src/main/index.ts";
import { liveBacklogCommand } from "./commands/live-backlog/src/main/index.ts";
import { metroCommand } from "./commands/metro-probes/src/main/index.ts";
import { dialogCommand, sheetCommand } from "./commands/modal-blocker-actions/src/main/index.ts";
import { navigationCommand } from "./commands/navigation-deeplinks/src/main/index.ts";
import { networkCommand } from "./commands/network-evidence/src/main/index.ts";
import { perfCommand } from "./commands/perf-evidence/src/main/index.ts";
import {
  installCommand,
  releaseCommand,
  skillsCommand,
  upgradeCommand,
} from "./commands/plugin-self-management/src/main/index.ts";
import {
  doctor as legacyDoctor,
  projectInfo,
} from "./commands/project-info-doctor/src/main/index.ts";
import { recordCommand } from "./commands/record-artifacts/src/main/index.ts";
import { findCommand, waitCommand } from "./commands/ref-actions-wait/src/main/index.ts";
import { diffCommand, reviewCommand } from "./commands/review-evidence-reports/src/main/index.ts";
import { reviewNextStep } from "./commands/review-next-guidance/src/main/index.ts";
import { reviewOverlay } from "./commands/review-overlay-workflow/src/main/index.ts";
import { rnCommand } from "./commands/rn-introspection/src/main/index.ts";
import { openExpoRoute, openUrl } from "./commands/route-url-actions/src/main/index.ts";
import { expoRouterSitemap } from "./commands/router-sitemap/src/main/index.ts";
import { runtimeInspector } from "./commands/runtime-inspector-actions/src/main/index.ts";
import { automationTakeScreenshot } from "./commands/screenshot-capture/src/main/index.ts";
import {
  snapshotCommand,
  refsCommand,
  getRefCommand,
} from "./commands/snapshot-evidence/src/main/index.ts";
import { captureUxContext } from "./commands/ux-context-capture/src/main/index.ts";
import { parseCliArgs } from "./core/cli-argv-parser/src/main/index.ts";
import { createCliExecutable } from "./core/cli-executable-wrapper/src/main/index.ts";
import { createCliFacade } from "./core/cli-facade-entrypoint/src/main/index.ts";
import { cliHelpText } from "./core/cli-help-surface/src/main/index.ts";
import { COMPATIBILITY_CLI_NAME } from "./core/cli-identity/src/main/index.ts";
import {
  createCliRuntime,
  type CliRuntime,
} from "./core/cli-runtime-composition/src/main/index.ts";
import { commandArgs } from "./core/command-arg-projection/src/main/index.ts";
import {
  dispatchCommand,
  exitCodeForError,
  formatCliError,
  toolJson,
  unwrapToolJson,
} from "./core/command-dispatch-envelope/src/main/index.ts";
import { policyCommand, redactCommand } from "./core/policy-redaction/src/main/command-boundary.ts";
import { bindHandlers } from "./core/tool-handler-registry/src/main/index.ts";
import { sessionCommand, startRunRecord } from "./state/session-run-records/src/main/index.ts";
import { targetCommand } from "./state/target-management/src/main/index.ts";

const CLI_VERSION = "0.1.0";

let runtime: CliRuntime;

const runToolInCurrentRuntime: BatchDependencies["runToolAndEmitPayload"] = async (
  toolName,
  args,
) => {
  const handler = runtime.handlers[toolName];
  if (!handler) {
    throw new Error(`Unknown batch tool: ${toolName}`);
  }
  return handler(args);
};

function runBatchCommand(args: Record<string, unknown>) {
  return batchCommand(args, { runToolAndEmitPayload: runToolInCurrentRuntime });
}

const handlerImplementations = {
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
  batchCommand: runBatchCommand,
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
  removedAnnotationServerCommand,
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
  traceInteraction,
};

runtime = createCliRuntime({
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
  startRunRecord: (entry) =>
    startRunRecord(entry as unknown as Parameters<typeof startRunRecord>[0]),
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
  printHelp: () => cliHelpText(CLI_VERSION),
  cliVersion: CLI_VERSION,
});

const executable = createCliExecutable({
  argv: () => process.argv,
  main: (argv) => runtime.run(argv),
  setExitCode: (exitCode) => {
    process.exitCode = exitCode;
  },
  writeCliError: (error) => {
    process.stderr.write(formatCliError(error, runtime.getLastCliOptions()) ?? "");
  },
  exitCodeForError,
});

void executable.run();

async function expo98Doctor(args: Record<string, unknown> = {}) {
  const result = await legacyDoctor(args);
  const payload = unwrapToolJson(result) as Record<string, unknown>;
  const cli =
    typeof payload.cli === "object" && payload.cli !== null
      ? { ...(payload.cli as Record<string, unknown>), name: "expo98", bin: "expo98" }
      : { name: "expo98", version: CLI_VERSION, bin: "expo98" };
  return toolJson({
    ...payload,
    cli,
    runtime: {
      node: process.version,
      supported: Number(process.versions.node.split(".")[0] ?? 0) >= 20,
      required: ">=20",
    },
    package: {
      name: "expo98",
      entrypoint: "cli/expo98.mjs",
      bundledExecutable: true,
      compatibilityBin: COMPATIBILITY_CLI_NAME,
    },
  });
}
